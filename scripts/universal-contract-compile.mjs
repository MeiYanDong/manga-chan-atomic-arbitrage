import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import solc from 'solc'
import { keccak256, toHex } from 'viem'

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
          UniversalAtomicExecutor: ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'],
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
    creationBytes: contract.evm.bytecode.object.length / 2,
    runtimeBytes: contract.evm.deployedBytecode.object.length / 2,
    sourceHash: keccak256(toHex(source)),
    creationCodeHash: keccak256(`0x${contract.evm.bytecode.object}`),
    runtimeCodeHash: keccak256(`0x${contract.evm.deployedBytecode.object}`),
    compiler: solc.version(),
  }
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
        runtimeCodeHash: compiled.runtimeCodeHash,
      },
      null,
      2,
    ),
  )
}
