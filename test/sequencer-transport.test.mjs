import assert from 'node:assert/strict'
import test from 'node:test'

import { broadcastSameRawToSequencer } from '../src/direct-sequencer.mjs'
import {
  parseSequencerFeedEnvelope,
  selectUnseenSequencerFeedMessages,
  SequencerFeedWakeClient,
  sequencerFeedAddressMatches,
} from '../src/sequencer-feed.mjs'

test('parses bounded ordered-feed metadata without claiming executable state', () => {
  assert.deepEqual(parseSequencerFeedEnvelope({ version: 1, messages: [{ sequenceNumber: 42 }] }), {
    version: 1,
    messageCount: 1,
    firstSequenceNumber: 42,
    lastSequenceNumber: 42,
  })
  assert.throws(() => parseSequencerFeedEnvelope({ version: 1, messages: [] }), /outside bounds/)
  assert.throws(
    () => parseSequencerFeedEnvelope({ version: 1, messages: [{ sequenceNumber: null }] }),
    /message sequence number is invalid/,
  )
})

test('keeps unseen messages from overlapping frames and matches only their dependencies', () => {
  const oldAddress = '0x0000000000000000000000000000000000000001'
  const newAddress = '0x0000000000000000000000000000000000000002'
  const message = (sequenceNumber, address) => ({
    sequenceNumber,
    message: { message: { l2Msg: Buffer.from(address.slice(2), 'hex').toString('base64') } },
  })
  const selected = selectUnseenSequencerFeedMessages(
    { version: 1, messages: [message(100, oldAddress), message(101, newAddress)] },
    100,
  )
  assert.deepEqual(selected.envelope, {
    version: 1,
    messageCount: 1,
    firstSequenceNumber: 101,
    lastSequenceNumber: 101,
  })
  assert.equal(selected.duplicateMessages, 1)
  assert.equal(selected.overlapping, true)
  assert.equal(selected.gap, false)
  assert.equal(selected.highestSequenceNumber, 101n)
  assert.deepEqual(sequencerFeedAddressMatches(selected.source, [oldAddress, newAddress]), [newAddress])
})

test('records duplicate, gap and out-of-order feed evidence without inventing executable state', () => {
  const duplicate = selectUnseenSequencerFeedMessages(
    { version: 1, messages: [{ sequenceNumber: '99' }, { sequenceNumber: '100' }] },
    100n,
  )
  assert.equal(duplicate.source.messages.length, 0)
  assert.equal(duplicate.duplicateMessages, 2)
  assert.equal(duplicate.highestSequenceNumber, 100n)

  const gap = selectUnseenSequencerFeedMessages(
    { version: 1, messages: [{ sequenceNumber: '103' }, { sequenceNumber: '102' }] },
    '100',
  )
  assert.equal(gap.outOfOrder, true)
  assert.equal(gap.gap, true)
  assert.equal(gap.expectedSequenceNumber, 101)
  assert.equal(gap.gapSize, 1)
  assert.equal(gap.highestSequenceNumber, 103n)
})

