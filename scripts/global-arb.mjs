import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createPublicClient,
  decodeErrorResult,
  decodeEventLog,
  defineChain,
  encodeDeployData,
  encodeFunctionData,
  encodePacked,
  formatEther,
  formatUnits,
  getAddress,
  http,
  keccak256,
  parseAbi,
  parseTransaction,
  parseUnits,
  recoverTransactionAddress,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

import { assertLiveTransport, loadRuntimeConfig } from '../src/config.mjs'
import { broadcastSameRawToSequencer } from '../src/direct-sequencer.mjs'
import { EventLifecycle } from '../src/event-lifecycle.mjs'
import {
  buildBptExecutionPlan,
  buildCycleExecutionPlan,
  equalPremiumAllocations,
} from '../src/global-execution-plan.mjs'
import {
  EvaluationOutcome,
  classifyEvaluationFailure,
  classifyQuoteOutcome,
  summarizeEvaluationOutcomes,
} from '../src/evaluation-outcome.mjs'
import {
  buildEarnBptArbitrageTemplates,
  buildUnifiedLiquidityGraph,
  enumerateAtomicSwapCycles,
  GLOBAL_ATOMIC_ROUTE_POLICY,
  GLOBAL_GRAPH_POLICY,
  GLOBAL_MAX_MANAGED_CANDIDATES_PER_WAKE,
  selectAffectedAtomicSwapCycles,
  selectBoundedManagedCandidates,
} from '../src/global-liquidity-graph.mjs'
import {
  applyGlobalEventRouteBudget,
  applyGlobalRecoveryRouteBudget,
  globalRouteAddresses,
  GLOBAL_ROUTE_WORKSET_POLICY,
  selectGlobalRouteWorkset,
} from '../src/global-route-selection.mjs'
import {
  assessSettlementFunding,
  enumerateV3ValuationRoutes,
  GLOBAL_MAX_SETTLEMENT_ASSETS_PER_WAKE,
  GLOBAL_MAX_SETTLEMENT_FUNDING_CHECKS_PER_WAKE,
  GLOBAL_SETTLEMENT_ADMISSION_POLICY,
  globalSettlementSeeds,
  rankDynamicSettlementCandidates,
  selectSettlementFundingCandidates,
} from '../src/global-settlement-assets.mjs'
import { loadEarnOnHoodOnchainCatalog } from '../src/earnonhood-onchain-catalog.mjs'
import { assertPrivateFile, buildMutationPlan, persistSignedRaw } from '../src/journal.mjs'
import { readSafetyAuditRecords } from '../src/incremental-jsonl-reader.mjs'
import {
  DailyHotRpcBudget,
  LogicalCallBudget,
  consumeNestedLogicalCallBudgets,
  jsonRpcCallCount,
} from '../src/hot-rpc-lane.mjs'
import {
  GLOBAL_EVENT_MAX_ROUTES_PER_WAKE,
  GLOBAL_FEED_MATCH_POLICY,
  GLOBAL_MANAGED_FALLBACK_EVENT_LOGICAL_CALL_CAP,
  GLOBAL_MANAGED_FALLBACK_RECOVERY_LOGICAL_CALL_CAP,
  globalWakeLifecycleIdentity,
  globalWakeSourceList,
} from '../src/global-wake-policy.mjs'
import {
  RpcErrorClass,
  classifyReconciliation,
  classifyRpcError,
  errorText,
  latestUnresolvedMutation,
} from '../src/policy.mjs'
import { publicFirstRpcTransport } from '../src/public-first-rpc.mjs'
import { RpcEvidence, instrumentRpcTransport, withRpcEvidence } from '../src/rpc-evidence.mjs'
import { classifyGlobalCatalogAccess } from '../src/resident-global-search.mjs'
import { loadRobinhoodHubUniswapCatalog, ROBINHOOD_USDG, ROBINHOOD_WETH } from '../src/robinhood-uniswap-catalog.mjs'
import {
  loadUniversalContractArtifact,
  materializeUniversalRuntime,
  verifyUniversalRuntimeEvidence,
} from '../src/universal-contract-artifact.mjs'

const CHAIN_ID = 4_663
const PUBLIC_RPC = 'https://rpc.mainnet.chain.robinhood.com'
const WALLET = getAddress('0x77f771E83f118C32547A1291dda438a757B4b91B')
const MORPHO = getAddress('0x9D53d5E3bd5E8d4Cbfa6DB1ca238AEA02E651010')
const V3_QUOTER = getAddress('0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7')
const DEADLINE_SECONDS = 45n
const V3_FEES = [100, 500, 3_000, 10_000]
// The official Robinhood Chain RPC accepts eight concurrent eth_call items,
// while larger call batches are rate-limited. Keep broad discovery inside the
// observed public boundary instead of spilling oversized batches into the
// authorization-bounded managed fallback.
const PUBLIC_DISCOVERY_BATCH_SIZE = 8

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const runtime = loadRuntimeConfig()
const SETTLEMENT_SEEDS = globalSettlementSeeds([ROBINHOOD_USDG, ROBINHOOD_WETH], runtime.globalExtraSettlementAssets)
const MINIMUM_NET_USDG = parseUnits(runtime.genericMinNetUsdg, 6)
const RPC_URL = runtime.rpcUrl || PUBLIC_RPC
const RUN_DIR = runtime.runDir ? path.resolve(runtime.runDir) : path.join(ROOT, 'runs')
const STATE_PATH = path.join(RUN_DIR, 'universal-state.json')
const AUDIT_PATH = path.join(RUN_DIR, 'audit.jsonl')
const GLOBAL_SNAPSHOT_PATH = path.join(RUN_DIR, 'global-opportunity.json')
const GLOBAL_CATALOG_PATH = path.join(RUN_DIR, 'global-catalog.json')
const GLOBAL_RPC_BUDGET_PATH = path.join(RUN_DIR, 'global-rpc-fallback-budget.json')
const SOURCE_CATALOG_PATH = path.join(RUN_DIR, 'source-catalog.json')
const SIGNED_DIR = path.join(RUN_DIR, 'signed')
const WALLET_LOCK_PATH = path.join(RUN_DIR, 'wallet.lock')
const DUAL_LOCK_PATH = path.join(RUN_DIR, 'dual-watch.lock')
const DUAL_ARM_PATH = path.join(RUN_DIR, 'dual-watch-arm.json')
const DUAL_REVOCATION_PATH = path.join(RUN_DIR, 'dual-watch-revocation.json')

const chain = defineChain({
  id: CHAIN_ID,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
})
let managedFallbackBudget = null
let managedFallbackWakeBudget = null
let residentGraphCache = null

function currentManagedFallbackBudget() {
  if (!managedFallbackBudget) {
    managedFallbackBudget = new DailyHotRpcBudget({
      dailyEventCandidateCap: 1,
      dailyLogicalCallCap: runtime.globalManagedFallbackDailyLogicalCallCap,
      persisted: readJson(GLOBAL_RPC_BUDGET_PATH),
      onChange: (state) => writeProtectedJson(GLOBAL_RPC_BUDGET_PATH, state),
    })
  }
  return managedFallbackBudget
}

function currentManagedFallbackWakeBudget() {
  if (!managedFallbackWakeBudget) {
    const eventWake = wakeAddressSet().size > 0
    managedFallbackWakeBudget = new LogicalCallBudget({
      logicalCallCap: eventWake
        ? GLOBAL_MANAGED_FALLBACK_EVENT_LOGICAL_CALL_CAP
        : GLOBAL_MANAGED_FALLBACK_RECOVERY_LOGICAL_CALL_CAP,
      label: eventWake ? 'EVENT_WAKE' : 'RECOVERY_WAKE',
    })
  }
  return managedFallbackWakeBudget
}

function consumeManagedFallbackBudget(body) {
  const count = jsonRpcCallCount(body)
  const debit = consumeNestedLogicalCallBudgets({
    perWakeBudget: currentManagedFallbackWakeBudget(),
    dailyBudget: currentManagedFallbackBudget(),
    count,
  })
  if (!debit.consumed) {
    throw new Error(
      debit.exhausted === 'PER_WAKE'
        ? 'managed RPC fallback per-wake logical-call budget exhausted'
        : 'managed RPC fallback daily logical-call budget exhausted',
    )
  }
}

const executionClient = createPublicClient({
  chain,
  transport: instrumentRpcTransport(http(RPC_URL, { timeout: 30_000, retryCount: 1 }), 'EXECUTION_CLIENT'),
})
const discoveryClient = createPublicClient({
  chain,
  transport: instrumentRpcTransport(
    publicFirstRpcTransport(PUBLIC_RPC, RPC_URL, {
      batchSize: PUBLIC_DISCOVERY_BATCH_SIZE,
      managedFetchFn: async (input, init) => {
        consumeManagedFallbackBudget(init?.body)
        return globalThis.fetch(input, init)
      },
    }),
    'DISCOVERY_CLIENT',
  ),
})
const erc20Abi = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
])
const v3QuoterAbi = [
  {
    type: 'function',
    name: 'quoteExactInput',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'path', type: 'bytes' },
      { name: 'amountIn', type: 'uint256' },
    ],
    outputs: [
      { name: 'amountOut', type: 'uint256' },
      { name: 'sqrtPriceX96AfterList', type: 'uint160[]' },
      { name: 'initializedTicksCrossedList', type: 'uint32[]' },
      { name: 'gasEstimate', type: 'uint256' },
    ],
  },
]

function stringify(value) {
  return JSON.stringify(value, (_, item) => (typeof item === 'bigint' ? item.toString() : item), 2)
}

function readJson(file) {
  if (!fs.existsSync(file)) return null
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function managedFallbackBudgetSnapshot() {
  return currentManagedFallbackBudget().snapshot()
}

function managedFallbackWakeBudgetSnapshot() {
  return currentManagedFallbackWakeBudget().snapshot()
}

function writeProtectedJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const temporary = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temporary, `${stringify(value)}\n`, { mode: 0o600 })
  fs.renameSync(temporary, file)
  fs.chmodSync(file, 0o600)
}

function appendAudit(event, details = {}) {
  fs.mkdirSync(RUN_DIR, { recursive: true, mode: 0o700 })
  fs.appendFileSync(
    AUDIT_PATH,
    `${JSON.stringify({ at: new Date().toISOString(), lane: 'global-v1', event, ...details }, (_, item) =>
      typeof item === 'bigint' ? item.toString() : item,
    )}\n`,
    { mode: 0o600 },
  )
}

function readAuditRecords() {
  return readSafetyAuditRecords(AUDIT_PATH)
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function lockHolder(file) {
  if (!fs.existsSync(file)) return { pid: null, alive: false }
  const pid = Number(fs.readFileSync(file, 'utf8').trim().split(/\s+/)[0])
  return { pid: Number.isSafeInteger(pid) ? pid : null, alive: processIsAlive(pid) }
}

function acquireLock(file, label) {
  fs.mkdirSync(RUN_DIR, { recursive: true, mode: 0o700 })
  let descriptor
  try {
    descriptor = fs.openSync(file, 'wx', 0o600)
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error
    const holder = lockHolder(file)
    if (holder.alive) throw new Error(`${label} lock is held by PID ${holder.pid}`)
    fs.unlinkSync(file)
    descriptor = fs.openSync(file, 'wx', 0o600)
  }
  fs.writeFileSync(descriptor, `${process.pid} ${new Date().toISOString()} ${label}\n`)
  return () => {
    try {
      fs.closeSync(descriptor)
    } catch {}
    try {
      fs.unlinkSync(file)
    } catch {}
  }
}

function loadAccount() {
  let privateKey
  if (runtime.privateKeyFile) {
    assertPrivateFile(runtime.privateKeyFile)
    privateKey = fs.readFileSync(runtime.privateKeyFile, 'utf8').trim()
  } else {
    if (process.platform !== 'darwin') throw new Error('Linux live commands require MANGA_PRIVATE_KEY_FILE')
    privateKey = execFileSync('/usr/bin/security', ['find-generic-password', '-w', '-s', runtime.keychainService], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  }
  if (!/^0x[0-9a-f]{64}$/i.test(privateKey)) throw new Error('signing credential is not a 32-byte EVM private key')
  const account = privateKeyToAccount(privateKey)
  privateKey = undefined
  if (account.address.toLowerCase() !== WALLET.toLowerCase()) throw new Error('signer address mismatch')
  return account
}

function parseQuoteError(error, abi) {
  const pending = [error]
  const seen = new Set()
  while (pending.length > 0) {
    const item = pending.shift()
    if (!item || seen.has(item)) continue
    if (typeof item === 'string' && /^0x[0-9a-f]{8,}$/i.test(item)) {
      try {
        const decoded = decodeErrorResult({ abi, data: item })
        if (decoded.errorName === 'QuoteResult') return BigInt(decoded.args[0])
      } catch {}
      continue
    }
    if (typeof item !== 'object') continue
    seen.add(item)
    for (const value of Object.values(item)) pending.push(value)
  }
  return null
}

function ceilDiv(numerator, denominator) {
  return (numerator + denominator - 1n) / denominator
}

async function mapWithConcurrency(items, concurrency, task) {
  const output = new Array(items.length)
  let cursor = 0
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      for (;;) {
        const index = cursor++
        if (index >= items.length) return
        output[index] = await task(items[index], index)
      }
    }),
  )
  return output
}

