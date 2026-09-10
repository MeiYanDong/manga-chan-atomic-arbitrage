import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { formatUnits, getAddress, parseUnits } from 'viem'
import { isExecutorPoolKeyShape, normalizeApiPool, PoolAdmission } from './pair-catalog.mjs'
import { classifyRpcError, errorText } from './policy.mjs'

export const BoardStatus = Object.freeze({
  DISCOVERED: 'DISCOVERED_UNQUOTED',
  UNQUOTABLE: 'UNQUOTABLE',
  NO_EDGE: 'NO_EDGE',
  GROSS_POSITIVE: 'GROSS_POSITIVE_NET_NEGATIVE',
  SCREENED_POSITIVE: 'SCREENED_NET_POSITIVE',
  STALE: 'STALE',
})

export const CandidateWakePriority = Object.freeze({
  SHADOW_ONLY: 0,
  EXECUTOR_SHAPE: 1,
  EXECUTOR_COMPATIBLE: 2,
})

/**
 * Prefer candidates that the deployed executor can actually consume without
 * upgrading structural metadata into execution evidence. Periodic
 * reconciliation still samples every admitted shadow candidate.
 *
 * @param {Record<string, any> | null | undefined} candidate
 */
export function candidateWakePriority(candidate) {
  const pools = Array.isArray(candidate?.pools) ? candidate.pools : []
  if (pools.filter((pool) => pool.executionAdmission === PoolAdmission.EXECUTOR_COMPATIBLE).length >= 2) {
    return CandidateWakePriority.EXECUTOR_COMPATIBLE
  }
  if (pools.filter(isExecutorPoolKeyShape).length >= 2) return CandidateWakePriority.EXECUTOR_SHAPE
  return CandidateWakePriority.SHADOW_ONLY
}

const POSITIVE_STATUS = BoardStatus.SCREENED_POSITIVE
const EVENT_LEDGER_SCHEMA_VERSION = 2
const LEGACY_EXECUTION_ESTIMATE = 'NOT_RUN_GENERIC_EXECUTOR_NOT_DEPLOYED'
const EXACT_PREFLIGHT_EXECUTION_ESTIMATE = 'NOT_RUN_EXACT_EXECUTOR_PREFLIGHT_REQUIRED'

export const EpisodeState = Object.freeze({
  NONE: 'NONE',
  OPEN: 'OPEN',
  CLOSED: 'CLOSED',
})

export const EpisodeObservation = Object.freeze({
  CONFIRMED_POSITIVE: 'CONFIRMED_POSITIVE',
  CONFIRMED_NON_POSITIVE: 'CONFIRMED_NON_POSITIVE',
  UNKNOWN: 'UNKNOWN',
})

/** @param {Record<string, any>} item */
export function normalizeExecutionEvidence(item) {
  if (item.executionEstimate !== LEGACY_EXECUTION_ESTIMATE) return item
  return { ...item, executionEstimate: EXACT_PREFLIGHT_EXECUTION_ESTIMATE }
}

/** @param {Record<string, any> | null} snapshot */
export function normalizePersistedBoardSnapshot(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.items)) return snapshot
  return {
    ...snapshot,
    items: snapshot.items.map((item) => {
      const normalized = normalizeExecutionEvidence(item)
      if (!item.baseOpportunities) return normalized
      return {
        ...normalized,
        baseOpportunities: Object.fromEntries(
          Object.entries(item.baseOpportunities).map(([base, lane]) => [base, normalizeExecutionEvidence(lane)]),
        ),
      }
    }),
  }
}

/**
 * Keep the signing bridge small without weakening its trust boundary. The
 * watcher still validates the board identity, freshness, arithmetic, paths and
 * same-block pool attestations; non-positive rows are irrelevant to that gate.
 *
 * @param {Record<string, any> | null} snapshot
 */
export function compactExecutionBoardSnapshot(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.items)) return snapshot
  return {
    ...snapshot,
    items: snapshot.items.filter((item) => isExecutionFeedCandidate(item)),
  }
}

