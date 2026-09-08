import { decodeEventLog, encodeAbiParameters, getAddress, keccak256, parseAbiItem, toHex } from 'viem'

export const ROBINHOOD_CHAIN_ID = 4_663
export const V4_POOL_MANAGER = getAddress('0x8366a39CC670B4001A1121B8F6A443A643e40951')
export const V4_STATE_VIEW = getAddress('0xF3334192D15450CdD385c8B70e03f9A6bD9E673b')
export const V4_QUOTER = getAddress('0x8Dc178eFB8111BB0973Dd9d722ebeFF267c98F94')
export const OFFICIAL_PAIR_HOOK = getAddress('0x16D1560630Ce74af4478d9b8AD46548A092A2000')
export const OBSERVED_LAUNCH_V2_HOOK = getAddress('0xD2F759A1Cf13c30127C551c3aEe04629Aea200c0')
export const PAIR_FEE = 10_000
export const PAIR_TICK_SPACING = 200

export const PoolEvidence = Object.freeze({
  API_CLAIM_ONLY: 'API_CLAIM_ONLY',
  POOL_KEY_MATCHED: 'POOL_KEY_MATCHED',
  INITIALIZED_QUOTER_CONFIRMED: 'INITIALIZED_QUOTER_CONFIRMED',
  POOL_KEY_MISMATCH: 'POOL_KEY_MISMATCH',
})

export const PoolAdmission = Object.freeze({
  EXECUTOR_COMPATIBLE: 'EXECUTOR_COMPATIBLE',
  SHADOW_ONLY_CHAIN_ATTESTATION_UNKNOWN: 'SHADOW_ONLY_CHAIN_ATTESTATION_UNKNOWN',
  SHADOW_ONLY_DEPTH_UNKNOWN: 'SHADOW_ONLY_DEPTH_UNKNOWN',
  SHADOW_ONLY_DISABLED_QUOTE: 'SHADOW_ONLY_DISABLED_QUOTE',
  SHADOW_ONLY_UNSUPPORTED_HOOK: 'SHADOW_ONLY_UNSUPPORTED_HOOK',
  QUARANTINED_SHALLOW: 'QUARANTINED_SHALLOW',
  QUARANTINED_POOL_KEY_MISMATCH: 'QUARANTINED_POOL_KEY_MISMATCH',
  QUARANTINED_UNKNOWN_HOOK: 'QUARANTINED_UNKNOWN_HOOK',
})

export const V4_INITIALIZE_EVENT = parseAbiItem(
  'event Initialize(bytes32 indexed id,address indexed currency0,address indexed currency1,uint24 fee,int24 tickSpacing,address hooks,uint160 sqrtPriceX96,int24 tick)',
)
export const V4_SWAP_EVENT = parseAbiItem(
  'event Swap(bytes32 indexed id,address indexed sender,int128 amount0,int128 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick,uint24 fee)',
)
export const V3_SWAP_EVENT = parseAbiItem(
  'event Swap(address indexed sender,address indexed recipient,int256 amount0,int256 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick)',
)

export const V4_INITIALIZE_TOPIC = keccak256(
  toHex('Initialize(bytes32,address,address,uint24,int24,address,uint160,int24)'),
)
export const V4_SWAP_TOPIC = keccak256(toHex('Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)'))
export const V3_SWAP_TOPIC = keccak256(toHex('Swap(address,address,int256,int256,uint160,uint128,int24)'))

const POOL_KEY_ABI = [
  {
    type: 'tuple',
    components: [
      { name: 'currency0', type: 'address' },
      { name: 'currency1', type: 'address' },
      { name: 'fee', type: 'uint24' },
      { name: 'tickSpacing', type: 'int24' },
      { name: 'hooks', type: 'address' },
    ],
  },
]

/** @param {unknown} value */
export function catalogAddress(value) {
  if (typeof value !== 'string') return null
  try {
    return getAddress(value)
  } catch {
    return null
  }
}

