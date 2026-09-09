import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AsyncConcurrencyGate,
  CandidateWakeQueue,
  FixedBlockPromiseCache,
  ShadowWakeSource,
  applyPoolMirrorEvent,
  buildShadowDependencyIndex,
  capEventWaitForReconciliation,
  coalesceLatestSwapPerPool,
  initializeIngestNeedsCatalogRefresh,
  nextHotPollDelay,
  planHotLogRange,
  quoteCyclePolicy,
  recoverStaleHotCursor,
  reconcileHotCursorAnchor,
  retryReadOnly,
  rotatingSlice,
  routeShadowEvent,
  selectPeriodicShadowCandidates,
  selectRpcRetryPolicy,
  shouldPreemptPeriodicQuote,
} from '../src/event-driven-shadow.mjs'
import { isTransientRpcError } from '../src/policy.mjs'

test('async concurrency gate bounds simultaneous provider requests', async () => {
  const gate = new AsyncConcurrencyGate(2)
  let active = 0
  let peak = 0
  const releases = []
  const operations = Array.from({ length: 5 }, (_, index) =>
    gate.run(async () => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise((resolve) => releases.push(resolve))
      active -= 1
      return index
    }),
  )

  await Promise.resolve()
  assert.equal(active, 2)
  while (releases.length > 0 || active > 0) {
    const release = releases.shift()
    if (release) release()
    await Promise.resolve()
    await Promise.resolve()
  }
  assert.deepEqual(await Promise.all(operations), [0, 1, 2, 3, 4])
  assert.equal(peak, 2)
  assert.equal(gate.peak, 2)
})

test('rotating priority slice covers the list without selecting every priority each cycle', () => {
  const priorities = ['a', 'b', 'c', 'd', 'e']
  assert.deepEqual(rotatingSlice(priorities, 0, 2), ['a', 'b'])
  assert.deepEqual(rotatingSlice(priorities, 2, 2), ['c', 'd'])
  assert.deepEqual(rotatingSlice(priorities, 4, 2), ['e', 'a'])
  assert.deepEqual(rotatingSlice(priorities, 6, 2), ['b', 'c'])
})

test('event waiting cannot cross the mandatory reconciliation deadline', () => {
  assert.equal(capEventWaitForReconciliation(60_000, 100_000, 105_000), 5_000)
  assert.equal(capEventWaitForReconciliation(4_000, 100_000, 105_000), 4_000)
  assert.equal(capEventWaitForReconciliation(60_000, 105_000, 105_000), 0)
  assert.throws(() => capEventWaitForReconciliation(-1, 100_000, 105_000), /non-negative/)
})

test('only source-relevant Initialize ingestion requests a strategy catalog rebuild', () => {
  assert.equal(initializeIngestNeedsCatalogRefresh({ discoveredPools: 0, discoveredGenericPools: 0 }), false)
  assert.equal(initializeIngestNeedsCatalogRefresh({ discoveredPools: 1, discoveredGenericPools: 0 }), true)
  assert.equal(initializeIngestNeedsCatalogRefresh({ discoveredPools: 0, discoveredGenericPools: 1 }), true)
  assert.throws(
    () => initializeIngestNeedsCatalogRefresh({ discoveredPools: -1, discoveredGenericPools: 0 }),
    /non-negative/,
  )
})

test('busy events cannot preempt the protected periodic coverage tranche', () => {
  const limits = {
    cycleMaxCandidates: 4,
    protectedPeriodicCandidates: 1,
    eventV4PairLimit: 1,
    eventAmountLimit: 2,
    eventV3RouteLimit: 1,
    periodicV4PairLimit: 1,
    periodicAmountLimit: 1,
    periodicV3RouteLimit: 1,
  }
  assert.deepEqual(quoteCyclePolicy({ ...limits, eventWake: false }), {
    mode: 'PROTECTED_PERIODIC_RECONCILIATION',
    preemptible: false,
    maxCandidates: 1,
    probe: {
      mode: 'BOUNDED_COVERAGE_SAMPLE',
      v4PairLimit: 1,
      amountLimit: 1,
      v3RouteLimit: 1,
    },
  })
  assert.deepEqual(quoteCyclePolicy({ ...limits, eventWake: true }), {
    mode: 'EVENT_HOT_PATH',
    preemptible: false,
    maxCandidates: 4,
    probe: {
      mode: 'EVENT_KNOWN_ROUTE',
      v4PairLimit: 1,
      amountLimit: 2,
      v3RouteLimit: 1,
    },
  })
  assert.throws(() => quoteCyclePolicy({ ...limits, eventWake: false, protectedPeriodicCandidates: 0 }), /positive/)
})

