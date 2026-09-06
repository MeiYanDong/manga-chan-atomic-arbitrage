import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const script = path.join(root, 'scripts', 'generic-arb.mjs')
const fixture = path.join(root, 'test', 'fixtures', 'generic-sigma-54406832.json')

function run(command, runDir) {
  return spawnSync(process.execPath, [script, command], {
    cwd: root,
    encoding: 'utf8',
    timeout: 5_000,
    env: {
      ...process.env,
      MANGA_CONFIG_FILE: path.join(runDir, 'missing.env'),
      MANGA_RPC_URL: 'https://strategy-rpc.invalid',
      MANGA_RUN_DIR: runDir,
      MANGA_GENERIC_BOARD_SNAPSHOT: fixture,
    },
  })
}

test('generic watcher exits cleanly without an explicit arm and makes no startup RPC request', (context) => {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manga-generic-watch-'))
  context.after(() => fs.rmSync(runDir, { recursive: true, force: true }))
  const result = run('watch', runDir)
  assert.equal(result.status, 0, result.stderr)
  const state = JSON.parse(fs.readFileSync(path.join(runDir, 'generic-watch-state.json'), 'utf8'))
  assert.equal(state.status, 'STOPPED_POLICY')
  assert.match(state.reason, /not armed/)
})

test('generic watch status is a local readback even when the configured strategy RPC is unreachable', (context) => {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manga-generic-status-'))
  context.after(() => fs.rmSync(runDir, { recursive: true, force: true }))
  const result = run('watch-status', runDir)
  assert.equal(result.status, 0, result.stderr)
  const output = JSON.parse(result.stdout)
  assert.equal(output.status, 'NOT_CONFIGURED')
  assert.equal(output.evidence, 'LOCAL_RUNTIME_AND_AUTHORIZATION_READBACK_NO_CHAIN_QUERY')
  assert.equal(output.board.status, 'NO_FRESH_ELIGIBLE_BOARD_SCREEN')
})

test('generic watch status projects canonical ledger usage over a stale runtime snapshot', (context) => {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manga-generic-usage-'))
  context.after(() => fs.rmSync(runDir, { recursive: true, force: true }))
  const authorizationId = 'test-authorization'
  fs.writeFileSync(
    path.join(runDir, 'generic-watch-arm.json'),
    JSON.stringify({
      authorizationId,
      status: 'ARMED',
      issuedAt: '2030-01-01T00:00:00.000Z',
      expiresAt: '2030-01-02T00:00:00.000Z',
      baselineExecutionCount: 0,
      maxPrincipalUsdgWei: '22040906',
      minimumNetProfitUsdgWei: '100000',
      minimumScreenedNetProfitUsdgWei: '100000',
      maxConfirmedExecutions: 5,
      maxAttempts: 5,
      maxExactPreflights: 24,
      maxFailedGasWei: '1000000000000000',
    }),
    { mode: 0o600 },
  )
  fs.writeFileSync(
    path.join(runDir, 'generic-state.json'),
    JSON.stringify({ status: 'live_gross_validated', executor: '0xexecutor', executions: [{}, {}, {}, {}] }),
    { mode: 0o600 },
  )
  fs.writeFileSync(
    path.join(runDir, 'generic-watch-state.json'),
    JSON.stringify({
      status: 'STOPPED_POLICY',
      completedExecutionsThisArm: 4,
      exactPreflightsThisArm: 10,
      signedAttemptsThisArm: 4,
    }),
    { mode: 0o600 },
  )
  const audit = [
    ...Array.from({ length: 5 }, () => ({ authorizationId, event: 'mutation_signed', kind: 'generic-execute' })),
    ...Array.from({ length: 10 }, () => ({ authorizationId, event: 'generic_watch_exact_preflight_started' })),
  ]
  fs.writeFileSync(path.join(runDir, 'audit.jsonl'), `${audit.map((record) => JSON.stringify(record)).join('\n')}\n`, {
    mode: 0o600,
  })

  const result = run('watch-status', runDir)
  assert.equal(result.status, 0, result.stderr)
  const output = JSON.parse(result.stdout)
  assert.deepEqual(output.usage, {
    confirmedExecutions: 4,
    signedAttempts: 5,
    exactPreflights: 10,
    failedGasWei: '0',
  })
  assert.equal(output.runtime.completedExecutionsThisArm, 4)
  assert.equal(output.runtime.exactPreflightsThisArm, 10)
  assert.equal(output.runtime.signedAttemptsThisArm, 5)
})

test('generic watch status reports a corrupt authorization without crashing', (context) => {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manga-generic-corrupt-arm-'))
  context.after(() => fs.rmSync(runDir, { recursive: true, force: true }))
  fs.writeFileSync(
    path.join(runDir, 'generic-watch-arm.json'),
    JSON.stringify({ authorizationId: 'invalid-arm', status: 'ARMED', maxPrincipalUsdgWei: 'not-a-number' }),
    { mode: 0o600 },
  )
  const result = run('watch-status', runDir)
  assert.equal(result.status, 0, result.stderr)
  const output = JSON.parse(result.stdout)
  assert.equal(output.authorization.id, 'invalid-arm')
  assert.match(output.authorization.error, /INVALID_AUTHORIZATION_READBACK/)
})

test('generic CLI redacts credentialized RPC URLs from stderr diagnostics', (context) => {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manga-generic-stderr-'))
  context.after(() => fs.rmSync(runDir, { recursive: true, force: true }))
  const result = spawnSync(process.execPath, [script, 'runtime-verify'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 5_000,
    env: {
      ...process.env,
      MANGA_CONFIG_FILE: path.join(runDir, 'missing.env'),
      MANGA_RPC_URL: 'http://127.0.0.1:1/private-token?key=secret',
      MANGA_RUN_DIR: runDir,
    },
  })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /<RPC_URL_REDACTED>/)
  assert.doesNotMatch(result.stderr, /private-token|key=secret/)
})
