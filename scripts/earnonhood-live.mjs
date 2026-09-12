import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createPublicClient,
  createWalletClient,
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
import { decodeEarnOnHoodReceiptRoute } from '../src/earnonhood-receipt.mjs'
import {
  buildEarnOnHoodProbeAmounts,
  deriveEarnOnHoodExecutionBounds,
  earnOnHoodGasSolvency,
  preservesEarnOnHoodLongTermProfit,
  selectEarnOnHoodGasCandidates,
} from '../src/earnonhood-live-policy.mjs'
import {
  EARN_BATCH_ROUTER as BATCH_ROUTER,
  EARN_POOL_ADDRESSES as ROUTE_POOLS,
  EARN_ROUTE_COMMITMENT,
  EARN_ROUTES as ROUTES,
  EARN_ROUTE_STEPS as ROUTE_STEPS,
  EARN_VAULT as VAULT,
  EARN_WETH as WETH,
} from '../src/earnonhood-routes.mjs'
import {
  DUAL_AUTHORIZATION_POLICY_VERSION,
  dualAuthorizationId,
  dualAuthorizationUsage,
  evaluateDualAuthorizationBudget,
  validateDualSignedAttempt,
} from '../src/dual-live-policy.mjs'
import { assertPrivateFile, buildMutationPlan, persistSignedRaw } from '../src/journal.mjs'
import { errorText, latestUnresolvedMutation } from '../src/policy.mjs'