test('only a newer event revision preempts an eligible periodic quote', () => {
  const context = { preemptible: true, acceptedEventsAtStart: 10, preempted: false }
  assert.equal(shouldPreemptPeriodicQuote(context, 10), false)
  assert.equal(shouldPreemptPeriodicQuote(context, 11), true)
  assert.equal(shouldPreemptPeriodicQuote({ ...context, preemptible: false }, 11), false)
  assert.equal(shouldPreemptPeriodicQuote({ ...context, preempted: true }, 10), true)
  assert.throws(() => shouldPreemptPeriodicQuote(context, -1), /non-negative/)
})

test('event quotes receive an independent fast RPC retry budget', () => {
  const policies = {
    periodic: { attempts: 3, delayMs: 1_000 },
    event: { attempts: 2, delayMs: 200 },
  }
  assert.deepEqual(selectRpcRetryPolicy(undefined, policies), {
    attempts: 3,
    delayMs: 1_000,
    eventHotPath: false,
  })
  assert.deepEqual(selectRpcRetryPolicy({ eventHotPath: true }, policies), {
    attempts: 2,
    delayMs: 200,
    eventHotPath: true,
  })
  assert.throws(
    () => selectRpcRetryPolicy({ eventHotPath: true }, { ...policies, event: { attempts: 0, delayMs: 200 } }),
    /positive safe integer/,
  )
})

test('bounded read retry recovers transient evidence but never retries a business revert', async () => {
  let transientCalls = 0
  const recovered = await retryReadOnly(
    async () => {
      transientCalls += 1
      if (transientCalls < 3) throw new Error('network')
      return 'ok'
    },
    { attempts: 3, delayMs: 0, shouldRetry: (error) => error instanceof Error && error.message === 'network' },
  )
  assert.equal(recovered, 'ok')
  assert.equal(transientCalls, 3)

  let revertCalls = 0
  await assert.rejects(
    retryReadOnly(
      async () => {
        revertCalls += 1
        throw new Error('SPL')
      },
      { attempts: 3, delayMs: 0, shouldRetry: () => false },
    ),
    /SPL/,
  )
  assert.equal(revertCalls, 1)
})

test('startup retry classification recovers a public RPC 429 but never retries an identity mismatch', async () => {
  let throttledCalls = 0
  const recovered = await retryReadOnly(
    async () => {
      throttledCalls += 1
      if (throttledCalls === 1) throw new Error('429 Too Many Requests')
      return 'canonical-readback'
    },
    { attempts: 5, delayMs: 0, shouldRetry: isTransientRpcError },
  )
  assert.equal(recovered, 'canonical-readback')
  assert.equal(throttledCalls, 2)

  let invariantCalls = 0
  await assert.rejects(
    retryReadOnly(
      async () => {
        invariantCalls += 1
        throw new Error('wrong chain id 1')
      },
      { attempts: 5, delayMs: 0, shouldRetry: isTransientRpcError },
    ),
    /wrong chain id/,
  )
  assert.equal(invariantCalls, 1)
})

test('fixed-block quote cache deduplicates concurrent equivalents and never crosses blocks', async () => {
  const cache = new FixedBlockPromiseCache()
  let calls = 0
  const operation = async () => {
    calls += 1
    return `quote-${calls}`
  }

  const first = cache.getOrCreate(100n, 'USDG:AI:5000000', operation)
  const duplicate = cache.getOrCreate(100n, 'USDG:AI:5000000', operation)
  assert.equal(first.hit, false)
  assert.equal(duplicate.hit, true)
  assert.equal(await first.promise, 'quote-1')
  assert.equal(await duplicate.promise, 'quote-1')
  assert.equal(calls, 1)

  const nextBlock = cache.getOrCreate(101n, 'USDG:AI:5000000', operation)
  assert.equal(nextBlock.hit, false)
  assert.equal(await nextBlock.promise, 'quote-2')
  assert.equal(calls, 2)
})

test('fixed-block quote cache evicts a rejected operation so a retry can recover', async () => {
  const cache = new FixedBlockPromiseCache()
  let calls = 0
  const failed = cache.getOrCreate(100n, 'route', async () => {
    calls += 1
    throw new Error('transient')
  })
  await assert.rejects(failed.promise, /transient/)

  const recovered = cache.getOrCreate(100n, 'route', async () => {
    calls += 1
    return 'ok'
  })
  assert.equal(recovered.hit, false)
  assert.equal(await recovered.promise, 'ok')
  assert.equal(calls, 2)
})

