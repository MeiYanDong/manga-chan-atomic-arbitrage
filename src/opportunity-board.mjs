import fs from 'node:fs'
import path from 'node:path'
import { formatUnits, getAddress } from 'viem'

export const BoardStatus = Object.freeze({
  DISCOVERED: 'DISCOVERED_UNQUOTED',
  UNQUOTABLE: 'UNQUOTABLE',
  NO_EDGE: 'NO_EDGE',
  GROSS_POSITIVE: 'GROSS_POSITIVE_NET_NEGATIVE',
  SCREENED_POSITIVE: 'SCREENED_NET_POSITIVE',
  STALE: 'STALE',
})

const POSITIVE_STATUS = BoardStatus.SCREENED_POSITIVE

/** @param {unknown} value */
export function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/** @param {number} observedCount @param {number} expectedCount */
export function catalogIsComplete(observedCount, expectedCount) {
  return Number.isSafeInteger(expectedCount) && expectedCount > 0 && observedCount >= expectedCount
}

/**
 * Keep a public reader from immediately starting another scan when one cycle
 * already consumed the configured interval. The delay is measured after the
 * cycle, while scanIntervalMs still defines the minimum start-to-start period.
 *
 * @param {{scanIntervalMs: number, cycleDurationMs: number, minimumPauseMs: number}} input
 */
export function nextCycleDelay(input) {
  if (![input.scanIntervalMs, input.cycleDurationMs, input.minimumPauseMs].every(Number.isSafeInteger)) {
    throw new Error('cycle timing values must be safe integers')
  }
  if (input.scanIntervalMs < 0 || input.cycleDurationMs < 0 || input.minimumPauseMs < 0) {
    throw new Error('cycle timing values must be non-negative')
  }
  return Math.max(input.minimumPauseMs, input.scanIntervalMs - input.cycleDurationMs)
}

/** @param {unknown} value */
export function canonicalAddress(value) {
  if (typeof value !== 'string') return null
  try {
    return getAddress(value)
  } catch {
    return null
  }
}

/**
 * Convert one PAIR API token into a deterministic, read-only candidate.
 * Invalid, hidden, flagged and shallow pools are retained only in the counters,
 * never promoted into a quote route.
 *
 * @param {Record<string, any>} token
 * @param {{minDepthUsd: number, stockAddresses?: Set<string>}} options
 */
export function normalizePairCandidate(token, options) {
  const tokenAddress = canonicalAddress(token.address)
  if (!tokenAddress || token.hidden === true || token.flagged === true) return null

  const pools = (Array.isArray(token.pairs) ? token.pairs : [])
    .map((pair) => {
      const quoteAddress = canonicalAddress(pair?.quoteToken?.address)
      const hookAddress = canonicalAddress(pair?.hookAddress)
      const depthUsd = finiteNumber(pair?.activeVirtualSwapDepthUsd ?? pair?.totalDepthUsd ?? pair?.liquidityUsd)
      const fee = Number(pair?.poolFee)
      const tickSpacing = Number(pair?.tickSpacing)
      if (
        !quoteAddress ||
        !hookAddress ||
        typeof pair?.poolId !== 'string' ||
        !/^0x[0-9a-f]{64}$/i.test(pair.poolId) ||
        pair.canonical !== true ||
        pair.ammVersion !== 'V4_MULTI' ||
        pair?.quoteToken?.enabled === false ||
        !Number.isSafeInteger(fee) ||
        fee < 0 ||
        !Number.isSafeInteger(tickSpacing) ||
        depthUsd === null ||
        depthUsd < options.minDepthUsd
      ) {
        return null
      }
      return {
        poolId: pair.poolId.toLowerCase(),
        tokenAddress,
        quoteAddress,
        quoteSymbol: String(pair.quoteToken.symbol || 'UNKNOWN'),
        quoteDecimals: Number.isSafeInteger(Number(pair.quoteToken.decimals)) ? Number(pair.quoteToken.decimals) : 18,
        quoteKind: options.stockAddresses?.has(quoteAddress.toLowerCase()) ? 'ROBINHOOD_ASSET' : 'TOKEN',
        fee,
        tickSpacing,
        hookAddress,
        depthUsd,
        impliedPriceUsd: finiteNumber(pair.impliedPriceUsd),
      }
    })
    .filter(Boolean)
    .sort((left, right) => left.quoteAddress.localeCompare(right.quoteAddress))

  if (pools.length < 2) return null
  const prices = pools.map((pool) => pool.impliedPriceUsd).filter((value) => value !== null && value > 0)
  const indicativeGapPct =
    prices.length < 2 ? null : ((Math.max(...prices) - Math.min(...prices)) / Math.min(...prices)) * 100

  return {
    id: tokenAddress.toLowerCase(),
    tokenAddress,
    symbol: String(token.symbol || 'UNKNOWN'),
    name: String(token.name || token.symbol || 'Unknown token'),
    launchedAt: finiteNumber(token.launchedAt),
    totalDepthUsd: finiteNumber(token.totalDepthUsd),
    volume24hUsd: finiteNumber(token.combinedVolume24hUsd ?? token.volume24hUsd),
    indicativeGapPct,
    pools,
  }
}

