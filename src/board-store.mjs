import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { StringDecoder } from 'node:string_decoder'
import { stablePayloadHash } from './source-provenance.mjs'

export const BOARD_STORE_SCHEMA_VERSION = 2

const MATERIAL_OPPORTUNITY_EVENT_TYPES = new Set(['SCREENED_POSITIVE_ENTERED', 'MATERIAL_NET_CHANGE'])

function parseJson(value) {
  return value === null || value === undefined ? null : JSON.parse(String(value))
}

function serializeProjection(value) {
  const json = JSON.stringify(value)
  return {
    json,
    hash: `sha256:${createHash('sha256').update(json).digest('hex')}`,
  }
}

function contentRecord(kind, key, payload, observedAt) {
  const payloadHash = stablePayloadHash(payload)
  return {
    evidenceId: `projection:${kind.toLowerCase()}:${key}:${payloadHash.slice('sha256:'.length)}`,
    kind,
    producer: 'MANGA_OPPORTUNITY_BOARD',
    observedAt,
    chainId: 4663,
    blockNumber: null,
    blockHash: null,
    transactionHash: null,
    payloadHash,
    status: 'OBSERVED',
    payload,
  }
}

function ledgerRecord(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('ledger record must be an object')
  if (typeof raw.evidenceId !== 'string' || raw.evidenceId.length < 3) throw new Error('ledger evidenceId is required')
  if (typeof raw.kind !== 'string' || raw.kind.length === 0) throw new Error('ledger kind is required')
  if (!Number.isFinite(Date.parse(raw.observedAt))) throw new Error(`invalid ledger observedAt: ${raw.evidenceId}`)
  const payloadHash = raw.payloadHash || stablePayloadHash(raw.payload)
  if (payloadHash !== stablePayloadHash(raw.payload)) throw new Error(`ledger payload hash mismatch: ${raw.evidenceId}`)
  return {
    evidenceId: raw.evidenceId,
    kind: raw.kind,
    producer: raw.producer || 'UNKNOWN_PRODUCER',
    observedAt: new Date(raw.observedAt).toISOString(),
    chainId: raw.chainId ?? null,
    blockNumber: raw.blockNumber ?? null,
    blockHash: raw.blockHash ?? null,
    transactionHash: raw.transactionHash ?? null,
    payloadHash,
    status: raw.status || 'OBSERVED',
    payload: raw.payload ?? null,
  }
}

function sourceEvidence(sourceCatalog) {
  const output = (sourceCatalog?.evidence || []).map((item) => ledgerRecord(item))
  for (const collection of ['longLaunches', 'dopplerLaunches', 'pools']) {
    for (const item of sourceCatalog?.[collection] || []) {
      if (item?.evidence) output.push(ledgerRecord(item.evidence))
    }
  }
  return output
}

function boardEventRecord(event) {
  const payloadHash = stablePayloadHash(event)
  return ledgerRecord({
    evidenceId: `board-event:${event.type || 'UNKNOWN'}:${payloadHash.slice('sha256:'.length)}`,
    kind: 'BOARD_EVENT',
    producer: 'MANGA_OPPORTUNITY_BOARD',
    observedAt: event.at || new Date().toISOString(),
    chainId: 4663,
    payloadHash,
    payload: event,
  })
}

function boardCheckpointRecord(
  snapshot,
  sourceCatalog,
  retainedOpportunityRecords,
  eventRecords,
  { snapshotHash, sourceCatalogHash },
) {
  return contentRecord(
    'BOARD_CHECKPOINT',
    snapshot.generatedAt,
    {
      schemaVersion: 2,
      generatedAt: snapshot.generatedAt,
      snapshotHash,
      sourceCatalogHash,
      projectionHashSemantics: 'SHA256_JSON_BYTES_V1',
      opportunityCount: (snapshot.items || []).length,
      retainedOpportunityEvidenceIds: retainedOpportunityRecords.map((record) => record.evidenceId),
      eventEvidenceIds: eventRecords.map((record) => record.evidenceId),
      storageSemantics: 'ATOMIC_CURRENT_PROJECTION_PLUS_APPEND_ONLY_MATERIAL_EVIDENCE',
    },
    snapshot.generatedAt,
  )
}