test('fixed-block evidence cache can retain a rejection until the block changes', async () => {
  const cache = new FixedBlockPromiseCache()
  let calls = 0
  const operation = async () => {
    calls += 1
    throw new Error(`failure-${calls}`)
  }

  const first = cache.getOrCreate(100n, 'factory-pair', operation, { evictRejected: false })
  await assert.rejects(first.promise, /failure-1/)
  const sameBlock = cache.getOrCreate(100n, 'factory-pair', operation, { evictRejected: false })
  assert.equal(sameBlock.hit, true)
  await assert.rejects(sameBlock.promise, /failure-1/)
  assert.equal(calls, 1)

  const nextBlock = cache.getOrCreate(101n, 'factory-pair', operation, { evictRejected: false })
  assert.equal(nextBlock.hit, false)
  await assert.rejects(nextBlock.promise, /failure-2/)
  assert.equal(calls, 2)
})

test('periodic selection caps total work while reserving coverage', () => {
  const catalog = Array.from({ length: 50 }, (_, index) => ({ id: `candidate-${index}` }))
  const observations = new Map([
    ['candidate-1', { status: 'SCREENED_NET_POSITIVE', screenedNetUsdg: '1.5' }],
    ['candidate-2', { status: 'NO_EDGE', screenedNetUsdg: '-0.1' }],
  ])
  const result = selectPeriodicShadowCandidates(catalog, observations, {
    priorityIds: ['candidate-0'],
    positiveStatuses: ['SCREENED_NET_POSITIVE', 'GROSS_POSITIVE_NET_NEGATIVE'],
    topRefreshSize: 32,
    batchSize: 4,
    cursor: 0,
    maxCandidates: 4,
  })

  assert.deepEqual(
    result.selected.map((candidate) => candidate.id),
    ['candidate-0', 'candidate-1', 'candidate-3', 'candidate-4'],
  )
  assert.equal(result.coverageAdded, 2)
})

test('periodic selection cannot let priority and positive rows starve coverage', () => {
  const catalog = Array.from({ length: 10 }, (_, index) => ({ id: `candidate-${index}` }))
  const observations = new Map(
    Array.from({ length: 6 }, (_, index) => [
      `candidate-${index}`,
      { status: 'SCREENED_NET_POSITIVE', screenedNetUsdg: String(10 - index) },
    ]),
  )
  const result = selectPeriodicShadowCandidates(catalog, observations, {
    priorityIds: ['candidate-0', 'candidate-1'],
    positiveStatuses: ['SCREENED_NET_POSITIVE'],
    topRefreshSize: 6,
    batchSize: 4,
    cursor: 0,
    maxCandidates: 4,
  })

  assert.equal(result.selected.length, 4)
  assert.equal(result.coverageAdded, 1)
  assert.equal(
    result.selected.some((candidate) => candidate.id === 'candidate-6'),
    true,
  )
})

const POOL_A = `0x${'a'.repeat(64)}`
const POOL_B = `0x${'b'.repeat(64)}`
const V3_A = `0x${'1'.repeat(40)}`

test('dependency index routes V4 and previously quoted V3 changes to only affected candidates', () => {
  const catalog = [
    { id: 'token-a', pools: [{ poolId: POOL_A }] },
    { id: 'token-b', pools: [{ poolId: POOL_B }] },
  ]
  const observations = new Map([['token-a', { entryV3Pools: [V3_A], exitV3Pools: [], amountQuotes: [] }]])
  const index = buildShadowDependencyIndex(catalog, observations)
  assert.deepEqual(routeShadowEvent({ type: ShadowWakeSource.V4_SWAP, poolId: POOL_A }, index), {
    candidateIds: ['token-a'],
    catalogRefresh: false,
  })
  assert.deepEqual(routeShadowEvent({ type: ShadowWakeSource.V3_SWAP, poolAddress: V3_A }, index), {
    candidateIds: ['token-a'],
    catalogRefresh: false,
  })
  assert.deepEqual(routeShadowEvent({ type: ShadowWakeSource.V4_INITIALIZE, poolId: POOL_A }, index), {
    candidateIds: [],
    catalogRefresh: true,
  })
})

