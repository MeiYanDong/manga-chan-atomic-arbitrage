import { decodeAbiParameters, getAddress } from 'viem'
import {
  ContractRole,
  EvidenceKind,
  PlatformId,
  ProtocolId,
  SOURCE_CONTRACT_REGISTRY,
  VenueId,
  stablePayloadHash,
} from './source-provenance.mjs'

export const LONG_LAUNCH_CREATED_TOPIC = '0xadc6f1f726f7c710f77ec06adc75f3bb964e5be19581b072c67f7b9b4039267b'
export const DOPPLER_CREATE_TOPIC = '0x68ff1cfcdcf76864161555fc0de1878d8f83ec6949bf351df74d8a4a1a2679ab'
export const SOURCE_CATALOG_SCHEMA_VERSION = 5
export const SOURCE_CATALOG_PROJECTION_VERSION = 1

export const SourceFactKind = Object.freeze({
  LONG_LAUNCH: 'LONG_LAUNCH',
  DOPPLER_LAUNCH: 'DOPPLER_LAUNCH',
  POOL: 'POOL',
  UNKNOWN: 'UNKNOWN',
})

const SOURCE_FACT_FIELDS = Object.freeze({
  [SourceFactKind.LONG_LAUNCH]: Object.freeze(['asset', 'numeraire', 'normalizedTicker', 'blockNumber', 'evidenceId']),
  [SourceFactKind.DOPPLER_LAUNCH]: Object.freeze(['asset', 'numeraire', 'blockNumber', 'evidenceId']),
  [SourceFactKind.POOL]: Object.freeze([
    'poolId',
    'currency0',
    'currency1',
    'fee',
    'tickSpacing',
    'hooks',
    'blockNumber',
    'evidenceId',
  ]),
})

const SOURCE_FACT_REQUIRED_FIELDS = Object.freeze({
  [SourceFactKind.LONG_LAUNCH]: Object.freeze(['asset', 'numeraire', 'blockNumber', 'evidenceId']),
  [SourceFactKind.DOPPLER_LAUNCH]: Object.freeze(['asset', 'numeraire', 'blockNumber', 'evidenceId']),
  [SourceFactKind.POOL]: SOURCE_FACT_FIELDS[SourceFactKind.POOL],
})

const DOPPLER_TARGET_FIELDS = Object.freeze(['asset', 'numeraire', 'blockNumber', 'evidenceId'])
const SOURCE_FACT_FIELD_SETS = Object.freeze(
  Object.fromEntries(Object.entries(SOURCE_FACT_FIELDS).map(([kind, fields]) => [kind, new Set(fields)])),
)
const DOPPLER_TARGET_FIELD_SET = new Set(DOPPLER_TARGET_FIELDS)

export const SOURCE_CATALOG_RUNTIME_PROJECTION = Object.freeze({
  version: SOURCE_CATALOG_PROJECTION_VERSION,
  factShape: 'EVIDENCE_LINKED_ROUTE_MINIMUM',
  chainEvidenceStore: 'APPEND_ONLY_JSONL_AND_SQLITE',
  dopplerLaunchDetails: 'DERIVED_FROM_TARGET_INDEX',
})

export const AdapterRunStatus = Object.freeze({
  NOT_ATTEMPTED: 'NOT_ATTEMPTED',
  RUNNING: 'RUNNING',
  CURRENT: 'CURRENT',
  PARTIAL: 'PARTIAL',
  BACKFILL_PARTIAL: 'BACKFILL_PARTIAL',
  COMPLETE_FROM_CONFIGURED_START: 'COMPLETE_FROM_CONFIGURED_START',
  STALE: 'STALE',
  ERROR: 'ERROR',
})

const unsupportedExecution = Object.freeze({
  simulation: 'unsupported',
  calldata: 'unsupported',
  sign: 'unsupported',
  broadcast: 'unsupported',
  reconcile: 'unsupported',
  exit: 'unsupported',
})

