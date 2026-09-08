import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { stablePayloadHash } from '../src/source-provenance.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPT = path.join(ROOT, 'scripts', 'compact-source-catalog.mjs')
const TX = `0x${'ab'.repeat(32)}`
const BLOCK = `0x${'cd'.repeat(32)}`
const TOKEN = '0x1111111111111111111111111111111111111111'
const QUOTE = '0x2222222222222222222222222222222222222222'
const HOOK = '0x3333333333333333333333333333333333333333'

function legacyCatalog() {
  return {
    schemaVersion: 4,
    summary: {},
    pairListings: [],
    longLaunches: [
      {
        adapterId: 'long.launcher.v1',
        platformId: 'LONG_ROUTE',
        entryContract: '0x22e99278308B393ea1260859B181AD7E78f5eeED',
        asset: TOKEN,
        numeraire: QUOTE,
        normalizedTicker: 'TEST',
        blockNumber: '1',
        blockHash: BLOCK,
        transactionHash: TX,
        logIndex: 1,
        evidenceId: `rh:4663:log:${TX}:1`,
      },
    ],
    dopplerLaunches: [
      {
        adapterId: 'doppler.registry.v1',
        asset: TOKEN,
        numeraire: QUOTE,
        blockNumber: '1',
        transactionHash: TX,
        logIndex: 2,
        evidenceId: `rh:4663:log:${TX}:2`,
      },
    ],
    dopplerTargetIndex: [],
    pools: [
      {
        adapterId: 'uniswap-v4.pool-manager.v1',
        poolManager: '0x8366a39cc670B4001a1121b8f6a443a643e40951',
        poolId: `0x${'ef'.repeat(32)}`,
        currency0: TOKEN,
        currency1: QUOTE,
        fee: 3_000,
        tickSpacing: 60,
        hooks: HOOK,
        blockNumber: '2',
        blockHash: BLOCK,
        transactionHash: TX,
        logIndex: 3,
        evidenceId: `rh:4663:log:${TX}:3`,
      },
    ],
  }
}

function run(...args) {
  return spawnSync(process.execPath, ['--expose-gc', SCRIPT, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=128' },
  })
}

function writeEvidenceDatabase(file, catalog) {
  const database = new DatabaseSync(file)
  database.exec(`
    CREATE TABLE evidence (
      evidence_id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      payload_json TEXT NOT NULL
    )
  `)
  const insert = database.prepare(
    'INSERT INTO evidence(evidence_id, kind, status, payload_hash, payload_json) VALUES (?, ?, ?, ?, ?)',
  )
  for (const collection of ['longLaunches', 'dopplerLaunches', 'pools']) {
    for (const fact of catalog[collection]) {
      const payload = { ...fact }
      delete payload.evidenceId
      insert.run(fact.evidenceId, 'RECEIPT_LOG', 'OBSERVED', stablePayloadHash(payload), JSON.stringify(payload))
    }
  }
  database.close()
}

test('catalog compactor requires a recoverable backup and verifies the exact compact file', (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'manga-source-compactor-'))
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const file = path.join(directory, 'source-catalog.json')
  const backup = path.join(directory, 'source-catalog.pre-v5.json')
  const sqlite = path.join(directory, 'board.sqlite')
  const catalog = legacyCatalog()
  const original = JSON.stringify(catalog)
  fs.writeFileSync(file, original, { mode: 0o640 })
  writeEvidenceDatabase(sqlite, catalog)

  const compacted = run('compact', '--file', file, '--backup', backup, '--sqlite', sqlite)
  assert.equal(compacted.status, 0, compacted.stderr)
  const result = JSON.parse(compacted.stdout)
  assert.equal(result.status, 'SOURCE_CATALOG_COMPACTED')
  assert.equal(result.longLaunches, 1)
  assert.equal(result.dopplerTargets, 1)
  assert.equal(result.pools, 1)
  assert.equal(result.evidence.referencedFacts, 3)
  assert.equal(result.evidence.uniqueEvidenceVerified, 3)
  assert.equal(fs.readFileSync(backup, 'utf8'), original)
  assert.ok(fs.statSync(file).size < Buffer.byteLength(original))

  const verified = run('verify', '--file', file, '--sqlite', sqlite)
  assert.equal(verified.status, 0, verified.stderr)
  assert.equal(JSON.parse(verified.stdout).status, 'SOURCE_CATALOG_VERIFIED')

  const repeated = run('compact', '--file', file, '--backup', path.join(directory, 'unused.json'), '--sqlite', sqlite)
  assert.equal(repeated.status, 0, repeated.stderr)
  assert.equal(JSON.parse(repeated.stdout).status, 'SOURCE_CATALOG_ALREADY_CURRENT')
  assert.equal(fs.existsSync(path.join(directory, 'unused.json')), false)
})

test('catalog compactor fails before backup or replacement when immutable evidence is missing', (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'manga-source-compactor-missing-'))
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const file = path.join(directory, 'source-catalog.json')
  const backup = path.join(directory, 'source-catalog.pre-v5.json')
  const sqlite = path.join(directory, 'board.sqlite')
  const catalog = legacyCatalog()
  const original = JSON.stringify(catalog)
  fs.writeFileSync(file, original, { mode: 0o640 })
  writeEvidenceDatabase(sqlite, { ...catalog, pools: [] })

  const result = run('compact', '--file', file, '--backup', backup, '--sqlite', sqlite)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /immutable receipt evidence is unavailable/)
  assert.equal(fs.readFileSync(file, 'utf8'), original)
  assert.equal(fs.existsSync(backup), false)
})
