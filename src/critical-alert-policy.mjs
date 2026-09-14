export const CRITICAL_ALERT_POLICY = 'MINIMUM_NECESSARY_TRADING_ALERTS_V2'
export const DEFAULT_RUNTIME_STALE_MS = 180_000
export const DEFAULT_PLANNED_STOP_GRACE_MS = 15 * 60_000
export const DEFAULT_ARM_START_GRACE_MS = 5 * 60_000
export const DEFAULT_RECONCILIATION_ALERT_MS = 3 * 60_000
export const DEFAULT_SUSTAINED_LANE_ERRORS = 3
export const DEFAULT_SUSTAINED_BOARD_ERRORS = 30

const TERMINAL_STATUS_REASON = new Map([
  ['HALTED_UNKNOWN', '有一笔历史交易无法自动核对，自动交易已暂停'],
  ['HALTED_INVARIANT', '程序发现关键数据不一致，自动交易已暂停'],
  ['HALTED_NONCE_CONFLICT', '钱包交易顺序与程序记录不一致，自动交易已暂停'],
  ['HALTED_STARTUP', '程序启动校验没有通过，自动交易未能启动'],
])

function timestamp(value) {
  const parsed = Date.parse(String(value || ''))
  return Number.isFinite(parsed) ? parsed : null
}

/** @returns {Record<string, any>} */
function result(state, reasonCode, reasonLabel, details = {}) {
  return { policy: CRITICAL_ALERT_POLICY, state, reasonCode, reasonLabel, ...details }
}

