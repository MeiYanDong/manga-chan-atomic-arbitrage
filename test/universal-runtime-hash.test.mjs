import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { keccak256 } from 'viem'

import { compileUniversalContract, writeUniversalContractArtifact } from '../scripts/universal-contract-compile.mjs'
import {
  loadUniversalContractArtifact,
  materializeUniversalRuntime,
  verifyUniversalRuntimeEvidence,
} from '../src/universal-contract-artifact.mjs'

const OPERATOR = '0x77f771E83f118C32547A1291dda438a757B4b91B'
const TEMPLATE_HASH = '0x0fda9e64a37fdddea86e1eb3a2fed7f3c70dde0f624e3cef4a3e268229450790'
const CONCRETE_HASH = '0x189525d9135bb70015874c4afd4d054c06dcf0d20cc7882357431e900a90e0fd'
const compiled = compileUniversalContract()
const concreteRuntime = materializeUniversalRuntime(compiled, OPERATOR)

test('materializes every operator immutable before committing the runtime hash', () => {
  assert.equal(compiled.runtimeTemplateCodeHash, TEMPLATE_HASH)
  assert.equal(keccak256(concreteRuntime), CONCRETE_HASH)
  assert.notEqual(CONCRETE_HASH, TEMPLATE_HASH)
  assert.equal(Object.values(compiled.immutableReferences).flat().length, 4)
})

test('loads a build-time artifact only after recomputing its release hashes', (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'manga-universal-artifact-'))
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const artifactPath = path.join(directory, 'universal.json')
  writeUniversalContractArtifact(compiled, artifactPath)
  const loaded = loadUniversalContractArtifact({ artifactPath })
  assert.equal(loaded.sourceHash, compiled.sourceHash)
  assert.equal(loaded.creationCodeHash, compiled.creationCodeHash)
  assert.equal(loaded.runtimeTemplateCodeHash, compiled.runtimeTemplateCodeHash)

  fs.writeFileSync(artifactPath, JSON.stringify({ ...compiled, creationCodeHash: `0x${'11'.repeat(32)}` }), {
    mode: 0o600,
  })
  assert.throws(() => loadUniversalContractArtifact({ artifactPath }), /content hash or byte length/)
})

test('accepts a new concrete runtime commitment', () => {
  assert.deepEqual(
    verifyUniversalRuntimeEvidence({
      compiled,
      operator: OPERATOR,
      code: concreteRuntime,
      plannedRuntimeCodeHash: CONCRETE_HASH,
    }),
    {
      mode: 'CONCRETE_RUNTIME_HASH',
      actualRuntimeCodeHash: CONCRETE_HASH,
      concreteRuntimeCodeHash: CONCRETE_HASH,
      runtimeTemplateCodeHash: TEMPLATE_HASH,
    },
  )
})

test('recovers the one legacy template commitment only after concrete runtime verification', () => {
  const evidence = verifyUniversalRuntimeEvidence({
    compiled,
    operator: OPERATOR,
    code: concreteRuntime,
    plannedRuntimeCodeHash: TEMPLATE_HASH,
  })
  assert.equal(evidence.mode, 'LEGACY_TEMPLATE_HASH_WITH_CONCRETE_IMMUTABLES')
  assert.equal(evidence.actualRuntimeCodeHash, CONCRETE_HASH)
})

test('rejects either foreign runtime code or an unrelated planned hash', () => {
  assert.throws(
    () =>
      verifyUniversalRuntimeEvidence({
        compiled,
        operator: OPERATOR,
        code: `${concreteRuntime.slice(0, -2)}00`,
        plannedRuntimeCodeHash: CONCRETE_HASH,
      }),
    /concrete immutable runtime/,
  )
  assert.throws(
    () =>
      verifyUniversalRuntimeEvidence({
        compiled,
        operator: OPERATOR,
        code: concreteRuntime,
        plannedRuntimeCodeHash: `0x${'11'.repeat(32)}`,
      }),
    /neither the concrete runtime nor its compiler template/,
  )
})
