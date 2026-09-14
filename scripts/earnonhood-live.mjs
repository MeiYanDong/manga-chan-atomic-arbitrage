import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createPublicClient,
  defineChain,
  encodeFunctionData,
  formatEther,
  getAddress,
  http,
  keccak256,
  parseAbi,
  parseEther,
  parseTransaction,
  recoverTransactionAddress,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { assertLiveTransport, loadRuntimeConfig } from '../src/config.mjs'
import { broadcastSameRawToSequencer } from '../src/direct-sequencer.mjs'
import { decodeEarnOnHoodReceiptRoute } from '../src/earnonhood-receipt.mjs'
import {
  EARN_DISCOVERY_RPC_POLICY,
  EARN_EVENT_SOURCE_POLICY,
  EARN_MANAGED_FALLBACK_EVENT_LOGICAL_CALL_CAP,
  EARN_MANAGED_FALLBACK_RECOVERY_LOGICAL_CALL_CAP,
  earnManagedFallbackLogicalCallCap,
  earnWakeKind,
} from '../src/earn-rpc-policy.mjs'
import {
  EARN_SIZING_ALGORITHM,
  buildEarnOnHoodProbeAmounts,
  buildEarnOnHoodRefinementAmounts,
  buildEarnOnHoodTargetedAmounts,
  deriveEarnOnHoodExecutionBounds,
  earnOnHoodQuoteBracket,
  earnOnHoodGasSolvency,
  earnOnHoodRouteQuarantine,
  preservesEarnOnHoodLongTermProfit,
  selectEarnOnHoodGasCandidates,
} from '../src/earnonhood-live-policy.mjs'
import {
  assertEarnRouteShape,
  buildEarnOnHoodExactQuoteShortlist,
  enumerateEarnOnHoodCycles,
  routeExistsInCatalog,
} from '../src/earnonhood-graph.mjs'
import {
  loadEarnOnHoodOnchainCatalog,
  refreshEarnOnHoodCachedDynamicCatalog,
} from '../src/earnonhood-onchain-catalog.mjs'
import {
  EARN_BATCH_ROUTER as BATCH_ROUTER,
  EARN_LEGACY_REVIEWED_ROUTES,
  EARN_LEGACY_ROUTE_COMMITMENT,
  EARN_ROUTE_DISCOVERY_POLICY,
  EARN_ROUTE_COMMITMENT,
  EARN_VAULT as VAULT,
  EARN_WETH as WETH,
  maximumEarnPublicExactQuotes,
} from '../src/earnonhood-routes.mjs'
import {
  DUAL_AUTHORIZATION_POLICY_VERSION,
  dualAuthorizationId,
  dualAuthorizationUsage,
  evaluateDualAuthorizationBudget,
  expectedDualWalletNonce,
  validateDualSignedAttempt,
} from '../src/dual-live-policy.mjs'
import { assertPrivateFile, buildMutationPlan, persistSignedRaw } from '../src/journal.mjs'
import { readSafetyAuditRecords } from '../src/incremental-jsonl-reader.mjs'
import {
  DailyHotRpcBudget,
  LogicalCallBudget,
  consumeNestedLogicalCallBudgets,
  jsonRpcCallCount,
} from '../src/hot-rpc-lane.mjs'
import { errorText, latestUnresolvedMutation } from '../src/policy.mjs'
import { publicFirstRpcTransport } from '../src/public-first-rpc.mjs'

const CHAIN_ID = 4_663
const PUBLIC_READ_ONLY_RPC = 'https://rpc.mainnet.chain.robinhood.com'
const WALLET = getAddress('0x77f771E83f118C32547A1291dda438a757B4b91B')
const EXPECTED_STATIC_SWAP_FEE = 3_000_000_000_000_000n
const DEADLINE_SECONDS = 45n

const pathComponents = [
  { name: 'tokenIn', type: 'address' },
  {
    name: 'steps',
    type: 'tuple[]',
    components: [
      { name: 'pool', type: 'address' },
      { name: 'tokenOut', type: 'address' },
      { name: 'isBuffer', type: 'bool' },
    ],
  },
  { name: 'exactAmountIn', type: 'uint256' },
  { name: 'minAmountOut', type: 'uint256' },
]

const batchRouterAbi = [
  {
    type: 'error',
    name: 'SwapLimit',
    inputs: [
      { name: 'amount', type: 'uint256' },
      { name: 'limit', type: 'uint256' },
    ],
  },
  {
    type: 'function',
    name: 'querySwapExactIn',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'paths', type: 'tuple[]', components: pathComponents },
      { name: 'sender', type: 'address' },
      { name: 'userData', type: 'bytes' },
    ],
    outputs: [
      { name: 'pathAmountsOut', type: 'uint256[]' },
      { name: 'tokensOut', type: 'address[]' },
      { name: 'amountsOut', type: 'uint256[]' },
    ],
  },
  {
    type: 'function',
    name: 'swapExactIn',
    stateMutability: 'payable',
    inputs: [
      { name: 'paths', type: 'tuple[]', components: pathComponents },
      { name: 'deadline', type: 'uint256' },
      { name: 'wethIsEth', type: 'bool' },
      { name: 'userData', type: 'bytes' },
    ],
    outputs: [
      { name: 'pathAmountsOut', type: 'uint256[]' },
      { name: 'tokensOut', type: 'address[]' },
      { name: 'amountsOut', type: 'uint256[]' },
    ],
  },
  {
    type: 'function',
    name: 'getVault',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'getWeth',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
]