function mode(pathname) {
  if (!fs.existsSync(pathname)) return null
  return fs.statSync(pathname).mode & 0o777
}

export class BoardStore {
  /**
   * @param {{runDir: string, sqlitePath?: string, evidencePath?: string, legacySnapshotPath?: string, sourceCatalogPath?: string}} options
   */
  constructor({ runDir, sqlitePath, evidencePath, legacySnapshotPath, sourceCatalogPath }) {
    this.runDir = path.resolve(runDir)
    this.sqlitePath = path.resolve(sqlitePath || path.join(this.runDir, 'board.sqlite'))
    this.evidencePath = path.resolve(evidencePath || path.join(this.runDir, 'evidence.jsonl'))
    this.legacySnapshotPath = legacySnapshotPath ? path.resolve(legacySnapshotPath) : null
    this.sourceCatalogPath = sourceCatalogPath ? path.resolve(sourceCatalogPath) : null
    this.integrityState = null
    this.currentSnapshotCache = null
    this.currentSourceCatalogCache = null
    fs.mkdirSync(this.runDir, { recursive: true, mode: 0o700 })
    fs.chmodSync(this.runDir, 0o700)
    this.database = new DatabaseSync(this.sqlitePath)
    fs.chmodSync(this.sqlitePath, 0o600)
    this.initializeSchema()
    this.replayEvidenceLedger()
    this.migrateLegacyProjection()
  }