/**
 * This policy intentionally ignores ordinary no-shot decisions and isolated
 * transport errors. It pages only when an active authorization has lost the
 * ability to trade, entered a terminal safety state, gone stale, or sustained
 * repeated lane failures.
 *
 * @param {{arm?: Record<string, any> | null, revocation?: Record<string, any> | null, runtime?: Record<string, any> | null, processAlive?: boolean, nowMs?: number, staleMs?: number, plannedStopGraceMs?: number, armStartGraceMs?: number, reconciliationAlertMs?: number, sustainedLaneErrors?: number, sustainedBoardErrors?: number}} input
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
    reconciliationAlertMs = DEFAULT_RECONCILIATION_ALERT_MS,
    sustainedLaneErrors = DEFAULT_SUSTAINED_LANE_ERRORS,
    sustainedBoardErrors = DEFAULT_SUSTAINED_BOARD_ERRORS,
  } = input
  const authorizationActive =
    arm?.status === 'ARMED' && (!revocation || revocation.authorizationId !== arm.authorizationId)
  if (!authorizationActive) return result('INACTIVE', 'AUTHORIZATION_INACTIVE', '实盘授权未开启')
  if (!runtime)
    return result('CRITICAL', 'RUNTIME_STATE_MISSING', '程序运行记录缺失，无法确认自动交易是否正常', {
      impactLabel: '自动交易状态无法确认。',
      automaticActionLabel: '系统已停止把未知状态当作正常运行。',
      userActionLabel: '请检查经营面板或联系维护人员。',
    })

  const updatedAtMs = timestamp(runtime.updatedAt)
  const ageMs = updatedAtMs === null ? Number.POSITIVE_INFINITY : Math.max(0, nowMs - updatedAtMs)
  if (TERMINAL_STATUS_REASON.has(runtime.status)) {
    return result('CRITICAL', runtime.status, TERMINAL_STATUS_REASON.get(runtime.status), {
      ageMs,
      impactLabel: '自动交易已暂停；不会继续发送新的交易。',
      automaticActionLabel: '系统保留现场和交易记录，未盲目重试。',
      userActionLabel: '请查看经营面板中的故障结论。',
    })
  }
  if (!processAlive) {
    if (runtime.status === 'STOPPED_BY_SIGNAL' && ageMs <= plannedStopGraceMs) {
      return result('GRACE', 'PLANNED_STOP_GRACE', '受控维护停止，等待重新启动', { ageMs })
    }
    if (runtime.status === 'ARMED_NOT_RUNNING' && ageMs <= armStartGraceMs) {
      return result('GRACE', 'ARM_START_GRACE', '实盘刚授权，等待启动', { ageMs })
    }
    return result('CRITICAL', 'ARMED_PROCESS_DOWN', '自动交易程序已经停止', {
      ageMs,
      impactLabel: '当前不会发现并执行新的套利交易。',
      automaticActionLabel: '系统已保留资金和最后一次运行记录。',
      userActionLabel: '请检查经营面板或联系维护人员。',
    })
  }
  if (ageMs > staleMs) {
    return result('CRITICAL', 'RUNTIME_HEARTBEAT_STALE', '程序仍在，但运行状态已长时间没有更新', {
      ageMs,
      impactLabel: '无法确认市场扫描和自动交易是否仍在工作。',
      automaticActionLabel: '系统没有把过期状态当作正常。',
      userActionLabel: '请检查经营面板或联系维护人员。',
    })
  }

  if (runtime.status === 'RECONCILING_UNKNOWN') {
    const pauseStartedAtMs = timestamp(runtime.signingPause?.startedAt) ?? updatedAtMs
    const pauseAgeMs = Math.max(0, nowMs - pauseStartedAtMs)
    const details = {
      ageMs,
      pauseAgeMs,
      impactLabel: '新的交易暂缓；市场扫描仍在继续。',
      automaticActionLabel: '系统正在后台核对该笔交易，并在确认后自动恢复。',
      userActionLabel: '暂时无需操作。',
    }
    if (pauseAgeMs < reconciliationAlertMs) {
      return result('GRACE', 'ASYNC_RECONCILIATION_ACTIVE', '正在自动核对一笔交易', details)
    }
    return result('CRITICAL', 'RECONCILIATION_STALLED', '一笔交易长时间未能自动核对', details)
  }

  const laneErrors = [
    { key: 'global', count: Number(runtime.consecutiveGlobalErrors || 0), threshold: sustainedLaneErrors },
    { key: 'earn', count: Number(runtime.consecutiveEarnErrors || 0), threshold: sustainedLaneErrors },
    { key: 'execution', count: Number(runtime.consecutiveExecutionRpcErrors || 0), threshold: sustainedLaneErrors },
    { key: 'board', count: Number(runtime.consecutiveBoardErrors || 0), threshold: sustainedBoardErrors },
  ]
  const impaired = laneErrors.find(({ count, threshold }) => Number.isFinite(count) && count >= threshold)
  if (impaired) {
    const laneLabel =
      impaired.key === 'global'
        ? '全局跨池'
        : impaired.key === 'earn'
          ? 'Earn'
          : impaired.key === 'board'
            ? '候选数据'
            : '基础执行'
    return result('CRITICAL', `SUSTAINED_${impaired.key.toUpperCase()}_FAILURE`, `${laneLabel}通道连续故障`, {
      ageMs,
      consecutiveErrors: impaired.count,
      threshold: impaired.threshold,
      impactLabel:
        impaired.key === 'execution'
          ? '自动交易暂缓；市场扫描仍在继续。'
          : '部分市场暂时无法完整扫描；其他市场继续运行。',
      automaticActionLabel: '系统正在自动重试，未降低利润和安全门槛。',
      userActionLabel: '暂时无需操作。',
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
      '【套利关键提醒已启用】',
      `时间：${beijingTime(now)}`,
      '只在自动交易停止、交易长时间无法核对或市场扫描持续故障时提醒。',
      '没有机会、利润不足和单次网络波动不会打扰你。',
    ].join('\n')
  }
  if (kind === 'RECOVERY') {
    return [
      '【套利程序已恢复】',
      `时间：${beijingTime(now)}`,
      '结果：市场扫描和自动交易均已恢复。',
      '需要你处理：无需操作。',
    ].join('\n')
  }
  const title = health.reasonCode === 'RECONCILIATION_STALLED' ? '【一笔交易仍在核对】' : '【套利程序需要检查】'
  return [
    title,
    `时间：${beijingTime(now)}`,
    `发生了什么：${health.reasonLabel}`,
    `当前影响：${health.impactLabel || '自动交易能力受到影响。'}`,
    `系统已做：${health.automaticActionLabel || '已保留现场，未盲目发送交易。'}`,
    `需要你处理：${health.userActionLabel || '请查看经营面板。'}`,
  ].join('\n')
}
