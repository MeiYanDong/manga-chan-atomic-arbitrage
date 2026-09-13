import { getAddress } from 'viem'

/**
 * Settlement assets are an explicit risk allowlist. Graph discovery may learn
 * arbitrary assets, but an unknown token must never silently become the unit
 * in which Gas coverage and profit are judged.
 */
export function globalSettlementAssets(defaults, extraCsv = '') {
  const values = [...(defaults || []), ...String(extraCsv || '').split(',')]
  const unique = new Map()
  for (const raw of values) {
    const value = String(raw).trim()
    if (!value) continue
    const address = getAddress(value)
    unique.set(address.toLowerCase(), address)
  }
  if (unique.size < 2 || unique.size > 16) throw new Error('global settlement allowlist must contain 2..16 assets')
  return [...unique.values()]
}
