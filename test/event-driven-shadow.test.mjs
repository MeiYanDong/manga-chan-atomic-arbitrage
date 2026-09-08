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
  planHotLogRange,
  pollBeforeDrainingWakeQueue,
  recoverStaleHotCursor,
  reconcileHotCursorAnchor,
  retryReadOnly,
  rotatingSlice,
  routeShadowEvent,
  selectPeriodicShadowCandidates,
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

test('periodic selection never fills an empty positive quota with extra unobserved rows', () => {
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
  })

  assert.deepEqual(
    result.selected.map((candidate) => candidate.id),
    ['candidate-0', 'candidate-1', 'candidate-3', 'candidate-4', 'candidate-5', 'candidate-6'],
  )
  assert.equal(result.coverageAdded, 4)
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
  assert.equal(queue.size, 1)
  assert.equal(queue.dedupedEvents, 1)
})

test('hot polling precedes backlog drain and coalesces the newest candidate revision', async () => {
  const queue = new CandidateWakeQueue()
  const order = []
  queue.offer(
    {
      type: ShadowWakeSource.V4_SWAP,
      blockNumber: 10n,
      transactionHash: '0xold',
      logIndex: 1,
    },
    ['token-a'],
    100,
  )
  const take = queue.take.bind(queue)
  queue.take = (limit) => {
    order.push('take')
    return take(limit)
  }

  const result = await pollBeforeDrainingWakeQueue({
    poll: async () => {
      order.push('poll')
      queue.offer(
        {
          type: ShadowWakeSource.V4_SWAP,
          blockNumber: 12n,
          transactionHash: '0xnew',
          logIndex: 2,
        },
        ['token-a', 'token-b'],
        110,
      )
      return { candidateIds: [], catalogRefresh: false, initialized: false }
    },
    getQueue: () => queue,
    limit: 1,
  })

  assert.deepEqual(order, ['poll', 'take'])
  assert.equal(result.pollError, null)
  assert.deepEqual(result.wake.candidateIds, ['token-a'])
  assert.equal(result.wake.triggers[0].eventCount, 2)
  assert.equal(result.wake.triggers[0].maxBlock, 12n)
  assert.equal(queue.size, 1)
})

test('a wake already selected by the bounded poll is not replaced by another backlog take', async () => {
  const queue = new CandidateWakeQueue()
  queue.offer(
    {
      type: ShadowWakeSource.V4_SWAP,
      blockNumber: 10n,
      transactionHash: '0xold',
      logIndex: 1,
    },
    ['token-a'],
    100,
  )

  const polledWake = {
    candidateIds: ['token-b'],
    triggers: [{ candidateId: 'token-b' }],
    oldestObservedAtMs: 110,
    catalogRefresh: true,
    initialized: false,
  }
  const result = await pollBeforeDrainingWakeQueue({
    poll: async () => polledWake,
    getQueue: () => queue,
    limit: 1,
  })

  assert.equal(result.wake, polledWake)
  assert.equal(result.pollResult, polledWake)
  assert.equal(queue.size, 1)
})

test('a failed hot poll preserves its error while allowing an observed backlog wake to progress', async () => {
  const queue = new CandidateWakeQueue()
  queue.offer(
    {
      type: ShadowWakeSource.V4_SWAP,
      blockNumber: 10n,
      transactionHash: '0xobserved',
      logIndex: 1,
    },
    ['token-a'],
    100,
  )
  const expectedError = new Error('public rpc unavailable')

  const result = await pollBeforeDrainingWakeQueue({
    poll: async () => {
      throw expectedError
    },
    getQueue: () => queue,
    limit: 1,
  })

  assert.equal(result.pollResult, null)
  assert.equal(result.pollError, expectedError)
  assert.deepEqual(result.wake.candidateIds, ['token-a'])
  assert.equal(queue.size, 0)
})

test('a hot-poll reorg queue replacement cannot leak stale pre-reorg wakes', async () => {
  const staleQueue = new CandidateWakeQueue()
  staleQueue.offer(
    {
      type: ShadowWakeSource.V4_SWAP,
      blockNumber: 10n,
      transactionHash: '0xstale',
      logIndex: 1,
    },
    ['token-a'],
    100,
  )
  let currentQueue = staleQueue

  const result = await pollBeforeDrainingWakeQueue({
    poll: async () => {
      currentQueue = new CandidateWakeQueue()
      return { candidateIds: [], catalogRefresh: false, initialized: false }
    },
    getQueue: () => currentQueue,
    limit: 1,
  })

  assert.equal(result.wake, null)
  assert.equal(currentQueue.size, 0)
  assert.equal(staleQueue.size, 1)
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