async function assertDeployment(compiled = loadUniversalContractArtifact()) {
  const state = readJson(STATE_PATH)
  if (
    state?.schemaVersion !== 1 ||
    state.chainId !== CHAIN_ID ||
    state.wallet?.toLowerCase() !== WALLET.toLowerCase() ||
    !state.executor ||
    state.sourceHash !== compiled.sourceHash ||
    state.creationCodeHash !== compiled.creationCodeHash
  ) {
    throw new Error('verified universal deployment state was not found')
  }
  const executor = getAddress(state.executor)
  const [code, operator, morpho] = await Promise.all([
    executionClient.getCode({ address: executor }),
    executionClient.readContract({ address: executor, abi: compiled.abi, functionName: 'operator' }),
    executionClient.readContract({ address: executor, abi: compiled.abi, functionName: 'MORPHO' }),
  ])
  if (!code || code === '0x' || keccak256(code) !== state.runtimeCodeHash) {
    throw new Error('universal executor bytecode differs from the deployment ledger')
  }
  if (operator.toLowerCase() !== WALLET.toLowerCase() || morpho.toLowerCase() !== MORPHO.toLowerCase()) {
    throw new Error('universal executor immutable protocol identity mismatch')
  }
  return { compiled, state, executor }
}

async function walletSnapshot() {
  const [block, gasPrice, balance, latestNonce, pendingNonce] = await Promise.all([
    executionClient.getBlock(),
    executionClient.getGasPrice(),
    executionClient.getBalance({ address: WALLET }),
    executionClient.getTransactionCount({ address: WALLET, blockTag: 'latest' }),
    executionClient.getTransactionCount({ address: WALLET, blockTag: 'pending' }),
  ])
  return { block, gasPrice, balance, latestNonce, pendingNonce }
}

function dynamicProbeAmounts(decimals, available) {
  if (decimals !== 6 && decimals !== 18) {
    const divisors = [1_000_000n, 100_000n, 10_000n, 1_000n, 100n, 10n, 2n, 1n]
    return [...new Set(divisors.map((divisor) => available / divisor).filter((amount) => amount > 0n))]
  }
  const minimum = decimals === 18 ? parseUnits('0.0001', 18) : 10n ** BigInt(decimals)
  if (available < minimum) return []
  const familiar =
    decimals === 18
      ? ['0.0001', '0.00025', '0.0005', '0.001', '0.0025', '0.005', '0.01', '0.025', '0.05', '0.1']
      : ['1', '5', '10', '25', '50', '100', '250', '500', '1000', '2500', '5000', '10000']
  const values = familiar.map((value) => parseUnits(value, decimals)).filter((amount) => amount <= available)
  let cursor = values.at(-1) || minimum
  while (cursor < available && values.length < 15) {
    cursor *= 10n
    values.push(cursor < available ? cursor : available)
  }
  if (!values.includes(available)) values.push(available)
  return [...new Set(values)].slice(0, 16)
}

function coarseProbeAmounts(decimals, available) {
  const values = dynamicProbeAmounts(decimals, available)
  if (values.length <= 8) return values
  const indexes = [0, 1, 3, 5, 7, values.length - 3, values.length - 2, values.length - 1]
  return [...new Set(indexes.map((index) => values[Math.max(0, index)]))]
}

function refinementProbeAmounts(coarse, best, available) {
  const ordered = [...coarse].sort((left, right) => (left < right ? -1 : 1))
  const index = ordered.findIndex((amount) => amount === best)
  const candidates = [
    best / 2n,
    (best * 3n) / 4n,
    (best * 5n) / 4n,
    (best * 3n) / 2n,
    index > 0 ? (ordered[index - 1] + best) / 2n : 0n,
    index >= 0 && index < ordered.length - 1 ? (best + ordered[index + 1]) / 2n : available,
  ]
  const existing = new Set(ordered.map(String))
  return [...new Set(candidates.filter((amount) => amount > 0n && amount <= available).map(String))]
    .filter((amount) => !existing.has(amount))
    .map(BigInt)
}

function settlementLabel(token) {
  if (token.toLowerCase() === ROBINHOOD_USDG.toLowerCase()) return 'USDG'
  if (token.toLowerCase() === ROBINHOOD_WETH.toLowerCase()) return 'WETH'
  return `TOKEN_${token.slice(2, 8).toUpperCase()}`
}

function weightedAllocations(principal, pool) {
  const weights = pool.tokens.map((token) => BigInt(Math.round(Number(token.weight) * 1_000_000)))
  const total = weights.reduce((sum, weight) => sum + weight, 0n)
  if (total <= 0n) return equalPremiumAllocations(principal, pool.tokens.length)
  const allocations = weights.map((weight) => (principal * weight) / total)
  const allocated = allocations.reduce((sum, amount) => sum + amount, 0n)
  allocations[0] += principal - allocated
  if (allocations.some((amount) => amount <= 0n)) return equalPremiumAllocations(principal, pool.tokens.length)
  return allocations
}

async function refreshGlobalCatalog(blockNumber) {
  const earn = await loadEarnOnHoodOnchainCatalog(discoveryClient, blockNumber)
  const earnAssets = earn.pools.flatMap((pool) => [pool.address, ...pool.tokens.map((token) => token.address)])
  const sourceCatalog = readJson(SOURCE_CATALOG_PATH)
  const uniswap = await loadRobinhoodHubUniswapCatalog(discoveryClient, earnAssets, blockNumber, {
    hubs: SETTLEMENT_SEEDS,
    additionalV4Pools: Array.isArray(sourceCatalog?.pools) ? sourceCatalog.pools : [],
  })
  const generatedAt = new Date().toISOString()
  writeProtectedJson(GLOBAL_CATALOG_PATH, {
    schemaVersion: 1,
    generatedAt,
    blockNumber: BigInt(blockNumber).toString(),
    earn: { ...earn, rejected: earn.rejected.slice(0, 128) },
    uniswap: { ...uniswap, rejected: uniswap.rejected.slice(0, 128) },
  })
  return { earn, uniswap, generatedAt }
}

async function loadGlobalGraph(blockNumber) {
  const cached = readJson(GLOBAL_CATALOG_PATH)
  const catalogAccess = classifyGlobalCatalogAccess(cached, {
    readOnly: process.env.GLOBAL_SEARCH_READONLY_CATALOG === '1',
  })
  if (catalogAccess === 'UNAVAILABLE') {
    const error = new Error('resident global search catalog is missing or stale; legacy refresh required')
    error.rpcClass = RpcErrorClass.STATE_NOT_READY
    throw error
  }
  const source = catalogAccess === 'CACHE' ? cached : await refreshGlobalCatalog(blockNumber)
  const { earn, uniswap } = source
  const catalogIdentity = `${source.generatedAt || 'UNKNOWN'}:${source.blockNumber || earn.blockNumber || 'UNKNOWN'}:${uniswap.blockNumber || 'UNKNOWN'}`
  if (residentGraphCache?.catalogIdentity === catalogIdentity) return residentGraphCache.value
  const graph = buildUnifiedLiquidityGraph({
    earnPools: earn.pools,
    v2Pools: uniswap.v2Pools,
    v3Pools: uniswap.v3Pools,
    v4Pools: uniswap.v4Pools,
  })
  const value = { earn, uniswap, graph }
  residentGraphCache = { catalogIdentity, value }
  return value
}

async function catalogRefresh() {
  const block = await discoveryClient.getBlock()
  const { earn, uniswap } = await refreshGlobalCatalog(block.number)
  const output = {
    status: 'GLOBAL_CATALOG_REFRESHED',
    evidence: 'CANONICAL_EARN_FACTORY_VAULT_AND_UNISWAP_FACTORY_READS',
    blockNumber: block.number,
    earnPools: earn.pools.length,
    v2Pools: uniswap.v2Pools.length,
    v3Pools: uniswap.v3Pools.length,
    v4Pools: uniswap.v4Pools.length,
    coverage: uniswap.coverage,
  }
  console.log(stringify(output))
  return output
}

function executionFunctionName(fundingMode) {
  if (fundingMode === 'MORPHO_FLASH') return 'executeWithFlash'
  if (fundingMode === 'EXECUTOR_INVENTORY') return 'executeWithInventory'
  throw new Error(`unsupported global funding mode ${fundingMode}`)
}

async function quotePlan(client, executor, abi, plan, principal, blockNumber, fundingMode = 'MORPHO_FLASH') {
  if (fundingMode === 'EXECUTOR_INVENTORY') {
    try {
      const simulation = await client.simulateContract({
        account: WALLET,
        address: executor,
        abi,
        functionName: 'executeWithInventory',
        args: [plan, principal],
        blockNumber,
      })
      return classifyQuoteOutcome({ result: BigInt(simulation.result) })
    } catch (error) {
      return classifyQuoteOutcome({ error })
    }
  }
  try {
    await client.simulateContract({
      account: WALLET,
      address: executor,
      abi,
      functionName: 'quoteWithFlash',
      args: [plan, principal],
      blockNumber,
    })
  } catch (error) {
    const result = parseQuoteError(error, abi)
    if (result !== null) return classifyQuoteOutcome({ result })
    return classifyQuoteOutcome({ error })
  }
  return classifyQuoteOutcome({ error: new Error('quote did not return the mandatory QuoteResult revert') })
}

async function bestV3Quote(tokenIn, tokenOut, amountIn, blockNumber, client = executionClient, graph = null) {
  if (tokenIn.toLowerCase() === tokenOut.toLowerCase()) return amountIn
  const routes = graph ? enumerateV3ValuationRoutes(graph, tokenIn, tokenOut, ROBINHOOD_WETH) : []
  const paths = routes.map((route) => {
    const types = []
    const values = []
    for (let index = 0; index < route.tokens.length; index += 1) {
      types.push('address')
      values.push(route.tokens[index])
      if (index < route.fees.length) {
        types.push('uint24')
        values.push(route.fees[index])
      }
    }
    return encodePacked(types, values)
  })
  // Historical receipt reconciliation may not retain the discovery graph.
  // That non-latency-critical readback keeps the canonical bounded fallback;
  // admission and pre-sign exact evaluation always supply the fixed-block graph.
  if (!graph) {
    for (const fee of V3_FEES) {
      paths.push(encodePacked(['address', 'uint24', 'address'], [tokenIn, fee, tokenOut]))
    }
    if (
      tokenIn.toLowerCase() !== ROBINHOOD_WETH.toLowerCase() &&
      tokenOut.toLowerCase() !== ROBINHOOD_WETH.toLowerCase()
    ) {
      const firstFees = tokenIn.toLowerCase() === ROBINHOOD_USDG.toLowerCase() ? [100] : V3_FEES
      const secondFees = tokenOut.toLowerCase() === ROBINHOOD_USDG.toLowerCase() ? [100] : V3_FEES
      for (const firstFee of firstFees) {
        for (const secondFee of secondFees) {
          paths.push(
            encodePacked(
              ['address', 'uint24', 'address', 'uint24', 'address'],
              [tokenIn, firstFee, ROBINHOOD_WETH, secondFee, tokenOut],
            ),
          )
        }
      }
    }
  }
  if (paths.length === 0) throw new Error('no graph-verified V3 valuation path for settlement asset')
  const quotes = await Promise.all(
    paths.map(async (pathValue) => {
      try {
        const { result } = await client.simulateContract({
          account: WALLET,
          address: V3_QUOTER,
          abi: v3QuoterAbi,
          functionName: 'quoteExactInput',
          args: [pathValue, amountIn],
          blockNumber,
        })
        return classifyQuoteOutcome({ result: BigInt(result[0]) })
      } catch (error) {
        return classifyQuoteOutcome({ error })
      }
    }),
  )
  const usable = quotes.map((quote) => quote.result).filter((amount) => amount !== null && amount > 0n)
  if (usable.length === 0) {
    const evidence = summarizeEvaluationOutcomes(quotes)
    const rpcClass =
      evidence.decisionClassification === EvaluationOutcome.STATE_UNAVAILABLE
        ? RpcErrorClass.STATE_NOT_READY
        : evidence.decisionClassification === EvaluationOutcome.RPC_ERROR
          ? RpcErrorClass.NETWORK
          : RpcErrorClass.INVARIANT
    throw Object.assign(new Error(`no usable canonical V3 valuation quote: ${evidence.decisionClassification}`), {
      evaluationOutcome: evidence.decisionClassification,
      rpcClass,
    })
  }
  return usable.reduce((best, amount) => (amount > best ? amount : best), 0n)
}

