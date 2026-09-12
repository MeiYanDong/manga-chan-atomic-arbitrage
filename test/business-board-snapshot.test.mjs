import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  BUSINESS_BOARD_SNAPSHOT_MODE,
  assertBusinessBoardSnapshot,
  buildBusinessBoardSnapshot,
  readBusinessBoardSnapshot,
  resolveBusinessBoardProjection,
} from '../src/business-board-snapshot.mjs'

const generatedAt = '2026-09-12T20:45:00.000Z'

function fixture() {
  return buildBusinessBoardSnapshot({
    generatedAt,
    healthStatus: 'HEALTHY',
    overview: {
      serviceStatus: 'RUNNING',
      coverage: { candidateTokens: 4_104, rawRpcUrl: 'forbidden' },
      freshCandidates: 9,
      screenedPositive: 0,
      exactReady: 0,
      provider: 'forbidden',
    },
    sources: {
      pairListings: 2_630,
      longLaunches: 24_671,
      dopplerTargetsDiscovered: 55_105,
      genericPools: 80_097,
      rawCatalog: 'forbidden',
    },
  })
}

test('builds an allowlisted board handoff without raw provider or catalog fields', () => {
  const snapshot = fixture()

  assert.equal(snapshot.mode, BUSINESS_BOARD_SNAPSHOT_MODE)
  assert.deepEqual(snapshot.overview, {
    serviceStatus: 'RUNNING',
    coverage: { candidateTokens: 4_104 },
    freshCandidates: 9,
    screenedPositive: 0,
    exactReady: 0,
  })
  assert.deepEqual(snapshot.sources, {
    pairListings: 2_630,
    longLaunches: 24_671,
    dopplerTargetsDiscovered: 55_105,
    genericPools: 80_097,
  })
  assert.doesNotMatch(JSON.stringify(snapshot), /forbidden|rpcUrl|rawCatalog/i)
})

test('reads only a fresh regular snapshot with protected permissions', (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'manga-business-board-'))
  context.after(() => fs.rmSync(directory, { force: true, recursive: true }))
  const file = path.join(directory, 'operations-snapshot.json')
  fs.writeFileSync(file, `${JSON.stringify(fixture())}\n`, { mode: 0o640 })
  fs.chmodSync(file, 0o640)

  assert.deepEqual(
    readBusinessBoardSnapshot(file, { now: Date.parse(generatedAt) + 60_000, maxAgeMs: 180_000 }),
    fixture(),
  )
  assert.throws(
    () => readBusinessBoardSnapshot(file, { now: Date.parse(generatedAt) + 180_001, maxAgeMs: 180_000 }),
    /stale/,
  )

  fs.chmodSync(file, 0o660)
  assert.throws(() => readBusinessBoardSnapshot(file), /must not be group- or world-writable/)
})

test('rejects fields outside the versioned handoff schema', () => {
  const snapshot = { ...fixture(), rpcUrl: 'forbidden' }
  assert.throws(() => assertBusinessBoardSnapshot(snapshot), /invalid snapshot fields/)
  assert.throws(
    () => buildBusinessBoardSnapshot({ generatedAt, healthStatus: /** @type {any} */ ('UNKNOWN') }),
    /invalid business board health/,
  )
})

test('uses the persisted projection without touching the busy loopback server', async () => {
  let requests = 0
  const resolved = await resolveBusinessBoardProjection({
    readPersisted: fixture,
    boardServiceStatus: () => 'RUNNING',
    requestBoard: async () => {
      requests += 1
      throw new Error('loopback must not be touched')
    },
  })

  assert.equal(requests, 0)
  assert.equal(resolved.generatedAt, generatedAt)
  assert.equal(resolved.health.status, 'HEALTHY')
  assert.equal(resolved.overview.coverage.candidateTokens, 4_104)
})

test('marks a persisted projection not ready when the board process is stopped', async () => {
  const resolved = await resolveBusinessBoardProjection({
    readPersisted: fixture,
    boardServiceStatus: () => 'STOPPED',
    requestBoard: async () => assert.fail('a structurally valid projection must not need HTTP'),
  })

  assert.equal(resolved.health.status, 'NOT_READY')
  assert.equal(resolved.overview.freshCandidates, 9)
})

test('falls back to the three bounded board endpoints when the handoff is unavailable', async () => {
  const paths = []
  const responses = {
    '/healthz': { status: 'HEALTHY' },
    '/api/v1/overview': { generatedAt, coverage: { candidateTokens: 3 }, freshCandidates: 2 },
    '/api/v1/sources': { summary: { pairListings: 1 } },
  }
  const resolved = await resolveBusinessBoardProjection({
    readPersisted: () => {
      throw new Error('missing')
    },
    boardServiceStatus: () => 'RUNNING',
    requestBoard: async (pathname) => {
      paths.push(pathname)
      return responses[pathname]
    },
  })

  assert.deepEqual(paths.sort(), ['/api/v1/overview', '/api/v1/sources', '/healthz'])
  assert.equal(resolved.generatedAt, generatedAt)
  assert.deepEqual(resolved.sources, { pairListings: 1 })
})
