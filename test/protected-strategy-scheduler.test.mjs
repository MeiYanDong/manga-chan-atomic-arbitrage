import assert from 'node:assert/strict'
import test from 'node:test'

import { ProtectedStrategyScheduler } from '../src/protected-strategy-scheduler.mjs'

const POOL_A = '0x000000000000000000000000000000000000000a'
const POOL_B = '0x000000000000000000000000000000000000000b'

function scheduler(startedAt = 1_000) {
  return new ProtectedStrategyScheduler({
    startedAt,
    lanes: [
      { id: 'EARN', periodMs: 1_000, minimumIntervalMs: 0 },
      { id: 'GLOBAL', periodMs: 2_000, minimumIntervalMs: 100 },
    ],
  })
}

test('overdue periodic coverage runs before a continuous event backlog', () => {
  const work = scheduler()
  work.enqueueEvent('EARN', { reason: 'FILTERED_SEQUENCER_FEED', priority: 100, signal: { eventPool: POOL_A } })
  work.enqueueEvent('GLOBAL', { reason: 'FILTERED_SEQUENCER_FEED', priority: 50, signal: { eventPool: POOL_B } })

  const first = work.claimNext(1_000)
  const second = work.claimNext(1_001)
  assert.deepEqual([first.laneId, first.kind, second.laneId, second.kind], ['EARN', 'PERIODIC', 'GLOBAL', 'PERIODIC'])

  const third = work.claimNext(1_002)
  assert.deepEqual([third.laneId, third.kind, third.reason], ['EARN', 'EVENT', 'FILTERED_SEQUENCER_FEED'])
  assert.equal(
    work.snapshot().lanes.find((lane) => lane.id === 'GLOBAL').pendingEvent.reason,
    'FILTERED_SEQUENCER_FEED',
  )
})

test('event work never resets its lane periodic deadline', () => {
  const work = scheduler(10_000)
  work.claimNext(10_000)
  work.claimNext(10_001)
  const dueAt = work.snapshot().lanes.find((lane) => lane.id === 'EARN').nextPeriodicAt

  for (let now = 10_100; now < dueAt; now += 100) {
    work.enqueueEvent('EARN', {
      reason: 'REVIEWED_POOL_SWAP_EVENT',
      priority: 50,
      enqueuedAt: now,
      signal: { eventPool: POOL_A, sourceReceivedAt: new Date(now).toISOString() },
    })
    assert.equal(work.claimNext(now).kind, 'EVENT')
  }

  assert.equal(work.snapshot().lanes.find((lane) => lane.id === 'EARN').nextPeriodicAt, dueAt)
  const protectedRun = work.claimNext(dueAt)
  assert.deepEqual([protectedRun.laneId, protectedRun.kind, protectedRun.scheduledAt], ['EARN', 'PERIODIC', dueAt])
})

test('coalesces dependencies while retaining the higher-priority wake reason', () => {
  const work = scheduler(20_000)
  work.claimNext(20_000)
  work.claimNext(20_001)
  work.enqueueEvent('EARN', {
    reason: 'REVIEWED_POOL_SWAP_EVENT',
    priority: 50,
    enqueuedAt: 20_100,
    signal: { eventPool: POOL_A, eventPools: [POOL_A] },
  })
  work.enqueueEvent('EARN', {
    reason: 'FILTERED_SEQUENCER_FEED',
    priority: 100,
    enqueuedAt: 20_101,
    signal: { eventPool: POOL_B, eventPools: [POOL_B] },
  })

  const claim = work.claimNext(20_102)
  assert.equal(claim.reason, 'FILTERED_SEQUENCER_FEED')
  assert.deepEqual(claim.signal.eventPools, [POOL_A, POOL_B])
  assert.equal(claim.signal.coalescedWakeCount, 1)
})

test('a throttled event lane cannot block another eligible strategy', () => {
  const work = scheduler(30_000)
  work.claimNext(30_000)
  work.claimNext(30_001)
  work.enqueueEvent('GLOBAL', {
    reason: 'FILTERED_SEQUENCER_FEED',
    priority: 100,
    enqueuedAt: 30_010,
    signal: { eventPool: POOL_A },
  })
  work.enqueueEvent('EARN', {
    reason: 'REVIEWED_POOL_SWAP_EVENT',
    priority: 50,
    enqueuedAt: 30_011,
    signal: { eventPool: POOL_B },
  })

  assert.equal(work.claimNext(30_050).laneId, 'EARN')
  assert.equal(work.claimNext(30_101).laneId, 'GLOBAL')
})

test('reports periodic lateness instead of silently calling it full coverage', () => {
  const work = scheduler(40_000)
  const claim = work.claimNext(40_750)
  assert.equal(claim.latenessMs, 750)
  assert.equal(work.snapshot().lanes[0].maximumPeriodicLatenessMs, 750)
})
