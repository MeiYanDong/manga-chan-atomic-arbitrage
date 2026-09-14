import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import solc from 'solc'
import { keccak256, toHex } from 'viem'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const contractPath = path.join(root, 'contracts', 'GenericAtomicArb.sol')
const artifactPath = path.join(root, 'artifacts', 'generic-atomic-arb.json')

export function compileGenericContract() {
  const source = fs.readFileSync(contractPath, 'utf8')
  const input = {
    language: 'Solidity',
    sources: { 'GenericAtomicArb.sol': { content: source } },
    settings: {
      evmVersion: 'cancun',
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
      outputSelection: {
        '*': {
          GenericAtomicArb: ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'],
        },
      },
    },
  }
  const output = JSON.parse(solc.compile(JSON.stringify(input)))
  const errors = (output.errors || []).filter((item) => item.severity === 'error')
  if (errors.length > 0) throw new Error(errors.map((item) => item.formattedMessage).join('\n'))
  const contract = output.contracts?.['GenericAtomicArb.sol']?.GenericAtomicArb
  if (!contract) throw new Error('GenericAtomicArb compile output is missing')
  return {
    schemaVersion: 1,
    contract: 'GenericAtomicArb',
    evmVersion: 'cancun',
    optimizerRuns: 200,
    viaIR: true,
    abi: contract.abi,
    bytecode: `0x${contract.evm.bytecode.object}`,
    deployedBytecode: `0x${contract.evm.deployedBytecode.object}`,
    creationBytes: contract.evm.bytecode.object.length / 2,
    runtimeBytes: contract.evm.deployedBytecode.object.length / 2,
    sourceHash: keccak256(toHex(source)),
    creationCodeHash: keccak256(`0x${contract.evm.bytecode.object}`),
    runtimeTemplateCodeHash: keccak256(`0x${contract.evm.deployedBytecode.object}`),
    compiler: solc.version(),
  }
}

export function writeGenericContractArtifact(compiled, outputPath = artifactPath) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true, mode: 0o755 })
  const temporary = `${outputPath}.${process.pid}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(compiled, null, 2)}\n`, { mode: 0o644 })
  fs.renameSync(temporary, outputPath)
  return outputPath
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const compiled = compileGenericContract()
  writeGenericContractArtifact(compiled)
  console.log(
    JSON.stringify(
      {
        status: 'GENERIC_CONTRACT_COMPILED',
        compiler: compiled.compiler,
        evmVersion: 'cancun',
        optimizerRuns: 200,
        creationBytes: compiled.creationBytes,
        runtimeBytes: compiled.runtimeBytes,
        sourceHash: compiled.sourceHash,
        creationCodeHash: compiled.creationCodeHash,
        runtimeTemplateCodeHash: compiled.runtimeTemplateCodeHash,
        artifact: 'artifacts/generic-atomic-arb.json',
      },
      null,
      2,
    ),
  )
}