const vaultAbi = [
  {
    type: 'function',
    name: 'isPoolInitialized',
    stateMutability: 'view',
    inputs: [{ name: 'pool', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'isPoolPaused',
    stateMutability: 'view',
    inputs: [{ name: 'pool', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'isPoolInRecoveryMode',
    stateMutability: 'view',
    inputs: [{ name: 'pool', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'getPoolTokens',
    stateMutability: 'view',
    inputs: [{ name: 'pool', type: 'address' }],
    outputs: [{ name: '', type: 'address[]' }],
  },
  {
    type: 'function',
    name: 'getStaticSwapFeePercentage',
    stateMutability: 'view',
    inputs: [{ name: 'pool', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
]

const wethAbi = parseAbi(['function symbol() view returns (string)', 'function decimals() view returns (uint8)'])
const runtimeConfig = loadRuntimeConfig()
const rpcUrl = runtimeConfig.rpcUrl
const chain = defineChain({
  id: CHAIN_ID,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl || 'https://rpc.mainnet.chain.robinhood.com'] } },
})
const executionClient = createPublicClient({
  chain,
  transport: http(rpcUrl || 'https://rpc.mainnet.chain.robinhood.com', { timeout: 30_000, retryCount: 1 }),
})
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const runDir = runtimeConfig.runDir ? path.resolve(runtimeConfig.runDir) : path.join(root, 'runs')
const walletLockPath = path.join(runDir, 'wallet.lock')
const dualWatchLockPath = path.join(runDir, 'dual-watch.lock')
const auditPath = path.join(runDir, 'earnonhood-audit.jsonl')
const sharedAuditPath = path.join(runDir, 'audit.jsonl')
const usdgStatePath = path.join(runDir, 'generic-state.json')
const wethStatePath = path.join(runDir, 'weth-state.json')
const dualWatchArmPath = path.join(runDir, 'dual-watch-arm.json')
const dualWatchRevocationPath = path.join(runDir, 'dual-watch-revocation.json')
const globalCatalogPath = path.join(runDir, 'global-catalog.json')
const earnRpcBudgetPath = path.join(runDir, 'earn-rpc-fallback-budget.json')
const signedTransactionDir = path.join(runDir, 'signed', 'earnonhood')

let managedFallbackBudget = null
let managedFallbackWakeBudget = null

function currentManagedFallbackBudget() {
  if (!managedFallbackBudget) {
    managedFallbackBudget = new DailyHotRpcBudget({
      dailyEventCandidateCap: 1,
      dailyLogicalCallCap: runtimeConfig.earnManagedFallbackDailyLogicalCallCap,
      persisted: readJson(earnRpcBudgetPath),
      onChange: (state) => writeProtectedJson(earnRpcBudgetPath, state),
    })
  }
  return managedFallbackBudget
}

function currentManagedFallbackWakeBudget() {
  if (!managedFallbackWakeBudget) {
    const reason = process.env.EARN_WAKE_REASON || null
    managedFallbackWakeBudget = new LogicalCallBudget({
      logicalCallCap: earnManagedFallbackLogicalCallCap(reason),
      label: `${earnWakeKind(reason)}_WAKE`,
    })
  }
  return managedFallbackWakeBudget
}

function consumeManagedFallbackBudget(body) {
  const debit = consumeNestedLogicalCallBudgets({
    perWakeBudget: currentManagedFallbackWakeBudget(),
    dailyBudget: currentManagedFallbackBudget(),
    count: jsonRpcCallCount(body),
  })
  if (!debit.consumed) {
    throw new Error(
      debit.exhausted === 'PER_WAKE'
        ? 'managed RPC fallback per-wake logical-call budget exhausted'
        : 'managed RPC fallback daily logical-call budget exhausted',
    )
  }
}

function managedFallbackEvidence() {
  return {
    discoveryPolicy: EARN_DISCOVERY_RPC_POLICY,
    wakeKind: earnWakeKind(process.env.EARN_WAKE_REASON || null),
    wakeReason: process.env.EARN_WAKE_REASON || null,
    perWakeLogicalCallCaps: {
      event: EARN_MANAGED_FALLBACK_EVENT_LOGICAL_CALL_CAP,
      recovery: EARN_MANAGED_FALLBACK_RECOVERY_LOGICAL_CALL_CAP,
    },
    managedFallbackWakeBudget: currentManagedFallbackWakeBudget().snapshot(),
    managedFallbackBudget: currentManagedFallbackBudget().snapshot(),
  }
}

const discoveryClient = createPublicClient({
  chain,
  transport: publicFirstRpcTransport(PUBLIC_READ_ONLY_RPC, rpcUrl, {
    batchSize: 8,
    managedFetchFn: async (input, init) => {
      consumeManagedFallbackBudget(init?.body)
      return globalThis.fetch(input, init)
    },
  }),
})

function stringify(value) {
  return JSON.stringify(value, (_, item) => (typeof item === 'bigint' ? item.toString() : item), 2)
}

function appendJsonLine(file, record) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  fs.appendFileSync(
    file,
    `${JSON.stringify(record, (_, item) => (typeof item === 'bigint' ? item.toString() : item))}\n`,
    { mode: 0o600 },
  )
  fs.chmodSync(file, 0o600)
}

function appendAudit(event, details = {}, { mirrorShared = false } = {}) {
  fs.mkdirSync(runDir, { recursive: true, mode: 0o700 })
  const record = { at: new Date().toISOString(), lane: 'earnonhood-v2', event, ...details }
  appendJsonLine(auditPath, record)
  if (mirrorShared) appendJsonLine(sharedAuditPath, record)
}

function readJson(file) {
  if (!fs.existsSync(file)) return null
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function writeProtectedJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const temporary = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temporary, `${stringify(value)}\n`, { mode: 0o600 })
  fs.renameSync(temporary, file)
  fs.chmodSync(file, 0o600)
}

function readJsonLines(file) {
  return readSafetyAuditRecords(file)
}

function processIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function activeLock(file) {
  if (!fs.existsSync(file)) return null
  const pid = Number(fs.readFileSync(file, 'utf8').trim().split(/\s+/)[0])
  return processIsAlive(pid) ? pid : null
}

function acquireWalletLock() {
  fs.mkdirSync(runDir, { recursive: true, mode: 0o700 })
  let descriptor
  try {
    descriptor = fs.openSync(walletLockPath, 'wx', 0o600)
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error
    const pid = activeLock(walletLockPath)
    if (pid) throw new Error(`wallet lock is held by PID ${pid}`)
    fs.unlinkSync(walletLockPath)
    descriptor = fs.openSync(walletLockPath, 'wx', 0o600)
  }
  fs.writeFileSync(descriptor, `${process.pid} ${new Date().toISOString()} earnonhood-v2\n`)
  return () => {
    try {
      fs.closeSync(descriptor)
    } catch {}
    try {
      fs.unlinkSync(walletLockPath)
    } catch {}
  }
}

function sharedExecutionContext() {
  const authorizationId = process.env.EARN_SHARED_AUTHORIZATION_ID || null
  const parentPid = Number(process.env.EARN_SHARED_WATCH_PID || 0)
  if (!authorizationId && !parentPid) return null
  if (!authorizationId || !Number.isSafeInteger(parentPid) || parentPid <= 0 || process.ppid !== parentPid) {
    throw new Error('invalid shared EarnOnHood watcher process identity')
  }
  const lockPid = activeLock(dualWatchLockPath)
  if (lockPid !== parentPid) throw new Error('shared EarnOnHood parent does not own the dual watcher lock')
  return { authorizationId, parentPid }
}

function assertSharedAuthorization(context, { maximumGasCostWei = null, currentSignedAttempt = null } = {}) {
  if (!context) throw new Error('shared EarnOnHood execution context is required')
  const arm = readJson(dualWatchArmPath)
  const revocation = readJson(dualWatchRevocationPath)
  if (
    !arm ||
    arm.status !== 'ARMED' ||
    arm.authorizationId !== context.authorizationId ||
    arm.policyVersion !== DUAL_AUTHORIZATION_POLICY_VERSION ||
    revocation?.authorizationId === context.authorizationId ||
    dualAuthorizationId(arm) !== arm.authorizationId
  ) {
    throw new Error('shared EarnOnHood authorization is absent, changed, invalid, or revoked')
  }
  if (
    arm.earnOnHood?.enabled !== true ||
    arm.earnOnHood.routeCommitment !== EARN_ROUTE_COMMITMENT ||
    arm.earnOnHood.vault?.toLowerCase() !== VAULT.toLowerCase() ||
    arm.earnOnHood.batchRouter?.toLowerCase() !== BATCH_ROUTER.toLowerCase() ||
    arm.earnOnHood.poolScope !== EARN_ROUTE_DISCOVERY_POLICY.poolScope ||
    arm.earnOnHood.catalogSource !== EARN_ROUTE_DISCOVERY_POLICY.catalogSource ||
    arm.earnOnHood.factory?.toLowerCase() !== EARN_ROUTE_DISCOVERY_POLICY.factory.toLowerCase() ||
    Number(arm.earnOnHood.maximumHops) !== EARN_ROUTE_DISCOVERY_POLICY.maximumHops ||
    arm.earnOnHood.principalPolicy !== 'AVAILABLE_WALLET_BALANCE_MINUS_GAS_AND_RESERVE_NO_FIXED_CAP' ||
    arm.earnOnHood.sizingAlgorithm !== EARN_SIZING_ALGORITHM ||
    Number(arm.earnOnHood.coarseProbePoints) !== runtimeConfig.earnLiveCoarseProbePoints ||
    Number(arm.earnOnHood.refinementPoints) !== runtimeConfig.earnLiveRefinementPoints ||
    Number(arm.earnOnHood.publicMaximumExactQuotesPerWake) !==
      maximumEarnPublicExactQuotes(runtimeConfig.earnLiveRefinementPoints) ||
    Number(arm.earnOnHood.managedMaximumExactQuotesPerWake) !== runtimeConfig.earnLiveRefinementPoints + 3 ||
    arm.earnOnHood.discoveryRpc !== EARN_DISCOVERY_RPC_POLICY ||
    arm.earnOnHood.eventSource !== EARN_EVENT_SOURCE_POLICY ||
    Number(arm.earnOnHood.eventPollMs) !== runtimeConfig.earnWatchEventPollMs ||
    Number(arm.earnOnHood.periodicMs) !== runtimeConfig.earnWatchPeriodicMs ||
    Number(arm.earnOnHood.managedFallbackDailyLogicalCallCap) !==
      runtimeConfig.earnManagedFallbackDailyLogicalCallCap ||
    Number(arm.earnOnHood.managedFallbackEventLogicalCallCap) !== EARN_MANAGED_FALLBACK_EVENT_LOGICAL_CALL_CAP ||
    Number(arm.earnOnHood.managedFallbackRecoveryLogicalCallCap) !== EARN_MANAGED_FALLBACK_RECOVERY_LOGICAL_CALL_CAP
  ) {
    throw new Error('shared EarnOnHood route or principal authorization mismatch')
  }
  const records = readJsonLines(sharedAuditPath)
  const usage = dualAuthorizationUsage(arm, readJson(usdgStatePath), readJson(wethStatePath), records)
  const budget = evaluateDualAuthorizationBudget(arm, usage)
  if (!budget.allowed) throw new Error(`shared EarnOnHood authorization budget failed: ${budget.reason}`)
  if (maximumGasCostWei !== null && !preservesEarnOnHoodLongTermProfit(usage.earnGasSurplusWei, maximumGasCostWei)) {
    throw new Error('worst-case EarnOnHood Gas would break lifetime positive net profit')
  }
  if (currentSignedAttempt) {
    const reservation = validateDualSignedAttempt(arm, records, currentSignedAttempt, latestUnresolvedMutation(records))
    if (!reservation.allowed) throw new Error(reservation.reason)
  }
  return { arm, usage }
}

function loadAccount() {
  let privateKey
  if (runtimeConfig.privateKeyFile) {
    assertPrivateFile(runtimeConfig.privateKeyFile)
    privateKey = fs.readFileSync(runtimeConfig.privateKeyFile, 'utf8').trim()
  } else {
    if (process.platform !== 'darwin') throw new Error('Linux execution requires MANGA_PRIVATE_KEY_FILE')
    privateKey = execFileSync(
      '/usr/bin/security',
      ['find-generic-password', '-w', '-s', runtimeConfig.keychainService],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    ).trim()
  }
  if (!/^0x[0-9a-f]{64}$/i.test(privateKey)) throw new Error('signing credential is not a 32-byte EVM private key')
  const account = privateKeyToAccount(privateKey)
  privateKey = undefined
  if (account.address.toLowerCase() !== WALLET.toLowerCase())
    throw new Error(`signer mismatch: observed ${account.address}`)
  return account
}

function routePath(route, amountIn, minimumAmountOut) {
  return {
    tokenIn: WETH,
    steps: route.steps.map((step) => ({ pool: step.pool, tokenOut: step.tokenOut, isBuffer: false })),
    exactAmountIn: amountIn,
    minAmountOut: minimumAmountOut,
  }
}

function cachedEarnCatalog(blockNumber, focusPools) {
  let snapshot
  let generatedAt
  let cachedBlock
  try {
    snapshot = readJson(globalCatalogPath)
    generatedAt = Date.parse(String(snapshot?.generatedAt || ''))
    cachedBlock = snapshot?.blockNumber === undefined ? null : BigInt(snapshot.blockNumber)
  } catch {
    return null
  }
  const ageMs = Date.now() - generatedAt
  const fresh =
    snapshot?.schemaVersion === 1 &&
    snapshot?.earn?.source === EARN_ROUTE_DISCOVERY_POLICY.catalogSource &&
    Array.isArray(snapshot?.earn?.pools) &&
    snapshot.earn.pools.length > 0 &&
    snapshot.earn.pools.length <= EARN_ROUTE_DISCOVERY_POLICY.maximumCatalogPools &&
    Number.isFinite(generatedAt) &&
    ageMs >= 0 &&
    ageMs <= 6 * 60 * 60 * 1_000 &&
    cachedBlock !== null &&
    cachedBlock <= blockNumber
  if (!fresh) return null
  const cachedPools = new Set((snapshot.earn.pools || []).map((pool) => String(pool?.address || '').toLowerCase()))
  if ((focusPools || []).some((pool) => !cachedPools.has(getAddress(pool).toLowerCase()))) return null
  return snapshot.earn
}

function routeBookFromCandidateHint(candidateHint) {
  const route = assertEarnRouteShape(candidateHint.route)
  const snapshot = candidateHint.routeBookSnapshot
  if (!snapshot || !Array.isArray(snapshot.pools) || snapshot.pools.length === 0) {
    throw new Error('public-screen candidate lacks its canonical route snapshot')
  }
  const requiredPools = new Set(route.steps.map((step) => step.pool.toLowerCase()))
  const snapshotPools = new Set(snapshot.pools.map((pool) => String(pool?.address || '').toLowerCase()))
  if (snapshot.pools.some((pool) => !pool) || [...requiredPools].some((pool) => !snapshotPools.has(pool))) {
    throw new Error('public-screen candidate snapshot is missing a committed route pool')
  }
  const routes = enumerateEarnOnHoodCycles(snapshot.pools)
  if (!routeExistsInCatalog(route, routes)) {
    throw new Error('public-screen candidate route is absent from its canonical route snapshot')
  }
  return {
    ...snapshot,
    routes,
    poolByAddress: new Map(snapshot.pools.map((pool) => [pool.address.toLowerCase(), pool])),
  }
}

async function loadDynamicRouteBook(client, blockNumber, { candidateHint = null, focusPools = [] } = {}) {
  if (candidateHint) return routeBookFromCandidateHint(candidateHint)
  const cached = cachedEarnCatalog(blockNumber, focusPools)
  const catalog = cached
    ? await refreshEarnOnHoodCachedDynamicCatalog(client, cached, blockNumber)
    : await loadEarnOnHoodOnchainCatalog(client, blockNumber)
  const routes = enumerateEarnOnHoodCycles(catalog.pools)
  if (routes.length === 0) throw new Error('EarnOnHood dynamic graph contains no WETH-settled cycle')
  return {
    ...catalog,
    routes,
    poolByAddress: new Map(catalog.pools.map((pool) => [pool.address.toLowerCase(), pool])),
  }
}

function routeBookEvidence(routeBook) {
  return {
    catalogSource: routeBook.source,
    catalogBlockNumber: routeBook.blockNumber,
    discoveredFactoryPoolCount: routeBook.discoveredFactoryPools,
    reviewedLegacyPoolCount: routeBook.reviewedLegacyPools,
    eligiblePoolCount: routeBook.pools.length,
    rejectedCatalogPoolCount: routeBook.rejected.length,
    catalogRefreshMode: routeBook.refreshMode || 'FULL_CANONICAL_FACTORY_REFRESH',
  }
}

async function assertCoreProtocolIdentity(client, blockNumber) {
  const [chainId, codes, routerVault, routerWeth, wethSymbol, wethDecimals] = await Promise.all([
    client.getChainId(),
    Promise.all([VAULT, BATCH_ROUTER, WETH].map((address) => client.getCode({ address, blockNumber }))),
    client.readContract({ address: BATCH_ROUTER, abi: batchRouterAbi, functionName: 'getVault', blockNumber }),
    client.readContract({ address: BATCH_ROUTER, abi: batchRouterAbi, functionName: 'getWeth', blockNumber }),
    client.readContract({ address: WETH, abi: wethAbi, functionName: 'symbol', blockNumber }),
    client.readContract({ address: WETH, abi: wethAbi, functionName: 'decimals', blockNumber }),
  ])
  if (chainId !== CHAIN_ID) throw new Error(`wrong chain id ${chainId}`)
  if (codes.some((code) => !code || code === '0x')) throw new Error('a canonical EarnOnHood target has no bytecode')
  if (routerVault.toLowerCase() !== VAULT.toLowerCase() || routerWeth.toLowerCase() !== WETH.toLowerCase()) {
    throw new Error('BatchRouter dependency identity mismatch')
  }
  if (wethSymbol !== 'WETH' || wethDecimals !== 18)
    throw new Error(`WETH identity mismatch: ${wethSymbol}/${wethDecimals}`)
}

async function assertDynamicRouteIdentity(client, blockNumber, routes, routeBook) {
  const checkedRoutes = routes.map((route) => assertEarnRouteShape(route))
  if (checkedRoutes.some((route) => !routeExistsInCatalog(route, routeBook.routes))) {
    throw new Error('dynamic Earn route is absent from the current official catalog graph')
  }
  const pools = [
    ...new Map(
      checkedRoutes.flatMap((route) => route.steps).map((step) => [step.pool.toLowerCase(), step.pool]),
    ).values(),
  ]
  const [codes, poolChecks] = await Promise.all([
    Promise.all(pools.map((address) => client.getCode({ address, blockNumber }))),
    Promise.all(
      pools.map(async (pool) => {
        const [initialized, paused, recoveryMode, tokens, staticSwapFee] = await Promise.all([
          client.readContract({
            address: VAULT,
            abi: vaultAbi,
            functionName: 'isPoolInitialized',
            args: [pool],
            blockNumber,
          }),
          client.readContract({
            address: VAULT,
            abi: vaultAbi,
            functionName: 'isPoolPaused',
            args: [pool],
            blockNumber,
          }),
          client.readContract({
            address: VAULT,
            abi: vaultAbi,
            functionName: 'isPoolInRecoveryMode',
            args: [pool],
            blockNumber,
          }),
          client.readContract({
            address: VAULT,
            abi: vaultAbi,
            functionName: 'getPoolTokens',
            args: [pool],
            blockNumber,
          }),
          client.readContract({
            address: VAULT,
            abi: vaultAbi,
            functionName: 'getStaticSwapFeePercentage',
            args: [pool],
            blockNumber,
          }),
        ])
        return { pool, initialized, paused, recoveryMode, tokens, staticSwapFee }
      }),
    ),
  ])
  if (codes.some((code) => !code || code === '0x')) throw new Error('an EarnOnHood candidate pool has no bytecode')
  for (const check of poolChecks) {
    const tokens = check.tokens.map((token) => token.toLowerCase())
    const requiredTokens = new Set(
      checkedRoutes
        .flatMap((route) => route.steps)
        .filter((step) => step.pool.toLowerCase() === check.pool.toLowerCase())
        .flatMap((step) => [step.tokenIn.toLowerCase(), step.tokenOut.toLowerCase()]),
    )
    const catalogTokens = routeBook.poolByAddress
      .get(check.pool.toLowerCase())
      ?.tokens.map((token) => token.address.toLowerCase())
    if (
      !check.initialized ||
      check.paused ||
      check.recoveryMode ||
      check.staticSwapFee !== EXPECTED_STATIC_SWAP_FEE ||
      [...requiredTokens].some((token) => !tokens.includes(token)) ||
      !catalogTokens ||
      catalogTokens.length !== tokens.length ||
      catalogTokens.some((token) => !tokens.includes(token))
    ) {
      throw new Error(`EarnOnHood pool boundary mismatch: ${check.pool}`)
    }
  }
}

async function exactQuote(client, route, amountIn, blockNumber) {
  const result = await client.readContract({
    address: BATCH_ROUTER,
    abi: batchRouterAbi,
    functionName: 'querySwapExactIn',
    args: [[routePath(route, amountIn, 0n)], WALLET, '0x'],
    blockNumber,
  })
  return BigInt(result[0][0])
}

function minimum(left, right) {
  return left < right ? left : right
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

async function exactQuotesAtBlock(client, quoteInputs, blockNumber) {
  return mapWithConcurrency(quoteInputs, 4, async ({ route, amountIn }) => {
    try {
      return { route, amountIn, amountOut: await exactQuote(client, route, amountIn, blockNumber), error: null }
    } catch (error) {
      return { route, amountIn, amountOut: 0n, error: errorText(error) }
    }
  })
}

function sortEarnQuotes(quotes) {
  quotes.sort((left, right) => {
    const leftGross = left.amountOut - left.amountIn
    const rightGross = right.amountOut - right.amountIn
    if (rightGross !== leftGross) return rightGross > leftGross ? 1 : -1
    if (left.route.id !== right.route.id) return left.route.id.localeCompare(right.route.id)
    return left.amountIn < right.amountIn ? -1 : left.amountIn > right.amountIn ? 1 : 0
  })
  return quotes
}

async function optimizeEarnOnHoodQuotes(
  client,
  sizing,
  blockNumber,
  routeBook,
  gasPriceWei,
  candidateHint = null,
  focusPools = [],
) {
  if (candidateHint) {
    const route = assertEarnRouteShape(candidateHint.route)
    if (!routeExistsInCatalog(route, routeBook.routes)) {
      throw new Error('public-screen candidate route left the current dynamic Earn graph')
    }
    const targeted = buildEarnOnHoodTargetedAmounts({
      spendableWei: sizing.spendableWei,
      lowerBoundWei: candidateHint.lowerBoundWei,
      upperBoundWei: candidateHint.upperBoundWei,
      anchorWei: candidateHint.amountInWei,
      refinementPoints: runtimeConfig.earnLiveRefinementPoints,
    })
    const quotes = await exactQuotesAtBlock(
      client,
      targeted.amounts.map((amountIn) => ({ route, amountIn })),
      blockNumber,
    )
    return {
      quotes: sortEarnQuotes(quotes),
      quoteMode: 'PUBLIC_SELECTED_ROUTE_LOCAL_EXACT',
      coarseQuoteCount: 0,
      refinementQuoteCount: quotes.length,
      exactQuoteCount: quotes.length,
      maximumExactQuoteCount: runtimeConfig.earnLiveRefinementPoints + 3,
      publicScreenBlockNumber: candidateHint.publicBlockNumber,
      routeGraphCount: routeBook.routes.length,
      shortlistedRouteCount: 1,
    }
  }

  const shortlist = buildEarnOnHoodExactQuoteShortlist({
    pools: routeBook.pools,
    routes: routeBook.routes,
    amounts: sizing.amounts,
    gasPriceWei,
    focusPools,
  })
  const coarseQuotes = await exactQuotesAtBlock(client, shortlist.quoteInputs, blockNumber)
  const bestByRoute = new Map()
  for (const quote of sortEarnQuotes([...coarseQuotes])) {
    if (!quote.error && !bestByRoute.has(quote.route.id)) bestByRoute.set(quote.route.id, quote)
  }
  const refinementRoutes = [...bestByRoute.values()]
    .slice(0, EARN_ROUTE_DISCOVERY_POLICY.refinementRouteLimit)
    .map((quote) => quote.route)
  const refinementInputs = refinementRoutes.flatMap((route) => {
    const refinement = buildEarnOnHoodRefinementAmounts({
      spendableWei: sizing.spendableWei,
      quotes: coarseQuotes.filter((quote) => quote.route.id === route.id),
      refinementPoints: runtimeConfig.earnLiveRefinementPoints,
    })
    return refinement.amounts.map((amountIn) => ({ route, amountIn }))
  })
  const refinementQuotes = await exactQuotesAtBlock(client, refinementInputs, blockNumber)
  return {
    quotes: sortEarnQuotes([...coarseQuotes, ...refinementQuotes]),
    quoteMode: 'DYNAMIC_FULL_GRAPH_LOCAL_RANK_THEN_EXACT',
    coarseQuoteCount: coarseQuotes.length,
    refinementQuoteCount: refinementQuotes.length,
    exactQuoteCount: coarseQuotes.length + refinementQuotes.length,
    maximumExactQuoteCount: maximumEarnPublicExactQuotes(runtimeConfig.earnLiveRefinementPoints),
    publicScreenBlockNumber: null,
    routeGraphCount: routeBook.routes.length,
    shortlistedRouteCount: shortlist.selectedRoutes.length,
  }
}

function currentGasSolvency(sharedContext) {
  if (sharedContext) return assertSharedAuthorization(sharedContext).usage
  return earnOnHoodGasSolvency(readJsonLines(auditPath))
}

async function prepareOnClient(
  client,
  gasSolvency,
  rpcRole,
  { candidateHint = null, focusPools = [], excludedRouteIds = new Set() } = {},
) {
  const block = await client.getBlock()
  const blockNumber = block.number
  const managedExact = rpcRole === 'MANAGED_RPC_EXACT'
  const [routeBook, , walletState] = await Promise.all([
    loadDynamicRouteBook(client, blockNumber, { candidateHint, focusPools }),
    managedExact ? assertCoreProtocolIdentity(client, blockNumber) : Promise.resolve(),
    Promise.all([
      client.getBalance({ address: WALLET, blockNumber }),
      client.getTransactionCount({ address: WALLET, blockTag: 'latest' }),
      client.getTransactionCount({ address: WALLET, blockTag: 'pending' }),
      client.getGasPrice(),
      client.estimateFeesPerGas(),
    ]),
  ])
  const [walletBalance, nonceLatest, noncePending, gasPrice, fees] = walletState
  if (nonceLatest !== noncePending) throw new Error('wallet latest and pending nonce differ')
  const perAttemptGasCeilingWei = parseEther(runtimeConfig.earnLiveMaxFailedGasWeth)
  const retainedWalletReserveWei = parseEther(runtimeConfig.earnLiveWalletReserveWeth)
  if (perAttemptGasCeilingWei <= 0n) throw new Error('EarnOnHood per-attempt Gas ceiling must be positive')
  const lifetimeGasAllowanceWei = (gasSolvency.earnGasSurplusWei ?? gasSolvency.surplusWei) - 1n
  const gasRiskAllowanceWei = minimum(perAttemptGasCeilingWei, lifetimeGasAllowanceWei)
  const sizing =
    gasRiskAllowanceWei > 0n
      ? buildEarnOnHoodProbeAmounts({
          walletBalanceWei: walletBalance,
          walletReserveWei: retainedWalletReserveWei,
          gasRiskAllowanceWei,
          probePoints: runtimeConfig.earnLiveCoarseProbePoints,
        })
      : { spendableWei: 0n, amounts: [] }
  if (sizing.amounts.length === 0) {
    return {
      report: {
        status: 'NO_SHOT',
        evidence: `${rpcRole}_SAME_BLOCK_NO_SIGNATURE_NO_BROADCAST`,
        reasons: ['NO_GAS_SOLVENT_SPENDABLE_BALANCE'],
        blockNumber,
        blockTimestamp: block.timestamp,
        wallet: WALLET,
        walletBalanceEth: formatEther(walletBalance),
        lifetimeEarnGasSurplusEth: formatEther(gasSolvency.earnGasSurplusWei ?? gasSolvency.surplusWei),
        retainedWalletReserveEth: formatEther(retainedWalletReserveWei),
        principalPolicy: 'AVAILABLE_WALLET_BALANCE_MINUS_GAS_AND_RESERVE_NO_FIXED_CAP',
        ...routeBookEvidence(routeBook),
      },
    }
  }
  const eligibleRoutes = routeBook.routes.filter((route) => !excludedRouteIds.has(route.id))
  if (eligibleRoutes.length === 0) {
    return {
      report: {
        status: 'NO_SHOT',
        evidence: `${rpcRole}_ROUTE_LOCAL_QUARANTINE_NO_SIGNATURE_NO_BROADCAST`,
        reasons: ['ROUTES_AWAITING_RELEVANT_STATE_CHANGE'],
        blockNumber,
        blockTimestamp: block.timestamp,
        wallet: WALLET,
        walletBalanceEth: formatEther(walletBalance),
        nonceLatest,
        noncePending,
        dynamicMaximumPrincipalEth: formatEther(sizing.spendableWei),
        principalPolicy: 'AVAILABLE_WALLET_BALANCE_MINUS_GAS_AND_RESERVE_NO_FIXED_CAP',
        lifetimeEarnGasSurplusEth: formatEther(gasSolvency.earnGasSurplusWei ?? gasSolvency.surplusWei),
        routeGraphCount: routeBook.routes.length,
        shortlistedRouteCount: 0,
        quarantinedRouteCount: excludedRouteIds.size,
        ...routeBookEvidence(routeBook),
      },
    }
  }
  const eligibleRouteBook = { ...routeBook, routes: eligibleRoutes }
  const optimizer = await optimizeEarnOnHoodQuotes(
    client,
    sizing,
    blockNumber,
    eligibleRouteBook,
    gasPrice > (fees.maxFeePerGas || 0n) ? gasPrice : fees.maxFeePerGas || gasPrice,
    candidateHint,
    focusPools,
  )
  const { quotes } = optimizer
  const allPositiveGross = quotes.filter((quote) => !quote.error && quote.amountOut > quote.amountIn)
  const positiveGross = allPositiveGross.filter((quote) => !excludedRouteIds.has(quote.route.id))
  if (positiveGross.length === 0) {
    const best = allPositiveGross[0] || quotes[0]
    return {
      report: {
        status: 'NO_SHOT',
        evidence: `${rpcRole}_SAME_BLOCK_IDENTITY_AND_EXACT_QUOTES_NO_SIGNATURE_NO_BROADCAST`,
        reasons: [allPositiveGross.length > 0 ? 'ROUTES_AWAITING_RELEVANT_STATE_CHANGE' : 'NO_POSITIVE_GROSS_QUOTE'],
        blockNumber,
        blockTimestamp: block.timestamp,
        wallet: WALLET,
        walletBalanceEth: formatEther(walletBalance),
        nonceLatest,
        noncePending,
        route: best.route.symbols.join(' -> '),
        pools: best.route.steps.map((step) => step.pool),
        bestAmountInEth: formatEther(best.amountIn),
        bestAmountOutEth: formatEther(best.amountOut),
        bestGrossEth: formatEther(best.amountOut - best.amountIn),
        dynamicMaximumPrincipalEth: formatEther(sizing.spendableWei),
        principalPolicy: 'AVAILABLE_WALLET_BALANCE_MINUS_GAS_AND_RESERVE_NO_FIXED_CAP',
        lifetimeEarnGasSurplusEth: formatEther(gasSolvency.earnGasSurplusWei ?? gasSolvency.surplusWei),
        sizingAlgorithm: EARN_SIZING_ALGORITHM,
        quoteMode: optimizer.quoteMode,
        exactQuoteCount: optimizer.exactQuoteCount,
        maximumExactQuoteCount: optimizer.maximumExactQuoteCount,
        routeGraphCount: optimizer.routeGraphCount,
        shortlistedRouteCount: optimizer.shortlistedRouteCount,
        quarantinedRouteCount: excludedRouteIds.size,
        ...routeBookEvidence(routeBook),
      },
    }
  }
  const deadline = block.timestamp + DEADLINE_SECONDS
  const observedFeePerGas = [gasPrice, fees.maxFeePerGas || 0n].reduce((left, right) => (left > right ? left : right))
  const minimumNetProfitWei = parseEther(runtimeConfig.earnLiveMinNetWeth)
  const minimumQuoteHeadroomWei = parseEther(runtimeConfig.earnLiveMinHeadroomWeth)
  const evaluations = []
  const gasCandidates = selectEarnOnHoodGasCandidates(
    positiveGross,
    candidateHint ? 1 : focusPools.length > 0 ? 2 : EARN_ROUTE_DISCOVERY_POLICY.maximumGasCandidates,
    { observedFeePerGasWei: observedFeePerGas },
  )
  const identityChecks = await mapWithConcurrency(gasCandidates, 4, async (candidate) => {
    if (!managedExact) return { candidate, error: null }
    try {
      await assertDynamicRouteIdentity(client, blockNumber, [candidate.route], routeBook)
      return { candidate, error: null }
    } catch (error) {
      return { candidate, error: errorText(error) }
    }
  })
  for (const { candidate, error: identityError } of identityChecks) {
    if (identityError) {
      evaluations.push({ candidate, reason: identityError })
      continue
    }
    try {
      const provisionalPath = routePath(candidate.route, candidate.amountIn, candidate.amountIn + 1n)
      const provisionalGas = await client.estimateContractGas({
        account: WALLET,
        address: BATCH_ROUTER,
        abi: batchRouterAbi,
        functionName: 'swapExactIn',
        args: [[provisionalPath], deadline, true, '0x'],
        value: candidate.amountIn,
        blockNumber,
      })
      let bounds = deriveEarnOnHoodExecutionBounds({
        amountInWei: candidate.amountIn,
        quotedAmountOutWei: candidate.amountOut,
        estimatedGas: provisionalGas,
        observedFeePerGasWei: observedFeePerGas,
        minimumNetProfitWei,
        minimumQuoteHeadroomWei,
      })
      // P0 fail-closed rule: an impossible protected minOut is never sent to
      // estimateGas. A gross-positive/net-negative quote is a normal NO_SHOT.
      if (!bounds.executable) {
        evaluations.push({ candidate, bounds, reason: bounds.reason })
        continue
      }
      let transactionPath = routePath(candidate.route, candidate.amountIn, bounds.minimumAmountOutWei)
      const finalGasEstimate = await client.estimateContractGas({
        account: WALLET,
        address: BATCH_ROUTER,
        abi: batchRouterAbi,
        functionName: 'swapExactIn',
        args: [[transactionPath], deadline, true, '0x'],
        value: candidate.amountIn,
        blockNumber,
      })
      bounds = deriveEarnOnHoodExecutionBounds({
        amountInWei: candidate.amountIn,
        quotedAmountOutWei: candidate.amountOut,
        estimatedGas: finalGasEstimate,
        observedFeePerGasWei: observedFeePerGas,
        minimumNetProfitWei,
        minimumQuoteHeadroomWei,
      })
      transactionPath = routePath(candidate.route, candidate.amountIn, bounds.minimumAmountOutWei)
      let reason = null
      if (!bounds.executable) reason = bounds.reason
      else if (bounds.maximumGasCostWei > perAttemptGasCeilingWei) reason = 'PER_ATTEMPT_GAS_CEILING_EXCEEDED'
      else if (
        !preservesEarnOnHoodLongTermProfit(
          gasSolvency.earnGasSurplusWei ?? gasSolvency.surplusWei,
          bounds.maximumGasCostWei,
        )
      ) {
        reason = 'LIFETIME_GAS_SOLVENCY_WOULD_BREAK'
      } else if (walletBalance < candidate.amountIn + bounds.maximumGasCostWei + retainedWalletReserveWei) {
        reason = 'INSUFFICIENT_WALLET_BALANCE_AND_RESERVE'
      }
      if (reason) {
        evaluations.push({ candidate, bounds, finalGasEstimate, reason })
        continue
      }
      const data = encodeFunctionData({
        abi: batchRouterAbi,
        functionName: 'swapExactIn',
        args: [[transactionPath], deadline, true, '0x'],
      })
      await client.call({ account: WALLET, to: BATCH_ROUTER, data, value: candidate.amountIn, blockNumber })
      evaluations.push({ candidate, bounds, transactionPath, finalGasEstimate, data, reason: null })
    } catch (error) {
      evaluations.push({ candidate, reason: errorText(error) })
    }
  }
  const executableEvaluations = evaluations.filter((item) => item.reason === null)
  executableEvaluations.sort((left, right) => {
    if (left.bounds.quotedNetAtGasCapWei !== right.bounds.quotedNetAtGasCapWei) {
      return left.bounds.quotedNetAtGasCapWei > right.bounds.quotedNetAtGasCapWei ? -1 : 1
    }
    return left.bounds.maximumGasCostWei < right.bounds.maximumGasCostWei ? -1 : 1
  })
  const selected = executableEvaluations[0]
  if (!selected) {
    const best = evaluations[0]
    return {
      report: {
        status: 'NO_SHOT',
        evidence: `${rpcRole}_SAME_BLOCK_GROSS_POSITIVE_BUT_NET_REJECTED_NO_SIGNATURE_NO_BROADCAST`,
        reasons: [...new Set(evaluations.map((item) => item.reason).filter(Boolean))],
        blockNumber,
        blockTimestamp: block.timestamp,
        wallet: WALLET,
        walletBalanceEth: formatEther(walletBalance),
        nonceLatest,
        noncePending,
        route: best.candidate.route.symbols.join(' -> '),
        bestAmountInEth: formatEther(best.candidate.amountIn),
        bestAmountOutEth: formatEther(best.candidate.amountOut),
        bestGrossEth: formatEther(best.candidate.amountOut - best.candidate.amountIn),
        bestQuotedNetAtGasCapEth: best.bounds ? formatEther(best.bounds.quotedNetAtGasCapWei) : null,
        dynamicMaximumPrincipalEth: formatEther(sizing.spendableWei),
        principalPolicy: 'AVAILABLE_WALLET_BALANCE_MINUS_GAS_AND_RESERVE_NO_FIXED_CAP',
        lifetimeEarnGasSurplusEth: formatEther(gasSolvency.earnGasSurplusWei ?? gasSolvency.surplusWei),
        routeGraphCount: optimizer.routeGraphCount,
        shortlistedRouteCount: optimizer.shortlistedRouteCount,
        quarantinedRouteCount: excludedRouteIds.size,
        ...routeBookEvidence(routeBook),
      },
    }
  }
  const { candidate, bounds, transactionPath, finalGasEstimate, data } = selected
  const quoteBracket = earnOnHoodQuoteBracket({
    quotes,
    routeId: candidate.route.id,
    selectedAmountInWei: candidate.amountIn,
    spendableWei: sizing.spendableWei,
  })
  const report = {
    status: 'SHOT_READY',
    evidence: `${rpcRole}_SAME_BLOCK_IDENTITY_QUOTE_FINAL_CALL_AND_GAS_ESTIMATE_NO_SIGNATURE_NO_BROADCAST`,
    reasons: [],
    blockNumber,
    blockTimestamp: block.timestamp,
    wallet: WALLET,
    walletBalanceEth: formatEther(walletBalance),
    nonceLatest,
    noncePending,
    route: candidate.route.symbols.join(' -> '),
    pools: candidate.route.steps.map((step) => step.pool),
    amountInEth: formatEther(candidate.amountIn),
    quotedAmountOutEth: formatEther(candidate.amountOut),
    quotedGrossEth: formatEther(bounds.grossProfitWei),
    finalGasEstimate,
    gasLimit: bounds.gasLimit,
    maxFeePerGasWei: bounds.maxFeePerGas,
    maximumGasCostEth: formatEther(bounds.maximumGasCostWei),
    minimumAmountOutEth: formatEther(bounds.minimumAmountOutWei),
    protectedMinimumNetProfitEth: formatEther(minimumNetProfitWei),
    quoteHeadroomEth: formatEther(bounds.quoteHeadroomWei),
    quotedNetAtGasCapEth: formatEther(bounds.quotedNetAtGasCapWei),
    retainedWalletReserveEth: formatEther(retainedWalletReserveWei),
    dynamicMaximumPrincipalEth: formatEther(sizing.spendableWei),
    principalPolicy: 'AVAILABLE_WALLET_BALANCE_MINUS_GAS_AND_RESERVE_NO_FIXED_CAP',
    lifetimeEarnGasSurplusEth: formatEther(gasSolvency.earnGasSurplusWei ?? gasSolvency.surplusWei),
    sizingAlgorithm: EARN_SIZING_ALGORITHM,
    quoteMode: optimizer.quoteMode,
    coarseQuoteCount: optimizer.coarseQuoteCount,
    refinementQuoteCount: optimizer.refinementQuoteCount,
    exactQuoteCount: optimizer.exactQuoteCount,
    maximumExactQuoteCount: optimizer.maximumExactQuoteCount,
    publicScreenBlockNumber: optimizer.publicScreenBlockNumber,
    routeGraphCount: optimizer.routeGraphCount,
    shortlistedRouteCount: optimizer.shortlistedRouteCount,
    quarantinedRouteCount: excludedRouteIds.size,
    ...routeBookEvidence(routeBook),
    sizingBracketLowerEth: formatEther(quoteBracket.lowerBoundWei),
    sizingBracketUpperEth: formatEther(quoteBracket.upperBoundWei),
    deadline,
  }
  return {
    report,
    candidate,
    bounds,
    transactionPath,
    data,
    deadline,
    walletBalance,
    nonceLatest,
    retainedWalletReserveWei,
    candidateHint: {
      routeId: candidate.route.id,
      route: candidate.route,
      routeBookSnapshot: {
        source: routeBook.source,
        blockNumber: routeBook.blockNumber,
        refreshMode: routeBook.refreshMode || 'FULL_CANONICAL_FACTORY_REFRESH',
        discoveredFactoryPools: routeBook.discoveredFactoryPools,
        reviewedLegacyPools: routeBook.reviewedLegacyPools,
        rejected: [],
        pools: [
          ...new Map(
            candidate.route.steps.map((step) => [
              step.pool.toLowerCase(),
              routeBook.poolByAddress.get(step.pool.toLowerCase()),
            ]),
          ).values(),
        ],
      },
      amountInWei: candidate.amountIn,
      lowerBoundWei: quoteBracket.lowerBoundWei,
      upperBoundWei: quoteBracket.upperBoundWei,
      publicBlockNumber: blockNumber,
    },
  }
}

async function preflight({ print = true } = {}) {
  const sharedContext = sharedExecutionContext()
  const watcherPid = activeLock(dualWatchLockPath)
  const gasSolvency = currentGasSolvency(sharedContext)
  const focusPools = String(process.env.EARN_WAKE_POOLS || process.env.EARN_WAKE_POOL || '')
    .split(',')
    .filter(Boolean)
    .map((value) => getAddress(value))
  const auditRecords = readJsonLines(sharedContext ? sharedAuditPath : auditPath)
  const routeQuarantine = earnOnHoodRouteQuarantine(auditRecords)
  const excludedRouteIds = new Set(routeQuarantine.map((entry) => entry.routeId))
  let screened
  try {
    screened = await prepareOnClient(discoveryClient, gasSolvency, 'PUBLIC_RPC_SCREEN', {
      focusPools,
      excludedRouteIds,
    })
  } catch (error) {
    if (!/managed RPC fallback (?:per-wake|daily) logical-call budget exhausted/i.test(errorText(error))) throw error
    const report = {
      status: 'NO_SHOT_RPC_BUDGET_EXHAUSTED',
      evidence: 'BOUNDED_READ_FAILURE_BEFORE_SIGNER_LOAD_OR_MUTATION',
      reasons: ['MANAGED_RPC_FALLBACK_BUDGET_EXHAUSTED'],
      error: errorText(error),
      rpc: managedFallbackEvidence(),
    }
    appendAudit('preflight', report)
    if (print) console.log(stringify(report))
    return { report }
  }
  screened.report.rpc = managedFallbackEvidence()
  if (screened.report.status !== 'SHOT_READY') {
    appendAudit('preflight', screened.report)
    if (print) console.log(stringify(screened.report))
    return screened
  }
  assertLiveTransport(runtimeConfig)
  if (sharedContext) assertSharedAuthorization(sharedContext, { maximumGasCostWei: screened.bounds.maximumGasCostWei })
  if (sharedContext) {
    appendAudit(
      'earn_watch_exact_preflight_started',
      {
        authorizationId: sharedContext.authorizationId,
        publicScreenBlockNumber: screened.report.blockNumber,
        route: screened.report.route,
        amountInWei: screened.candidate.amountIn,
        quotedNetAtGasCapWei: screened.bounds.quotedNetAtGasCapWei,
        sourceReceivedAt: process.env.EARN_WAKE_RECEIVED_AT || null,
        sourceBlockNumber: process.env.EARN_WAKE_BLOCK_NUMBER || null,
        sourceTransactionHash: process.env.EARN_WAKE_TRANSACTION_HASH || null,
      },
      { mirrorShared: true },
    )
  }
  const exactGasSolvency = currentGasSolvency(sharedContext)
  const prepared = await prepareOnClient(executionClient, exactGasSolvency, 'MANAGED_RPC_EXACT', {
    candidateHint: screened.candidateHint,
    excludedRouteIds,
  })
  prepared.report.rpc = managedFallbackEvidence()
  if (!sharedContext && watcherPid) {
    prepared.report.status = 'NO_SHOT'
    prepared.report.reasons = [...prepared.report.reasons, `DUAL_WATCHER_ACTIVE_PID_${watcherPid}`]
  }
  appendAudit('preflight', prepared.report)
  if (print) console.log(stringify(prepared.report))
  return prepared
}

async function execute() {
  if (process.env.EARN_LIVE_ARM !== '1') throw new Error('execution requires EARN_LIVE_ARM=1')
  const sharedContext = sharedExecutionContext()
  const release = acquireWalletLock()
  try {
    if (activeLock(dualWatchLockPath) && !sharedContext)
      throw new Error('dual watcher is active; disarm and stop it before EarnOnHood execution')
    if (sharedContext) assertSharedAuthorization(sharedContext)
    const prepared = await preflight({ print: false })
    if (prepared.report.status !== 'SHOT_READY') {
      appendAudit('execution_skipped', { reasons: prepared.report.reasons })
      console.log(stringify({ ...prepared.report, status: 'NO_SHOT_NO_SIGNATURE_NO_BROADCAST' }))
      return
    }
    const latestBlock = await executionClient.getBlock()
    const latestBlockNumber = latestBlock.number
    const [latestNonce, pendingNonce, latestWalletBalance, latestGasPrice, latestFees] = await Promise.all([
      executionClient.getTransactionCount({ address: WALLET, blockTag: 'latest' }),
      executionClient.getTransactionCount({ address: WALLET, blockTag: 'pending' }),
      executionClient.getBalance({ address: WALLET, blockNumber: latestBlockNumber }),
      executionClient.getGasPrice(),
      executionClient.estimateFeesPerGas(),
    ])
    if (latestNonce !== prepared.nonceLatest || pendingNonce !== latestNonce) {
      throw new Error('nonce changed after preflight')
    }
    const latestObservedFeePerGas = [latestGasPrice, latestFees.maxFeePerGas || 0n].reduce((left, right) =>
      left > right ? left : right,
    )
    if (latestObservedFeePerGas > prepared.bounds.maxFeePerGas) {
      throw new Error('fee increased beyond the protected preflight cap')
    }
    if (
      latestWalletBalance <
      prepared.candidate.amountIn + prepared.bounds.maximumGasCostWei + prepared.retainedWalletReserveWei
    ) {
      throw new Error('wallet balance fell below the protected principal, gas and reserve requirement')
    }
    const sharedAuthorization = sharedContext
      ? assertSharedAuthorization(sharedContext, { maximumGasCostWei: prepared.bounds.maximumGasCostWei })
      : null
    if (
      sharedAuthorization &&
      latestNonce !== expectedDualWalletNonce(sharedAuthorization.arm, sharedAuthorization.usage)
    ) {
      throw new Error('shared EarnOnHood nonce differs from the authorization ledger')
    }
    const latestDeadline = latestBlock.timestamp + DEADLINE_SECONDS
    const latestData = encodeFunctionData({
      abi: batchRouterAbi,
      functionName: 'swapExactIn',
      args: [[prepared.transactionPath], latestDeadline, true, '0x'],
    })
    const finalGateStartedAt = Date.now()
    const [latestQuote, , latestGasEstimate] = await Promise.all([
      exactQuote(executionClient, prepared.candidate.route, prepared.candidate.amountIn, latestBlockNumber),
      executionClient.call({
        account: WALLET,
        to: BATCH_ROUTER,
        data: latestData,
        value: prepared.candidate.amountIn,
        blockNumber: latestBlockNumber,
      }),
      executionClient.estimateGas({
        account: WALLET,
        to: BATCH_ROUTER,
        data: latestData,
        value: prepared.candidate.amountIn,
        blockNumber: latestBlockNumber,
      }),
    ])
    const finalGateDurationMs = Date.now() - finalGateStartedAt
    if (latestQuote < prepared.bounds.minimumAmountOutWei)
      throw new Error('quote fell below the protected output floor')
    if (latestGasEstimate > prepared.bounds.gasLimit) {
      throw new Error('latest gas estimate exceeds the protected gas limit')
    }

    const plan = buildMutationPlan('earnonhood-execute', {
      chainId: CHAIN_ID,
      wallet: WALLET,
      authorizationId: sharedContext?.authorizationId || null,
      nonce: latestNonce,
      to: BATCH_ROUTER,
      value: prepared.candidate.amountIn,
      dataCommitment: keccak256(latestData),
      gasLimit: prepared.bounds.gasLimit,
      maxFeePerGas: prepared.bounds.maxFeePerGas,
      maxPriorityFeePerGas: 0n,
      routeId: prepared.candidate.route.id,
      route: prepared.candidate.route.symbols,
      routeSteps: prepared.candidate.route.steps.map((step) => ({
        pool: step.pool,
        tokenIn: step.tokenIn,
        tokenOut: step.tokenOut,
      })),
      pools: prepared.candidate.route.steps.map((step) => step.pool),
      quotedAmountOutWei: latestQuote,
      minimumAmountOutWei: prepared.bounds.minimumAmountOutWei,
      protectedMinimumNetProfitWei: parseEther(runtimeConfig.earnLiveMinNetWeth),
      walletBalanceBeforeWei: latestWalletBalance,
      lifetimeGasSurplusBeforeWei: sharedAuthorization?.usage.earnGasSurplusWei || null,
      principalPolicy: 'AVAILABLE_WALLET_BALANCE_MINUS_GAS_AND_RESERVE_NO_FIXED_CAP',
      routeCommitment: EARN_ROUTE_COMMITMENT,
      sourceReceivedAt: process.env.EARN_WAKE_RECEIVED_AT || null,
      sourceBlockNumber: process.env.EARN_WAKE_BLOCK_NUMBER || null,
      sourceTransactionHash: process.env.EARN_WAKE_TRANSACTION_HASH || null,
      sizingAlgorithm: EARN_SIZING_ALGORITHM,
      quoteMode: prepared.report.quoteMode,
      exactQuoteCount: prepared.report.exactQuoteCount,
      finalGateBlockNumber: latestBlockNumber,
      finalGateDurationMs,
    })
    appendAudit('mutation_plan', plan, { mirrorShared: Boolean(sharedContext) })
    if (sharedContext)
      assertSharedAuthorization(sharedContext, { maximumGasCostWei: prepared.bounds.maximumGasCostWei })
    const account = loadAccount()
    const serializedTransaction = await account.signTransaction({
      chainId: CHAIN_ID,
      type: 'eip1559',
      to: BATCH_ROUTER,
      value: prepared.candidate.amountIn,
      data: latestData,
      gas: prepared.bounds.gasLimit,
      maxFeePerGas: prepared.bounds.maxFeePerGas,
      maxPriorityFeePerGas: 0n,
      nonce: latestNonce,
    })
    const hash = keccak256(serializedTransaction)
    const rawPrivateRef = persistSignedRaw(signedTransactionDir, hash, serializedTransaction)
    const signedAttempt = {
      kind: plan.kind,
      authorizationId: sharedContext?.authorizationId || null,
      intentId: plan.intentId,
      planHash: plan.planHash,
      hash,
      nonce: latestNonce,
      rawPrivateRef,
    }
    appendAudit('mutation_signed', signedAttempt, { mirrorShared: Boolean(sharedContext) })
    if (sharedContext) {
      assertSharedAuthorization(sharedContext, {
        maximumGasCostWei: prepared.bounds.maximumGasCostWei,
        currentSignedAttempt: { event: 'mutation_signed', ...signedAttempt },
      })
    }
    try {
      const broadcast = await broadcastSameRawToSequencer({ serializedTransaction, managedRpcUrl: rpcUrl })
      appendAudit(
        'broadcast_result',
        {
          kind: plan.kind,
          authorizationId: sharedContext?.authorizationId || null,
          hash,
          directSequencerStatus: broadcast.direct.status,
          managedFallbackStatus: broadcast.fallback?.status || null,
        },
        { mirrorShared: Boolean(sharedContext) },
      )
    } catch (error) {
      appendAudit(
        'broadcast_unknown',
        { kind: plan.kind, authorizationId: sharedContext?.authorizationId || null, hash, reason: errorText(error) },
        { mirrorShared: Boolean(sharedContext) },
      )
    }
    let receipt
    try {
      receipt = await executionClient.waitForTransactionReceipt({
        hash,
        confirmations: runtimeConfig.finalityConfirmations,
        timeout: 120_000,
      })
    } catch (error) {
      appendAudit(
        'receipt_unknown',
        { kind: plan.kind, authorizationId: sharedContext?.authorizationId || null, hash, reason: errorText(error) },
        { mirrorShared: Boolean(sharedContext) },
      )
      throw new Error(`EarnOnHood receipt is UNKNOWN; do not reuse nonce ${latestNonce}: ${hash}`)
    }
    const gasSpentWei = receipt.gasUsed * receipt.effectiveGasPrice
    if (receipt.status !== 'success') {
      appendAudit(
        'mutation_reverted',
        {
          kind: plan.kind,
          authorizationId: sharedContext?.authorizationId || null,
          hash,
          intentId: plan.intentId,
          planHash: plan.planHash,
          gasSpentWei,
          blockNumber: receipt.blockNumber,
          routeId: prepared.candidate.route.id,
          pools: prepared.candidate.route.steps.map((step) => step.pool),
          quotedAmountOutWei: latestQuote,
          minimumAmountOutWei: prepared.bounds.minimumAmountOutWei,
        },
        { mirrorShared: Boolean(sharedContext) },
      )
      const result = {
        status: 'CONFIRMED_REVERTED',
        evidence: 'CANONICAL_REVERT_RECEIPT',
        transaction: hash,
        explorer: `https://robinhoodchain.blockscout.com/tx/${hash}`,
        blockNumber: receipt.blockNumber,
        routeId: prepared.candidate.route.id,
        pools: prepared.candidate.route.steps.map((step) => step.pool),
        route: prepared.candidate.route.symbols.join(' -> '),
        amountInEth: formatEther(prepared.candidate.amountIn),
        gasUsed: receipt.gasUsed,
        effectiveGasPriceWei: receipt.effectiveGasPrice,
        gasSpentEth: formatEther(gasSpentWei),
        dynamicMaximumPrincipalEth: prepared.report.dynamicMaximumPrincipalEth,
        principalPolicy: prepared.report.principalPolicy,
        rpc: prepared.report.rpc,
      }
      console.log(stringify(result))
      return result
    }
    const [walletBalanceBeforeBlock, walletBalanceAfterBlock] = await Promise.all([
      executionClient.getBalance({ address: WALLET, blockNumber: receipt.blockNumber - 1n }),
      executionClient.getBalance({ address: WALLET, blockNumber: receipt.blockNumber }),
    ])
    const realizedNetWei = walletBalanceAfterBlock - walletBalanceBeforeBlock
    const receiptRoute = decodeEarnOnHoodReceiptRoute(receipt, prepared.candidate.route, prepared.candidate.amountIn)
    const inferredGrossProfitWei = receiptRoute.finalAmountOutWei - prepared.candidate.amountIn
    const receiptDerivedNetWei = inferredGrossProfitWei - gasSpentWei
    if (receiptDerivedNetWei !== realizedNetWei) {
      throw new Error('EarnOnHood receipt swaps, canonical Gas, and native wallet balance delta disagree')
    }
    const result = {
      status: receipt.status === 'success' && realizedNetWei > 0n ? 'CONFIRMED_NET_PROFIT' : 'CONFIRMED_NO_PROFIT',
      evidence: 'CANONICAL_RECEIPT_AND_NATIVE_BALANCE_DELTA',
      transaction: hash,
      explorer: `https://robinhoodchain.blockscout.com/tx/${hash}`,
      blockNumber: receipt.blockNumber,
      routeId: prepared.candidate.route.id,
      pools: prepared.candidate.route.steps.map((step) => step.pool),
      route: prepared.candidate.route.symbols.join(' -> '),
      amountInEth: formatEther(prepared.candidate.amountIn),
      gasUsed: receipt.gasUsed,
      effectiveGasPriceWei: receipt.effectiveGasPrice,
      gasSpentEth: formatEther(gasSpentWei),
      inferredGrossProfitEth: formatEther(inferredGrossProfitWei),
      realizedNetProfitEth: formatEther(realizedNetWei),
      walletBalanceBeforeEth: formatEther(walletBalanceBeforeBlock),
      walletBalanceAfterEth: formatEther(walletBalanceAfterBlock),
      dynamicMaximumPrincipalEth: prepared.report.dynamicMaximumPrincipalEth,
      principalPolicy: prepared.report.principalPolicy,
      lifetimeEarnGasSurplusBeforeEth: prepared.report.lifetimeEarnGasSurplusEth,
      rpc: prepared.report.rpc,
    }
    appendAudit(
      'mutation_effect',
      {
        ...result,
        result: realizedNetWei > 0n ? 'CONFIRMED_SUCCESS' : 'CONFIRMED_POLICY_VIOLATION',
        kind: plan.kind,
        authorizationId: sharedContext?.authorizationId || null,
        hash,
        intentId: plan.intentId,
        planHash: plan.planHash,
        gasSpentWei,
        inferredGrossProfitWei,
        receiptFinalAmountOutWei: receiptRoute.finalAmountOutWei,
        realizedNetProfitWei: realizedNetWei,
      },
      { mirrorShared: Boolean(sharedContext) },
    )
    console.log(stringify(result))
    if (realizedNetWei <= 0n) throw new Error(`receipt succeeded but native wallet net did not increase: ${hash}`)
    return result
  } finally {
    release()
  }
}

function routeForPlan(plan) {
  if (plan.routeCommitment === EARN_ROUTE_COMMITMENT && Array.isArray(plan.routeSteps)) {
    return assertEarnRouteShape({
      id: plan.routeId,
      symbols: Array.isArray(plan.route) ? plan.route : [],
      steps: plan.routeSteps,
    })
  }
  const pools = Array.isArray(plan.pools) ? plan.pools.map((value) => String(value).toLowerCase()) : []
  return EARN_LEGACY_REVIEWED_ROUTES.find(
    (route) =>
      route.steps.length === pools.length &&
      route.steps.every((step, index) => step.pool.toLowerCase() === pools[index]),
  )
}

async function optionalTransaction(method) {
  try {
    return await method()
  } catch (error) {
    if (/not found|could not be found|unknown transaction/i.test(errorText(error))) return null
    throw error
  }
}

async function reconcile() {
  assertLiveTransport(runtimeConfig)
  const sharedContext = sharedExecutionContext()
  if (activeLock(dualWatchLockPath) && !sharedContext) {
    throw new Error('stop the dual watcher before manual EarnOnHood reconciliation')
  }
  if (sharedContext) assertSharedAuthorization(sharedContext)
  const release = acquireWalletLock()
  try {
    const sharedRecords = readJsonLines(sharedAuditPath)
    const localRecords = readJsonLines(auditPath)
    const unresolved = /** @type {Record<string, any> | null} */ (
      latestUnresolvedMutation(sharedRecords) || latestUnresolvedMutation(localRecords)
    )
    if (!unresolved) {
      const result = { status: 'CLEAN', unresolvedMutation: null }
      console.log(stringify(result))
      return result
    }
    if (unresolved.kind !== 'earnonhood-execute') {
      throw new Error(`latest unresolved mutation is not EarnOnHood: ${unresolved.kind}`)
    }
    const records = unresolved.authorizationId ? sharedRecords : localRecords
    const plan = records.findLast(
      (record) => record.event === 'mutation_plan' && record.planHash === unresolved.planHash,
    )
    if (!plan) throw new Error('EarnOnHood mutation plan is missing')
    const route = routeForPlan(plan)
    if (!route || ![EARN_ROUTE_COMMITMENT, EARN_LEGACY_ROUTE_COMMITMENT].includes(plan.routeCommitment)) {
      throw new Error('EarnOnHood mutation plan route is outside the reviewed commitment')
    }
    const rawPrivateRef = path.resolve(unresolved.rawPrivateRef || '')
    const signedRoot = `${path.resolve(signedTransactionDir)}${path.sep}`
    if (!rawPrivateRef.startsWith(signedRoot) || !fs.existsSync(rawPrivateRef)) {
      throw new Error('persisted EarnOnHood raw is missing or misplaced')
    }
    assertPrivateFile(rawPrivateRef)
    const serializedTransaction = /** @type {`0x${string}`} */ (fs.readFileSync(rawPrivateRef, 'utf8').trim())
    if (keccak256(serializedTransaction).toLowerCase() !== unresolved.hash.toLowerCase()) {
      throw new Error('persisted EarnOnHood raw transaction hash mismatch')
    }
    const parsed = parseTransaction(serializedTransaction)
    const sender = await recoverTransactionAddress({ serializedTransaction })
    if (
      sender.toLowerCase() !== WALLET.toLowerCase() ||
      Number(parsed.chainId) !== Number(plan.chainId) ||
      parsed.to?.toLowerCase() !== BATCH_ROUTER.toLowerCase() ||
      Number(parsed.nonce) !== Number(plan.nonce) ||
      BigInt(parsed.value || 0) !== BigInt(plan.value) ||
      BigInt(parsed.gas || 0) !== BigInt(plan.gasLimit) ||
      BigInt(parsed.maxFeePerGas || 0) !== BigInt(plan.maxFeePerGas) ||
      BigInt(parsed.maxPriorityFeePerGas || 0) !== BigInt(plan.maxPriorityFeePerGas) ||
      keccak256(parsed.data || '0x').toLowerCase() !== String(plan.dataCommitment).toLowerCase()
    ) {
      throw new Error('persisted EarnOnHood raw transaction differs from its immutable plan')
    }
    const [receipt, transaction, head, nonceLatest, noncePending] = await Promise.all([
      optionalTransaction(() => executionClient.getTransactionReceipt({ hash: unresolved.hash })),
      optionalTransaction(() => executionClient.getTransaction({ hash: unresolved.hash })),
      executionClient.getBlockNumber(),
      executionClient.getTransactionCount({ address: WALLET, blockTag: 'latest' }),
      executionClient.getTransactionCount({ address: WALLET, blockTag: 'pending' }),
    ])
    if (!receipt) {
      const result = {
        status: transaction ? 'RECONCILE_PENDING' : 'RECONCILE_UNKNOWN',
        evidence: 'TRANSACTION_OR_RECEIPT_NOT_FINAL_NO_NONCE_REUSE',
        transaction: unresolved.hash,
        nonceLatest,
        noncePending,
      }
      console.log(stringify(result))
      return result
    }
    if (head - receipt.blockNumber + 1n < BigInt(runtimeConfig.finalityConfirmations)) {
      const result = {
        status: 'RECONCILE_PROVISIONAL_RECEIPT',
        transaction: unresolved.hash,
        blockNumber: receipt.blockNumber,
      }
      console.log(stringify(result))
      return result
    }
    const gasSpentWei = receipt.gasUsed * receipt.effectiveGasPrice
    const mirrorShared = Boolean(unresolved.authorizationId)
    if (receipt.status !== 'success') {
      appendAudit(
        'mutation_reverted',
        {
          kind: unresolved.kind,
          authorizationId: unresolved.authorizationId || null,
          hash: unresolved.hash,
          intentId: unresolved.intentId,
          planHash: unresolved.planHash,
          gasSpentWei,
          reconciled: true,
          blockNumber: receipt.blockNumber,
          routeId: plan.routeId || route.id,
          pools: plan.routeSteps?.map((step) => step.pool) || plan.pools || [],
          quotedAmountOutWei: plan.quotedAmountOutWei || null,
          minimumAmountOutWei: plan.minimumAmountOutWei || null,
        },
        { mirrorShared },
      )
      const result = {
        status: 'RECONCILED_REVERTED',
        transaction: unresolved.hash,
        blockNumber: receipt.blockNumber,
        routeId: plan.routeId || route.id,
        pools: plan.routeSteps?.map((step) => step.pool) || plan.pools || [],
        gasSpentWei,
      }
      console.log(stringify(result))
      return result
    }
    const routeEvidence = decodeEarnOnHoodReceiptRoute(receipt, route, BigInt(plan.value))
    const inferredGrossProfitWei = routeEvidence.finalAmountOutWei - BigInt(plan.value)
    const realizedNetProfitWei = inferredGrossProfitWei - gasSpentWei
    const [balanceBeforeBlock, balanceAfterBlock] = await Promise.all([
      executionClient.getBalance({ address: WALLET, blockNumber: receipt.blockNumber - 1n }),
      executionClient.getBalance({ address: WALLET, blockNumber: receipt.blockNumber }),
    ])
    if (balanceAfterBlock - balanceBeforeBlock !== realizedNetProfitWei || realizedNetProfitWei <= 0n) {
      throw new Error('reconciled Earn receipt, Gas, and exact-block wallet balance delta disagree')
    }
    appendAudit(
      'mutation_effect',
      {
        status: 'CONFIRMED_NET_PROFIT',
        result: 'CONFIRMED_SUCCESS',
        evidence: 'CANONICAL_RECEIPT_SWAP_LOGS_AND_EXACT_BLOCK_NATIVE_BALANCE_DELTA',
        kind: unresolved.kind,
        authorizationId: unresolved.authorizationId || null,
        hash: unresolved.hash,
        transaction: unresolved.hash,
        intentId: unresolved.intentId,
        planHash: unresolved.planHash,
        blockNumber: receipt.blockNumber,
        routeId: plan.routeId || route.id,
        pools: plan.routeSteps?.map((step) => step.pool) || plan.pools || [],
        route: route.symbols.join(' -> '),
        amountInEth: formatEther(BigInt(plan.value)),
        gasSpentWei,
        gasSpentEth: formatEther(gasSpentWei),
        inferredGrossProfitWei,
        inferredGrossProfitEth: formatEther(inferredGrossProfitWei),
        realizedNetProfitWei,
        realizedNetProfitEth: formatEther(realizedNetProfitWei),
        receiptFinalAmountOutWei: routeEvidence.finalAmountOutWei,
        reconciled: true,
      },
      { mirrorShared },
    )
    const result = {
      status: 'RECONCILED_SUCCESS',
      transaction: unresolved.hash,
      blockNumber: receipt.blockNumber,
      routeId: plan.routeId || route.id,
      pools: plan.routeSteps?.map((step) => step.pool) || plan.pools || [],
      realizedNetProfitEth: formatEther(realizedNetProfitWei),
    }
    console.log(stringify(result))
    return result
  } finally {
    release()
  }
}

if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  const command = process.argv[2] || 'preflight'
  try {
    if (command === 'preflight') await preflight()
    else if (command === 'execute') await execute()
    else if (command === 'reconcile') await reconcile()
    else throw new Error(`unknown command: ${command}`)
  } catch (error) {
    console.error(stringify({ status: 'FAILED_CLOSED', error: errorText(error) }))
    process.exitCode = 1
  }
}