async function gasInSettlement(settlementToken, gasWei, blockNumber, graph) {
  return bestV3Quote(ROBINHOOD_WETH, settlementToken, gasWei, blockNumber, executionClient, graph)
}

async function normalizedUsdg(settlementToken, amount, blockNumber, graph) {
  return bestV3Quote(settlementToken, ROBINHOOD_USDG, amount, blockNumber, executionClient, graph)
}

function wakeAddressSet() {
  return new Set(
    String(process.env.GLOBAL_WAKE_ROUTE_ADDRESSES || '')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter((value) => /^0x[0-9a-f]{40}$/i.test(value)),
  )
}

async function discoverDynamicSettlementAssets({ client, graph, deployment, block }) {
  const eventWake = wakeAddressSet().size > 0
  const universe = rankDynamicSettlementCandidates(graph, {
    seeds: SETTLEMENT_SEEDS,
    wakeAddresses: [...wakeAddressSet()],
    maximum: GLOBAL_MAX_SETTLEMENT_FUNDING_CHECKS_PER_WAKE,
    rotationOffset: block.number,
  })
  const fundingWorkset = selectSettlementFundingCandidates(universe, { eventWake })
  const fundingCandidates = fundingWorkset.candidates
  const hasValuationPath = (tokenIn, tokenOut) =>
    tokenIn.toLowerCase() === tokenOut.toLowerCase() ||
    enumerateV3ValuationRoutes(graph, tokenIn, tokenOut, ROBINHOOD_WETH).length > 0
  const graphRejected = fundingCandidates
    .filter(
      (candidate) =>
        !hasValuationPath(ROBINHOOD_WETH, candidate.token) || !hasValuationPath(candidate.token, ROBINHOOD_USDG),
    )
    .map((candidate) => ({
      ...candidate,
      rejected: true,
      outcome: EvaluationOutcome.UNSUPPORTED,
      stage: 'SETTLEMENT_GRAPH',
      reason: 'no graph-verified WETH and USDG valuation path',
    }))
  const valuationCandidates = fundingCandidates.filter(
    (candidate) =>
      hasValuationPath(ROBINHOOD_WETH, candidate.token) && hasValuationPath(candidate.token, ROBINHOOD_USDG),
  )
  const checked = await mapWithConcurrency(valuationCandidates, PUBLIC_DISCOVERY_BATCH_SIZE, async (candidate) => {
    try {
      const [decimals, morphoLiquidity, inventory] = await Promise.all([
        client.readContract({
          address: candidate.token,
          abi: erc20Abi,
          functionName: 'decimals',
          blockNumber: block.number,
        }),
        client.readContract({
          address: candidate.token,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [MORPHO],
          blockNumber: block.number,
        }),
        client.readContract({
          address: candidate.token,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [deployment.executor],
          blockNumber: block.number,
        }),
      ])
      return assessSettlementFunding(candidate, { decimals, morphoLiquidity, inventory })
    } catch (error) {
      return {
        ...candidate,
        rejected: true,
        outcome: classifyEvaluationFailure(error),
        stage: 'SETTLEMENT_FUNDING',
        rpcClass: classifyRpcError(error),
        reason: errorText(error).slice(0, 200),
      }
    }
  })

  const admitted = []
  const rejected = [...graphRejected, ...checked.filter((candidate) => candidate.rejected)]
  const valuationProbeWethWei = 100_000_000_000_000n
  for (const candidate of checked.filter((item) => !item.rejected)) {
    if (admitted.length >= GLOBAL_MAX_SETTLEMENT_ASSETS_PER_WAKE) break
    try {
      const settlementProbe = await bestV3Quote(
        ROBINHOOD_WETH,
        candidate.token,
        valuationProbeWethWei,
        block.number,
        client,
        graph,
      )
      const normalizedProbe = await bestV3Quote(
        candidate.token,
        ROBINHOOD_USDG,
        settlementProbe,
        block.number,
        client,
        graph,
      )
      if (settlementProbe <= 0n || normalizedProbe <= 0n) throw new Error('valuation quote is non-positive')
      admitted.push({
        ...candidate,
        valuationEvidence: 'FIXED_BLOCK_EXECUTABLE_V3_WETH_TO_SETTLEMENT_TO_USDG',
        valuationProbeWethWei,
        valuationSettlementOutRaw: settlementProbe,
        valuationUsdgOutWei: normalizedProbe,
      })
    } catch (error) {
      rejected.push({
        ...candidate,
        rejected: true,
        outcome: classifyEvaluationFailure(error),
        stage: 'SETTLEMENT_VALUATION',
        rpcClass: classifyRpcError(error),
        reason: errorText(error).slice(0, 200),
      })
    }
  }
  return {
    ...universe,
    policy: GLOBAL_SETTLEMENT_ADMISSION_POLICY,
    candidates: valuationCandidates,
    admitted,
    rejected,
    admittedCount: admitted.length,
    fundedCount: checked.filter((candidate) => !candidate.rejected).length,
    selectedForFunding: fundingCandidates.length,
    valuationEligibleForFunding: valuationCandidates.length,
    admissionScope: fundingWorkset.admissionScope,
    deferred: fundingWorkset.deferred,
    maximumAdmitted: GLOBAL_MAX_SETTLEMENT_ASSETS_PER_WAKE,
    evidence: 'GRAPH_STRUCTURE_PLUS_FIXED_BLOCK_FUNDING_AND_EXECUTABLE_VALUATION',
  }
}

function selectRouteDefinitions(graph, settlementToken, blockNumber) {
  const bpt = buildEarnBptArbitrageTemplates(graph, settlementToken).map((template) => ({
    type: 'BPT',
    id: template.id,
    opportunityKind: template.kind,
    settlementToken,
    pool: template.pool,
    template,
    edges:
      template.kind === 'BPT_DISCOUNT_REMOVE_AND_SELL'
        ? [...template.buyBpt, ...template.sellComponents.flat()]
        : [...template.buyComponents.flat(), ...template.sellBpt],
  }))
  let maximumCycleHops = 4
  const eventWakeAddressSet = wakeAddressSet()
  const eventWakeAddresses = [...eventWakeAddressSet]
  let cycleSelection
  const selectCycles = () => {
    if (eventWakeAddresses.length > 0) {
      return selectAffectedAtomicSwapCycles(graph, settlementToken, {
        wakeAddresses: eventWakeAddresses,
        maximumHops: maximumCycleHops,
        maximumCycles: 20_000,
        maximumSelected: GLOBAL_EVENT_MAX_ROUTES_PER_WAKE,
      })
    }
    const cycles = enumerateAtomicSwapCycles(graph, settlementToken, {
      maximumHops: maximumCycleHops,
      maximumCycles: 20_000,
    })
    return {
      cycles,
      selected: cycles.map((cycle) => ({
        cycle,
        opportunityKind: `${new Set(cycle.edges.map((edge) => edge.venue)).size === 1 ? 'SAME_VENUE' : 'CROSS_VENUE'}_${cycle.edges.length}_HOP_ATOMIC_SWAP_CYCLE`,
      })),
      totalCycles: cycles.length,
      touchedCycles: 0,
      visitedEdges: null,
      coverage: 'COMPLETE_MATERIALIZED_RECOVERY_TRAVERSAL',
    }
  }
  try {
    cycleSelection = selectCycles()
  } catch (error) {
    if (!/cycle enumeration bound exceeded/i.test(errorText(error))) throw error
    maximumCycleHops = 3
    cycleSelection = selectCycles()
  }
  const swaps = cycleSelection.selected.map(({ cycle, opportunityKind }) => ({
    type: 'CYCLE',
    id: cycle.id,
    opportunityKind,
    settlementToken,
    pool: null,
    cycle,
    edges: cycle.edges,
  }))
  const all = [...bpt, ...swaps]
  const selected = selectGlobalRouteWorkset({
    routes: all,
    wakeAddresses: [...wakeAddressSet()],
    blockNumber,
    maximumRoutesPerWake: runtime.globalMaxRoutesPerWake,
    maximumEventRoutesPerWake: GLOBAL_EVENT_MAX_ROUTES_PER_WAKE,
  })
  return {
    ...selected,
    totalRoutes: bpt.length + cycleSelection.totalCycles,
    touchedRoutes:
      eventWakeAddresses.length > 0
        ? bpt.filter((route) =>
            [...globalRouteAddresses(route)].some((address) => eventWakeAddressSet.has(address.toLowerCase())),
          ).length + cycleSelection.touchedCycles
        : selected.touchedRoutes,
    bptRoutes: bpt.length,
    cycleRoutes: cycleSelection.totalCycles,
    maximumCycleHops,
    traversal: {
      coverage: cycleSelection.coverage,
      visitedEdges: cycleSelection.visitedEdges,
      retainedCycleRoutes: swaps.length,
    },
  }
}

