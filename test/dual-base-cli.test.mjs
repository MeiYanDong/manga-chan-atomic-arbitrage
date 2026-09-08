import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const script = path.join(root, 'scripts', 'dual-base-arb.mjs')
const fixture = path.join(root, 'test', 'fixtures', 'generic-sigma-54406832.json')

function run(command, runDir, overrides = {}) {
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
      ...overrides,
    },
  })
}

test('dual watcher exits without an explicit arm and performs no startup RPC', (context) => {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manga-dual-watch-'))
  context.after(() => fs.rmSync(runDir, { recursive: true, force: true }))
  const result = run('watch', runDir)
  assert.equal(result.status, 0, result.stderr)
  const state = JSON.parse(fs.readFileSync(path.join(runDir, 'dual-watch-state.json'), 'utf8'))
  assert.equal(state.status, 'STOPPED_POLICY')
  assert.match(state.reason, /not armed/)
})

test('dual status remains a local readback when the strategy RPC is unreachable', (context) => {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manga-dual-status-'))
  context.after(() => fs.rmSync(runDir, { recursive: true, force: true }))
  const result = run('watch-status', runDir)
  assert.equal(result.status, 0, result.stderr)
  const output = JSON.parse(result.stdout)
  assert.equal(output.status, 'NOT_CONFIGURED')
  assert.equal(output.evidence, 'LOCAL_RUNTIME_AUTHORIZATION_AND_SIGNER_FREE_BOARD_READBACK_NO_CHAIN_QUERY')
  assert.equal(output.board.status, 'NO_FRESH_ELIGIBLE_DUAL_SCREEN')
})

test('dual snapshot reader rejects a group-writable execution feed', (context) => {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manga-dual-feed-'))
  context.after(() => fs.rmSync(runDir, { recursive: true, force: true }))
  const unsafeFeed = path.join(runDir, 'execution-snapshot.json')
  fs.copyFileSync(fixture, unsafeFeed)
  fs.chmodSync(unsafeFeed, 0o660)
  const result = run('watch-status', runDir, { MANGA_GENERIC_BOARD_SNAPSHOT: unsafeFeed })
  assert.equal(result.status, 0, result.stderr)
  const output = JSON.parse(result.stdout)
  assert.match(output.board.error, /must not be group- or world-writable/)
})

test('dual CLI redacts credentialized RPC URLs from diagnostics', (context) => {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manga-dual-redaction-'))
  context.after(() => fs.rmSync(runDir, { recursive: true, force: true }))
  const result = run('runtime-verify', runDir, {
    MANGA_RPC_URL: 'http://127.0.0.1:1/private-token?key=secret',
  })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /<RPC_URL_REDACTED>/)
  assert.doesNotMatch(result.stderr, /private-token|key=secret/)
})

test('WETH deployment preflight rejects a zero seed before making an RPC request', (context) => {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manga-dual-zero-seed-'))
  context.after(() => fs.rmSync(runDir, { recursive: true, force: true }))
  const result = run('weth-deploy-preflight', runDir, { MANGA_WETH_SEED_ETH: '0' })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /reviewed constructor limits/)
  assert.doesNotMatch(result.stderr, /ENOTFOUND|fetch failed/)
})
