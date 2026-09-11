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
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { assertLiveTransport, loadRuntimeConfig } from '../src/config.mjs'
import { deriveEarnOnHoodExecutionBounds } from '../src/earnonhood-live-policy.mjs'
import { assertPrivateFile, buildMutationPlan, persistSignedRaw } from '../src/journal.mjs'
import { errorText } from '../src/policy.mjs'

const CHAIN_ID = 4_663
const WALLET = getAddress('0x77f771E83f118C32547A1291dda438a757B4b91B')
const VAULT = getAddress('0x28082618Ba2073E602230188E4F4C46e9b2169EB')
const BATCH_ROUTER = getAddress('0x2d6DD5A990a643A8B11CD06554FBC290a1a82bA6')
const WETH = getAddress('0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73')
const AI = getAddress('0x2E8c31162b855A2ffa90F6F8634643Ad6F111e18')
const MOO = getAddress('0xD9dB30BB0D2b8d2eae3826A1372117E058791e18')
const HOOD_ECOSYSTEM_POOL = getAddress('0x4188656eAFdD7634d35Ca3f98ddfBf4b403A41fA')
const STOCK_MEMES_POOL = getAddress('0x00e7B76d0C0F0370C28A07aA9d9fDF92736238A6')
const LONG_ECO_POOL = getAddress('0xcDe242535A75F8ccB5D4b14686e312c196B28855')
const ROUTES = [
  {
    id: 'WETH_AI_MOO_WETH',
    symbols: ['WETH', 'AI', 'MOO', 'WETH'],
    steps: [
      { pool: HOOD_ECOSYSTEM_POOL, tokenIn: WETH, tokenOut: AI },
      { pool: STOCK_MEMES_POOL, tokenIn: AI, tokenOut: MOO },
      { pool: LONG_ECO_POOL, tokenIn: MOO, tokenOut: WETH },
    ],
  },
  {
    id: 'WETH_MOO_AI_WETH',
    symbols: ['WETH', 'MOO', 'AI', 'WETH'],
    steps: [
      { pool: LONG_ECO_POOL, tokenIn: WETH, tokenOut: MOO },
      { pool: STOCK_MEMES_POOL, tokenIn: MOO, tokenOut: AI },
      { pool: HOOD_ECOSYSTEM_POOL, tokenIn: AI, tokenOut: WETH },
    ],
  },
]
const ROUTE_STEPS = [...new Map(ROUTES.flatMap((route) => route.steps).map((step) => [step.pool, step])).values()]
const EXPECTED_STATIC_SWAP_FEE = 3_000_000_000_000_000n
const DEADLINE_SECONDS = 45n
const DEFAULT_CANDIDATE_AMOUNTS = ['0.0005', '0.001', '0.0015', '0.002']

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
const publicClient = createPublicClient({
  chain,
  transport: http(rpcUrl || 'https://rpc.mainnet.chain.robinhood.com', { timeout: 30_000, retryCount: 1 }),
})
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const runDir = runtimeConfig.runDir ? path.resolve(runtimeConfig.runDir) : path.join(root, 'runs')
const walletLockPath = path.join(runDir, 'wallet.lock')
const dualWatchLockPath = path.join(runDir, 'dual-watch.lock')
const auditPath = path.join(runDir, 'earnonhood-audit.jsonl')
const signedTransactionDir = path.join(runDir, 'signed', 'earnonhood')

function stringify(value) {
  return JSON.stringify(value, (_, item) => (typeof item === 'bigint' ? item.toString() : item), 2)
}

