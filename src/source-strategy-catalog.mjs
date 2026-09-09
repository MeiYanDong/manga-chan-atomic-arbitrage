import { getAddress } from 'viem'
import {
  OFFICIAL_PAIR_HOOK,
  PAIR_FEE,
  PAIR_TICK_SPACING,
  catalogAddress,
  mergeApiAndChainCatalog,
} from './pair-catalog.mjs'
import { sourceTargetAddresses } from './source-adapters.mjs'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

/** @param {unknown} value */
function blockNumber(value) {
  try {
    return BigInt(String(value ?? 0))
  } catch {
    return 0n
  }
}

/** @param {Record<string, any>} pool */
function validSourcePool(pool) {
  return (
    typeof pool?.poolId === 'string' &&
    /^0x[0-9a-f]{64}$/i.test(pool.poolId) &&
    catalogAddress(pool.currency0) &&
    catalogAddress(pool.currency1) &&
    catalogAddress(pool.hooks) &&
    Number.isSafeInteger(Number(pool.fee)) &&
    Number(pool.fee) >= 0 &&
    Number.isSafeInteger(Number(pool.tickSpacing))
  )
}

/** @param {Record<string, any>} pair */
function executorShape(pair) {
  return (
    catalogAddress(pair?.hookAddress) === OFFICIAL_PAIR_HOOK &&
    Number(pair?.poolFee) === PAIR_FEE &&
    Number(pair?.tickSpacing) === PAIR_TICK_SPACING
  )
}

/** @param {Map<string, Record<string, any>>} output @param {unknown} address @param {Record<string, any>} metadata */
function mergeMetadata(output, address, metadata) {
  const normalized = catalogAddress(address)
  if (!normalized) return
  const key = normalized.toLowerCase()
  const before = output.get(key) || { address: normalized }
  output.set(key, {
    ...before,
    ...Object.fromEntries(
      Object.entries(metadata).filter(([, value]) => value !== null && value !== undefined && value !== ''),
    ),
    address: normalized,
  })
}

/**
 * Build the smallest useful human-metadata index without treating one source's
 * labels as another source's platform attribution.
 *
 * @param {Record<string, any>} input
 */
function metadataIndex(input) {
  const output = new Map()
  for (const token of input.apiTokens || []) {
    mergeMetadata(output, token.address, {
      symbol: token.symbol,
      name: token.name,
      decimals: token.decimals,
      enabled: token.enabled,
    })
  }
  for (const listing of input.pairListings || []) {
    mergeMetadata(output, listing.targetAddress, { symbol: listing.symbol, name: listing.name })
  }
  for (const launch of input.longLaunches || []) {
    mergeMetadata(output, launch.asset, {
      symbol: launch.normalizedTicker,
      name: launch.normalizedTicker,
    })
  }
  for (const [address, metadata] of input.quoteAssets || []) mergeMetadata(output, address, metadata)
  return output
}

/** @param {Record<string, any>} input */
function sourceClaims(input) {
  const output = new Map()
  const ensure = (address) => {
    const normalized = catalogAddress(address)
    if (!normalized) return null
    const key = normalized.toLowerCase()
    if (!output.has(key)) output.set(key, new Set())
    return output.get(key)
  }
  for (const listing of input.pairListings || []) ensure(listing.targetAddress)?.add('PAIR_LISTING')
  for (const launch of input.longLaunches || []) ensure(launch.asset)?.add('LONG_LAUNCH')
  for (const target of input.dopplerTargetIndex || []) ensure(target.asset || target)?.add('DOPPLER_PROTOCOL')
  return output
}

/** @param {Record<string, any>} input */
function declaredNumeraires(input) {
  const output = new Map()
  const add = (asset, numeraire) => {
    const target = catalogAddress(asset)
    const quote = catalogAddress(numeraire)
    if (!target || !quote) return
    const key = target.toLowerCase()
    if (!output.has(key)) output.set(key, new Set())
    output.get(key).add(quote.toLowerCase())
  }
  for (const launch of input.longLaunches || []) add(launch.asset, launch.numeraire)
  for (const target of input.dopplerTargetIndex || []) add(target.asset, target.numeraire)
  return output
}

