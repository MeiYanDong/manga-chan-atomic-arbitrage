export const CRITICAL_ALERT_POLICY = 'ARMED_SIGNER_TRANSITION_ALERTS_V1'
export const DEFAULT_RUNTIME_STALE_MS = 180_000
export const DEFAULT_PLANNED_STOP_GRACE_MS = 15 * 60_000
export const DEFAULT_ARM_START_GRACE_MS = 5 * 60_000
export const DEFAULT_SUSTAINED_LANE_ERRORS = 3

const TERMINAL_STATUS_REASON = new Map([
  ['HALTED_UNKNOWN', '交易状态未知，需要先核对链上回执和 nonce'],
  ['HALTED_INVARIANT', '关键运行不变量失败，实盘已安全停止'],
  ['HALTED_NONCE_CONFLICT', '检测到 nonce 冲突，实盘已安全停止'],
  ['HALTED_STARTUP', '启动身份或运行条件校验失败'],
])

function timestamp(value) {
  const parsed = Date.parse(String(value || ''))
  return Number.isFinite(parsed) ? parsed : null
}

function result(state, reasonCode, reasonLabel, details = {}) {
  return { policy: CRITICAL_ALERT_POLICY, state, reasonCode, reasonLabel, ...details }
}

/**
 * This policy intentionally ignores ordinary no-shot decisions and isolated
 * transport errors. It pages only when an active authorization has lost the
 * ability to trade, entered a terminal safety state, gone stale, or sustained
 * repeated lane failures.
 *
 * @param {{arm?: Record<string, any> | null, revocation?: Record<string, any> | null, runtime?: Record<string, any> | null, processAlive?: boolean, nowMs?: number, staleMs?: number, plannedStopGraceMs?: number, armStartGraceMs?: number, sustainedLaneErrors?: number}} input
 */
export function evaluateCriticalTradingHealth(input = {}) {
  const {
    arm = null,
    revocation = null,
    runtime = null,
    processAlive = false,
    nowMs = Date.now(),
    staleMs = DEFAULT_RUNTIME_STALE_MS,
    plannedStopGraceMs = DEFAULT_PLANNED_STOP_GRACE_MS,
    armStartGraceMs = DEFAULT_ARM_START_GRACE_MS,
    sustainedLaneErrors = DEFAULT_SUSTAINED_LANE_ERRORS,
  } = input
  const authorizationActive =
    arm?.status === 'ARMED' && (!revocation || revocation.authorizationId !== arm.authorizationId)
  if (!authorizationActive) return result('INACTIVE', 'AUTHORIZATION_INACTIVE', '实盘授权未开启')
  if (!runtime) return result('CRITICAL', 'RUNTIME_STATE_MISSING', '实盘运行状态文件缺失')

  const updatedAtMs = timestamp(runtime.updatedAt)
  const ageMs = updatedAtMs === null ? Number.POSITIVE_INFINITY : Math.max(0, nowMs - updatedAtMs)
  if (TERMINAL_STATUS_REASON.has(runtime.status)) {
    return result('CRITICAL', runtime.status, TERMINAL_STATUS_REASON.get(runtime.status), { ageMs })
  }
  if (!processAlive) {
    if (runtime.status === 'STOPPED_BY_SIGNAL' && ageMs <= plannedStopGraceMs) {
      return result('GRACE', 'PLANNED_STOP_GRACE', '受控维护停止，等待重新启动', { ageMs })
    }
    if (runtime.status === 'ARMED_NOT_RUNNING' && ageMs <= armStartGraceMs) {
      return result('GRACE', 'ARM_START_GRACE', '实盘刚授权，等待启动', { ageMs })
    }
    return result('CRITICAL', 'ARMED_PROCESS_DOWN', '授权仍开启，但实盘交易进程已经停止', { ageMs })
  }
  if (ageMs > staleMs) {
    return result('CRITICAL', 'RUNTIME_HEARTBEAT_STALE', '实盘进程仍在，但运行心跳已经失联', { ageMs })
  }

  const laneErrors = {
    global: Number(runtime.consecutiveGlobalErrors || 0),
    earn: Number(runtime.consecutiveEarnErrors || 0),
    execution: Number(runtime.consecutiveExecutionRpcErrors || 0),
  }
  const impaired = Object.entries(laneErrors).find(
    ([, count]) => Number.isFinite(count) && count >= sustainedLaneErrors,
  )
  if (impaired) {
    const laneLabel = impaired[0] === 'global' ? '全局跨池' : impaired[0] === 'earn' ? 'Earn' : '基础执行'
    return result('CRITICAL', `SUSTAINED_${impaired[0].toUpperCase()}_FAILURE`, `${laneLabel}通道连续故障`, {
      ageMs,
      consecutiveErrors: impaired[1],
    })
  }
  return result('HEALTHY', 'TRADING_HEALTHY', '实盘交易进程运行正常', { ageMs })
}

/** @param {Record<string, any> | null} previous @param {Record<string, any>} current */
export function criticalAlertTransition(previous, current) {
  const previousHealth = previous?.health || null
  if (current.state === 'CRITICAL') {
    if (previousHealth?.state !== 'CRITICAL') return 'ALERT'
    return 'NONE'
  }
  if (current.state === 'HEALTHY' && previousHealth?.state === 'CRITICAL' && previous?.notification === 'DELIVERED') {
    return 'RECOVERY'
  }
  return 'NONE'
}

function beijingTime(now) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(now)
}

/** @param {'ALERT' | 'RECOVERY' | 'ACTIVATED'} kind @param {Record<string, any>} health @param {Date} [now] */
export function formatCriticalAlert(kind, health, now = new Date()) {
  if (kind === 'ACTIVATED') {
    return [
      '【MANGA 关键提醒已启用】',
      `时间：${beijingTime(now)}`,
      '只提醒：实盘进程停止、交易状态未知、nonce/关键校验失败、持续通道故障，以及故障后的恢复。',
      '不会提醒：没有机会、利润不足、普通候选过滤或单次 RPC 波动。',
    ].join('\n')
  }
  if (kind === 'RECOVERY') {
    return [
      '【MANGA 实盘已恢复】',
      `时间：${beijingTime(now)}`,
      '状态：交易进程、授权和运行心跳已恢复正常。',
      '说明：净利润、Gas、nonce 和链上回执门槛保持不变。',
    ].join('\n')
  }
  return [
    '【MANGA 实盘需要处理】',
    `时间：${beijingTime(now)}`,
    `原因：${health.reasonLabel}`,
    '影响：当前全部或部分套利通道无法正常参赛。',
    '处理边界：不要盲目重启；先核对授权、nonce 和未决交易，再恢复实盘。',
  ].join('\n')
}