test('dependency index includes V3 pools from nested WETH base lanes', () => {
  const catalog = [{ id: 'token-a', pools: [{ poolId: POOL_A }] }]
  const observations = new Map([
    [
      'token-a',
      {
        baseOpportunities: {
          WETH: { entryV3Pools: [V3_A], exitV3Pools: [], amountQuotes: [] },
        },
      },
    ],
  ])
  const index = buildShadowDependencyIndex(catalog, observations)
  assert.deepEqual(routeShadowEvent({ type: ShadowWakeSource.V3_SWAP, poolAddress: V3_A }, index), {
    candidateIds: ['token-a'],
    catalogRefresh: false,
  })
})

test('wake queue deduplicates logs and coalesces revisions per candidate', () => {
  const queue = new CandidateWakeQueue()
  const event = {
    type: ShadowWakeSource.V4_SWAP,
    blockNumber: 10n,
    transactionHash: '0xabc',
    logIndex: 1,
  }
  assert.deepEqual(queue.offer(event, ['TOKEN-A'], 100), { accepted: true, candidateCount: 1 })
  assert.deepEqual(queue.offer(event, ['TOKEN-A'], 101), { accepted: false, candidateCount: 0 })
  queue.offer({ ...event, transactionHash: '0xdef', blockNumber: 12n }, ['token-a', 'token-b'], 110)
  const wake = queue.take(1)
  assert.deepEqual(wake.candidateIds, ['token-a'])
  assert.equal(wake.triggers[0].eventCount, 2)
  assert.equal(wake.triggers[0].minBlock, 10n)
  assert.equal(wake.triggers[0].maxBlock, 12n)
  assert.deepEqual(wake.triggers[0].poolKeys, [])
  assert.equal(wake.newestObservedAtMs, 110)
  assert.equal(wake.staleDropped, 0)
  assert.equal(queue.size, 1)
  assert.equal(queue.dedupedEvents, 1)
})

test('wake queue drops expired backlog and prioritizes the freshest affected candidate', () => {
  const queue = new CandidateWakeQueue()
  queue.offer(
    { type: ShadowWakeSource.V4_SWAP, poolId: POOL_A, blockNumber: 10n, transactionHash: '0xold', logIndex: 1 },
    ['old'],
    100,
  )
  queue.offer(
    { type: ShadowWakeSource.V4_SWAP, poolId: POOL_B, blockNumber: 11n, transactionHash: '0xnewer', logIndex: 2 },
    ['newer'],
    180,
  )
  queue.offer(
    { type: ShadowWakeSource.V3_SWAP, poolAddress: V3_A, blockNumber: 12n, transactionHash: '0xnewest', logIndex: 3 },
    ['newest'],
    190,
  )

  const wake = queue.take(1, { nowMs: 200, maxAgeMs: 50, newestFirst: true })
  assert.deepEqual(wake.candidateIds, ['newest'])
  assert.deepEqual(wake.triggers[0].poolKeys, [V3_A])
  assert.equal(wake.newestObservedAtMs, 190)
  assert.equal(wake.staleDropped, 1)
  assert.equal(queue.staleCandidateDrops, 1)
  assert.equal(queue.size, 1)
})

test('hot ranges retain only the latest swap revision per pool while preserving initialize facts', () => {
  const initialize = {
    type: ShadowWakeSource.V4_INITIALIZE,
    poolId: POOL_A,
    blockNumber: 9n,
    logIndex: 0,
  }
  const olderV4 = {
    type: ShadowWakeSource.V4_SWAP,
    poolId: POOL_A,
    blockNumber: 10n,
    logIndex: 1,
  }
  const latestV4 = { ...olderV4, blockNumber: 12n, logIndex: 2 }
  const sameBlockLaterV4 = { ...latestV4, logIndex: 3 }
  const v3 = {
    type: ShadowWakeSource.V3_SWAP,
    poolAddress: V3_A,
    blockNumber: 11n,
    logIndex: 4,
  }

  assert.deepEqual(coalesceLatestSwapPerPool([latestV4, initialize, olderV4, v3, sameBlockLaterV4]), [
    initialize,
    v3,
    sameBlockLaterV4,
  ])
})