/**
 * Turn one PoolManager Initialize fact into the same normalized input shape as
 * a PAIR API pool. `chainSourceAttested` permits read-only quoting for arbitrary
 * V4 hooks; it does not make the pool executable.
 *
 * @param {Record<string, any>} pool
 * @param {string} targetAddress
 * @param {Map<string, Record<string, any>>} metadata
 */
function sourcePoolPair(pool, targetAddress, metadata) {
  if (!validSourcePool(pool)) return null
  const target = getAddress(targetAddress)
  const currency0 = getAddress(pool.currency0)
  const currency1 = getAddress(pool.currency1)
  if (![currency0, currency1].includes(target)) return null
  const quoteAddress = currency0 === target ? currency1 : currency0
  if (quoteAddress.toLowerCase() === ZERO_ADDRESS) return null
  const quote = metadata.get(quoteAddress.toLowerCase()) || {}
  return {
    poolId: pool.poolId.toLowerCase(),
    canonical: true,
    ammVersion: 'V4_MULTI',
    hookAddress: getAddress(pool.hooks),
    poolFee: Number(pool.fee),
    tickSpacing: Number(pool.tickSpacing),
    activeVirtualSwapDepthUsd: null,
    totalDepthUsd: null,
    liquidityUsd: null,
    impliedPriceUsd: null,
    chainDiscovered: true,
    chainSourceAttested: true,
    apiCanonicalClaim: false,
    sourceAdapterId: 'uniswap-v4.pool-manager.v1',
    sourceEvidenceId: pool.evidenceId || null,
    sourceBlockNumber: String(pool.blockNumber || '0'),
    quoteToken: {
      address: quoteAddress,
      symbol: String(quote.symbol || `TOKEN-${quoteAddress.slice(-6).toUpperCase()}`),
      decimals: Number.isSafeInteger(Number(quote.decimals)) ? Number(quote.decimals) : 18,
      enabled: quote.enabled !== false,
    },
  }
}

/** @param {Record<string, any>} pair @param {Set<string>} originalPoolIds @param {Set<string>} numeraires @param {Map<string, Record<string, any>>} metadata */
function poolRank(pair, originalPoolIds, numeraires, metadata) {
  const poolId = String(pair?.poolId || '').toLowerCase()
  const quoteAddress = String(pair?.quoteToken?.address || '').toLowerCase()
  return {
    original: originalPoolIds.has(poolId) ? 1 : 0,
    declaredNumeraire: numeraires.has(quoteAddress) ? 1 : 0,
    executorShape: executorShape(pair) ? 1 : 0,
    knownQuote: metadata.has(quoteAddress) ? 1 : 0,
    block: blockNumber(pair?.sourceBlockNumber),
    poolId,
  }
}

/** @param {ReturnType<typeof poolRank>} left @param {ReturnType<typeof poolRank>} right */
function compareRank(left, right) {
  for (const key of ['original', 'declaredNumeraire', 'executorShape', 'knownQuote']) {
    if (left[key] !== right[key]) return right[key] - left[key]
  }
  if (left.block !== right.block) return left.block > right.block ? -1 : 1
  return left.poolId.localeCompare(right.poolId)
}

/**
 * Join PAIR, LONG, Doppler and PoolManager facts into the bounded strategy
 * candidate graph. Discovery facts remain source-specific; the output only
 * says which target has at least two chain-attested V4 pools worth quoting.
 *
 * @param {{
 *   apiTokens?: Record<string, any>[],
 *   chainPools?: Record<string, any>[],
 *   quoteAssets?: Map<string, Record<string, any>>,
 *   pairListings?: Record<string, any>[],
 *   longLaunches?: Record<string, any>[],
 *   dopplerTargetIndex?: Record<string, any>[],
 *   genericPools?: Record<string, any>[],
 *   maxPoolsPerTarget?: number,
 * }} input
 */