/** @param {unknown} value */
function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/** @param {{currency0: string, currency1: string, fee: number, tickSpacing: number, hooks: string}} key */
export function pairPoolId(key) {
  return keccak256(encodeAbiParameters(POOL_KEY_ABI, [key]))
}

/** @param {string} targetToken @param {string} quoteToken @param {number} fee @param {number} tickSpacing @param {string} hooks */
export function canonicalPoolKey(targetToken, quoteToken, fee, tickSpacing, hooks) {
  const target = getAddress(targetToken)
  const quote = getAddress(quoteToken)
  if (target === quote) throw new Error('pool currencies must differ')
  const currency0 = BigInt(target) < BigInt(quote) ? target : quote
  return {
    currency0,
    currency1: currency0 === target ? quote : target,
    fee,
    tickSpacing,
    hooks: getAddress(hooks),
  }
}

/** @param {string} hookAddress */
export function hookProvenance(hookAddress) {
  const hook = getAddress(hookAddress)
  if (hook === OFFICIAL_PAIR_HOOK) return 'OFFICIAL_PAIR_DOCS_EXECUTOR_SUPPORTED'
  if (hook === OBSERVED_LAUNCH_V2_HOOK) return 'PAIR_API_OBSERVED_NOT_OFFICIALLY_DOCUMENTED'
  return 'UNKNOWN_HOOK'
}

/**
 * Normalize one API pool without upgrading API metadata into chain evidence.
 * A null depth remains usable for read-only shadow quoting, but cannot be
 * promoted into the current executor.
 *
 * @param {string} targetToken
 * @param {Record<string, any>} pair
 * @param {{minDepthUsd: number, quoteAssetAddresses?: Set<string>, chainAttestations?: Map<string, Record<string, any>>}} options
 */
