import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { formatUnits, getAddress } from 'viem'
import { normalizeApiPool, PoolAdmission } from './pair-catalog.mjs'
import { classifyRpcError, errorText } from './policy.mjs'

export const BoardStatus = Object.freeze({
  DISCOVERED: 'DISCOVERED_UNQUOTED',
  UNQUOTABLE: 'UNQUOTABLE',
  NO_EDGE: 'NO_EDGE',
  GROSS_POSITIVE: 'GROSS_POSITIVE_NET_NEGATIVE',
  SCREENED_POSITIVE: 'SCREENED_NET_POSITIVE',
  STALE: 'STALE',
})

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
  return { ...snapshot, items: snapshot.items.map((item) => normalizeExecutionEvidence(item)) }
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
    items: snapshot.items.filter((item) => item.status === BoardStatus.SCREENED_POSITIVE && item.fresh === true),
  }
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
    return applyFreshness(normalizeExecutionEvidence(base), nowMs, input.staleMs)
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
    schemaVersion: 4,
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
      anchorPolicy:
        'quote assets may use a direct V3 anchor or one WETH bridge; each fixed block discovers a first-amount top-N shortlist before larger amounts',
      amountPolicy: 'bounded adaptive grid up to 100 USDG plus midpoint refinement around the best coarse amount',
      selectionPolicy: 'maximize absolute screened net USDG, then gross profit, then prefer less principal',
      blockPolicy: 'all anchor and V4 quotes plus the native mark share one fixed block per observation',
      discoveryPolicy:
        'PAIR API is merged with bounded PoolManager Initialize-log backfill; coverage before the configured start block remains unknown',
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
    items,
  }
}

/** @param {Record<string, any>} item */
function economicObservation(item) {
  if (item?.status === POSITIVE_STATUS && item?.fresh === true) return EpisodeObservation.CONFIRMED_POSITIVE
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
  const legacyPositive =
    (item?.status === POSITIVE_STATUS && item?.fresh === true) ||
    (item?.status === BoardStatus.STALE && item?.underlyingStatus === POSITIVE_STATUS)
  if (!legacyPositive) return null
  const openedAt = String(item?.quotedAt || fallbackAt)
  return {
    schemaVersion: 1,
    episodeId: economicEpisodeId(String(item.id), openedAt),
    state: EpisodeState.OPEN,
    observation: item?.fresh === true ? EpisodeObservation.CONFIRMED_POSITIVE : EpisodeObservation.UNKNOWN,
    openedAt,
    lastPositiveAt: item?.quotedAt || null,
    lastPositiveBlockNumber: item?.blockNumber || null,
    lastPositiveBlockHash: item?.blockHash || null,
    lastPositiveRoute: item?.route || null,
    lastPositiveRouteKey: item?.routeKey || null,
    lastPositiveAmountInUsdg: item?.amountInUsdg || null,
    lastPositiveGrossProfitUsdg: item?.grossProfitUsdg || null,
    lastPositiveGasCostProxyUsdg: item?.gasCostProxyUsdg || null,
    lastPositiveNetUsdg: item?.screenedNetUsdg || null,
    continuityUnknownSince: item?.fresh === true ? null : fallbackAt,
  }
}

/** @param {Record<string, any>} item */
function eventQuoteEvidence(item) {
  return {
    tokenAddress: item.tokenAddress || null,
    route: item.route || null,
    routeKey: item.routeKey || null,
    amountInUsdg: item.amountInUsdg || null,
    amountOutUsdg: item.amountOutUsdg || null,
    grossProfitUsdg: item.grossProfitUsdg || null,
    gasCostProxyUsdg: item.gasCostProxyUsdg || null,
    screenedNetUsdg: item.screenedNetUsdg || null,
    blockNumber: item.blockNumber || null,
    blockHash: item.blockHash || null,
    quotedAt: item.quotedAt || null,
    evidenceLevel: item.evidenceLevel || null,
    executionEstimate: item.executionEstimate || 'NOT_RUN',
    receiptEvidence: item.receiptEvidence || 'NONE',
  }
}

/** @param {Record<string, any>} episode @param {Record<string, any>} item */
function advancePositiveEpisode(episode, item) {
  return {
    ...episode,
    state: EpisodeState.OPEN,
    observation: EpisodeObservation.CONFIRMED_POSITIVE,
    lastPositiveAt: item.quotedAt,
    lastPositiveBlockNumber: item.blockNumber || null,
    lastPositiveBlockHash: item.blockHash || null,
    lastPositiveRoute: item.route || null,
    lastPositiveRouteKey: item.routeKey || null,
    lastPositiveAmountInUsdg: item.amountInUsdg || null,
    lastPositiveGrossProfitUsdg: item.grossProfitUsdg || null,
    lastPositiveGasCostProxyUsdg: item.gasCostProxyUsdg || null,
    lastPositiveNetUsdg: item.screenedNetUsdg || null,
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
      const openedAt = String(item.quotedAt || current.generatedAt)
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
          screenedPositive: current.coverage.counts[POSITIVE_STATUS] || 0,
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
      const priorNet = episode?.lastPositiveNetUsdg ?? previousItem?.screenedNetUsdg ?? null
      const priorRouteKey = episode?.lastPositiveRouteKey ?? previousItem?.routeKey ?? null
      if (!episode) {
        const openedAt = String(item.quotedAt || current.generatedAt)
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
          ...eventQuoteEvidence(item),
        })
        continue
      }

      item.economicEpisode = advancePositiveEpisode(episode, item)
      const delta = Math.abs(Number(item.screenedNetUsdg) - Number(priorNet))
      const routeChanged = Boolean(priorRouteKey && item.routeKey && priorRouteKey !== item.routeKey)
      if (routeChanged || (Number.isFinite(delta) && delta >= netDeltaUsdg)) {
        events.push({
          schemaVersion: EVENT_LEDGER_SCHEMA_VERSION,
          type: 'MATERIAL_NET_CHANGE',
          changeReason: routeChanged ? 'ROUTE_CHANGED' : 'NET_DELTA',
          at: current.generatedAt,
          id: item.id,
          episodeId: episode.episodeId,
          symbol: item.symbol,
          previousNetUsdg: priorNet,
          previousRouteKey: priorRouteKey,
          ...eventQuoteEvidence(item),
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
      item.economicEpisode = {
        ...episode,
        state: EpisodeState.CLOSED,
        observation: EpisodeObservation.CONFIRMED_NON_POSITIVE,
        closedAt: current.generatedAt,
        closeStatus: item.status,
        closeBlockNumber: item.blockNumber || null,
        closeBlockHash: item.blockHash || null,
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
        previousAmountInUsdg: episode.lastPositiveAmountInUsdg,
        previousGrossProfitUsdg: episode.lastPositiveGrossProfitUsdg,
        previousGasCostProxyUsdg: episode.lastPositiveGasCostProxyUsdg,
        currentStatus: item.status,
        ...eventQuoteEvidence(item),
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