/** @param {Record<string, any> | null | undefined} item */
export function isExecutionFeedCandidate(item) {
  return Boolean(
    item &&
    ((item.status === BoardStatus.SCREENED_POSITIVE && item.fresh === true) ||
      Object.values(item.baseOpportunities || {}).some(
        (lane) => lane?.status === BoardStatus.SCREENED_POSITIVE && lane?.fresh === true,
      )),
  )
}

/**
 * Count candidates whose just-completed observation contains at least one
 * proxy-positive base lane. The board uses this to publish a signer-feed
 * checkpoint before slower catalog maintenance can age a new quote past the
 * watcher's much tighter execution horizon.
 *
 * @param {Array<Record<string, any> | null | undefined>} observations
 */
export function screenedPositiveObservationCount(observations) {
  if (!Array.isArray(observations)) throw new Error('observations must be an array')
  return observations.filter((observation) => {
    if (!observation || typeof observation !== 'object') return false
    const lanes = [observation, ...Object.values(observation.baseOpportunities || {})]
    return lanes.some((lane) => lane?.status === BoardStatus.SCREENED_POSITIVE)
  }).length
}

/**
 * Persist the signer-facing projection independently from the board's HTTP
 * event loop. Atomic replacement means readers see either the previous complete
 * generation or the next complete generation, never a partial JSON document.
 *
 * @param {string} file
 * @param {Record<string, any>} snapshot
 */
export function writeExecutionBoardSnapshot(file, snapshot) {
  const compact = compactExecutionBoardSnapshot(snapshot)
  writeJsonAtomic(file, compact)
  return compact
}

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
 * Invalid, hidden and flagged tokens never enter the board. Structurally valid
 * pools with unknown API depth or a disabled quote asset remain visible to the
 * signer-free shadow scanner; each pool carries an explicit execution
 * admission so metadata never silently becomes live authority.
 *
 * @param {Record<string, any>} token
 * @param {{minDepthUsd: number, stockAddresses?: Set<string>, quoteAssetAddresses?: Set<string>, chainAttestations?: Map<string, Record<string, any>>}} options
 */
