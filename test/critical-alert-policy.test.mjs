import assert from 'node:assert/strict'
import test from 'node:test'
import {
  criticalAlertTransition,
  evaluateCriticalTradingHealth,
  formatCriticalAlert,
} from '../src/critical-alert-policy.mjs'

const NOW = Date.parse('2026-09-14T16:00:00.000Z')
const arm = { status: 'ARMED', authorizationId: '0xauthorization' }

function runtime(overrides = {}) {
  return {
    status: 'RUNNING',
    pid: 42,
    updatedAt: '2026-09-14T15:59:30.000Z',
    consecutiveGlobalErrors: 0,
    consecutiveEarnErrors: 0,
    consecutiveExecutionRpcErrors: 0,
    ...overrides,
  }
}

test('critical alert policy stays silent for no-shot and isolated RPC degradation', () => {
  for (const value of [
    runtime({ lastDecision: 'NO_SCREENED_OPPORTUNITY' }),
    runtime({ status: 'DEGRADED_GLOBAL', consecutiveGlobalErrors: 1 }),
    runtime({ status: 'EXECUTING', updatedAt: '2026-09-14T15:58:30.000Z' }),
  ]) {
    assert.equal(
      evaluateCriticalTradingHealth({ arm, runtime: value, processAlive: true, nowMs: NOW }).state,
      'HEALTHY',
    )
  }
})

test('active asynchronous reconciliation stays quiet before paging only if it stalls', () => {
  const reconciling = runtime({
    status: 'RECONCILING_UNKNOWN',
    signingPause: { startedAt: '2026-09-14T15:58:00.000Z' },
  })
  assert.equal(
    evaluateCriticalTradingHealth({ arm, runtime: reconciling, processAlive: true, nowMs: NOW }).reasonCode,
    'ASYNC_RECONCILIATION_ACTIVE',
  )
  const stalled = evaluateCriticalTradingHealth({
    arm,
    runtime: reconciling,
    processAlive: true,
    nowMs: NOW,
    reconciliationAlertMs: 60_000,
  })
  assert.equal(stalled.state, 'CRITICAL')
  assert.equal(stalled.reasonCode, 'RECONCILIATION_STALLED')
  assert.equal(stalled.userActionLabel, '暂时无需操作。')
})

test('critical alert policy detects an armed dead process and terminal safety states', () => {
  assert.equal(
    evaluateCriticalTradingHealth({ arm, runtime: runtime(), processAlive: false, nowMs: NOW }).reasonCode,
    'ARMED_PROCESS_DOWN',
  )
  for (const status of ['HALTED_UNKNOWN', 'HALTED_INVARIANT', 'HALTED_NONCE_CONFLICT', 'HALTED_STARTUP']) {
    const health = evaluateCriticalTradingHealth({ arm, runtime: runtime({ status }), processAlive: false, nowMs: NOW })
    assert.equal(health.state, 'CRITICAL')
    assert.equal(health.reasonCode, status)
  }
})

test('critical alert policy grants bounded maintenance and arm-start grace', () => {
  assert.equal(
    evaluateCriticalTradingHealth({
      arm,
      runtime: runtime({ status: 'STOPPED_BY_SIGNAL' }),
      processAlive: false,
      nowMs: NOW,
    }).state,
    'GRACE',
  )
  assert.equal(
    evaluateCriticalTradingHealth({
      arm,
      runtime: runtime({ status: 'ARMED_NOT_RUNNING' }),
      processAlive: false,
      nowMs: NOW,
    }).state,
    'GRACE',
  )
})

test('critical alert policy pages only after a sustained lane failure', () => {
  assert.equal(
    evaluateCriticalTradingHealth({
      arm,
      runtime: runtime({ status: 'DEGRADED_GLOBAL', consecutiveGlobalErrors: 2 }),
      processAlive: true,
      nowMs: NOW,
    }).state,
    'HEALTHY',
  )
  const critical = evaluateCriticalTradingHealth({
    arm,
    runtime: runtime({ status: 'DEGRADED_GLOBAL', consecutiveGlobalErrors: 3 }),
    processAlive: true,
    nowMs: NOW,
  })
  assert.equal(critical.state, 'CRITICAL')
  assert.equal(critical.reasonCode, 'SUSTAINED_GLOBAL_FAILURE')

  assert.equal(
    evaluateCriticalTradingHealth({
      arm,
      runtime: runtime({ status: 'DEGRADED_BOARD', consecutiveBoardErrors: 29 }),
      processAlive: true,
      nowMs: NOW,
    }).state,
    'HEALTHY',
  )
  const boardCritical = evaluateCriticalTradingHealth({
    arm,
    runtime: runtime({ status: 'DEGRADED_BOARD', consecutiveBoardErrors: 30 }),
    processAlive: true,
    nowMs: NOW,
  })
  assert.equal(boardCritical.state, 'CRITICAL')
  assert.equal(boardCritical.reasonCode, 'SUSTAINED_BOARD_FAILURE')
})

test('critical notifications are transition-only and recovery is emitted once', () => {
  const critical = evaluateCriticalTradingHealth({ arm, runtime: runtime(), processAlive: false, nowMs: NOW })
  assert.equal(criticalAlertTransition(null, critical), 'ALERT')
  assert.equal(criticalAlertTransition({ health: critical, notification: 'DELIVERED' }, critical), 'NONE')
  const changedCritical = evaluateCriticalTradingHealth({
    arm,
    runtime: runtime({ status: 'HALTED_NONCE_CONFLICT' }),
    processAlive: false,
    nowMs: NOW,
  })
  assert.equal(criticalAlertTransition({ health: critical, notification: 'DELIVERED' }, changedCritical), 'NONE')
  const healthy = evaluateCriticalTradingHealth({ arm, runtime: runtime(), processAlive: true, nowMs: NOW })
  assert.equal(criticalAlertTransition({ health: critical, notification: 'DELIVERED' }, healthy), 'RECOVERY')
  assert.equal(criticalAlertTransition({ health: healthy, notification: 'DELIVERED' }, healthy), 'NONE')
})

test('critical alert copy is concise and excludes operational raw fields', () => {
  const health = evaluateCriticalTradingHealth({ arm, runtime: runtime(), processAlive: false, nowMs: NOW })
  const message = formatCriticalAlert('ALERT', health, new Date(NOW))
  assert.match(message, /实盘已暂停/)
  assert.match(message, /情况：自动交易程序已经停止/)
  assert.match(message, /影响：当前不会发现并执行新的套利交易/)
  assert.match(message, /你需要做：先无需操作；若 10 分钟内未收到恢复通知，请在 Codex 中说“检查实盘”/)
  assert.doesNotMatch(message, /授权|nonce|未决交易|RPC/)
  assert.doesNotMatch(message, /0x[0-9a-f]+|webhook|RPC URL|authorizationId/i)
})