async function discoverExactCandidates({ client = discoveryClient, deployment, block, lifecycle, rpcEvidence }) {
  const { earn, uniswap, graph } = await withRpcEvidence(rpcEvidence, 'CATALOG_GRAPH', () =>
    loadGlobalGraph(block.number),
  )
  lifecycle.setVersions({
    catalogVersion: `EARN:${earn.blockNumber || 'UNKNOWN'}|UNISWAP:${uniswap.blockNumber || 'UNKNOWN'}`,
    graphVersion: graph.commitment,
  })
  lifecycle.mark('CATALOG_GRAPH_READY', {
    assetCount: graph.assets.size,
    edgeCount: graph.edges.length,
    hyperedgeCount: graph.hyperedges.length,
  })
  const evaluations = []
  const routeCoverage = []
  const settlementAdmission = await withRpcEvidence(rpcEvidence, 'SETTLEMENT_ADMISSION', () =>
    discoverDynamicSettlementAssets({ client, graph, deployment, block }),
  )
  lifecycle.mark('SETTLEMENT_ASSETS_ADMITTED', {
    candidateCount: settlementAdmission.candidates.length,
    admittedCount: settlementAdmission.admittedCount,
    rejectedCount: settlementAdmission.rejected.length,
  })
  const unboundedWorksets = settlementAdmission.admitted.map(({ token }) =>
    selectRouteDefinitions(graph, token, block.number),
  )
  const routeWorksets =
    wakeAddressSet().size > 0
      ? applyGlobalEventRouteBudget(unboundedWorksets, GLOBAL_EVENT_MAX_ROUTES_PER_WAKE)
      : applyGlobalRecoveryRouteBudget(unboundedWorksets, runtime.globalMaxRoutesPerWake)
  lifecycle.mark('ROUTES_SELECTED', {
    routeCount: routeWorksets.reduce((total, workset) => total + workset.routes.length, 0),
    dependencyCount: wakeAddressSet().size,
  })
  for (const [settlementIndex, profile] of settlementAdmission.admitted.entries()) {
    const settlementToken = profile.token
    const { decimals, morphoLiquidity, inventory } = profile
    const selectedRoutes = routeWorksets[settlementIndex]
    routeCoverage.push({
      settlementToken,
      ...selectedRoutes,
      routes: undefined,
      selectedRoutes: selectedRoutes.routes.length,
      morphoLiquidity,
      inventory,
    })
    const fundingSources = [
      { fundingMode: 'MORPHO_FLASH', available: morphoLiquidity },
      { fundingMode: 'EXECUTOR_INVENTORY', available: inventory },
    ].filter((source) => source.available > 0n)
    const jobs = []
    for (const route of selectedRoutes.routes) {
      const pool = route.pool
        ? earn.pools.find((item) => item.address.toLowerCase() === route.pool.toLowerCase())
        : null
      for (const source of fundingSources) {
        const amounts = coarseProbeAmounts(decimals, source.available)
        for (const principal of amounts) {
          let plan
          try {
            plan =
              route.type === 'BPT'
                ? buildBptExecutionPlan(route.template, {
                    principal,
                    minimumProfit: 1n,
                    deadline: block.timestamp + DEADLINE_SECONDS,
                    allocations:
                      route.opportunityKind === 'BPT_PREMIUM_BUY_AND_ADD'
                        ? weightedAllocations(principal, pool)
                        : undefined,
                  })
                : buildCycleExecutionPlan(route.cycle, {
                    principal,
                    minimumProfit: 1n,
                    deadline: block.timestamp + DEADLINE_SECONDS,
                  })
          } catch (error) {
            evaluations.push({
              templateId: route.id,
              opportunityKind: route.opportunityKind,
              fundingMode: source.fundingMode,
              principal,
              status: 'PLAN_REJECTED',
              outcome: classifyEvaluationFailure(error),
              stage: 'PLAN',
              reason: errorText(error),
            })
            continue
          }
          jobs.push({ route, source, principal, plan })
        }
      }
    }
    const quoted = await mapWithConcurrency(jobs, runtime.globalQuoteConcurrency, async (job) => {
      const quote = await withRpcEvidence(rpcEvidence, 'COARSE_QUOTE', () =>
        quotePlan(
          client,
          deployment.executor,
          deployment.compiled.abi,
          job.plan,
          job.principal,
          block.number,
          job.source.fundingMode,
        ),
      )
      return {
        route: job.route,
        templateId: job.route.id,
        opportunityKind: job.route.opportunityKind,
        pool: job.route.pool,
        settlementToken,
        decimals,
        principal: job.principal,
        fundingMode: job.source.fundingMode,
        fundingAvailable: job.source.available,
        plan: job.plan,
        quoteDelta: quote.result,
        status: quote.outcome === EvaluationOutcome.PROFITABLE ? 'GROSS_POSITIVE' : quote.outcome,
        outcome: quote.outcome,
        stage: 'COARSE_QUOTE',
        rpcClass: quote.rpcClass,
        reason: quote.reason,
      }
    })
    evaluations.push(...quoted)
    const positiveGroups = new Map()
    for (const item of quoted.filter((candidate) => candidate.status === 'GROSS_POSITIVE')) {
      const groupKey = `${item.templateId}:${item.fundingMode}`
      const before = positiveGroups.get(groupKey)
      if (!before || item.quoteDelta > before.quoteDelta) positiveGroups.set(groupKey, item)
    }
    const refinementJobs = []
    for (const best of positiveGroups.values()) {
      const coarse = coarseProbeAmounts(best.decimals, best.fundingAvailable)
      for (const principal of refinementProbeAmounts(coarse, best.principal, best.fundingAvailable)) {
        const pool = best.pool
          ? earn.pools.find((item) => item.address.toLowerCase() === best.pool.toLowerCase())
          : null
        let plan
        try {
          plan =
            best.route.type === 'BPT'
              ? buildBptExecutionPlan(best.route.template, {
                  principal,
                  minimumProfit: 1n,
                  deadline: block.timestamp + DEADLINE_SECONDS,
                  allocations:
                    best.opportunityKind === 'BPT_PREMIUM_BUY_AND_ADD'
                      ? weightedAllocations(principal, pool)
                      : undefined,
                })
              : buildCycleExecutionPlan(best.route.cycle, {
                  principal,
                  minimumProfit: 1n,
                  deadline: block.timestamp + DEADLINE_SECONDS,
                })
        } catch (error) {
          evaluations.push({
            templateId: best.templateId,
            opportunityKind: best.opportunityKind,
            fundingMode: best.fundingMode,
            principal,
            status: 'PLAN_REJECTED',
            outcome: classifyEvaluationFailure(error),
            stage: 'REFINEMENT_PLAN',
            reason: errorText(error),
          })
          continue
        }
        refinementJobs.push({ ...best, principal, plan })
      }
    }
    const refined = await mapWithConcurrency(refinementJobs, runtime.globalQuoteConcurrency, async (job) => {
      const quote = await withRpcEvidence(rpcEvidence, 'REFINED_QUOTE', () =>
        quotePlan(
          client,
          deployment.executor,
          deployment.compiled.abi,
          job.plan,
          job.principal,
          block.number,
          job.fundingMode,
        ),
      )
      return {
        ...job,
        quoteDelta: quote.result,
        status: quote.outcome === EvaluationOutcome.PROFITABLE ? 'GROSS_POSITIVE' : quote.outcome,
        outcome: quote.outcome,
        stage: 'REFINED_QUOTE',
        rpcClass: quote.rpcClass,
        reason: quote.reason,
        sizingStage: 'REFINED',
      }
    })
    evaluations.push(...refined)
  }
  lifecycle.mark('DISCOVERY_QUOTES_COMPLETE', {
    evaluatedCount: evaluations.length,
    grossPositiveCount: evaluations.filter((item) => item.status === 'GROSS_POSITIVE').length,
  })
  return { earn, uniswap, graph, evaluations, routeCoverage, settlementAdmission }
}

async function exactNetEvaluation(candidate, deployment, block, gasPrice, graph) {
  const functionName = executionFunctionName(candidate.fundingMode)
  const initialGas = await executionClient.estimateContractGas({
    account: WALLET,
    address: deployment.executor,
    abi: deployment.compiled.abi,
    functionName,
    args: [candidate.plan, candidate.principal],
    blockNumber: block.number,
  })
  const gasLimit = ceilDiv(initialGas * 12n, 10n) + 20_000n
  const maxFeePerGas = ceilDiv(gasPrice * 105n, 100n)
  const maximumGasWei = gasLimit * maxFeePerGas
  const gasSettlement = await gasInSettlement(candidate.settlementToken, maximumGasWei, block.number, graph)
  const minimumNet = await bestV3Quote(
    ROBINHOOD_USDG,
    candidate.settlementToken,
    MINIMUM_NET_USDG,
    block.number,
    executionClient,
    graph,
  )
  const requiredGross = gasSettlement + minimumNet
  if (candidate.quoteDelta < requiredGross) throw new Error('gross quote does not fund worst-case Gas plus net floor')
  const plan = { ...candidate.plan, minimumProfit: requiredGross }
  await executionClient.simulateContract({
    account: WALLET,
    address: deployment.executor,
    abi: deployment.compiled.abi,
    functionName,
    args: [plan, candidate.principal],
    blockNumber: block.number,
  })
  const estimatedGas = await executionClient.estimateContractGas({
    account: WALLET,
    address: deployment.executor,
    abi: deployment.compiled.abi,
    functionName,
    args: [plan, candidate.principal],
    blockNumber: block.number,
  })
  if (estimatedGas > gasLimit) throw new Error('protected gas limit is below the final exact estimate')
  const netSettlement = candidate.quoteDelta - gasSettlement
  return {
    ...candidate,
    plan,
    initialGas,
    estimatedGas,
    gasLimit,
    maxFeePerGas,
    maximumGasWei,
    gasSettlement,
    minimumNet,
    requiredGross,
    netSettlement,
    normalizedNetUsdg: await normalizedUsdg(candidate.settlementToken, netSettlement, block.number, graph),
    functionName,
  }
}

export function resetGlobalPreflightWakeState() {
  managedFallbackWakeBudget = null
}