test('the live client wakes for the new tail of an overlap and suppresses a fully replayed frame', async () => {
  const oldAddress = '0x0000000000000000000000000000000000000001'
  const newAddress = '0x0000000000000000000000000000000000000002'
  class OverlapWebSocket {
    static latest = null

    constructor() {
      this.readyState = 0
      this.listeners = new Map()
      OverlapWebSocket.latest = this
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
  const entry = (sequenceNumber, address) => ({
    sequenceNumber,
    message: { message: { l2Msg: Buffer.from(address.slice(2), 'hex').toString('base64') } },
  })
  const emitFrame = async (messages) => {
    OverlapWebSocket.latest.emit('message', { data: JSON.stringify({ version: 1, messages }) })
    await new Promise((resolve) => globalThis.setTimeout(resolve, 0))
  }
  const wakes = []
  const client = new SequencerFeedWakeClient({
    WebSocketImpl: OverlapWebSocket,
    watchedAddresses: [oldAddress, newAddress],
    onWake: (signal) => wakes.push(signal),
  })
  client.start()
  OverlapWebSocket.latest.readyState = 1
  OverlapWebSocket.latest.emit('open')
  await emitFrame([entry(100, oldAddress)])
  await emitFrame([entry(100, oldAddress), entry(101, newAddress)])
  await emitFrame([entry(101, newAddress)])

  assert.equal(wakes.length, 2)
  assert.deepEqual(wakes[1].matchedAddresses, [newAddress])
  assert.equal(wakes[1].firstSequenceNumber, 101)
  assert.equal(wakes[1].overlappingFrame, true)
  assert.deepEqual(
    {
      frames: client.snapshot().frames,
      duplicateFrames: client.snapshot().duplicateFrames,
      duplicateMessages: client.snapshot().duplicateMessages,
      overlappingFrames: client.snapshot().overlappingFrames,
      lastSequenceNumber: client.snapshot().lastSequenceNumber,
    },
    { frames: 3, duplicateFrames: 1, duplicateMessages: 2, overlappingFrames: 1, lastSequenceNumber: 101 },
  )
  client.stop()
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
    static constructorArguments = null

    constructor(...args) {
      this.readyState = 0
      this.listeners = new Map()
      FakeWebSocket.latest = this
      FakeWebSocket.constructorArguments = args
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
    requestedSequenceNumber: 100,
    watchedAddresses: [first, second],
    matchFilter: (signal) => signal.matchedAddresses.length >= 2,
    onWake: (signal) => wakes.push(signal),
  })
  client.start()
  assert.deepEqual(FakeWebSocket.constructorArguments.slice(0, 2), ['wss://feed.mainnet.chain.robinhood.com', []])
  assert.deepEqual(FakeWebSocket.constructorArguments[2], {
    headers: {
      'Arbitrum-Feed-Client-Version': '2',
      'Arbitrum-Requested-Sequence-Number': '100',
    },
    perMessageDeflate: true,
    handshakeTimeout: 10_000,
  })
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
    duplicateFrames: 0,
    duplicateMessages: 0,
    overlappingFrames: 0,
    sequenceGapFrames: 0,
    outOfOrderFrames: 0,
    malformed: 0,
    errors: 0,
    rejections: 0,
    reconnects: 0,
    connected: true,
    lastSequenceNumber: 2,
    requestedSequenceNumber: '3',
    feedClientVersion: 2,
    expectedChainId: '4663',
    lastStatus: 'CONNECTED',
    lastHttpStatus: 101,
    nextReconnectAt: null,
    feedUrl: 'wss://feed.mainnet.chain.robinhood.com',
    watchedAddresses: 2,
  })
  client.stop()
})

test('respects feed rejection retry-after instead of reconnecting in a tight loop', () => {
  class RejectedWebSocket {
    static latest = null

    constructor() {
      this.readyState = 0
      this.listeners = new Map()
      this.onceListeners = new Map()
      RejectedWebSocket.latest = this
    }

    addEventListener(name, listener) {
      this.listeners.set(name, listener)
    }

    once(name, listener) {
      this.onceListeners.set(name, listener)
    }

    reject(response) {
      this.onceListeners.get('unexpected-response')?.(null, response)
    }

    terminate() {
      this.readyState = 3
    }

    close() {
      this.readyState = 3
    }
  }
  const statuses = []
  const client = new SequencerFeedWakeClient({
    WebSocketImpl: RejectedWebSocket,
    requestedSequenceNumber: 42,
    reconnectMs: 1,
    onStatus: (status) => statuses.push(status),
  })
  client.start()
  RejectedWebSocket.latest.reject({
    statusCode: 403,
    headers: { 'retry-after': '60' },
    resume() {},
  })
  const snapshot = client.snapshot()
  assert.equal(snapshot.errors, 1)
  assert.equal(snapshot.rejections, 1)
  assert.equal(snapshot.reconnects, 1)
  assert.equal(snapshot.lastStatus, 'REJECTED')
  assert.equal(snapshot.lastHttpStatus, 403)
  assert.ok(Date.parse(snapshot.nextReconnectAt) - Date.now() >= 60_000)
  assert.equal(statuses[0].status, 'REJECTED')
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
