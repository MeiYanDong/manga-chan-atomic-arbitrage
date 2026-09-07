import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
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

test('restart rebuilds the same SQLite projection from JSONL evidence', () => {
  const runDir = temporaryRunDir()
  const store = new BoardStore({ runDir })
  const expected = snapshot()
  store.persistProjection({ snapshot: expected, sourceCatalog: sourceCatalog() })
  store.close()
  fs.rmSync(path.join(runDir, 'board.sqlite'))

  const replayed = new BoardStore({ runDir })
  assert.equal(stablePayloadHash(replayed.readCurrentSnapshot()), stablePayloadHash(expected))
  assert.equal(replayed.listOpportunities()[0].symbol, 'TEST')
  replayed.close()
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
