import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import solc from 'solc'
import { getAddress, keccak256, pad, toHex } from 'viem'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const contractPath = path.join(root, 'contracts', 'UniversalAtomicExecutor.sol')

export function compileUniversalContract() {
  const source = fs.readFileSync(contractPath, 'utf8')
  const input = {
    language: 'Solidity',
    sources: { 'UniversalAtomicExecutor.sol': { content: source } },
    settings: {
      evmVersion: 'cancun',
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
      outputSelection: {
        '*': {
          UniversalAtomicExecutor: [
            'abi',
            'evm.bytecode.object',
            'evm.deployedBytecode.object',
            'evm.deployedBytecode.immutableReferences',
          ],
        },
      },
    },
  }
  const output = JSON.parse(solc.compile(JSON.stringify(input)))
  const errors = (output.errors || []).filter((item) => item.severity === 'error')
  if (errors.length > 0) throw new Error(errors.map((item) => item.formattedMessage).join('\n'))
  const contract = output.contracts?.['UniversalAtomicExecutor.sol']?.UniversalAtomicExecutor
  if (!contract) throw new Error('UniversalAtomicExecutor compile output is missing')
  return {
    abi: contract.abi,
    bytecode: `0x${contract.evm.bytecode.object}`,
    deployedBytecode: `0x${contract.evm.deployedBytecode.object}`,
    immutableReferences: contract.evm.deployedBytecode.immutableReferences,
    creationBytes: contract.evm.bytecode.object.length / 2,
    runtimeBytes: contract.evm.deployedBytecode.object.length / 2,
    sourceHash: keccak256(toHex(source)),
    creationCodeHash: keccak256(`0x${contract.evm.bytecode.object}`),
    runtimeTemplateCodeHash: keccak256(`0x${contract.evm.deployedBytecode.object}`),
    compiler: solc.version(),
  }
}

/** @returns {import('viem').Hex} */
export function materializeUniversalRuntime(compiled, operator) {
  const groups = Object.values(compiled.immutableReferences || {})
  if (groups.length !== 1 || groups[0].length === 0) {
    throw new Error('UniversalAtomicExecutor must have exactly one referenced immutable')
  }
  const operatorWord = pad(getAddress(operator), { size: 32 }).slice(2)
  let concrete = compiled.deployedBytecode.slice(2)
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
  return `0x${concrete}`
}

export function verifyUniversalRuntimeEvidence({ compiled, operator, code, plannedRuntimeCodeHash }) {
  if (!/^0x[0-9a-f]+$/i.test(String(code)) || String(code).length % 2 !== 0) {
    throw new Error('deployed universal runtime code is invalid')
  }
  const concreteRuntimeCodeHash = keccak256(materializeUniversalRuntime(compiled, operator))
  const actualRuntimeCodeHash = keccak256(code)
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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const compiled = compileUniversalContract()
  console.log(
    JSON.stringify(
      {
        status: 'UNIVERSAL_CONTRACT_COMPILED',
        compiler: compiled.compiler,
        evmVersion: 'cancun',
        optimizerRuns: 200,
        creationBytes: compiled.creationBytes,
        runtimeBytes: compiled.runtimeBytes,
        sourceHash: compiled.sourceHash,
        creationCodeHash: compiled.creationCodeHash,
        runtimeTemplateCodeHash: compiled.runtimeTemplateCodeHash,
      },
      null,
      2,
    ),
  )
}
