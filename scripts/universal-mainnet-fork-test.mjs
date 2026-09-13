import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  decodeErrorResult,
  defineChain,
  formatUnits,
  getAddress,
  http,
  parseAbi,
  parseUnits,
} from 'viem'

import { buildBptExecutionPlan, equalPremiumAllocations } from '../src/global-execution-plan.mjs'
import { buildEarnBptArbitrageTemplates, buildUnifiedLiquidityGraph } from '../src/global-liquidity-graph.mjs'
import { ROBINHOOD_USDG, ROBINHOOD_WETH } from '../src/robinhood-uniswap-catalog.mjs'
import { diagnosticErrorText } from '../src/policy.mjs'
import { loadRuntimeConfig } from '../src/config.mjs'
import { compileUniversalContract } from './universal-contract-compile.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const runtime = loadRuntimeConfig()
const FORK_SOURCE =
  process.env.MANGA_UNIVERSAL_FORK_SOURCE || runtime.rpcUrl || 'https://rpc.mainnet.chain.robinhood.com'
const RPC_PORT = Number(process.env.MANGA_UNIVERSAL_FORK_PORT || 18_552)
const RPC_URL = `http://127.0.0.1:${RPC_PORT}`
const DEFAULT_RUNTIME_DIR = runtime.runDir ? path.resolve(runtime.runDir) : path.join(ROOT, 'runs')
const FORK_CACHE_DIR = path.join(DEFAULT_RUNTIME_DIR, 'hardhat-fork-cache')
const CATALOG_PATH = path.resolve(
  process.env.MANGA_UNIVERSAL_FORK_CATALOG || path.join(DEFAULT_RUNTIME_DIR, 'global-catalog.json'),
)
const EARN_OMNIPOOL = getAddress('0x070F0Bcf458c2A836cF68c986df3BA86586e64FD')
const erc20Abi = parseAbi(['function decimals() view returns (uint8)'])
const chain = defineChain({
  id: 4_663,
  name: 'Robinhood Chain local universal fork',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
})

