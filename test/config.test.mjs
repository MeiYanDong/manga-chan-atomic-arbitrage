import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { assertLiveTransport, loadRuntimeConfig, readConfigFile } from '../src/config.mjs'

test('strategy config reads only explicit MANGA keys', (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'manga-config-'))
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const file = path.join(directory, 'live.env')
  fs.writeFileSync(
    file,
    [
      'MANGA_RPC_URL=https://primary.invalid',
      'MANGA_WS_URL=wss://primary.invalid',
      'RH_RPC_URL=https://must-not-be-read.invalid',
      'MANGA_MAX_ATTEMPTS=3',
    ].join('\n'),
    { mode: 0o600 },
  )
  const parsed = readConfigFile(file)
  assert.equal(parsed.RH_RPC_URL, undefined)
  const config = loadRuntimeConfig({ MANGA_CONFIG_FILE: file })
  assert.equal(config.rpcUrl, 'https://primary.invalid')
  assert.equal(config.wsUrl, 'wss://primary.invalid')
  assert.equal(config.maxAttempts, 3)
  assert.doesNotThrow(() => assertLiveTransport(config, { requireWss: true }))
})

test('live watch refuses public fallback and silent polling-only mode', () => {
  const missing = loadRuntimeConfig({ MANGA_CONFIG_FILE: '/definitely/missing' })
  assert.throws(() => assertLiveTransport(missing), /MANGA_RPC_URL/)
  assert.throws(
    () => assertLiveTransport({ ...missing, rpcUrl: 'https://primary.invalid' }, { requireWss: true }),
    /MANGA_WS_URL/,
  )
})