export const SOURCE_ADAPTER_MANIFESTS = Object.freeze([
  Object.freeze({
    adapterId: 'pair.catalog.v1',
    label: 'PAIR catalog',
    claimScope: 'LISTING_METADATA_ONLY',
    capabilities: Object.freeze({
      transport: 'implemented',
      discovery: 'implemented',
      identity: 'implemented',
      quote: 'unsupported',
      replay: 'implemented',
      ...unsupportedExecution,
    }),
  }),
  Object.freeze({
    adapterId: 'long.launcher.v1',
    label: 'LongLauncher',
    claimScope: 'LONG_ROUTE_FROM_REGISTERED_ENTRY_AND_EVENT',
    capabilities: Object.freeze({
      transport: 'implemented',
      discovery: 'implemented',
      identity: 'implemented',
      quote: 'unsupported',
      replay: 'implemented',
      ...unsupportedExecution,
    }),
  }),
  Object.freeze({
    adapterId: 'doppler.registry.v1',
    label: 'Doppler protocol',
    claimScope: 'PROTOCOL_COMPONENTS_ONLY',
    capabilities: Object.freeze({
      transport: 'implemented',
      discovery: 'implemented',
      identity: 'implemented',
      quote: 'unsupported',
      replay: 'implemented',
      ...unsupportedExecution,
    }),
  }),
  Object.freeze({
    adapterId: 'pair.chain-catalog.v1',
    label: 'PAIR chain catalog',
    claimScope: 'PAIR_HOOK_POOL_INITIALIZE_FACTS_ONLY',
    capabilities: Object.freeze({
      transport: 'implemented',
      discovery: 'implemented',
      identity: 'implemented',
      quote: 'unsupported',
      replay: 'implemented',
      ...unsupportedExecution,
    }),
  }),
  Object.freeze({
    adapterId: 'uniswap-v4.pool-manager.v1',
    label: 'Uniswap v4 PoolManager',
    claimScope: 'SOURCE_TARGET_POOL_INITIALIZE_AND_SWAP_FACTS',
    capabilities: Object.freeze({
      transport: 'implemented',
      discovery: 'implemented',
      identity: 'implemented',
      quote: 'implemented',
      replay: 'implemented',
      ...unsupportedExecution,
    }),
  }),
  Object.freeze({
    adapterId: 'robinhood.assets.v1',
    label: 'Robinhood asset registry',
    claimScope: 'CANONICAL_STOCK_ADDRESS_CLASSIFICATION',
    capabilities: Object.freeze({
      transport: 'implemented',
      discovery: 'unsupported',
      identity: 'implemented',
      quote: 'unsupported',
      replay: 'implemented',
      ...unsupportedExecution,
    }),
  }),
])