export function normalizePairCandidate(token, options) {
  const tokenAddress = canonicalAddress(token.address)
  if (!tokenAddress || token.hidden === true || token.flagged === true) return null

  const quoteAssetAddresses = options.quoteAssetAddresses || options.stockAddresses
  const catalogPools = (Array.isArray(token.pairs) ? token.pairs : [])
    .map((pair) =>
      normalizeApiPool(tokenAddress, pair, {
        minDepthUsd: options.minDepthUsd,
        quoteAssetAddresses,
        chainAttestations: options.chainAttestations,
      }),
    )
    .filter(Boolean)
    .sort((left, right) => left.quoteAddress.localeCompare(right.quoteAddress))
  const pools = catalogPools.filter((pool) => pool.shadowEligible)

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
    strategyEligibility: 'MULTI_POOL_SHADOW_ELIGIBLE',
    executorShapePoolCount: pools.filter(isExecutorPoolKeyShape).length,
    liveCompatiblePoolCount: pools.filter((pool) => pool.executionAdmission === PoolAdmission.EXECUTOR_COMPATIBLE)
      .length,
    quarantinedPoolCount: catalogPools.filter((pool) => !pool.shadowEligible).length,
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

/**
 * Screen a WETH-denominated cycle. Gross profit and Gas are both measured in
 * wei; the same-block native mark is used only to compare this lane with USDG.
 * USDG normalization is conservative: profit rounds down and Gas rounds up.
 *
 * @param {{amountIn: bigint, amountOut: bigint, quoterGas: bigint[], overheadGas: bigint, gasPriceWei: bigint, nativeMarkInWei: bigint, nativeMarkOutUsdg: bigint}} input
 */
export function screenWethRoundTrip(input) {
  if (input.nativeMarkInWei <= 0n || input.nativeMarkOutUsdg <= 0n) throw new Error('native mark must be positive')
  const routeGas = input.quoterGas.reduce((sum, value) => sum + value, 0n)
  const gasUnitsProxy = routeGas + input.overheadGas
  const gasCostWei = gasUnitsProxy * input.gasPriceWei
  const grossProfitWei = input.amountOut - input.amountIn
  const screenedNetWei = grossProfitWei - gasCostWei
  const normalizedGrossProfitUsdg =
    grossProfitWei >= 0n
      ? (grossProfitWei * input.nativeMarkOutUsdg) / input.nativeMarkInWei
      : -ceilDiv(-grossProfitWei * input.nativeMarkOutUsdg, input.nativeMarkInWei)
  const normalizedGasCostUsdg = ceilDiv(gasCostWei * input.nativeMarkOutUsdg, input.nativeMarkInWei)
  const normalizedScreenedNetUsdg = normalizedGrossProfitUsdg - normalizedGasCostUsdg
  const status =
    grossProfitWei <= 0n
      ? BoardStatus.NO_EDGE
      : screenedNetWei > 0n && normalizedScreenedNetUsdg > 0n
        ? BoardStatus.SCREENED_POSITIVE
        : BoardStatus.GROSS_POSITIVE
  return {
    routeGas,
    gasUnitsProxy,
    gasCostWei,
    grossProfitWei,
    screenedNetWei,
    normalizedGrossProfitUsdg,
    normalizedGasCostUsdg,
    normalizedScreenedNetUsdg,
    status,
  }
}

/** @param {Record<string, any>[]} opportunities */
export function chooseBestBaseOpportunity(opportunities) {
  const viable = opportunities.flatMap((item) => {
    if (item?.status !== BoardStatus.SCREENED_POSITIVE || item?.fresh !== true) return []
    try {
      const normalized = {
        item,
        net: parseUnits(String(item.normalizedScreenedNetUsdg), 6),
        gross: parseUnits(String(item.normalizedGrossProfitUsdg), 6),
        amountIn: parseUnits(String(item.normalizedAmountInUsdg), 6),
      }
      return normalized.net > 0n && normalized.gross > 0n && normalized.amountIn > 0n ? [normalized] : []
    } catch {
      return []
    }
  })
  viable.sort((left, right) => {
    if (left.net !== right.net) return left.net > right.net ? -1 : 1
    if (left.gross !== right.gross) return left.gross > right.gross ? -1 : 1
    return left.amountIn < right.amountIn ? -1 : left.amountIn > right.amountIn ? 1 : 0
  })
  return viable[0]?.item || null
}

/** @param {unknown} error */
export function publicError(error) {
  return `[${classifyRpcError(error)}] ${errorText(error)}`
    .replace(/<RPC_URL_REDACTED>/g, '[redacted-endpoint]')
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

/** @param {Record<string, any>} item @param {number} nowMs @param {number} staleMs */
function applyOpportunityFreshness(item, nowMs, staleMs) {
  const topLevel = applyFreshness(item, nowMs, staleMs)
  if (!item.baseOpportunities) return topLevel
  const baseOpportunities = Object.fromEntries(
    Object.entries(item.baseOpportunities).map(([base, lane]) => [base, applyFreshness(lane, nowMs, staleMs)]),
  )
  const preferred = chooseBestBaseOpportunity(Object.values(baseOpportunities))
  return {
    ...topLevel,
    baseOpportunities,
    preferredBaseAsset: preferred?.baseAsset || null,
    preferredNormalizedScreenedNetUsdg: preferred?.normalizedScreenedNetUsdg || null,
  }
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
    return applyOpportunityFreshness(normalizeExecutionEvidence(base), nowMs, input.staleMs)
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
  const baseSelected = chooseBestBaseOpportunity(
    items.flatMap((item) =>
      Object.values(item.baseOpportunities || {}).map((lane) => ({ ...lane, id: item.id, symbol: item.symbol })),
    ),
  )

  return {
    schemaVersion: 5,
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
      opportunityUnit: 'USDG or WETH -> quote A -> token -> quote B -> same base asset',
      anchorPolicy:
        'quote assets may use a direct V3 anchor or one approved bridge (WETH for USDG base, USDG for WETH base); each fixed block discovers a first-amount top-N shortlist before larger amounts',
      amountPolicy:
        'bounded adaptive USDG grid up to 100 USDG; WETH uses same-block USDG-equivalent sizes plus midpoint refinement',
      selectionPolicy:
        'select within each base, then compare USDG and WETH by conservative same-block normalized screened net USDG',
      blockPolicy: 'all anchor and V4 quotes plus the native mark share one fixed block per observation',
      discoveryPolicy:
        'PAIR, LONG and Doppler target facts are joined to a bounded PoolManager V4 graph; each source keeps independent attribution and coverage before the configured start block remains unknown',
      gasPolicy: 'sum of quoter gas estimates plus fixed orchestration overhead; screening proxy only',
      positiveMeaning: 'screened positive quote, not executable simulation, transaction, receipt, or guaranteed profit',
      staleAfterMs: input.staleMs,
      episodePolicy:
        'an economic episode opens on a fresh positive screen, survives stale or unquotable observations, and closes only on a fresh non-positive screen',
    },
    eventLedger: {
      schemaVersion: EVENT_LEDGER_SCHEMA_VERSION,
      semantics: 'ECONOMIC_EPISODES_V2',
      legacyHistory: 'LEGACY_BIASED_BEFORE_EPOCH',
    },
    selection: {
      status: selected ? 'SCREENED_CANDIDATE_SELECTED' : 'NO_SCREENED_NET_POSITIVE',
      id: selected?.id || null,
      symbol: selected?.symbol || null,
      route: selected?.route || null,
      amountInUsdg: selected?.amountInUsdg || null,
      screenedNetUsdg: selected?.screenedNetUsdg || null,
      evidenceLevel: selected?.evidenceLevel || null,
      executionAdmission: selected?.routeExecutionAdmission || 'NONE',
      executionAuthorized: false,
    },
    baseSelection: {
      status: baseSelected ? 'SCREENED_BASE_CANDIDATE_SELECTED' : 'NO_SCREENED_BASE_NET_POSITIVE',
      id: baseSelected?.id || null,
      symbol: baseSelected?.symbol || null,
      baseAsset: baseSelected?.baseAsset || null,
      route: baseSelected?.route || null,
      amountInBase: baseSelected?.amountInBase || null,
      normalizedScreenedNetUsdg: baseSelected?.normalizedScreenedNetUsdg || null,
      evidenceLevel: baseSelected?.evidenceLevel || null,
      executionAdmission: baseSelected?.routeExecutionAdmission || 'NONE',
      executionAuthorized: false,
    },
    items,
  }
}

/** @param {Record<string, any>} lane */
function normalizedLaneNet(lane) {
  return finiteNumber(lane?.normalizedScreenedNetUsdg ?? lane?.screenedNetUsdg)
}

/** @param {Record<string, any>} item */
function positiveEconomicLane(item) {
  const lanes = Object.values(item?.baseOpportunities || {}).filter(
    (lane) =>
      lane?.status === POSITIVE_STATUS &&
      lane?.fresh === true &&
      normalizedLaneNet(lane) !== null &&
      normalizedLaneNet(lane) > 0,
  )
  if (lanes.length > 0) {
    return lanes.toSorted((left, right) => normalizedLaneNet(right) - normalizedLaneNet(left))[0]
  }
  return item?.status === POSITIVE_STATUS && item?.fresh === true ? item : null
}

/** @param {Record<string, any>} item */
function representativeEconomicLane(item) {
  const positive = positiveEconomicLane(item)
  if (positive) return positive
  const lanes = Object.values(item?.baseOpportunities || {}).filter(Boolean)
  if (lanes.length === 0) return item
  return lanes.toSorted((left, right) => {
    if (left.fresh !== right.fresh) return right.fresh === true ? 1 : -1
    const leftNet = normalizedLaneNet(left)
    const rightNet = normalizedLaneNet(right)
    if (leftNet === null) return rightNet === null ? 0 : 1
    if (rightNet === null) return -1
    return rightNet - leftNet
  })[0]
}

/** @param {Record<string, any>} item */
function economicObservation(item) {
  if (positiveEconomicLane(item)) return EpisodeObservation.CONFIRMED_POSITIVE
  const lanes = Object.values(item?.baseOpportunities || {}).filter(Boolean)
  if (lanes.length > 0) {
    return lanes.every(
      (lane) => lane.fresh === true && [BoardStatus.NO_EDGE, BoardStatus.GROSS_POSITIVE].includes(lane.status),
    )
      ? EpisodeObservation.CONFIRMED_NON_POSITIVE
      : EpisodeObservation.UNKNOWN
  }
  if (item?.fresh === true && [BoardStatus.NO_EDGE, BoardStatus.GROSS_POSITIVE].includes(item?.status)) {
    return EpisodeObservation.CONFIRMED_NON_POSITIVE
  }
  return EpisodeObservation.UNKNOWN
}

/** @param {string} id @param {string} openedAt */
function economicEpisodeId(id, openedAt) {
  return `episode:${createHash('sha256').update(`${id.toLowerCase()}:${openedAt}`).digest('hex')}`
}

/** @param {Record<string, any> | undefined} item @param {string} fallbackAt */
function recoverOpenEpisode(item, fallbackAt) {
  if (item?.economicEpisode?.state === EpisodeState.OPEN) return { ...item.economicEpisode }
  const stalePositive = Object.values(item?.baseOpportunities || {}).find(
    (lane) => lane?.status === BoardStatus.STALE && lane?.underlyingStatus === POSITIVE_STATUS,
  )
  const positive = positiveEconomicLane(item) || stalePositive
  const legacyPositive = item?.status === BoardStatus.STALE && item?.underlyingStatus === POSITIVE_STATUS ? item : null
  const lane = positive || legacyPositive
  if (!lane) return null
  const quote = eventQuoteEvidence(item, lane)
  const openedAt = String(quote.quotedAt || fallbackAt)
  return {
    schemaVersion: 1,
    episodeId: economicEpisodeId(String(item.id), openedAt),
    state: EpisodeState.OPEN,
    observation: lane?.fresh === true ? EpisodeObservation.CONFIRMED_POSITIVE : EpisodeObservation.UNKNOWN,
    openedAt,
    lastPositiveAt: quote.quotedAt,
    lastPositiveBlockNumber: quote.blockNumber,
    lastPositiveBlockHash: quote.blockHash,
    lastPositiveBaseAsset: quote.baseAsset,
    lastPositiveRoute: quote.route,
    lastPositiveRouteKey: quote.routeKey,
    lastPositiveAmountInBase: quote.amountInBase,
    lastPositiveAmountInUsdg: quote.amountInUsdg,
    lastPositiveGrossProfitUsdg: quote.grossProfitUsdg,
    lastPositiveGasCostProxyUsdg: quote.gasCostProxyUsdg,
    lastPositiveNetUsdg: quote.screenedNetUsdg,
    continuityUnknownSince: lane?.fresh === true ? null : fallbackAt,
  }
}

/** @param {Record<string, any>} item @param {Record<string, any>} [selectedLane] */
function eventQuoteEvidence(item, selectedLane = representativeEconomicLane(item)) {
  const lane = selectedLane || item || {}
  return {
    tokenAddress: item.tokenAddress || null,
    baseAsset: lane.baseAsset || 'USDG',
    route: lane.route || null,
    routeKey: lane.routeKey || null,
    amountInBase: lane.amountInBase ?? lane.amountInUsdg ?? null,
    amountOutBase: lane.amountOutBase ?? lane.amountOutUsdg ?? null,
    amountInUsdg: lane.normalizedAmountInUsdg ?? lane.amountInUsdg ?? null,
    amountOutUsdg: lane.normalizedAmountOutUsdg ?? lane.amountOutUsdg ?? null,
    grossProfitUsdg: lane.normalizedGrossProfitUsdg ?? lane.grossProfitUsdg ?? null,
    gasCostProxyUsdg: lane.normalizedGasCostProxyUsdg ?? lane.gasCostProxyUsdg ?? null,
    screenedNetUsdg: lane.normalizedScreenedNetUsdg ?? lane.screenedNetUsdg ?? null,
    blockNumber: lane.blockNumber || null,
    blockHash: lane.blockHash || null,
    quotedAt: lane.quotedAt || null,
    evidenceLevel: lane.evidenceLevel || null,
    executionEstimate: lane.executionEstimate || 'NOT_RUN',
    receiptEvidence: lane.receiptEvidence || 'NONE',
  }
}

/** @param {Record<string, any>} episode @param {Record<string, any>} item */
function advancePositiveEpisode(episode, item) {
  const quote = eventQuoteEvidence(item, positiveEconomicLane(item))
  return {
    ...episode,
    state: EpisodeState.OPEN,
    observation: EpisodeObservation.CONFIRMED_POSITIVE,
    lastPositiveAt: quote.quotedAt,
    lastPositiveBlockNumber: quote.blockNumber,
    lastPositiveBlockHash: quote.blockHash,
    lastPositiveBaseAsset: quote.baseAsset,
    lastPositiveRoute: quote.route,
    lastPositiveRouteKey: quote.routeKey,
    lastPositiveAmountInBase: quote.amountInBase,
    lastPositiveAmountInUsdg: quote.amountInUsdg,
    lastPositiveGrossProfitUsdg: quote.grossProfitUsdg,
    lastPositiveGasCostProxyUsdg: quote.gasCostProxyUsdg,
    lastPositiveNetUsdg: quote.screenedNetUsdg,
    continuityUnknownSince: null,
  }
}

/**
 * Reconcile durable economic episodes separately from transport freshness.
 * STALE, UNQUOTABLE and discovery gaps are UNKNOWN continuity: none can close
 * an episode or cause a later fresh quote to count as another entry.
 *
 * @param {Record<string, any> | null} previous
 * @param {Record<string, any>} current
 * @param {{netDeltaUsdg?: number}} [options]
 */
export function reconcileOpportunityEpisodes(previous, current, options = {}) {
  const netDeltaUsdg = options.netDeltaUsdg ?? 0.05
  const snapshot = {
    ...current,
    items: (current.items || []).map((item) => ({ ...item })),
    eventLedger: {
      ...(current.eventLedger || {}),
      schemaVersion: EVENT_LEDGER_SCHEMA_VERSION,
      semantics: 'ECONOMIC_EPISODES_V2',
      legacyHistory: 'LEGACY_BIASED_BEFORE_EPOCH',
    },
  }
  if (!previous || Number(previous?.coverage?.candidateTokens || 0) === 0) {
    for (const item of snapshot.items) {
      if (economicObservation(item) !== EpisodeObservation.CONFIRMED_POSITIVE) continue
      const openedAt = String(eventQuoteEvidence(item).quotedAt || current.generatedAt)
      item.economicEpisode = advancePositiveEpisode(
        {
          schemaVersion: 1,
          episodeId: economicEpisodeId(item.id, openedAt),
          state: EpisodeState.OPEN,
          openedAt,
        },
        item,
      )
    }
    return {
      snapshot,
      events: [
        {
          schemaVersion: EVENT_LEDGER_SCHEMA_VERSION,
          type: 'BOARD_BASELINE_CREATED',
          at: current.generatedAt,
          candidateTokens: current.coverage.candidateTokens,
          screenedPositive: snapshot.items.filter(
            (item) => economicObservation(item) === EpisodeObservation.CONFIRMED_POSITIVE,
          ).length,
        },
      ],
    }
  }

  const events = []
  const beforeItems = new Map((previous.items || []).map((item) => [item.id, item]))
  for (const item of snapshot.items) {
    if (!beforeItems.has(item.id)) {
      events.push({
        schemaVersion: EVENT_LEDGER_SCHEMA_VERSION,
        type: 'CANDIDATE_ADDED',
        at: current.generatedAt,
        id: item.id,
        tokenAddress: item.tokenAddress || null,
        symbol: item.symbol,
        poolCount: item.pools?.length || 0,
      })
    }

    const previousItem = beforeItems.get(item.id)
    let episode = recoverOpenEpisode(previousItem, previous.generatedAt || current.generatedAt)
    const observation = economicObservation(item)

    if (observation === EpisodeObservation.CONFIRMED_POSITIVE) {
      const quote = eventQuoteEvidence(item, positiveEconomicLane(item))
      const priorQuote = previousItem ? eventQuoteEvidence(previousItem) : null
      const priorNet = episode?.lastPositiveNetUsdg ?? priorQuote?.screenedNetUsdg ?? null
      const priorRouteKey = episode?.lastPositiveRouteKey ?? priorQuote?.routeKey ?? null
      const priorBaseAsset = episode?.lastPositiveBaseAsset ?? priorQuote?.baseAsset ?? null
      if (!episode) {
        const openedAt = String(quote.quotedAt || current.generatedAt)
        episode = {
          schemaVersion: 1,
          episodeId: economicEpisodeId(item.id, openedAt),
          state: EpisodeState.OPEN,
          openedAt,
        }
        item.economicEpisode = advancePositiveEpisode(episode, item)
        events.push({
          schemaVersion: EVENT_LEDGER_SCHEMA_VERSION,
          type: 'SCREENED_POSITIVE_ENTERED',
          at: current.generatedAt,
          id: item.id,
          episodeId: episode.episodeId,
          symbol: item.symbol,
          ...quote,
        })
        continue
      }

      item.economicEpisode = advancePositiveEpisode(episode, item)
      const delta = Math.abs(Number(quote.screenedNetUsdg) - Number(priorNet))
      const baseChanged = Boolean(priorBaseAsset && priorBaseAsset !== quote.baseAsset)
      const routeChanged = Boolean(priorRouteKey && quote.routeKey && priorRouteKey !== quote.routeKey)
      if (baseChanged || routeChanged || (Number.isFinite(delta) && delta >= netDeltaUsdg)) {
        events.push({
          schemaVersion: EVENT_LEDGER_SCHEMA_VERSION,
          type: 'MATERIAL_NET_CHANGE',
          changeReason: baseChanged ? 'BASE_CHANGED' : routeChanged ? 'ROUTE_CHANGED' : 'NET_DELTA',
          at: current.generatedAt,
          id: item.id,
          episodeId: episode.episodeId,
          symbol: item.symbol,
          previousNetUsdg: priorNet,
          previousBaseAsset: priorBaseAsset,
          previousRouteKey: priorRouteKey,
          ...quote,
        })
      }
      continue
    }

    if (observation === EpisodeObservation.UNKNOWN) {
      if (episode) {
        item.economicEpisode = {
          ...episode,
          state: EpisodeState.OPEN,
          observation: EpisodeObservation.UNKNOWN,
          continuityUnknownSince: episode.continuityUnknownSince || current.generatedAt,
        }
      }
      continue
    }

    if (episode) {
      const quote = eventQuoteEvidence(item)
      const selectedLane = representativeEconomicLane(item)
      const hasBaseLanes = Object.keys(item.baseOpportunities || {}).length > 0
      item.economicEpisode = {
        ...episode,
        state: EpisodeState.CLOSED,
        observation: EpisodeObservation.CONFIRMED_NON_POSITIVE,
        closedAt: current.generatedAt,
        closeStatus: hasBaseLanes ? `${quote.baseAsset}:${selectedLane?.status}` : item.status,
        closeBlockNumber: quote.blockNumber,
        closeBlockHash: quote.blockHash,
      }
      events.push({
        schemaVersion: EVENT_LEDGER_SCHEMA_VERSION,
        type: 'SCREENED_POSITIVE_LEFT',
        at: current.generatedAt,
        id: item.id,
        episodeId: episode.episodeId,
        symbol: item.symbol,
        previousNetUsdg: episode.lastPositiveNetUsdg,
        previousRoute: episode.lastPositiveRoute,
        previousRouteKey: episode.lastPositiveRouteKey,
        previousBaseAsset: episode.lastPositiveBaseAsset,
        previousAmountInBase: episode.lastPositiveAmountInBase,
        previousAmountInUsdg: episode.lastPositiveAmountInUsdg,
        previousGrossProfitUsdg: episode.lastPositiveGrossProfitUsdg,
        previousGasCostProxyUsdg: episode.lastPositiveGasCostProxyUsdg,
        currentStatus: selectedLane?.status || item.status,
        ...quote,
      })
    }
  }
  return { snapshot, events }
}

/**
 * Compatibility helper for deterministic callers that only need emitted
 * events. Runtime publication uses reconcileOpportunityEpisodes so the durable
 * episode state is written into the snapshot.
 *
 * @param {Record<string, any> | null} previous
 * @param {Record<string, any>} current
 * @param {{netDeltaUsdg?: number}} [options]
 */
export function materialEvents(previous, current, options = {}) {
  return reconcileOpportunityEpisodes(previous, current, options).events
}

/** @param {string} file @param {unknown} value */
export function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o640 })
  fs.renameSync(temporary, file)
  fs.chmodSync(file, 0o640)
}

