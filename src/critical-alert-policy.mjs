export const CRITICAL_ALERT_POLICY = 'MINIMUM_NECESSARY_TRADING_ALERTS_V3'
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

const PAUSED_REASON_CODES = new Set(['ARMED_PROCESS_DOWN', 'RUNTIME_STATE_MISSING', ...TERMINAL_STATUS_REASON.keys()])

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
 * repeated failures that remove every independent discovery adapter. One
 * degraded market adapter is operational telemetry, not a user-facing page.
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
      userActionLabel: '先无需操作；若 10 分钟内未收到恢复通知，请在 Codex 中说“检查实盘”。',
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

  const executionErrors = Number(runtime.consecutiveExecutionRpcErrors || 0)
  if (Number.isFinite(executionErrors) && executionErrors >= sustainedLaneErrors) {
    return result('CRITICAL', 'SUSTAINED_EXECUTION_FAILURE', '交易提交基础能力连续故障', {
      ageMs,
      consecutiveErrors: executionErrors,
      threshold: sustainedLaneErrors,
      impactLabel: '新的自动交易暂缓；市场扫描仍在继续。',
      automaticActionLabel: '系统正在自动重试，未降低利润和安全门槛。',
      userActionLabel: '暂时无需操作。',
    })
  }

  const discoveryAdapters = [
    { key: 'global', count: Number(runtime.consecutiveGlobalErrors || 0), threshold: sustainedLaneErrors },
    { key: 'earn', count: Number(runtime.consecutiveEarnErrors || 0), threshold: sustainedLaneErrors },
    { key: 'board', count: Number(runtime.consecutiveBoardErrors || 0), threshold: sustainedBoardErrors },
  ]
  const impairedDiscovery = discoveryAdapters.filter(
    ({ count, threshold }) => Number.isFinite(count) && count >= threshold,
  )
  if (impairedDiscovery.length === discoveryAdapters.length) {
    return result('CRITICAL', 'ALL_MARKET_DISCOVERY_UNAVAILABLE', '所有市场扫描通道持续不可用', {
      ageMs,
      impairedAdapters: impairedDiscovery.map(({ key }) => key),
      impactLabel: '当前无法发现新的套利机会；尚未发现未决交易。',
      automaticActionLabel: '系统保留实盘进程并分别重试各通道，不会盲目发送交易。',
      userActionLabel: '先无需操作；若 10 分钟内未收到恢复通知，请在 Codex 中说“检查实盘”。',
    })
  }
  if (impairedDiscovery.length > 0) {
    return result('DEGRADED', 'PARTIAL_MARKET_COVERAGE', '部分市场扫描降级，其他通道继续运行', {
      ageMs,
      impairedAdapters: impairedDiscovery.map(({ key }) => key),
    })
  }
  const earnRealtime = runtime?.earnOnHood?.eventSource || null
  const sequencerRealtime = runtime?.global?.feed || null
  const earnRealtimeUnavailable =
    earnRealtime !== null &&
    (earnRealtime.status === 'DEGRADED' ||
      earnRealtime.status === 'STOPPED' ||
      (earnRealtime.status === 'SUBSCRIBED' && earnRealtime.subscriptionActive !== true))
  const sequencerRealtimeUnavailable =
    sequencerRealtime !== null &&
    sequencerRealtime.connected !== true &&
    ['REJECTED', 'ERROR', 'DISCONNECTED'].includes(sequencerRealtime.lastStatus)
  if (earnRealtimeUnavailable && sequencerRealtimeUnavailable) {
    return result('DEGRADED', 'LOW_LATENCY_INPUTS_UNAVAILABLE', '低延迟市场入口暂时不可用，回补扫描继续运行', {
      ageMs,
      impactLabel: '发现速度下降，但公共日志回补、周期扫描和安全执行门槛仍在运行。',
      automaticActionLabel: '系统分别退避重连两个实时入口，不会因此盲目发送交易。',
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
  if (
    ['HEALTHY', 'DEGRADED'].includes(current.state) &&
    previousHealth?.state === 'CRITICAL' &&
    previous?.notification === 'DELIVERED'
  ) {
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
      '【只保留重要提醒】',
      `时间：${beijingTime(now)}`,
      '会提醒：实盘停止、交易长时间无法核对、全部市场扫描同时中断。',
      '不会提醒：没有机会、利润不足、单条路线回退或单个市场短时故障。',
    ].join('\n')
  }
  if (kind === 'RECOVERY') {
    return [
      '【实盘已恢复】',
      `恢复时间：${beijingTime(now)}`,
      `状态：${
        health.state === 'DEGRADED'
          ? '至少一条市场扫描与自动交易路径已恢复；其余通道继续自动重试。'
          : '市场扫描和自动交易均已恢复。'
      }`,
      '你需要做：无。',
    ].join('\n')
  }
  const title =
    health.reasonCode === 'RECONCILIATION_STALLED'
      ? '【交易核对超时】'
      : health.reasonCode === 'ALL_MARKET_DISCOVERY_UNAVAILABLE'
        ? '【市场扫描已中断】'
        : health.reasonCode === 'SUSTAINED_EXECUTION_FAILURE'
          ? '【交易提交持续异常】'
          : PAUSED_REASON_CODES.has(health.reasonCode)
            ? '【实盘已暂停】'
            : '【实盘需要检查】'
  return [
    title,
    `时间：${beijingTime(now)}`,
    `情况：${health.reasonLabel}`,
    `影响：${health.impactLabel || '自动交易能力受到影响。'}`,
    `系统处理：${health.automaticActionLabel || '已保留现场，未盲目发送交易。'}`,
    `你需要做：${health.userActionLabel || '请在 Codex 中说“检查实盘”。'}`,
  ].join('\n')
}