export async function globalPreflight({ print = true, persist = true } = {}) {
  const preflightStartedAtMs = Date.now()
  const preflightStartedAt = new Date(preflightStartedAtMs).toISOString()
  const routeDependencies = wakeAddressSet()
  const feedSequenceNumber = /^\d+$/.test(String(process.env.GLOBAL_WAKE_SEQUENCE_NUMBER || ''))
    ? process.env.GLOBAL_WAKE_SEQUENCE_NUMBER
    : null
  const feedLastSequenceNumber = /^\d+$/.test(String(process.env.GLOBAL_WAKE_LAST_SEQUENCE_NUMBER || ''))
    ? process.env.GLOBAL_WAKE_LAST_SEQUENCE_NUMBER
    : feedSequenceNumber
  const wakeIdentity = globalWakeLifecycleIdentity({
    feedSequenceNumber,
    feedLastSequenceNumber,
    routeDependencyCount: routeDependencies.size,
    configuredWakeSource: process.env.GLOBAL_WAKE_SOURCE,
    claimedAt: process.env.GLOBAL_WAKE_CLAIMED_AT,
    preflightStartedAt,
  })
  const { eventId, source: lifecycleSource } = wakeIdentity
  const lifecycleSources = globalWakeSourceList(process.env.GLOBAL_WAKE_SOURCES, lifecycleSource)
  const lifecycle = new EventLifecycle({
    eventId,
    source: lifecycleSource,
    observedAt: process.env.GLOBAL_WAKE_RECEIVED_AT || null,
    enqueuedAt: process.env.GLOBAL_WAKE_ENQUEUED_AT || null,
    dequeuedAt: process.env.GLOBAL_WAKE_CLAIMED_AT || null,
    firstSequenceNumber: wakeIdentity.firstSequenceNumber,
    lastSequenceNumber: wakeIdentity.lastSequenceNumber,
  })
  const rpcEvidence = new RpcEvidence()
  try {
    lifecycle.mark('PREFLIGHT_STARTED', {}, preflightStartedAtMs)
    const deployment = await withRpcEvidence(rpcEvidence, 'DEPLOYMENT_VERIFY', () => assertDeployment())
    const block = await withRpcEvidence(rpcEvidence, 'STATE_HEAD', () => discoveryClient.getBlock())
    lifecycle.pinState(block).mark('STATE_PINNED', { blockNumber: block.number, hasBlockHash: Boolean(block.hash) })
    const discovery = await discoverExactCandidates({ deployment, block, lifecycle, rpcEvidence })
    const grossPositive = discovery.evaluations.filter((item) => item.status === 'GROSS_POSITIVE')
    const managedCandidates = selectBoundedManagedCandidates(grossPositive)
    const exact = []
    const exactEvaluations = []
    for (const candidate of managedCandidates) {
      try {
        const latestBlock = await withRpcEvidence(rpcEvidence, 'EXACT_STATE_HEAD', () => executionClient.getBlock())
        const latestPlan = { ...candidate.plan, deadline: latestBlock.timestamp + DEADLINE_SECONDS }
        const latestQuote = await withRpcEvidence(rpcEvidence, 'EXACT_QUOTE', () =>
          quotePlan(
            executionClient,
            deployment.executor,
            deployment.compiled.abi,
            latestPlan,
            candidate.principal,
            latestBlock.number,
            candidate.fundingMode,
          ),
        )
        if (latestQuote.outcome !== EvaluationOutcome.PROFITABLE) {
          exactEvaluations.push({
            templateId: candidate.templateId,
            fundingMode: candidate.fundingMode,
            outcome: latestQuote.outcome,
            stage: 'LATEST_QUOTE',
            rpcClass: latestQuote.rpcClass,
            reason: latestQuote.reason,
          })
          continue
        }
        const evaluated = await withRpcEvidence(rpcEvidence, 'EXACT_SIMULATION', async () =>
          exactNetEvaluation(
            { ...candidate, plan: latestPlan, quoteDelta: latestQuote.result },
            deployment,
            latestBlock,
            await executionClient.getGasPrice(),
            discovery.graph,
          ),
        )
        exact.push(evaluated)
        exactEvaluations.push({
          templateId: candidate.templateId,
          fundingMode: candidate.fundingMode,
          outcome: EvaluationOutcome.PROFITABLE,
          stage: 'EXACT_NET',
        })
      } catch (error) {
        exactEvaluations.push({
          templateId: candidate.templateId,
          fundingMode: candidate.fundingMode,
          outcome: classifyEvaluationFailure(error),
          stage: 'EXACT_NET',
          rpcClass: classifyRpcError(error),
          reason: errorText(error),
        })
      }
    }
    lifecycle.mark('EXACT_EVALUATION_COMPLETE', {
      candidateCount: managedCandidates.length,
      exactPositiveCount: exact.length,
    })
    exact.sort((left, right) => (left.normalizedNetUsdg > right.normalizedNetUsdg ? -1 : 1))
    const selected = exact[0] || null
    const preflightCompletedAtMs = Date.now()
    const sourceReceivedAt = process.env.GLOBAL_WAKE_RECEIVED_AT || null
    const sourceReceivedAtMs = Number.isFinite(Date.parse(sourceReceivedAt || '')) ? Date.parse(sourceReceivedAt) : null
    const routeAddresses = routeDependencies
    const discoveryOutcomes = summarizeEvaluationOutcomes(
      [...discovery.evaluations, ...discovery.settlementAdmission.rejected],
      { fallbackOutcome: EvaluationOutcome.UNSUPPORTED },
    )
    const exactOutcomes = summarizeEvaluationOutcomes(exactEvaluations, {
      fallbackOutcome: EvaluationOutcome.STATE_UNAVAILABLE,
    })
    const evaluation = managedCandidates.length > 0 ? exactOutcomes : discoveryOutcomes
    const workset = {
      policy: GLOBAL_ROUTE_WORKSET_POLICY,
      wakeKind: routeAddresses.size > 0 ? 'EVENT' : 'RECOVERY',
      totalRoutes: discovery.routeCoverage.reduce((total, item) => total + Number(item.totalRoutes || 0), 0),
      touchedRoutes: discovery.routeCoverage.reduce((total, item) => total + Number(item.touchedRoutes || 0), 0),
      selectedRoutes: discovery.routeCoverage.reduce((total, item) => total + Number(item.selectedRoutes || 0), 0),
      settlementAssets: discovery.routeCoverage.length,
    }
    const timing = {
      preflightStartedAt,
      preflightCompletedAt: new Date(preflightCompletedAtMs).toISOString(),
      sourceToPreflightStartMs:
        sourceReceivedAtMs === null ? null : Math.max(0, preflightStartedAtMs - sourceReceivedAtMs),
      preflightDurationMs: preflightCompletedAtMs - preflightStartedAtMs,
      sourceToDecisionMs: sourceReceivedAtMs === null ? null : Math.max(0, preflightCompletedAtMs - sourceReceivedAtMs),
    }
    lifecycle.mark('DECIDED', {
      decisionClassification: selected ? EvaluationOutcome.PROFITABLE : evaluation.decisionClassification,
      evidenceCoverage: evaluation.coverage,
    })
    const snapshot = {
      schemaVersion: 2,
      generatedAt: new Date().toISOString(),
      status: selected ? 'EXACT_NET_POSITIVE' : 'NO_EXACT_NET_OPPORTUNITY',
      decisionClassification: selected ? EvaluationOutcome.PROFITABLE : evaluation.decisionClassification,
      evidenceCoverage: evaluation.coverage,
      evidence: 'PUBLIC_FIRST_BATCHED_STATE_QUOTES_WITH_MANAGED_TRANSPORT_FALLBACK_THEN_MANAGED_EXACT_SIMULATION',
      lifecycle: lifecycle.snapshot(),
      graph: {
        blockNumber: block.number,
        assets: discovery.graph.assets.size,
        swapEdges: discovery.graph.edges.length,
        hyperedges: discovery.graph.hyperedges.length,
        rejected: discovery.graph.rejected.length,
        commitment: discovery.graph.commitment,
        earnPools: discovery.earn.pools.length,
        v2Pools: discovery.uniswap.v2Pools.length,
        v3Pools: discovery.uniswap.v3Pools.length,
        v4Pools: discovery.uniswap.v4Pools.length,
        coverage: discovery.uniswap.coverage,
        settlementAssets: discovery.settlementAdmission.admitted.map((item) => item.token),
        settlementAdmission: {
          policy: discovery.settlementAdmission.policy,
          evidence: discovery.settlementAdmission.evidence,
          scope: discovery.settlementAdmission.admissionScope,
          graphAssets: discovery.settlementAdmission.graphAssets,
          structurallyEligible: discovery.settlementAdmission.structurallyEligible,
          selectedForFunding: discovery.settlementAdmission.selectedForFunding,
          valuationEligibleForFunding: discovery.settlementAdmission.valuationEligibleForFunding,
          fundingChecked: discovery.settlementAdmission.candidates.length,
          funded: discovery.settlementAdmission.fundedCount,
          admitted: discovery.settlementAdmission.admittedCount,
          rejected: discovery.settlementAdmission.rejected.length,
          deferred: discovery.settlementAdmission.deferred,
          maximumAdmitted: discovery.settlementAdmission.maximumAdmitted,
        },
        routeCoverage: discovery.routeCoverage,
      },
      evaluated: discovery.evaluations.length,
      grossPositive: grossPositive.length,
      managedEvaluated: managedCandidates.length,
      managedMaximumCandidates: GLOBAL_MAX_MANAGED_CANDIDATES_PER_WAKE,
      exactNetPositive: exact.length,
      evaluation: {
        taxonomy: Object.values(EvaluationOutcome),
        decisionClassification: selected ? EvaluationOutcome.PROFITABLE : evaluation.decisionClassification,
        coverage: evaluation.coverage,
        discovery: discoveryOutcomes,
        exact: exactOutcomes,
      },
      wake: {
        reason: process.env.GLOBAL_WAKE_REASON || null,
        source: lifecycleSource,
        sources: lifecycleSources,
        classification: process.env.GLOBAL_WAKE_CLASSIFICATION || null,
        sourceReceivedAt,
        feedSequenceNumber,
        feedLastSequenceNumber,
        routeAddressCount: routeAddresses.size,
      },
      workset,
      timing,
      rpc: {
        discoveryPolicy: 'PUBLIC_FIRST_BATCHED_WITH_BOUNDED_MANAGED_TRANSPORT_FALLBACK',
        wakeKind: workset.wakeKind,
        wakeReason: process.env.GLOBAL_WAKE_REASON || null,
        managedFallbackWakeBudget: managedFallbackWakeBudgetSnapshot(),
        managedFallbackBudget: managedFallbackBudgetSnapshot(),
        calls: rpcEvidence.snapshot(),
      },
      selected: selected
        ? {
            templateId: selected.templateId,
            kind: selected.opportunityKind,
            pool: selected.pool,
            settlementToken: selected.settlementToken,
            fundingMode: selected.fundingMode,
            principal: formatUnits(selected.principal, selected.decimals),
            quotedGross: formatUnits(selected.quoteDelta, selected.decimals),
            quotedNet: formatUnits(selected.netSettlement, selected.decimals),
            normalizedNetUsdg: formatUnits(selected.normalizedNetUsdg, 6),
            estimatedGas: selected.estimatedGas,
          }
        : null,
    }
    if (persist) {
      writeProtectedJson(GLOBAL_SNAPSHOT_PATH, snapshot)
      appendAudit('global_preflight', {
        authorizationId: process.env.GLOBAL_SHARED_AUTHORIZATION_ID || null,
        ...snapshot,
      })
    }
    if (print) console.log(stringify(snapshot))
    return { snapshot, selected, deployment, graph: discovery.graph, lifecycle, rpcEvidence }
  } catch (error) {
    const decisionClassification = classifyEvaluationFailure(error)
    const evidenceCoverage = ['RPC_ERROR', 'STATE_UNAVAILABLE'].includes(decisionClassification)
      ? 'UNAVAILABLE'
      : 'COMPLETE'
    lifecycle.mark('PREFLIGHT_FAILED', {
      decisionClassification,
      reason: errorText(error),
    })
    const failureSnapshot = {
      schemaVersion: 2,
      generatedAt: new Date().toISOString(),
      status: 'PREFLIGHT_FAILED_NO_SIGNATURE',
      decisionClassification,
      evidenceCoverage,
      evidence: 'TYPED_PREFLIGHT_FAILURE_BEFORE_SIGNATURE',
      lifecycle: lifecycle.snapshot(),
      evaluation: summarizeEvaluationOutcomes([
        {
          outcome: decisionClassification,
          stage: 'PREFLIGHT',
          rpcClass: classifyRpcError(error),
          reason: errorText(error),
        },
      ]),
      wake: {
        reason: process.env.GLOBAL_WAKE_REASON || null,
        source: lifecycleSource,
        sources: lifecycleSources,
        classification: process.env.GLOBAL_WAKE_CLASSIFICATION || null,
        sourceReceivedAt: process.env.GLOBAL_WAKE_RECEIVED_AT || null,
        feedSequenceNumber,
        feedLastSequenceNumber,
        routeAddressCount: routeDependencies.size,
      },
      timing: {
        preflightStartedAt,
        preflightCompletedAt: new Date().toISOString(),
        preflightDurationMs: Date.now() - preflightStartedAtMs,
      },
      rpc: {
        discoveryPolicy: 'PUBLIC_FIRST_BATCHED_WITH_BOUNDED_MANAGED_TRANSPORT_FALLBACK',
        managedFallbackWakeBudget: managedFallbackWakeBudgetSnapshot(),
        managedFallbackBudget: managedFallbackBudgetSnapshot(),
        calls: rpcEvidence.snapshot(),
      },
    }
    if (persist) {
      writeProtectedJson(GLOBAL_SNAPSHOT_PATH, failureSnapshot)
      appendAudit('global_preflight_failed', {
        authorizationId: process.env.GLOBAL_SHARED_AUTHORIZATION_ID || null,
        ...failureSnapshot,
      })
    }
    if (error && typeof error === 'object') error.globalPreflightEvidence = failureSnapshot
    throw error
  }
}

function persistGlobalLifecycle(prepared, status, decisionClassification, evidenceCoverage) {
  const lifecycle = prepared.lifecycle.snapshot()
  const rpc = { ...prepared.snapshot.rpc, calls: prepared.rpcEvidence.snapshot() }
  const snapshot = {
    ...prepared.snapshot,
    generatedAt: new Date().toISOString(),
    status,
    decisionClassification,
    evidenceCoverage,
    lifecycle,
    rpc,
  }
  writeProtectedJson(GLOBAL_SNAPSHOT_PATH, snapshot)
  appendAudit('global_event_lifecycle', {
    authorizationId: process.env.GLOBAL_SHARED_AUTHORIZATION_ID || null,
    eventId: lifecycle.eventId,
    status,
    decisionClassification,
    evidenceCoverage,
    lifecycle,
    rpcCalls: rpc.calls,
  })
  return snapshot
}

async function deployPreflight({ print = true } = {}) {
  assertLiveTransport(runtime)
  if (readJson(STATE_PATH)?.executor) throw new Error('universal executor is already recorded as deployed')
  const holder = lockHolder(DUAL_LOCK_PATH)
  if (holder.alive) throw new Error(`dual watcher is active as PID ${holder.pid}`)
  const unresolved = latestUnresolvedMutation(readAuditRecords())
  if (unresolved) throw new Error(`unresolved ${unresolved.kind} mutation ${unresolved.hash}`)
  const compiled = loadUniversalContractArtifact()
  const runtimeCodeHash = keccak256(materializeUniversalRuntime(compiled, WALLET))
  const snapshot = await walletSnapshot()
  if (snapshot.latestNonce !== snapshot.pendingNonce) throw new Error('wallet has a pending nonce')
  const data = encodeDeployData({ abi: compiled.abi, bytecode: compiled.bytecode, args: [WALLET] })
  const estimatedGas = await executionClient.estimateGas({ account: WALLET, data })
  const gasLimit = ceilDiv(estimatedGas * 12n, 10n) + 20_000n
  const maxFeePerGas = ceilDiv(snapshot.gasPrice * 105n, 100n)
  const maximumGasWei = gasLimit * maxFeePerGas
  const reserve = parseUnits(runtime.genericMinEthReserve, 18)
  if (snapshot.balance < maximumGasWei + reserve) throw new Error('wallet cannot fund deployment Gas and reserve')
  const report = {
    status: 'UNIVERSAL_DEPLOYMENT_READY',
    evidence: 'EXACT_CREATION_CALL_AND_GAS_ESTIMATE_NO_SIGNATURE',
    nonce: snapshot.latestNonce,
    estimatedGas,
    gasLimit,
    maximumGasCostEth: formatEther(maximumGasWei),
    retainedReserveEth: formatEther(reserve),
    sourceHash: compiled.sourceHash,
    creationCodeHash: compiled.creationCodeHash,
    runtimeCodeHash,
    runtimeTemplateCodeHash: compiled.runtimeTemplateCodeHash,
  }
  if (print) console.log(stringify(report))
  return { compiled, snapshot, data, gasLimit, maxFeePerGas, runtimeCodeHash, report }
}

