import { createHash } from 'node:crypto'

import { BoardStatus, finiteNumber } from './opportunity-board.mjs'

export const OPPORTUNITY_LEDGER_SCHEMA_VERSION = 1
export const OPPORTUNITY_DISCLOSURE_DELAY_MS = 5 * 60 * 1_000

export const OpportunityStage = Object.freeze({
  NOW: 'NOW',
  NEAR: 'NEAR',
  FILTERED: 'FILTERED',
  UNKNOWN: 'UNKNOWN',
})

const STATUS_PRIORITY = Object.freeze({
  [BoardStatus.SCREENED_POSITIVE]: 0,
  [BoardStatus.GROSS_POSITIVE]: 1,
  [BoardStatus.NO_EDGE]: 2,
  [BoardStatus.UNQUOTABLE]: 3,
  [BoardStatus.STALE]: 4,
  [BoardStatus.DISCOVERED]: 5,
})

function stablePublicId(value) {
  return `op_${createHash('sha256')
    .update(String(value || 'unknown').toLowerCase())
    .digest('hex')
    .slice(0, 16)}`
}

function candidateLanes(item) {
  const lanes = Object.values(item?.baseOpportunities || {}).filter(Boolean)
  return lanes.length > 0 ? lanes : [item]
}

function normalizedNet(lane) {
  return finiteNumber(lane?.normalizedScreenedNetUsdg ?? lane?.screenedNetUsdg)
}

function representativeLane(item) {
  return [...candidateLanes(item)].sort((left, right) => {
    if (left?.fresh !== right?.fresh) return right?.fresh === true ? 1 : -1
    const statusDifference = (STATUS_PRIORITY[left?.status] ?? 9) - (STATUS_PRIORITY[right?.status] ?? 9)
    if (statusDifference !== 0) return statusDifference
    const leftNet = normalizedNet(left)
    const rightNet = normalizedNet(right)
    if (leftNet === null) return rightNet === null ? 0 : 1
    if (rightNet === null) return -1
    return rightNet - leftNet
  })[0]
}

function opportunityDecision(item, lane) {
  if (item?.exactPreflight === 'PASSED' || lane?.exactPreflight === 'PASSED') {
    return {
      stage: OpportunityStage.NOW,
      reasonCode: 'EXACT_READY',
      reason: '已经通过成交前精确核验，执行服务正在处理。',
    }
  }
  if (lane?.fresh === true && lane?.status === BoardStatus.SCREENED_POSITIVE) {
    return {
      stage: OpportunityStage.NEAR,
      reasonCode: 'AWAITING_EXACT_PREFLIGHT',
      reason: '初筛净收益为正，仍需通过最新区块、合约模拟和完整成本核验。',
    }
  }
  if (lane?.fresh === true && lane?.status === BoardStatus.GROSS_POSITIVE) {
    return {
      stage: OpportunityStage.NEAR,
      reasonCode: 'COST_EXCEEDS_GROSS_EDGE',
      reason: '存在毛利，但 Gas 和风险准备金已经吞掉价差。',
    }
  }
  if (lane?.fresh === true && lane?.status === BoardStatus.NO_EDGE) {
    return {
      stage: OpportunityStage.FILTERED,
      reasonCode: 'NO_GROSS_EDGE',
      reason: '完整闭环得到的资产不超过投入，当前没有可套利价差。',
    }
  }
  if (lane?.status === BoardStatus.STALE) {
    const positiveBeforeExpiry = [BoardStatus.SCREENED_POSITIVE, BoardStatus.GROSS_POSITIVE].includes(
      lane?.underlyingStatus,
    )
    return {
      stage: OpportunityStage.UNKNOWN,
      reasonCode: positiveBeforeExpiry ? 'POSITIVE_CONTINUITY_UNKNOWN' : 'QUOTE_STALE',
      reason: positiveBeforeExpiry
        ? '过去曾观察到价差，但后续报价已经过期，不能判断机会是否持续。'
        : '最近报价已经过期，当前经济结果未知。',
    }
  }
  if (lane?.status === BoardStatus.UNQUOTABLE) {
    return {
      stage: OpportunityStage.UNKNOWN,
      reasonCode: 'QUOTE_UNAVAILABLE',
      reason: '本轮报价没有完整返回，不能把未知结果当作没有机会。',
    }
  }
  return {
    stage: OpportunityStage.UNKNOWN,
    reasonCode: 'NOT_QUOTED',
    reason: '候选已经进入池子图，但尚未获得一份新鲜的完整报价。',
  }
}

function amount(value) {
  if (value === null || value === undefined || value === '') return null
  return String(value)
}