/** @param {bigint} numerator @param {bigint} denominator */
export function ceilDiv(numerator, denominator) {
  if (denominator <= 0n) throw new Error('denominator must be positive')
  return (numerator + denominator - 1n) / denominator
}

/**
 * This is a screening estimate, not executable gas. It combines quoter-reported
 * swap gas with a fixed orchestration overhead and converts native gas to USDG
 * using a quote pinned to the same block.
 *
 * @param {{amountIn: bigint, amountOut: bigint, quoterGas: bigint[], overheadGas: bigint, gasPriceWei: bigint, nativeMarkInWei: bigint, nativeMarkOutUsdg: bigint}} input
 */
export function screenRoundTrip(input) {
  if (input.nativeMarkInWei <= 0n || input.nativeMarkOutUsdg <= 0n) throw new Error('native mark must be positive')
  const routeGas = input.quoterGas.reduce((sum, value) => sum + value, 0n)
  const gasUnitsProxy = routeGas + input.overheadGas
  const gasCostUsdg = ceilDiv(gasUnitsProxy * input.gasPriceWei * input.nativeMarkOutUsdg, input.nativeMarkInWei)
  const grossProfitUsdg = input.amountOut - input.amountIn
  const screenedNetUsdg = grossProfitUsdg - gasCostUsdg
  const status =
    grossProfitUsdg <= 0n
      ? BoardStatus.NO_EDGE
      : screenedNetUsdg > 0n
        ? BoardStatus.SCREENED_POSITIVE
        : BoardStatus.GROSS_POSITIVE
  return { routeGas, gasUnitsProxy, gasCostUsdg, grossProfitUsdg, screenedNetUsdg, status }
}