async function broadcastPersisted(plan, transaction, lifecycle = null, rpcEvidence = null) {
  const account = loadAccount()
  lifecycle?.mark('SIGNING_STARTED')
  const serializedTransaction = await account.signTransaction(transaction)
  const hash = keccak256(serializedTransaction)
  const rawPrivateRef = persistSignedRaw(SIGNED_DIR, hash, serializedTransaction)
  lifecycle?.mark('SIGNED', { transactionHash: hash })
  appendAudit('mutation_signed', {
    kind: plan.kind,
    authorizationId: plan.authorizationId || null,
    intentId: plan.intentId,
    planHash: plan.planHash,
    hash,
    nonce: plan.nonce,
    rawPrivateRef,
    eventId: lifecycle?.eventId || null,
  })
  lifecycle?.mark('SUBMISSION_STARTED')
  const broadcast = await broadcastSameRawToSequencer({
    serializedTransaction,
    managedRpcUrl: RPC_URL,
  })
  if (rpcEvidence instanceof RpcEvidence) {
    rpcEvidence.record('DIRECT_SEQUENCER', 'SUBMISSION', 'eth_sendRawTransaction')
    if (broadcast.fallback) rpcEvidence.record('MANAGED_FALLBACK', 'SUBMISSION', 'eth_sendRawTransaction')
  }
  lifecycle?.mark('SUBMITTED', {
    transactionHash: hash,
    directStatus: broadcast.direct.status,
    fallbackStatus: broadcast.fallback?.status || null,
  })
  appendAudit('global_broadcast', {
    kind: plan.kind,
    hash,
    directStatus: broadcast.direct.status,
    fallbackStatus: broadcast.fallback?.status || null,
    eventId: lifecycle?.eventId || null,
  })
  try {
    const receipt =
      rpcEvidence instanceof RpcEvidence
        ? await withRpcEvidence(rpcEvidence, 'RECEIPT_CONFIRMATION', () =>
            executionClient.waitForTransactionReceipt({
              hash,
              confirmations: runtime.finalityConfirmations,
              timeout: 120_000,
            }),
          )
        : await executionClient.waitForTransactionReceipt({
            hash,
            confirmations: runtime.finalityConfirmations,
            timeout: 120_000,
          })
    lifecycle?.mark('RECEIPT_CONFIRMED', {
      transactionHash: hash,
      receiptStatus: receipt.status,
      blockNumber: receipt.blockNumber,
    })
    return { hash, receipt, broadcast }
  } catch {
    lifecycle?.mark('RECEIPT_UNKNOWN', { transactionHash: hash })
    appendAudit('global_receipt_unknown', { kind: plan.kind, hash, eventId: lifecycle?.eventId || null })
    throw new Error(`transaction receipt is UNKNOWN; reconcile before reusing nonce: ${hash}`)
  }
}

async function deploymentStateFromReceipt(plan, hash, receipt, compiled) {
  if (receipt.status !== 'success' || !receipt.contractAddress) {
    throw new Error('canonical deployment receipt is not successful')
  }
  if (plan.sourceHash !== compiled.sourceHash || plan.creationCodeHash !== compiled.creationCodeHash) {
    throw new Error('deployment plan source or creation hash differs from the reviewed compiler output')
  }
  const executor = getAddress(receipt.contractAddress)
  const [code, operator, morpho, block] = await Promise.all([
    executionClient.getCode({ address: executor, blockNumber: receipt.blockNumber }),
    executionClient.readContract({
      address: executor,
      abi: compiled.abi,
      functionName: 'operator',
      blockNumber: receipt.blockNumber,
    }),
    executionClient.readContract({
      address: executor,
      abi: compiled.abi,
      functionName: 'MORPHO',
      blockNumber: receipt.blockNumber,
    }),
    executionClient.getBlock({ blockNumber: receipt.blockNumber }),
  ])
  if (!code || code === '0x') throw new Error('canonical deployment receipt has no runtime code')
  const runtimeEvidence = verifyUniversalRuntimeEvidence({
    compiled,
    operator: WALLET,
    code,
    plannedRuntimeCodeHash: plan.runtimeCodeHash,
  })
  if (operator.toLowerCase() !== WALLET.toLowerCase() || morpho.toLowerCase() !== MORPHO.toLowerCase()) {
    throw new Error('deployed universal executor has unexpected immutable identities')
  }
  const existing = readJson(STATE_PATH)
  if (existing?.executor && existing.executor.toLowerCase() !== executor.toLowerCase()) {
    throw new Error('deployment ledger already names a different universal executor')
  }
  const state = {
    schemaVersion: 1,
    lane: 'global-v1',
    status: existing?.status || 'deployed',
    chainId: CHAIN_ID,
    wallet: WALLET,
    executor,
    sourceHash: plan.sourceHash,
    creationCodeHash: plan.creationCodeHash,
    runtimeCodeHash: runtimeEvidence.actualRuntimeCodeHash,
    runtimeVerification: runtimeEvidence.mode,
    deploymentTransaction: hash,
    deploymentBlock: receipt.blockNumber,
    deployedAt: new Date(Number(block.timestamp) * 1_000).toISOString(),
    executions: existing?.executions || [],
  }
  writeProtectedJson(STATE_PATH, state)
  appendAudit('mutation_effect', {
    kind: plan.kind,
    hash,
    intentId: plan.intentId,
    planHash: plan.planHash,
    result: 'CONFIRMED_SUCCESS',
    executor,
    blockNumber: receipt.blockNumber,
    runtimeCodeHash: runtimeEvidence.actualRuntimeCodeHash,
    runtimeVerification: runtimeEvidence.mode,
  })
  return state
}

function decodeExecutedEvent(receipt, executor, abi) {
  return receipt.logs
    .filter((log) => log.address.toLowerCase() === executor.toLowerCase())
    .map((log) => {
      try {
        return decodeEventLog({ abi, data: log.data, topics: log.topics })
      } catch {
        return null
      }
    })
    .find((event) => event?.eventName === 'Executed')
}

async function executionStateFromReceipt(plan, hash, receipt, compiled, directSequencerStatus) {
  if (receipt.status !== 'success') throw new Error('canonical execution receipt is not successful')
  const deployment = await assertDeployment(compiled)
  const executedLog = decodeExecutedEvent(receipt, deployment.executor, compiled.abi)
  if (!executedLog) throw new Error('confirmed receipt lacks the canonical Executed event')
  if (
    executedLog.args.planHash.toLowerCase() !== String(plan.contractPlanHash).toLowerCase() ||
    executedLog.args.settlementToken.toLowerCase() !== String(plan.settlementToken).toLowerCase() ||
    BigInt(executedLog.args.principal) !== BigInt(plan.principal) ||
    executedLog.args.flashFunded !== (plan.fundingMode === 'MORPHO_FLASH')
  ) {
    throw new Error('canonical Executed event differs from the immutable mutation plan')
  }
  const [settlementAfter, block] = await Promise.all([
    executionClient.readContract({
      address: plan.settlementToken,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [deployment.executor],
      blockNumber: receipt.blockNumber,
    }),
    executionClient.getBlock({ blockNumber: receipt.blockNumber }),
  ])
  const grossProfit = settlementAfter - BigInt(plan.settlementBefore)
  if (grossProfit !== BigInt(executedLog.args.grossProfit) || grossProfit < BigInt(plan.protectedMinimumProfit)) {
    throw new Error('receipt event and canonical settlement balance delta disagree')
  }
  const gasSpentWei = receipt.gasUsed * receipt.effectiveGasPrice
  const gasSettlement = await gasInSettlement(plan.settlementToken, gasSpentWei, receipt.blockNumber)
  const netSettlement = grossProfit - gasSettlement
  const normalizedNetProfitUsdgWei = await normalizedUsdg(plan.settlementToken, netSettlement, receipt.blockNumber)
  if (netSettlement <= 0n || normalizedNetProfitUsdgWei < MINIMUM_NET_USDG) {
    throw new Error('canonical realized result violates the protected net-profit floor')
  }
  const record = {
    hash,
    lane: 'global-v1',
    authorizationId: plan.authorizationId || null,
    blockNumber: receipt.blockNumber.toString(),
    templateId: plan.templateId,
    opportunityKind: plan.opportunityKind,
    settlementToken: getAddress(plan.settlementToken),
    baseAsset: plan.settlementLabel,
    settlementDecimals: Number(plan.settlementDecimals),
    principalWei: BigInt(plan.principal).toString(),
    amountInWei: BigInt(plan.principal).toString(),
    routeLabel: plan.opportunityKind,
    fundingMode: plan.fundingMode,
    grossProfitWei: grossProfit.toString(),
    gasSpentWei: gasSpentWei.toString(),
    gasSettlementWei: gasSettlement.toString(),
    netProfitWei: netSettlement.toString(),
    normalizedNetProfitUsdgWei: normalizedNetProfitUsdgWei.toString(),
    directSequencerStatus,
    confirmedAt: new Date(Number(block.timestamp) * 1_000).toISOString(),
    evidence: 'CANONICAL_RECEIPT_EXECUTED_EVENT_AND_EXECUTOR_BALANCE_DELTA',
  }
  const state = readJson(STATE_PATH)
  if (!state || state.executor?.toLowerCase() !== deployment.executor.toLowerCase()) {
    throw new Error('verified universal deployment ledger disappeared during effect recording')
  }
  const prior = (state.executions || []).find((item) => item.hash?.toLowerCase() === hash.toLowerCase())
  const canonicalKeys = [
    'blockNumber',
    'templateId',
    'opportunityKind',
    'settlementToken',
    'baseAsset',
    'settlementDecimals',
    'principalWei',
    'fundingMode',
    'grossProfitWei',
    'gasSpentWei',
    'gasSettlementWei',
    'netProfitWei',
    'normalizedNetProfitUsdgWei',
  ]
  if (prior && canonicalKeys.some((key) => String(prior[key]) !== String(record[key]))) {
    throw new Error('existing execution ledger entry disagrees with canonical replay')
  }
  state.status = 'live_net_validated'
  state.executions = prior ? state.executions : [...(state.executions || []), record]
  writeProtectedJson(STATE_PATH, state)
  appendAudit('mutation_effect', {
    kind: plan.kind,
    authorizationId: plan.authorizationId || null,
    hash,
    intentId: plan.intentId,
    planHash: plan.planHash,
    result: 'CONFIRMED_SUCCESS',
    grossProfitWei: grossProfit,
    realizedNetProfitWei: netSettlement,
    normalizedNetProfitUsdgWei,
    blockNumber: receipt.blockNumber,
  })
  return prior || record
}

async function deploy() {
  if (process.env.GLOBAL_DEPLOY_ARM !== '1') throw new Error('set GLOBAL_DEPLOY_ARM=1 for reviewed deployment')
  const release = acquireLock(WALLET_LOCK_PATH, 'global-v1-wallet')
  try {
    const prepared = await deployPreflight({ print: false })
    const plan = buildMutationPlan('global-deploy', {
      lane: 'global-v1',
      chainId: CHAIN_ID,
      wallet: WALLET,
      authorizationId: null,
      nonce: prepared.snapshot.latestNonce,
      to: null,
      value: 0n,
      dataCommitment: keccak256(prepared.data),
      gasLimit: prepared.gasLimit,
      maxFeePerGas: prepared.maxFeePerGas,
      maxPriorityFeePerGas: 0n,
      sourceHash: prepared.compiled.sourceHash,
      creationCodeHash: prepared.compiled.creationCodeHash,
      runtimeCodeHash: prepared.runtimeCodeHash,
    })
    appendAudit('mutation_plan', plan)
    const sent = await broadcastPersisted(plan, {
      chainId: CHAIN_ID,
      type: 'eip1559',
      data: prepared.data,
      value: 0n,
      gas: prepared.gasLimit,
      maxFeePerGas: prepared.maxFeePerGas,
      maxPriorityFeePerGas: 0n,
      nonce: prepared.snapshot.latestNonce,
    })
    if (sent.receipt.status !== 'success' || !sent.receipt.contractAddress) {
      appendAudit('mutation_reverted', { kind: plan.kind, hash: sent.hash })
      throw new Error(`universal deployment reverted: ${sent.hash}`)
    }
    const state = await deploymentStateFromReceipt(plan, sent.hash, sent.receipt, prepared.compiled)
    console.log(
      stringify({
        status: 'UNIVERSAL_DEPLOYMENT_CONFIRMED',
        transaction: sent.hash,
        executor: state.executor,
        blockNumber: sent.receipt.blockNumber,
        gasSpentEth: formatEther(sent.receipt.gasUsed * sent.receipt.effectiveGasPrice),
        directSequencer: sent.broadcast.direct.status,
      }),
    )
    return state
  } finally {
    release()
  }
}

