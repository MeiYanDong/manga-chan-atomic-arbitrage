import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DailyHotRpcBudget,
  HotRpcLaneDecision,
  jsonRpcCallCount,
  latencyPercentiles,
  selectHotRpcLane,
  utcDayKey,
  validateManagedHotRpcUrl,
} from '../src/hot-rpc-lane.mjs'

test('managed hot RPC configuration rejects missing, public and aliased endpoints without exposing values', () => {
  assert.throws(
    () => validateManagedHotRpcUrl({ enabled: true, hotRpcUrl: null, publicRpcUrl: 'https://public.example' }),
    /requires MANGA_BOARD_HOT_RPC_URL/,
  )
  assert.throws(
    () =>
      validateManagedHotRpcUrl({
        enabled: true,
        hotRpcUrl: 'https://rpc.mainnet.chain.robinhood.com',
        publicRpcUrl: 'https://public.example',
      }),
    /managed endpoint/,
  )
  assert.throws(
    () =>
      validateManagedHotRpcUrl({
        enabled: true,
        hotRpcUrl: 'https://provider.example/rpc',
        publicRpcUrl: 'https://provider.example/rpc',
      }),
    /distinct/,
  )
  assert.doesNotThrow(() =>
    validateManagedHotRpcUrl({
      enabled: true,
      hotRpcUrl: 'https://managed.example/rpc',
      publicRpcUrl: 'https://public.example/rpc',
    }),
  )
  assert.doesNotThrow(() =>
    validateManagedHotRpcUrl({
      enabled: false,
      hotRpcUrl: null,
      publicRpcUrl: 'https://public.example/rpc',
    }),
  )
})

test('managed hot RPC is reserved for executor-compatible or executor-shape event candidates', () => {
  assert.deepEqual(selectHotRpcLane({ enabled: true, endpointConfigured: true, candidatePriorities: [2] }), {
    selected: true,
    reason: HotRpcLaneDecision.MANAGED,
  })
  assert.deepEqual(selectHotRpcLane({ enabled: true, endpointConfigured: true, candidatePriorities: [1] }), {
    selected: true,
    reason: HotRpcLaneDecision.MANAGED,
  })
  assert.deepEqual(selectHotRpcLane({ enabled: true, endpointConfigured: true, candidatePriorities: [0] }), {
    selected: false,
    reason: HotRpcLaneDecision.PUBLIC_LOW_PRIORITY,
  })
  assert.deepEqual(selectHotRpcLane({ enabled: false, endpointConfigured: true, candidatePriorities: [2] }), {
    selected: false,
    reason: HotRpcLaneDecision.PUBLIC_DISABLED,
  })
  assert.deepEqual(selectHotRpcLane({ enabled: true, endpointConfigured: false, candidatePriorities: [2] }), {
    selected: false,
    reason: HotRpcLaneDecision.PUBLIC_MISSING_ENDPOINT,
  })
})

test('daily managed-RPC budget survives restart and refuses to exceed either hard cap', () => {
  let nowMs = Date.parse('2026-09-10T23:59:00Z')
  let persisted = null
  const budget = new DailyHotRpcBudget({
    dailyEventCandidateCap: 2,
    dailyLogicalCallCap: 3,
    now: () => nowMs,
    onChange: (state) => {
      persisted = { ...state }
    },
  })

  assert.equal(budget.admitEventCandidates(1).admitted, true)
  assert.equal(budget.consumeLogicalCalls(2).consumed, true)
  assert.equal(budget.consumeLogicalCalls(2).consumed, false)
  assert.equal(budget.admitEventCandidates(1).admitted, true)
  assert.equal(budget.admitEventCandidates(1).admitted, false)
  assert.equal(budget.snapshot().consumedLogicalCalls, 2)

  const restored = new DailyHotRpcBudget({
    dailyEventCandidateCap: 2,
    dailyLogicalCallCap: 3,
    persisted,
    now: () => nowMs,
  })
  assert.equal(restored.snapshot().admittedEventCandidates, 2)
  assert.equal(restored.consumeLogicalCalls(1).consumed, true)
  assert.equal(restored.consumeLogicalCalls(1).consumed, false)

  nowMs = Date.parse('2026-09-11T00:00:00Z')
  assert.deepEqual(restored.snapshot(), {
    schemaVersion: 1,
    dayUtc: '2026-09-11',
    admittedEventCandidates: 0,
    consumedLogicalCalls: 0,
    updatedAt: '2026-09-11T00:00:00.000Z',
    dailyEventCandidateCap: 2,
    dailyLogicalCallCap: 3,
    remainingEventCandidates: 2,
    remainingLogicalCalls: 3,
  })
})

test('logical call accounting understands individual and batched JSON-RPC bodies', () => {
  assert.equal(jsonRpcCallCount('{"jsonrpc":"2.0","id":1,"method":"eth_call","params":[]}'), 1)
  assert.equal(
    jsonRpcCallCount(
      '[{"jsonrpc":"2.0","id":1,"method":"eth_call","params":[]},{"jsonrpc":"2.0","id":2,"method":"eth_blockNumber","params":[]}]',
    ),
    2,
  )
  assert.equal(jsonRpcCallCount('not-json'), 1)
  assert.equal(jsonRpcCallCount(undefined), 1)
})

test('managed-RPC latency telemetry reports bounded percentile evidence', () => {
  assert.deepEqual(latencyPercentiles([]), {
    samples: 0,
    p50Ms: null,
    p95Ms: null,
    p99Ms: null,
    maxMs: null,
  })
  assert.deepEqual(latencyPercentiles([5.555, 1, 2, 3, 4, Number.NaN, -1]), {
    samples: 5,
    p50Ms: 3,
    p95Ms: 5.55,
    p99Ms: 5.55,
    maxMs: 5.55,
  })
  assert.equal(utcDayKey(Date.parse('2026-09-10T23:59:59Z')), '2026-09-10')
})
