import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { BoardStore } from '../src/board-store.mjs'
import { stablePayloadHash } from '../src/source-provenance.mjs'

function temporaryRunDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'manga-board-store-'))
}

function snapshot(generatedAt = '2026-09-07T01:00:00.000Z') {
  return {
    schemaVersion: 4,
    service: 'manga-opportunity-board',
    mode: 'READ_ONLY_NO_SIGNING_NO_BROADCAST',
    generatedAt,
    health: { status: 'RUNNING', signerLoaded: false },
    source: { adapters: [] },
    coverage: { candidateTokens: 1, counts: { SCREENED_NET_POSITIVE: 0 } },
    items: [
      {
        id: '0x1111111111111111111111111111111111111111',
        symbol: 'TEST',
        status: 'NO_EDGE',
        economicEpisode: {
          episodeId: 'episode:test',
          state: 'CLOSED',
        },
      },
    ],
  }
}

function sourceCatalog(generatedAt = '2026-09-07T01:00:00.000Z') {
  return {
    schemaVersion: 4,
    generatedAt,
    adapters: {},
    longLaunches: [],
    dopplerLaunches: [],
    pools: [],
  }
}

test('SQLite projection and append-only JSONL retain exact snapshot parity', () => {
  const runDir = temporaryRunDir()
  const store = new BoardStore({ runDir })
  const expected = snapshot()
  const result = store.persistProjection({ snapshot: expected, sourceCatalog: sourceCatalog() })
  assert.equal(result.parity, true)
  assert.equal(stablePayloadHash(store.readCurrentSnapshot()), stablePayloadHash(expected))
  assert.equal(store.listOpportunities().length, 1)
  assert.equal(store.listEpisodes().length, 1)
  assert.equal(store.health().status, 'HEALTHY')
  assert.equal(fs.statSync(path.join(runDir, 'board.sqlite')).mode & 0o777, 0o600)
  assert.equal(fs.statSync(path.join(runDir, 'evidence.jsonl')).mode & 0o777, 0o600)
  store.close()
})

test('content-addressed ingestion is idempotent', () => {
  const runDir = temporaryRunDir()
  const store = new BoardStore({ runDir })
  const first = store.persistProjection({ snapshot: snapshot(), sourceCatalog: sourceCatalog() })
  const lineCount = fs.readFileSync(path.join(runDir, 'evidence.jsonl'), 'utf8').trim().split('\n').length
  const second = store.persistProjection({ snapshot: snapshot(), sourceCatalog: sourceCatalog() })
  const secondLineCount = fs.readFileSync(path.join(runDir, 'evidence.jsonl'), 'utf8').trim().split('\n').length
  assert.ok(first.appended > 0)
  assert.equal(second.appended, 0)
  assert.equal(secondLineCount, lineCount)
  store.close()
})

