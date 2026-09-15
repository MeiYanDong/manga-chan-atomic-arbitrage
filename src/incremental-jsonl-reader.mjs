import fs from 'node:fs'

const DEFAULT_CHUNK_BYTES = 64 * 1024
const DEFAULT_MAX_LINE_BYTES = 2 * 1024 * 1024
const AUDIT_PREFIX_BYTES = 1024
const EVENT_SCAN_TAIL_CHARACTERS = 512

// v0.16.6 could persist a multi-megabyte dependency explanation on this
// signer-free scheduler event. It is not consumed by mutation recovery,
// authorization accounting or receipt reconciliation. No other oversized
// event is accepted: an unknown or safety-relevant record still fails closed.
const SKIPPABLE_OVERSIZE_EVENTS = new Set(['global_watch_wake'])

export const SAFETY_AUDIT_EVENTS = Object.freeze([
  'mutation_signed',
  'execution_signed',
  'deployment_signed',
  'withdrawal_signed',
  'mutation_effect',
  'mutation_reverted',
  'mutation_abandoned',
  'execution_complete',
  'execution_reverted',
  'deployment_complete',
  'deployment_recovered',
  'deployment_reverted',
  'withdrawal_complete',
  'withdrawal_reverted',
  'mutation_plan',
  'dual_watch_exact_preflight_started',
  'earn_watch_exact_preflight_started',
  'global_watch_exact_preflight_started',
  'earn_watch_wake',
])

function positiveInteger(value, label, maximum) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new RangeError(`${label} must be an integer from 1 to ${maximum}`)
  }
  return value
}

function escapeRegularExpression(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function leadingAuditEvent(line) {
  const prefix = line.subarray(0, Math.min(line.length, AUDIT_PREFIX_BYTES)).toString('utf8')
  const match = /^\{"at":"[^"\r\n]{1,128}","lane":"[^"\r\n]{1,128}","event":"([^"\\\r\n]{1,128})"(?:,|})/.exec(prefix)
  return match?.[1] || null
}

/**
 * Incrementally reads an append-only JSONL ledger without reparsing history.
 * Only explicitly selected events are parsed and retained. Safety-relevant
 * malformed or overlarge records fail closed; unrelated diagnostic records do
 * not become long-lived heap objects.
 */
export class IncrementalJsonlEventReader {
  /**
   * @param {string} file
   * @param {{events?: Iterable<string>, chunkBytes?: number, maxLineBytes?: number, projectRecord?: ((record: Record<string, any>) => unknown)}} [options]
   */
  constructor(file, options = {}) {
    if (typeof file !== 'string' || file.length === 0) throw new Error('JSONL file path is required')
    const events = [...(options.events || SAFETY_AUDIT_EVENTS)]
    if (events.length === 0 || events.some((event) => typeof event !== 'string' || event.length === 0)) {
      throw new Error('JSONL accepted events must be non-empty strings')
    }
    this.file = file
    this.events = new Set(events)
    this.chunkBytes = positiveInteger(options.chunkBytes ?? DEFAULT_CHUNK_BYTES, 'JSONL chunk size', 16 * 1024 * 1024)
    this.maxLineBytes = positiveInteger(
      options.maxLineBytes ?? DEFAULT_MAX_LINE_BYTES,
      'JSONL maximum line size',
      64 * 1024 * 1024,
    )
    this.eventPattern = new RegExp(`"event"\\s*:\\s*"(?:${events.map(escapeRegularExpression).join('|')})"`)
    if (options.projectRecord !== undefined && typeof options.projectRecord !== 'function') {
      throw new Error('JSONL record projector must be a function')
    }
    this.projectRecord = options.projectRecord || null
    this.device = null
    this.inode = null
    this.offset = 0
    this.pending = Buffer.alloc(0)
    this.records = []
    this.skippingOversize = false
    this.skippedEventScanTail = ''
  }

  reset(stat = null) {
    this.device = stat?.dev ?? null
    this.inode = stat?.ino ?? null
    this.offset = 0
    this.pending = Buffer.alloc(0)
    this.records = []
    this.skippingOversize = false
    this.skippedEventScanTail = ''
  }

