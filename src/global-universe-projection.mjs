import fs from 'node:fs'
import { getAddress } from 'viem'

import { PoolAdmission, V4_POOL_MANAGER, isExecutorPoolKeyShape, pairPoolId } from './pair-catalog.mjs'
import { stablePayloadHash } from './source-provenance.mjs'

export const GLOBAL_UNIVERSE_SCHEMA_VERSION = 1
export const GLOBAL_UNIVERSE_MAX_AGE_MS = 15 * 60 * 1_000
export const GLOBAL_UNIVERSE_MAX_FILE_BYTES = 2 * 1024 * 1024
export const GLOBAL_UNIVERSE_POLICY = Object.freeze({
  version: 'BOUNDED_SIGNER_FREE_GLOBAL_UNIVERSE_V2',
  maximumTargets: 128,
  maximumAssets: 256,
  maximumPools: 1_024,
  maximumRejections: 128,
  minimumPoolsPerTarget: 2,
  priorityTargets: 32,
})

const MODE = 'READ_ONLY_NO_SIGNING_NO_BROADCAST'
const MAXIMUM_CLOCK_SKEW_MS = 60_000
const DIGEST = /^sha256:[0-9a-f]{64}$/
const POOL_ID = /^0x[0-9a-f]{64}$/i

function key(value) {
  return String(value).toLowerCase()
}

function address(value, label) {
  try {
    return getAddress(value)
  } catch {
    throw new Error(`${label} has an invalid address`)
  }
}

function integer(value, label, minimum = 0) {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < minimum) throw new Error(`${label} is invalid`)
  return parsed
}

function blockNumber(value) {
  try {
    const parsed = BigInt(String(value ?? 0))
    return parsed >= 0n ? parsed : 0n
  } catch {
    return 0n
  }
}

function normalizedPool(candidate, source) {
  const targetToken = address(candidate.tokenAddress || candidate.id, 'candidate target token')
  const poolId = String(source?.poolId || '').toLowerCase()
  if (!POOL_ID.test(poolId)) throw new Error('candidate pool id is invalid')
  if (source?.shadowEligible !== true) throw new Error('candidate pool is not search eligible')
  const poolKey = {
    currency0: address(source?.poolKey?.currency0, 'candidate pool currency0'),
    currency1: address(source?.poolKey?.currency1, 'candidate pool currency1'),
    fee: integer(source?.poolKey?.fee ?? source?.fee, 'candidate pool fee'),
    tickSpacing: integer(source?.poolKey?.tickSpacing ?? source?.tickSpacing, 'candidate pool tick spacing', 1),
    hooks: address(source?.poolKey?.hooks ?? source?.hookAddress, 'candidate pool hooks'),
  }
  if (key(poolKey.currency0) === key(poolKey.currency1)) throw new Error('candidate pool repeats a currency')
  if (pairPoolId(poolKey) !== poolId) throw new Error('candidate pool key does not match its id')
  if (![poolKey.currency0, poolKey.currency1].some((token) => key(token) === key(targetToken))) {
    throw new Error('candidate target is absent from its pool')
  }
  const quoteToken = key(poolKey.currency0) === key(targetToken) ? poolKey.currency1 : poolKey.currency0
  const executionCapability =
    source.executionAdmission === PoolAdmission.EXECUTOR_COMPATIBLE
      ? 'EXACT_EXECUTION_COMPATIBLE'
      : 'UNIVERSAL_EXACT_SIMULATION_REQUIRED'
  return {
    address: V4_POOL_MANAGER,
    poolId,
    token0: poolKey.currency0,
    token1: poolKey.currency1,
    fee: poolKey.fee,
    tickSpacing: poolKey.tickSpacing,
    hooks: poolKey.hooks,
    targetToken,
    quoteToken,
    sourceBlockNumber: blockNumber(source.sourceBlockNumber).toString(),
    source: source.sourceAdapterId || 'BOARD_CHAIN_ATTESTED_V4_POOL',
    executionCapability,
    executable: true,
  }
}

