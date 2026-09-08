import { formatUnits, parseUnits } from 'viem'

export const MAX_AMOUNT_IN_USDG = 100_000_000n
export const DEFAULT_AMOUNT_GRID_USDG = Object.freeze(['5', '10', '25', '50', '100'])
export const DEFAULT_PROBE_AMOUNTS_USDG = Object.freeze(['5', '10'])

/**
 * Convert the USDG risk grid to equivalent WETH amounts using one same-block
 * WETH -> USDG mark. Rounding down never expands the requested risk.
 *
 * @param {bigint[]} usdgAmounts
 * @param {bigint} nativeMarkInWei
 * @param {bigint} nativeMarkOutUsdg
 */
export function equivalentWethAmountGrid(usdgAmounts, nativeMarkInWei, nativeMarkOutUsdg) {
  if (nativeMarkInWei <= 0n || nativeMarkOutUsdg <= 0n) throw new Error('native mark must be positive')
  const unique = new Set()
  for (const amount of usdgAmounts) {
    if (amount <= 0n) throw new Error('USDG equivalent amount must be positive')
    const wethAmount = (amount * nativeMarkInWei) / nativeMarkOutUsdg
    if (wethAmount <= 0n) throw new Error('USDG equivalent amount rounds to zero WETH')
    unique.add(wethAmount.toString())
  }
  return [...unique].map((amount) => BigInt(amount)).sort((left, right) => (left < right ? -1 : 1))
}

/**
 * @param {string | undefined} value
 * @param {readonly string[]} fallback
 * @param {bigint} [maximum]
 */
export function parseUsdgAmountGrid(value, fallback, maximum = MAX_AMOUNT_IN_USDG) {
  const raw = value === undefined || value.trim() === '' ? fallback : value.split(',')
  const unique = new Set()
  for (const item of raw) {
    const normalized = String(item).trim()
    if (normalized === '') continue
    const amount = parseUnits(normalized, 6)
    if (amount <= 0n || amount > maximum) {
      throw new Error(`USDG amount ${normalized} must be greater than zero and at most ${formatUnits(maximum, 6)}`)
    }
    unique.add(amount.toString())
  }
  const amounts = [...unique].map((item) => BigInt(item)).sort((left, right) => (left < right ? -1 : 1))
  if (amounts.length === 0) throw new Error('USDG amount grid must not be empty')
  return amounts
}

/** @param {Record<string, any>[]} quotes */
export function chooseBestAmountQuote(quotes) {
  const viable = quotes.filter(
    (quote) =>
      quote &&
      quote.error === undefined &&
      typeof (quote.normalizedScreenedNetUsdg ?? quote.screenedNetUsdg) === 'bigint' &&
      typeof (quote.normalizedGrossProfitUsdg ?? quote.grossProfitUsdg) === 'bigint' &&
      typeof quote.amountIn === 'bigint',
  )
  viable.sort((left, right) => {
    const leftNet = left.normalizedScreenedNetUsdg ?? left.screenedNetUsdg
    const rightNet = right.normalizedScreenedNetUsdg ?? right.screenedNetUsdg
    if (leftNet !== rightNet) {
      return leftNet > rightNet ? -1 : 1
    }
    const leftGross = left.normalizedGrossProfitUsdg ?? left.grossProfitUsdg
    const rightGross = right.normalizedGrossProfitUsdg ?? right.grossProfitUsdg
    if (leftGross !== rightGross) return leftGross > rightGross ? -1 : 1
    return left.amountIn < right.amountIn ? -1 : left.amountIn > right.amountIn ? 1 : 0
  })
  return viable[0] || null
}

/**
 * Retain a bounded set of distinct V4 entry/exit pool pairs after the first
 * amount has been fully quoted at a fixed block. Later amounts still execute
 * fresh V4 and V3 Quoter calls; only the pair topology is reused.
 *
 * @param {Record<string, any>[]} routes
 * @param {number} limit
 */
