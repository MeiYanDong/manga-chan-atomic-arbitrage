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
 * Build a small event-time V4 route set without rediscovering every pool pair.
 * A touched pool is compared with the last winning route first; when no prior
 * route exists, a deterministic two-pool probe keeps the wake bounded. Every
 * returned route still receives fresh same-block V4 and V3 Quoter calls.
 *
 * @param {Record<string, any>[]} pools
 * @param {Record<string, any> | null} previousLane
 * @param {string[]} touchedPoolKeys
 * @param {number} limit
 */
export function selectEventV4RoutePairs(pools, previousLane, touchedPoolKeys = [], limit = 2) {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('event V4 pair limit must be a positive integer')
  const poolIds = [...new Set((pools || []).map((pool) => String(pool?.poolId || '').toLowerCase()).filter(Boolean))]
  const available = new Set(poolIds)
  if (poolIds.length < 2) return []

  const previousEntry = String(previousLane?.legs?.entryPoolId || '').toLowerCase()
  const previousExit = String(previousLane?.legs?.exitPoolId || '').toLowerCase()
  const hasPrevious = available.has(previousEntry) && available.has(previousExit) && previousEntry !== previousExit
  const touched = [...new Set(touchedPoolKeys.map((key) => String(key).toLowerCase()))].filter((key) =>
    available.has(key),
  )
  const selected = []
  const seen = new Set()
  const add = (entryPoolId, exitPoolId) => {
    if (!available.has(entryPoolId) || !available.has(exitPoolId) || entryPoolId === exitPoolId) return
    const identity = `${entryPoolId}:${exitPoolId}`
    if (seen.has(identity) || selected.length >= limit) return
    seen.add(identity)
    selected.push({ entryPoolId, exitPoolId })
  }

  for (const touchedPool of touched) {
    if (hasPrevious) {
      if (touchedPool === previousEntry || touchedPool === previousExit) {
        add(previousEntry, previousExit)
        add(previousExit, previousEntry)
      } else {
        add(touchedPool, previousExit)
        add(previousEntry, touchedPool)
      }
    } else {
      const counterpart = poolIds.find((poolId) => poolId !== touchedPool)
      add(touchedPool, counterpart)
      add(counterpart, touchedPool)
    }
    if (selected.length >= limit) return selected
  }

  if (hasPrevious) {
    add(previousEntry, previousExit)
    add(previousExit, previousEntry)
  }
  if (selected.length === 0) {
    add(poolIds[0], poolIds[1])
    add(poolIds[1], poolIds[0])
  }
  return selected
}

/**
 * Event wakes re-quote the last useful size and the smallest configured probe.
 * This deliberately avoids a full sizing grid while preserving a low-capital
 * probe for the live executor.
 *
 * @param {bigint[]} configuredProbes
 * @param {bigint | null} previousAmount
 * @param {bigint} maximumAmount
 * @param {number} limit
 */
export function selectEventProbeAmounts(configuredProbes, previousAmount, maximumAmount, limit = 2) {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('event amount limit must be a positive integer')
  if (typeof maximumAmount !== 'bigint' || maximumAmount <= 0n) {
    throw new Error('event maximum amount must be positive')
  }
  const selected = []
  const seen = new Set()
  const add = (amount) => {
    if (typeof amount !== 'bigint' || amount <= 0n || amount > maximumAmount) return
    const key = amount.toString()
    if (seen.has(key) || selected.length >= limit) return
    seen.add(key)
    selected.push(amount)
  }
  add(previousAmount)
  for (const amount of [...configuredProbes].sort((left, right) => (left < right ? -1 : 1))) add(amount)
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
