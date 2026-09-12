import fs from 'node:fs'
import { formatUnits, parseUnits } from 'viem'
import { buildBusinessActivities, summarizeProjectEconomics } from './business-activity.mjs'
import { dualSpendablePrincipal } from './dual-live-policy.mjs'

export const BUSINESS_SNAPSHOT_SCHEMA_VERSION = 3
export const BUSINESS_SNAPSHOT_MODE = 'READ_ONLY_SANITIZED_OPERATIONS'
export const BUSINESS_TIME_ZONE = 'Asia/Shanghai'
export const DAILY_PROFIT_SCHEMA_VERSION = 1
export const DAILY_PROFIT_MODE = 'READ_ONLY_RECEIPT_GATED_DAILY_PROFIT'
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1_000
const MAX_PUBLIC_SNAPSHOT_BYTES = 1_000_000
const MAX_DAILY_PROFIT_SNAPSHOT_BYTES = 128_000

function asDate(value) {
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) throw new Error('invalid report timestamp')
  return date
}

function shiftedShanghaiDate(value) {
  return new Date(asDate(value).getTime() + SHANGHAI_OFFSET_MS)
}

export function shanghaiDateKey(value) {
  return shiftedShanghaiDate(value).toISOString().slice(0, 10)
}

function shiftDateKey(dateKey, days) {
  const date = new Date(`${dateKey}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export function dailyReportSchedule(value, hour = 9, minute = 5) {
  const now = asDate(value)
  const local = shiftedShanghaiDate(now)
  const today = local.toISOString().slice(0, 10)
  const cutoffMinutes = hour * 60 + minute
  const localMinutes = local.getUTCHours() * 60 + local.getUTCMinutes()
  const due = localMinutes >= cutoffMinutes
  const nextDate = due ? shiftDateKey(today, 1) : today
  return {
    due,
    periodKey: shiftDateKey(today, -1),
    nextReportAt: new Date(
      Date.UTC(
        Number(nextDate.slice(0, 4)),
        Number(nextDate.slice(5, 7)) - 1,
        Number(nextDate.slice(8, 10)),
        hour - 8,
        minute,
      ),
    ).toISOString(),
  }
}

export function deriveDeliveryState(state, receipts = []) {
  const candidates = [
    state?.lastSuccessAt && state?.lastPeriodKey
      ? { lastSuccessAt: state.lastSuccessAt, lastPeriodKey: state.lastPeriodKey }
      : null,
    ...receipts
      .filter(
        (receipt) =>
          receipt?.status === 'DELIVERED' &&
          /^\d{4}-\d{2}-\d{2}$/.test(receipt.periodKey || '') &&
          Number.isFinite(Date.parse(receipt.sentAt)),
      )
      .map((receipt) => ({ lastSuccessAt: receipt.sentAt, lastPeriodKey: receipt.periodKey })),
  ].filter(Boolean)
  if (candidates.length === 0) return null
  return candidates.sort((left, right) => Date.parse(right.lastSuccessAt) - Date.parse(left.lastSuccessAt))[0]
}

function bigint(value) {
  try {
    return BigInt(value ?? 0)
  } catch {
    return 0n
  }
}

function decimal(value, decimals) {
  return formatUnits(bigint(value), decimals)
}

function executionNetUsdgWei(record) {
  return bigint(record?.normalizedNetProfitUsdgWei ?? record?.netProfitUsdgWei)
}

function executionBase(record) {
  return record?.baseAsset === 'WETH' ? 'WETH' : 'USDG'
}

function executionDateKey(record) {
  try {
    return shanghaiDateKey(record?.confirmedAt)
  } catch {
    return null
  }
}

function canonicalEarnExecutions(records) {
  const executions = new Map()
  const conflicted = new Set()
  for (const record of records) {
    if (
      record?.event !== 'mutation_effect' ||
      !['CONFIRMED_NET_PROFIT', 'REALIZED_NET_VERIFIED'].includes(record?.status)
    ) {
      continue
    }
    const transactionHash = [record?.transaction, record?.hash, record?.transactionHash].find((value) =>
      /^0x[0-9a-f]{64}$/i.test(String(value || '')),
    )
    const confirmedAt = record?.confirmedAt || record?.at
    if (!transactionHash || !Number.isFinite(Date.parse(confirmedAt))) continue
    let netProfitWei
    try {
      netProfitWei = record?.realizedNetProfitWei
        ? BigInt(record.realizedNetProfitWei)
        : parseUnits(String(record?.realizedNetProfitEth || ''), 18)
    } catch {
      continue
    }
    if (netProfitWei <= 0n) continue
    const normalized = {
      transactionHash: transactionHash.toLowerCase(),
      confirmedAt,
      authorizationId: record?.authorizationId || null,
      netProfitWei,
    }
    if (conflicted.has(normalized.transactionHash)) continue
    const before = executions.get(normalized.transactionHash)
    if (
      before &&
      (before.confirmedAt !== normalized.confirmedAt ||
        before.authorizationId !== normalized.authorizationId ||
        before.netProfitWei !== normalized.netProfitWei)
    ) {
      executions.delete(normalized.transactionHash)
      conflicted.add(normalized.transactionHash)
      continue
    }
    executions.set(normalized.transactionHash, normalized)
  }
  return [...executions.values()]
}

function earnExecutionDateKey(record) {
  try {
    return shanghaiDateKey(record.confirmedAt)
  } catch {
    return null
  }
}

function executionSummary(records, earnExecutions, { periodKey = null, authorizationId = null } = {}) {
  const selected = records.filter((record) => {
    if (periodKey && executionDateKey(record) !== periodKey) return false
    return !authorizationId || record?.authorizationId === authorizationId
  })
  const selectedEarn = earnExecutions.filter((record) => {
    if (periodKey && earnExecutionDateKey(record) !== periodKey) return false
    return !authorizationId || record.authorizationId === authorizationId
  })
  const netUsdgWei = selected.reduce((sum, record) => sum + executionNetUsdgWei(record), 0n)
  const netEthWei = selectedEarn.reduce((sum, record) => sum + record.netProfitWei, 0n)
  return {
    periodKey,
    confirmedExecutions: selected.length + selectedEarn.length,
    confirmedByBase: {
      USDG: selected.filter((record) => executionBase(record) === 'USDG').length,
      WETH: selected.filter((record) => executionBase(record) === 'WETH').length,
      EARN_ETH: selectedEarn.length,
    },
    verifiedExecutionNetUsdg: decimal(netUsdgWei, 6),
    verifiedExecutionNetEth: decimal(netEthWei, 18),
  }
}

function failedGasSummary(auditRecords, periodKey = null) {
  const selected = auditRecords.filter((record) => {
    if (record?.event !== 'mutation_reverted' || !record.gasSpentWei) return false
    if (!periodKey) return true
    try {
      return shanghaiDateKey(record.at) === periodKey
    } catch {
      return false
    }
  })
  return {
    failedTransactions: selected.length,
    failedGasEth: decimal(
      selected.reduce((sum, record) => sum + bigint(record.gasSpentWei), 0n),
      18,
    ),
  }
}

function recentExecution(record) {
  const baseAsset = executionBase(record)
  const baseDecimals = baseAsset === 'WETH' ? 18 : 6
  return {
    transactionHash: record.hash || null,
    confirmedAt: record.confirmedAt || null,
    route: record.routeLabel || '路线信息待核验',
    baseAsset,
    amountIn: decimal(record.amountInWei, baseDecimals),
    grossProfitBase: decimal(record.grossProfitWei, baseDecimals),
    verifiedNetUsdg: decimal(executionNetUsdgWei(record), 6),
    gasEth: decimal(record.gasSpentWei, 18),
    gasMarkedUsdg: record.gasSpentUsdgWei ? decimal(record.gasSpentUsdgWei, 6) : null,
  }
}

function lastRuntimeVerification(auditRecords) {
  return [...auditRecords]
    .reverse()
    .find((record) => record?.event === 'dual_runtime_verified' && record.walletEth && record.at)
}

function spendablePrincipal(arm, state, baseAsset) {
  if (!arm || !state) return null
  try {
    return decimal(dualSpendablePrincipal(arm, state, baseAsset), baseAsset === 'WETH' ? 18 : 6)
  } catch {
    return null
  }
}

function processStatus(runtime, processAlive) {
  if (!runtime) return 'NOT_CONFIGURED'
  if (!processAlive) return 'STOPPED'
  return runtime.status || 'UNKNOWN'
}

function dailySeries(now, executions, earnExecutions, auditRecords) {
  const today = shanghaiDateKey(now)
  const results = []
  for (let offset = 6; offset >= 0; offset -= 1) {
    const periodKey = shiftDateKey(today, -offset)
    results.push({
      ...executionSummary(executions, earnExecutions, { periodKey }),
      ...failedGasSummary(auditRecords, periodKey),
    })
  }
  return results
}

export function buildBusinessSnapshot({
  now = new Date(),
  arm = null,
  runtime = null,
  usdgState = null,
  wethState = null,
  auditRecords = [],
  board = /** @type {Record<string, any>} */ ({}),
  delivery = null,
  processAlive = false,
  reportHour = 9,
  reportMinute = 5,
  portfolio = null,
  projectRegistry = [],
  collectionRecords = [],
  earnOnHoodRecords = [],
}) {
  const timestamp = asDate(now)
  const executions = [...(usdgState?.executions || []), ...(wethState?.executions || [])]
  const earnExecutions = canonicalEarnExecutions(earnOnHoodRecords)
  const authorizationId = arm?.authorizationId || null
  const today = shanghaiDateKey(timestamp)
  const yesterday = shiftDateKey(today, -1)
  const verifiedWallet = lastRuntimeVerification(auditRecords)
  const schedule = dailyReportSchedule(timestamp, reportHour, reportMinute)
  const recentExecutions = [...executions]
    .sort((left, right) => Date.parse(right.confirmedAt || 0) - Date.parse(left.confirmedAt || 0))
    .slice(0, 12)
    .map(recentExecution)
  const activities = buildBusinessActivities({
    registry: projectRegistry,
    executions,
    auditRecords,
    collectionRecords,
    earnOnHoodRecords,
  })
  const snapshot = {
    schemaVersion: BUSINESS_SNAPSHOT_SCHEMA_VERSION,
    mode: BUSINESS_SNAPSHOT_MODE,
    generatedAt: timestamp.toISOString(),
    timeZone: BUSINESS_TIME_ZONE,
    accountingScope: 'NATIVE_ASSET_PROJECT_LEDGER_WITH_MARKED_STRATEGY_RESULT',
    strategy: {
      status: processStatus(runtime, processAlive),
      authorizationLifetime: arm?.authorizationLifetime || null,
      startedAt: runtime?.startedAt || null,
      lastDecision: runtime?.lastDecision || null,
      processedGenerations: Number(runtime?.processedBoardGenerations || 0),
      exactPreflights: Number(runtime?.usage?.exactPreflights || 0),
      signedAttempts: Number(runtime?.usage?.signedAttempts || 0),
      confirmedExecutions: Number(runtime?.usage?.confirmedExecutions || 0),
      unresolvedMutation: runtime?.status === 'HALTED_UNKNOWN',
      earnOnHood: arm?.earnOnHood
        ? {
            status: runtime?.earnOnHood?.status || 'UNKNOWN',
            sizing: 'BALANCE_SCALED',
            fixedPrincipalCap: null,
            lifetimeGasSurplusEth:
              runtime?.usage?.earnLifetimeGasSurplusEth || decimal(arm.earnOnHood.initialGasSurplusWei, 18),
            confirmedExecutions: Number(runtime?.usage?.confirmedByBase?.EARN_ETH || 0),
            currentNetEth: runtime?.usage?.earnCurrentAuthorizationNetEth || null,
            lastResult: runtime?.earnOnHood?.lastResult || null,
            lastDynamicMaximumPrincipalEth: runtime?.earnOnHood?.lastDynamicMaximumPrincipalEth || null,
            nextPeriodicAt: runtime?.earnOnHood?.nextPeriodicAt || null,
          }
        : null,
    },
    capital: {
      spendableUsdg: spendablePrincipal(arm, usdgState, 'USDG'),
      spendableWeth: spendablePrincipal(arm, wethState, 'WETH'),
      hardCapUsdg: arm?.usdgHardCapWei ? decimal(arm.usdgHardCapWei, 6) : null,
      hardCapWeth: arm?.wethHardCapWei ? decimal(arm.wethHardCapWei, 18) : null,
      gasReserveEth: arm?.walletEthReserveWei ? decimal(arm.walletEthReserveWei, 18) : null,
      walletGasLastVerifiedEth: verifiedWallet?.walletEth || null,
      walletGasVerifiedAt: verifiedWallet?.at || null,
      earnPrincipalMode: arm?.earnOnHood ? 'BALANCE_SCALED_NO_FIXED_CAP' : null,
    },
    economics: {
      project: summarizeProjectEconomics(activities),
      today: {
        ...executionSummary(executions, earnExecutions, { periodKey: today }),
        ...failedGasSummary(auditRecords, today),
      },
      previousDay: {
        ...executionSummary(executions, earnExecutions, { periodKey: yesterday }),
        ...failedGasSummary(auditRecords, yesterday),
      },
      allTime: {
        ...executionSummary(executions, earnExecutions),
        ...failedGasSummary(auditRecords),
      },
      activeStrategy: authorizationId
        ? {
            ...executionSummary(executions, earnExecutions, { authorizationId }),
            ...failedGasSummary(auditRecords.filter((record) => record?.authorizationId === authorizationId)),
          }
        : null,
      lastSevenDays: dailySeries(timestamp, executions, earnExecutions, auditRecords),
    },
    market: {
      status: board?.health?.status || board?.overview?.serviceStatus || 'UNKNOWN',
      candidateTokens: board?.overview?.coverage?.candidateTokens ?? null,
      freshQuotes: board?.overview?.freshCandidates ?? null,
      screenedPositive: board?.overview?.screenedPositive ?? null,
      exactReady: board?.overview?.exactReady ?? null,
      sourceCounts: {
        pairListings: board?.sources?.pairListings ?? null,
        longRoutes: board?.sources?.longLaunches ?? null,
        dopplerTargets: board?.sources?.dopplerTargetsDiscovered ?? null,
        retainedPools: board?.sources?.genericPools ?? null,
      },
    },
    recentExecutions,
    activities,
    delivery: {
      status: delivery?.lastSuccessAt ? 'CONNECTED' : 'PENDING_FIRST_DELIVERY',
      lastSuccessAt: delivery?.lastSuccessAt || null,
      lastPeriodKey: delivery?.lastPeriodKey || null,
      nextReportAt: schedule.nextReportAt,
      schedule: `${String(reportHour).padStart(2, '0')}:${String(reportMinute).padStart(2, '0')}`,
    },
    portfolio,
  }
  assertPublicBusinessSnapshot(snapshot)
  return snapshot
}

/**
 * Build a small, public read model that remains honest about two different
 * accounting layers:
 *
 * - marked execution net is receipt-gated and already deducts each strategy's
 *   declared successful-transaction Gas treatment;
 * - project effects retain their native asset and include only registered
 *   costs, so they remain PARTIAL until all operating costs are reconciled.
 */
export function buildDailyProfitSnapshot(snapshot) {
  assertPublicBusinessSnapshot(snapshot)
  const today = shanghaiDateKey(snapshot.generatedAt)
  const activities = Array.isArray(snapshot.activities) ? snapshot.activities : []
  const days = (snapshot.economics?.lastSevenDays || []).map((period) => {
    const periodActivities = activities.filter((activity) => {
      try {
        return shanghaiDateKey(activity.occurredAt) === period.periodKey
      } catch {
        return false
      }
    })
    const project = summarizeProjectEconomics(periodActivities)
    return {
      date: period.periodKey,
      periodStatus: period.periodKey === today ? 'IN_PROGRESS' : 'FINAL',
      evidenceStatus: 'RECEIPT_GATED',
      successfulTrades: Number(period.confirmedExecutions || 0),
      markedTradingNetByAsset: [
        { asset: 'USDG', value: String(period.verifiedExecutionNetUsdg || '0') },
        { asset: 'ETH', value: String(period.verifiedExecutionNetEth || '0') },
      ],
      failedTransactions: Number(period.failedTransactions || 0),
      failedGasByAsset: [{ asset: 'ETH', value: String(period.failedGasEth || '0') }],
      projectResultByAsset: project.byAsset,
      businessNet: {
        state: 'UNKNOWN',
        reason: 'OPERATING_COST_COVERAGE_PARTIAL',
      },
    }
  })
  const result = {
    schemaVersion: DAILY_PROFIT_SCHEMA_VERSION,
    mode: DAILY_PROFIT_MODE,
    generatedAt: snapshot.generatedAt,
    timeZone: BUSINESS_TIME_ZONE,
    coverage: {
      execution: 'RECEIPT_GATED',
      project: snapshot.economics?.project?.coverage || 'PARTIAL',
      businessNet: 'UNKNOWN',
    },
    accountingNote:
      'USDG is the existing conservative marked strategy result; native project effects remain separate by asset. Missing operating costs are UNKNOWN, never zero.',
    days,
  }
  assertPublicDailyProfitSnapshot(result)
  return result
}

export function formatFeishuDailyReport(snapshot, periodKey) {
  const period = snapshot.economics.lastSevenDays.find((item) => item.periodKey === periodKey)
  if (!period) throw new Error('requested report period is outside the retained daily series')
  const display = (value, digits = 2) => {
    const numeric = Number(value)
    if (!Number.isFinite(numeric)) return '待核验'
    return new Intl.NumberFormat('zh-CN', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(numeric)
  }
  const signed = (value, digits = 2) => {
    const numeric = Number(value)
    if (!Number.isFinite(numeric)) return '待核验'
    return `${numeric > 0 ? '+' : ''}${display(numeric, digits)}`
  }
  const active = snapshot.economics.activeStrategy
  const portfolio = snapshot.portfolio
  const systemLabel = snapshot.strategy.status === 'RUNNING' ? '运行中' : '需要检查'
  const marketLabel = ['RUNNING', 'SCANNING', 'HEALTHY'].includes(snapshot.market.status) ? '扫描正常' : '扫描降级'
  return [
    `【MANGA 套利经营日报｜${periodKey}】`,
    `昨日结果：已确认净收益 ${signed(period.verifiedExecutionNetUsdg)} USDG；${signed(period.verifiedExecutionNetEth, 6)} ETH`,
    `成交：${period.confirmedExecutions} 笔（USDG 本金 ${period.confirmedByBase.USDG} 笔，WETH 本金 ${period.confirmedByBase.WETH} 笔，Earn ETH ${period.confirmedByBase.EARN_ETH} 笔）`,
    `失败成本：${display(period.failedGasEth, 6)} ETH（${period.failedTransactions} 笔失败交易）`,
    `当前策略：${systemLabel}，累计净收益 ${signed(active?.verifiedExecutionNetUsdg || 0)} USDG；${signed(active?.verifiedExecutionNetEth || 0, 6)} ETH，共 ${active?.confirmedExecutions || 0} 笔`,
    `可复投资金：${display(snapshot.capital.spendableUsdg)} USDG；${display(snapshot.capital.spendableWeth, 4)} WETH`,
    `当前机会：可以执行 ${snapshot.market.exactReady ?? 0} 条；接近门槛 ${snapshot.market.screenedPositive ?? 0} 条`,
    portfolio
      ? `资金监控：${portfolio.summary.activeObjects} 个活跃地址；${portfolio.summary.parkedObjects} 个待归集地址（${display(portfolio.summary.parkedUsdg)} USDG）`
      : '资金监控：统一快照待核验',
    `数据状态：${marketLabel}`,
    '说明：收益只计入链上已确认、余额已核对的且已扣成功交易 Gas 的成交；未成交价差不算收益。',
  ].join('\n')
}

export function assertFeishuWebhookUrl(value) {
  const url = new URL(String(value || '').trim())
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'open.feishu.cn' ||
    !/^\/open-apis\/bot\/v2\/hook\/[A-Za-z0-9_-]{20,}$/.test(url.pathname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error('invalid Feishu custom-bot webhook')
  }
  return url.toString()
}

export function assertPublicBusinessSnapshot(snapshot) {
  if (
    snapshot?.schemaVersion !== BUSINESS_SNAPSHOT_SCHEMA_VERSION ||
    snapshot?.mode !== BUSINESS_SNAPSHOT_MODE ||
    !Number.isFinite(Date.parse(snapshot.generatedAt))
  ) {
    throw new Error('invalid business snapshot identity')
  }
  const serialized = JSON.stringify(snapshot)
  if (/private.?key|signed.?raw|webhook|rpc.?url|authorization.?id|wallet.?address/i.test(serialized)) {
    throw new Error('business snapshot contains a forbidden sensitive field')
  }
  return snapshot
}

export function assertPublicDailyProfitSnapshot(snapshot) {
  if (
    snapshot?.schemaVersion !== DAILY_PROFIT_SCHEMA_VERSION ||
    snapshot?.mode !== DAILY_PROFIT_MODE ||
    snapshot?.timeZone !== BUSINESS_TIME_ZONE ||
    !Number.isFinite(Date.parse(snapshot.generatedAt)) ||
    !Array.isArray(snapshot.days) ||
    snapshot.days.length > 8
  ) {
    throw new Error('invalid daily profit snapshot identity')
  }
  const dates = new Set()
  for (const day of snapshot.days) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day?.date || '') || dates.has(day.date)) {
      throw new Error('invalid or duplicate daily profit period')
    }
    dates.add(day.date)
    if (!['IN_PROGRESS', 'FINAL'].includes(day.periodStatus)) {
      throw new Error('invalid daily profit period status')
    }
    if (day.businessNet?.state !== 'UNKNOWN') {
      throw new Error('daily business net must remain unknown while cost coverage is partial')
    }
  }
  const serialized = JSON.stringify(snapshot)
  if (
    Buffer.byteLength(serialized) > MAX_DAILY_PROFIT_SNAPSHOT_BYTES ||
    /private.?key|signed.?raw|webhook|rpc.?url|authorization.?id|wallet.?address|transaction.?hash/i.test(serialized)
  ) {
    throw new Error('daily profit snapshot contains forbidden data')
  }
  return snapshot
}

export function readPublicBusinessSnapshot(file, { now = Date.now(), maxAgeMs = null } = {}) {
  const metadata = fs.statSync(file)
  if (!metadata.isFile() || metadata.size <= 0 || metadata.size > MAX_PUBLIC_SNAPSHOT_BYTES) {
    throw new Error('business snapshot file is invalid')
  }
  if ((metadata.mode & 0o022) !== 0) throw new Error('business snapshot must not be group- or world-writable')
  const snapshot = assertPublicBusinessSnapshot(JSON.parse(fs.readFileSync(file, 'utf8')))
  if (maxAgeMs !== null) {
    if (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0) throw new Error('invalid business snapshot freshness limit')
    const age = Number(now) - Date.parse(snapshot.generatedAt)
    if (!Number.isFinite(age) || age < 0 || age > maxAgeMs) throw new Error('business snapshot is stale')
  }
  return snapshot
}
