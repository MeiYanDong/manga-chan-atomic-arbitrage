import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import solc from 'solc'
import { keccak256, toHex } from 'viem'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dependencyPath = path.join(root, 'contracts', 'GenericAtomicArb.sol')
const contractPath = path.join(root, 'contracts', 'WethAtomicArb.sol')

export function compileWethContract() {
  const dependencySource = fs.readFileSync(dependencyPath, 'utf8')
  const source = fs.readFileSync(contractPath, 'utf8')
  const input = {
    language: 'Solidity',
    sources: {
      'GenericAtomicArb.sol': { content: dependencySource },
      'WethAtomicArb.sol': { content: source },
    },
    settings: {
      evmVersion: 'cancun',
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
      outputSelection: {
        '*': {
          WethAtomicArb: ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'],
        },
      },
    },
  }
  const output = JSON.parse(solc.compile(JSON.stringify(input)))
  const errors = (output.errors || []).filter((item) => item.severity === 'error')
  if (errors.length > 0) throw new Error(errors.map((item) => item.formattedMessage).join('\n'))
  const contract = output.contracts?.['WethAtomicArb.sol']?.WethAtomicArb
  if (!contract) throw new Error('WethAtomicArb compile output is missing')
  const sourceBundle = `${dependencySource}\n---WethAtomicArb.sol---\n${source}`
  return {
    abi: contract.abi,
    bytecode: `0x${contract.evm.bytecode.object}`,
    deployedBytecode: `0x${contract.evm.deployedBytecode.object}`,
    creationBytes: contract.evm.bytecode.object.length / 2,
    runtimeBytes: contract.evm.deployedBytecode.object.length / 2,
    sourceHash: keccak256(toHex(source)),
    dependencySourceHash: keccak256(toHex(dependencySource)),
    sourceBundleHash: keccak256(toHex(sourceBundle)),
    creationCodeHash: keccak256(`0x${contract.evm.bytecode.object}`),
    compiler: solc.version(),
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const compiled = compileWethContract()
  console.log(
    JSON.stringify(
      {
        status: 'WETH_CONTRACT_COMPILED',
        compiler: compiled.compiler,
        evmVersion: 'cancun',
        optimizerRuns: 200,
        creationBytes: compiled.creationBytes,
        runtimeBytes: compiled.runtimeBytes,
        sourceHash: compiled.sourceHash,
        dependencySourceHash: compiled.dependencySourceHash,
        sourceBundleHash: compiled.sourceBundleHash,
        creationCodeHash: compiled.creationCodeHash,
      },
      null,
      2,
    ),
  )
}