const CHAIN_ID = 4_663
const PUBLIC_READ_ONLY_RPC = 'https://rpc.mainnet.chain.robinhood.com'
const WALLET = getAddress('0x77f771E83f118C32547A1291dda438a757B4b91B')
const EXPECTED_STATIC_SWAP_FEE = 3_000_000_000_000_000n
const DEADLINE_SECONDS = 45n
const MAX_GAS_EVALUATIONS = 8

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
const discoveryClient = createPublicClient({
  chain,
  transport: http(PUBLIC_READ_ONLY_RPC, { timeout: 30_000, retryCount: 2 }),
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
const signedTransactionDir = path.join(runDir, 'signed', 'earnonhood')

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

function readJsonLines(file) {
  if (!fs.existsSync(file)) return []
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
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
    arm.earnOnHood.principalPolicy !== 'AVAILABLE_WALLET_BALANCE_MINUS_GAS_AND_RESERVE_NO_FIXED_CAP'
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

async function assertProtocolIdentity(client, blockNumber) {
  const codeTargets = [VAULT, BATCH_ROUTER, WETH, ...ROUTE_POOLS]
  const [chainId, codes, routerVault, routerWeth, wethSymbol, wethDecimals, poolChecks] = await Promise.all([
    client.getChainId(),
    Promise.all(codeTargets.map((address) => client.getCode({ address, blockNumber }))),
    client.readContract({ address: BATCH_ROUTER, abi: batchRouterAbi, functionName: 'getVault', blockNumber }),
    client.readContract({ address: BATCH_ROUTER, abi: batchRouterAbi, functionName: 'getWeth', blockNumber }),
    client.readContract({ address: WETH, abi: wethAbi, functionName: 'symbol', blockNumber }),
    client.readContract({ address: WETH, abi: wethAbi, functionName: 'decimals', blockNumber }),
    Promise.all(
      ROUTE_POOLS.map(async (pool) => {
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
  if (chainId !== CHAIN_ID) throw new Error(`wrong chain id ${chainId}`)
  if (codes.some((code) => !code || code === '0x'))
    throw new Error('a canonical EarnOnHood route target has no bytecode')
  if (routerVault.toLowerCase() !== VAULT.toLowerCase() || routerWeth.toLowerCase() !== WETH.toLowerCase()) {
    throw new Error('BatchRouter dependency identity mismatch')
  }
  if (wethSymbol !== 'WETH' || wethDecimals !== 18)
    throw new Error(`WETH identity mismatch: ${wethSymbol}/${wethDecimals}`)
  for (const check of poolChecks) {
    const tokens = check.tokens.map((token) => token.toLowerCase())
    const requiredTokens = new Set(
      ROUTE_STEPS.filter((step) => step.pool.toLowerCase() === check.pool.toLowerCase()).flatMap((step) => [
        step.tokenIn.toLowerCase(),
        step.tokenOut.toLowerCase(),
      ]),
    )
    if (
      !check.initialized ||
      check.paused ||
      check.recoveryMode ||
      check.staticSwapFee !== EXPECTED_STATIC_SWAP_FEE ||
      [...requiredTokens].some((token) => !tokens.includes(token))
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

function currentGasSolvency(sharedContext) {
  if (sharedContext) return assertSharedAuthorization(sharedContext).usage
  return earnOnHoodGasSolvency(readJsonLines(auditPath))
}

async function prepareOnClient(client, gasSolvency, rpcRole) {
  const blockNumber = await client.getBlockNumber()
  const block = await client.getBlock({ blockNumber })
  await assertProtocolIdentity(client, blockNumber)
  const [walletBalance, nonceLatest, noncePending, gasPrice, fees] = await Promise.all([
    client.getBalance({ address: WALLET, blockNumber }),
    client.getTransactionCount({ address: WALLET, blockTag: 'latest' }),
    client.getTransactionCount({ address: WALLET, blockTag: 'pending' }),
    client.getGasPrice(),
    client.estimateFeesPerGas(),
  ])
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
          probePoints: runtimeConfig.earnLiveProbePoints,
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
      },
    }
  }
  const quoteInputs = ROUTES.flatMap((route) => sizing.amounts.map((amountIn) => ({ route, amountIn })))
  const quotes = await mapWithConcurrency(quoteInputs, 4, async ({ route, amountIn }) => {
    try {
      return { route, amountIn, amountOut: await exactQuote(client, route, amountIn, blockNumber), error: null }
    } catch (error) {
      return { route, amountIn, amountOut: 0n, error: errorText(error) }
    }
  })
  quotes.sort((left, right) => {
    const leftGross = left.amountOut - left.amountIn
    const rightGross = right.amountOut - right.amountIn
    return rightGross === leftGross ? 0 : rightGross > leftGross ? 1 : -1
  })
  const positiveGross = quotes.filter((quote) => !quote.error && quote.amountOut > quote.amountIn)
  if (positiveGross.length === 0) {
    const best = quotes[0]
    return {
      report: {
        status: 'NO_SHOT',
        evidence: `${rpcRole}_SAME_BLOCK_IDENTITY_AND_EXACT_QUOTES_NO_SIGNATURE_NO_BROADCAST`,
        reasons: ['NO_POSITIVE_GROSS_QUOTE'],
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
      },
    }
  }
  const deadline = block.timestamp + DEADLINE_SECONDS
  const observedFeePerGas = [gasPrice, fees.maxFeePerGas || 0n].reduce((left, right) => (left > right ? left : right))
  const minimumNetProfitWei = parseEther(runtimeConfig.earnLiveMinNetWeth)
  const minimumQuoteHeadroomWei = parseEther(runtimeConfig.earnLiveMinHeadroomWeth)
  const evaluations = []
  const gasCandidates = selectEarnOnHoodGasCandidates(positiveGross, MAX_GAS_EVALUATIONS)
  for (const candidate of gasCandidates) {
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
      },
    }
  }
  const { candidate, bounds, transactionPath, finalGasEstimate, data } = selected
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
  }
}

async function preflight({ print = true } = {}) {
  const sharedContext = sharedExecutionContext()
  const watcherPid = activeLock(dualWatchLockPath)
  const gasSolvency = currentGasSolvency(sharedContext)
  const screened = await prepareOnClient(discoveryClient, gasSolvency, 'PUBLIC_RPC_SCREEN')
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
      },
      { mirrorShared: true },
    )
  }
  const exactGasSolvency = currentGasSolvency(sharedContext)
  const prepared = await prepareOnClient(executionClient, exactGasSolvency, 'MANAGED_RPC_EXACT')
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
    const latestBlockNumber = await executionClient.getBlockNumber()
    const latestBlock = await executionClient.getBlock({ blockNumber: latestBlockNumber })
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
      latestNonce !== Number(sharedAuthorization.arm.baselineNonce) + sharedAuthorization.usage.confirmedExecutions
    ) {
      throw new Error('shared EarnOnHood nonce differs from the authorization ledger')
    }
    const latestQuote = await exactQuote(
      executionClient,
      prepared.candidate.route,
      prepared.candidate.amountIn,
      latestBlockNumber,
    )
    if (latestQuote < prepared.bounds.minimumAmountOutWei)
      throw new Error('quote fell below the protected output floor')
    const latestDeadline = latestBlock.timestamp + DEADLINE_SECONDS
    const latestData = encodeFunctionData({
      abi: batchRouterAbi,
      functionName: 'swapExactIn',
      args: [[prepared.transactionPath], latestDeadline, true, '0x'],
    })
    await executionClient.call({
      account: WALLET,
      to: BATCH_ROUTER,
      data: latestData,
      value: prepared.candidate.amountIn,
      blockNumber: latestBlockNumber,
    })
    const latestGasEstimate = await executionClient.estimateGas({
      account: WALLET,
      to: BATCH_ROUTER,
      data: latestData,
      value: prepared.candidate.amountIn,
      blockNumber: latestBlockNumber,
    })
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
      route: prepared.candidate.route.symbols,
      pools: prepared.candidate.route.steps.map((step) => step.pool),
      quotedAmountOutWei: latestQuote,
      minimumAmountOutWei: prepared.bounds.minimumAmountOutWei,
      protectedMinimumNetProfitWei: parseEther(runtimeConfig.earnLiveMinNetWeth),
      walletBalanceBeforeWei: latestWalletBalance,
      lifetimeGasSurplusBeforeWei: sharedAuthorization?.usage.earnGasSurplusWei || null,
      principalPolicy: 'AVAILABLE_WALLET_BALANCE_MINUS_GAS_AND_RESERVE_NO_FIXED_CAP',
      routeCommitment: EARN_ROUTE_COMMITMENT,
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
    const walletClient = createWalletClient({
      account,
      chain,
      transport: http(rpcUrl, { timeout: 30_000, retryCount: 0 }),
    })
    try {
      const acceptedHash = await walletClient.sendRawTransaction({ serializedTransaction })
      if (acceptedHash.toLowerCase() !== hash.toLowerCase())
        throw new Error('RPC returned a different transaction hash')
      appendAudit(
        'broadcast_accepted',
        { kind: plan.kind, authorizationId: sharedContext?.authorizationId || null, hash },
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
    const [walletBalanceBeforeBlock, walletBalanceAfterBlock] = await Promise.all([
      executionClient.getBalance({ address: WALLET, blockNumber: receipt.blockNumber - 1n }),
      executionClient.getBalance({ address: WALLET, blockNumber: receipt.blockNumber }),
    ])
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
        },
        { mirrorShared: Boolean(sharedContext) },
      )
      throw new Error(`EarnOnHood transaction reverted: ${hash}`)
    }
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
  const pools = Array.isArray(plan.pools) ? plan.pools.map((value) => String(value).toLowerCase()) : []
  return ROUTES.find(
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
  if (activeLock(dualWatchLockPath)) throw new Error('stop the dual watcher before EarnOnHood reconciliation')
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
    if (!route || plan.routeCommitment !== EARN_ROUTE_COMMITMENT) {
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
        },
        { mirrorShared },
      )
      const result = { status: 'RECONCILED_REVERTED', transaction: unresolved.hash, gasSpentWei }
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