  initializeSchema() {
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS evidence (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        evidence_id TEXT NOT NULL UNIQUE,
        kind TEXT NOT NULL,
        producer TEXT NOT NULL,
        observed_at TEXT NOT NULL,
        chain_id INTEGER,
        block_number TEXT,
        block_hash TEXT,
        transaction_hash TEXT,
        payload_hash TEXT NOT NULL,
        status TEXT NOT NULL,
        payload_json TEXT
      );
      CREATE INDEX IF NOT EXISTS evidence_kind_sequence_idx ON evidence(kind, sequence DESC);
      CREATE INDEX IF NOT EXISTS evidence_transaction_idx ON evidence(transaction_hash);
      CREATE TABLE IF NOT EXISTS opportunities (
        opportunity_id TEXT PRIMARY KEY,
        evidence_id TEXT NOT NULL REFERENCES evidence(evidence_id),
        updated_at TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS episodes (
        episode_id TEXT PRIMARY KEY,
        opportunity_id TEXT NOT NULL,
        state TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS executions (
        execution_id TEXT PRIMARY KEY,
        state TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS source_catalog (
        singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
        evidence_id TEXT NOT NULL REFERENCES evidence(evidence_id),
        updated_at TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS snapshot_commits (
        revision INTEGER PRIMARY KEY AUTOINCREMENT,
        evidence_id TEXT NOT NULL UNIQUE REFERENCES evidence(evidence_id),
        generated_at TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS current_snapshot (
        singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
        revision INTEGER NOT NULL,
        generated_at TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS current_opportunities (
        opportunity_id TEXT PRIMARY KEY,
        updated_at TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS current_source_catalog (
        singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
        updated_at TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );
    `)
    this.database
      .prepare('INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)')
      .run('schema_version', String(BOARD_STORE_SCHEMA_VERSION))
  }

  metaValue(key) {
    const row = this.database.prepare('SELECT value FROM meta WHERE key = ?').get(key)
    return row ? String(row.value) : null
  }

  setMeta(key, value) {
    this.database.prepare('INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)').run(key, String(value))
  }

  existingEvidence(evidenceId) {
    return this.database.prepare('SELECT payload_hash FROM evidence WHERE evidence_id = ?').get(evidenceId) || null
  }

  appendRecords(records) {
    const unique = new Map()
    for (const raw of records) {
      const record = ledgerRecord(raw)
      const previous = unique.get(record.evidenceId)
      if (previous && previous.payloadHash !== record.payloadHash)
        throw new Error(`evidence collision: ${record.evidenceId}`)
      unique.set(record.evidenceId, record)
    }

    const fresh = []
    for (const record of unique.values()) {
      const existing = this.existingEvidence(record.evidenceId)
      if (existing && existing.payload_hash !== record.payloadHash)
        throw new Error(`evidence collision: ${record.evidenceId}`)
      if (!existing) fresh.push(record)
    }
    if (fresh.length === 0) {
      return {
        appended: 0,
        records: [...unique.values()],
        ledgerEndOffset: fs.existsSync(this.evidencePath) ? fs.statSync(this.evidencePath).size : 0,
      }
    }

    const descriptor = fs.openSync(this.evidencePath, 'a', 0o600)
    let ledgerEndOffset
    try {
      fs.writeSync(descriptor, `${fresh.map((record) => JSON.stringify(record)).join('\n')}\n`)
      fs.fsyncSync(descriptor)
      ledgerEndOffset = fs.fstatSync(descriptor).size
    } finally {
      fs.closeSync(descriptor)
    }
    fs.chmodSync(this.evidencePath, 0o600)
    return { appended: fresh.length, records: [...unique.values()], ledgerEndOffset }
  }

  insertEvidence(record) {
    const existing = this.existingEvidence(record.evidenceId)
    if (existing) {
      if (existing.payload_hash !== record.payloadHash) throw new Error(`evidence collision: ${record.evidenceId}`)
      return false
    }
    this.database
      .prepare(
        `INSERT INTO evidence(
          evidence_id, kind, producer, observed_at, chain_id, block_number, block_hash,
          transaction_hash, payload_hash, status, payload_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.evidenceId,
        record.kind,
        record.producer,
        record.observedAt,
        record.chainId,
        record.blockNumber,
        record.blockHash,
        record.transactionHash,
        record.payloadHash,
        record.status,
        JSON.stringify(record.payload),
      )
    return true
  }

  applyProjectionRecord(record) {
    if (record.kind === 'OPPORTUNITY_PROJECTION') {
      this.database
        .prepare(
          `INSERT INTO opportunities(opportunity_id, evidence_id, updated_at, payload_json)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(opportunity_id) DO UPDATE SET
             evidence_id = excluded.evidence_id,
             updated_at = excluded.updated_at,
             payload_json = excluded.payload_json`,
        )
        .run(record.payload.id, record.evidenceId, record.observedAt, JSON.stringify(record.payload))
      const episode = record.payload.economicEpisode
      if (episode?.episodeId) {
        this.database
          .prepare(
            `INSERT INTO episodes(episode_id, opportunity_id, state, updated_at, payload_json)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(episode_id) DO UPDATE SET
               state = excluded.state,
               updated_at = excluded.updated_at,
               payload_json = excluded.payload_json`,
          )
          .run(episode.episodeId, record.payload.id, episode.state, record.observedAt, JSON.stringify(episode))
      }
      return
    }
    if (record.kind === 'SOURCE_CATALOG_PROJECTION') {
      this.database
        .prepare(
          `INSERT INTO source_catalog(singleton, evidence_id, updated_at, payload_json)
           VALUES (1, ?, ?, ?)
           ON CONFLICT(singleton) DO UPDATE SET
             evidence_id = excluded.evidence_id,
             updated_at = excluded.updated_at,
             payload_json = excluded.payload_json`,
        )
        .run(record.evidenceId, record.observedAt, JSON.stringify(record.payload))
      return
    }
    if (record.kind === 'EXECUTION_PROJECTION') {
      this.database
        .prepare(
          `INSERT INTO executions(execution_id, state, updated_at, payload_json)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(execution_id) DO UPDATE SET
             state = excluded.state,
             updated_at = excluded.updated_at,
             payload_json = excluded.payload_json`,
        )
        .run(record.payload.executionId, record.payload.state, record.observedAt, JSON.stringify(record.payload))
      return
    }
    if (record.kind === 'BOARD_SNAPSHOT_COMMIT') this.applySnapshotCommit(record)
  }

  applySnapshotCommit(record) {
    const items = record.payload.opportunityEvidenceIds.map((evidenceId) => {
      const row = this.database.prepare('SELECT payload_json FROM evidence WHERE evidence_id = ?').get(evidenceId)
      if (!row) throw new Error(`snapshot commit references missing evidence: ${evidenceId}`)
      return parseJson(row.payload_json)
    })
    const snapshot = { ...record.payload.header, items }
    if (record.payload.sourceCatalogEvidenceId) {
      const source = this.database
        .prepare('SELECT kind FROM evidence WHERE evidence_id = ?')
        .get(record.payload.sourceCatalogEvidenceId)
      if (!source || source.kind !== 'SOURCE_CATALOG_PROJECTION') {
        throw new Error(`snapshot commit references missing source catalog: ${record.payload.sourceCatalogEvidenceId}`)
      }
    }
    const currentOpportunityIds = new Set(items.map((item) => item.id))
    for (const row of this.database.prepare('SELECT opportunity_id FROM opportunities').all()) {
      if (!currentOpportunityIds.has(row.opportunity_id)) {
        this.database.prepare('DELETE FROM opportunities WHERE opportunity_id = ?').run(row.opportunity_id)
      }
    }
    const payloadJson = JSON.stringify(snapshot)
    this.database
      .prepare(
        `INSERT OR IGNORE INTO snapshot_commits(evidence_id, generated_at, payload_hash, payload_json)
         VALUES (?, ?, ?, ?)`,
      )
      .run(record.evidenceId, snapshot.generatedAt, stablePayloadHash(snapshot), payloadJson)
  }

  applyCurrentProjection(snapshot, sourceCatalog, prepared = {}) {
    const current = this.database.prepare('SELECT revision FROM current_snapshot WHERE singleton = 1').get()
    const legacy = this.database.prepare('SELECT MAX(revision) AS revision FROM snapshot_commits').get()
    const revision = Math.max(Number(current?.revision || 0), Number(legacy?.revision || 0)) + 1
    const currentOpportunityIds = new Set()
    const opportunityStatement = this.database.prepare(
      `INSERT INTO current_opportunities(opportunity_id, updated_at, payload_hash, payload_json)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(opportunity_id) DO UPDATE SET
         updated_at = excluded.updated_at,
         payload_hash = excluded.payload_hash,
         payload_json = excluded.payload_json`,
    )
    const episodeStatement = this.database.prepare(
      `INSERT INTO episodes(episode_id, opportunity_id, state, updated_at, payload_json)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(episode_id) DO UPDATE SET
         state = excluded.state,
         updated_at = excluded.updated_at,
         payload_json = excluded.payload_json`,
    )
    for (const item of snapshot.items || []) {
      currentOpportunityIds.add(item.id)
      opportunityStatement.run(item.id, snapshot.generatedAt, stablePayloadHash(item), JSON.stringify(item))
      const episode = item.economicEpisode
      if (episode?.episodeId) {
        episodeStatement.run(episode.episodeId, item.id, episode.state, snapshot.generatedAt, JSON.stringify(episode))
      }
    }
    for (const row of this.database.prepare('SELECT opportunity_id FROM current_opportunities').all()) {
      if (!currentOpportunityIds.has(row.opportunity_id)) {
        this.database.prepare('DELETE FROM current_opportunities WHERE opportunity_id = ?').run(row.opportunity_id)
      }
    }
    if (sourceCatalog) {
      this.database
        .prepare(
          `INSERT INTO current_source_catalog(singleton, updated_at, payload_hash, payload_json)
           VALUES (1, ?, ?, ?)
           ON CONFLICT(singleton) DO UPDATE SET
             updated_at = excluded.updated_at,
             payload_hash = excluded.payload_hash,
             payload_json = excluded.payload_json`,
        )
        .run(
          sourceCatalog.generatedAt || snapshot.generatedAt,
          prepared.sourceCatalogHash || stablePayloadHash(sourceCatalog),
          prepared.sourceCatalogJson || JSON.stringify(sourceCatalog),
        )
    }
    this.database
      .prepare(
        `INSERT INTO current_snapshot(singleton, revision, generated_at, payload_hash, payload_json)
         VALUES (1, ?, ?, ?, ?)
         ON CONFLICT(singleton) DO UPDATE SET
           revision = excluded.revision,
           generated_at = excluded.generated_at,
           payload_hash = excluded.payload_hash,
           payload_json = excluded.payload_json`,
      )
      .run(
        revision,
        snapshot.generatedAt,
        prepared.snapshotHash || stablePayloadHash(snapshot),
        prepared.snapshotJson || JSON.stringify(snapshot),
      )
    return revision
  }

  transact(operation) {
    this.database.exec('BEGIN IMMEDIATE')
    try {
      const result = operation()
      this.database.exec('COMMIT')
      return result
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  ingest(records) {
    const appended = this.appendRecords(records)
    this.transact(() => {
      for (const record of appended.records) {
        this.insertEvidence(record)
        this.applyProjectionRecord(record)
      }
      this.setMeta('evidence_ledger_offset', appended.ledgerEndOffset)
    })
    return appended.appended
  }

  readLedgerTailRecord(fileSize) {
    if (fileSize === 0) return null
    const descriptor = fs.openSync(this.evidencePath, 'r')
    const chunks = []
    let position = fileSize
    try {
      while (position > 0) {
        const length = Math.min(64 * 1024, position)
        position -= length
        const chunk = Buffer.allocUnsafe(length)
        fs.readSync(descriptor, chunk, 0, length, position)
        chunks.unshift(chunk)
        const text = Buffer.concat(chunks).toString('utf8').trimEnd()
        const lineStart = text.lastIndexOf('\n')
        if (lineStart >= 0 || position === 0) {
          const line = text.slice(lineStart + 1).trim()
          return line.length > 0 ? ledgerRecord(JSON.parse(line)) : null
        }
        if (fileSize - position > 32 * 1024 * 1024) throw new Error('evidence ledger tail record exceeds 32 MiB')
      }
      return null
    } finally {
      fs.closeSync(descriptor)
    }
  }

  replayEvidenceLedger() {
    if (!fs.existsSync(this.evidencePath)) return { lines: 0, inserted: 0 }
    const fileSize = fs.statSync(this.evidencePath).size
    const storedOffset = this.metaValue('evidence_ledger_offset')
    let startOffset = storedOffset === null ? 0 : Number(storedOffset)
    if (!Number.isSafeInteger(startOffset) || startOffset < 0 || startOffset > fileSize) startOffset = 0

    const evidenceCount = Number(this.database.prepare('SELECT COUNT(*) AS count FROM evidence').get().count)
    if (storedOffset === null && evidenceCount > 0) {
      const tail = this.readLedgerTailRecord(fileSize)
      const existing = tail ? this.existingEvidence(tail.evidenceId) : null
      if (tail && existing?.payload_hash === tail.payloadHash) {
        this.transact(() => this.setMeta('evidence_ledger_offset', fileSize))
        return { lines: 0, inserted: 0, startOffset: fileSize, endOffset: fileSize, adoptedExistingLedger: true }
      }
    }

    if (startOffset === fileSize) {
      return { lines: 0, inserted: 0, startOffset, endOffset: fileSize, adoptedExistingLedger: false }
    }

    const descriptor = fs.openSync(this.evidencePath, 'r')
    const decoder = new StringDecoder('utf8')
    const buffer = Buffer.allocUnsafe(64 * 1024)
    let position = startOffset
    let remainder = ''
    let lines = 0
    let inserted = 0
    const applyLine = (line) => {
      if (line.trim().length === 0) return
      lines += 1
      let record
      try {
        record = ledgerRecord(JSON.parse(line))
      } catch (error) {
        throw new Error(`invalid evidence ledger record after byte ${startOffset}, item ${lines}: ${error.message}`)
      }
      if (this.insertEvidence(record)) inserted += 1
      this.applyProjectionRecord(record)
    }

    try {
      this.transact(() => {
        while (position < fileSize) {
          const length = Math.min(buffer.length, fileSize - position)
          const bytesRead = fs.readSync(descriptor, buffer, 0, length, position)
          if (bytesRead === 0) break
          position += bytesRead
          remainder += decoder.write(buffer.subarray(0, bytesRead))
          const complete = remainder.split('\n')
          remainder = complete.pop() || ''
          for (const line of complete) applyLine(line)
        }
        remainder += decoder.end()
        if (remainder.trim().length > 0) applyLine(remainder)
        this.setMeta('evidence_ledger_offset', fileSize)
      })
    } finally {
      fs.closeSync(descriptor)
    }
    return { lines, inserted, startOffset, endOffset: fileSize, adoptedExistingLedger: false }
  }

  projectionRecords(snapshot, sourceCatalog, events, prepared = {}) {
    const eventList = events || []
    const baseline = eventList.some((event) => event.type === 'BOARD_BASELINE_CREATED')
    const materialOpportunityIds = new Set(
      eventList.filter((event) => MATERIAL_OPPORTUNITY_EVENT_TYPES.has(event.type)).map((event) => event.id),
    )
    const opportunityRecords = (snapshot.items || [])
      .filter((item) => item.status === 'SCREENED_NET_POSITIVE' && (baseline || materialOpportunityIds.has(item.id)))
      .map((item) => contentRecord('OPPORTUNITY_OBSERVATION', item.id, item, snapshot.generatedAt))
    const eventRecords = eventList.map((event) => boardEventRecord(event))
    const checkpoint = boardCheckpointRecord(snapshot, sourceCatalog, opportunityRecords, eventRecords, {
      snapshotHash: prepared.snapshotHash || stablePayloadHash(snapshot),
      sourceCatalogHash: prepared.sourceCatalogHash || stablePayloadHash(sourceCatalog),
    })
    return [...sourceEvidence(sourceCatalog), ...eventRecords, ...opportunityRecords, checkpoint]
  }

  persistProjection({ snapshot, sourceCatalog = null, sourceCatalogHash = null, events = [] }) {
    const serializedSnapshot = serializeProjection(snapshot)
    const serializedSourceCatalog = sourceCatalog ? serializeProjection(sourceCatalog) : null
    if (sourceCatalogHash !== null && !/^sha256:[0-9a-f]{64}$/.test(sourceCatalogHash)) {
      throw new Error('source catalog hash must be a sha256 digest')
    }
    if (serializedSourceCatalog && sourceCatalogHash && serializedSourceCatalog.hash !== sourceCatalogHash) {
      throw new Error('source catalog payload does not match its supplied hash')
    }
    const prepared = {
      snapshotHash: serializedSnapshot.hash,
      snapshotJson: serializedSnapshot.json,
      sourceCatalogHash: serializedSourceCatalog?.hash || sourceCatalogHash || stablePayloadHash(null),
      sourceCatalogJson: serializedSourceCatalog?.json || null,
    }
    const records = this.projectionRecords(snapshot, sourceCatalog, events, prepared)
    const appended = this.appendRecords(records)
    let revision
    this.transact(() => {
      for (const record of appended.records) {
        this.insertEvidence(record)
        this.applyProjectionRecord(record)
      }
      revision = this.applyCurrentProjection(snapshot, sourceCatalog, prepared)
      this.setMeta('evidence_ledger_offset', appended.ledgerEndOffset)
    })
    this.currentSnapshotCache = snapshot
    if (sourceCatalog) this.currentSourceCatalogCache = sourceCatalog
    const current = this.database.prepare('SELECT payload_hash FROM current_snapshot WHERE singleton = 1').get()
    const parity = current?.payload_hash === prepared.snapshotHash
    if (!parity) throw new Error('SQLite projection parity mismatch after commit')
    return { appended: appended.appended, parity, revision, sourceCatalogPersisted: Boolean(sourceCatalog) }
  }

  migrateLegacyProjection() {
    if (this.database.prepare('SELECT 1 FROM current_snapshot WHERE singleton = 1').get()) return { migrated: false }
    const legacySnapshot = this.database
      .prepare('SELECT payload_json FROM snapshot_commits ORDER BY revision DESC LIMIT 1')
      .get()
    const snapshot =
      this.legacySnapshotPath && fs.existsSync(this.legacySnapshotPath)
        ? parseJson(fs.readFileSync(this.legacySnapshotPath, 'utf8'))
        : parseJson(legacySnapshot?.payload_json)
    if (!snapshot) return { migrated: false }
    const legacySourceCatalog = this.database
      .prepare('SELECT payload_json FROM source_catalog WHERE singleton = 1')
      .get()
    const sourceCatalog =
      this.sourceCatalogPath && fs.existsSync(this.sourceCatalogPath)
        ? parseJson(fs.readFileSync(this.sourceCatalogPath, 'utf8'))
        : parseJson(legacySourceCatalog?.payload_json)
    const result = this.persistProjection({ snapshot, sourceCatalog, events: [] })
    return { migrated: true, ...result }
  }

  currentRevision() {
    const current = this.database.prepare('SELECT revision FROM current_snapshot WHERE singleton = 1').get()
    if (current) return Number(current.revision)
    const row = this.database.prepare('SELECT MAX(revision) AS revision FROM snapshot_commits').get()
    return row?.revision === null || row?.revision === undefined ? null : Number(row.revision)
  }

  readCurrentSnapshot({ fallback = true } = {}) {
    if (this.currentSnapshotCache) return this.currentSnapshotCache
    const current = this.database.prepare('SELECT payload_json FROM current_snapshot WHERE singleton = 1').get()
    if (current) {
      this.currentSnapshotCache = parseJson(current.payload_json)
      return this.currentSnapshotCache
    }
    const row = this.database.prepare('SELECT payload_json FROM snapshot_commits ORDER BY revision DESC LIMIT 1').get()
    if (row) {
      this.currentSnapshotCache = parseJson(row.payload_json)
      return this.currentSnapshotCache
    }
    if (fallback && this.legacySnapshotPath && fs.existsSync(this.legacySnapshotPath)) {
      return parseJson(fs.readFileSync(this.legacySnapshotPath, 'utf8'))
    }
    return null
  }

  readSourceCatalog() {
    if (this.currentSourceCatalogCache) return this.currentSourceCatalogCache
    const current = this.database.prepare('SELECT payload_json FROM current_source_catalog WHERE singleton = 1').get()
    if (current) {
      this.currentSourceCatalogCache = parseJson(current.payload_json)
      return this.currentSourceCatalogCache
    }
    const row = this.database.prepare('SELECT payload_json FROM source_catalog WHERE singleton = 1').get()
    if (!row) return null
    this.currentSourceCatalogCache = parseJson(row.payload_json)
    return this.currentSourceCatalogCache
  }

  listOpportunities() {
    const currentProjection = this.database.prepare('SELECT 1 FROM current_snapshot WHERE singleton = 1').get()
    return this.database
      .prepare(
        currentProjection
          ? 'SELECT payload_json FROM current_opportunities ORDER BY opportunity_id'
          : 'SELECT payload_json FROM opportunities ORDER BY opportunity_id',
      )
      .all()
      .map((row) => parseJson(row.payload_json))
  }

  listEpisodes() {
    return this.database
      .prepare('SELECT payload_json FROM episodes ORDER BY updated_at DESC, episode_id')
      .all()
      .map((row) => parseJson(row.payload_json))
  }

  listExecutions() {
    return this.database
      .prepare('SELECT payload_json FROM executions ORDER BY updated_at DESC, execution_id')
      .all()
      .map((row) => parseJson(row.payload_json))
  }

  health({ verifyIntegrity = false } = {}) {
    if (verifyIntegrity || !this.integrityState) {
      const integrity = this.database.prepare('PRAGMA quick_check(1)').get()
      this.integrityState = {
        result: integrity?.quick_check || 'UNKNOWN',
        checkedAt: new Date().toISOString(),
      }
    }
    const ledgerBytes = fs.existsSync(this.evidencePath) ? fs.statSync(this.evidencePath).size : 0
    return {
      schemaVersion: BOARD_STORE_SCHEMA_VERSION,
      status: this.integrityState.result === 'ok' ? 'HEALTHY' : 'DEGRADED',
      projectionStorage: 'BOUNDED_SINGLETON_CURRENT_STATE',
      evidenceStorage: 'APPEND_ONLY_MATERIAL_EVIDENCE',
      sqlitePath: path.basename(this.sqlitePath),
      evidencePath: path.basename(this.evidencePath),
      sqliteMode: mode(this.sqlitePath),
      evidenceMode: mode(this.evidencePath),
      evidenceLedgerBytes: ledgerBytes,
      evidenceLedgerOffset: Number(this.metaValue('evidence_ledger_offset') || 0),
      currentRevision: this.currentRevision(),
      evidenceRecords: Number(this.database.prepare('SELECT COUNT(*) AS count FROM evidence').get().count),
      integrity: this.integrityState.result,
      integrityCheckedAt: this.integrityState.checkedAt,
    }
  }

  close() {
    this.database.close()
  }
}