export function buildSourceStrategyCatalog(input = {}) {
  const maxPoolsPerTarget = Number(input.maxPoolsPerTarget ?? 8)
  if (!Number.isSafeInteger(maxPoolsPerTarget) || maxPoolsPerTarget < 2 || maxPoolsPerTarget > 16) {
    throw new Error('maxPoolsPerTarget must be an integer between 2 and 16')
  }
  const metadata = metadataIndex(input)
  const claims = sourceClaims(input)
  const numeraires = declaredNumeraires(input)
  const targets = sourceTargetAddresses({
    pairListings: input.pairListings,
    longLaunches: input.longLaunches,
    dopplerTargetIndex: input.dopplerTargetIndex,
  })
  const tokens = new Map(
    mergeApiAndChainCatalog(input.apiTokens || [], input.chainPools || [], input.quoteAssets || new Map()).map(
      (token) => [token.address.toLowerCase(), token],
    ),
  )
  for (const targetKey of targets) {
    const targetAddress = getAddress(targetKey)
    const label = metadata.get(targetKey) || {}
    if (!tokens.has(targetKey)) {
      tokens.set(targetKey, {
        address: targetAddress,
        symbol: String(label.symbol || `TOKEN-${targetAddress.slice(-6).toUpperCase()}`),
        name: String(label.name || 'Chain-discovered source target'),
        hidden: false,
        flagged: false,
        launchedAt: null,
        totalDepthUsd: null,
        combinedVolume24hUsd: null,
        pairs: [],
        catalogSources: [],
      })
    }
    const token = tokens.get(targetKey)
    const targetClaims = claims.get(targetKey) || new Set()
    token.catalogSources = [...new Set([...(token.catalogSources || []), ...targetClaims])]
  }

  let graphPools = 0
  let invalidPools = 0
  const poolsByTarget = new Map()
  for (const pool of input.genericPools || []) {
    if (!validSourcePool(pool)) {
      invalidPools += 1
      continue
    }
    for (const currency of [pool.currency0, pool.currency1]) {
      const targetKey = String(currency).toLowerCase()
      if (!targets.has(targetKey)) continue
      const pair = sourcePoolPair(pool, targetKey, metadata)
      if (!pair) continue
      if (!poolsByTarget.has(targetKey)) poolsByTarget.set(targetKey, [])
      poolsByTarget.get(targetKey).push(pair)
      graphPools += 1
    }
  }

  let poolsDroppedByBound = 0
  let multiPoolTargets = 0
  let sourceOnlyMultiPoolTargets = 0
  let executorShapeMultiPoolTargets = 0
  let candidatePools = 0
  for (const [targetKey, token] of tokens) {
    const originalPairs = Array.isArray(token.pairs)
      ? token.pairs.map((pair) => ({
          ...pair,
          apiCanonicalClaim: pair?.apiCanonicalClaim ?? true,
        }))
      : []
    const originalPoolIds = new Set(originalPairs.map((pair) => String(pair?.poolId || '').toLowerCase()))
    const merged = new Map(originalPairs.map((pair) => [String(pair?.poolId || '').toLowerCase(), { ...pair }]))
    for (const pair of poolsByTarget.get(targetKey) || []) {
      const before = merged.get(pair.poolId)
      merged.set(
        pair.poolId,
        before
          ? {
              ...pair,
              ...before,
              chainSourceAttested: true,
              apiCanonicalClaim: before.apiCanonicalClaim ?? before.chainDiscovered !== true,
            }
          : pair,
      )
    }
    const targetNumeraires = numeraires.get(targetKey) || new Set()
    const ranked = [...merged.values()]
      .filter((pair) => /^0x[0-9a-f]{64}$/i.test(String(pair?.poolId || '')))
      .sort((left, right) =>
        compareRank(
          poolRank(left, originalPoolIds, targetNumeraires, metadata),
          poolRank(right, originalPoolIds, targetNumeraires, metadata),
        ),
      )
    const poolLimit = Math.max(maxPoolsPerTarget, originalPairs.length)
    token.pairs = ranked.slice(0, poolLimit)
    poolsDroppedByBound += Math.max(0, ranked.length - token.pairs.length)
    if (token.pairs.length < 2) continue
    multiPoolTargets += 1
    candidatePools += token.pairs.length
    if (originalPairs.length === 0) sourceOnlyMultiPoolTargets += 1
    if (token.pairs.filter(executorShape).length >= 2) executorShapeMultiPoolTargets += 1
  }

  return {
    tokens: [...tokens.values()],
    summary: {
      policy: 'BOUNDED_MULTI_SOURCE_V4_GRAPH',
      sourceTargets: targets.size,
      retainedGenericPools: (input.genericPools || []).length,
      orientedGraphPools: graphPools,
      invalidGenericPools: invalidPools,
      multiPoolTargets,
      sourceOnlyMultiPoolTargets,
      executorShapeMultiPoolTargets,
      candidatePools,
      poolsDroppedByBound,
      maxPoolsPerTarget,
    },
  }
}
