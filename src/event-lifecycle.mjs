import { redactSensitiveText } from './policy.mjs'

const SAFE_STAGE = /^[A-Z][A-Z0-9_]{1,63}$/
const FORBIDDEN_DETAIL_KEY = /raw|private|secret|endpoint|url|calldata|payload/i

function timestamp(value) {
  const parsed = typeof value === 'number' ? value : Date.parse(String(value || ''))
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function safePrimitive(value) {
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'boolean' || value === null) return value
  if (typeof value === 'string') return redactSensitiveText(value).slice(0, 240)
  return null
}

function safeDetails(details) {
  const output = {}
  for (const [key, value] of Object.entries(details || {})) {
    if (FORBIDDEN_DETAIL_KEY.test(key)) continue
    if (Array.isArray(value)) {
      output[key] = value.slice(0, 16).map(safePrimitive)
      continue
    }
    const primitive = safePrimitive(value)
    if (primitive !== null || value === null) output[key] = primitive
  }
  return output
}

/**
 * Bounded event evidence for one read/decision/sign/submit lifecycle. It
 * intentionally stores no calldata, raw transaction, endpoint or secret.
 */
export class EventLifecycle {
  /**
   * @param {{eventId: string, source: string, observedAt?: string | null,
   * enqueuedAt?: string | null, dequeuedAt?: string | null,
   * firstSequenceNumber?: string | null, lastSequenceNumber?: string | null}} input
   */
  constructor(input) {
    const eventId = String(input?.eventId || '').trim()
    const source = String(input?.source || '').trim()
    if (!eventId || eventId.length > 160 || /(?:https?|wss?):\/\//i.test(eventId)) {
      throw new Error('event lifecycle id is invalid')
    }
    if (!SAFE_STAGE.test(source)) throw new Error('event lifecycle source is invalid')
    this.eventId = eventId
    this.source = source
    this.firstSequenceNumber = /^\d+$/.test(String(input.firstSequenceNumber || ''))
      ? String(input.firstSequenceNumber)
      : null
    this.lastSequenceNumber = /^\d+$/.test(String(input.lastSequenceNumber || ''))
      ? String(input.lastSequenceNumber)
      : this.firstSequenceNumber
    this.observedAtMs = timestamp(input.observedAt)
    this.enqueuedAtMs = timestamp(input.enqueuedAt)
    this.dequeuedAtMs = timestamp(input.dequeuedAt)
    this.stateBlockNumber = null
    this.stateBlockHash = null
    this.catalogVersion = null
    this.graphVersion = null
    this.stages = []
    this.markInitial('OBSERVED', this.observedAtMs)
    this.markInitial('ENQUEUED', this.enqueuedAtMs)
    this.markInitial('DEQUEUED', this.dequeuedAtMs)
  }

  markInitial(stage, atMs) {
    if (atMs !== null) this.mark(stage, {}, atMs)
  }

  /** @param {string} stage @param {Record<string, any>} [details] @param {number | string} [at] */
  mark(stage, details = {}, at = Date.now()) {
    if (!SAFE_STAGE.test(stage)) throw new Error('event lifecycle stage is invalid')
    const atMs = timestamp(at)
    if (atMs === null) throw new Error('event lifecycle timestamp is invalid')
    this.stages.push({ stage, atMs, details: safeDetails(details) })
    return this
  }

  /** @param {{number: bigint | number | string, hash?: string | null}} block */
  pinState(block) {
    const blockNumber = BigInt(block.number)
    const blockHash = /^0x[0-9a-f]{64}$/i.test(String(block.hash || '')) ? String(block.hash).toLowerCase() : null
    this.stateBlockNumber = blockNumber.toString()
    this.stateBlockHash = blockHash
    return this
  }

  /** @param {{catalogVersion?: string | null, graphVersion?: string | null}} versions */
  setVersions(versions) {
    this.catalogVersion = String(versions.catalogVersion || '').slice(0, 240) || null
    this.graphVersion = String(versions.graphVersion || '').slice(0, 240) || null
    return this
  }

  snapshot() {
    const baseline = this.observedAtMs ?? this.enqueuedAtMs ?? this.dequeuedAtMs ?? this.stages[0]?.atMs ?? null
    const stages = this.stages.map((item) => ({
      stage: item.stage,
      at: new Date(item.atMs).toISOString(),
      sinceObservedMs: baseline === null ? null : Math.max(0, item.atMs - baseline),
      ...item.details,
    }))
    return {
      eventId: this.eventId,
      source: this.source,
      sequence: {
        first: this.firstSequenceNumber,
        last: this.lastSequenceNumber,
      },
      state: {
        blockNumber: this.stateBlockNumber,
        blockHash: this.stateBlockHash,
      },
      catalogVersion: this.catalogVersion,
      graphVersion: this.graphVersion,
      currentStage: stages.at(-1)?.stage || null,
      stages,
    }
  }
}
