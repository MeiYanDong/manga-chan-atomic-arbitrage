import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import solc from 'solc'
import { createPublicClient, createWalletClient, decodeErrorResult, defineChain, getAddress, http } from 'viem'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const rpcPort = Number(process.env.MANGA_UNIVERSAL_TEST_RPC_PORT || 18_551)
const rpcUrl = `http://127.0.0.1:${rpcPort}`
const chain = defineChain({
  id: 31_337,
  name: 'universal atomic executor deterministic test',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
})

const USDG = getAddress('0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168')
const TOKEN = getAddress('0xA3b6AEe90017b72c0812dC1e013De70eB2917ba3')
const BPT = getAddress('0x070F0Bcf458c2A836cF68c986df3BA86586e64FD')
const MORPHO = getAddress('0x9D53d5E3bd5E8d4Cbfa6DB1ca238AEA02E651010')
const V2_FACTORY = getAddress('0x8bcEaA40B9AcdfAedF85AdF4FF01F5Ad6517937f')
const V3_FACTORY = getAddress('0x1f7d7550B1b028f7571E69A784071F0205FD2EfA')
const POOL_MANAGER = getAddress('0x8366a39CC670B4001A1121B8F6A443A643e40951')
const EARN_VAULT = getAddress('0x28082618Ba2073E602230188E4F4C46e9b2169EB')
const EARN_ROUTER = getAddress('0xFCcDd6Df64de63b609042c55C629F223321340e1')
const PERMIT2 = getAddress('0x000000000022D473030F116dDEE9F6B43aC78BA3')
const V3_USDG_TOKEN = getAddress('0x1000000000000000000000000000000000000001')
const V3_USDG_BPT = getAddress('0x1000000000000000000000000000000000000002')
const V2_USDG_TOKEN = getAddress('0x1000000000000000000000000000000000000003')

