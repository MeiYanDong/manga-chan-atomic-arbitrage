import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import solc from 'solc'
import { createPublicClient, createWalletClient, defineChain, getAddress, http, keccak256, toHex } from 'viem'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const rpcPort = Number(process.env.MANGA_TEST_RPC_PORT || 18_547)
const rpcUrl = `http://127.0.0.1:${rpcPort}`
const chain = defineChain({
  id: 31_337,
  name: 'MANGA deterministic test',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
})

const USDG = getAddress('0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168')
const MANGA = getAddress('0xc28068cb109Dd0a0d5C6C6a925B048fEA00E31a6')
const MSFT = getAddress('0xe93237C50D904957Cf27E7B1133b510C669c2e74')
const NVDA = getAddress('0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC')
const POOL_MANAGER = getAddress('0x8366a39CC670B4001A1121B8F6A443A643e40951')
const ENTRY_V3_POOL = getAddress('0xeb60bCD1D920ad6E102690CCFC6fB488899E1510')
const EXIT_V3_POOL = getAddress('0xd4EB21209C4D6093f80B5b84f5C45cc093EA14a3')

function compile() {
  const sources = {
    'MangaChanAtomicArb.sol': {
      content: fs.readFileSync(path.join(root, 'contracts', 'MangaChanAtomicArb.sol'), 'utf8'),
    },
    'TestRuntime.sol': { content: fs.readFileSync(path.join(root, 'test', 'contracts', 'TestRuntime.sol'), 'utf8') },
  }
  const input = {
    language: 'Solidity',
    sources,
    settings: {
      evmVersion: 'cancun',
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } },
    },
  }
  const output = JSON.parse(solc.compile(JSON.stringify(input)))
  const errors = (output.errors || []).filter((item) => item.severity === 'error')
  if (errors.length > 0) throw new Error(errors.map((item) => item.formattedMessage).join('\n'))
  return output.contracts
}