async function waitForRpc(child) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`fork node exited before readiness: ${child.exitCode}`)
    try {
      const response = await fetch(RPC_URL, {
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

function decodedExecutorError(error, abi) {
  const reverted =
    error instanceof BaseError ? error.walk((item) => item instanceof ContractFunctionRevertedError) : null
  const data = reverted instanceof ContractFunctionRevertedError ? reverted.raw : null
  if (!data) return { selector: null, errorName: null, args: [] }
  try {
    const decoded = decodeErrorResult({ abi, data })
    return { selector: data.slice(0, 10), errorName: decoded.errorName, args: decoded.args || [] }
  } catch {
    return { selector: data.slice(0, 10), errorName: null, args: [] }
  }
}

function quoteResult(error, abi) {
  const decoded = decodedExecutorError(error, abi)
  return decoded.errorName === 'QuoteResult' ? BigInt(decoded.args[0]) : null
}

async function diagnoseActionPrefixes({ publicClient, account, executor, abi, plan, principal }) {
  const prefixes = []
  for (let length = 1; length <= plan.actions.length; length += 1) {
    const prefixPlan = { ...plan, actions: plan.actions.slice(0, length) }
    try {
      await publicClient.simulateContract({
        account,
        address: executor,
        abi,
        functionName: 'quoteWithFlash',
        args: [prefixPlan, principal],
      })
      prefixes.push({ length, outcome: 'UNEXPECTED_RETURN' })
    } catch (error) {
      const decoded = decodedExecutorError(error, abi)
      prefixes.push({
        length,
        actionKind: prefixPlan.actions.at(-1).kind,
        outcome: decoded.errorName || decoded.selector || diagnosticErrorText(error).split('\n')[0],
      })
      if (decoded.errorName === 'InvalidSwapDelta') break
    }
  }
  return prefixes
}

function weightedAllocations(principal, pool) {
  const weights = pool.tokens.map((token) => BigInt(Math.round(Number(token.weight) * 1_000_000)))
  const total = weights.reduce((sum, weight) => sum + weight, 0n)
  if (total <= 0n) return equalPremiumAllocations(principal, pool.tokens.length)
  const allocations = weights.map((weight) => (principal * weight) / total)
  allocations[0] += principal - allocations.reduce((sum, amount) => sum + amount, 0n)
  return allocations.some((amount) => amount <= 0n)
    ? equalPremiumAllocations(principal, pool.tokens.length)
    : allocations
}

async function main() {
  if (!fs.existsSync(CATALOG_PATH)) throw new Error('refresh the canonical global catalog before the fork test')
  fs.mkdirSync(FORK_CACHE_DIR, { recursive: true, mode: 0o700 })
  fs.chmodSync(FORK_CACHE_DIR, 0o700)
  const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'))
  const hardhat = path.join(ROOT, 'node_modules', '.bin', 'hardhat')
  const diagnostics = []
  const child = spawn(
    hardhat,
    ['node', '--hostname', '127.0.0.1', '--port', String(RPC_PORT), '--chain-id', '4663', '--fork', FORK_SOURCE],
    {
      cwd: ROOT,
      env: { ...process.env, MANGA_HARDHAT_CACHE: FORK_CACHE_DIR, NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  child.stdout.on('data', (chunk) => diagnostics.push(chunk.toString()))
  child.stderr.on('data', (chunk) => diagnostics.push(chunk.toString()))

  try {
    await waitForRpc(child)
    const publicClient = createPublicClient({ chain, transport: http(RPC_URL, { timeout: 60_000 }) })
    const accounts = await publicClient.request({ method: 'eth_accounts' })
    const operator = getAddress(accounts[0])
    const walletClient = createWalletClient({ account: operator, chain, transport: http(RPC_URL, { timeout: 60_000 }) })
    const compiled = compileUniversalContract()
    const deployHash = await walletClient.deployContract({
      abi: compiled.abi,
      bytecode: compiled.bytecode,
      args: [operator],
    })
    const deployReceipt = await publicClient.waitForTransactionReceipt({ hash: deployHash })
    if (deployReceipt.status !== 'success' || !deployReceipt.contractAddress) throw new Error('fork deployment failed')
    const executor = getAddress(deployReceipt.contractAddress)
    const graph = buildUnifiedLiquidityGraph({
      earnPools: catalog.earn.pools,
      v2Pools: catalog.uniswap.v2Pools,
      v3Pools: catalog.uniswap.v3Pools,
      v4Pools: catalog.uniswap.v4Pools,
    })
    const block = await publicClient.getBlock()
    const results = []
    for (const settlementToken of [ROBINHOOD_USDG, ROBINHOOD_WETH]) {
      const decimals = Number(
        await publicClient.readContract({ address: settlementToken, abi: erc20Abi, functionName: 'decimals' }),
      )
      const principal = decimals === 18 ? parseUnits('0.001', decimals) : parseUnits('10', decimals)
      const templates = buildEarnBptArbitrageTemplates(graph, settlementToken).filter(
        (template) => template.pool.toLowerCase() === EARN_OMNIPOOL.toLowerCase(),
      )
      const pool = catalog.earn.pools.find((item) => item.address.toLowerCase() === EARN_OMNIPOOL.toLowerCase())
      for (const template of templates) {
        const plan = buildBptExecutionPlan(template, {
          principal,
          minimumProfit: 1n,
          deadline: block.timestamp + 300n,
          allocations: template.kind === 'BPT_PREMIUM_BUY_AND_ADD' ? weightedAllocations(principal, pool) : undefined,
        })
        let delta = null
        let failure = null
        try {
          await publicClient.simulateContract({
            account: operator,
            address: executor,
            abi: compiled.abi,
            functionName: 'quoteWithFlash',
            args: [plan, principal],
          })
          failure = 'quote unexpectedly returned without QuoteResult'
        } catch (error) {
          delta = quoteResult(error, compiled.abi)
          if (delta === null) {
            const decoded = decodedExecutorError(error, compiled.abi)
            failure = {
              selector: decoded.selector,
              errorName: decoded.errorName,
              actionPrefixes: await diagnoseActionPrefixes({
                publicClient,
                account: operator,
                executor,
                abi: compiled.abi,
                plan,
                principal,
              }),
            }
          }
        }
        results.push({
          settlementToken,
          decimals,
          templateId: template.id,
          kind: template.kind,
          principal: formatUnits(principal, decimals),
          quoteDeltaWei: delta?.toString() || null,
          failure,
          actionKinds: plan.actions.map((action) => action.kind),
        })
      }
    }
    if (results.length !== 4 || results.some((item) => item.failure !== null)) {
      throw new Error(`real-protocol universal quote coverage failed: ${JSON.stringify(results)}`)
    }
    const actionKinds = new Set(results.flatMap((item) => item.actionKinds))
    if (!actionKinds.has(2) || !actionKinds.has(4) || !actionKinds.has(5)) {
      throw new Error('fork plans did not exercise V4 and both Earn liquidity hyperedges')
    }
    console.log(
      JSON.stringify(
        {
          status: 'UNIVERSAL_MAINNET_FORK_TEST_PASSED',
          evidence: 'LOCAL_FORK_REAL_MORPHO_EARN_UNISWAP_STATE_NO_MAINNET_BROADCAST',
          forkBlock: block.number.toString(),
          executor,
          deploymentHash: deployHash,
          results,
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
  console.error(diagnosticErrorText(error))
  process.exitCode = 1
})