export function normalizeApiPool(targetToken, pair, options) {
  const targetAddress = catalogAddress(targetToken)
  const quoteAddress = catalogAddress(pair?.quoteToken?.address)
  const hookAddress = catalogAddress(pair?.hookAddress)
  const fee = Number(pair?.poolFee)
  const tickSpacing = Number(pair?.tickSpacing)
  const suppliedPoolId =
    typeof pair?.poolId === 'string' && /^0x[0-9a-f]{64}$/i.test(pair.poolId) ? pair.poolId.toLowerCase() : null
  if (
    !targetAddress ||
    !quoteAddress ||
    !hookAddress ||
    !suppliedPoolId ||
    pair?.canonical !== true ||
    pair?.ammVersion !== 'V4_MULTI' ||
    !Number.isSafeInteger(fee) ||
    fee < 0 ||
    !Number.isSafeInteger(tickSpacing)
  ) {
    return null
  }

  const poolKey = canonicalPoolKey(targetAddress, quoteAddress, fee, tickSpacing, hookAddress)
  const computedPoolId = pairPoolId(poolKey)
  const poolIdMatches = computedPoolId === suppliedPoolId
  const depthUsd = finiteNumber(pair?.activeVirtualSwapDepthUsd ?? pair?.totalDepthUsd ?? pair?.liquidityUsd)
  const depthStatus = depthUsd === null ? 'UNKNOWN' : depthUsd < options.minDepthUsd ? 'BELOW_MINIMUM' : 'ADEQUATE'
  const launchEnabled = pair?.quoteToken?.enabled !== false
  const provenance = hookProvenance(hookAddress)
  const chainAttestation = options.chainAttestations?.get(suppliedPoolId) || null

  /** @type {string} */
  let admission = PoolAdmission.SHADOW_ONLY_CHAIN_ATTESTATION_UNKNOWN
  if (!poolIdMatches) admission = PoolAdmission.QUARANTINED_POOL_KEY_MISMATCH
  else if (provenance === 'UNKNOWN_HOOK') admission = PoolAdmission.QUARANTINED_UNKNOWN_HOOK
  else if (depthStatus === 'BELOW_MINIMUM') admission = PoolAdmission.QUARANTINED_SHALLOW
  else if (!launchEnabled) admission = PoolAdmission.SHADOW_ONLY_DISABLED_QUOTE
  else if (depthStatus === 'UNKNOWN') admission = PoolAdmission.SHADOW_ONLY_DEPTH_UNKNOWN
  else if (hookAddress !== OFFICIAL_PAIR_HOOK) admission = PoolAdmission.SHADOW_ONLY_UNSUPPORTED_HOOK
  else if (chainAttestation?.status !== PoolEvidence.INITIALIZED_QUOTER_CONFIRMED) {
    admission = PoolAdmission.SHADOW_ONLY_CHAIN_ATTESTATION_UNKNOWN
  } else {
    admission = PoolAdmission.EXECUTOR_COMPATIBLE
  }

  const shadowEligible = poolIdMatches && provenance !== 'UNKNOWN_HOOK' && depthStatus !== 'BELOW_MINIMUM'

  return {
    poolId: suppliedPoolId,
    computedPoolId,
    poolKey,
    tokenAddress: targetAddress,
    quoteAddress,
    quoteSymbol: String(pair?.quoteToken?.symbol || 'UNKNOWN'),
    quoteDecimals: Number.isSafeInteger(Number(pair?.quoteToken?.decimals)) ? Number(pair.quoteToken.decimals) : 18,
    quoteKind: options.quoteAssetAddresses?.has(quoteAddress.toLowerCase()) ? 'PAIR_QUOTE_ASSET' : 'CUSTOM_TOKEN',
    launchEnabled,
    fee,
    tickSpacing,
    hookAddress,
    hookProvenance: provenance,
    depthUsd,
    depthStatus,
    impliedPriceUsd: finiteNumber(pair?.impliedPriceUsd),
    apiCanonicalClaim: true,
    poolIdEvidence: poolIdMatches ? PoolEvidence.POOL_KEY_MATCHED : PoolEvidence.POOL_KEY_MISMATCH,
    chainAttestation,
    shadowEligible,
    executionAdmission: admission,
    launchTxHash: typeof pair?.launchTxHash === 'string' ? pair.launchTxHash : null,
  }
}

/** @param {Record<string, any>} log */
export function decodePoolManagerLog(log) {
  const topic = String(log?.topics?.[0] || '').toLowerCase()
  const event = topic === V4_INITIALIZE_TOPIC ? V4_INITIALIZE_EVENT : topic === V4_SWAP_TOPIC ? V4_SWAP_EVENT : null
  if (!event) return null
  const decoded = /** @type {any} */ (
    decodeEventLog({ abi: [event], data: log.data, topics: log.topics, strict: true })
  )
  const args = /** @type {Record<string, any>} */ (decoded.args)
  const common = {
    source: 'V4_POOL_MANAGER',
    type: decoded.eventName === 'Initialize' ? 'V4_INITIALIZE' : 'V4_SWAP',
    poolId: String(args.id).toLowerCase(),
    blockNumber: BigInt(log.blockNumber),
    blockHash: log.blockHash || null,
    transactionHash: log.transactionHash || null,
    logIndex: Number(log.logIndex),
  }
  if (decoded.eventName === 'Initialize') {
    return {
      ...common,
      currency0: getAddress(args.currency0),
      currency1: getAddress(args.currency1),
      fee: Number(args.fee),
      tickSpacing: Number(args.tickSpacing),
      hooks: getAddress(args.hooks),
      sqrtPriceX96: BigInt(args.sqrtPriceX96),
      tick: Number(args.tick),
    }
  }
  return {
    ...common,
    sender: getAddress(args.sender),
    amount0: BigInt(args.amount0),
    amount1: BigInt(args.amount1),
    sqrtPriceX96: BigInt(args.sqrtPriceX96),
    liquidity: BigInt(args.liquidity),
    tick: Number(args.tick),
    fee: Number(args.fee),
  }
}

