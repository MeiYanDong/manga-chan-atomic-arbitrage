import { TextDecoder } from 'node:util'
import { Buffer } from 'node:buffer'
import WebSocket from 'ws'

const DEFAULT_FEED_URL = 'wss://feed.mainnet.chain.robinhood.com'
const FEED_CLIENT_VERSION = 2
const DEFAULT_CHAIN_ID = 4_663
const MAX_SERVER_RETRY_AFTER_MS = 3_600_000

function integer(value) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null
}

function sequenceNumber(value) {
  if (typeof value === 'bigint' && value >= 0n) return value
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return BigInt(value)
  if (typeof value === 'string' && /^\d+$/.test(value)) return BigInt(value)
  throw new Error('sequencer feed requested sequence number is invalid')
}

function retryAfterMs(value, now = Date.now()) {
  if (typeof value !== 'string' || value.length === 0) return 0
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(MAX_SERVER_RETRY_AFTER_MS, Math.ceil(seconds * 1_000) + 1_000)
  }
  const date = Date.parse(value)
  return Number.isFinite(date) ? Math.min(MAX_SERVER_RETRY_AFTER_MS, Math.max(0, date - now) + 1_000) : 0
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
    this.reconnectMaxMs = Number(options.reconnectMaxMs || 64_000)
    this.handshakeTimeoutMs = Number(options.handshakeTimeoutMs || 10_000)
    this.expectedChainId = String(options.expectedChainId || DEFAULT_CHAIN_ID)
    this.requestedSequenceNumber = sequenceNumber(options.requestedSequenceNumber ?? 0n)
    this.watchedAddresses = []
    this.setWatchedAddresses(options.watchedAddresses || [])
    this.minimumAddressMatches = Number(options.minimumAddressMatches || (this.watchedAddresses.length > 0 ? 1 : 0))
    this.WebSocketImpl = options.WebSocketImpl || WebSocket
    if (typeof this.WebSocketImpl !== 'function') throw new Error('WebSocket implementation is unavailable')
    this.socket = null
    this.timer = null
    this.stopped = true
    this.lastSequenceNumber = null
    this.reconnectAttempt = 0
    this.lastStatus = 'IDLE'
    this.lastHttpStatus = null
    this.nextReconnectAt = null
    this.metrics = {
      connects: 0,
      frames: 0,
      wakes: 0,
      filtered: 0,
      malformed: 0,
      errors: 0,
      rejections: 0,
      reconnects: 0,
    }
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
      requestedSequenceNumber: this.#nextRequestedSequenceNumber().toString(),
      feedClientVersion: FEED_CLIENT_VERSION,
      expectedChainId: this.expectedChainId,
      lastStatus: this.lastStatus,
      lastHttpStatus: this.lastHttpStatus,
      nextReconnectAt: this.nextReconnectAt,
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

  #nextRequestedSequenceNumber() {
    return this.lastSequenceNumber === null ? this.requestedSequenceNumber : BigInt(this.lastSequenceNumber) + 1n
  }

  #scheduleReconnect(serverDelayMs = 0) {
    if (this.stopped || this.timer) return
    this.metrics.reconnects += 1
    const exponent = Math.min(this.reconnectAttempt, 16)
    const backoffMs = Math.min(this.reconnectMaxMs, this.reconnectMs * 2 ** exponent)
    const delayMs = Math.max(backoffMs, serverDelayMs)
    this.reconnectAttempt += 1
    this.nextReconnectAt = new Date(Date.now() + delayMs).toISOString()
    this.timer = setTimeout(() => {
      this.timer = null
      this.nextReconnectAt = null
      this.#connect()
    }, delayMs)
  }

  #connect() {
    if (this.stopped) return
    let socket
    let terminal = false
    const reconnect = (serverDelayMs = 0) => {
      if (terminal) return
      terminal = true
      if (this.socket === socket) this.socket = null
      this.#scheduleReconnect(serverDelayMs)
    }
    try {
      socket = new this.WebSocketImpl(this.url, [], {
        headers: {
          'Arbitrum-Feed-Client-Version': String(FEED_CLIENT_VERSION),
          'Arbitrum-Requested-Sequence-Number': this.#nextRequestedSequenceNumber().toString(),
        },
        perMessageDeflate: true,
        handshakeTimeout: this.handshakeTimeoutMs,
      })
    } catch (error) {
      this.metrics.errors += 1
      this.lastStatus = 'ERROR'
      this.onStatus({ status: 'ERROR', error: String(error) })
      this.#scheduleReconnect()
      return
    }
    this.socket = socket
    if (typeof socket.once === 'function') {
      socket.once('upgrade', (response) => {
        this.lastHttpStatus = response?.statusCode || 101
      })
      socket.once('unexpected-response', (_request, response) => {
        this.metrics.errors += 1
        this.metrics.rejections += 1
        this.lastStatus = 'REJECTED'
        this.lastHttpStatus = response?.statusCode || null
        const delayMs = retryAfterMs(response?.headers?.['retry-after'])
        this.onStatus({
          status: 'REJECTED',
          httpStatus: this.lastHttpStatus,
          retryAt: delayMs > 0 ? new Date(Date.now() + delayMs).toISOString() : null,
        })
        response?.resume?.()
        reconnect(delayMs)
        socket.terminate?.()
      })
    }
    socket.addEventListener('open', () => {
      this.metrics.connects += 1
      this.reconnectAttempt = 0
      this.lastStatus = 'CONNECTED'
      this.lastHttpStatus = 101
      this.nextReconnectAt = null
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
        if (envelope.firstSequenceNumber !== null) {
          const highestSequenceNumber = Math.max(
            ...source.messages.map((item) => integer(item?.sequenceNumber)).filter((item) => item !== null),
          )
          this.lastSequenceNumber = highestSequenceNumber
        }
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
      if (terminal) return
      this.metrics.errors += 1
      this.lastStatus = 'ERROR'
      this.onStatus({ status: 'ERROR', at: new Date().toISOString() })
      socket.terminate?.()
      reconnect()
    })
    socket.addEventListener('close', () => {
      if (terminal) return
      this.lastStatus = this.stopped ? 'STOPPED' : 'DISCONNECTED'
      this.onStatus({ status: this.stopped ? 'STOPPED' : 'DISCONNECTED', at: new Date().toISOString() })
      reconnect()
    })
  }
}

export const ROBINHOOD_SEQUENCER_FEED_URL = DEFAULT_FEED_URL
export const NITRO_FEED_CLIENT_VERSION = FEED_CLIENT_VERSION
