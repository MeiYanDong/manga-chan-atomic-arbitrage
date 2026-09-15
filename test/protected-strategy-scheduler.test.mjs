import assert from 'node:assert/strict'
import test from 'node:test'

import { ProtectedStrategyScheduler } from '../src/protected-strategy-scheduler.mjs'

const POOL_A = '0x000000000000000000000000000000000000000a'
const POOL_B = '0x000000000000000000000000000000000000000b'

function scheduler(startedAt = 1_000, options = {}) {
  return new ProtectedStrategyScheduler({
    startedAt,
    priorityEventFloor: 80,
    maximumPeriodicDeferralMs: 250,
    ...options,
    lanes: [
      { id: 'EARN', periodMs: 1_000, minimumIntervalMs: 0 },
      { id: 'GLOBAL', periodMs: 2_000, minimumIntervalMs: 100 },
    ],
  })
}

test('high-priority work may briefly precede overdue recovery while low-priority work cannot', () => {
  const work = scheduler()
  work.enqueueEvent('EARN', {
    reason: 'FILTERED_SEQUENCER_FEED',
    priority: 100,
    enqueuedAt: 1_000,
    signal: { eventPool: POOL_A },
  })
  work.enqueueEvent('GLOBAL', {
    reason: 'PUBLIC_RECOVERY_EVENT',
    priority: 50,
    enqueuedAt: 1_000,
    signal: { eventPool: POOL_B },
  })

  const first = work.claimNext(1_000)
  const second = work.claimNext(1_001)
  const third = work.claimNext(1_002)
  const fourth = work.claimNext(1_102)
  assert.deepEqual([first.laneId, first.kind], ['EARN', 'EVENT'])
  assert.deepEqual(first.deferredPeriodic, {
    laneId: 'EARN',
    scheduledAt: 1_000,
    latenessMs: 0,
    maximumDeferralMs: 250,
  })
  assert.deepEqual([second.laneId, second.kind], ['EARN', 'PERIODIC'])
  assert.deepEqual([third.laneId, third.kind], ['GLOBAL', 'PERIODIC'])
  assert.deepEqual([fourth.laneId, fourth.kind, fourth.reason], ['GLOBAL', 'EVENT', 'PUBLIC_RECOVERY_EVENT'])
  assert.equal(work.snapshot().priorityEventDeferrals, 1)
})

test('the maximum deferral becomes a hard recovery deadline', () => {
  const work = scheduler()
  work.enqueueEvent('EARN', {
    reason: 'MANAGED_WSS_EARN_SWAP',
    priority: 90,
    enqueuedAt: 1_000,
    signal: { eventPool: POOL_A },
  })
  assert.equal(work.claimNext(1_249).kind, 'EVENT')

  work.enqueueEvent('EARN', {
    reason: 'MANAGED_WSS_EARN_SWAP',
    priority: 90,
    enqueuedAt: 1_250,
    signal: { eventPool: POOL_A },
  })
  const recovery = work.claimNext(1_250)
  assert.deepEqual([recovery.laneId, recovery.kind, recovery.latenessMs], ['EARN', 'PERIODIC', 250])
  assert.equal(work.snapshot().lanes[0].pendingEvent.reason, 'MANAGED_WSS_EARN_SWAP')
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