async function waitForRpc(child) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Hardhat node exited before readiness: ${child.exitCode}`)
    try {
      const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
      })
      if (response.ok) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error('Hardhat node did not become ready')
}

function containsExpectedError(error, name, signature) {
  const selector = keccak256(toHex(signature)).slice(0, 10).toLowerCase()
  const pending = [error]
  const visited = new Set()
  while (pending.length > 0) {
    const item = pending.shift()
    if (!item || visited.has(item)) continue
    if (typeof item === 'string') {
      if (item.includes(name) || item.toLowerCase().includes(selector)) return true
      continue
    }
    if (typeof item !== 'object') continue
    visited.add(item)
    if (item.errorName === name) return true
    for (const value of Object.values(item)) pending.push(value)
  }
  return false
}

async function main() {
  const hardhat = path.join(root, 'node_modules', '.bin', 'hardhat')
  const output = []
  const child = spawn(hardhat, ['node', '--hostname', '127.0.0.1', '--port', String(rpcPort)], {
    cwd: root,
    env: { ...process.env, NO_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.on('data', (chunk) => output.push(chunk.toString()))
  child.stderr.on('data', (chunk) => output.push(chunk.toString()))

  try {
    await waitForRpc(child)
    const contracts = compile()
    const executorArtifact = contracts['MangaChanAtomicArb.sol'].MangaChanAtomicArb
    const tokenArtifact = contracts['TestRuntime.sol'].MockToken
    const managerArtifact = contracts['TestRuntime.sol'].MockPoolManager
    const poolArtifact = contracts['TestRuntime.sol'].MockV3Pool
    const publicClient = createPublicClient({ chain, transport: http(rpcUrl) })
    const accounts = await publicClient.request({ method: 'eth_accounts' })
    const operator = getAddress(accounts[0])
    const other = getAddress(accounts[1])
    const walletClient = createWalletClient({ account: operator, chain, transport: http(rpcUrl) })

    for (const token of [USDG, MANGA, MSFT, NVDA]) {
      await publicClient.request({
        method: 'hardhat_setCode',
        params: [token, `0x${tokenArtifact.evm.deployedBytecode.object}`],
      })
    }
    await publicClient.request({
      method: 'hardhat_setCode',
      params: [POOL_MANAGER, `0x${managerArtifact.evm.deployedBytecode.object}`],
    })
    for (const pool of [ENTRY_V3_POOL, EXIT_V3_POOL]) {
      await publicClient.request({
        method: 'hardhat_setCode',
        params: [pool, `0x${poolArtifact.evm.deployedBytecode.object}`],
      })
    }

    const deployHash = await walletClient.deployContract({
      abi: executorArtifact.abi,
      bytecode: `0x${executorArtifact.evm.bytecode.object}`,
      args: [operator, 0n],
    })
    const deployReceipt = await publicClient.waitForTransactionReceipt({ hash: deployHash })
    if (deployReceipt.status !== 'success' || !deployReceipt.contractAddress)
      throw new Error('deterministic deployment failed')
    const executor = getAddress(deployReceipt.contractAddress)
    const tokenAbi = tokenArtifact.abi
    const poolAbi = poolArtifact.abi

    const setupTransactions = [
      walletClient.writeContract({ address: ENTRY_V3_POOL, abi: poolAbi, functionName: 'configure', args: [1, 0n] }),
      walletClient.writeContract({
        address: EXIT_V3_POOL,
        abi: poolAbi,
        functionName: 'configure',
        args: [2, 100_000n],
      }),
      walletClient.writeContract({ address: USDG, abi: tokenAbi, functionName: 'mint', args: [executor, 10_000_000n] }),
    ]
    for (const transaction of setupTransactions) {
      const hash = await transaction
      const receipt = await publicClient.waitForTransactionReceipt({ hash })
      if (receipt.status !== 'success') throw new Error('deterministic setup failed')
    }

    const block = await publicClient.getBlock()
    const positiveArgs = [5_000_000n, 50_000n, block.timestamp + 300n]
    const simulation = await publicClient.simulateContract({
      account: operator,
      address: executor,
      abi: executorArtifact.abi,
      functionName: 'execute',
      args: positiveArgs,
    })
    if (simulation.result[0] !== 5_100_000n || simulation.result[1] !== 100_000n) {
      throw new Error('positive simulation did not produce the exact expected business result')
    }

    async function mustRevert(label, expectedName, signature, request) {
      try {
        await publicClient.simulateContract(request)
      } catch (error) {
        if (!containsExpectedError(error, expectedName, signature)) {
          throw new Error(`${label} reverted with the wrong selector; expected ${expectedName}`)
        }
        return label
      }
      throw new Error(`${label} did not revert`)
    }

    const negativeChecks = []
    negativeChecks.push(
      await mustRevert('non_operator', 'NotOperator', 'NotOperator()', {
        account: other,
        address: executor,
        abi: executorArtifact.abi,
        functionName: 'execute',
        args: positiveArgs,
      }),
    )
    negativeChecks.push(
      await mustRevert('amount_over_cap', 'InvalidAmount', 'InvalidAmount()', {
        account: operator,
        address: executor,
        abi: executorArtifact.abi,
        functionName: 'execute',
        args: [15_000_001n, 50_000n, block.timestamp + 300n],
      }),
    )
    negativeChecks.push(
      await mustRevert('profit_floor_too_low', 'ProfitFloorTooLow', 'ProfitFloorTooLow()', {
        account: operator,
        address: executor,
        abi: executorArtifact.abi,
        functionName: 'execute',
        args: [5_000_000n, 49_999n, block.timestamp + 300n],
      }),
    )
    negativeChecks.push(
      await mustRevert('expired', 'Expired', 'Expired()', {
        account: operator,
        address: executor,
        abi: executorArtifact.abi,
        functionName: 'execute',
        args: [5_000_000n, 50_000n, block.timestamp - 1n],
      }),
    )
    negativeChecks.push(
      await mustRevert('forged_v3_callback', 'UnauthorizedCallback', 'UnauthorizedCallback()', {
        account: operator,
        address: executor,
        abi: executorArtifact.abi,
        functionName: 'uniswapV3SwapCallback',
        args: [1n, -1n, '0x'],
      }),
    )
    negativeChecks.push(
      await mustRevert('forged_unlock_callback', 'UnauthorizedCallback', 'UnauthorizedCallback()', {
        account: operator,
        address: executor,
        abi: executorArtifact.abi,
        functionName: 'unlockCallback',
        args: ['0x'],
      }),
    )

    const unprofitableSetup = await walletClient.writeContract({
      address: EXIT_V3_POOL,
      abi: poolAbi,
      functionName: 'configure',
      args: [2, 0n],
    })
    await publicClient.waitForTransactionReceipt({ hash: unprofitableSetup })
    negativeChecks.push(
      await mustRevert('unprofitable_atomic_revert', 'ProfitTooLow', 'ProfitTooLow(uint256,uint256)', {
        account: operator,
        address: executor,
        abi: executorArtifact.abi,
        functionName: 'execute',
        args: [5_000_000n, 1_000_000n, block.timestamp + 300n],
      }),
    )
    const restoreProfit = await walletClient.writeContract({
      address: EXIT_V3_POOL,
      abi: poolAbi,
      functionName: 'configure',
      args: [2, 100_000n],
    })
    await publicClient.waitForTransactionReceipt({ hash: restoreProfit })

    const executeHash = await walletClient.writeContract({
      account: operator,
      address: executor,
      abi: executorArtifact.abi,
      functionName: 'execute',
      args: positiveArgs,
    })
    const executeReceipt = await publicClient.waitForTransactionReceipt({ hash: executeHash })
    const balances = {}
    for (const [name, token] of Object.entries({ usdg: USDG, msft: MSFT, manga: MANGA, nvda: NVDA })) {
      balances[name] = await publicClient.readContract({
        address: token,
        abi: tokenAbi,
        functionName: 'balanceOf',
        args: [executor],
      })
    }
    if (executeReceipt.status !== 'success' || balances.usdg !== 10_100_000n) {
      throw new Error('confirmed execution did not increase executor USDG by the exact simulated profit')
    }
    if (balances.msft !== 0n || balances.manga !== 0n || balances.nvda !== 0n) {
      throw new Error('confirmed execution left an intermediate asset balance')
    }

    console.log(
      JSON.stringify({
        status: 'DETERMINISTIC_CONTRACT_TEST_PASSED',
        executor,
        sourceHash: keccak256(toHex(fs.readFileSync(path.join(root, 'contracts', 'MangaChanAtomicArb.sol'), 'utf8'))),
        simulation: { amountOut: simulation.result[0].toString(), grossProfit: simulation.result[1].toString() },
        confirmed: {
          hash: executeHash,
          gasUsed: executeReceipt.gasUsed.toString(),
          executorUsdg: balances.usdg.toString(),
        },
        residuals: { msft: balances.msft.toString(), manga: balances.manga.toString(), nvda: balances.nvda.toString() },
        negativeChecks,
      }),
    )
  } catch (error) {
    const diagnostics = output.join('').split('\n').slice(-30).join('\n')
    throw new Error(`${error.stack || error}\nHardhat diagnostics:\n${diagnostics}`)
  } finally {
    child.kill('SIGTERM')
    await new Promise((resolve) => {
      if (child.exitCode !== null) resolve()
      else {
        child.once('exit', resolve)
        setTimeout(resolve, 2_000)
      }
    })
  }
}

main().catch((error) => {
  console.error(error.stack || error)
  process.exitCode = 1
})