/** @param {unknown} error */
export function publicError(error) {
  const object = error && typeof error === 'object' ? /** @type {Record<string, any>} */ (error) : null
  const raw = object
    ? String(object.shortMessage || object.message || object.details || object.name || 'UNKNOWN')
    : String(error || 'UNKNOWN')
  return raw
    .replace(/(?:https?|wss):\/\/[^\s"')]+/gi, '[redacted-endpoint]')
    .replace(/\b(?:0x)?[0-9a-f]{64}\b/gi, '[redacted-64-byte-value]')
    .replace(/\s+/g, ' ')
    .slice(0, 280)
}

/** @param {bigint | null | undefined} value */
export function usdg(value) {
  return value === null || value === undefined ? null : formatUnits(value, 6)
}

/**
 * @param {Record<string, any>} item
 * @param {number} nowMs
 * @param {number} staleMs
 * @returns {Record<string, any>}
 */
export function applyFreshness(item, nowMs, staleMs) {
  const output = /** @type {Record<string, any>} */ ({ ...item })
  if (!item.quotedAt) return { ...output, ageMs: null, fresh: false }
  const ageMs = Math.max(0, nowMs - Date.parse(item.quotedAt))
  if (ageMs <= staleMs) return { ...output, ageMs, fresh: true }
  return { ...output, underlyingStatus: item.status, status: BoardStatus.STALE, ageMs, fresh: false }
}

/** @param {string} status */
export function statusOrder(status) {
  return (
    {
      [BoardStatus.SCREENED_POSITIVE]: 0,
      [BoardStatus.GROSS_POSITIVE]: 1,
      [BoardStatus.NO_EDGE]: 2,
      [BoardStatus.UNQUOTABLE]: 3,
      [BoardStatus.STALE]: 4,
      [BoardStatus.DISCOVERED]: 5,
    }[status] ?? 9
  )
}

/**
 * @param {{generatedAt: string, catalog: Record<string, any>[], observations: Map<string, Record<string, any>>, staleMs: number, sourceState: Record<string, any>, serviceState: Record<string, any>}} input
 */
export function buildBoardSnapshot(input) {
  const nowMs = Date.parse(input.generatedAt)
  const items = input.catalog.map((candidate) => {
    const observation = input.observations.get(candidate.id)
    const base = observation
      ? { ...candidate, ...observation }
      : {
          ...candidate,
          status: BoardStatus.DISCOVERED,
          quotedAt: null,
          blockNumber: null,
          route: null,
          amountInUsdg: null,
          amountOutUsdg: null,
          grossProfitUsdg: null,
          gasCostProxyUsdg: null,
          screenedNetUsdg: null,
          evidenceLevel: 'DISCOVERY_METADATA_ONLY',
          executionEstimate: 'NOT_RUN',
          receiptEvidence: 'NONE',
        }
    return applyFreshness(base, nowMs, input.staleMs)
  })

  items.sort((left, right) => {
    const byStatus = statusOrder(left.status) - statusOrder(right.status)
    if (byStatus !== 0) return byStatus
    const leftNet = finiteNumber(left.screenedNetUsdg) ?? Number.NEGATIVE_INFINITY
    const rightNet = finiteNumber(right.screenedNetUsdg) ?? Number.NEGATIVE_INFINITY
    if (leftNet !== rightNet) return rightNet - leftNet
    const leftGap = left.indicativeGapPct ?? Number.NEGATIVE_INFINITY
    const rightGap = right.indicativeGapPct ?? Number.NEGATIVE_INFINITY
    return rightGap - leftGap || left.symbol.localeCompare(right.symbol)
  })
  items.forEach((item, index) => {
    item.rank = index + 1
  })

  const counts = Object.fromEntries(Object.values(BoardStatus).map((status) => [status, 0]))
  for (const item of items) counts[item.status] = (counts[item.status] || 0) + 1
  const quoted = items.filter((item) => item.quotedAt !== null).length
  const freshQuoted = items.filter((item) => item.quotedAt !== null && item.fresh).length
  const selected = items.find((item) => item.status === BoardStatus.SCREENED_POSITIVE && item.fresh) || null

  return {
    schemaVersion: 2,
    service: 'manga-opportunity-board',
    mode: 'READ_ONLY_NO_SIGNING_NO_BROADCAST',
    generatedAt: input.generatedAt,
    health: input.serviceState,
    source: input.sourceState,
    coverage: {
      candidateTokens: items.length,
      quotedTokens: quoted,
      freshQuotedTokens: freshQuoted,
      quoteCoveragePct: items.length === 0 ? 0 : Number(((quoted / items.length) * 100).toFixed(2)),
      counts,
    },
    methodology: {
      opportunityUnit: 'USDG -> quote A -> token -> quote B -> USDG',
      anchorPolicy: 'quote assets may use a direct V3 anchor or one WETH bridge; identity USDG anchors use zero hops',
      amountPolicy: 'bounded adaptive grid up to 100 USDG plus midpoint refinement around the best coarse amount',
      selectionPolicy: 'maximize absolute screened net USDG, then gross profit, then prefer less principal',
      blockPolicy: 'all anchor and V4 quotes plus the native mark share one fixed block per observation',
      gasPolicy: 'sum of quoter gas estimates plus fixed orchestration overhead; screening proxy only',
      positiveMeaning: 'screened positive quote, not executable simulation, transaction, receipt, or guaranteed profit',
      staleAfterMs: input.staleMs,
    },
    selection: {
      status: selected ? 'SCREENED_CANDIDATE_SELECTED' : 'NO_SCREENED_NET_POSITIVE',
      id: selected?.id || null,
      symbol: selected?.symbol || null,
      route: selected?.route || null,
      amountInUsdg: selected?.amountInUsdg || null,
      screenedNetUsdg: selected?.screenedNetUsdg || null,
      evidenceLevel: selected?.evidenceLevel || null,
      executionAuthorized: false,
    },
    items,
  }
}

/** @param {Record<string, any>} snapshot */
function positiveItems(snapshot) {
  return new Map(
    (snapshot?.items || [])
      .filter((item) => item.status === POSITIVE_STATUS && item.fresh)
      .map((item) => [item.id, item]),
  )
}

/**
 * Only changes that affect actionability are emitted. Initial census is one
 * baseline event instead of hundreds of noisy candidate-added events.
 *
 * @param {Record<string, any> | null} previous
 * @param {Record<string, any>} current
 * @param {{netDeltaUsdg?: number}} [options]
 */
export function materialEvents(previous, current, options = {}) {
  const netDeltaUsdg = options.netDeltaUsdg ?? 0.05
  if (!previous || Number(previous?.coverage?.candidateTokens || 0) === 0) {
    return [
      {
        type: 'BOARD_BASELINE_CREATED',
        at: current.generatedAt,
        candidateTokens: current.coverage.candidateTokens,
        screenedPositive: current.coverage.counts[POSITIVE_STATUS] || 0,
      },
    ]
  }

  const events = []
  const beforeItems = new Map((previous.items || []).map((item) => [item.id, item]))
  const beforePositive = positiveItems(previous)
  const afterPositive = positiveItems(current)

  for (const item of current.items || []) {
    if (!beforeItems.has(item.id)) {
      events.push({ type: 'CANDIDATE_ADDED', at: current.generatedAt, id: item.id, symbol: item.symbol })
    }
  }
  for (const [id, item] of afterPositive) {
    const before = beforePositive.get(id)
    if (!before) {
      events.push({
        type: 'SCREENED_POSITIVE_ENTERED',
        at: current.generatedAt,
        id,
        symbol: item.symbol,
        route: item.route,
        screenedNetUsdg: item.screenedNetUsdg,
        blockNumber: item.blockNumber,
      })
      continue
    }
    const delta = Math.abs(Number(item.screenedNetUsdg) - Number(before.screenedNetUsdg))
    if (Number.isFinite(delta) && delta >= netDeltaUsdg) {
      events.push({
        type: 'MATERIAL_NET_CHANGE',
        at: current.generatedAt,
        id,
        symbol: item.symbol,
        previousNetUsdg: before.screenedNetUsdg,
        screenedNetUsdg: item.screenedNetUsdg,
        route: item.route,
        blockNumber: item.blockNumber,
      })
    }
  }
  for (const [id, item] of beforePositive) {
    const currentItem = (current.items || []).find((candidate) => candidate.id === id)
    if (afterPositive.has(id) || !currentItem || currentItem.status === BoardStatus.STALE) continue
    events.push({
      type: 'SCREENED_POSITIVE_LEFT',
      at: current.generatedAt,
      id,
      symbol: item.symbol,
      previousNetUsdg: item.screenedNetUsdg,
      currentStatus: currentItem.status,
      blockNumber: currentItem.blockNumber,
    })
  }
  return events
}

/** @param {string} file @param {unknown} value */
export function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const temporary = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o640 })
  fs.renameSync(temporary, file)
  fs.chmodSync(file, 0o640)
}

/** @param {string} file @param {Record<string, any>[]} events */
export function appendEvents(file, events) {
  if (events.length === 0) return
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const body = `${events.map((event) => JSON.stringify(event)).join('\n')}\n`
  fs.appendFileSync(file, body, { mode: 0o640 })
  fs.chmodSync(file, 0o640)
}