/** @param {Record<string, any>} log */
export function decodeV3SwapLog(log) {
  if (String(log?.topics?.[0] || '').toLowerCase() !== V3_SWAP_TOPIC) return null
  const decoded = /** @type {any} */ (
    decodeEventLog({ abi: [V3_SWAP_EVENT], data: log.data, topics: log.topics, strict: true })
  )
  const args = /** @type {Record<string, any>} */ (decoded.args)
  return {
    source: 'V3_POOL',
    type: 'V3_SWAP',
    poolAddress: getAddress(log.address),
    blockNumber: BigInt(log.blockNumber),
    blockHash: log.blockHash || null,
    transactionHash: log.transactionHash || null,
    logIndex: Number(log.logIndex),
    amount0: BigInt(args.amount0),
    amount1: BigInt(args.amount1),
    sqrtPriceX96: BigInt(args.sqrtPriceX96),
    liquidity: BigInt(args.liquidity),
    tick: Number(args.tick),
  }
}

/**
 * Infer the target token from all PAIR-hook Initialize logs in one launch
 * transaction. Multi-pool launches have one currency shared by every pool.
 * Single-pool launches are only attributable when exactly one side is a known
 * quote asset; otherwise they remain explicit ambiguity evidence.
 *
 * @param {Record<string, any>[]} events
 * @param {Set<string>} quoteAssetAddresses
 */
