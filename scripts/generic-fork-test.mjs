import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  formatUnits,
  getAddress,
  http,
  parseAbi,
  parseEther,
} from 'viem'
import { buildGenericExecutionCandidate } from '../src/generic-plan.mjs'
import { compileGenericContract } from './generic-contract-compile.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const snapshotPath =
  process.env.MANGA_GENERIC_FORK_SNAPSHOT || path.join(root, 'test', 'fixtures', 'generic-sigma-54406832.json')
const forkSource = process.env.MANGA_GENERIC_FORK_SOURCE || 'https://rpc.mainnet.chain.robinhood.com'
const rpcPort = Number(process.env.MANGA_GENERIC_FORK_PORT || 18_549)
const rpcUrl = `http://127.0.0.1:${rpcPort}`
const chain = defineChain({
  id: 4_663,
  name: 'Robinhood Chain local fork',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
})
const USDG = getAddress('0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168')
const V3_ROUTER = getAddress('0xCaf681a66D020601342297493863E78C959E5cb2')
const ERC20_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
])

async function waitForRpc(child) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`fork node exited before readiness: ${child.exitCode}`)
    try {
      const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
      })
      if (response.ok) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('fork node did not become ready')
}

async function main() {
  const snapshot = JSON.parse(fs.readFileSync(path.resolve(snapshotPath), 'utf8'))
  const candidate = buildGenericExecutionCandidate(snapshot, { nowMs: Date.parse(snapshot.generatedAt) })
  const hardhat = path.join(root, 'node_modules', '.bin', 'hardhat')
  const diagnostics = []
  const child = spawn(
    hardhat,
    [
      'node',
      '--hostname',
      '127.0.0.1',
      '--port',
      String(rpcPort),
      '--chain-id',
      '4663',
      '--fork',
      forkSource,
      '--fork-block-number',
      candidate.quoteBlockNumber.toString(),
    ],
    { cwd: root, env: { ...process.env, NO_COLOR: '1' }, stdio: ['ignore', 'pipe', 'pipe'] },
  )
  child.stdout.on('data', (chunk) => diagnostics.push(chunk.toString()))
  child.stderr.on('data', (chunk) => diagnostics.push(chunk.toString()))

  try {
    await waitForRpc(child)
    const publicClient = createPublicClient({ chain, transport: http(rpcUrl, { timeout: 30_000 }) })
    const accounts = await publicClient.request({ method: 'eth_accounts' })
    const operator = getAddress(accounts[0])
    const walletClient = createWalletClient({ account: operator, chain, transport: http(rpcUrl, { timeout: 30_000 }) })
    const compiled = compileGenericContract()
    const seedEth = parseEther(process.env.MANGA_GENERIC_FORK_SEED_ETH || '0.01')
    const deployHash = await walletClient.deployContract({
      abi: compiled.abi,
      bytecode: compiled.bytecode,
      args: [operator, 1n],
      value: seedEth,
    })
    const deployReceipt = await publicClient.waitForTransactionReceipt({ hash: deployHash })
    if (deployReceipt.status !== 'success' || !deployReceipt.contractAddress) throw new Error('fork deployment failed')
    const executor = getAddress(deployReceipt.contractAddress)
    const seeded = await publicClient.readContract({
      address: USDG,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [executor],
    })
    if (seeded < candidate.amountIn) {
      throw new Error(
        `fork seed ${formatUnits(seeded, 6)} USDG is below selected ${formatUnits(candidate.amountIn, 6)}`,
      )
    }

    const block = await publicClient.getBlock()
    const args = [candidate.route, candidate.amountIn, 50_000n, block.timestamp + 300n]
    const simulation = await publicClient.simulateContract({
      account: operator,
      address: executor,
      abi: compiled.abi,
      functionName: 'execute',
      args,
    })
    const estimatedGas = await publicClient.estimateContractGas({
      account: operator,
      address: executor,
      abi: compiled.abi,
      functionName: 'execute',
      args,
    })
    const before = await publicClient.readContract({
      address: USDG,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [executor],
    })
    const executeHash = await walletClient.writeContract({
      account: operator,
      address: executor,
      abi: compiled.abi,
      functionName: 'execute',
      args,
      gas: (estimatedGas * 11_000n) / 10_000n + 5_000n,
    })
    const executeReceipt = await publicClient.waitForTransactionReceipt({ hash: executeHash })
    const after = await publicClient.readContract({
      address: USDG,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [executor],
    })
    const residuals = {}
    for (const [name, token] of Object.entries({
      entryToken: candidate.route.entryToken,
      targetToken: candidate.route.targetToken,
      exitToken: candidate.route.exitToken,
    })) {
      residuals[name] = await publicClient.readContract({
        address: token,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [executor],
      })
    }
    const allowances = {
      usdg: await publicClient.readContract({
        address: USDG,
        abi: ERC20_ABI,
        functionName: 'allowance',
        args: [executor, V3_ROUTER],
      }),
      exitToken: await publicClient.readContract({
        address: candidate.route.exitToken,
        abi: ERC20_ABI,
        functionName: 'allowance',
        args: [executor, V3_ROUTER],
      }),
    }
    if (executeReceipt.status !== 'success' || after - before !== simulation.result[1]) {
      throw new Error('fork receipt and exact USDG balance delta disagree')
    }
    if (Object.values(residuals).some((balance) => balance !== 0n)) {
      throw new Error('fork execution left an intermediate-token residual')
    }
    if (allowances.usdg !== 0n || allowances.exitToken !== 0n) {
      throw new Error('fork execution left a router allowance')
    }

    console.log(
      JSON.stringify(
        {
          status: 'GENERIC_MAINNET_FORK_TEST_PASSED',
          forkBlock: candidate.quoteBlockNumber.toString(),
          candidateHash: candidate.candidateHash,
          route: snapshot.selection.route,
          executor,
          deployment: {
            hash: deployHash,
            gasUsed: deployReceipt.gasUsed.toString(),
            seededUsdg: formatUnits(seeded, 6),
          },
          execution: {
            hash: executeHash,
            estimatedGas: estimatedGas.toString(),
            gasUsed: executeReceipt.gasUsed.toString(),
            amountInUsdg: formatUnits(candidate.amountIn, 6),
            amountOutUsdg: formatUnits(simulation.result[0], 6),
            grossProfitUsdg: formatUnits(after - before, 6),
          },
          residuals: Object.fromEntries(Object.entries(residuals).map(([name, balance]) => [name, balance.toString()])),
          allowances: { usdg: allowances.usdg.toString(), exitToken: allowances.exitToken.toString() },
          evidence: 'LOCAL_FORK_ONLY_NO_MAINNET_BROADCAST',
        },
        null,
        2,
      ),
    )
  } catch (error) {
    const tail = diagnostics.join('').split('\n').slice(-40).join('\n')
    throw new Error(`${error.stack || error}\nFork diagnostics:\n${tail}`)
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
