import assert from 'node:assert/strict'
import test from 'node:test'

import { broadcastSameRawToSequencer } from '../src/direct-sequencer.mjs'
import {
  parseSequencerFeedEnvelope,
  SequencerFeedWakeClient,
  sequencerFeedAddressMatches,
} from '../src/sequencer-feed.mjs'

test('parses bounded ordered-feed metadata without claiming executable state', () => {
  assert.deepEqual(parseSequencerFeedEnvelope({ version: 1, messages: [{ sequenceNumber: 42 }] }), {
    version: 1,
    messageCount: 1,
    firstSequenceNumber: 42,
  })
  assert.throws(() => parseSequencerFeedEnvelope({ version: 1, messages: [] }), /outside bounds/)
})

test('filters ordered-feed bytes by reviewed protocol addresses without exposing payloads', () => {
  const address = '0x9D53d5E3bd5E8d4Cbfa6DB1ca238AEA02E651010'
  const payload = Buffer.concat([Buffer.from('abcd', 'hex'), Buffer.from(address.slice(2), 'hex')]).toString('base64')
  const matches = sequencerFeedAddressMatches(
    { version: 1, messages: [{ sequenceNumber: 1, message: { message: { l2Msg: payload } } }] },
    [address],
  )
  assert.deepEqual(matches, [address.toLowerCase()])
})

test('refreshes and deduplicates the bounded feed address filter without reconnecting', () => {
  const address = '0x9D53d5E3bd5E8d4Cbfa6DB1ca238AEA02E651010'
  const client = new SequencerFeedWakeClient({ WebSocketImpl: class {}, watchedAddresses: [address] })
  client.setWatchedAddresses([address, address.toLowerCase()])
  assert.equal(client.snapshot().watchedAddresses, 1)
  assert.throws(() => client.setWatchedAddresses(['invalid']), /invalid/)
  assert.throws(() => client.setMatchFilter(null), /must be a function/)
})

test('counts policy-rejected matched frames as filtered and wakes only actionable matches', async () => {
  const first = '0x0000000000000000000000000000000000000001'
  const second = '0x0000000000000000000000000000000000000002'
  class FakeWebSocket {
    static latest = null

    constructor() {
      this.readyState = 0
      this.listeners = new Map()
      FakeWebSocket.latest = this
    }

    addEventListener(name, listener) {
      this.listeners.set(name, listener)
    }

    emit(name, event = {}) {
      this.listeners.get(name)?.(event)
    }

    close() {
      this.readyState = 3
    }
  }
  const wakes = []
  const client = new SequencerFeedWakeClient({
    WebSocketImpl: FakeWebSocket,
    watchedAddresses: [first, second],
    matchFilter: (signal) => signal.matchedAddresses.length >= 2,
    onWake: (signal) => wakes.push(signal),
  })
  client.start()
  FakeWebSocket.latest.readyState = 1
  FakeWebSocket.latest.emit('open')
  const frame = (sequenceNumber, addresses) =>
    JSON.stringify({
      version: 1,
      messages: [
        {
          sequenceNumber,
          message: {
            message: {
              l2Msg: Buffer.concat(addresses.map((address) => Buffer.from(address.slice(2), 'hex'))).toString('base64'),
            },
          },
        },
      ],
    })
  FakeWebSocket.latest.emit('message', { data: frame(1, [first]) })
  await new Promise((resolve) => globalThis.setTimeout(resolve, 0))
  FakeWebSocket.latest.emit('message', { data: frame(2, [first, second]) })
  await new Promise((resolve) => globalThis.setTimeout(resolve, 0))
  assert.equal(wakes.length, 1)
  assert.deepEqual(client.snapshot(), {
    connects: 1,
    frames: 2,
    wakes: 1,
    filtered: 1,
    malformed: 0,
    errors: 0,
    reconnects: 0,
    connected: true,
    lastSequenceNumber: 2,
    feedUrl: 'wss://feed.mainnet.chain.robinhood.com',
    watchedAddresses: 2,
  })
  client.stop()
})

test('direct sequencer acceptance does not duplicate the submission', async () => {
  const calls = []
  const result = await broadcastSameRawToSequencer({
    serializedTransaction: '0x01',
    managedRpcUrl: 'https://managed.invalid',
    fetchImpl: async (url, request) => {
      calls.push({ url, body: request.body })
      return { status: 200, json: async () => ({ jsonrpc: '2.0', id: 1, result: resultHash }) }
    },
  })
  assert.equal(calls.length, 1)
  assert.equal(result.direct.status, 'ACCEPTED')
  assert.equal(result.fallback, null)
})

const resultHash = '0x5fe7f977e71dba2ea1a68e21057beebb9be2ac30c6410aa38d4f3fbe41dcffd2'

test('transport uncertainty fans out only identical signed bytes', async () => {
  const bodies = []
  const result = await broadcastSameRawToSequencer({
    serializedTransaction: '0x01',
    managedRpcUrl: 'https://managed.invalid',
    fetchImpl: async (_url, request) => {
      bodies.push(JSON.parse(request.body))
      if (bodies.length === 1) throw new Error('timeout')
      return { status: 200, json: async () => ({ result: resultHash }) }
    },
  })
  assert.equal(result.direct.status, 'TRANSPORT_UNKNOWN')
  assert.equal(result.fallback.status, 'ACCEPTED')
  assert.equal(bodies.length, 2)
  assert.equal(bodies[0].params[0], bodies[1].params[0])
})