function candidateRecord(candidate, settlementSet) {
  const targetToken = address(candidate?.tokenAddress || candidate?.id, 'candidate token')
  const pools = new Map()
  for (const source of candidate?.pools || []) {
    const pool = normalizedPool({ ...candidate, tokenAddress: targetToken }, source)
    pools.set(pool.poolId, pool)
  }
  const normalizedPools = [...pools.values()].sort((left, right) => left.poolId.localeCompare(right.poolId))
  if (normalizedPools.length < GLOBAL_UNIVERSE_POLICY.minimumPoolsPerTarget) {
    throw new Error('candidate has fewer than two distinct searchable pools')
  }
  const assets = new Set([key(targetToken)])
  let directSettlementPools = 0
  let exactCompatiblePools = 0
  let executorShapePools = 0
  let latestBlock = 0n
  for (const pool of normalizedPools) {
    assets.add(key(pool.token0))
    assets.add(key(pool.token1))
    if (settlementSet.has(key(pool.quoteToken))) directSettlementPools += 1
    if (pool.executionCapability === 'EXACT_EXECUTION_COMPATIBLE') exactCompatiblePools += 1
    if (isExecutorPoolKeyShape(pool)) executorShapePools += 1
    const observedBlock = blockNumber(pool.sourceBlockNumber)
    if (observedBlock > latestBlock) latestBlock = observedBlock
  }
  return {
    targetToken,
    symbol: typeof candidate?.symbol === 'string' ? candidate.symbol.slice(0, 48) : null,
    pools: normalizedPools,
    assets,
    directSettlementPools,
    exactCompatiblePools,
    executorShapePools,
    latestBlock,
  }
}

function candidateOrder(left, right) {
  return (
    right.directSettlementPools - left.directSettlementPools ||
    right.exactCompatiblePools - left.exactCompatiblePools ||
    right.executorShapePools - left.executorShapePools ||
    (left.latestBlock === right.latestBlock ? 0 : left.latestBlock > right.latestBlock ? -1 : 1) ||
    key(left.targetToken).localeCompare(key(right.targetToken))
  )
}

function rejection(targetToken, reason) {
  let token = null
  try {
    token = getAddress(targetToken)
  } catch {}
  return { targetToken: token, reason: String(reason).slice(0, 160) }
}

function topologyPayload(projection) {
  return {
    policyVersion: projection.policy?.version,
    settlementTokens: projection.settlementTokens,
    targets: projection.targets.map((target) => ({ token: target.token, poolCount: target.poolCount })),
    assets: projection.assets,
    v4Pools: projection.v4Pools.map((pool) => ({
      address: pool.address,
      poolId: pool.poolId,
      token0: pool.token0,
      token1: pool.token1,
      fee: pool.fee,
      tickSpacing: pool.tickSpacing,
      hooks: pool.hooks,
      targetToken: pool.targetToken,
      quoteToken: pool.quoteToken,
      executionCapability: pool.executionCapability,
      executable: pool.executable,
    })),
  }
}

/**
 * Build the small, capability-labelled handoff from the board's normalized
 * multi-pool candidates. Timestamp/cursor changes are intentionally excluded
 * from the topology commitment.
 */
