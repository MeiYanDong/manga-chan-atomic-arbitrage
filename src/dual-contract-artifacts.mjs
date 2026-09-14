import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { keccak256, toHex } from 'viem'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const genericArtifactPath = path.join(root, 'artifacts', 'generic-atomic-arb.json')
const wethArtifactPath = path.join(root, 'artifacts', 'weth-atomic-arb.json')
const genericSourcePath = path.join(root, 'contracts', 'GenericAtomicArb.sol')
const wethSourcePath = path.join(root, 'contracts', 'WethAtomicArb.sol')

function checkedHex(value, label) {
  if (typeof value !== 'string' || !/^0x(?:[0-9a-f]{2})+$/i.test(value)) {
    throw new Error(`${label} is not nonempty bytecode`)
  }
  return /** @type {import('viem').Hex} */ (value)
}

function readArtifact(artifactPath, label) {
  if (!fs.existsSync(artifactPath)) {
    throw new Error(`${label} artifact is missing; run npm run compile for this release`)
  }
  try {
    return JSON.parse(fs.readFileSync(artifactPath, 'utf8'))
  } catch {
    throw new Error(`${label} artifact is not valid JSON`)
  }
}

function assertIdentity(compiled, contract, label) {
  if (
    compiled?.schemaVersion !== 1 ||
    compiled.contract !== contract ||
    compiled.evmVersion !== 'cancun' ||
    compiled.optimizerRuns !== 200 ||
    compiled.viaIR !== true ||
    typeof compiled.compiler !== 'string' ||
    !compiled.compiler.startsWith('0.8.26+') ||
    !Array.isArray(compiled.abi)
  ) {
    throw new Error(`${label} artifact identity or compiler policy is invalid`)
  }
}

function assertBytecode(compiled, label) {
  const bytecode = checkedHex(compiled.bytecode, `${label} creation bytecode`)
  const deployedBytecode = checkedHex(compiled.deployedBytecode, `${label} runtime template`)
  if (
    compiled.creationCodeHash !== keccak256(bytecode) ||
    compiled.runtimeTemplateCodeHash !== keccak256(deployedBytecode) ||
    compiled.creationBytes !== (bytecode.length - 2) / 2 ||
    compiled.runtimeBytes !== (deployedBytecode.length - 2) / 2
  ) {
    throw new Error(`${label} artifact bytecode hash or length is invalid`)
  }
  return { ...compiled, bytecode, deployedBytecode }
}

export function loadGenericContractArtifact({
  artifactPath = genericArtifactPath,
  sourcePath = genericSourcePath,
} = {}) {
  const compiled = readArtifact(artifactPath, 'generic contract')
  assertIdentity(compiled, 'GenericAtomicArb', 'generic contract')
  const source = fs.readFileSync(sourcePath, 'utf8')
  if (compiled.sourceHash !== keccak256(toHex(source))) {
    throw new Error('generic contract artifact source hash is invalid')
  }
  return assertBytecode(compiled, 'generic contract')
}

export function loadWethContractArtifact({
  artifactPath = wethArtifactPath,
  sourcePath = wethSourcePath,
  dependencyPath = genericSourcePath,
} = {}) {
  const compiled = readArtifact(artifactPath, 'WETH contract')
  assertIdentity(compiled, 'WethAtomicArb', 'WETH contract')
  const source = fs.readFileSync(sourcePath, 'utf8')
  const dependencySource = fs.readFileSync(dependencyPath, 'utf8')
  const sourceBundle = `${dependencySource}\n---WethAtomicArb.sol---\n${source}`
  if (
    compiled.sourceHash !== keccak256(toHex(source)) ||
    compiled.dependencySourceHash !== keccak256(toHex(dependencySource)) ||
    compiled.sourceBundleHash !== keccak256(toHex(sourceBundle))
  ) {
    throw new Error('WETH contract artifact source bundle hash is invalid')
  }
  return assertBytecode(compiled, 'WETH contract')
}