  scanSkippedBytes(bytes) {
    const text = `${this.skippedEventScanTail}${bytes.toString('utf8')}`
    if (this.eventPattern.test(text)) {
      throw new Error('oversized diagnostic JSONL record contains a safety event')
    }
    this.skippedEventScanTail = text.slice(-EVENT_SCAN_TAIL_CHARACTERS)
  }

  beginOversizeSkip(line, { unterminated = false } = {}) {
    const event = leadingAuditEvent(line)
    if (!SKIPPABLE_OVERSIZE_EVENTS.has(event)) {
      const qualifier = unterminated ? 'unterminated safety' : 'safety'
      throw new Error(`${qualifier} JSONL record exceeds ${this.maxLineBytes} bytes`)
    }
    this.scanSkippedBytes(line)
    this.pending = Buffer.alloc(0)
    this.skippingOversize = true
  }

  finishOversizeSkip() {
    this.skippingOversize = false
    this.skippedEventScanTail = ''
  }

  parseLine(line) {
    const normalized = line.length > 0 && line[line.length - 1] === 13 ? line.subarray(0, -1) : line
    if (normalized.length === 0) return
    if (normalized.length > this.maxLineBytes) {
      this.beginOversizeSkip(normalized)
      this.finishOversizeSkip()
      return
    }
    const text = normalized.toString('utf8')
    if (!this.eventPattern.test(text)) return
    let record
    try {
      record = JSON.parse(text)
    } catch (error) {
      throw new Error('safety JSONL record is malformed', { cause: error })
    }
    if (!record || typeof record !== 'object' || !this.events.has(record.event)) {
      throw new Error('safety JSONL record event does not match its accepted prefilter')
    }
    const projected = this.projectRecord ? this.projectRecord(record) : record
    if (projected !== null && projected !== undefined) this.records.push(projected)
  }

  consume(chunk) {
    let remaining = chunk
    if (this.skippingOversize) {
      const newline = remaining.indexOf(10)
      if (newline < 0) {
        this.scanSkippedBytes(remaining)
        return
      }
      this.scanSkippedBytes(remaining.subarray(0, newline))
      this.finishOversizeSkip()
      remaining = remaining.subarray(newline + 1)
    }

    const bytes = this.pending.length === 0 ? remaining : Buffer.concat([this.pending, remaining])
    let start = 0
    for (;;) {
      const newline = bytes.indexOf(10, start)
      if (newline < 0) break
      this.parseLine(bytes.subarray(start, newline))
      start = newline + 1
    }
    this.pending = bytes.subarray(start)
    if (this.pending.length > this.maxLineBytes) {
      this.beginOversizeSkip(this.pending, { unterminated: true })
    }
  }

  read() {
    let stat
    try {
      stat = fs.statSync(this.file)
    } catch (error) {
      if (error?.code === 'ENOENT') {
        this.reset()
        return this.records
      }
      throw error
    }
    if (!stat.isFile()) throw new Error('safety JSONL path is not a regular file')
    if (this.device !== stat.dev || this.inode !== stat.ino || stat.size < this.offset) this.reset(stat)
    if (this.device === null || this.inode === null) {
      this.device = stat.dev
      this.inode = stat.ino
    }
    if (stat.size === this.offset) return this.records

    const descriptor = fs.openSync(this.file, 'r')
    try {
      const buffer = Buffer.allocUnsafe(this.chunkBytes)
      const target = stat.size
      while (this.offset < target) {
        const wanted = Math.min(buffer.length, target - this.offset)
        const bytesRead = fs.readSync(descriptor, buffer, 0, wanted, this.offset)
        if (bytesRead === 0) break
        this.offset += bytesRead
        this.consume(Buffer.from(buffer.subarray(0, bytesRead)))
      }
    } finally {
      fs.closeSync(descriptor)
    }
    return this.records
  }
}

const safetyReaders = new Map()

/** @param {string} file */
export function readSafetyAuditRecords(file) {
  let reader = safetyReaders.get(file)
  if (!reader) {
    reader = new IncrementalJsonlEventReader(file)
    safetyReaders.set(file, reader)
  }
  return reader.read()
}