test('snapshot commits can reference an independently persisted source-catalog hash without copying its payload', () => {
  const runDir = temporaryRunDir()
  const store = new BoardStore({ runDir })
  const originalSource = sourceCatalog()
  store.persistProjection({ snapshot: snapshot(), sourceCatalog: originalSource })
  const sourceCatalogHash = stablePayloadHash({ very: 'large-independent-atomic-file' })
  const next = store.persistProjection({
    snapshot: snapshot('2026-09-07T01:01:00.000Z'),
    sourceCatalog: null,
    sourceCatalogHash,
  })

  assert.equal(next.sourceCatalogPersisted, false)
  assert.deepEqual(store.readSourceCatalog(), originalSource)
  const checkpoints = fs
    .readFileSync(path.join(runDir, 'evidence.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
    .filter((record) => record.kind === 'BOARD_CHECKPOINT')
  assert.equal(checkpoints.at(-1).payload.sourceCatalogHash, sourceCatalogHash)
  assert.throws(
    () =>
      store.persistProjection({
        snapshot: snapshot('2026-09-07T01:02:00.000Z'),
        sourceCatalogHash: 'not-a-digest',
      }),
    /source catalog hash must be a sha256 digest/,
  )
  assert.throws(
    () =>
      store.persistProjection({
        snapshot: snapshot('2026-09-07T01:03:00.000Z'),
        sourceCatalog: sourceCatalog(),
        sourceCatalogHash,
      }),
    /source catalog payload does not match its supplied hash/,
  )
  store.close()
})

test('an existing v1 database adopts its already-committed ledger tail without a full replay', () => {
  const runDir = temporaryRunDir()
  const store = new BoardStore({ runDir })
  store.persistProjection({ snapshot: snapshot(), sourceCatalog: sourceCatalog() })
  store.close()
  const sqlitePath = path.join(runDir, 'board.sqlite')
  const database = new DatabaseSync(sqlitePath)
  database.prepare("DELETE FROM meta WHERE key = 'evidence_ledger_offset'").run()
  database.close()

  const reopened = new BoardStore({ runDir })
  assert.equal(reopened.health().evidenceLedgerOffset, fs.statSync(path.join(runDir, 'evidence.jsonl')).size)
  reopened.close()
})

test('restart rebuilds the same SQLite projection from atomic checkpoints and JSONL evidence', () => {
  const runDir = temporaryRunDir()
  const legacySnapshotPath = path.join(runDir, 'snapshot.json')
  const sourceCatalogPath = path.join(runDir, 'source-catalog.json')
  const store = new BoardStore({ runDir, legacySnapshotPath, sourceCatalogPath })
  const expected = snapshot()
  const expectedSource = sourceCatalog()
  fs.writeFileSync(legacySnapshotPath, JSON.stringify(expected), { mode: 0o600 })
  fs.writeFileSync(sourceCatalogPath, JSON.stringify(expectedSource), { mode: 0o600 })
  store.persistProjection({ snapshot: expected, sourceCatalog: expectedSource })
  store.close()
  fs.rmSync(path.join(runDir, 'board.sqlite'))

  const replayed = new BoardStore({ runDir, legacySnapshotPath, sourceCatalogPath })
  assert.equal(stablePayloadHash(replayed.readCurrentSnapshot()), stablePayloadHash(expected))
  assert.equal(replayed.listOpportunities()[0].symbol, 'TEST')
  replayed.close()
})

test('routine negative scans update current state without duplicating full projections in the ledger', () => {
  const runDir = temporaryRunDir()
  const store = new BoardStore({ runDir })
  const first = snapshot()
  first.items = Array.from({ length: 100 }, (_, index) => ({
    id: `candidate:${index}`,
    symbol: `TOKEN${index}`,
    status: 'NO_EDGE',
    economicEpisode: { episodeId: `episode:${index}`, state: 'CLOSED' },
  }))
  const firstSource = sourceCatalog()
  firstSource.pairListings = Array.from({ length: 1_000 }, (_, index) => ({
    targetAddress: `candidate:${index}`,
    symbol: `TOKEN${index}`,
  }))
  store.persistProjection({ snapshot: first, sourceCatalog: firstSource })
  const second = { ...first, generatedAt: '2026-09-07T01:01:00.000Z' }
  const secondSource = { ...firstSource, generatedAt: second.generatedAt }
  store.persistProjection({ snapshot: second, sourceCatalog: secondSource })

  const ledger = fs.readFileSync(path.join(runDir, 'evidence.jsonl'), 'utf8')
  const records = ledger
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  assert.equal(records.filter((record) => record.kind === 'BOARD_CHECKPOINT').length, 2)
  assert.equal(
    records.some((record) => record.kind === 'OPPORTUNITY_PROJECTION'),
    false,
  )
  assert.equal(
    records.some((record) => record.kind === 'SOURCE_CATALOG_PROJECTION'),
    false,
  )
  assert.equal(store.listOpportunities().length, 100)
  assert.equal(store.readSourceCatalog().pairListings.length, 1_000)
  assert.ok(Buffer.byteLength(ledger) < 10_000)
  assert.equal(store.health().projectionStorage, 'BOUNDED_SINGLETON_CURRENT_STATE')
  store.close()
})

test('positive proxy observations remain in append-only material evidence', () => {
  const runDir = temporaryRunDir()
  const store = new BoardStore({ runDir })
  const positive = snapshot()
  positive.items[0].status = 'SCREENED_NET_POSITIVE'
  store.persistProjection({
    snapshot: positive,
    sourceCatalog: sourceCatalog(),
    events: [{ type: 'SCREENED_POSITIVE_ENTERED', at: positive.generatedAt, id: positive.items[0].id }],
  })
  const records = fs
    .readFileSync(path.join(runDir, 'evidence.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  assert.equal(records.filter((record) => record.kind === 'OPPORTUNITY_OBSERVATION').length, 1)
  store.close()
})

test('an evidence id collision fails closed without replacing the original payload', () => {
  const runDir = temporaryRunDir()
  const store = new BoardStore({ runDir })
  const base = {
    evidenceId: 'collision:test',
    kind: 'TEST',
    producer: 'TEST',
    observedAt: '2026-09-07T01:00:00.000Z',
    payload: { value: 1 },
  }
  store.ingest([base])
  assert.throws(() => store.ingest([{ ...base, payload: { value: 2 } }]), /evidence collision/)
  assert.equal(store.health().evidenceRecords, 1)
  store.close()
})

test('legacy snapshot migrates additively and remains available for rollback', () => {
  const runDir = temporaryRunDir()
  const legacySnapshotPath = path.join(runDir, 'snapshot.json')
  const expected = snapshot()
  fs.writeFileSync(legacySnapshotPath, JSON.stringify(expected), { mode: 0o600 })
  const store = new BoardStore({ runDir, legacySnapshotPath })
  assert.equal(stablePayloadHash(store.readCurrentSnapshot()), stablePayloadHash(expected))
  assert.equal(fs.existsSync(legacySnapshotPath), true)
  assert.equal(fs.existsSync(path.join(runDir, 'evidence.jsonl')), true)
  store.close()
})

test('a newer snapshot removes stale rows from the current opportunity projection', () => {
  const runDir = temporaryRunDir()
  const store = new BoardStore({ runDir })
  store.persistProjection({ snapshot: snapshot(), sourceCatalog: sourceCatalog() })
  const next = snapshot('2026-09-07T01:01:00.000Z')
  next.items = []
  store.persistProjection({ snapshot: next, sourceCatalog: sourceCatalog(next.generatedAt) })
  assert.deepEqual(store.listOpportunities(), [])
  assert.deepEqual(store.readCurrentSnapshot().items, [])
  store.close()
})