export function inferPairLaunchPools(events, quoteAssetAddresses = new Set()) {
  const groups = new Map()
  for (const event of events) {
    if (event?.type !== 'V4_INITIALIZE') continue
    if (
      !['OFFICIAL_PAIR_DOCS_EXECUTOR_SUPPORTED', 'PAIR_API_OBSERVED_NOT_OFFICIALLY_DOCUMENTED'].includes(
        hookProvenance(event.hooks),
      )
    )
      continue
    const key = event.transactionHash || `${event.blockNumber}:${event.poolId}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(event)
  }

  const pools = []
  const ambiguities = []
  for (const [launchTxHash, group] of groups) {
    let targetAddress = null
    let inference = null
    if (group.length >= 2) {
      const shared = [group[0].currency0, group[0].currency1].filter((address) =>
        group.every((event) => event.currency0 === address || event.currency1 === address),
      )
      if (shared.length === 1) {
        targetAddress = shared[0]
        inference = 'MULTI_POOL_TRANSACTION_INTERSECTION'
      }
    } else {
      const [event] = group
      const currency0Known = quoteAssetAddresses.has(event.currency0.toLowerCase())
      const currency1Known = quoteAssetAddresses.has(event.currency1.toLowerCase())
      if (currency0Known !== currency1Known) {
        targetAddress = currency0Known ? event.currency1 : event.currency0
        inference = 'SINGLE_POOL_KNOWN_QUOTE_COMPLEMENT'
      }
    }

    if (!targetAddress) {
      ambiguities.push({
        launchTxHash,
        blockNumber: group[0].blockNumber.toString(),
        poolIds: group.map((event) => event.poolId),
        reason: 'TARGET_TOKEN_AMBIGUOUS',
      })
      continue
    }

    for (const event of group) {
      if (![event.currency0, event.currency1].includes(targetAddress)) continue
      const quoteAddress = event.currency0 === targetAddress ? event.currency1 : event.currency0
      const key = canonicalPoolKey(targetAddress, quoteAddress, event.fee, event.tickSpacing, event.hooks)
      pools.push({
        poolId: event.poolId,
        computedPoolId: pairPoolId(key),
        targetAddress,
        quoteAddress,
        poolKey: key,
        fee: event.fee,
        tickSpacing: event.tickSpacing,
        hookAddress: event.hooks,
        hookProvenance: hookProvenance(event.hooks),
        launchTxHash,
        launchBlockNumber: event.blockNumber.toString(),
        launchBlockHash: event.blockHash,
        inference,
        chainEvidence: 'POOL_MANAGER_INITIALIZE_LOG',
      })
    }
  }
  return { pools, ambiguities }
}

/** @param {Record<string, any>[]} existing @param {Record<string, any>[]} discovered */
export function mergeChainPools(existing, discovered) {
  const merged = new Map((existing || []).map((pool) => [String(pool.poolId).toLowerCase(), pool]))
  for (const pool of discovered || []) {
    const id = String(pool.poolId).toLowerCase()
    const before = merged.get(id)
    merged.set(id, before ? { ...before, ...pool } : pool)
  }
  return [...merged.values()].sort((left, right) => {
    const byBlock = BigInt(left.launchBlockNumber) - BigInt(right.launchBlockNumber)
    if (byBlock !== 0n) return byBlock < 0n ? -1 : 1
    return left.poolId.localeCompare(right.poolId)
  })
}

/**
 * Merge chain-discovered PAIR pools into the API catalog. Existing API rows
 * keep their human metadata; missing targets and missing historical pools are
 * represented explicitly with unknown depth rather than silently dropped.
 *
 * @param {Record<string, any>[]} apiTokens
 * @param {Record<string, any>[]} chainPools
 * @param {Map<string, Record<string, any>>} quoteAssets
 */
export function mergeApiAndChainCatalog(apiTokens, chainPools, quoteAssets = new Map()) {
  const tokens = new Map()
  for (const token of apiTokens || []) {
    const address = catalogAddress(token?.address)
    if (!address) continue
    tokens.set(address.toLowerCase(), {
      ...token,
      address,
      pairs: Array.isArray(token.pairs) ? token.pairs.map((pair) => ({ ...pair })) : [],
      catalogSources: ['PAIR_API'],
    })
  }

  for (const pool of chainPools || []) {
    const targetAddress = catalogAddress(pool.targetAddress)
    const quoteAddress = catalogAddress(pool.quoteAddress)
    if (!targetAddress || !quoteAddress || pool.computedPoolId !== String(pool.poolId).toLowerCase()) continue
    const targetKey = targetAddress.toLowerCase()
    const token = tokens.get(targetKey) || {
      address: targetAddress,
      symbol: `CHAIN-${targetAddress.slice(-6).toUpperCase()}`,
      name: 'Chain-discovered PAIR target',
      hidden: false,
      flagged: false,
      launchedAt: null,
      totalDepthUsd: null,
      combinedVolume24hUsd: null,
      pairs: [],
      catalogSources: ['POOL_MANAGER_INITIALIZE_LOG'],
    }
    if (!token.catalogSources.includes('POOL_MANAGER_INITIALIZE_LOG')) {
      token.catalogSources.push('POOL_MANAGER_INITIALIZE_LOG')
    }
    if (!token.pairs.some((pair) => String(pair.poolId).toLowerCase() === String(pool.poolId).toLowerCase())) {
      const metadata = quoteAssets.get(quoteAddress.toLowerCase()) || {}
      token.pairs.push({
        poolId: String(pool.poolId).toLowerCase(),
        canonical: true,
        ammVersion: 'V4_MULTI',
        hookAddress: pool.hookAddress,
        poolFee: pool.fee,
        tickSpacing: pool.tickSpacing,
        activeVirtualSwapDepthUsd: null,
        totalDepthUsd: null,
        liquidityUsd: null,
        impliedPriceUsd: null,
        launchTxHash: pool.launchTxHash,
        chainDiscovered: true,
        chainEvidence: pool.chainEvidence,
        quoteToken: {
          address: quoteAddress,
          symbol: String(metadata.symbol || `TOKEN-${quoteAddress.slice(-6).toUpperCase()}`),
          decimals: Number.isSafeInteger(Number(metadata.decimals)) ? Number(metadata.decimals) : 18,
          enabled: metadata.enabled === true,
        },
      })
    }
    tokens.set(targetKey, token)
  }
  return [...tokens.values()]
}
