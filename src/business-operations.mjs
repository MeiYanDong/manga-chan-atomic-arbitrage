import fs from 'node:fs'
import { formatUnits } from 'viem'
import { dualSpendablePrincipal } from './dual-live-policy.mjs'

export const BUSINESS_SNAPSHOT_SCHEMA_VERSION = 1
export const BUSINESS_SNAPSHOT_MODE = 'READ_ONLY_SANITIZED_OPERATIONS'
export const BUSINESS_TIME_ZONE = 'Asia/Shanghai'
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1_000
const MAX_PUBLIC_SNAPSHOT_BYTES = 1_000_000

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

function executionSummary(records, { periodKey = null, authorizationId = null } = {}) {
  const selected = records.filter((record) => {
    if (periodKey && executionDateKey(record) !== periodKey) return false
    return !authorizationId || record?.authorizationId === authorizationId
  })
  const netUsdgWei = selected.reduce((sum, record) => sum + executionNetUsdgWei(record), 0n)
  return {
    periodKey,
    confirmedExecutions: selected.length,
    confirmedByBase: {
      USDG: selected.filter((record) => executionBase(record) === 'USDG').length,
      WETH: selected.filter((record) => executionBase(record) === 'WETH').length,
    },
    verifiedExecutionNetUsdg: decimal(netUsdgWei, 6),
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

function dailySeries(now, executions, auditRecords) {
  const today = shanghaiDateKey(now)
  const results = []
  for (let offset = 6; offset >= 0; offset -= 1) {
    const periodKey = shiftDateKey(today, -offset)
    results.push({
      ...executionSummary(executions, { periodKey }),
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
}) {
  const timestamp = asDate(now)
  const executions = [...(usdgState?.executions || []), ...(wethState?.executions || [])]
  const authorizationId = arm?.authorizationId || null
  const today = shanghaiDateKey(timestamp)
  const yesterday = shiftDateKey(today, -1)
  const verifiedWallet = lastRuntimeVerification(auditRecords)
  const schedule = dailyReportSchedule(timestamp, reportHour, reportMinute)
  const recentExecutions = [...executions]
    .sort((left, right) => Date.parse(right.confirmedAt || 0) - Date.parse(left.confirmedAt || 0))
    .slice(0, 12)
    .map(recentExecution)
  const snapshot = {
    schemaVersion: BUSINESS_SNAPSHOT_SCHEMA_VERSION,
    mode: BUSINESS_SNAPSHOT_MODE,
    generatedAt: timestamp.toISOString(),
    timeZone: BUSINESS_TIME_ZONE,
    accountingScope: 'CANONICAL_RECEIPT_BALANCE_EFFECT_AND_MARKED_EXECUTION_GAS_ONLY',
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
    },
    capital: {
      spendableUsdg: spendablePrincipal(arm, usdgState, 'USDG'),
      spendableWeth: spendablePrincipal(arm, wethState, 'WETH'),
      hardCapUsdg: arm?.usdgHardCapWei ? decimal(arm.usdgHardCapWei, 6) : null,
      hardCapWeth: arm?.wethHardCapWei ? decimal(arm.wethHardCapWei, 18) : null,
      gasReserveEth: arm?.walletEthReserveWei ? decimal(arm.walletEthReserveWei, 18) : null,
      walletGasLastVerifiedEth: verifiedWallet?.walletEth || null,
      walletGasVerifiedAt: verifiedWallet?.at || null,
    },
    economics: {
      today: {
        ...executionSummary(executions, { periodKey: today }),
        ...failedGasSummary(auditRecords, today),
      },
      previousDay: {
        ...executionSummary(executions, { periodKey: yesterday }),
        ...failedGasSummary(auditRecords, yesterday),
      },
      allTime: {
        ...executionSummary(executions),
        ...failedGasSummary(auditRecords),
      },
      activeStrategy: authorizationId
        ? {
            ...executionSummary(executions, { authorizationId }),
            ...failedGasSummary(auditRecords.filter((record) => record?.authorizationId === authorizationId)),
          }
        : null,
      lastSevenDays: dailySeries(timestamp, executions, auditRecords),
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
    delivery: {
      status: delivery?.lastSuccessAt ? 'CONNECTED' : 'PENDING_FIRST_DELIVERY',
      lastSuccessAt: delivery?.lastSuccessAt || null,
      lastPeriodKey: delivery?.lastPeriodKey || null,
      nextReportAt: schedule.nextReportAt,
      schedule: `${String(reportHour).padStart(2, '0')}:${String(reportMinute).padStart(2, '0')}`,
    },
  }
  assertPublicBusinessSnapshot(snapshot)
  return snapshot
}

export function formatFeishuDailyReport(snapshot, periodKey) {
  const period = snapshot.economics.lastSevenDays.find((item) => item.periodKey === periodKey)
  if (!period) throw new Error('requested report period is outside the retained daily series')
  const signedNet = Number(period.verifiedExecutionNetUsdg) >= 0 ? '+' : ''
  const strategyNet = snapshot.economics.activeStrategy?.verifiedExecutionNetUsdg || '0'
  const systemLabel = snapshot.strategy.status === 'RUNNING' ? '运行中' : '需要检查'
  const marketLabel = ['RUNNING', 'SCANNING', 'HEALTHY'].includes(snapshot.market.status) ? '扫描正常' : '扫描降级'
  return [
    `【MANGA 经营日报｜${periodKey}（北京时间）】`,
    `已核验交易净利润：${signedNet}${period.verifiedExecutionNetUsdg} USDG`,
    `成交：${period.confirmedExecutions} 笔（USDG ${period.confirmedByBase.USDG} / WETH ${period.confirmedByBase.WETH}）`,
    `失败 Gas：${period.failedGasEth} ETH（${period.failedTransactions} 笔）`,
    `活跃双资产策略累计：${strategyNet} USDG（${snapshot.economics.activeStrategy?.confirmedExecutions || 0} 笔）`,
    `当前可复投：${snapshot.capital.spendableUsdg || '待核验'} USDG + ${snapshot.capital.spendableWeth || '待核验'} WETH`,
    `机会：扫描 ${snapshot.market.candidateTokens ?? '待核验'} 个标的，当前达到执行门槛 ${snapshot.market.exactReady ?? 0} 条`,
    `系统：${systemLabel}｜${marketLabel}`,
    '口径：仅统计 canonical receipt、余额效果与已标记交易 Gas；部署成本和未核验资金流单列，不虚构经营净利润。',
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