function assertSharedAuthorization(deployment) {
  const authorizationId = process.env.GLOBAL_SHARED_AUTHORIZATION_ID
  if (!authorizationId) {
    const holder = lockHolder(DUAL_LOCK_PATH)
    if (holder.alive) throw new Error(`dual watcher controls the signer as PID ${holder.pid}`)
    const arm = readJson(DUAL_ARM_PATH)
    if (arm?.status === 'ARMED' && readJson(DUAL_REVOCATION_PATH)?.authorizationId !== arm.authorizationId) {
      throw new Error('active dual authorization requires shared watcher execution')
    }
    if (process.env.GLOBAL_LIVE_ARM !== '1') {
      throw new Error('manual global execution requires GLOBAL_LIVE_ARM=1')
    }
    return null
  }
  const parentPid = Number(process.env.GLOBAL_SHARED_WATCH_PID)
  const holder = lockHolder(DUAL_LOCK_PATH)
  const arm = readJson(DUAL_ARM_PATH)
  const revocation = readJson(DUAL_REVOCATION_PATH)
  if (
    !holder.alive ||
    holder.pid !== parentPid ||
    process.ppid !== parentPid ||
    arm?.status !== 'ARMED' ||
    arm.authorizationId !== authorizationId ||
    revocation?.authorizationId === authorizationId ||
    arm.global?.enabled !== true ||
    arm.global.executor?.toLowerCase() !== deployment.executor.toLowerCase() ||
    arm.global.sourceHash !== deployment.state.sourceHash ||
    arm.global.runtimeCodeHash !== deployment.state.runtimeCodeHash ||
    BigInt(arm.global.minimumNetProfitUsdgWei) !== MINIMUM_NET_USDG ||
    Number(arm.global.maximumRoutesPerWake) !== runtime.globalMaxRoutesPerWake ||
    Number(arm.global.maximumEventRoutesPerWake) !== GLOBAL_EVENT_MAX_ROUTES_PER_WAKE ||
    Number(arm.global.quoteConcurrency) !== runtime.globalQuoteConcurrency ||
    Number(arm.global.managedMaximumCandidatesPerWake) !== GLOBAL_MAX_MANAGED_CANDIDATES_PER_WAKE ||
    Number(arm.global.managedFallbackDailyLogicalCallCap) !== runtime.globalManagedFallbackDailyLogicalCallCap ||
    Number(arm.global.managedFallbackEventLogicalCallCap) !== GLOBAL_MANAGED_FALLBACK_EVENT_LOGICAL_CALL_CAP ||
    Number(arm.global.managedFallbackRecoveryLogicalCallCap) !== GLOBAL_MANAGED_FALLBACK_RECOVERY_LOGICAL_CALL_CAP ||
    arm.global.feedPolicy !== GLOBAL_FEED_MATCH_POLICY ||
    arm.global.routeWorksetPolicy !== GLOBAL_ROUTE_WORKSET_POLICY ||
    arm.global.graphPolicy !== GLOBAL_GRAPH_POLICY.version ||
    arm.global.routePolicy !== GLOBAL_ATOMIC_ROUTE_POLICY ||
    arm.global.settlementPolicy !== GLOBAL_SETTLEMENT_ADMISSION_POLICY ||
    Number(arm.global.maximumSettlementFundingChecksPerWake) !== GLOBAL_MAX_SETTLEMENT_FUNDING_CHECKS_PER_WAKE ||
    Number(arm.global.maximumSettlementAssetsPerWake) !== GLOBAL_MAX_SETTLEMENT_ASSETS_PER_WAKE ||
    !Array.isArray(arm.global.settlementSeeds) ||
    arm.global.settlementSeeds.length !== SETTLEMENT_SEEDS.length ||
    arm.global.settlementSeeds.some((token, index) => token.toLowerCase() !== SETTLEMENT_SEEDS[index].toLowerCase())
  ) {
    throw new Error('shared global authorization is invalid or revoked')
  }
  return { arm, authorizationId, parentPid }
}

async function execute() {
  assertLiveTransport(runtime)
  const release = acquireLock(WALLET_LOCK_PATH, 'global-v1-wallet')
  try {
    const unresolved = latestUnresolvedMutation(readAuditRecords())
    if (unresolved) throw new Error(`unresolved ${unresolved.kind} mutation ${unresolved.hash}`)
    const deployment = await assertDeployment()
    const shared = assertSharedAuthorization(deployment)
    let prepared
    try {
      prepared = await globalPreflight({ print: false })
    } catch (error) {
      if (/managed RPC fallback (?:per-wake|daily) logical-call budget exhausted/i.test(errorText(error))) {
        const failureEvidence =
          error && typeof error === 'object' ? /** @type {Record<string, any>} */ (error).globalPreflightEvidence : null
        const output = {
          status: 'NO_SIGNATURE_RPC_BUDGET_EXHAUSTED',
          evidence: 'BOUNDED_READ_FAILURE_BEFORE_SIGNER_LOAD_OR_MUTATION',
          reason: errorText(error),
          decisionClassification: failureEvidence?.decisionClassification || EvaluationOutcome.POLICY_FILTERED,
          evidenceCoverage: failureEvidence?.evidenceCoverage || 'COMPLETE',
          lifecycle: failureEvidence?.lifecycle || null,
          evaluation: failureEvidence?.evaluation || null,
          wake: failureEvidence?.wake || null,
          timing: failureEvidence?.timing || null,
          rpc: {
            ...(failureEvidence?.rpc || {}),
            wakeKind: wakeAddressSet().size > 0 ? 'EVENT' : 'RECOVERY',
            wakeReason: process.env.GLOBAL_WAKE_REASON || null,
            managedFallbackWakeBudget: managedFallbackWakeBudgetSnapshot(),
            managedFallbackBudget: managedFallbackBudgetSnapshot(),
          },
        }
        console.log(stringify(output))
        return output
      }
      throw error
    }
    if (!prepared.selected) {
      const output = { status: 'NO_EXACT_NET_OPPORTUNITY', ...prepared.snapshot }
      console.log(stringify(output))
      return output
    }
    const wallet = await withRpcEvidence(prepared.rpcEvidence, 'SIGNER_PREFLIGHT', () => walletSnapshot())
    prepared.lifecycle.mark('SIGNER_PREFLIGHT_COMPLETE', {
      blockNumber: wallet.block.number,
      nonceReady: wallet.latestNonce === wallet.pendingNonce,
    })
    if (wallet.latestNonce !== wallet.pendingNonce) {
      prepared.lifecycle.mark('SIGNER_PREFLIGHT_REJECTED', {
        decisionClassification: EvaluationOutcome.POLICY_FILTERED,
        reason: 'pending nonce',
      })
      persistGlobalLifecycle(
        prepared,
        'FINAL_VALIDATION_REJECTED_NO_SIGNATURE',
        EvaluationOutcome.POLICY_FILTERED,
        'COMPLETE',
      )
      throw new Error('wallet has a pending nonce')
    }
    const latestQuote = await withRpcEvidence(prepared.rpcEvidence, 'FINAL_QUOTE', () =>
      quotePlan(
        executionClient,
        deployment.executor,
        deployment.compiled.abi,
        { ...prepared.selected.plan, deadline: wallet.block.timestamp + DEADLINE_SECONDS },
        prepared.selected.principal,
        wallet.block.number,
        prepared.selected.fundingMode,
      ),
    )
    if (latestQuote.outcome !== EvaluationOutcome.PROFITABLE) {
      prepared.lifecycle.mark('FINAL_QUOTE_REJECTED', {
        decisionClassification: latestQuote.outcome,
        reason: latestQuote.reason || 'quote decayed',
      })
      persistGlobalLifecycle(
        prepared,
        'FINAL_VALIDATION_REJECTED_NO_SIGNATURE',
        latestQuote.outcome,
        ['RPC_ERROR', 'STATE_UNAVAILABLE'].includes(latestQuote.outcome) ? 'UNAVAILABLE' : 'COMPLETE',
      )
      throw new Error(
        `selected opportunity unavailable before signing: ${latestQuote.outcome}${latestQuote.reason ? ` (${latestQuote.reason})` : ''}`,
      )
    }
    let refreshed
    try {
      refreshed = await withRpcEvidence(prepared.rpcEvidence, 'FINAL_SIMULATION', () =>
        exactNetEvaluation(
          {
            ...prepared.selected,
            plan: { ...prepared.selected.plan, deadline: wallet.block.timestamp + DEADLINE_SECONDS },
            quoteDelta: latestQuote.result,
          },
          deployment,
          wallet.block,
          wallet.gasPrice,
          prepared.graph,
        ),
      )
      prepared.lifecycle.mark('FINAL_SIMULATION_PASSED', { blockNumber: wallet.block.number })
    } catch (error) {
      const outcome = classifyEvaluationFailure(error)
      prepared.lifecycle.mark('FINAL_SIMULATION_REJECTED', {
        decisionClassification: outcome,
        reason: errorText(error),
      })
      persistGlobalLifecycle(
        prepared,
        'FINAL_VALIDATION_REJECTED_NO_SIGNATURE',
        outcome,
        ['RPC_ERROR', 'STATE_UNAVAILABLE'].includes(outcome) ? 'UNAVAILABLE' : 'COMPLETE',
      )
      throw error
    }
    const data = encodeFunctionData({
      abi: deployment.compiled.abi,
      functionName: refreshed.functionName,
      args: [refreshed.plan, refreshed.principal],
    })
    let settlementBefore
    let contractPlanHash
    try {
      ;[settlementBefore, contractPlanHash] = await withRpcEvidence(prepared.rpcEvidence, 'BALANCE_BASELINE', () =>
        Promise.all([
          executionClient.readContract({
            address: refreshed.settlementToken,
            abi: erc20Abi,
            functionName: 'balanceOf',
            args: [deployment.executor],
            blockNumber: wallet.block.number,
          }),
          executionClient.readContract({
            address: deployment.executor,
            abi: deployment.compiled.abi,
            functionName: 'planHash',
            args: [refreshed.plan],
            blockNumber: wallet.block.number,
          }),
        ]),
      )
      prepared.lifecycle.mark('BALANCE_BASELINE_PINNED', { blockNumber: wallet.block.number })
    } catch (error) {
      const outcome = classifyEvaluationFailure(error)
      prepared.lifecycle.mark('BALANCE_BASELINE_REJECTED', {
        decisionClassification: outcome,
        reason: errorText(error),
      })
      persistGlobalLifecycle(
        prepared,
        'FINAL_VALIDATION_REJECTED_NO_SIGNATURE',
        outcome,
        ['RPC_ERROR', 'STATE_UNAVAILABLE'].includes(outcome) ? 'UNAVAILABLE' : 'COMPLETE',
      )
      throw error
    }
    const plan = buildMutationPlan('global-execute', {
      lane: 'global-v1',
      chainId: CHAIN_ID,
      wallet: WALLET,
      authorizationId: shared?.authorizationId || null,
      nonce: wallet.latestNonce,
      to: deployment.executor,
      value: 0n,
      dataCommitment: keccak256(data),
      gasLimit: refreshed.gasLimit,
      maxFeePerGas: refreshed.maxFeePerGas,
      maxPriorityFeePerGas: 0n,
      deadline: refreshed.plan.deadline,
      contractPlanHash,
      templateId: refreshed.templateId,
      opportunityKind: refreshed.opportunityKind,
      fundingMode: refreshed.fundingMode,
      settlementToken: refreshed.settlementToken,
      settlementDecimals: refreshed.decimals,
      settlementLabel: settlementLabel(refreshed.settlementToken),
      principal: refreshed.principal,
      protectedMinimumProfit: refreshed.requiredGross,
      quotedGrossProfit: refreshed.quoteDelta,
      quotedNetProfit: refreshed.netSettlement,
      normalizedQuotedNetUsdg: refreshed.normalizedNetUsdg,
      settlementBefore,
      eventId: prepared.lifecycle.eventId,
      stateBlockNumber: wallet.block.number,
      stateBlockHash: wallet.block.hash || null,
      catalogVersion: prepared.snapshot.lifecycle.catalogVersion,
      graphVersion: prepared.snapshot.lifecycle.graphVersion,
    })
    appendAudit('mutation_plan', plan)
    if (shared) assertSharedAuthorization(deployment)
    const sent = await broadcastPersisted(
      plan,
      {
        chainId: CHAIN_ID,
        type: 'eip1559',
        to: deployment.executor,
        data,
        value: 0n,
        gas: refreshed.gasLimit,
        maxFeePerGas: refreshed.maxFeePerGas,
        maxPriorityFeePerGas: 0n,
        nonce: wallet.latestNonce,
      },
      prepared.lifecycle,
      prepared.rpcEvidence,
    )
    if (sent.receipt.status !== 'success') {
      const gasSpentWei = sent.receipt.gasUsed * sent.receipt.effectiveGasPrice
      appendAudit('mutation_reverted', {
        kind: plan.kind,
        authorizationId: plan.authorizationId,
        hash: sent.hash,
        planHash: plan.planHash,
        gasSpentWei,
        eventId: prepared.lifecycle.eventId,
      })
      prepared.lifecycle.mark('EXECUTION_REVERTED', {
        transactionHash: sent.hash,
        blockNumber: sent.receipt.blockNumber,
      })
      const terminalSnapshot = persistGlobalLifecycle(
        prepared,
        'GLOBAL_EXECUTION_REVERTED_CONFIRMED',
        EvaluationOutcome.PROFITABLE,
        'COMPLETE',
      )
      const output = {
        status: 'GLOBAL_EXECUTION_REVERTED_CONFIRMED',
        evidence: 'CANONICAL_REVERT_RECEIPT',
        transaction: sent.hash,
        explorer: `https://robinhoodchain.blockscout.com/tx/${sent.hash}`,
        blockNumber: sent.receipt.blockNumber,
        gasSpentWei,
        gasSpentEth: formatEther(gasSpentWei),
        graph: prepared.snapshot.graph,
        lifecycle: terminalSnapshot.lifecycle,
        evaluation: terminalSnapshot.evaluation,
        decisionClassification: terminalSnapshot.decisionClassification,
        evidenceCoverage: terminalSnapshot.evidenceCoverage,
        wake: prepared.snapshot.wake,
        workset: prepared.snapshot.workset,
        timing: prepared.snapshot.timing,
        rpc: terminalSnapshot.rpc,
      }
      console.log(stringify(output))
      return output
    }
    const record = await withRpcEvidence(prepared.rpcEvidence, 'RECEIPT_ACCOUNTING', () =>
      executionStateFromReceipt(plan, sent.hash, sent.receipt, deployment.compiled, sent.broadcast.direct.status),
    )
    prepared.lifecycle.mark('EXECUTION_CONFIRMED', {
      transactionHash: sent.hash,
      blockNumber: sent.receipt.blockNumber,
    })
    const terminalSnapshot = persistGlobalLifecycle(
      prepared,
      'GLOBAL_LIVE_NET_PROFIT_CONFIRMED',
      EvaluationOutcome.PROFITABLE,
      'COMPLETE',
    )
    const output = {
      status: 'GLOBAL_LIVE_NET_PROFIT_CONFIRMED',
      transaction: sent.hash,
      explorer: `https://robinhoodchain.blockscout.com/tx/${sent.hash}`,
      kind: record.opportunityKind,
      fundingMode: record.fundingMode,
      settlementToken: record.settlementToken,
      principal: formatUnits(BigInt(record.principalWei), record.settlementDecimals),
      grossProfit: formatUnits(BigInt(record.grossProfitWei), record.settlementDecimals),
      netProfit: formatUnits(BigInt(record.netProfitWei), record.settlementDecimals),
      normalizedNetProfitUsdg: formatUnits(BigInt(record.normalizedNetProfitUsdgWei), 6),
      directSequencer: record.directSequencerStatus,
      evidence: record.evidence,
      graph: prepared.snapshot.graph,
      lifecycle: terminalSnapshot.lifecycle,
      evaluation: terminalSnapshot.evaluation,
      decisionClassification: terminalSnapshot.decisionClassification,
      evidenceCoverage: terminalSnapshot.evidenceCoverage,
      evaluated: prepared.snapshot.evaluated,
      grossPositive: prepared.snapshot.grossPositive,
      exactNetPositive: prepared.snapshot.exactNetPositive,
      wake: prepared.snapshot.wake,
      workset: prepared.snapshot.workset,
      timing: prepared.snapshot.timing,
      rpc: terminalSnapshot.rpc,
    }
    console.log(stringify(output))
    return output
  } finally {
    release()
  }
}

