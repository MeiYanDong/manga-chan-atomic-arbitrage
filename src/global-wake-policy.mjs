import { getAddress } from 'viem'

export const GLOBAL_FEED_MATCH_POLICY = 'SPECIFIC_POOL_OR_NON_HUB_ASSET_PATH_V3'
export const GLOBAL_EVENT_MAX_ROUTES_PER_WAKE = 8
export const GLOBAL_MANAGED_FALLBACK_EVENT_LOGICAL_CALL_CAP = 32
export const GLOBAL_MANAGED_FALLBACK_RECOVERY_LOGICAL_CALL_CAP = 8

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

function normalizedAddress(value) {
  try {
    const address = getAddress(value)
    return address.toLowerCase() === ZERO_ADDRESS ? null : address
  } catch {
    return null
  }
}

/**
 * Split the global catalog into shared protocol roots, route-specific pool or
 * hook triggers, settlement hubs and non-hub asset evidence. Shared protocol
 * roots and WETH/USDG-like settlement hubs may occur in nearly every route, so
 * they are wake context but never route dependencies by themselves.
 *
 * @param {Record<string, any> | null} catalog
 * @param {{protocolAddresses?: string[], earnProtocolAddresses?: string[], settlementAddresses?: string[], ignoredAddresses?: string[]}} [options]
 */
export function buildGlobalFeedWatchPolicy(catalog, options = {}) {
  const ignored = new Set()
  for (const value of options.ignoredAddresses || []) {
    const address = normalizedAddress(value)
    if (address) ignored.add(address.toLowerCase())
  }
  const protocols = new Map()
  const earnProtocols = new Map()
  const pools = new Map()
  const earnPools = new Map()
  const assets = new Map()
  const earnAssets = new Map()
  const settlements = new Map()
  const add = (target, value) => {
    const address = normalizedAddress(value)
    if (!address || ignored.has(address.toLowerCase())) return
    target.set(address.toLowerCase(), address)
  }

  for (const value of options.protocolAddresses || []) add(protocols, value)
  for (const value of options.earnProtocolAddresses || []) {
    add(protocols, value)
    add(earnProtocols, value)
  }
  for (const value of options.settlementAddresses || []) add(settlements, value)
  for (const pool of catalog?.earn?.pools || []) {
    add(pools, pool.address)
    add(earnPools, pool.address)
    for (const token of pool.tokens || []) {
      add(assets, token.address)
      add(earnAssets, token.address)
    }
  }
  for (const venue of ['v2Pools', 'v3Pools', 'v4Pools']) {
    for (const pool of catalog?.uniswap?.[venue] || []) {
      add(pools, pool.address || pool.pool)
      add(pools, pool.hooks)
      add(assets, pool.token0)
      add(assets, pool.token1)
    }
  }

  // Uniswap v4 catalogs expose the shared PoolManager as each pool's
  // transaction target. It is still useful wake context, but it must not be
  // mistaken for a route-specific pool dependency. The same rule protects us
  // from any future adapter that repeats a protocol root in its pool field.
  const specificPools = new Map([...pools].filter(([key]) => !protocols.has(key)))
  const triggers = new Map([...protocols, ...specificPools])
  const watched = new Map([...triggers, ...assets])
  if (watched.size > 1_024) throw new Error('global feed address filter exceeds its safety bound')
  return {
    policy: GLOBAL_FEED_MATCH_POLICY,
    triggerAddresses: [...triggers.values()],
    protocolAddresses: [...protocols.values()],
    earnProtocolAddresses: [...earnProtocols.values()],
    poolAddresses: [...specificPools.values()],
    earnPoolAddresses: [...earnPools.values()],
    assetAddresses: [...assets.values()],
    earnAssetAddresses: [...earnAssets.values()],
    settlementAddresses: [...settlements.values()],
    watchedAddresses: [...watched.values()],
  }
}

/**
 * Route an ordered-feed frame to the Earn adapter without turning the Earn
 * protocol into a separate signer. Exact pool matches are strongest; a
 * canonical Earn protocol plus a non-settlement Earn asset is a bounded
 * fallback for wrappers whose calldata does not expose the pool address.
 *
 * @param {string[]} matches
 * @param {{earnProtocolAddresses?: string[], earnPoolAddresses?: string[], earnAssetAddresses?: string[], settlementAddresses?: string[]}} policy
 */
