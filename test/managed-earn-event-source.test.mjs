import assert from 'node:assert/strict'
import test from 'node:test'

import { ManagedEarnEventSource } from '../src/managed-earn-event-source.mjs'

function log(blockNumber, transactionHash, logIndex, pool) {
  return { blockNumber, blockHash: `0x${blockNumber.toString(16)}`, transactionHash, logIndex, args: { pool } }
}

test('probes chain identity, coalesces fresh logs, and suppresses reconnect replay', async () => {
  let subscription
  let stopped = false
  const wakes = []
  const client = {
    getChainId: async () => 4_663,
    watchEvent: (options) => {
      subscription = options
      return () => {
        stopped = true
      }
    },
  }
  const source = new ManagedEarnEventSource({
    client,
    chainId: 4_663,
    address: '0xvault',
    event: { name: 'Swap' },
    eventFilter: (item) => item.args.pool !== 'ignored',
    onWake: (signal) => wakes.push(signal),
    maximumDedupeKeys: 2,
    now: () => Date.parse('2026-09-15T00:00:00.000Z'),
  })
  assert.equal((await source.start()).status, 'SUBSCRIBED')
  subscription.onLogs([log(11n, '0xbbb', 1, 'pool-b'), log(10n, '0xaaa', 0, 'pool-a'), log(11n, '0xccc', 2, 'ignored')])
  assert.equal(wakes.length, 1)
  assert.deepEqual(wakes[0].eventPools, ['pool-a', 'pool-b'])
  assert.equal(wakes[0].eventBlockNumber, 11n)

  subscription.onLogs([log(11n, '0xbbb', 1, 'pool-b')])
  assert.equal(wakes.length, 1)
  assert.equal(source.snapshot().duplicateLogs, 1)

  subscription.onLogs([log(12n, '0xddd', 0, 'pool-d')])
  assert.equal(source.snapshot().dedupeKeys, 2)
  source.stop()
  assert.equal(stopped, true)
  assert.equal(source.snapshot().status, 'STOPPED')
})

test('fails before subscribing when managed WSS chain identity is wrong', async () => {
  let subscribed = false
  const source = new ManagedEarnEventSource({
    client: {
      getChainId: async () => 1,
      watchEvent: () => {
        subscribed = true
      },
    },
    chainId: 4_663,
    address: '0xvault',
    event: { name: 'Swap' },
    onWake: () => {},
  })
  await assert.rejects(() => source.start(), /wrong chain id 1/)
  assert.equal(subscribed, false)
})

test('records bounded source errors without stopping the subscription', async () => {
  let subscription
  const source = new ManagedEarnEventSource({
    client: {
      getChainId: async () => 4_663,
      watchEvent: (options) => {
        subscription = options
        return () => {}
      },
    },
    chainId: 4_663,
    address: '0xvault',
    event: { name: 'Swap' },
    onWake: () => {},
    errorText: () => 'bounded transport failure',
  })
  await source.start()
  subscription.onError(new Error('secret provider body'))
  assert.equal(source.snapshot().status, 'DEGRADED')
  assert.equal(source.snapshot().lastError, 'bounded transport failure')
})