export function buildGlobalUniverseProjection(input = {}) {
  const generatedAt = String(input.generatedAt || new Date().toISOString())
  if (!Number.isFinite(Date.parse(generatedAt))) throw new Error('global universe generatedAt is invalid')
  if (!DIGEST.test(String(input.sourceCatalogHash || ''))) throw new Error('global universe source hash is invalid')
  const settlementTokens = [
    ...new Map(
      (input.settlementTokens || []).map((value) => {
        const token = address(value, 'settlement token')
        return [key(token), token]
      }),
    ).values(),
  ].sort((left, right) => key(left).localeCompare(key(right)))
  if (settlementTokens.length < 2 || settlementTokens.length > 16) {
    throw new Error('global universe requires 2..16 settlement tokens')
  }
  const settlementSet = new Set(settlementTokens.map(key))
  const rejected = []
  const records = []
  for (const candidate of Array.isArray(input.candidates) ? input.candidates : []) {
    try {
      records.push(candidateRecord(candidate, settlementSet))
    } catch (error) {
      rejected.push(rejection(candidate?.tokenAddress || candidate?.id, error instanceof Error ? error.message : error))
    }
  }
  records.sort(candidateOrder)
  const requestedRotationOffset = integer(input.rotationOffset || 0, 'global universe rotation offset')
  const priorityRecords = records.slice(0, GLOBAL_UNIVERSE_POLICY.priorityTargets)
  const rotatingRecords = records.slice(GLOBAL_UNIVERSE_POLICY.priorityTargets)
  const rotationOffset = rotatingRecords.length > 0 ? requestedRotationOffset % rotatingRecords.length : 0
  const rotatedRecords =
    rotatingRecords.length > 0
      ? [...rotatingRecords.slice(rotationOffset), ...rotatingRecords.slice(0, rotationOffset)]
      : []
  const selectionRecords = [...priorityRecords, ...rotatedRecords]

  const admittedAssets = new Set()
  const targets = []
  const v4Pools = []
  let capacityRejected = 0
  for (const record of selectionRecords) {
    const nextAssets = new Set([...admittedAssets, ...record.assets])
    const overCapacity =
      targets.length >= GLOBAL_UNIVERSE_POLICY.maximumTargets ||
      nextAssets.size > GLOBAL_UNIVERSE_POLICY.maximumAssets ||
      v4Pools.length + record.pools.length > GLOBAL_UNIVERSE_POLICY.maximumPools
    if (overCapacity) {
      capacityRejected += 1
      rejected.push(rejection(record.targetToken, 'bounded Global universe capacity reached'))
      continue
    }
    for (const asset of record.assets) admittedAssets.add(asset)
    targets.push({
      token: record.targetToken,
      symbol: record.symbol,
      poolCount: record.pools.length,
      directSettlementPools: record.directSettlementPools,
      exactCompatiblePools: record.exactCompatiblePools,
      executorShapePools: record.executorShapePools,
      latestBlock: record.latestBlock.toString(),
    })
    v4Pools.push(...record.pools)
  }
  const assets = [...admittedAssets]
    .map((value) => getAddress(value))
    .sort((left, right) => key(left).localeCompare(key(right)))
  const projection = {
    schemaVersion: GLOBAL_UNIVERSE_SCHEMA_VERSION,
    mode: MODE,
    policy: GLOBAL_UNIVERSE_POLICY,
    generatedAt,
    safeHead: input.safeHead === null || input.safeHead === undefined ? null : blockNumber(input.safeHead).toString(),
    sourceCatalogHash: input.sourceCatalogHash,
    settlementTokens,
    rotation: {
      offset: rotationOffset,
      priorityTargets: priorityRecords.length,
      rotatingTargets: rotatingRecords.length,
    },
    targets,
    assets,
    v4Pools,
    rejected: rejected.slice(0, GLOBAL_UNIVERSE_POLICY.maximumRejections),
    summary: {
      sourceCandidates: Array.isArray(input.candidates) ? input.candidates.length : 0,
      structurallyValidCandidates: records.length,
      priorityCandidates: priorityRecords.length,
      rotatingCandidates: rotatingRecords.length,
      selectedTargets: targets.length,
      selectedAssets: assets.length,
      selectedPools: v4Pools.length,
      exactCompatiblePools: v4Pools.filter((pool) => pool.executionCapability === 'EXACT_EXECUTION_COMPATIBLE').length,
      exactSimulationRequiredPools: v4Pools.filter(
        (pool) => pool.executionCapability === 'UNIVERSAL_EXACT_SIMULATION_REQUIRED',
      ).length,
      invalidCandidates: Math.max(0, (input.candidates?.length || 0) - records.length),
      capacityRejectedCandidates: capacityRejected,
      retainedRejectionSamples: Math.min(rejected.length, GLOBAL_UNIVERSE_POLICY.maximumRejections),
      totalRejectedCandidates: rejected.length,
    },
  }
  projection.topologyHash = stablePayloadHash(topologyPayload(projection))
  assertGlobalUniverseProjection(projection)
  return projection
}