function opportunityEconomics(lane) {
  return {
    unit: 'USDG',
    principal: amount(lane?.normalizedAmountInUsdg ?? lane?.amountInUsdg),
    grossProfit: amount(lane?.normalizedGrossProfitUsdg ?? lane?.grossProfitUsdg),
    estimatedCost: amount(lane?.normalizedGasCostProxyUsdg ?? lane?.gasCostProxyUsdg),
    estimatedNetProfit: amount(lane?.normalizedScreenedNetUsdg ?? lane?.screenedNetUsdg),
  }
}

function quoteAgeMs(quotedAt, nowMs) {
  const quotedAtMs = Date.parse(String(quotedAt || ''))
  return Number.isFinite(quotedAtMs) && Number.isFinite(nowMs) ? Math.max(0, nowMs - quotedAtMs) : null
}

function publicOpportunity(item, nowMs, disclosureDelayMs) {
  const lane = representativeLane(item)
  const decision = opportunityDecision(item, lane)
  const economics = opportunityEconomics(lane)
  const ageMs = quoteAgeMs(lane?.quotedAt, nowMs)
  const delayExactRoute =
    (decision.stage === OpportunityStage.NOW || decision.stage === OpportunityStage.NEAR) &&
    ageMs !== null &&
    ageMs < disclosureDelayMs
  const route = String(lane?.route || item?.route || '').trim()
  return {
    opportunityId: stablePublicId(item?.id || item?.tokenAddress),
    chain: 'Robinhood Chain',
    asset: String(item?.symbol || '待核验'),
    route: delayExactRoute ? `${String(item?.symbol || '该资产')} 多池闭环` : route || '路线待核验',
    stage: decision.stage,
    reasonCode: decision.reasonCode,
    reason: decision.reason,
    economics: {
      ...economics,
      principal: delayExactRoute ? null : economics.principal,
    },
    freshness: {
      status: lane?.fresh === true ? 'CURRENT' : 'UNKNOWN',
      quotedAt: lane?.quotedAt || null,
      ageMs,
    },
    disclosure: {
      exactRouteDelayed: delayExactRoute,
      availableAt:
        delayExactRoute && lane?.quotedAt
          ? new Date(Date.parse(lane.quotedAt) + disclosureDelayMs).toISOString()
          : null,
    },
    evidence: {
      blockNumber: lane?.blockNumber || null,
      blockCommitment: lane?.blockHash || null,
      method: lane?.evidenceLevel || null,
    },
  }
}

function itemOrder(left, right) {
  const stages = {
    [OpportunityStage.NOW]: 0,
    [OpportunityStage.NEAR]: 1,
    [OpportunityStage.FILTERED]: 2,
    [OpportunityStage.UNKNOWN]: 3,
  }
  const stageDifference = stages[left.stage] - stages[right.stage]
  if (stageDifference !== 0) return stageDifference
  const leftNet = finiteNumber(left.economics.estimatedNetProfit)
  const rightNet = finiteNumber(right.economics.estimatedNetProfit)
  if (leftNet !== null && rightNet !== null && leftNet !== rightNet) return rightNet - leftNet
  return String(right.freshness.quotedAt || '').localeCompare(String(left.freshness.quotedAt || ''))
}

function episodeProjection(episode) {
  const continuityUnknown = episode?.state === 'OPEN' || Boolean(episode?.continuityUnknownSince)
  return {
    episodeId: stablePublicId(episode?.episodeId),
    route: episode?.lastPositiveRoute || '历史路线待核验',
    state: continuityUnknown ? 'UNKNOWN' : 'CLOSED',
    classification: continuityUnknown ? 'CONTINUITY_UNKNOWN' : 'ENDED_WITHOUT_EXECUTION_PROOF',
    conclusion: continuityUnknown
      ? '历史价差之后缺少连续报价，不能确认仍存在，也不能计作错失利润。'
      : '历史价差已经结束；没有完整执行反事实，不能计作错失利润。',
    openedAt: episode?.openedAt || null,
    lastPositiveAt: episode?.lastPositiveAt || null,
    lastPositiveNetUsdg: amount(episode?.lastPositiveNetUsdg),
  }
}

