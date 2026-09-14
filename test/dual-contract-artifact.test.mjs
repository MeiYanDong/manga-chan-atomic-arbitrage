import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { compileGenericContract, writeGenericContractArtifact } from '../scripts/generic-contract-compile.mjs'
import { compileWethContract, writeWethContractArtifact } from '../scripts/weth-contract-compile.mjs'
import { loadGenericContractArtifact, loadWethContractArtifact } from '../src/dual-contract-artifacts.mjs'

const generic = compileGenericContract()
const weth = compileWethContract()

test('loads build-time dual artifacts only after recomputing source and bytecode evidence', (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'manga-dual-artifacts-'))
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const genericPath = path.join(directory, 'generic.json')
  const wethPath = path.join(directory, 'weth.json')
  writeGenericContractArtifact(generic, genericPath)
  writeWethContractArtifact(weth, wethPath)

  const loadedGeneric = loadGenericContractArtifact({ artifactPath: genericPath })
  const loadedWeth = loadWethContractArtifact({ artifactPath: wethPath })
  assert.equal(loadedGeneric.creationCodeHash, generic.creationCodeHash)
  assert.equal(loadedGeneric.runtimeTemplateCodeHash, generic.runtimeTemplateCodeHash)
  assert.equal(loadedWeth.creationCodeHash, weth.creationCodeHash)
  assert.equal(loadedWeth.sourceBundleHash, weth.sourceBundleHash)

  fs.writeFileSync(genericPath, JSON.stringify({ ...generic, runtimeTemplateCodeHash: `0x${'11'.repeat(32)}` }), {
    mode: 0o600,
  })
  assert.throws(() => loadGenericContractArtifact({ artifactPath: genericPath }), /bytecode hash or length/)

  fs.writeFileSync(wethPath, JSON.stringify({ ...weth, dependencySourceHash: `0x${'22'.repeat(32)}` }), {
    mode: 0o600,
  })
  assert.throws(() => loadWethContractArtifact({ artifactPath: wethPath }), /source bundle hash/)
})

test('the live dual supervisor has no static Solidity compiler dependency', () => {
  const source = fs.readFileSync(new URL('../scripts/dual-base-arb.mjs', import.meta.url), 'utf8')
  const beforeMain = source.slice(0, source.indexOf('async function main()'))
  assert.doesNotMatch(beforeMain, /contract-compile\.mjs/)
  assert.doesNotMatch(beforeMain, /compile(?:Generic|Weth|Universal)Contract/)
  assert.match(beforeMain, /loadGenericContractArtifact/)
  assert.match(beforeMain, /loadWethContractArtifact/)
  assert.match(beforeMain, /loadUniversalContractArtifact/)
})
