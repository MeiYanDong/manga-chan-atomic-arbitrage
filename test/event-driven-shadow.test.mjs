import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AsyncConcurrencyGate,
  CandidateWakeQueue,
  FixedBlockPromiseCache,
  ShadowWakeSource,
  applyPoolMirrorEvent,
  buildShadowDependencyIndex,
  planHotLogRange,
  reconcileHotCursorAnchor,
  retryReadOnly,
  rotatingSlice,
  routeShadowEvent,
  selectPeriodicShadowCandidates,
} from '../src/event-driven-shadow.mjs'

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
