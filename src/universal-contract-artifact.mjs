import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { getAddress, keccak256, pad, toHex } from 'viem'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const defaultArtifactPath = path.join(root, 'artifacts', 'universal-atomic-executor.json')
const defaultSourcePath = path.join(root, 'contracts', 'UniversalAtomicExecutor.sol')

function checkedHex(value, label) {
  if (typeof value !== 'string' || !/^0x(?:[0-9a-f]{2})+$/i.test(value)) {
    throw new Error(`${label} is not nonempty bytecode`)
  }
  return /** @type {import('viem').Hex} */ (value)
}

function assertUniversalArtifact(compiled, source) {
  if (
    compiled?.schemaVersion !== 1 ||
    compiled.contract !== 'UniversalAtomicExecutor' ||
    compiled.evmVersion !== 'cancun' ||
    compiled.optimizerRuns !== 200 ||
    compiled.viaIR !== true ||
    typeof compiled.compiler !== 'string' ||
    !compiled.compiler.startsWith('0.8.26+') ||
    !Array.isArray(compiled.abi)
  ) {
    throw new Error('universal contract artifact identity or compiler policy is invalid')
  }
  const bytecode = checkedHex(compiled.bytecode, 'universal creation bytecode')
  const deployedBytecode = checkedHex(compiled.deployedBytecode, 'universal runtime template')
  if (
    compiled.sourceHash !== keccak256(toHex(source)) ||
    compiled.creationCodeHash !== keccak256(bytecode) ||
    compiled.runtimeTemplateCodeHash !== keccak256(deployedBytecode) ||
    compiled.creationBytes !== (bytecode.length - 2) / 2 ||
    compiled.runtimeBytes !== (deployedBytecode.length - 2) / 2
  ) {
    throw new Error('universal contract artifact content hash or byte length is invalid')
  }
  return { ...compiled, bytecode, deployedBytecode }
}

export function loadUniversalContractArtifact({
  artifactPath = defaultArtifactPath,
  sourcePath = defaultSourcePath,
} = {}) {
  if (!fs.existsSync(artifactPath)) {
    throw new Error('universal contract artifact is missing; run npm run compile for this release')
  }
  const source = fs.readFileSync(sourcePath, 'utf8')
  let artifact
  try {
    artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'))
  } catch {
    throw new Error('universal contract artifact is not valid JSON')
  }
  return assertUniversalArtifact(artifact, source)
}

/** @returns {import('viem').Hex} */
export function materializeUniversalRuntime(compiled, operator) {
  const groups = Object.values(compiled.immutableReferences || {})
  if (groups.length !== 1 || groups[0].length === 0) {
    throw new Error('UniversalAtomicExecutor must have exactly one referenced immutable')
  }
  const operatorWord = pad(getAddress(operator), { size: 32 }).slice(2)
  let concrete = checkedHex(compiled.deployedBytecode, 'universal runtime template').slice(2)
  const references = [...groups[0]].sort((left, right) => left.start - right.start)
  let previousEnd = 0
  for (const reference of references) {
    if (
      !Number.isInteger(reference.start) ||
      reference.start < previousEnd ||
      reference.length !== 32 ||
      (reference.start + reference.length) * 2 > concrete.length
    ) {
      throw new Error('UniversalAtomicExecutor immutable reference layout is invalid')
    }
    const start = reference.start * 2
    const end = (reference.start + reference.length) * 2
    if (concrete.slice(start, end) !== '0'.repeat(reference.length * 2)) {
      throw new Error('UniversalAtomicExecutor runtime template immutable slot is not empty')
    }
    concrete = `${concrete.slice(0, start)}${operatorWord}${concrete.slice(end)}`
    previousEnd = reference.start + reference.length
  }
  return /** @type {import('viem').Hex} */ (`0x${concrete}`)
}

export function verifyUniversalRuntimeEvidence({ compiled, operator, code, plannedRuntimeCodeHash }) {
  const actualCode = checkedHex(code, 'deployed universal runtime code')
  const concreteRuntimeCodeHash = keccak256(materializeUniversalRuntime(compiled, operator))
  const actualRuntimeCodeHash = keccak256(actualCode)
  if (actualRuntimeCodeHash !== concreteRuntimeCodeHash) {
    throw new Error('deployed runtime hash differs from the concrete immutable runtime')
  }
  if (plannedRuntimeCodeHash === concreteRuntimeCodeHash) {
    return {
      mode: 'CONCRETE_RUNTIME_HASH',
      actualRuntimeCodeHash,
      concreteRuntimeCodeHash,
      runtimeTemplateCodeHash: compiled.runtimeTemplateCodeHash,
    }
  }
  if (plannedRuntimeCodeHash === compiled.runtimeTemplateCodeHash) {
    return {
      mode: 'LEGACY_TEMPLATE_HASH_WITH_CONCRETE_IMMUTABLES',
      actualRuntimeCodeHash,
      concreteRuntimeCodeHash,
      runtimeTemplateCodeHash: compiled.runtimeTemplateCodeHash,
    }
  }
  throw new Error('planned runtime hash matches neither the concrete runtime nor its compiler template')
}