export function assertGlobalUniverseProjection(projection) {
  if (
    !projection ||
    projection.schemaVersion !== GLOBAL_UNIVERSE_SCHEMA_VERSION ||
    projection.mode !== MODE ||
    projection.policy?.version !== GLOBAL_UNIVERSE_POLICY.version ||
    !DIGEST.test(String(projection.sourceCatalogHash || '')) ||
    !DIGEST.test(String(projection.topologyHash || '')) ||
    !Array.isArray(projection.settlementTokens) ||
    !projection.rotation ||
    !Array.isArray(projection.targets) ||
    !Array.isArray(projection.assets) ||
    !Array.isArray(projection.v4Pools) ||
    !Array.isArray(projection.rejected)
  ) {
    throw new Error('global universe envelope is invalid')
  }
  if (
    projection.policy.maximumTargets !== GLOBAL_UNIVERSE_POLICY.maximumTargets ||
    projection.policy.maximumAssets !== GLOBAL_UNIVERSE_POLICY.maximumAssets ||
    projection.policy.maximumPools !== GLOBAL_UNIVERSE_POLICY.maximumPools ||
    projection.policy.maximumRejections !== GLOBAL_UNIVERSE_POLICY.maximumRejections ||
    projection.policy.minimumPoolsPerTarget !== GLOBAL_UNIVERSE_POLICY.minimumPoolsPerTarget ||
    projection.policy.priorityTargets !== GLOBAL_UNIVERSE_POLICY.priorityTargets ||
    !Number.isSafeInteger(projection.rotation.offset) ||
    projection.rotation.offset < 0 ||
    !Number.isSafeInteger(projection.rotation.priorityTargets) ||
    projection.rotation.priorityTargets < 0 ||
    projection.rotation.priorityTargets > GLOBAL_UNIVERSE_POLICY.priorityTargets ||
    !Number.isSafeInteger(projection.rotation.rotatingTargets) ||
    projection.rotation.rotatingTargets < 0 ||
    (projection.rotation.rotatingTargets === 0 && projection.rotation.offset !== 0) ||
    (projection.rotation.rotatingTargets > 0 && projection.rotation.offset >= projection.rotation.rotatingTargets) ||
    projection.targets.length > GLOBAL_UNIVERSE_POLICY.maximumTargets ||
    projection.assets.length > GLOBAL_UNIVERSE_POLICY.maximumAssets ||
    projection.v4Pools.length > GLOBAL_UNIVERSE_POLICY.maximumPools ||
    projection.rejected.length > GLOBAL_UNIVERSE_POLICY.maximumRejections
  ) {
    throw new Error('global universe exceeds a policy bound')
  }
  const assets = new Set(projection.assets.map((value) => key(address(value, 'global universe asset'))))
  if (assets.size !== projection.assets.length) throw new Error('global universe repeats an asset')
  const poolIds = new Set()
  for (const source of projection.v4Pools) {
    const normalized = normalizedPool(
      { tokenAddress: source.targetToken },
      {
        poolId: source.poolId,
        poolKey: {
          currency0: source.token0,
          currency1: source.token1,
          fee: source.fee,
          tickSpacing: source.tickSpacing,
          hooks: source.hooks,
        },
        shadowEligible: true,
        executionAdmission:
          source.executionCapability === 'EXACT_EXECUTION_COMPATIBLE'
            ? PoolAdmission.EXECUTOR_COMPATIBLE
            : PoolAdmission.SHADOW_ONLY_UNSUPPORTED_HOOK,
        sourceBlockNumber: source.sourceBlockNumber,
        sourceAdapterId: source.source,
      },
    )
    if (poolIds.has(normalized.poolId)) throw new Error('global universe repeats a pool')
    poolIds.add(normalized.poolId)
    if (!assets.has(key(normalized.token0)) || !assets.has(key(normalized.token1))) {
      throw new Error('global universe pool references an absent asset')
    }
  }
  if (stablePayloadHash(topologyPayload(projection)) !== projection.topologyHash) {
    throw new Error('global universe topology hash mismatch')
  }
  return projection
}

export function classifyGlobalUniverseAccess(projection, { now = Date.now() } = {}) {
  if (!projection) return 'MISSING'
  try {
    assertGlobalUniverseProjection(projection)
  } catch {
    return 'INVALID'
  }
  const generatedAt = Date.parse(projection.generatedAt)
  const age = now - generatedAt
  if (
    !Number.isFinite(now) ||
    !Number.isFinite(generatedAt) ||
    age < -MAXIMUM_CLOCK_SKEW_MS ||
    age > GLOBAL_UNIVERSE_MAX_AGE_MS
  ) {
    return 'STALE'
  }
  return 'CURRENT'
}

