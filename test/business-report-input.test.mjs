import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { readBusinessReportInputs } from '../src/business-report-input.mjs'

function fixture(context) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'manga-business-input-'))
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  return directory
}

function writeJsonLines(file, records) {
  fs.writeFileSync(file, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`)
}

test('streams business evidence into a compact current-authorization projection', (context) => {
  const directory = fixture(context)
  const activeAuthorization = 'active-authorization'
  writeJsonLines(path.join(directory, 'audit.jsonl'), [
    { event: 'diagnostic', body: 'x'.repeat(512 * 1024) },
    { event: 'dual_runtime_verified', walletEth: '0.1', at: '2026-09-15T00:00:00.000Z', private: 'drop' },
    {
      event: 'global_preflight',
      authorizationId: 'old-authorization',
      grossPositive: 99,
      workset: { totalRoutes: 999 },
    },
    {
      event: 'global_preflight',
      authorizationId: activeAuthorization,
      grossPositive: 1,
      exactNetPositive: 0,
      workset: { totalRoutes: 128, selectedRoutes: 8 },
      timing: { sourceToDecisionMs: 42 },
      graph: { heavy: 'y'.repeat(512 * 1024) },
    },
    { event: 'global_watch_exact_preflight_started', authorizationId: activeAuthorization, internal: 'drop' },
    {
      event: 'mutation_reverted',
      authorizationId: activeAuthorization,
      gasSpentWei: '12',
      at: '2026-09-15T00:01:00.000Z',
      hash: `0x${'1'.repeat(64)}`,
      reason: 'drop',
    },
    { event: 'dual_runtime_verified', walletEth: '0.2', at: '2026-09-15T00:02:00.000Z', private: 'drop' },
  ])
  writeJsonLines(path.join(directory, 'earnonhood-audit.jsonl'), [
    { event: 'mutation_effect', status: 'REVERTED', transaction: `0x${'2'.repeat(64)}` },
    {
      event: 'mutation_effect',
      status: 'CONFIRMED_NET_PROFIT',
      transaction: `0x${'3'.repeat(64)}`,
      at: '2026-09-15T00:03:00.000Z',
      realizedNetProfitEth: '0.00002',
      route: 'WETH → A → WETH',
      secretDiagnostic: 'drop',
    },
  ])
  writeJsonLines(path.join(directory, 'legacy-collection-audit.jsonl'), [
    { event: 'collection_started', amountUsdg: '999' },
    {
      event: 'withdrawal_complete',
      hash: `0x${'4'.repeat(64)}`,
      confirmedAt: '2026-09-15T00:04:00.000Z',
      amountUsdg: '2',
      targetId: 'MANGA',
      internal: 'drop',
    },
  ])

  const result = readBusinessReportInputs({ runDirectory: directory, authorizationId: activeAuthorization })

  assert.equal(result.auditRecords.filter((record) => record.event === 'dual_runtime_verified').length, 1)
  assert.equal(result.auditRecords.find((record) => record.event === 'dual_runtime_verified').walletEth, '0.2')
  assert.equal(result.auditRecords.filter((record) => record.event === 'global_preflight').length, 1)
  assert.equal(
    result.auditRecords.filter((record) => record.event === 'global_watch_exact_preflight_started').length,
    1,
  )
  assert.equal(result.auditRecords.filter((record) => record.event === 'mutation_reverted').length, 1)
  assert.equal(result.earnOnHoodRecords.length, 1)
  assert.equal(result.collectionRecords.length, 1)
  const serialized = JSON.stringify(result)
  assert.doesNotMatch(serialized, /old-authorization|secretDiagnostic|internal|private|heavy|diagnostic/)
  assert.ok(Buffer.byteLength(serialized) < 4_096)
})

test('returns empty projections when optional ledgers do not exist', (context) => {
  const directory = fixture(context)
  assert.deepEqual(readBusinessReportInputs({ runDirectory: directory }), {
    auditRecords: [],
    collectionRecords: [],
    earnOnHoodRecords: [],
  })
})

test('streams past the production-sized legacy wake without retaining its payload', (context) => {
  const directory = fixture(context)
  const oversizedWake = {
    at: '2026-09-15T00:00:00.000Z',
    lane: 'dual-v3',
    event: 'global_watch_wake',
    classificationReason: 'NON_HUB_ASSET_PATH_MATCH+'.repeat(275_000),
  }
  writeJsonLines(path.join(directory, 'audit.jsonl'), [
    oversizedWake,
    {
      event: 'mutation_reverted',
      gasSpentWei: '7',
      at: '2026-09-15T00:01:00.000Z',
    },
  ])

  const result = readBusinessReportInputs({ runDirectory: directory })

  assert.deepEqual(result.auditRecords, [
    {
      event: 'mutation_reverted',
      authorizationId: null,
      gasSpentWei: '7',
      at: '2026-09-15T00:01:00.000Z',
      transactionHash: null,
      hash: null,
      blockNumber: null,
    },
  ])
})

test('fails closed when a selected business record is malformed', (context) => {
  const directory = fixture(context)
  fs.writeFileSync(path.join(directory, 'audit.jsonl'), '{"event":"mutation_reverted",oops}\n')
  assert.throws(() => readBusinessReportInputs({ runDirectory: directory }), /safety JSONL record is malformed/)
})
