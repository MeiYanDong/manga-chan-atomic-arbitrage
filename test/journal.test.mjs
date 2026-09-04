import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { assertPrivateFile, buildMutationPlan, persistSignedRaw, stableStringify } from '../src/journal.mjs'

test('mutation plan hash is stable across object key ordering and bigint values', () => {
  assert.equal(stableStringify({ b: 2n, a: 1 }), stableStringify({ a: 1, b: 2n }))
  const first = buildMutationPlan('execute', { nonce: 1, amount: 5n }, '2026-09-04T00:00:00.000Z')
  const second = buildMutationPlan('execute', { amount: 5n, nonce: 1 }, '2026-09-04T00:00:00.000Z')
  assert.equal(first.planHash, second.planHash)
  assert.equal(first.intentId, second.intentId)
})

test('signed raw persistence is idempotent, private and rejects hash-content collisions', (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'manga-journal-'))
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const file = persistSignedRaw(directory, '0xabc', '0x1234')
  assert.equal(fs.readFileSync(file, 'utf8').trim(), '0x1234')
  assert.equal(fs.statSync(file).mode & 0o077, 0)
  assert.doesNotThrow(() => assertPrivateFile(file))
  assert.equal(persistSignedRaw(directory, '0xabc', '0x1234'), file)
  assert.throws(() => persistSignedRaw(directory, '0xabc', '0x5678'), /raw 不一致/)
})

test('credential files with group or world access are rejected', (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'manga-credential-'))
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const file = path.join(directory, 'key')
  fs.writeFileSync(file, 'redacted', { mode: 0o644 })
  assert.throws(() => assertPrivateFile(file), /0600/)
})