function appendAudit(event, details = {}) {
  fs.mkdirSync(runDir, { recursive: true, mode: 0o700 })
  fs.appendFileSync(
    auditPath,
    `${JSON.stringify({ at: new Date().toISOString(), lane: 'earnonhood-one-shot-v1', event, ...details }, (_, item) =>
      typeof item === 'bigint' ? item.toString() : item,
    )}\n`,
    { mode: 0o600 },
  )
  fs.chmodSync(auditPath, 0o600)
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
  fs.writeFileSync(descriptor, `${process.pid} ${new Date().toISOString()} earnonhood-one-shot-v1\n`)
  return () => {
    try {
      fs.closeSync(descriptor)
    } catch {}
    try {
      fs.unlinkSync(walletLockPath)
    } catch {}
  }
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

function candidateAmounts() {
  const configured = (runtimeConfig.earnLiveAmountCandidates || DEFAULT_CANDIDATE_AMOUNTS.join(','))
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  if (configured.length === 0 || configured.length > 8)
    throw new Error('EARN_LIVE_AMOUNT_CANDIDATES must contain 1..8 values')
  const values = [...new Set(configured.map((value) => parseEther(value)))]
  if (values.some((value) => value <= 0n || value > parseEther('0.002'))) {
    throw new Error('each EarnOnHood live candidate must be within (0, 0.002] WETH')
  }
  return values
}

async function assertProtocolIdentity(blockNumber) {
  const codeTargets = [VAULT, BATCH_ROUTER, WETH, ...ROUTE_STEPS.map((step) => step.pool)]
  const [chainId, codes, routerVault, routerWeth, wethSymbol, wethDecimals, poolChecks] = await Promise.all([
    publicClient.getChainId(),
    Promise.all(codeTargets.map((address) => publicClient.getCode({ address, blockNumber }))),
    publicClient.readContract({ address: BATCH_ROUTER, abi: batchRouterAbi, functionName: 'getVault', blockNumber }),
    publicClient.readContract({ address: BATCH_ROUTER, abi: batchRouterAbi, functionName: 'getWeth', blockNumber }),
    publicClient.readContract({ address: WETH, abi: wethAbi, functionName: 'symbol', blockNumber }),
    publicClient.readContract({ address: WETH, abi: wethAbi, functionName: 'decimals', blockNumber }),
    Promise.all(
      ROUTE_STEPS.map(async (step) => {
        const [initialized, paused, recoveryMode, tokens, staticSwapFee] = await Promise.all([
          publicClient.readContract({
            address: VAULT,
            abi: vaultAbi,
            functionName: 'isPoolInitialized',
            args: [step.pool],
            blockNumber,
          }),
          publicClient.readContract({
            address: VAULT,
            abi: vaultAbi,
            functionName: 'isPoolPaused',
            args: [step.pool],
            blockNumber,
          }),
          publicClient.readContract({
            address: VAULT,
            abi: vaultAbi,
            functionName: 'isPoolInRecoveryMode',
            args: [step.pool],
            blockNumber,
          }),
          publicClient.readContract({
            address: VAULT,
            abi: vaultAbi,
            functionName: 'getPoolTokens',
            args: [step.pool],
            blockNumber,
          }),
          publicClient.readContract({
            address: VAULT,
            abi: vaultAbi,
            functionName: 'getStaticSwapFeePercentage',
            args: [step.pool],
            blockNumber,
          }),
        ])
        return { step, initialized, paused, recoveryMode, tokens, staticSwapFee }
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
    if (
      !check.initialized ||
      check.paused ||
      check.recoveryMode ||
      check.staticSwapFee !== EXPECTED_STATIC_SWAP_FEE ||
      !tokens.includes(check.step.tokenIn.toLowerCase()) ||
      !tokens.includes(check.step.tokenOut.toLowerCase())
    ) {
      throw new Error(`EarnOnHood pool boundary mismatch: ${check.step.pool}`)
    }
  }
}

async function exactQuote(route, amountIn, blockNumber) {
  const result = await publicClient.readContract({
    address: BATCH_ROUTER,
    abi: batchRouterAbi,
    functionName: 'querySwapExactIn',
    args: [[routePath(route, amountIn, 0n)], WALLET, '0x'],
    blockNumber,
  })
  return result[0][0]
}

async function preflight({ print = true } = {}) {
  assertLiveTransport(runtimeConfig)
  const watcherPid = activeLock(dualWatchLockPath)
  const blockNumber = await publicClient.getBlockNumber()
  const block = await publicClient.getBlock({ blockNumber })
  await assertProtocolIdentity(blockNumber)
  const [walletBalance, nonceLatest, noncePending, gasPrice, fees] = await Promise.all([
    publicClient.getBalance({ address: WALLET, blockNumber }),
    publicClient.getTransactionCount({ address: WALLET, blockTag: 'latest' }),
    publicClient.getTransactionCount({ address: WALLET, blockTag: 'pending' }),
    publicClient.getGasPrice(),
    publicClient.estimateFeesPerGas(),
  ])
  if (nonceLatest !== noncePending) throw new Error('wallet latest and pending nonce differ')
  const amounts = candidateAmounts()
  const quotes = await Promise.all(
    ROUTES.flatMap((route) =>
      amounts.map(async (amountIn) => ({
        route,
        amountIn,
        amountOut: await exactQuote(route, amountIn, blockNumber),
      })),
    ),
  )
  quotes.sort((left, right) => {
    const leftGross = left.amountOut - left.amountIn
    const rightGross = right.amountOut - right.amountIn
    return rightGross === leftGross ? 0 : rightGross > leftGross ? 1 : -1
  })
  const candidate = quotes.find((quote) => quote.amountOut > quote.amountIn)
  if (!candidate) {
    const best = quotes[0]
    const report = {
      status: 'NO_SHOT',
      evidence: 'SAME_BLOCK_IDENTITY_AND_EXACT_QUOTES_NO_SIGNATURE_NO_BROADCAST',
      reasons: [watcherPid ? `DUAL_WATCHER_ACTIVE_PID_${watcherPid}` : null, 'NO_POSITIVE_GROSS_QUOTE'].filter(Boolean),
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
    }
    appendAudit('preflight', report)
    if (print) console.log(stringify(report))
    return { report }
  }
  const deadline = block.timestamp + DEADLINE_SECONDS
  const observedFeePerGas = [gasPrice, fees.maxFeePerGas || 0n].reduce((left, right) => (left > right ? left : right))
  const provisionalPath = routePath(candidate.route, candidate.amountIn, candidate.amountIn + 1n)
  const provisionalGas = await publicClient.estimateContractGas({
    account: WALLET,
    address: BATCH_ROUTER,
    abi: batchRouterAbi,
    functionName: 'swapExactIn',
    args: [[provisionalPath], deadline, true, '0x'],
    value: candidate.amountIn,
    blockNumber,
  })
  const minimumNetProfitWei = parseEther(runtimeConfig.earnLiveMinNetWeth)
  const minimumQuoteHeadroomWei = parseEther(runtimeConfig.earnLiveMinHeadroomWeth)
  let bounds = deriveEarnOnHoodExecutionBounds({
    amountInWei: candidate.amountIn,
    quotedAmountOutWei: candidate.amountOut,
    estimatedGas: provisionalGas,
    observedFeePerGasWei: observedFeePerGas,
    minimumNetProfitWei,
    minimumQuoteHeadroomWei,
  })
  let transactionPath = routePath(candidate.route, candidate.amountIn, bounds.minimumAmountOutWei)
  const finalGasEstimate = await publicClient.estimateContractGas({
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
  const maximumFailedGasWei = parseEther(runtimeConfig.earnLiveMaxFailedGasWeth)
  const retainedWalletReserveWei = parseEther(runtimeConfig.earnLiveWalletReserveWeth)
  const executable =
    bounds.executable &&
    bounds.maximumGasCostWei <= maximumFailedGasWei &&
    walletBalance >= candidate.amountIn + bounds.maximumGasCostWei + retainedWalletReserveWei
  const reasons = []
  if (watcherPid) reasons.push(`DUAL_WATCHER_ACTIVE_PID_${watcherPid}`)
  if (!bounds.executable) reasons.push(bounds.reason)
  if (bounds.maximumGasCostWei > maximumFailedGasWei) reasons.push('FAILED_GAS_CAP_EXCEEDED')
  if (walletBalance < candidate.amountIn + bounds.maximumGasCostWei + retainedWalletReserveWei) {
    reasons.push('INSUFFICIENT_WALLET_BALANCE_AND_RESERVE')
  }
  const data = encodeFunctionData({
    abi: batchRouterAbi,
    functionName: 'swapExactIn',
    args: [[transactionPath], deadline, true, '0x'],
  })
  await publicClient.call({ account: WALLET, to: BATCH_ROUTER, data, value: candidate.amountIn, blockNumber })
  const report = {
    status: executable && !watcherPid ? 'SHOT_READY' : 'NO_SHOT',
    evidence: 'SAME_BLOCK_IDENTITY_QUOTE_FINAL_CALL_AND_GAS_ESTIMATE_NO_SIGNATURE_NO_BROADCAST',
    reasons,
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
    deadline,
  }
  appendAudit('preflight', report)
  if (print) console.log(stringify(report))
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

async function execute() {
  if (process.env.EARN_LIVE_ARM !== '1') throw new Error('execution requires EARN_LIVE_ARM=1')
  const release = acquireWalletLock()
  try {
    if (activeLock(dualWatchLockPath))
      throw new Error('dual watcher is active; disarm and stop it before EarnOnHood execution')
    const prepared = await preflight({ print: false })
    if (prepared.report.status !== 'SHOT_READY') {
      appendAudit('execution_skipped', { reasons: prepared.report.reasons })
      console.log(stringify({ ...prepared.report, status: 'NO_SHOT_NO_SIGNATURE_NO_BROADCAST' }))
      return
    }
    const latestBlockNumber = await publicClient.getBlockNumber()
    const latestBlock = await publicClient.getBlock({ blockNumber: latestBlockNumber })
    const [latestNonce, pendingNonce, latestWalletBalance, latestGasPrice, latestFees] = await Promise.all([
      publicClient.getTransactionCount({ address: WALLET, blockTag: 'latest' }),
      publicClient.getTransactionCount({ address: WALLET, blockTag: 'pending' }),
      publicClient.getBalance({ address: WALLET, blockNumber: latestBlockNumber }),
      publicClient.getGasPrice(),
      publicClient.estimateFeesPerGas(),
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
    const latestQuote = await exactQuote(prepared.candidate.route, prepared.candidate.amountIn, latestBlockNumber)
    if (latestQuote < prepared.bounds.minimumAmountOutWei)
      throw new Error('quote fell below the protected output floor')
    const latestDeadline = latestBlock.timestamp + DEADLINE_SECONDS
    const latestData = encodeFunctionData({
      abi: batchRouterAbi,
      functionName: 'swapExactIn',
      args: [[prepared.transactionPath], latestDeadline, true, '0x'],
    })
    await publicClient.call({
      account: WALLET,
      to: BATCH_ROUTER,
      data: latestData,
      value: prepared.candidate.amountIn,
      blockNumber: latestBlockNumber,
    })
    const latestGasEstimate = await publicClient.estimateGas({
      account: WALLET,
      to: BATCH_ROUTER,
      data: latestData,
      value: prepared.candidate.amountIn,
      blockNumber: latestBlockNumber,
    })
    if (latestGasEstimate > prepared.bounds.gasLimit) {
      throw new Error('latest gas estimate exceeds the protected gas limit')
    }

    const plan = buildMutationPlan('earnonhood-one-shot', {
      chainId: CHAIN_ID,
      wallet: WALLET,
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
    })
    appendAudit('mutation_plan', plan)
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
    appendAudit('mutation_signed', {
      intentId: plan.intentId,
      planHash: plan.planHash,
      hash,
      nonce: latestNonce,
      rawPrivateRef,
    })
    const walletClient = createWalletClient({
      account,
      chain,
      transport: http(rpcUrl, { timeout: 30_000, retryCount: 0 }),
    })
    try {
      const acceptedHash = await walletClient.sendRawTransaction({ serializedTransaction })
      if (acceptedHash.toLowerCase() !== hash.toLowerCase())
        throw new Error('RPC returned a different transaction hash')
      appendAudit('broadcast_accepted', { hash })
    } catch (error) {
      appendAudit('broadcast_unknown', { hash, reason: errorText(error) })
    }
    let receipt
    try {
      receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 3, timeout: 120_000 })
    } catch (error) {
      appendAudit('receipt_unknown', { hash, reason: errorText(error) })
      throw new Error(`EarnOnHood receipt is UNKNOWN; do not reuse nonce ${latestNonce}: ${hash}`)
    }
    const walletBalanceAfter = await publicClient.getBalance({ address: WALLET })
    const gasSpentWei = receipt.gasUsed * receipt.effectiveGasPrice
    const realizedNetWei = walletBalanceAfter - latestWalletBalance
    const inferredGrossProfitWei = realizedNetWei + gasSpentWei
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
      walletBalanceBeforeEth: formatEther(latestWalletBalance),
      walletBalanceAfterEth: formatEther(walletBalanceAfter),
    }
    appendAudit('mutation_effect', { ...result, intentId: plan.intentId, planHash: plan.planHash })
    console.log(stringify(result))
    if (receipt.status !== 'success') throw new Error(`EarnOnHood transaction reverted: ${hash}`)
    if (realizedNetWei <= 0n) throw new Error(`receipt succeeded but native wallet net did not increase: ${hash}`)
    return result
  } finally {
    release()
  }
}

const command = process.argv[2] || 'preflight'
try {
  if (command === 'preflight') await preflight()
  else if (command === 'execute') await execute()
  else throw new Error(`unknown command: ${command}`)
} catch (error) {
  console.error(stringify({ status: 'FAILED_CLOSED', error: errorText(error) }))
  process.exitCode = 1
}
