import assert from 'node:assert/strict'
import test from 'node:test'

import { mergePendingMarketSignals } from '../src/feed-signal-coalescer.mjs'

const POOL_A = '0x000000000000000000000000000000000000000a'
const POOL_B = '0x000000000000000000000000000000000000000b'
const ASSET_A = '0x000000000000000000000000000000000000001a'
const ASSET_B = '0x000000000000000000000000000000000000001b'

test('coalesces every pending pool and asset dependency without changing authority', () => {
  const merged = mergePendingMarketSignals(
    {
      receivedAt: '2026-09-15T00:00:00.000Z',
      firstSequenceNumber: 100,
      lastSequenceNumber: 100,
      messageCount: 1,
      matchedAddresses: [POOL_A, ASSET_A],
      routeAddresses: [POOL_A, ASSET_A],
      eventPool: POOL_A,
      eventPools: [POOL_A],
      classificationReason: 'EARN_POOL_MATCH',
    },
    {
      receivedAt: '2026-09-15T00:00:01.000Z',
      firstSequenceNumber: 101,
      lastSequenceNumber: 102,
      messageCount: 2,
      matchedAddresses: [POOL_B, ASSET_B],
      routeAddresses: [POOL_B, ASSET_B],
      eventPool: POOL_B,
      eventPools: [POOL_B],
      classificationReason: 'NON_HUB_ASSET_PATH_MATCH',
    },
    { coalescedWakeCount: 1 },
  )

  assert.equal(merged.sourceReceivedAt, '2026-09-15T00:00:00.000Z')
  assert.equal(merged.receivedAt, '2026-09-15T00:00:00.000Z')
  assert.equal(merged.latestReceivedAt, '2026-09-15T00:00:01.000Z')
  assert.equal(merged.firstSequenceNumber, 100)
  assert.equal(merged.lastSequenceNumber, 102)
  assert.equal(merged.messageCount, 3)
  assert.deepEqual(merged.eventPools, [POOL_A, POOL_B])
  assert.deepEqual(merged.routeAddresses, [POOL_A, POOL_B, ASSET_A, ASSET_B])
  assert.deepEqual(merged.classificationReasons, ['EARN_POOL_MATCH', 'NON_HUB_ASSET_PATH_MATCH'])
  assert.equal(merged.classificationReason, 'EARN_POOL_MATCH+NON_HUB_ASSET_PATH_MATCH')
  assert.equal(merged.coalescedWakeCount, 1)
})

test('deduplicates case-insensitive addresses and preserves large sequence numbers', () => {
  const huge = '9007199254740993'
  const merged = mergePendingMarketSignals(
    {
      firstSequenceNumber: huge,
      matchedAddresses: [POOL_A.toUpperCase().replace('0X', '0x')],
      routeAddresses: [POOL_A],
    },
    {
      lastSequenceNumber: '9007199254740994',
      matchedAddresses: [POOL_A],
      routeAddresses: [POOL_A],
    },
  )
  assert.equal(merged.firstSequenceNumber, huge)
  assert.equal(merged.lastSequenceNumber, '9007199254740994')
  assert.equal(merged.matchedAddresses.length, 1)
  assert.equal(merged.routeAddresses.length, 1)
})

test('repeated coalescing never feeds the joined presentation reason back into atomic evidence', () => {
  let merged = null
  for (let index = 0; index < 20_000; index += 1) {
    merged = mergePendingMarketSignals(
      merged,
      {
        classificationReason: index % 2 === 0 ? 'EARN_POOL_MATCH' : 'NON_HUB_ASSET_PATH_MATCH',
        routeAddresses: [index % 2 === 0 ? POOL_A : POOL_B],
        receivedAt: `2026-09-15T00:00:${String(index % 60).padStart(2, '0')}.000Z`,
        firstSequenceNumber: index,
        lastSequenceNumber: index,
        messageCount: 1,
      },
      { coalescedWakeCount: index },
    )
  }

  assert.deepEqual(merged.classificationReasons, ['EARN_POOL_MATCH', 'NON_HUB_ASSET_PATH_MATCH'])
  assert.equal(merged.classificationReason, 'EARN_POOL_MATCH+NON_HUB_ASSET_PATH_MATCH')
  assert.deepEqual(merged.routeAddresses, [POOL_A, POOL_B])
  assert.equal(merged.messageCount, 20_000)
  assert.equal(merged.firstSequenceNumber, 0)
  assert.equal(merged.lastSequenceNumber, 19_999)
  assert.equal(merged.coalescedWakeCount, 19_999)
})

test('coalescing fails closed on an unbounded classification reason', () => {
  assert.throws(
    () => mergePendingMarketSignals(null, { classificationReason: 'X'.repeat(129) }),
    /classification reason exceeds its character bound/,
  )
})