export function sanitizeAdapterError(error) {
  return String(error?.message || error || 'unknown adapter error')
    .replace(/(?:https?|wss):\/\/[^\s"')]+/gi, '[redacted-endpoint]')
    .replace(/\b(?:0x)?[0-9a-f]{64}\b/gi, '[redacted-64-byte-value]')
    .replace(/\s+/g, ' ')
    .slice(0, 280)
}

export function createAdapterStates({ configuredStartBlock = null } = {}) {
  return Object.fromEntries(
    SOURCE_ADAPTER_MANIFESTS.map((manifest) => [
      manifest.adapterId,
      {
        ...manifest,
        status: AdapterRunStatus.NOT_ATTEMPTED,
        lastAttemptAt: null,
        lastSuccessAt: null,
        lagBlocks: null,
        configuredStartBlock: configuredStartBlock === null ? null : String(configuredStartBlock),
        scannedThroughBlock: null,
        safeHead: null,
        lastError: null,
        observations: 0,
      },
    ]),
  )
}

export function restoreAdapterStates(raw, options = {}) {
  const baseline = createAdapterStates(options)
  for (const [adapterId, state] of Object.entries(raw || {})) {
    if (!baseline[adapterId]) continue
    baseline[adapterId] = { ...baseline[adapterId], ...state, capabilities: baseline[adapterId].capabilities }
  }
  return baseline
}

export function markAdapterAttempt(state, at = new Date().toISOString()) {
  return { ...state, status: AdapterRunStatus.RUNNING, lastAttemptAt: at, lastError: null }
}

export function markAdapterSuccess(state, result = {}, at = new Date().toISOString()) {
  const status = result.status || AdapterRunStatus.CURRENT
  const safeHead = result.safeHead === null || result.safeHead === undefined ? state.safeHead : String(result.safeHead)
  const scannedThroughBlock =
    result.scannedThroughBlock === null || result.scannedThroughBlock === undefined
      ? state.scannedThroughBlock
      : String(result.scannedThroughBlock)
  const lagBlocks =
    safeHead !== null && scannedThroughBlock !== null
      ? Number(
          BigInt(safeHead) - BigInt(scannedThroughBlock) > 0n ? BigInt(safeHead) - BigInt(scannedThroughBlock) : 0n,
        )
      : (result.lagBlocks ?? null)
  return {
    ...state,
    status,
    lastAttemptAt: at,
    lastSuccessAt: at,
    safeHead,
    scannedThroughBlock,
    lagBlocks,
    lastError: null,
    observations: state.observations + Number(result.observations || 0),
  }
}

export function markAdapterError(state, error, at = new Date().toISOString()) {
  return {
    ...state,
    status: AdapterRunStatus.ERROR,
    lastAttemptAt: at,
    lastError: sanitizeAdapterError(error),
  }
}

function topicAddress(topic, field) {
  if (typeof topic !== 'string' || !/^0x[0-9a-f]{64}$/i.test(topic)) throw new Error(`invalid ${field} topic`)
  return getAddress(`0x${topic.slice(-40)}`)
}

function logPosition(log) {
  return Number(BigInt(log.logIndex ?? 0))
}

function blockString(log) {
  if (log.blockNumber === null || log.blockNumber === undefined) throw new Error('source log has no block number')
  return BigInt(log.blockNumber).toString()
}

function sourceEvidence(log, { chainId, producer, payload }) {
  const blockNumber = blockString(log)
  const logIndex = logPosition(log)
  const evidenceId = `rh:${chainId}:log:${String(log.transactionHash).toLowerCase()}:${logIndex}`
  return {
    evidenceId,
    kind: EvidenceKind.RECEIPT_LOG,
    producer,
    observedAt: new Date().toISOString(),
    chainId,
    blockNumber,
    blockHash: log.blockHash || null,
    transactionHash: log.transactionHash || null,
    payloadHash: stablePayloadHash(payload),
    status: 'OBSERVED',
    payload,
  }
}

export function decodeLongLauncherLog(log, { chainId = 4663 } = {}) {
  const longEntry = SOURCE_CONTRACT_REGISTRY.entries.find(
    (entry) => entry.role === ContractRole.UNIQUE_PLATFORM_ENTRY && entry.platformId === PlatformId.LONG_ROUTE,
  )
  if (getAddress(log.address) !== longEntry.address) return null
  if (String(log.topics?.[0] || '').toLowerCase() !== LONG_LAUNCH_CREATED_TOPIC) return null
  if (log.topics.length !== 4) throw new Error('LongLauncher log must have three indexed arguments')
  const [poolInitializer, launcher, tickerKey, deployedAt, reservedUntil, normalizedTicker] = decodeAbiParameters(
    [
      { type: 'address' },
      { type: 'address' },
      { type: 'bytes32' },
      { type: 'uint256' },
      { type: 'uint256' },
      { type: 'string' },
    ],
    log.data,
  )
  const result = {
    adapterId: 'long.launcher.v1',
    platformId: PlatformId.LONG_ROUTE,
    attributionStatus: 'CHAIN_ATTESTED',
    entryContract: longEntry.address,
    eventTopic: LONG_LAUNCH_CREATED_TOPIC,
    poolOrHook: topicAddress(log.topics[1], 'poolOrHook'),
    asset: topicAddress(log.topics[2], 'asset'),
    numeraire: topicAddress(log.topics[3], 'numeraire'),
    poolInitializer: getAddress(poolInitializer),
    launcher: getAddress(launcher),
    tickerKey,
    deployedAt: deployedAt.toString(),
    reservedUntil: reservedUntil.toString(),
    normalizedTicker,
    blockNumber: blockString(log),
    blockHash: log.blockHash || null,
    transactionHash: log.transactionHash || null,
    logIndex: logPosition(log),
  }
  return {
    ...result,
    evidence: sourceEvidence(log, { chainId, producer: 'LONG_LAUNCHER_LOG_ADAPTER', payload: result }),
  }
}

export function decodeDopplerCreateLog(log, { chainId = 4663 } = {}) {
  const airlock = SOURCE_CONTRACT_REGISTRY.entries.find(
    (entry) => entry.role === ContractRole.SHARED_PROTOCOL_ROOT && entry.protocolId === ProtocolId.DOPPLER,
  )
  if (getAddress(log.address) !== airlock.address) return null
  if (String(log.topics?.[0] || '').toLowerCase() !== DOPPLER_CREATE_TOPIC) return null
  if (log.topics.length !== 2) throw new Error('Doppler Create log must have one indexed argument')
  const [asset, poolOrHook, governance] = decodeAbiParameters(
    [{ type: 'address' }, { type: 'address' }, { type: 'address' }],
    log.data,
  )
  const result = {
    adapterId: 'doppler.registry.v1',
    protocolId: ProtocolId.DOPPLER,
    attributionStatus: 'CHAIN_ATTESTED',
    protocolRoot: airlock.address,
    numeraire: topicAddress(log.topics[1], 'numeraire'),
    asset: getAddress(asset),
    poolOrHook: getAddress(poolOrHook),
    governance: getAddress(governance),
    blockNumber: blockString(log),
    blockHash: log.blockHash || null,
    transactionHash: log.transactionHash || null,
    logIndex: logPosition(log),
  }
  return {
    ...result,
    evidence: sourceEvidence(log, { chainId, producer: 'DOPPLER_CREATE_LOG_ADAPTER', payload: result }),
  }
}

export function adaptPoolManagerInitialize(event, { chainId = 4663 } = {}) {
  if (event?.type !== 'V4_INITIALIZE') return null
  const manager = SOURCE_CONTRACT_REGISTRY.entries.find((entry) => entry.role === ContractRole.POOL_MANAGER)
  const payload = {
    adapterId: 'uniswap-v4.pool-manager.v1',
    venueId: VenueId.UNISWAP_V4,
    attributionStatus: 'CHAIN_ATTESTED',
    poolManager: manager.address,
    poolId: event.poolId,
    currency0: event.currency0,
    currency1: event.currency1,
    fee: event.fee,
    tickSpacing: event.tickSpacing,
    hooks: event.hooks,
    blockNumber: event.blockNumber.toString(),
    blockHash: event.blockHash,
    transactionHash: event.transactionHash,
    logIndex: event.logIndex,
  }
  const evidenceId = `rh:${chainId}:log:${String(event.transactionHash).toLowerCase()}:${event.logIndex}`
  return {
    ...payload,
    evidence: {
      evidenceId,
      kind: EvidenceKind.RECEIPT_LOG,
      producer: 'UNISWAP_V4_POOL_MANAGER_ADAPTER',
      observedAt: new Date().toISOString(),
      chainId,
      blockNumber: payload.blockNumber,
      blockHash: payload.blockHash,
      transactionHash: payload.transactionHash,
      payloadHash: stablePayloadHash(payload),
      status: 'OBSERVED',
      payload,
    },
  }
}

export function adaptPairCatalogToken(token, { evidenceId, observedAt }) {
  if (!token?.address || !evidenceId) throw new Error('PAIR listing requires token address and evidenceId')
  return {
    adapterId: 'pair.catalog.v1',
    claim: 'LISTED_BY_PAIR_API',
    platformId: PlatformId.PAIR,
    targetAddress: getAddress(token.address),
    observedAt,
    evidenceIds: [evidenceId],
  }
}

export function adaptRobinhoodAssets(payload, { chainId = 4663, evidenceId, observedAt }) {
  const addresses = []
  for (const asset of payload?.assets || []) {
    if (asset?.status !== 'ASSET_STATUS_ACTIVE') continue
    for (const deployment of asset.deployments || []) {
      if (Number(deployment.chainId) !== chainId || !deployment.contractAddress) continue
      addresses.push(getAddress(deployment.contractAddress))
    }
  }
  const uniqueAddresses = [...new Set(addresses.map((item) => item.toLowerCase()))].map((item) => getAddress(item))
  return {
    adapterId: 'robinhood.assets.v1',
    evidenceId,
    observedAt,
    chainId,
    addresses: uniqueAddresses,
  }
}

export function mergeSourceFacts(existing, discovered, key) {
  const output = new Map((existing || []).map((item) => [key(item), item]))
  for (const item of discovered || []) {
    const id = key(item)
    const before = output.get(id)
    output.set(id, before ? { ...before, ...item, evidence: item.evidence || before.evidence } : item)
  }
  return [...output.values()].sort((left, right) => {
    const blockOrder = BigInt(left.blockNumber) - BigInt(right.blockNumber)
    if (blockOrder !== 0n) return blockOrder < 0n ? -1 : 1
    return Number(left.logIndex || 0) - Number(right.logIndex || 0)
  })
}

function addSourceTarget(output, value) {
  if (!value) return
  try {
    const normalized = getAddress(value)
    if (normalized !== '0x0000000000000000000000000000000000000000') output.add(normalized.toLowerCase())
  } catch {
    // Invalid source facts are ignored here and remain visible to their owning adapter as decode errors.
  }
}

export function sourceTargetAddresses({
  pairListings = [],
  longLaunches = [],
  dopplerLaunches = [],
  dopplerTargetIndex = [],
} = {}) {
  const output = new Set()
  for (const listing of pairListings) addSourceTarget(output, listing.targetAddress)
  for (const launch of longLaunches) addSourceTarget(output, launch.asset)
  for (const launch of dopplerLaunches) addSourceTarget(output, launch.asset)
  for (const target of dopplerTargetIndex) addSourceTarget(output, target.asset || target)
  return output
}

export function retainPoolsForSourceTargets(pools, targetAddresses) {
  const targets = new Set()
  for (const value of targetAddresses || []) addSourceTarget(targets, value)
  return (pools || []).filter((pool) => {
    const currency0 = String(pool?.currency0 || '').toLowerCase()
    const currency1 = String(pool?.currency1 || '').toLowerCase()
    return targets.has(currency0) || targets.has(currency1)
  })
}

export function sourceFactEvidenceId(fact) {
  return fact?.evidenceId || fact?.evidence?.evidenceId || null
}

/** @param {Record<string, any>} fact @param {string} [requestedKind] */
function inferSourceFactKind(fact, requestedKind = SourceFactKind.UNKNOWN) {
  if (requestedKind !== SourceFactKind.UNKNOWN) return requestedKind
  if (fact?.adapterId === 'long.launcher.v1' || fact?.entryContract) return SourceFactKind.LONG_LAUNCH
  if (fact?.adapterId === 'doppler.registry.v1' || fact?.protocolRoot) return SourceFactKind.DOPPLER_LAUNCH
  if (fact?.adapterId === 'uniswap-v4.pool-manager.v1' || fact?.poolId) return SourceFactKind.POOL
  return SourceFactKind.UNKNOWN
}

function assertProjectedSourceFact(fact, kind) {
  for (const field of SOURCE_FACT_REQUIRED_FIELDS[kind] || []) {
    if (!Object.hasOwn(fact, field) || fact[field] === null || fact[field] === undefined || fact[field] === '') {
      throw new Error(`${kind} source fact is missing ${field}`)
    }
  }
  for (const field of ['asset', 'numeraire', 'currency0', 'currency1', 'hooks']) {
    if (fact[field] !== null && fact[field] !== undefined) getAddress(fact[field])
  }
  if (kind === SourceFactKind.POOL && !/^0x[0-9a-f]{64}$/i.test(String(fact.poolId))) {
    throw new Error('POOL source fact has an invalid poolId')
  }
  if (!/^rh:\d+:log:0x[0-9a-f]{64}:\d+$/i.test(String(fact.evidenceId))) {
    throw new Error(`${kind} source fact has an invalid evidenceId`)
  }
  if (!/^\d+$/.test(String(fact.blockNumber))) throw new Error(`${kind} source fact has an invalid blockNumber`)
  return fact
}

function compactKnownSourceFact(fact, kind) {
  const evidenceId = sourceFactEvidenceId(fact)
  const output = {}
  for (const field of SOURCE_FACT_FIELDS[kind]) {
    const value = field === 'evidenceId' ? evidenceId : fact[field]
    if (value !== undefined) output[field] = value
  }
  return assertProjectedSourceFact(output, kind)
}

/** @param {Record<string, any>} fact @param {string} [requestedKind] */
export function compactSourceFact(fact, requestedKind = SourceFactKind.UNKNOWN) {
  if (!fact || typeof fact !== 'object') return fact
  const kind = inferSourceFactKind(fact, requestedKind)
  if (kind !== SourceFactKind.UNKNOWN) return compactKnownSourceFact(fact, kind)
  const evidenceId = sourceFactEvidenceId(fact)
  const payload = { ...fact }
  delete payload.evidence
  return evidenceId ? { ...payload, evidenceId } : payload
}

function compactKnownSourceFactInPlace(fact, kind) {
  const evidenceId = sourceFactEvidenceId(fact)
  const allowed = SOURCE_FACT_FIELD_SETS[kind]
  let removedFields = 0
  for (const field of Object.keys(fact)) {
    if (allowed.has(field)) continue
    delete fact[field]
    removedFields += 1
  }
  if (fact.evidenceId !== evidenceId) {
    fact.evidenceId = evidenceId
    removedFields += 1
  }
  assertProjectedSourceFact(fact, kind)
  return removedFields
}

export function dopplerTargetFact(fact) {
  const compact = compactSourceFact(fact)
  return {
    asset: compact.asset,
    numeraire: compact.numeraire || null,
    blockNumber: compact.blockNumber,
    evidenceId: compact.evidenceId || null,
  }
}

export function mergeDopplerTargetFacts(existing, discovered) {
  const output = new Map()
  for (const facts of [existing || [], discovered || []]) {
    for (const fact of facts) {
      const compact = dopplerTargetFact(fact)
      if (!compact.asset) continue
      const key = getAddress(compact.asset).toLowerCase()
      const previous = output.get(key)
      if (!previous || BigInt(compact.blockNumber) < BigInt(previous.blockNumber)) output.set(key, compact)
    }
  }
  return [...output.values()].sort((left, right) => {
    const blockOrder = BigInt(left.blockNumber) - BigInt(right.blockNumber)
    if (blockOrder !== 0n) return blockOrder < 0n ? -1 : 1
    return left.asset.toLowerCase().localeCompare(right.asset.toLowerCase())
  })
}

function sameStringSet(left, right) {
  return left.size === right.size && [...left].every((value) => right.has(value))
}

function compactDopplerTargetInPlace(target) {
  const compact = dopplerTargetFact(target)
  let removedFields = 0
  for (const field of Object.keys(target)) {
    if (DOPPLER_TARGET_FIELD_SET.has(field)) continue
    delete target[field]
    removedFields += 1
  }
  for (const [field, value] of Object.entries(compact)) {
    if (target[field] === value) continue
    target[field] = value
    removedFields += 1
  }
  assertProjectedSourceFact(target, SourceFactKind.DOPPLER_LAUNCH)
  return removedFields
}

export function isCompactSourceCatalogProjection(sourceCatalog) {
  return Boolean(
    sourceCatalog &&
    sourceCatalog.schemaVersion === SOURCE_CATALOG_SCHEMA_VERSION &&
    sourceCatalog.runtimeProjection?.version === SOURCE_CATALOG_PROJECTION_VERSION &&
    !Object.hasOwn(sourceCatalog, 'dopplerLaunches'),
  )
}

export function assertCompactSourceCatalogProjection(sourceCatalog) {
  if (!isCompactSourceCatalogProjection(sourceCatalog)) {
    throw new Error('source catalog runtime projection is not current')
  }
  for (const fact of sourceCatalog.longLaunches || []) {
    assertProjectedSourceFact(fact, SourceFactKind.LONG_LAUNCH)
    const allowed = SOURCE_FACT_FIELD_SETS[SourceFactKind.LONG_LAUNCH]
    if (Object.keys(fact).some((field) => !allowed.has(field))) throw new Error('LONG_LAUNCH fact is not compact')
  }
  for (const fact of sourceCatalog.dopplerTargetIndex || []) {
    assertProjectedSourceFact(fact, SourceFactKind.DOPPLER_LAUNCH)
    if (Object.keys(fact).some((field) => !DOPPLER_TARGET_FIELD_SET.has(field))) {
      throw new Error('DOPPLER target fact is not compact')
    }
  }
  for (const fact of sourceCatalog.pools || []) {
    assertProjectedSourceFact(fact, SourceFactKind.POOL)
    const allowed = SOURCE_FACT_FIELD_SETS[SourceFactKind.POOL]
    if (Object.keys(fact).some((field) => !allowed.has(field))) throw new Error('POOL fact is not compact')
  }
  return {
    schemaVersion: sourceCatalog.schemaVersion,
    projectionVersion: sourceCatalog.runtimeProjection.version,
    longLaunches: sourceCatalog.longLaunches?.length || 0,
    dopplerTargets: sourceCatalog.dopplerTargetIndex?.length || 0,
    pools: sourceCatalog.pools?.length || 0,
  }
}

/**
 * Convert the restart projection in place so a production-sized legacy catalog
 * never needs a second full object graph. Full receipt-log payloads have already
 * been committed to BoardStore before facts enter this projection.
 */
export function compactSourceCatalogProjectionInPlace(sourceCatalog) {
  if (!sourceCatalog || typeof sourceCatalog !== 'object' || Array.isArray(sourceCatalog)) {
    throw new Error('source catalog must be an object')
  }
  const longLaunches = Array.isArray(sourceCatalog.longLaunches) ? sourceCatalog.longLaunches : []
  const dopplerLaunches = Array.isArray(sourceCatalog.dopplerLaunches) ? sourceCatalog.dopplerLaunches : []
  const dopplerTargetIndex = Array.isArray(sourceCatalog.dopplerTargetIndex) ? sourceCatalog.dopplerTargetIndex : []
  const pools = Array.isArray(sourceCatalog.pools) ? sourceCatalog.pools : []
  const targetsBefore = sourceTargetAddresses({
    pairListings: sourceCatalog.pairListings,
    longLaunches,
    dopplerLaunches,
    dopplerTargetIndex,
  })
  const countsBefore = {
    longLaunches: longLaunches.length,
    dopplerLaunchDetails: dopplerLaunches.length,
    dopplerTargets: dopplerTargetIndex.length,
    pools: pools.length,
  }
  const oldSchemaVersion = sourceCatalog.schemaVersion ?? null
  const oldProjectionVersion = sourceCatalog.runtimeProjection?.version ?? null
  let removedFields = 0

  for (const fact of longLaunches) {
    removedFields += compactKnownSourceFactInPlace(fact, SourceFactKind.LONG_LAUNCH)
  }
  for (const fact of pools) removedFields += compactKnownSourceFactInPlace(fact, SourceFactKind.POOL)
  for (const target of dopplerTargetIndex) removedFields += compactDopplerTargetInPlace(target)

  const indexedDopplerTargets = new Set(dopplerTargetIndex.map((target) => getAddress(target.asset).toLowerCase()))
  for (const launch of dopplerLaunches) {
    const compact = dopplerTargetFact(launch)
    const key = getAddress(compact.asset).toLowerCase()
    if (indexedDopplerTargets.has(key)) continue
    assertProjectedSourceFact(compact, SourceFactKind.DOPPLER_LAUNCH)
    dopplerTargetIndex.push(compact)
    indexedDopplerTargets.add(key)
  }
  if (Object.hasOwn(sourceCatalog, 'dopplerLaunches')) delete sourceCatalog.dopplerLaunches
  dopplerTargetIndex.sort((left, right) => {
    const blockOrder = BigInt(left.blockNumber) - BigInt(right.blockNumber)
    if (blockOrder !== 0n) return blockOrder < 0n ? -1 : 1
    return left.asset.toLowerCase().localeCompare(right.asset.toLowerCase())
  })

  sourceCatalog.schemaVersion = SOURCE_CATALOG_SCHEMA_VERSION
  sourceCatalog.runtimeProjection = { ...SOURCE_CATALOG_RUNTIME_PROJECTION }
  sourceCatalog.longLaunches = longLaunches
  sourceCatalog.dopplerTargetIndex = dopplerTargetIndex
  sourceCatalog.pools = pools
  sourceCatalog.summary = {
    ...(sourceCatalog.summary || {}),
    longLaunches: longLaunches.length,
    dopplerTargetsDiscovered: dopplerTargetIndex.length,
    genericPools: pools.length,
    persistedDopplerLaunchDetails: 0,
  }

  const targetsAfter = sourceTargetAddresses({
    pairListings: sourceCatalog.pairListings,
    longLaunches,
    dopplerTargetIndex,
  })
  if (!sameStringSet(targetsBefore, targetsAfter)) {
    throw new Error('source catalog compaction changed the discovered target set')
  }
  if (longLaunches.length !== countsBefore.longLaunches || pools.length !== countsBefore.pools) {
    throw new Error('source catalog compaction changed a retained collection count')
  }
  const verification = assertCompactSourceCatalogProjection(sourceCatalog)
  return {
    sourceCatalog,
    changed:
      removedFields > 0 ||
      countsBefore.dopplerLaunchDetails > 0 ||
      oldSchemaVersion !== SOURCE_CATALOG_SCHEMA_VERSION ||
      oldProjectionVersion !== SOURCE_CATALOG_PROJECTION_VERSION,
    stats: {
      ...verification,
      sourceTargets: targetsAfter.size,
      dopplerLaunchDetailsRemoved: countsBefore.dopplerLaunchDetails,
      removedFields,
      oldSchemaVersion,
      oldProjectionVersion,
    },
  }
}

function dopplerVisibilityPredicate({
  dopplerTargetIndex = [],
  pools = [],
  pairListings = [],
  longLaunches = [],
  poolCursor,
}) {
  const indexAssets = new Set(dopplerTargetIndex.map((target) => target.asset.toLowerCase()))
  const poolCounts = new Map()
  for (const pool of pools) {
    for (const currency of [pool.currency0, pool.currency1]) {
      const key = String(currency || '').toLowerCase()
      if (indexAssets.has(key)) poolCounts.set(key, Number(poolCounts.get(key) || 0) + 1)
    }
  }
  const explicitlyVisible = sourceTargetAddresses({ pairListings, longLaunches })
  const nextPoolBlock = BigInt(poolCursor)
  return (target) => {
    const key = target.asset.toLowerCase()
    const pendingPoolScan = BigInt(target.blockNumber) >= nextPoolBlock
    return explicitlyVisible.has(key) || Number(poolCounts.get(key) || 0) >= 2 || pendingPoolScan
  }
}

export function countVisibleDopplerLaunches(input) {
  const isVisible = dopplerVisibilityPredicate(input)
  let count = 0
  for (const target of input.dopplerTargetIndex || []) {
    if (isVisible(target)) count += 1
  }
  return count
}

export function selectVisibleDopplerLaunches(input) {
  const isVisible = dopplerVisibilityPredicate(input)
  return (input.dopplerTargetIndex || []).filter(isVisible).map((target) => ({
    adapterId: 'doppler.registry.v1',
    protocolId: ProtocolId.DOPPLER,
    attributionStatus: 'CHAIN_ATTESTED',
    asset: target.asset,
    numeraire: target.numeraire,
    blockNumber: target.blockNumber,
    evidenceId: target.evidenceId,
  }))
}

export function boundSourceCatalogPools(sourceCatalog, { observedAt = new Date().toISOString() } = {}) {
  const pools = Array.isArray(sourceCatalog?.pools) ? sourceCatalog.pools : []
  const targets = sourceTargetAddresses({
    pairListings: sourceCatalog?.pairListings,
    longLaunches: sourceCatalog?.longLaunches,
    dopplerLaunches: sourceCatalog?.dopplerLaunches,
    dopplerTargetIndex: sourceCatalog?.dopplerTargetIndex,
  })
  const retainedPools = retainPoolsForSourceTargets(pools, targets)
  const retention = {
    policy: 'SOURCE_TARGET_CURRENCY_ONLY',
    sourceTargets: targets.size,
    loadedPools: pools.length,
    retainedPools: retainedPools.length,
    prunedPools: pools.length - retainedPools.length,
    reason: 'STARTUP_MIGRATION',
  }
  if (retainedPools.length === pools.length) return { sourceCatalog: sourceCatalog || {}, retention, changed: false }
  return {
    sourceCatalog: {
      ...sourceCatalog,
      generatedAt: observedAt,
      summary: {
        ...(sourceCatalog?.summary || {}),
        genericPools: retainedPools.length,
        poolRetention: retention,
      },
      pools: retainedPools,
    },
    retention,
    changed: true,
  }
}

export function planSourceTargetPoolRange({ cursor, longCursor, dopplerCursor, safeHead, blockRange }) {
  const fromBlock = BigInt(cursor)
  const range = BigInt(blockRange)
  if (range <= 0n) throw new Error('source target pool blockRange must be positive')
  const launchCoverageCursor = BigInt(longCursor) < BigInt(dopplerCursor) ? BigInt(longCursor) : BigInt(dopplerCursor)
  const launchCoveredThrough = launchCoverageCursor - 1n
  const requestedSafeHead = BigInt(safeHead)
  const poolSafeHead = launchCoveredThrough < requestedSafeHead ? launchCoveredThrough : requestedSafeHead
  if (fromBlock > poolSafeHead) return null
  const maximumTo = fromBlock + range - 1n
  return {
    fromBlock,
    toBlock: maximumTo < poolSafeHead ? maximumTo : poolSafeHead,
    poolSafeHead,
  }
}

export function sourceFactsByAsset({ longLaunches = [], dopplerLaunches = [], pools = [] }) {
  const output = new Map()
  const ensure = (asset) => {
    const key = getAddress(asset).toLowerCase()
    if (!output.has(key))
      output.set(key, { targetAddress: getAddress(asset), longLaunches: [], dopplerLaunches: [], pools: [] })
    return output.get(key)
  }
  for (const launch of longLaunches) ensure(launch.asset).longLaunches.push(launch)
  for (const launch of dopplerLaunches) ensure(launch.asset).dopplerLaunches.push(launch)
  for (const pool of pools) {
    ensure(pool.currency0).pools.push(pool)
    ensure(pool.currency1).pools.push(pool)
  }
  return output
}