/**
 * Persist a large JSON-safe value without first allocating one monolithic
 * string. Object keys use the same recursive ordering as stablePayloadHash,
 * so the returned digest commits the exact JSON bytes written to disk.
 *
 * @param {string} file
 * @param {unknown} value
 */
export function writeStableJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`
  const descriptor = fs.openSync(temporary, 'wx', 0o640)
  const digest = createHash('sha256')
  let pending = ''
  let bytes = 0

  const flush = () => {
    if (pending.length === 0) return
    const encoded = Buffer.from(pending)
    let offset = 0
    while (offset < encoded.length) {
      const written = fs.writeSync(descriptor, encoded, offset, encoded.length - offset)
      if (written <= 0) throw new Error('stable JSON writer made no forward progress')
      offset += written
    }
    digest.update(encoded)
    bytes += encoded.length
    pending = ''
  }
  /** @param {string} chunk */
  const push = (chunk) => {
    pending += chunk
    if (pending.length >= 64 * 1024) flush()
  }
  /** @param {unknown} item @param {boolean} arrayValue */
  const writeValue = (item, arrayValue = false) => {
    if (Array.isArray(item)) {
      push('[')
      for (let index = 0; index < item.length; index += 1) {
        if (index > 0) push(',')
        writeValue(item[index], true)
      }
      push(']')
      return
    }
    if (item && typeof item === 'object') {
      push('{')
      let written = 0
      for (const key of Object.keys(item).sort((left, right) => left.localeCompare(right))) {
        const child = /** @type {Record<string, unknown>} */ (item)[key]
        if (['undefined', 'function', 'symbol'].includes(typeof child)) continue
        if (written > 0) push(',')
        push(`${JSON.stringify(key)}:`)
        writeValue(child)
        written += 1
      }
      push('}')
      return
    }
    const serialized = JSON.stringify(item)
    push(serialized === undefined && arrayValue ? 'null' : (serialized ?? 'null'))
  }

  try {
    writeValue(value ?? null)
    flush()
    fs.fsyncSync(descriptor)
    fs.closeSync(descriptor)
    fs.renameSync(temporary, file)
    fs.chmodSync(file, 0o640)
    return { hash: `sha256:${digest.digest('hex')}`, bytes }
  } catch (error) {
    try {
      fs.closeSync(descriptor)
    } catch {}
    try {
      fs.unlinkSync(temporary)
    } catch {}
    throw error
  }
}

/** @param {string} file @param {Record<string, any>[]} events */
export function appendEvents(file, events) {
  if (events.length === 0) return
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const body = `${events.map((event) => JSON.stringify(event)).join('\n')}\n`
  fs.appendFileSync(file, body, { mode: 0o640 })
  fs.chmodSync(file, 0o640)
}