function compile() {
  const sources = {
    'UniversalAtomicExecutor.sol': {
      content: fs.readFileSync(path.join(root, 'contracts', 'UniversalAtomicExecutor.sol'), 'utf8'),
    },
    'UniversalTestRuntime.sol': {
      content: fs.readFileSync(path.join(root, 'test', 'contracts', 'UniversalTestRuntime.sol'), 'utf8'),
    },
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

function decodedError(error, abi) {
  const pending = [error]
  const seen = new Set()
  while (pending.length > 0) {
    const item = pending.shift()
    if (!item || seen.has(item)) continue
    if (typeof item === 'string' && /^0x[0-9a-f]{8,}$/i.test(item)) {
      try {
        return decodeErrorResult({ abi, data: item })
      } catch {}
      continue
    }
    if (typeof item !== 'object') continue
    seen.add(item)
    for (const value of Object.values(item)) pending.push(value)
  }
  return null
}

function emptyV4() {
  return {
    currency0: '0x0000000000000000000000000000000000000000',
    currency1: '0x0000000000000000000000000000000000000000',
    fee: 0,
    tickSpacing: 0,
    hooks: '0x0000000000000000000000000000000000000000',
  }
}

function action(kind, tokenIn, tokenOut, pool, amountIn = 0n, minimumAmountOut = 0n, fee = 0, v4Pool = emptyV4()) {
  return { kind, tokenIn, tokenOut, pool, amountIn, minimumAmountOut, fee, v4Pool }
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
    const executorArtifact = contracts['UniversalAtomicExecutor.sol'].UniversalAtomicExecutor
    const mocks = contracts['UniversalTestRuntime.sol']
    const publicClient = createPublicClient({ chain, transport: http(rpcUrl) })
    const accounts = await publicClient.request({ method: 'eth_accounts' })
    const operator = getAddress(accounts[0])
    const other = getAddress(accounts[1])
    const walletClient = createWalletClient({ account: operator, chain, transport: http(rpcUrl) })

    async function install(address, artifact) {
      await publicClient.request({
        method: 'hardhat_setCode',
        params: [address, `0x${artifact.evm.deployedBytecode.object}`],
      })
    }
    for (const token of [USDG, TOKEN, BPT]) await install(token, mocks.UniversalMockToken)
    for (const [address, artifact] of [
      [MORPHO, mocks.UniversalMockMorpho],
      [V2_FACTORY, mocks.UniversalMockV2Factory],
      [V3_FACTORY, mocks.UniversalMockV3Factory],
      [POOL_MANAGER, mocks.UniversalMockPoolManager],
      [EARN_VAULT, mocks.UniversalMockVault],
      [EARN_ROUTER, mocks.UniversalMockEarnRouter],
      [PERMIT2, mocks.UniversalMockPermit2],
      [V3_USDG_TOKEN, mocks.UniversalMockV3Pool],
      [V3_USDG_BPT, mocks.UniversalMockV3Pool],
      [V2_USDG_TOKEN, mocks.UniversalMockV2Pair],
    ]) {
      await install(address, artifact)
    }

    const deployHash = await walletClient.deployContract({
      abi: executorArtifact.abi,
      bytecode: `0x${executorArtifact.evm.bytecode.object}`,
      args: [operator],
    })
    const deployReceipt = await publicClient.waitForTransactionReceipt({ hash: deployHash })
    if (deployReceipt.status !== 'success' || !deployReceipt.contractAddress) throw new Error('deployment failed')
    const executor = getAddress(deployReceipt.contractAddress)

    async function write(address, abi, functionName, args) {
      const hash = await walletClient.writeContract({ address, abi, functionName, args })
      const receipt = await publicClient.waitForTransactionReceipt({ hash })
      if (receipt.status !== 'success') throw new Error(`setup ${functionName} failed`)
    }
    await write(V3_FACTORY, mocks.UniversalMockV3Factory.abi, 'setPool', [USDG, TOKEN, 500, V3_USDG_TOKEN])
    await write(V3_FACTORY, mocks.UniversalMockV3Factory.abi, 'setPool', [USDG, BPT, 500, V3_USDG_BPT])
    await write(V2_FACTORY, mocks.UniversalMockV2Factory.abi, 'setPair', [USDG, TOKEN, V2_USDG_TOKEN])
    await write(V3_USDG_TOKEN, mocks.UniversalMockV3Pool.abi, 'configure', [USDG, TOKEN, 10n])
    await write(V3_USDG_BPT, mocks.UniversalMockV3Pool.abi, 'configure', [BPT, USDG, 0n])
    await write(V2_USDG_TOKEN, mocks.UniversalMockV2Pair.abi, 'configure', [USDG, TOKEN, 1_000n, 2_000n])
    await write(EARN_VAULT, mocks.UniversalMockVault.abi, 'configurePool', [BPT, [USDG, TOKEN]])
    await write(EARN_ROUTER, mocks.UniversalMockEarnRouter.abi, 'configure', [0n, 20n])
    await write(USDG, mocks.UniversalMockToken.abi, 'mint', [executor, 1_000n])
    await write(TOKEN, mocks.UniversalMockToken.abi, 'mint', [executor, 777n])

    const block = await publicClient.getBlock()
    const tracked = [
      { token: USDG, maximumResidual: 0n },
      { token: TOKEN, maximumResidual: 0n },
      { token: BPT, maximumResidual: 0n },
    ]
    const v3RoundTrip = {
      settlementToken: USDG,
      trackedTokens: tracked,
      actions: [
        action(1, USDG, TOKEN, V3_USDG_TOKEN, 100n, 100n, 500),
        action(1, TOKEN, USDG, V3_USDG_TOKEN, 0n, 100n, 500),
      ],
      minimumProfit: 20n,
      deadline: block.timestamp + 300n,
    }
    const inventorySimulation = await publicClient.simulateContract({
      account: operator,
      address: executor,
      abi: executorArtifact.abi,
      functionName: 'executeWithInventory',
      args: [v3RoundTrip, 100n],
    })
    if (inventorySimulation.result !== 20n) throw new Error('inventory simulation profit mismatch')
    const inventoryHash = await walletClient.writeContract(inventorySimulation.request)
    const inventoryReceipt = await publicClient.waitForTransactionReceipt({ hash: inventoryHash })
    if (inventoryReceipt.status !== 'success') throw new Error('inventory execution failed')
    const [usdgAfterInventory, tokenAfterInventory] = await Promise.all([
      publicClient.readContract({
        address: USDG,
        abi: mocks.UniversalMockToken.abi,
        functionName: 'balanceOf',
        args: [executor],
      }),
      publicClient.readContract({
        address: TOKEN,
        abi: mocks.UniversalMockToken.abi,
        functionName: 'balanceOf',
        args: [executor],
      }),
    ])
    if (usdgAfterInventory !== 1_020n || tokenAfterInventory !== 777n) {
      throw new Error('inventory execution did not protect pre-existing balances')
    }

    const flashSimulation = await publicClient.simulateContract({
      account: operator,
      address: executor,
      abi: executorArtifact.abi,
      functionName: 'executeWithFlash',
      args: [v3RoundTrip, 100n],
    })
    if (flashSimulation.result !== 20n) throw new Error('flash simulation profit mismatch')
    const flashHash = await walletClient.writeContract(flashSimulation.request)
    const flashReceipt = await publicClient.waitForTransactionReceipt({ hash: flashHash })
    if (flashReceipt.status !== 'success') throw new Error('flash execution failed')

    let quoted = null
    try {
      await publicClient.simulateContract({
        account: operator,
        address: executor,
        abi: executorArtifact.abi,
        functionName: 'quoteWithFlash',
        args: [v3RoundTrip, 100n],
      })
    } catch (error) {
      const decoded = decodedError(error, executorArtifact.abi)
      if (decoded?.errorName === 'QuoteResult') quoted = decoded.args[0]
    }
    if (quoted !== 20n) throw new Error(`quote-by-revert mismatch: ${quoted}`)

    const v2ToV3Plan = {
      ...v3RoundTrip,
      actions: [
        action(0, USDG, TOKEN, V2_USDG_TOKEN, 100n, 181n),
        action(1, TOKEN, USDG, V3_USDG_TOKEN, 0n, 191n, 500),
      ],
      minimumProfit: 91n,
    }
    const v2Simulation = await publicClient.simulateContract({
      account: operator,
      address: executor,
      abi: executorArtifact.abi,
      functionName: 'executeWithFlash',
      args: [v2ToV3Plan, 100n],
    })
    if (v2Simulation.result !== 91n) throw new Error(`V2/V3 profit mismatch: ${v2Simulation.result}`)

    const removePlan = {
      ...v3RoundTrip,
      actions: [
        action(1, USDG, BPT, V3_USDG_BPT, 100n, 100n, 500),
        action(5, BPT, '0x0000000000000000000000000000000000000000', BPT),
        action(1, TOKEN, USDG, V3_USDG_TOKEN, 0n, 1n, 500),
      ],
      minimumProfit: 20n,
    }
    const removeSimulation = await publicClient.simulateContract({
      account: operator,
      address: executor,
      abi: executorArtifact.abi,
      functionName: 'executeWithFlash',
      args: [removePlan, 100n],
    })
    if (removeSimulation.result !== 30n) throw new Error(`Earn remove profit mismatch: ${removeSimulation.result}`)

    const v4Key = {
      currency0: USDG < TOKEN ? USDG : TOKEN,
      currency1: USDG < TOKEN ? TOKEN : USDG,
      fee: 1_500,
      tickSpacing: 15,
      hooks: '0x0000000000000000000000000000000000000000',
    }
    await write(POOL_MANAGER, mocks.UniversalMockPoolManager.abi, 'configure', [5n])
    const v4Plan = {
      ...v3RoundTrip,
      actions: [
        action(2, USDG, TOKEN, '0x0000000000000000000000000000000000000000', 100n, 100n, 0, v4Key),
        action(2, TOKEN, USDG, '0x0000000000000000000000000000000000000000', 0n, 100n, 0, v4Key),
      ],
      minimumProfit: 10n,
    }
    const v4Simulation = await publicClient.simulateContract({
      account: operator,
      address: executor,
      abi: executorArtifact.abi,
      functionName: 'executeWithFlash',
      args: [v4Plan, 100n],
    })
    if (v4Simulation.result !== 10n) throw new Error('V4 simulation profit mismatch')

    async function mustRevert(label, request) {
      try {
        await publicClient.simulateContract(request)
      } catch {
        return label
      }
      throw new Error(`${label} did not revert`)
    }
    const negativeChecks = []
    negativeChecks.push(
      await mustRevert('non_operator', {
        account: other,
        address: executor,
        abi: executorArtifact.abi,
        functionName: 'executeWithFlash',
        args: [v3RoundTrip, 100n],
      }),
    )
    negativeChecks.push(
      await mustRevert('forged_morpho_callback', {
        account: operator,
        address: executor,
        abi: executorArtifact.abi,
        functionName: 'onMorphoFlashLoan',
        args: [1n, '0x'],
      }),
    )
    negativeChecks.push(
      await mustRevert('forged_v3_callback', {
        account: operator,
        address: executor,
        abi: executorArtifact.abi,
        functionName: 'uniswapV3SwapCallback',
        args: [1n, -1n, '0x'],
      }),
    )
    negativeChecks.push(
      await mustRevert('noncanonical_v2_pair', {
        account: operator,
        address: executor,
        abi: executorArtifact.abi,
        functionName: 'executeWithFlash',
        args: [
          {
            ...v2ToV3Plan,
            actions: [action(0, USDG, TOKEN, V3_USDG_TOKEN, 100n, 1n)],
          },
          100n,
        ],
      }),
    )
    negativeChecks.push(
      await mustRevert('noncanonical_v3_pool', {
        account: operator,
        address: executor,
        abi: executorArtifact.abi,
        functionName: 'executeWithFlash',
        args: [
          {
            ...v3RoundTrip,
            actions: [action(1, USDG, TOKEN, V3_USDG_BPT, 100n, 1n, 500)],
          },
          100n,
        ],
      }),
    )

    console.log(
      JSON.stringify(
        {
          status: 'UNIVERSAL_CONTRACT_TESTS_PASSED',
          balances: {
            inventoryUsdgAfter: usdgAfterInventory.toString(),
            protectedTokenAfter: tokenAfterInventory.toString(),
          },
          exactBusinessResults: {
            inventoryProfit: inventorySimulation.result.toString(),
            flashProfit: flashSimulation.result.toString(),
            quoteProfit: quoted.toString(),
            v2ToV3Profit: v2Simulation.result.toString(),
            earnRemoveProfit: removeSimulation.result.toString(),
            v4Profit: v4Simulation.result.toString(),
          },
          negativeChecks,
        },
        null,
        2,
      ),
    )
  } catch (error) {
    const tail = diagnostics.join('').slice(-4_000)
    if (tail) process.stderr.write(`${tail}\n`)
    throw error
  } finally {
    child.kill('SIGTERM')
  }
}

await main()
