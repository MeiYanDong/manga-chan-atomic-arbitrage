import { getAddress } from 'viem'

export const GLOBAL_FEED_MATCH_POLICY = 'PROTOCOL_OR_POOL_OR_TWO_ASSETS_V1'
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
 * Split the global catalog into low-noise protocol/pool triggers and asset
 * evidence. A single common token transfer is intentionally insufficient to
 * wake the expensive graph scan; router calldata normally contains both path
 * assets, while direct pool calls contain the pool/protocol address.
 *
 * @param {Record<string, any> | null} catalog
 * @param {{protocolAddresses?: string[], ignoredAddresses?: string[]}} [options]
 */
export function buildGlobalFeedWatchPolicy(catalog, options = {}) {
  const ignored = new Set()
  for (const value of options.ignoredAddresses || []) {
    const address = normalizedAddress(value)
    if (address) ignored.add(address.toLowerCase())
  }
  const triggers = new Map()
  const assets = new Map()
  const add = (target, value) => {
    const address = normalizedAddress(value)
    if (!address || ignored.has(address.toLowerCase())) return
    target.set(address.toLowerCase(), address)
  }

  for (const value of options.protocolAddresses || []) add(triggers, value)
  for (const pool of catalog?.earn?.pools || []) {
    add(triggers, pool.address)
    for (const token of pool.tokens || []) add(assets, token.address)
  }
  for (const venue of ['v2Pools', 'v3Pools', 'v4Pools']) {
    for (const pool of catalog?.uniswap?.[venue] || []) {
      add(triggers, pool.address || pool.pool)
      add(triggers, pool.hooks)
      add(assets, pool.token0)
      add(assets, pool.token1)
    }
  }

  const watched = new Map([...triggers, ...assets])
  if (watched.size > 1_024) throw new Error('global feed address filter exceeds its safety bound')
  return {
    policy: GLOBAL_FEED_MATCH_POLICY,
    triggerAddresses: [...triggers.values()],
    assetAddresses: [...assets.values()],
    watchedAddresses: [...watched.values()],
  }
}

/**
 * @param {string[]} matches
 * @param {{triggerAddresses: string[], assetAddresses: string[]}} policy
 */
export function classifyGlobalFeedMatches(matches, policy) {
  const matched = new Set(
    (matches || [])
      .map(normalizedAddress)
      .filter(Boolean)
      .map((address) => address.toLowerCase()),
  )
  const triggers = new Set((policy?.triggerAddresses || []).map((value) => value.toLowerCase()))
  const assets = new Set((policy?.assetAddresses || []).map((value) => value.toLowerCase()))
  const matchedTriggerAddresses = [...matched].filter((address) => triggers.has(address)).sort()
  const matchedAssetAddresses = [...matched].filter((address) => assets.has(address)).sort()
  const actionable = matchedTriggerAddresses.length > 0 || matchedAssetAddresses.length >= 2
  return {
    actionable,
    reason: actionable
      ? matchedTriggerAddresses.length > 0
        ? 'PROTOCOL_OR_POOL_MATCH'
        : 'TWO_ASSET_PATH_MATCH'
      : matchedAssetAddresses.length === 1
        ? 'SINGLE_ASSET_ONLY'
        : 'NO_ACTIONABLE_MATCH',
    matchedTriggerAddresses,
    matchedAssetAddresses,
  }
}