export function selectV4RoutePairs(routes, limit) {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('V4 shortlist limit must be a positive integer')
  const selected = []
  const seen = new Set()
  const viable = routes
    .filter((route) => {
      const entryPoolId = route?.entry?.pool?.poolId
      const exitPoolId = route?.exitPool?.poolId
      const net = route?.screening?.normalizedScreenedNetUsdg ?? route?.screening?.screenedNetUsdg
      return (
        typeof entryPoolId === 'string' &&
        typeof exitPoolId === 'string' &&
        entryPoolId.toLowerCase() !== exitPoolId.toLowerCase() &&
        typeof net === 'bigint'
      )
    })
    .sort((left, right) => {
      const leftNet = left.screening.normalizedScreenedNetUsdg ?? left.screening.screenedNetUsdg
      const rightNet = right.screening.normalizedScreenedNetUsdg ?? right.screening.screenedNetUsdg
      return leftNet === rightNet ? 0 : leftNet > rightNet ? -1 : 1
    })
  for (const route of viable) {
    const entryPoolId = route.entry.pool.poolId.toLowerCase()
    const exitPoolId = route.exitPool.poolId.toLowerCase()
    const identity = `${entryPoolId}:${exitPoolId}`
    if (seen.has(identity)) continue
    seen.add(identity)
    selected.push({ entryPoolId, exitPoolId })
    if (selected.length >= limit) break
  }
  return selected
}

/**
 * Add at most two midpoint quotes around the best coarse-grid amount. This is
 * deterministic and bounded; it improves sizing without turning every board
 * cycle into an unbounded search.
 *
 * @param {bigint[]} grid
 * @param {bigint} bestAmount
 */
export function refinementAmounts(grid, bestAmount) {
  const sorted = [...new Set(grid.map((amount) => amount.toString()))]
    .map((amount) => BigInt(amount))
    .sort((left, right) => (left < right ? -1 : 1))
  const index = sorted.findIndex((amount) => amount === bestAmount)
  if (index === -1) return []
  const candidates = []
  for (const neighbor of [sorted[index - 1], sorted[index + 1]]) {
    if (neighbor === undefined) continue
    const midpoint = (neighbor + bestAmount) / 2n
    if (midpoint > 0n && midpoint !== neighbor && midpoint !== bestAmount) candidates.push(midpoint)
  }
  return candidates.sort((left, right) => (left < right ? -1 : 1))
}

/**
 * @param {{probeQuotes: Record<string, any>[], previousStatus?: string | null, previousFullGridAt?: string | null, priority?: boolean, cycleNumber: number, fullGridEveryCycles: number, fullGridRefreshMs?: number, nowMs?: number}} input
 */
export function shouldExpandAmountGrid(input) {
  const periodicCoverageDue = input.fullGridEveryCycles > 0 && (input.cycleNumber + 1) % input.fullGridEveryCycles === 0
  if (periodicCoverageDue) return true

  const previousFullGridAtMs = Date.parse(input.previousFullGridAt || '')
  const nowMs = input.nowMs ?? Date.now()
  const refreshMs = input.fullGridRefreshMs ?? 300_000
  const fullGridDue =
    !Number.isFinite(previousFullGridAtMs) || previousFullGridAtMs > nowMs || nowMs - previousFullGridAtMs >= refreshMs
  if (!fullGridDue) return false

  const previousActionable = ['SCREENED_NET_POSITIVE', 'GROSS_POSITIVE_NET_NEGATIVE'].includes(
    input.previousStatus || '',
  )
  const probeHasGrossEdge = input.probeQuotes.some((quote) => {
    const gross = quote?.normalizedGrossProfitUsdg ?? quote?.grossProfitUsdg
    return typeof gross === 'bigint' && gross > 0n
  })
  return Boolean(input.priority || previousActionable || probeHasGrossEdge)
}

/** @param {bigint[]} amounts @param {number} [decimals] */
export function formatAmountGrid(amounts, decimals = 6) {
  return amounts.map((amount) => formatUnits(amount, decimals))
}