/**
 * Read the board-owned handoff without letting a missing, writable, oversized
 * or malformed file interrupt the signer supervisor. Only a fully current
 * projection is returned to callers.
 */
export function readGlobalUniverseFile(file, { now = Date.now() } = {}) {
  try {
    const metadata = fs.lstatSync(file)
    if (
      !metadata.isFile() ||
      metadata.size <= 0 ||
      metadata.size > GLOBAL_UNIVERSE_MAX_FILE_BYTES ||
      (metadata.mode & 0o022) !== 0
    ) {
      return { status: 'INVALID', projection: null }
    }
    const projection = JSON.parse(fs.readFileSync(file, 'utf8'))
    const status = classifyGlobalUniverseAccess(projection, { now })
    return { status, projection: status === 'CURRENT' ? projection : null }
  } catch (error) {
    return {
      status: /** @type {NodeJS.ErrnoException} */ (error)?.code === 'ENOENT' ? 'MISSING' : 'INVALID',
      projection: null,
    }
  }
}

function baseGraphCapacity(earnPools, uniswap) {
  const assets = new Set()
  let directedEdges = 0
  for (const pool of earnPools || []) {
    try {
      assets.add(key(address(pool.address, 'Earn pool')))
      const tokens = (pool.tokens || []).map((token) => address(token.address || token, 'Earn token'))
      for (const token of tokens) assets.add(key(token))
      directedEdges += tokens.length * Math.max(0, tokens.length - 1)
    } catch {}
  }
  for (const source of [...(uniswap?.v2Pools || []), ...(uniswap?.v3Pools || []), ...(uniswap?.v4Pools || [])]) {
    try {
      assets.add(key(address(source.token0, 'Uniswap token0')))
      assets.add(key(address(source.token1, 'Uniswap token1')))
      directedEdges += 2
    } catch {}
  }
  return { assets, directedEdges }
}

/** Merge complete candidate groups while retaining the outer graph bounds. */
export function mergeGlobalUniverseProjection({
  earnPools = [],
  uniswap,
  projection,
  maximumAssets,
  maximumSwapEdges,
}) {
  assertGlobalUniverseProjection(projection)
  const assetsLimit = integer(maximumAssets, 'global graph asset bound', 1)
  const edgesLimit = integer(maximumSwapEdges, 'global graph edge bound', 2)
  const capacity = baseGraphCapacity(earnPools, uniswap)
  const byPoolId = new Map((uniswap?.v4Pools || []).map((pool) => [key(pool.poolId), pool]))
  const groups = new Map()
  for (const pool of projection.v4Pools) {
    const target = key(pool.targetToken)
    const group = groups.get(target) || []
    group.push(pool)
    groups.set(target, group)
  }
  let admittedTargets = 0
  let admittedPools = 0
  let capacityRejectedTargets = 0
  for (const target of projection.targets.map((item) => key(item.token))) {
    const group = (groups.get(target) || []).filter((pool) => !byPoolId.has(key(pool.poolId)))
    if (group.length === 0) continue
    const nextAssets = new Set(capacity.assets)
    for (const pool of group) {
      nextAssets.add(key(pool.token0))
      nextAssets.add(key(pool.token1))
    }
    if (nextAssets.size > assetsLimit || capacity.directedEdges + group.length * 2 > edgesLimit) {
      capacityRejectedTargets += 1
      continue
    }
    capacity.assets = nextAssets
    capacity.directedEdges += group.length * 2
    for (const pool of group) byPoolId.set(key(pool.poolId), pool)
    admittedTargets += 1
    admittedPools += group.length
  }
  return {
    uniswap: {
      ...(uniswap || {}),
      v4Pools: [...byPoolId.values()],
      universeTopologyHash: projection.topologyHash,
    },
    universe: {
      policy: GLOBAL_UNIVERSE_POLICY.version,
      topologyHash: projection.topologyHash,
      sourceCatalogHash: projection.sourceCatalogHash,
      safeHead: projection.safeHead,
      selectedTargets: projection.targets.length,
      selectedPools: projection.v4Pools.length,
      admittedTargets,
      admittedPools,
      capacityRejectedTargets,
      projectedAssets: projection.assets.length,
      graphAssetsAfterMerge: capacity.assets.size,
      graphDirectedEdgesAfterMerge: capacity.directedEdges,
    },
  }
}
