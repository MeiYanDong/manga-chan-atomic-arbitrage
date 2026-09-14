import { TextDecoder } from 'node:util'
import { Buffer } from 'node:buffer'

const DEFAULT_FEED_URL = 'wss://feed.mainnet.chain.robinhood.com'

function integer(value) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null
}

/** Parse only the bounded envelope metadata needed for a wake signal. */
export function parseSequencerFeedEnvelope(value) {
  const source = typeof value === 'string' ? JSON.parse(value) : value
  if (!source || typeof source !== 'object') throw new Error('sequencer feed message is not an object')
  const version = integer(source.version)
  const messages = Array.isArray(source.messages) ? source.messages : null
  if (version === null || !messages || messages.length === 0 || messages.length > 1_000) {
    throw new Error('sequencer feed envelope is outside bounds')
  }
  const sequenceNumber = integer(messages[0]?.sequenceNumber ?? source.sequenceNumber)
  return {
    version,
    messageCount: messages.length,
    firstSequenceNumber: sequenceNumber,
  }
}

/** Match raw L2 message bytes without logging or persisting transaction data. */
export function sequencerFeedAddressMatches(value, addresses) {
  const source = typeof value === 'string' ? JSON.parse(value) : value
  const needles = (addresses || []).map((address) => {
    if (!/^0x[0-9a-f]{40}$/i.test(address)) throw new Error('feed watch address is invalid')
    return { address, bytes: Buffer.from(address.slice(2), 'hex') }
  })
  const matches = new Set()
  for (const item of source?.messages || []) {
    const encoded = item?.message?.message?.l2Msg
    if (typeof encoded !== 'string' || encoded.length > 4_000_000) continue
    let payload
    try {
      payload = Buffer.from(encoded, 'base64')
    } catch {
      continue
    }
    for (const needle of needles) {
      if (payload.includes(needle.bytes)) matches.add(needle.address.toLowerCase())
    }
  }
  return [...matches]
}

async function eventDataText(data) {
  if (typeof data === 'string') return data
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data)
  if (ArrayBuffer.isView(data)) {
    return new TextDecoder().decode(new Uint8Array(data.buffer, data.byteOffset, data.byteLength))
  }
  if (data && typeof data.text === 'function') return data.text()
  throw new Error('sequencer feed frame type is unsupported')
}

/**
 * Lightweight ordered-feed wake client. It does not pretend to be a full
 * Nitro node: the callback must still query an executable RPC state before
 * simulation or signing.
 */
export class SequencerFeedWakeClient {
  constructor(options = {}) {
    this.url = options.url || DEFAULT_FEED_URL
    this.onWake = options.onWake || (() => {})
    this.onStatus = options.onStatus || (() => {})
    this.matchFilter = options.matchFilter || (() => true)
    this.reconnectMs = Number(options.reconnectMs || 1_000)
    this.watchedAddresses = []
    this.setWatchedAddresses(options.watchedAddresses || [])
    this.minimumAddressMatches = Number(options.minimumAddressMatches || (this.watchedAddresses.length > 0 ? 1 : 0))
    this.WebSocketImpl = options.WebSocketImpl || globalThis.WebSocket
    if (typeof this.WebSocketImpl !== 'function') throw new Error('WebSocket implementation is unavailable')
    this.socket = null
    this.timer = null
    this.stopped = true
    this.lastSequenceNumber = null
    this.metrics = { connects: 0, frames: 0, wakes: 0, filtered: 0, malformed: 0, errors: 0, reconnects: 0 }
  }

  start() {
    if (!this.stopped) return
    this.stopped = false
    this.#connect()
  }

  stop() {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    const socket = this.socket
    this.socket = null
    if (socket && socket.readyState < 2) socket.close(1_000, 'shutdown')
  }

  snapshot() {
    return {
      ...this.metrics,
      connected: this.socket?.readyState === 1,
      lastSequenceNumber: this.lastSequenceNumber,
      feedUrl: this.url,
      watchedAddresses: this.watchedAddresses.length,
    }
  }

  setWatchedAddresses(addresses) {
    if (!Array.isArray(addresses) || addresses.length > 1_024) {
      throw new Error('sequencer feed address filter is outside bounds')
    }
    const unique = new Map()
    for (const address of addresses) {
      if (!/^0x[0-9a-f]{40}$/i.test(address)) throw new Error('feed watch address is invalid')
      unique.set(address.toLowerCase(), address)
    }
    this.watchedAddresses = [...unique.values()]
  }

  setMatchFilter(matchFilter) {
    if (typeof matchFilter !== 'function') throw new Error('sequencer feed match filter must be a function')
    this.matchFilter = matchFilter
  }

  #scheduleReconnect() {
    if (this.stopped || this.timer) return
    this.metrics.reconnects += 1
    this.timer = setTimeout(() => {
      this.timer = null
      this.#connect()
    }, this.reconnectMs)
  }

  #connect() {
    if (this.stopped) return
    let socket
    try {
      socket = new this.WebSocketImpl(this.url)
    } catch (error) {
      this.metrics.errors += 1
      this.onStatus({ status: 'ERROR', error: String(error) })
      this.#scheduleReconnect()
      return
    }
    this.socket = socket
    socket.addEventListener('open', () => {
      this.metrics.connects += 1
      this.onStatus({ status: 'CONNECTED', at: new Date().toISOString() })
    })
    socket.addEventListener('message', async (event) => {
      try {
        const text = await eventDataText(event.data)
        const source = JSON.parse(text)
        const envelope = parseSequencerFeedEnvelope(source)
        if (
          envelope.firstSequenceNumber !== null &&
          this.lastSequenceNumber !== null &&
          envelope.firstSequenceNumber <= this.lastSequenceNumber
        ) {
          return
        }
        if (envelope.firstSequenceNumber !== null) this.lastSequenceNumber = envelope.firstSequenceNumber
        this.metrics.frames += 1
        const matchedAddresses = sequencerFeedAddressMatches(source, this.watchedAddresses)
        const signal = { ...envelope, matchedAddresses, receivedAt: new Date().toISOString() }
        if (matchedAddresses.length < this.minimumAddressMatches || !this.matchFilter(signal)) {
          this.metrics.filtered += 1
          return
        }
        this.metrics.wakes += 1
        this.onWake(signal)
      } catch (error) {
        this.metrics.malformed += 1
        this.onStatus({ status: 'MALFORMED_FRAME', error: String(error) })
      }
    })
    socket.addEventListener('error', () => {
      this.metrics.errors += 1
      this.onStatus({ status: 'ERROR', at: new Date().toISOString() })
    })
    socket.addEventListener('close', () => {
      if (this.socket === socket) this.socket = null
      this.onStatus({ status: this.stopped ? 'STOPPED' : 'DISCONNECTED', at: new Date().toISOString() })
      this.#scheduleReconnect()
    })
  }
}

export const ROBINHOOD_SEQUENCER_FEED_URL = DEFAULT_FEED_URL
