import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import solc from 'solc'
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodePacked,
  getAddress,
  http,
  keccak256,
  toHex,
} from 'viem'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const rpcPort = Number(process.env.MANGA_GENERIC_TEST_RPC_PORT || 18_548)
const rpcUrl = `http://127.0.0.1:${rpcPort}`
const chain = defineChain({
  id: 31_337,
  name: 'PAIR generic atomic-arbitrage deterministic test',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
})

const USDG = getAddress('0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168')
const WETH = getAddress('0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73')
const TARGET_TOKEN = getAddress('0x3363Cd5019Aa1F3E50C73086d5F5dCab3D90f558')
const ENTRY_TOKEN = getAddress('0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9')
const EXIT_TOKEN = getAddress('0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC')
const POOL_MANAGER = getAddress('0x8366a39CC670B4001A1121B8F6A443A643e40951')
const V3_FACTORY = getAddress('0x1f7d7550B1b028f7571E69A784071F0205FD2EfA')
const V3_ROUTER = getAddress('0xCaf681a66D020601342297493863E78C959E5cb2')
const PAIR_HOOK = getAddress('0x16D1560630Ce74af4478d9b8AD46548A092A2000')

function compile() {
  const sources = {
    'GenericAtomicArb.sol': {
      content: fs.readFileSync(path.join(root, 'contracts', 'GenericAtomicArb.sol'), 'utf8'),
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

function v3Path(tokens, fees) {
  const types = ['address']
  const values = [tokens[0]]
  for (let index = 0; index < fees.length; index += 1) {
    types.push('uint24', 'address')
    values.push(fees[index], tokens[index + 1])
  }
  return encodePacked(types, values)
}

async function main() {
  const hardhat = path.join(root, 'node_modules', '.bin', 'hardhat')
  const diagnostics = []
  const child = spawn(hardhat, ['node', '--hostname', '127.0.0.1', '--port', String(rpcPort)], {
    cwd: root,
    env: { ...process.env, NO_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.on('data', (chunk) => diagnostics.push(chunk.toString()))
  child.stderr.on('data', (chunk) => diagnostics.push(chunk.toString()))

  try {
    await waitForRpc(child)
    const contracts = compile()
    const executorArtifact = contracts['GenericAtomicArb.sol'].GenericAtomicArb
    const tokenArtifact = contracts['TestRuntime.sol'].MockToken
    const managerArtifact = contracts['TestRuntime.sol'].MockPoolManager
    const factoryArtifact = contracts['TestRuntime.sol'].MockV3Factory
    const routerArtifact = contracts['TestRuntime.sol'].MockV3Router
    const poolArtifact = contracts['TestRuntime.sol'].MockV3Pool
    const publicClient = createPublicClient({ chain, transport: http(rpcUrl) })
    const accounts = await publicClient.request({ method: 'eth_accounts' })
    const operator = getAddress(accounts[0])
    const other = getAddress(accounts[1])
    const walletClient = createWalletClient({ account: operator, chain, transport: http(rpcUrl) })

    for (const token of [USDG, WETH, TARGET_TOKEN, ENTRY_TOKEN, EXIT_TOKEN]) {
      await publicClient.request({
        method: 'hardhat_setCode',
        params: [token, `0x${tokenArtifact.evm.deployedBytecode.object}`],
      })
    }
    for (const [address, artifact] of [
      [POOL_MANAGER, managerArtifact],
      [V3_FACTORY, factoryArtifact],
      [V3_ROUTER, routerArtifact],
    ]) {
      await publicClient.request({
        method: 'hardhat_setCode',
        params: [address, `0x${artifact.evm.deployedBytecode.object}`],
      })
    }

    const deployHash = await walletClient.deployContract({
      abi: executorArtifact.abi,
      bytecode: `0x${executorArtifact.evm.bytecode.object}`,
      args: [operator, 0n],
    })
    const deployReceipt = await publicClient.waitForTransactionReceipt({ hash: deployHash })
    if (deployReceipt.status !== 'success' || !deployReceipt.contractAddress) {
      throw new Error('generic deterministic deployment failed')
    }
    const executor = getAddress(deployReceipt.contractAddress)
    const tokenAbi = tokenArtifact.abi
    const managerAbi = managerArtifact.abi
    const factoryAbi = factoryArtifact.abi
    const routerAbi = routerArtifact.abi

    async function write(address, abi, functionName, args) {
      const hash = await walletClient.writeContract({ address, abi, functionName, args })
      const receipt = await publicClient.waitForTransactionReceipt({ hash })
      if (receipt.status !== 'success') throw new Error(`setup transaction ${functionName} failed`)
    }

    await write(POOL_MANAGER, managerAbi, 'configureTakeMint', [true])
    await write(V3_ROUTER, routerAbi, 'configure', [100_000n])
    const mockPools = [
      [USDG, WETH, 100, getAddress('0x1000000000000000000000000000000000000001')],
      [WETH, ENTRY_TOKEN, 500, getAddress('0x1000000000000000000000000000000000000002')],
      [EXIT_TOKEN, WETH, 500, getAddress('0x1000000000000000000000000000000000000003')],
      [USDG, ENTRY_TOKEN, 500, getAddress('0x1000000000000000000000000000000000000004')],
      [EXIT_TOKEN, USDG, 500, getAddress('0x1000000000000000000000000000000000000005')],
    ]
    for (const args of mockPools) await write(V3_FACTORY, factoryAbi, 'setPool', args)
    for (const [pool, mode, profit] of [
      [mockPools[3][3], 1, 0n],
      [mockPools[4][3], 2, 100_000n],
    ]) {
      await publicClient.request({
        method: 'hardhat_setCode',
        params: [pool, `0x${poolArtifact.evm.deployedBytecode.object}`],
      })
      await write(pool, poolArtifact.abi, 'configure', [mode, profit])
    }
    await write(USDG, tokenAbi, 'mint', [executor, 150_000_000n])

    const entryV3Path = v3Path([USDG, WETH, ENTRY_TOKEN], [100, 500])
    const exitV3Path = v3Path([EXIT_TOKEN, WETH, USDG], [500, 100])
    const route = {
      targetToken: TARGET_TOKEN,
      entryToken: ENTRY_TOKEN,
      exitToken: EXIT_TOKEN,
      entryV3Path,
      exitV3Path,
      entryV4Pool: {
        currency0: TARGET_TOKEN,
        currency1: ENTRY_TOKEN,
        fee: 10_000,
        tickSpacing: 200,
        hooks: PAIR_HOOK,
      },
      exitV4Pool: {
        currency0: TARGET_TOKEN,
        currency1: EXIT_TOKEN,
        fee: 10_000,
        tickSpacing: 200,
        hooks: PAIR_HOOK,
      },
    }
    const block = await publicClient.getBlock()
    const positiveArgs = [route, 100_000_000n, 50_000n, block.timestamp + 300n]
    const simulation = await publicClient.simulateContract({
      account: operator,
      address: executor,
      abi: executorArtifact.abi,
      functionName: 'execute',
      args: positiveArgs,
    })
    if (simulation.result[0] !== 100_100_000n || simulation.result[1] !== 100_000n) {
      throw new Error('generic positive simulation did not produce the exact expected business result')
    }
    const directRoute = {
      ...route,
      entryV3Path: v3Path([USDG, ENTRY_TOKEN], [500]),
      exitV3Path: v3Path([EXIT_TOKEN, USDG], [500]),
    }
    const directArgs = [directRoute, 25_000_000n, 50_000n, block.timestamp + 300n]
    const directSimulation = await publicClient.simulateContract({
      account: operator,
      address: executor,
      abi: executorArtifact.abi,
      functionName: 'execute',
      args: directArgs,
    })
    if (directSimulation.result[0] !== 25_100_000n || directSimulation.result[1] !== 100_000n) {
      throw new Error('direct-pool simulation did not produce the exact expected business result')
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

    const executeRequest = (args, account = operator) => ({
      account,
      address: executor,
      abi: executorArtifact.abi,
      functionName: 'execute',
      args,
    })
    const negativeChecks = []
    negativeChecks.push(
      await mustRevert('non_operator', 'NotOperator', 'NotOperator()', executeRequest(positiveArgs, other)),
    )
    negativeChecks.push(
      await mustRevert(
        'amount_over_100_cap',
        'InvalidAmount',
        'InvalidAmount()',
        executeRequest([route, 100_000_001n, 50_000n, block.timestamp + 300n]),
      ),
    )
    negativeChecks.push(
      await mustRevert(
        'profit_floor_too_low',
        'ProfitFloorTooLow',
        'ProfitFloorTooLow()',
        executeRequest([route, 5_000_000n, 49_999n, block.timestamp + 300n]),
      ),
    )
    negativeChecks.push(
      await mustRevert(
        'expired',
        'Expired',
        'Expired()',
        executeRequest([route, 5_000_000n, 50_000n, block.timestamp - 1n]),
      ),
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
      await mustRevert(
        'invalid_entry_path_endpoint',
        'InvalidV3Path',
        'InvalidV3Path()',
        executeRequest([
          { ...route, entryV3Path: v3Path([WETH, ENTRY_TOKEN], [500]) },
          5_000_000n,
          50_000n,
          block.timestamp + 300n,
        ]),
      ),
    )
    negativeChecks.push(
      await mustRevert(
        'missing_canonical_v3_pool',
        'MissingV3Pool',
        'MissingV3Pool()',
        executeRequest([
          { ...route, entryV3Path: v3Path([USDG, WETH, ENTRY_TOKEN], [3_000, 500]) },
          5_000_000n,
          50_000n,
          block.timestamp + 300n,
        ]),
      ),
    )
    negativeChecks.push(
      await mustRevert(
        'more_than_two_v3_hops',
        'InvalidV3Path',
        'InvalidV3Path()',
        executeRequest([
          { ...route, entryV3Path: v3Path([USDG, WETH, TARGET_TOKEN, ENTRY_TOKEN], [100, 500, 500]) },
          5_000_000n,
          50_000n,
          block.timestamp + 300n,
        ]),
      ),
    )
    negativeChecks.push(
      await mustRevert(
        'two_hop_non_weth_bridge',
        'InvalidV3Path',
        'InvalidV3Path()',
        executeRequest([
          { ...route, entryV3Path: v3Path([USDG, TARGET_TOKEN, ENTRY_TOKEN], [100, 500]) },
          5_000_000n,
          50_000n,
          block.timestamp + 300n,
        ]),
      ),
    )
    negativeChecks.push(
      await mustRevert(
        'v3_fee_outside_allowlist',
        'InvalidV3Path',
        'InvalidV3Path()',
        executeRequest([
          { ...route, entryV3Path: v3Path([USDG, ENTRY_TOKEN], [123]) },
          5_000_000n,
          50_000n,
          block.timestamp + 300n,
        ]),
      ),
    )
    negativeChecks.push(
      await mustRevert(
        'wrong_pair_hook',
        'InvalidV4Pool',
        'InvalidV4Pool()',
        executeRequest([
          {
            ...route,
            entryV4Pool: { ...route.entryV4Pool, hooks: getAddress('0x0000000000000000000000000000000000000001') },
          },
          5_000_000n,
          50_000n,
          block.timestamp + 300n,
        ]),
      ),
    )
    negativeChecks.push(
      await mustRevert(
        'duplicate_v4_pool',
        'DuplicateV4Pool',
        'DuplicateV4Pool()',
        executeRequest([
          {
            ...route,
            exitToken: ENTRY_TOKEN,
            exitV3Path: v3Path([ENTRY_TOKEN, WETH, USDG], [500, 100]),
            exitV4Pool: route.entryV4Pool,
          },
          5_000_000n,
          50_000n,
          block.timestamp + 300n,
        ]),
      ),
    )

    await write(V3_ROUTER, routerAbi, 'configure', [0n])
    negativeChecks.push(
      await mustRevert(
        'unprofitable_atomic_revert',
        'ProfitTooLow',
        'ProfitTooLow(uint256,uint256)',
        executeRequest([route, 5_000_000n, 50_000n, block.timestamp + 300n]),
      ),
    )
    await write(V3_ROUTER, routerAbi, 'configure', [100_000n])

    const executeHash = await walletClient.writeContract({
      account: operator,
      address: executor,
      abi: executorArtifact.abi,
      functionName: 'execute',
      args: positiveArgs,
    })
    const executeReceipt = await publicClient.waitForTransactionReceipt({ hash: executeHash })
    const directHash = await walletClient.writeContract({
      account: operator,
      address: executor,
      abi: executorArtifact.abi,
      functionName: 'execute',
      args: directArgs,
    })
    const directReceipt = await publicClient.waitForTransactionReceipt({ hash: directHash })
    const balances = {}
    for (const [name, token] of Object.entries({
      usdg: USDG,
      entryToken: ENTRY_TOKEN,
      targetToken: TARGET_TOKEN,
      exitToken: EXIT_TOKEN,
    })) {
      balances[name] = await publicClient.readContract({
        address: token,
        abi: tokenAbi,
        functionName: 'balanceOf',
        args: [executor],
      })
    }
    const allowances = {
      usdg: await publicClient.readContract({
        address: USDG,
        abi: tokenAbi,
        functionName: 'allowance',
        args: [executor, V3_ROUTER],
      }),
      exitToken: await publicClient.readContract({
        address: EXIT_TOKEN,
        abi: tokenAbi,
        functionName: 'allowance',
        args: [executor, V3_ROUTER],
      }),
    }
    if (executeReceipt.status !== 'success' || directReceipt.status !== 'success' || balances.usdg !== 150_200_000n) {
      throw new Error('confirmed generic execution did not increase USDG by the exact simulated profit')
    }
    if (balances.entryToken !== 0n || balances.targetToken !== 0n || balances.exitToken !== 0n) {
      throw new Error('confirmed generic execution left an intermediate asset balance')
    }
    if (allowances.usdg !== 0n || allowances.exitToken !== 0n) {
      throw new Error('confirmed generic execution left a router allowance')
    }

    console.log(
      JSON.stringify({
        status: 'GENERIC_DETERMINISTIC_CONTRACT_TEST_PASSED',
        executor,
        sourceHash: keccak256(toHex(fs.readFileSync(path.join(root, 'contracts', 'GenericAtomicArb.sol'), 'utf8'))),
        simulation: { amountOut: simulation.result[0].toString(), grossProfit: simulation.result[1].toString() },
        confirmed: {
          hash: executeHash,
          gasUsed: executeReceipt.gasUsed.toString(),
          directHash,
          directGasUsed: directReceipt.gasUsed.toString(),
          executorUsdg: balances.usdg.toString(),
        },
        residuals: {
          entryToken: balances.entryToken.toString(),
          targetToken: balances.targetToken.toString(),
          exitToken: balances.exitToken.toString(),
        },
        allowances: { usdg: allowances.usdg.toString(), exitToken: allowances.exitToken.toString() },
        negativeChecks,
      }),
    )
  } catch (error) {
    const tail = diagnostics.join('').split('\n').slice(-30).join('\n')
    throw new Error(`${error.stack || error}\nHardhat diagnostics:\n${tail}`)
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