test('independent hot polling keeps a fixed success cadence and bounded error backoff', () => {
  assert.equal(nextHotPollDelay(4_000, 0, 1_000), 3_000)
  assert.equal(nextHotPollDelay(4_000, 0, 5_000), 0)
  assert.equal(nextHotPollDelay(4_000, 2, 1_000), 15_000)
  assert.equal(nextHotPollDelay(10_000, 20, 1_000), 59_000)
  assert.throws(() => nextHotPollDelay(0, 0, 0), /invalid hot poll timing policy/)
  assert.throws(() => nextHotPollDelay(4_000, -1, 0), /invalid hot poll timing policy/)
})

test('hot log ranges start forward-only, remain bounded and wait for confirmations', () => {
  assert.deepEqual(planHotLogRange(null, 100n, { confirmations: 2n, maxBlockRange: 10n }), {
    safeHead: 98n,
    initializedNextBlock: 99n,
    range: null,
  })
  assert.deepEqual(planHotLogRange(90n, 100n, { confirmations: 2n, maxBlockRange: 5n }).range, {
    fromBlock: 90n,
    toBlock: 94n,
  })
  assert.equal(planHotLogRange(99n, 100n, { confirmations: 2n, maxBlockRange: 5n }).range, null)
})

test('stale real-time cursor fast-forwards with an explicit coverage gap', () => {
  const recovered = recoverStaleHotCursor(
    {
      nextBlock: '100',
      lastProcessedBlock: '99',
      lastProcessedBlockHash: `0x${'a'.repeat(64)}`,
      fastForwardCount: 1,
      skippedRealtimeBlocks: '10',
    },
    1_000n,
    {
      confirmations: 2n,
      maxLagBlocks: 200n,
      reorgLookback: 12n,
      observedAt: '2030-01-01T00:00:00.000Z',
    },
  )
  assert.equal(recovered.fastForwarded, true)
  assert.equal(recovered.lagBlocks, 899n)
  assert.equal(recovered.cursor.nextBlock, '987')
  assert.equal(recovered.cursor.lastProcessedBlock, null)
  assert.equal(recovered.cursor.fastForwardCount, 2)
  assert.equal(recovered.cursor.skippedRealtimeBlocks, '897')
  assert.deepEqual(recovered.gap, {
    reason: 'STALE_REALTIME_CURSOR_FAST_FORWARD',
    fromBlock: '100',
    toBlock: '986',
    skippedBlocks: '887',
    resumedAtBlock: '987',
    safeHead: '998',
    observedAt: '2030-01-01T00:00:00.000Z',
  })
})

test('current real-time cursor never creates a false coverage gap', () => {
  const current = recoverStaleHotCursor({ nextBlock: '950', lastProcessedBlock: '949', fastForwardCount: 0 }, 1_000n, {
    confirmations: 2n,
    maxLagBlocks: 200n,
    reorgLookback: 12n,
  })
  assert.equal(current.fastForwarded, false)
  assert.equal(current.lagBlocks, 49n)
  assert.equal(current.gap, null)
  assert.equal(current.cursor.nextBlock, '950')
})

test('canonical anchor mismatch rewinds and records a reorg', () => {
  const cursor = {
    nextBlock: '101',
    lastProcessedBlock: '100',
    lastProcessedBlockHash: `0x${'a'.repeat(64)}`,
    reorgCount: 0,
  }
  assert.equal(
    reconcileHotCursorAnchor(cursor, cursor.lastProcessedBlockHash, { startBlock: 0n, reorgLookback: 12n })
      .reorgDetected,
    false,
  )
  const rewound = reconcileHotCursorAnchor(cursor, `0x${'b'.repeat(64)}`, {
    startBlock: 95n,
    reorgLookback: 12n,
  })
  assert.equal(rewound.reorgDetected, true)
  assert.equal(rewound.nextBlock, '95')
  assert.equal(rewound.reorgCount, 1)
})

test('post-event state mirror stores chain revision without claiming an executable quote', () => {
  const mirror = applyPoolMirrorEvent(
    {},
    {
      type: ShadowWakeSource.V4_SWAP,
      poolId: POOL_A,
      blockNumber: 12n,
      blockHash: `0x${'c'.repeat(64)}`,
      transactionHash: '0xdef',
      logIndex: 2,
      sqrtPriceX96: 123n,
      liquidity: 456n,
      tick: -10,
      fee: 10_000,
    },
  )
  assert.equal(mirror[POOL_A].sqrtPriceX96, '123')
  assert.equal(mirror[POOL_A].liquidity, '456')
  assert.equal(mirror[POOL_A].source, ShadowWakeSource.V4_SWAP)
  assert.equal('amountOutUsdg' in mirror[POOL_A], false)
})