export function classifyEarnFeedMatches(matches, policy) {
  const matched = new Set(
    (matches || [])
      .map(normalizedAddress)
      .filter(Boolean)
      .map((address) => address.toLowerCase()),
  )
  const protocols = new Set((policy?.earnProtocolAddresses || []).map((value) => value.toLowerCase()))
  const pools = new Set((policy?.earnPoolAddresses || []).map((value) => value.toLowerCase()))
  const assets = new Set((policy?.earnAssetAddresses || []).map((value) => value.toLowerCase()))
  const settlements = new Set((policy?.settlementAddresses || []).map((value) => value.toLowerCase()))
  const matchedProtocolAddresses = [...matched].filter((address) => protocols.has(address)).sort()
  const matchedPoolAddresses = [...matched].filter((address) => pools.has(address)).sort()
  const matchedAssetAddresses = [...matched].filter((address) => assets.has(address)).sort()
  const matchedNonSettlementAssetAddresses = matchedAssetAddresses.filter((address) => !settlements.has(address))
  const exactPool = matchedPoolAddresses.length > 0
  const protocolAssetPath = matchedProtocolAddresses.length > 0 && matchedNonSettlementAssetAddresses.length > 0
  const actionable = exactPool || protocolAssetPath
  return {
    actionable,
    reason: actionable
      ? exactPool
        ? 'EARN_POOL_MATCH'
        : 'EARN_PROTOCOL_ASSET_PATH_MATCH'
      : matchedProtocolAddresses.length > 0
        ? 'EARN_PROTOCOL_CONTEXT_ONLY'
        : 'NO_EARN_MATCH',
    matchedProtocolAddresses,
    matchedPoolAddresses,
    matchedAssetAddresses,
    matchedNonSettlementAssetAddresses,
    routeAddresses: [...new Set([...matchedPoolAddresses, ...matchedNonSettlementAssetAddresses])].sort(),
  }
}

/**
 * @param {string[]} matches
 * @param {{protocolAddresses?: string[], poolAddresses?: string[], triggerAddresses?: string[],
 * assetAddresses: string[], settlementAddresses?: string[]}} policy
 */
export function classifyGlobalFeedMatches(matches, policy) {
  const matched = new Set(
    (matches || [])
      .map(normalizedAddress)
      .filter(Boolean)
      .map((address) => address.toLowerCase()),
  )
  const protocols = new Set((policy?.protocolAddresses || []).map((value) => value.toLowerCase()))
  const pools = new Set((policy?.poolAddresses || policy?.triggerAddresses || []).map((value) => value.toLowerCase()))
  const assets = new Set((policy?.assetAddresses || []).map((value) => value.toLowerCase()))
  const settlements = new Set((policy?.settlementAddresses || []).map((value) => value.toLowerCase()))
  const matchedProtocolAddresses = [...matched].filter((address) => protocols.has(address)).sort()
  const matchedPoolAddresses = [...matched].filter((address) => pools.has(address)).sort()
  const matchedTriggerAddresses = [...new Set([...matchedProtocolAddresses, ...matchedPoolAddresses])].sort()
  const matchedAssetAddresses = [...matched].filter((address) => assets.has(address)).sort()
  const matchedSettlementAddresses = matchedAssetAddresses.filter((address) => settlements.has(address))
  const matchedNonSettlementAssetAddresses = matchedAssetAddresses.filter((address) => !settlements.has(address))
  const routeAddresses = [...new Set([...matchedPoolAddresses, ...matchedNonSettlementAssetAddresses])].sort()
  const exactPool = matchedPoolAddresses.length > 0
  const nonHubPath =
    matchedNonSettlementAssetAddresses.length > 0 &&
    (matchedAssetAddresses.length >= 2 || matchedProtocolAddresses.length > 0)
  const actionable = exactPool || nonHubPath
  return {
    actionable,
    reason: actionable
      ? exactPool
        ? 'SPECIFIC_POOL_OR_HOOK_MATCH'
        : 'NON_HUB_ASSET_PATH_MATCH'
      : matchedProtocolAddresses.length > 0 || matchedSettlementAddresses.length > 0
        ? 'SHARED_HUB_CONTEXT_ONLY'
        : matchedAssetAddresses.length === 1
          ? 'SINGLE_NON_HUB_ASSET_ONLY'
          : 'NO_ACTIONABLE_MATCH',
    matchedTriggerAddresses,
    matchedProtocolAddresses,
    matchedPoolAddresses,
    matchedAssetAddresses,
    matchedSettlementAddresses,
    matchedNonSettlementAssetAddresses,
    routeAddresses,
  }
}
