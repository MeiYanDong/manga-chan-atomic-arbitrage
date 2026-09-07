import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { stablePayloadHash } from './source-provenance.mjs'

export const BOARD_STORE_SCHEMA_VERSION = 1

function parseJson(value) {
  return value === null || value === undefined ? null : JSON.parse(String(value))
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
    `)
    this.database
      .prepare('INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)')
      .run('schema_version', String(BOARD_STORE_SCHEMA_VERSION))
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
    if (fresh.length === 0) return { appended: 0, records: [...unique.values()] }

    const descriptor = fs.openSync(this.evidencePath, 'a', 0o600)
    try {
      fs.writeSync(descriptor, `${fresh.map((record) => JSON.stringify(record)).join('\n')}\n`)
      fs.fsyncSync(descriptor)
    } finally {
      fs.closeSync(descriptor)
    }
    fs.chmodSync(this.evidencePath, 0o600)
    return { appended: fresh.length, records: [...unique.values()] }
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
    })
    return appended.appended
  }

  replayEvidenceLedger() {
    if (!fs.existsSync(this.evidencePath)) return { lines: 0, inserted: 0 }
    const content = fs.readFileSync(this.evidencePath, 'utf8')
    const lines = content.split('\n').filter((line) => line.trim().length > 0)
    let inserted = 0
    this.transact(() => {
      for (const [index, line] of lines.entries()) {
        let record
        try {
          record = ledgerRecord(JSON.parse(line))
        } catch (error) {
          throw new Error(`invalid evidence ledger line ${index + 1}: ${error.message}`)
        }
        if (this.insertEvidence(record)) inserted += 1
        this.applyProjectionRecord(record)
      }
    })
    return { lines: lines.length, inserted }
  }

  projectionRecords(snapshot, sourceCatalog, events) {
    const opportunityRecords = (snapshot.items || []).map((item) =>
      contentRecord('OPPORTUNITY_PROJECTION', item.id, item, snapshot.generatedAt),
    )
    const sourceRecord = sourceCatalog
      ? contentRecord(
          'SOURCE_CATALOG_PROJECTION',
          'current',
          sourceCatalog,
          sourceCatalog.generatedAt || snapshot.generatedAt,
        )
      : null
    const header = { ...snapshot }
    delete header.items
    const commit = contentRecord(
      'BOARD_SNAPSHOT_COMMIT',
      snapshot.generatedAt,
      {
        header,
        opportunityEvidenceIds: opportunityRecords.map((record) => record.evidenceId),
        sourceCatalogEvidenceId: sourceRecord?.evidenceId || null,
      },
      snapshot.generatedAt,
    )
    return [
      ...sourceEvidence(sourceCatalog),
      ...(events || []).map((event) => boardEventRecord(event)),
      ...opportunityRecords,
      ...(sourceRecord ? [sourceRecord] : []),
      commit,
    ]
  }

  persistProjection({ snapshot, sourceCatalog = null, events = [] }) {
    const appended = this.ingest(this.projectionRecords(snapshot, sourceCatalog, events))
    const current = this.readCurrentSnapshot({ fallback: false })
    const parity = current !== null && stablePayloadHash(current) === stablePayloadHash(snapshot)
    if (!parity) throw new Error('SQLite projection parity mismatch after commit')
    return { appended, parity, revision: this.currentRevision() }
  }

  migrateLegacyProjection() {
    if (this.currentRevision() !== null || !this.legacySnapshotPath || !fs.existsSync(this.legacySnapshotPath)) {
      return { migrated: false }
    }
    const snapshot = parseJson(fs.readFileSync(this.legacySnapshotPath, 'utf8'))
    const sourceCatalog =
      this.sourceCatalogPath && fs.existsSync(this.sourceCatalogPath)
        ? parseJson(fs.readFileSync(this.sourceCatalogPath, 'utf8'))
        : null
    const result = this.persistProjection({ snapshot, sourceCatalog, events: [] })
    return { migrated: true, ...result }
  }

  currentRevision() {
    const row = this.database.prepare('SELECT MAX(revision) AS revision FROM snapshot_commits').get()
    return row?.revision === null || row?.revision === undefined ? null : Number(row.revision)
  }

  readCurrentSnapshot({ fallback = true } = {}) {
    const row = this.database.prepare('SELECT payload_json FROM snapshot_commits ORDER BY revision DESC LIMIT 1').get()
    if (row) return parseJson(row.payload_json)
    if (fallback && this.legacySnapshotPath && fs.existsSync(this.legacySnapshotPath)) {
      return parseJson(fs.readFileSync(this.legacySnapshotPath, 'utf8'))
    }
    return null
  }

  readSourceCatalog() {
    const row = this.database.prepare('SELECT payload_json FROM source_catalog WHERE singleton = 1').get()
    return row ? parseJson(row.payload_json) : null
  }

  listOpportunities() {
    return this.database
      .prepare('SELECT payload_json FROM opportunities ORDER BY opportunity_id')
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

  health() {
    const integrity = this.database.prepare('PRAGMA integrity_check').get()
    return {
      schemaVersion: BOARD_STORE_SCHEMA_VERSION,
      status: integrity?.integrity_check === 'ok' ? 'HEALTHY' : 'DEGRADED',
      sqlitePath: path.basename(this.sqlitePath),
      evidencePath: path.basename(this.evidencePath),
      sqliteMode: mode(this.sqlitePath),
      evidenceMode: mode(this.evidencePath),
      currentRevision: this.currentRevision(),
      evidenceRecords: Number(this.database.prepare('SELECT COUNT(*) AS count FROM evidence').get().count),
      integrity: integrity?.integrity_check || 'UNKNOWN',
    }
  }

  close() {
    this.database.close()
  }
}