export function buildOpportunityLedger({
  snapshot,
  episodes = [],
  executions = [],
  disclosureDelayMs = OPPORTUNITY_DISCLOSURE_DELAY_MS,
}) {
  if (!Number.isSafeInteger(disclosureDelayMs) || disclosureDelayMs < 0) {
    throw new RangeError('opportunity disclosure delay must be a non-negative safe integer')
  }
  const generatedAt = snapshot?.generatedAt || new Date().toISOString()
  const parsedNow = Date.parse(generatedAt)
  const nowMs = Number.isFinite(parsedNow) ? parsedNow : Date.now()
  const items = (snapshot?.items || []).map((item) => publicOpportunity(item, nowMs, disclosureDelayMs)).sort(itemOrder)
  const counts = Object.fromEntries(Object.values(OpportunityStage).map((stage) => [stage, 0]))
  const reasons = new Map()
  for (const item of items) {
    counts[item.stage] += 1
    reasons.set(item.reasonCode, (reasons.get(item.reasonCode) || 0) + 1)
  }
  const episodeItems = episodes.map(episodeProjection)
  const confirmedExecutions = executions.filter((item) => item?.state === 'CONFIRMED').length
  return {
    schemaVersion: OPPORTUNITY_LEDGER_SCHEMA_VERSION,
    generatedAt,
    mode: 'READ_ONLY_EVIDENCE_VIEW',
    counts,
    reasons: [...reasons.entries()]
      .map(([reasonCode, count]) => ({ reasonCode, count }))
      .sort((left, right) => right.count - left.count || left.reasonCode.localeCompare(right.reasonCode)),
    coverage: {
      status: items.some((item) => item.stage === OpportunityStage.UNKNOWN) ? 'PARTIAL' : 'CURRENT',
      admittedCandidates: items.length,
      freshCandidates: items.filter((item) => item.freshness.status === 'CURRENT').length,
      unknownCandidates: counts.UNKNOWN,
      disclosureDelayMs,
    },
    execution: {
      confirmedReceipts: confirmedExecutions,
    },
    missed: {
      confirmedLostRace: 0,
      historicalPositiveEpisodes: episodeItems.length,
      continuityUnknown: episodeItems.filter((item) => item.classification === 'CONTINUITY_UNKNOWN').length,
      evidenceStatus: 'PARTIAL',
      conclusion: '尚未建立完整的链级反事实，当前不能给出绝对错失利润。',
    },
    competition: {
      status: 'PARTIAL',
      scope: 'Earn 审查池正在接入；其他 Robinhood 与 BNB 路线仍为 UNKNOWN。',
      confirmedCompetitors: 0,
    },
    items,
    episodes: episodeItems,
  }
}

function boundedInteger(value, fallback, minimum, maximum, label) {
  const parsed = value === null || value === undefined || value === '' ? fallback : Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new RangeError(`${label} must be an integer in [${minimum}, ${maximum}]`)
  }
  return parsed
}

export function opportunityLedgerSummary(ledger) {
  const summary = { ...ledger }
  delete summary.items
  delete summary.episodes
  return summary
}

export function queryOpportunityLedger(ledger, searchParams) {
  const stage = searchParams.get('stage') || 'ALL'
  if (stage !== 'ALL' && !Object.values(OpportunityStage).includes(stage)) {
    throw new RangeError('invalid opportunity stage')
  }
  const reason = String(searchParams.get('reason') || '').trim()
  const query = String(searchParams.get('query') || '')
    .trim()
    .toLowerCase()
  const limit = boundedInteger(searchParams.get('limit'), 25, 1, 100, 'limit')
  const cursor = boundedInteger(searchParams.get('cursor'), 0, 0, Number.MAX_SAFE_INTEGER, 'cursor')
  const filtered = ledger.items.filter((item) => {
    if (stage !== 'ALL' && item.stage !== stage) return false
    if (reason && item.reasonCode !== reason) return false
    if (
      query &&
      ![item.asset, item.route, item.reason, item.chain].some((value) =>
        String(value || '')
          .toLowerCase()
          .includes(query),
      )
    ) {
      return false
    }
    return true
  })
  const items = filtered.slice(cursor, cursor + limit)
  return {
    schemaVersion: ledger.schemaVersion,
    generatedAt: ledger.generatedAt,
    stage,
    count: filtered.length,
    cursor,
    nextCursor: cursor + items.length < filtered.length ? String(cursor + items.length) : null,
    items,
  }
}

export function queryOpportunityEpisodes(ledger, searchParams) {
  const limit = boundedInteger(searchParams.get('limit'), 25, 1, 100, 'limit')
  const cursor = boundedInteger(searchParams.get('cursor'), 0, 0, Number.MAX_SAFE_INTEGER, 'cursor')
  const items = ledger.episodes.slice(cursor, cursor + limit)
  return {
    schemaVersion: ledger.schemaVersion,
    generatedAt: ledger.generatedAt,
    count: ledger.episodes.length,
    cursor,
    nextCursor: cursor + items.length < ledger.episodes.length ? String(cursor + items.length) : null,
    items,
  }
}
