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