async function status() {
  const state = readJson(STATE_PATH)
  let deployment = null
  try {
    const verified = await assertDeployment()
    deployment = {
      status: verified.state.status,
      executor: verified.executor,
      deploymentTransaction: verified.state.deploymentTransaction,
      confirmedExecutions: (verified.state.executions || []).length,
    }
  } catch (error) {
    deployment = { status: state ? 'INVALID' : 'NOT_DEPLOYED', error: errorText(error) }
  }
  const output = {
    status: deployment.status,
    evidence: 'DEPLOYMENT_LEDGER_PLUS_CHAIN_CODE_READBACK',
    deployment,
    latestOpportunity: readJson(GLOBAL_SNAPSHOT_PATH),
    unresolvedMutation: latestUnresolvedMutation(readAuditRecords()),
  }
  console.log(stringify(output))
  return output
}

async function optionalLookup(operation) {
  try {
    return await operation()
  } catch (error) {
    if (/not found|could not be found|unknown transaction/i.test(errorText(error))) return null
    throw error
  }
}

async function observeMutation(client, source, hash) {
  try {
    const [headBlock, latestNonce, pendingNonce, transaction, receipt] = await Promise.all([
      client.getBlock(),
      client.getTransactionCount({ address: WALLET, blockTag: 'latest' }),
      client.getTransactionCount({ address: WALLET, blockTag: 'pending' }),
      optionalLookup(() => client.getTransaction({ hash })),
      optionalLookup(() => client.getTransactionReceipt({ hash })),
    ])
    return {
      source,
      head: headBlock.number,
      headTimestamp: headBlock.timestamp,
      latestNonce,
      pendingNonce,
      transaction,
      receipt,
    }
  } catch (error) {
    return { source, error: errorText(error) }
  }
}

function assertRawMatchesPlan(parsed, plan) {
  const plannedTo = plan.to === null ? null : getAddress(plan.to)
  const parsedTo = parsed.to === null || parsed.to === undefined ? null : getAddress(parsed.to)
  if (
    Number(parsed.chainId) !== Number(plan.chainId) ||
    parsedTo !== plannedTo ||
    BigInt(parsed.value || 0n) !== BigInt(plan.value) ||
    BigInt(parsed.gas || 0n) !== BigInt(plan.gasLimit) ||
    BigInt(parsed.maxFeePerGas || 0n) !== BigInt(plan.maxFeePerGas) ||
    BigInt(parsed.maxPriorityFeePerGas || 0n) !== BigInt(plan.maxPriorityFeePerGas) ||
    keccak256(parsed.data || '0x').toLowerCase() !== String(plan.dataCommitment).toLowerCase()
  ) {
    throw new Error('persisted raw transaction differs from the immutable mutation plan')
  }
}

async function reconcile() {
  assertLiveTransport(runtime)
  const holder = lockHolder(DUAL_LOCK_PATH)
  const sharedAuthorizationId = process.env.GLOBAL_SHARED_AUTHORIZATION_ID || null
  const sharedParentPid = Number(process.env.GLOBAL_SHARED_WATCH_PID || 0)
  const sharedReconciliation = Boolean(
    sharedAuthorizationId &&
    Number.isSafeInteger(sharedParentPid) &&
    sharedParentPid > 0 &&
    process.ppid === sharedParentPid &&
    holder.alive &&
    holder.pid === sharedParentPid,
  )
  if (holder.alive && !sharedReconciliation) throw new Error(`dual watcher is active as PID ${holder.pid}`)
  if (sharedAuthorizationId && !sharedReconciliation) throw new Error('invalid shared global reconciliation identity')
  const release = acquireLock(WALLET_LOCK_PATH, 'global-v1-wallet')
  try {
    if (sharedReconciliation) assertSharedAuthorization(await assertDeployment())
    const records = readAuditRecords()
    const unresolved = latestUnresolvedMutation(records)
    if (!unresolved || !['global-deploy', 'global-execute'].includes(unresolved.kind)) {
      const output = { status: unresolved ? 'OTHER_LANE_UNRESOLVED' : 'CLEAN', unresolved }
      console.log(stringify(output))
      return output
    }
    const plan = records.findLast((item) => item.event === 'mutation_plan' && item.planHash === unresolved.planHash)
    if (!plan) throw new Error('persisted global mutation plan is missing; state remains UNKNOWN')
    const rawFile = path.resolve(unresolved.rawPrivateRef || '')
    const signedRoot = `${path.resolve(SIGNED_DIR)}${path.sep}`
    if (!rawFile.startsWith(signedRoot) || !fs.existsSync(rawFile)) {
      throw new Error('persisted global raw transaction is missing or misplaced')
    }
    assertPrivateFile(rawFile)
    const serializedTransaction = fs.readFileSync(rawFile, 'utf8').trim()
    if (keccak256(serializedTransaction).toLowerCase() !== unresolved.hash.toLowerCase()) {
      throw new Error('persisted global raw hash differs from the audit record')
    }
    const parsed = parseTransaction(serializedTransaction)
    const signer = await recoverTransactionAddress({ serializedTransaction })
    if (signer.toLowerCase() !== WALLET.toLowerCase() || parsed.nonce !== Number(plan.nonce)) {
      throw new Error('persisted global raw signer or nonce differs from the plan')
    }
    assertRawMatchesPlan(parsed, plan)
    const readers = [{ client: executionClient, source: 'execution-rpc' }]
    if (RPC_URL !== PUBLIC_RPC) readers.push({ client: discoveryClient, source: 'public-rpc' })
    const observations = await Promise.all(
      readers.map(({ client, source }) => observeMutation(client, source, unresolved.hash)),
    )
    const outcome = classifyReconciliation(observations, Number(unresolved.nonce), runtime.finalityConfirmations)
    appendAudit('global_reconcile_observed', {
      kind: unresolved.kind,
      hash: unresolved.hash,
      outcome: outcome.state,
      sources: observations.map((item) => ({
        source: item.source,
        head: item.head,
        latestNonce: item.latestNonce,
        pendingNonce: item.pendingNonce,
        transactionSeen: Boolean(item.transaction),
        receiptStatus: item.receipt?.status || null,
        error: item.error || null,
      })),
    })
    if (outcome.state === 'CONFIRMED_SUCCESS') {
      const effect =
        unresolved.kind === 'global-deploy'
          ? await deploymentStateFromReceipt(plan, unresolved.hash, outcome.receipt, loadUniversalContractArtifact())
          : await executionStateFromReceipt(
              plan,
              unresolved.hash,
              outcome.receipt,
              loadUniversalContractArtifact(),
              'RECONCILED_FROM_CANONICAL_RECEIPT',
            )
      const output = { status: 'RECONCILED_SUCCESS', hash: unresolved.hash, effect }
      console.log(stringify(output))
      return output
    }
    if (outcome.state === 'CONFIRMED_REVERTED') {
      appendAudit('mutation_reverted', {
        kind: unresolved.kind,
        authorizationId: plan.authorizationId || null,
        hash: unresolved.hash,
        planHash: plan.planHash,
        gasSpentWei: outcome.receipt.gasUsed * outcome.receipt.effectiveGasPrice,
      })
      const output = { status: 'RECONCILED_REVERTED', hash: unresolved.hash }
      console.log(stringify(output))
      return output
    }
    const output = { status: `RECONCILE_${outcome.state}`, hash: unresolved.hash, outcome }
    console.log(stringify(output))
    return output
  } finally {
    release()
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const command = process.argv[2] || 'status'
  if (command === 'compile') {
    const { compileUniversalContract } = await import('./universal-contract-compile.mjs')
    console.log(stringify(compileUniversalContract()))
  } else if (command === 'deploy-preflight') await deployPreflight()
  else if (command === 'deploy') await deploy()
  else if (command === 'preflight') await globalPreflight()
  else if (command === 'execute') await execute()
  else if (command === 'status') await status()
  else if (command === 'reconcile') await reconcile()
  else if (command === 'catalog-refresh') await catalogRefresh()
  else throw new Error(`unknown global command ${command}`)
}
