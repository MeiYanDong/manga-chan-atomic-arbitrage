import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createPublicClient,
  createWalletClient,
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
  parseEther,
  parseTransaction,
  parseUnits,
  recoverTransactionAddress,
  toHex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { assertLiveTransport, loadRuntimeConfig } from '../src/config.mjs'
import { deriveExecutionEconomics } from '../src/execution-economics.mjs'
import { GENERIC_USDG, GENERIC_WETH, buildGenericExecutionCandidates } from '../src/generic-plan.mjs'
import { assertPrivateFile, buildMutationPlan, persistSignedRaw, stableStringify } from '../src/journal.mjs'
import {
  classifyReconciliation,
  errorText,
  evaluateGenericArmBudget,
  fixedSignerLaneConflict,
  genericSignerLaneConflict,
  isGenericOpportunityMiss,
  isTransientRpcError,
  latestUnresolvedMutation,
  selectGenericWatchCandidate,
} from '../src/policy.mjs'
import { compileGenericContract } from './generic-contract-compile.mjs'

const CHAIN_ID = 4_663
const PUBLIC_READ_ONLY_RPC = 'https://rpc.mainnet.chain.robinhood.com'
const WALLET = getAddress('0x77f771E83f118C32547A1291dda438a757B4b91B')
const POOL_MANAGER = getAddress('0x8366a39CC670B4001A1121B8F6A443A643e40951')
const V3_FACTORY = getAddress('0x1f7d7550B1b028f7571E69A784071F0205FD2EfA')
const V3_ROUTER = getAddress('0xCaf681a66D020601342297493863E78C959E5cb2')
const V3_QUOTER = getAddress('0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7')
const PAIR_HOOK = getAddress('0x16D1560630Ce74af4478d9b8AD46548A092A2000')
const EXPLORER_TX = 'https://robinhoodchain.blockscout.com/tx/'
const MINIMUM_GROSS_PROFIT = 50_000n
const MAXIMUM_AMOUNT_IN = 100_000_000n
const DEADLINE_SECONDS = 45n
const NATIVE_MARK_INPUT = parseEther('0.004')

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const RUNTIME_CONFIG = loadRuntimeConfig()
const RPC_URL = RUNTIME_CONFIG.rpcUrl || PUBLIC_READ_ONLY_RPC
const RUN_DIR = RUNTIME_CONFIG.runDir ? path.resolve(RUNTIME_CONFIG.runDir) : path.join(ROOT, 'runs')
const STATE_PATH = path.join(RUN_DIR, 'generic-state.json')
const AUDIT_PATH = path.join(RUN_DIR, 'audit.jsonl')
const LOCK_PATH = path.join(RUN_DIR, 'wallet.lock')
const FIXED_WATCH_LOCK_PATH = path.join(RUN_DIR, 'watch.lock')
const FIXED_WATCH_ARM_PATH = path.join(RUN_DIR, 'watch-arm.json')
const GENERIC_WATCH_LOCK_PATH = path.join(RUN_DIR, 'generic-watch.lock')
const GENERIC_WATCH_ARM_PATH = path.join(RUN_DIR, 'generic-watch-arm.json')
const GENERIC_WATCH_STATE_PATH = path.join(RUN_DIR, 'generic-watch-state.json')
const SIGNED_TX_DIR = path.join(RUN_DIR, 'signed')

const chain = defineChain({
  id: CHAIN_ID,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  blockExplorers: { default: { name: 'Robinhood Blockscout', url: 'https://robinhoodchain.blockscout.com' } },
})
const publicClient = createPublicClient({ chain, transport: http(RPC_URL, { timeout: 30_000, retryCount: 1 }) })
const secondaryClient = RUNTIME_CONFIG.readRpcUrl
  ? createPublicClient({ chain, transport: http(RUNTIME_CONFIG.readRpcUrl, { timeout: 30_000, retryCount: 1 }) })
  : null

const ERC20_ABI = parseAbi([
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
])
const V3_QUOTER_ABI = [
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

function writeProtectedJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const temporary = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temporary, `${stringify(value)}\n`, { mode: 0o600 })
  fs.renameSync(temporary, file)
  fs.chmodSync(file, 0o600)
}

function readJson(file) {
  if (!fs.existsSync(file)) return null
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function readAuditRecords() {
  if (!fs.existsSync(AUDIT_PATH)) return []
  return fs
    .readFileSync(AUDIT_PATH, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

function appendAudit(event, details = {}) {
  fs.mkdirSync(RUN_DIR, { recursive: true, mode: 0o700 })
  fs.appendFileSync(
    AUDIT_PATH,
    `${JSON.stringify({ at: new Date().toISOString(), lane: 'generic-v2', event, ...details }, (_, item) =>
      typeof item === 'bigint' ? item.toString() : item,
    )}\n`,
    { mode: 0o600 },
  )
}

function mutationPlan(kind, fields) {
  const plan = buildMutationPlan(kind, { lane: 'generic-v2', ...fields })
  appendAudit('mutation_intent', { kind, intentId: plan.intentId, createdAt: plan.createdAt })
  appendAudit('mutation_plan', plan)
  return plan
}

function latestUnresolved() {
  return latestUnresolvedMutation(readAuditRecords())
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

function assertFixedSignerInactive() {
  const arm = readJson(FIXED_WATCH_ARM_PATH)
  const lockExists = fs.existsSync(FIXED_WATCH_LOCK_PATH)
  let lockPid = null
  if (lockExists) {
    try {
      lockPid = Number(fs.readFileSync(FIXED_WATCH_LOCK_PATH, 'utf8').trim().split(/\s+/)[0])
    } catch {}
  }
  const conflict = fixedSignerLaneConflict({ arm, lockExists, lockPid, processIsAlive })
  if (conflict) throw new Error(`${conflict}; disarm or cleanly stop it before generic-v2 preflight`)
}

function acquireWalletLock() {
  fs.mkdirSync(RUN_DIR, { recursive: true, mode: 0o700 })
  let descriptor
  try {
    descriptor = fs.openSync(LOCK_PATH, 'wx', 0o600)
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error
    let holder = null
    try {
      holder = Number(fs.readFileSync(LOCK_PATH, 'utf8').trim().split(/\s+/)[0])
    } catch {}
    if (processIsAlive(holder)) throw new Error(`wallet lock is held by PID ${holder}`)
    fs.unlinkSync(LOCK_PATH)
    descriptor = fs.openSync(LOCK_PATH, 'wx', 0o600)
  }
  fs.writeFileSync(descriptor, `${process.pid} ${new Date().toISOString()} generic-v2\n`)
  return () => {
    try {
      fs.closeSync(descriptor)
    } catch {}
    try {
      fs.unlinkSync(LOCK_PATH)
    } catch {}
  }
}

function acquireGenericWatchLock() {
  fs.mkdirSync(RUN_DIR, { recursive: true, mode: 0o700 })
  let descriptor
  try {
    descriptor = fs.openSync(GENERIC_WATCH_LOCK_PATH, 'wx', 0o600)
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error
    const holder = genericWatchLockHolder()
    if (holder.alive) throw new Error(`generic watcher lock is held by PID ${holder.pid}`)
    fs.unlinkSync(GENERIC_WATCH_LOCK_PATH)
    descriptor = fs.openSync(GENERIC_WATCH_LOCK_PATH, 'wx', 0o600)
  }
  fs.writeFileSync(descriptor, `${process.pid} ${new Date().toISOString()} generic-v2-watch\n`)
  return () => {
    try {
      fs.closeSync(descriptor)
    } catch {}
    try {
      fs.unlinkSync(GENERIC_WATCH_LOCK_PATH)
    } catch {}
  }
}

function genericWatchLockHolder() {
  if (!fs.existsSync(GENERIC_WATCH_LOCK_PATH)) return { pid: null, alive: false }
  let pid = null
  try {
    pid = Number(fs.readFileSync(GENERIC_WATCH_LOCK_PATH, 'utf8').trim().split(/\s+/)[0])
  } catch {}
  return { pid: Number.isSafeInteger(pid) ? pid : null, alive: processIsAlive(pid) }
}

function assertGenericWatcherInactive() {
  const holder = genericWatchLockHolder()
  if (holder.alive && holder.pid !== process.pid) {
    throw new Error(`generic watcher is active as PID ${holder.pid}; stop or disarm it before this mutation`)
  }
}

function assertGenericExecutionContext(authorizationId) {
  const holder = genericWatchLockHolder()
  if (!holder.alive) {
    if (authorizationId) throw new Error('generic watcher authorization was supplied without the watcher lock')
    const arm = readJson(GENERIC_WATCH_ARM_PATH)
    const conflict = genericSignerLaneConflict({
      arm,
      lockExists: false,
      lockPid: null,
      processIsAlive,
    })
    if (conflict) throw new Error(`${conflict}; disarm it before manual generic execution`)
    return
  }
  const arm = readJson(GENERIC_WATCH_ARM_PATH)
  if (
    holder.pid !== process.pid ||
    !authorizationId ||
    arm?.status !== 'ARMED' ||
    arm.authorizationId !== authorizationId
  ) {
    throw new Error(`generic watcher controls the signing lane as PID ${holder.pid}`)
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function loadAccount() {
  let privateKey
  if (RUNTIME_CONFIG.privateKeyFile) {
    assertPrivateFile(RUNTIME_CONFIG.privateKeyFile)
    privateKey = fs.readFileSync(RUNTIME_CONFIG.privateKeyFile, 'utf8').trim()
  } else {
    if (process.platform !== 'darwin') throw new Error('Linux live commands require MANGA_PRIVATE_KEY_FILE')
    try {
      privateKey = execFileSync(
        '/usr/bin/security',
        ['find-generic-password', '-w', '-s', RUNTIME_CONFIG.keychainService],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
      ).trim()
    } catch {
      throw new Error(`macOS Keychain item ${RUNTIME_CONFIG.keychainService} was not found`)
    }
  }
  if (!/^0x[0-9a-f]{64}$/i.test(privateKey)) throw new Error('signing credential is not a 32-byte EVM private key')
  const account = privateKeyToAccount(privateKey)
  privateKey = undefined
  if (account.address.toLowerCase() !== WALLET.toLowerCase()) {
    throw new Error(`signer mismatch: expected ${WALLET}, observed ${account.address}`)
  }
  return account
}

function assertLoopbackBoardUrl(value) {
  const url = new URL(value)
  if (url.protocol !== 'http:' || !['127.0.0.1', '::1', '[::1]', 'localhost'].includes(url.hostname)) {
    throw new Error('generic board URL must use loopback HTTP')
  }
  return url
}

async function loadBoardSnapshot() {
  if (RUNTIME_CONFIG.genericBoardSnapshot) {
    return JSON.parse(fs.readFileSync(path.resolve(RUNTIME_CONFIG.genericBoardSnapshot), 'utf8'))
  }
  const url = assertLoopbackBoardUrl(RUNTIME_CONFIG.genericBoardUrl)
  const response = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(5_000) })
  if (!response.ok) throw new Error(`board snapshot HTTP ${response.status}`)
  return response.json()
}

async function boardCandidates({ limit = RUNTIME_CONFIG.genericPreflightCandidates } = {}) {
  const snapshot = await loadBoardSnapshot()
  const candidates = buildGenericExecutionCandidates(snapshot, {
    maxAgeMs: RUNTIME_CONFIG.genericMaxQuoteAgeMs,
    limit,
  })
  return { snapshot, candidates }
}

async function selectedCandidates({ opportunityId = null, limit = RUNTIME_CONFIG.genericPreflightCandidates } = {}) {
  const { snapshot, candidates: boardSelection } = await boardCandidates({ limit })
  const candidates = opportunityId
    ? boardSelection.filter((candidate) => candidate.opportunityId === opportunityId)
    : boardSelection
  if (opportunityId && candidates.length === 0) throw new Error('triggered candidate left the fresh board set')
  const quotedBlocks = await Promise.all(
    candidates.map((candidate) =>
      publicClient.getBlock({ blockNumber: candidate.quoteBlockNumber }).then((block) => ({ candidate, block })),
    ),
  )
  for (const { candidate, block } of quotedBlocks) {
    if (block.hash?.toLowerCase() !== candidate.quoteBlockHash.toLowerCase()) {
      throw new Error('board quote block hash is no longer canonical')
    }
  }
  return { snapshot, candidates }
}

async function assertCanonicalBase() {
  const chainId = await publicClient.getChainId()
  if (chainId !== CHAIN_ID) throw new Error(`wrong chain id ${chainId}`)
  const targets = [GENERIC_USDG, GENERIC_WETH, POOL_MANAGER, V3_FACTORY, V3_ROUTER, V3_QUOTER, PAIR_HOOK]
  const [codes, symbol, decimals] = await Promise.all([
    Promise.all(targets.map((address) => publicClient.getCode({ address }))),
    publicClient.readContract({ address: GENERIC_USDG, abi: ERC20_ABI, functionName: 'symbol' }),
    publicClient.readContract({ address: GENERIC_USDG, abi: ERC20_ABI, functionName: 'decimals' }),
  ])
  const missing = targets.filter((_, index) => !codes[index] || codes[index] === '0x')
  if (missing.length > 0) throw new Error(`canonical target has no bytecode: ${missing.join(', ')}`)
  if (symbol !== 'USDG' || decimals !== 6) throw new Error(`USDG identity mismatch: ${symbol}/${decimals}`)
}

async function walletSnapshot() {
  const [blockNumber, gasPrice, ethBalance, usdgBalance, nonceLatest, noncePending] = await Promise.all([
    publicClient.getBlockNumber(),
    publicClient.getGasPrice(),
    publicClient.getBalance({ address: WALLET }),
    publicClient.readContract({ address: GENERIC_USDG, abi: ERC20_ABI, functionName: 'balanceOf', args: [WALLET] }),
    publicClient.getTransactionCount({ address: WALLET, blockTag: 'latest' }),
    publicClient.getTransactionCount({ address: WALLET, blockTag: 'pending' }),
  ])
  return { blockNumber, gasPrice, ethBalance, usdgBalance, nonceLatest, noncePending }
}

async function quoteWethToUsdg(amountIn, blockNumber) {
  const path = encodePacked(['address', 'uint24', 'address'], [GENERIC_WETH, 100, GENERIC_USDG])
  const { result } = await publicClient.simulateContract({
    account: WALLET,
    address: V3_QUOTER,
    abi: V3_QUOTER_ABI,
    functionName: 'quoteExactInput',
    args: [path, amountIn],
    blockNumber,
  })
  return result[0]
}

async function nativeMark(blockNumber) {
  return quoteWethToUsdg(NATIVE_MARK_INPUT, blockNumber)
}

function nonNegativeUnits(value, decimals, label) {
  const parsed = parseUnits(value, decimals)
  if (parsed < 0n) throw new Error(`${label} must be non-negative`)
  return parsed
}

async function assertGenericDeployment(state, compiled) {
  if (
    state?.lane !== 'generic-v2' ||
    state.chainId !== CHAIN_ID ||
    state.wallet?.toLowerCase() !== WALLET.toLowerCase() ||
    !state.executor
  ) {
    throw new Error('valid generic-v2 deployment state was not found')
  }
  if (state.sourceHash !== compiled.sourceHash || state.creationCodeHash !== compiled.creationCodeHash) {
    throw new Error('local generic source/build differs from the deployed state')
  }
  const executor = getAddress(state.executor)
  const [code, operator, amountCap, profitFloor] = await Promise.all([
    publicClient.getCode({ address: executor }),
    publicClient.readContract({ address: executor, abi: compiled.abi, functionName: 'operator' }),
    publicClient.readContract({ address: executor, abi: compiled.abi, functionName: 'MAX_AMOUNT_IN' }),
    publicClient.readContract({ address: executor, abi: compiled.abi, functionName: 'MIN_GROSS_PROFIT' }),
  ])
  if (!code || code === '0x' || keccak256(code) !== state.runtimeCodeHash) {
    throw new Error('generic executor bytecode differs from the deployment ledger')
  }
  if (operator.toLowerCase() !== WALLET.toLowerCase()) throw new Error('generic executor operator mismatch')
  if (amountCap !== MAXIMUM_AMOUNT_IN || profitFloor !== MINIMUM_GROSS_PROFIT) {
    throw new Error('generic executor economic constants mismatch')
  }
  return executor
}

async function routeBoundarySnapshot(executor, route) {
  const intermediateTokens = [...new Set([route.entryToken, route.targetToken, route.exitToken])].filter(
    (token) => token.toLowerCase() !== GENERIC_USDG.toLowerCase(),
  )
  const entries = await Promise.all(
    intermediateTokens.map(async (token) => [
      token,
      await publicClient.readContract({ address: token, abi: ERC20_ABI, functionName: 'balanceOf', args: [executor] }),
    ]),
  )
  const allowances = {
    usdg: await publicClient.readContract({
      address: GENERIC_USDG,
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [executor, V3_ROUTER],
    }),
    exitToken:
      route.exitToken.toLowerCase() === GENERIC_USDG.toLowerCase()
        ? 0n
        : await publicClient.readContract({
            address: route.exitToken,
            abi: ERC20_ABI,
            functionName: 'allowance',
            args: [executor, V3_ROUTER],
          }),
  }
  return { residuals: Object.fromEntries(entries), allowances }
}

function assertCleanRouteBoundary(boundary) {
  if (Object.values(boundary.residuals).some((balance) => balance !== 0n)) {
    throw new Error('generic executor has an intermediate-token residual for the selected route')
  }
  if (boundary.allowances.usdg !== 0n || boundary.allowances.exitToken !== 0n) {
    throw new Error('generic executor has a non-zero router allowance')
  }
}

async function deployPreflight({ print = true } = {}) {
  assertFixedSignerInactive()
  const unresolved = latestUnresolved()
  if (unresolved) throw new Error(`unresolved ${unresolved.kind} mutation ${unresolved.hash}`)
  if (readJson(STATE_PATH)?.executor) throw new Error('generic executor is already recorded as deployed')
  await assertCanonicalBase()
  const compiled = compileGenericContract()
  const snapshot = await walletSnapshot()
  if (snapshot.nonceLatest !== snapshot.noncePending) throw new Error('wallet has a pending nonce')
  const seedEth = nonNegativeUnits(RUNTIME_CONFIG.genericSeedEth, 18, 'generic seed')
  const minimumEthReserve = nonNegativeUnits(RUNTIME_CONFIG.genericMinEthReserve, 18, 'minimum ETH reserve')
  if (seedEth > parseEther('0.05')) throw new Error('generic seed must be at most 0.05 ETH')
  const quotedSeedUsdg = seedEth === 0n ? 0n : await quoteWethToUsdg(seedEth, snapshot.blockNumber)
  const minimumSeedOut = (quotedSeedUsdg * 9_900n) / 10_000n
  const data = encodeDeployData({ abi: compiled.abi, bytecode: compiled.bytecode, args: [WALLET, minimumSeedOut] })
  await publicClient.call({ account: WALLET, data, value: seedEth, blockNumber: snapshot.blockNumber })
  const estimatedGas = await publicClient.estimateGas({ account: WALLET, data, value: seedEth })
  const gasLimit = (estimatedGas * 11_500n + 9_999n) / 10_000n + 10_000n
  const maxFeePerGas = (snapshot.gasPrice * 12_500n + 9_999n) / 10_000n
  const requiredEth = seedEth + gasLimit * maxFeePerGas + minimumEthReserve
  if (snapshot.ethBalance < requiredEth) throw new Error('wallet ETH cannot fund deployment, seed and reserve')
  const report = {
    status: 'GENERIC_READY_TO_DEPLOY',
    evidence: 'READ_ONLY_PREFLIGHT_NO_SIGNATURE_NO_BROADCAST',
    blockNumber: snapshot.blockNumber,
    wallet: WALLET,
    nonce: snapshot.nonceLatest,
    balances: { eth: formatEther(snapshot.ethBalance), usdg: formatUnits(snapshot.usdgBalance, 6) },
    seed: {
      eth: formatEther(seedEth),
      quotedUsdg: formatUnits(quotedSeedUsdg, 6),
      minimumUsdg: formatUnits(minimumSeedOut, 6),
    },
    deployment: {
      sourceHash: compiled.sourceHash,
      creationCodeHash: compiled.creationCodeHash,
      creationBytes: compiled.creationBytes,
      runtimeBytes: compiled.runtimeBytes,
      estimatedGas,
      gasLimit,
      gasPriceWei: snapshot.gasPrice,
      maxFeePerGas,
      maximumGasCostEth: formatEther(gasLimit * maxFeePerGas),
    },
    minimumEthReserve: formatEther(minimumEthReserve),
  }
  appendAudit('generic_deploy_preflight', report)
  if (print) console.log(stringify(report))
  return { compiled, snapshot, seedEth, minimumSeedOut, gasLimit, maxFeePerGas, report }
}

async function executionPreflight({ print = true, opportunityId = null } = {}) {
  assertFixedSignerInactive()
  const unresolved = latestUnresolved()
  if (unresolved) throw new Error(`unresolved ${unresolved.kind} mutation ${unresolved.hash}`)
  await assertCanonicalBase()
  const compiled = compileGenericContract()
  const state = readJson(STATE_PATH)
  const executor = await assertGenericDeployment(state, compiled)
  const { snapshot: board, candidates } = await selectedCandidates({
    opportunityId,
    limit: opportunityId ? 32 : RUNTIME_CONFIG.genericPreflightCandidates,
  })
  const wallet = await walletSnapshot()
  if (wallet.nonceLatest !== wallet.noncePending) throw new Error('wallet has a pending nonce')
  const principal = await publicClient.readContract({
    address: GENERIC_USDG,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [executor],
  })
  const block = await publicClient.getBlock({ blockNumber: wallet.blockNumber })
  const deadline = block.timestamp + DEADLINE_SECONDS
  const mark = await nativeMark(wallet.blockNumber)
  const minimumNetProfit = nonNegativeUnits(RUNTIME_CONFIG.genericMinNetUsdg, 6, 'minimum net profit')
  const minimumEthReserve = nonNegativeUnits(RUNTIME_CONFIG.genericMinEthReserve, 18, 'minimum ETH reserve')
  const evaluated = []
  for (const candidate of candidates) {
    try {
      if (principal < candidate.amountIn) throw new Error('principal below candidate amount')
      const selectedTokens = [candidate.route.targetToken, candidate.route.entryToken, candidate.route.exitToken]
      const tokenCodes = await Promise.all(
        [...new Set(selectedTokens)].map((address) => publicClient.getCode({ address })),
      )
      if (tokenCodes.some((code) => !code || code === '0x')) throw new Error('route contains a token without code')
      const boundary = await routeBoundarySnapshot(executor, candidate.route)
      assertCleanRouteBoundary(boundary)
      const args = [candidate.route, candidate.amountIn, MINIMUM_GROSS_PROFIT, deadline]
      const [simulation, estimatedGas, routeHash] = await Promise.all([
        publicClient.simulateContract({
          account: WALLET,
          address: executor,
          abi: compiled.abi,
          functionName: 'execute',
          args,
          blockNumber: wallet.blockNumber,
        }),
        publicClient.estimateContractGas({
          account: WALLET,
          address: executor,
          abi: compiled.abi,
          functionName: 'execute',
          args,
          blockNumber: wallet.blockNumber,
        }),
        publicClient.readContract({
          address: executor,
          abi: compiled.abi,
          functionName: 'routeHash',
          args: [candidate.route],
          blockNumber: wallet.blockNumber,
        }),
      ])
      const economics = deriveExecutionEconomics({
        simulatedGrossProfit: simulation.result[1],
        estimatedGas,
        gasPriceWei: wallet.gasPrice,
        nativeMarkInWei: NATIVE_MARK_INPUT,
        nativeMarkOutUsdg: mark,
        minimumGrossProfit: MINIMUM_GROSS_PROFIT,
        minimumNetProfit,
        profitRetentionBps: BigInt(RUNTIME_CONFIG.genericProfitRetentionBps),
      })
      if (wallet.ethBalance < economics.gasLimit * economics.maxFeePerGas + minimumEthReserve) {
        throw new Error('wallet cannot fund worst-case gas and reserve')
      }
      evaluated.push({ candidate, simulation, estimatedGas, routeHash, economics })
    } catch (error) {
      evaluated.push({ candidate, error: errorText(error) })
    }
  }
  const viable = evaluated.filter((item) => !item.error)
  viable.sort((left, right) => {
    if (left.economics.expectedNetProfitUsdg !== right.economics.expectedNetProfitUsdg) {
      return left.economics.expectedNetProfitUsdg > right.economics.expectedNetProfitUsdg ? -1 : 1
    }
    return left.candidate.amountIn < right.candidate.amountIn
      ? -1
      : left.candidate.amountIn > right.candidate.amountIn
        ? 1
        : 0
  })
  if (viable.length === 0) {
    const reasons = evaluated.map(
      (item) => `${item.candidate.routeLabel}@${formatUnits(item.candidate.amountIn, 6)}: ${item.error}`,
    )
    throw new Error(`no screened candidate passed exact executor preflight: ${reasons.join(' | ')}`)
  }
  const selected = viable[0]
  const { candidate, simulation, estimatedGas, routeHash, economics } = selected
  const report = {
    status: 'GENERIC_READY_TO_EXECUTE',
    evidence: 'EXACT_ETH_CALL_AND_GAS_ESTIMATE_NO_SIGNATURE_NO_BROADCAST',
    wallet: WALLET,
    executor,
    nonce: wallet.nonceLatest,
    board: {
      generatedAt: board.generatedAt,
      screenedCandidates: candidates.length,
      exactCandidatesPassed: viable.length,
      candidateHash: candidate.candidateHash,
      executionKey: candidate.executionKey,
      opportunityId: candidate.opportunityId,
      quoteBlockNumber: candidate.quoteBlockNumber,
      route: candidate.routeLabel,
      selectedAmountUsdg: formatUnits(candidate.amountIn, 6),
      screenedNetUsdg: formatUnits(candidate.screenedNetProfit, 6),
    },
    exact: {
      blockNumber: wallet.blockNumber,
      routeHash,
      amountInUsdg: formatUnits(candidate.amountIn, 6),
      amountOutUsdg: formatUnits(simulation.result[0], 6),
      grossProfitUsdg: formatUnits(simulation.result[1], 6),
      estimatedGas,
      estimatedGasCostUsdg: formatUnits(economics.estimatedGasCostUsdg, 6),
      expectedNetProfitUsdg: formatUnits(economics.expectedNetProfitUsdg, 6),
      minimumGrossProfitUsdg: formatUnits(economics.minimumProfit, 6),
      minimumNetProfitUsdg: formatUnits(minimumNetProfit, 6),
    },
    gas: {
      gasPriceWei: wallet.gasPrice,
      gasLimit: economics.gasLimit,
      maxFeePerGas: economics.maxFeePerGas,
      maximumCostUsdg: formatUnits(economics.maximumGasCostUsdg, 6),
    },
    balances: { executorUsdg: formatUnits(principal, 6), walletEth: formatEther(wallet.ethBalance) },
    evaluated: evaluated.map((item) =>
      item.error
        ? {
            candidateHash: item.candidate.candidateHash,
            route: item.candidate.routeLabel,
            amountInUsdg: formatUnits(item.candidate.amountIn, 6),
            status: 'REJECTED',
            reason: item.error,
          }
        : {
            candidateHash: item.candidate.candidateHash,
            route: item.candidate.routeLabel,
            amountInUsdg: formatUnits(item.candidate.amountIn, 6),
            status: 'EXACT_POSITIVE',
            grossProfitUsdg: formatUnits(item.simulation.result[1], 6),
            expectedNetProfitUsdg: formatUnits(item.economics.expectedNetProfitUsdg, 6),
            estimatedGas: item.estimatedGas,
          },
    ),
    deadline,
  }
  appendAudit('generic_execution_preflight', report)
  if (print) console.log(stringify(report))
  return {
    state,
    compiled,
    executor,
    board,
    candidate,
    wallet,
    principal,
    routeHash,
    simulation,
    economics,
    minimumNetProfit,
    deadline,
    report,
  }
}

async function signBroadcastWait(plan, transaction, assertStillAuthorized = null) {
  if (assertStillAuthorized) assertStillAuthorized()
  const account = loadAccount()
  const serializedTransaction = await account.signTransaction(transaction)
  if (assertStillAuthorized) assertStillAuthorized()
  const hash = keccak256(serializedTransaction)
  const rawPrivateRef = persistSignedRaw(SIGNED_TX_DIR, hash, serializedTransaction)
  appendAudit('mutation_signed', {
    kind: plan.kind,
    authorizationId: plan.authorizationId || null,
    intentId: plan.intentId,
    planHash: plan.planHash,
    hash,
    nonce: plan.nonce,
    rawPrivateRef,
  })
  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(RPC_URL, { timeout: 30_000, retryCount: 0 }),
  })
  if (assertStillAuthorized) assertStillAuthorized()
  try {
    const acceptedHash = await walletClient.sendRawTransaction({ serializedTransaction })
    if (acceptedHash.toLowerCase() !== hash.toLowerCase()) throw new Error('RPC returned a different transaction hash')
    appendAudit('generic_broadcast_accepted', { kind: plan.kind, hash, nonce: plan.nonce })
  } catch (error) {
    appendAudit('generic_broadcast_unknown', { kind: plan.kind, hash, nonce: plan.nonce, error: errorText(error) })
  }
  try {
    const receipt = await publicClient.waitForTransactionReceipt({
      hash,
      confirmations: RUNTIME_CONFIG.finalityConfirmations,
      timeout: 120_000,
    })
    return { hash, receipt }
  } catch (error) {
    appendAudit('generic_receipt_unknown', { kind: plan.kind, hash, error: errorText(error) })
    throw new Error(`transaction receipt is UNKNOWN; reconcile before any new nonce: ${hash}`)
  }
}

async function deploymentStateFromReceipt(plan, hash, receipt, compiled, reconciled = false) {
  if (receipt.status !== 'success' || !receipt.contractAddress) throw new Error('generic deployment receipt failed')
  const executor = getAddress(receipt.contractAddress)
  const [code, operator, seededUsdg, nonceLatest, noncePending, walletEthAfter] = await Promise.all([
    publicClient.getCode({ address: executor }),
    publicClient.readContract({ address: executor, abi: compiled.abi, functionName: 'operator' }),
    publicClient.readContract({ address: GENERIC_USDG, abi: ERC20_ABI, functionName: 'balanceOf', args: [executor] }),
    publicClient.getTransactionCount({ address: WALLET, blockTag: 'latest' }),
    publicClient.getTransactionCount({ address: WALLET, blockTag: 'pending' }),
    publicClient.getBalance({ address: WALLET }),
  ])
  if (!code || code === '0x' || operator.toLowerCase() !== WALLET.toLowerCase()) {
    throw new Error('generic deployment post-state identity mismatch')
  }
  if (seededUsdg < BigInt(plan.minimumSeedOut)) throw new Error('generic executor seed is below its protected minimum')
  const gasSpentWei = receipt.gasUsed * receipt.effectiveGasPrice
  if (nonceLatest !== Number(plan.nonce) + 1 || noncePending !== nonceLatest) {
    throw new Error('generic deployment nonce did not converge cleanly')
  }
  if (BigInt(plan.walletEthBefore) - walletEthAfter !== BigInt(plan.value) + gasSpentWei) {
    throw new Error('generic deployment wallet ETH delta differs from value plus canonical gas')
  }
  const state = {
    schemaVersion: 1,
    lane: 'generic-v2',
    name: 'bounded generic PAIR atomic arbitrage',
    status: 'deployed',
    chainId: CHAIN_ID,
    wallet: WALLET,
    executor,
    runtimeCodeHash: keccak256(code),
    sourceHash: compiled.sourceHash,
    creationCodeHash: compiled.creationCodeHash,
    policy: {
      maxAmountInUsdg: '100',
      minimumGrossProfitUsdg: '0.05',
      minimumNetProfitUsdg: RUNTIME_CONFIG.genericMinNetUsdg,
      quoteAssetCategories: ['ROBINHOOD_ASSET', 'AI', 'MEME', 'TOKEN'],
      v3Anchor: 'DIRECT_OR_ONE_WETH_BRIDGE',
      noWalletTokenApproval: true,
      manualExecutionAllowed: true,
      autonomousExecutionRequiresArm: true,
      idleRpcBehavior: 'LOOPBACK_BOARD_ONLY',
    },
    deployment: {
      hash,
      blockNumber: receipt.blockNumber.toString(),
      gasUsed: receipt.gasUsed.toString(),
      effectiveGasPriceWei: receipt.effectiveGasPrice.toString(),
      gasSpentWei: gasSpentWei.toString(),
      seedEthWei: String(plan.value),
      seededUsdgWei: seededUsdg.toString(),
      walletEthAfterWei: walletEthAfter.toString(),
      reconciled,
    },
    executions: [],
    deployedAt: new Date().toISOString(),
  }
  writeProtectedJson(STATE_PATH, state)
  appendAudit('generic_deployment_complete', { executor, hash, seededUsdg, gasSpentWei, reconciled })
  appendAudit('mutation_effect', {
    kind: plan.kind,
    hash,
    intentId: plan.intentId,
    planHash: plan.planHash,
    result: 'CONFIRMED_SUCCESS',
    blockNumber: receipt.blockNumber,
    executor,
    reconciled,
  })
  return state
}

async function deploy() {
  const release = acquireWalletLock()
  try {
    assertGenericWatcherInactive()
    assertLiveTransport(RUNTIME_CONFIG)
    const check = await deployPreflight({ print: true })
    const latest = await publicClient.getTransactionCount({ address: WALLET, blockTag: 'latest' })
    const pending = await publicClient.getTransactionCount({ address: WALLET, blockTag: 'pending' })
    if (latest !== check.snapshot.nonceLatest || pending !== latest)
      throw new Error('nonce changed after deploy preflight')
    const data = encodeDeployData({
      abi: check.compiled.abi,
      bytecode: check.compiled.bytecode,
      args: [WALLET, check.minimumSeedOut],
    })
    const plan = mutationPlan('generic-deploy', {
      chainId: CHAIN_ID,
      wallet: WALLET,
      nonce: latest,
      to: null,
      value: check.seedEth,
      dataCommitment: keccak256(data),
      gasLimit: check.gasLimit,
      maxFeePerGas: check.maxFeePerGas,
      maxPriorityFeePerGas: 0n,
      minimumSeedOut: check.minimumSeedOut,
      walletEthBefore: check.snapshot.ethBalance,
      sourceHash: check.compiled.sourceHash,
      creationCodeHash: check.compiled.creationCodeHash,
    })
    const { hash, receipt } = await signBroadcastWait(plan, {
      chainId: CHAIN_ID,
      type: 'eip1559',
      data,
      value: check.seedEth,
      gas: check.gasLimit,
      maxFeePerGas: check.maxFeePerGas,
      maxPriorityFeePerGas: 0n,
      nonce: latest,
    })
    if (receipt.status !== 'success') {
      const gasSpentWei = receipt.gasUsed * receipt.effectiveGasPrice
      appendAudit('generic_deployment_reverted', { hash, gasSpentWei, blockNumber: receipt.blockNumber })
      appendAudit('mutation_reverted', {
        kind: plan.kind,
        authorizationId: plan.authorizationId || null,
        hash,
        planHash: plan.planHash,
        gasSpentWei,
      })
      throw new Error(`generic deployment reverted: ${hash}`)
    }
    const state = await deploymentStateFromReceipt(plan, hash, receipt, check.compiled)
    console.log(
      stringify({
        status: 'GENERIC_DEPLOYMENT_CONFIRMED',
        executor: state.executor,
        transaction: hash,
        explorer: `${EXPLORER_TX}${hash}`,
        seededUsdg: formatUnits(BigInt(state.deployment.seededUsdgWei), 6),
      }),
    )
    return state
  } finally {
    release()
  }
}

function decodeExecutorEvent(receipt, compiled, executor, eventName) {
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== executor.toLowerCase()) continue
    try {
      const decoded = decodeEventLog({ abi: compiled.abi, data: log.data, topics: log.topics })
      if (decoded.eventName === eventName) return decoded.args
    } catch {}
  }
  return null
}

async function executionStateFromReceipt(plan, hash, receipt, compiled, reconciled = false) {
  const state = readJson(STATE_PATH)
  const executor = await assertGenericDeployment(state, compiled)
  if (receipt.status !== 'success') throw new Error('generic execution receipt failed')
  const executed = decodeExecutorEvent(receipt, compiled, executor, 'Executed')
  if (!executed) throw new Error('generic execution receipt lacks the Executed event')
  if (
    executed.routeHash.toLowerCase() !== String(plan.routeHash).toLowerCase() ||
    executed.targetToken.toLowerCase() !== String(plan.targetToken).toLowerCase() ||
    BigInt(executed.amountIn) !== BigInt(plan.amountIn)
  ) {
    throw new Error('generic Executed event differs from the persisted plan')
  }
  const [executorUsdg, boundary] = await Promise.all([
    publicClient.readContract({
      address: GENERIC_USDG,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [executor],
    }),
    routeBoundarySnapshot(executor, plan.route),
  ])
  assertCleanRouteBoundary(boundary)
  const expected = BigInt(plan.executorUsdgBefore) + BigInt(executed.grossProfit)
  if (
    executorUsdg !== expected ||
    BigInt(executed.amountOut) !== BigInt(executed.amountIn) + BigInt(executed.grossProfit)
  ) {
    throw new Error('generic receipt event and exact USDG post-state disagree')
  }
  const gasSpentWei = receipt.gasUsed * receipt.effectiveGasPrice
  const mark = await nativeMark(receipt.blockNumber)
  const gasSpentUsdg = (gasSpentWei * mark + NATIVE_MARK_INPUT - 1n) / NATIVE_MARK_INPUT
  const netProfit = BigInt(executed.grossProfit) - gasSpentUsdg
  if (netProfit < BigInt(plan.minimumNetProfit)) {
    throw new Error('confirmed execution net profit is below the immutable plan floor')
  }
  const record = {
    hash,
    blockNumber: receipt.blockNumber.toString(),
    blockHash: receipt.blockHash,
    candidateHash: plan.candidateHash,
    executionKey: plan.executionKey,
    opportunityId: plan.opportunityId,
    authorizationId: plan.authorizationId || null,
    routeHash: plan.routeHash,
    routeLabel: plan.routeLabel,
    targetToken: plan.targetToken,
    amountInWei: BigInt(executed.amountIn).toString(),
    amountOutWei: BigInt(executed.amountOut).toString(),
    grossProfitWei: BigInt(executed.grossProfit).toString(),
    gasUsed: receipt.gasUsed.toString(),
    effectiveGasPriceWei: receipt.effectiveGasPrice.toString(),
    gasSpentWei: gasSpentWei.toString(),
    gasSpentUsdgWei: gasSpentUsdg.toString(),
    netProfitUsdgWei: netProfit.toString(),
    executorUsdgBeforeWei: String(plan.executorUsdgBefore),
    executorUsdgAfterWei: executorUsdg.toString(),
    evidence: 'CONFIRMED_GROSS_AND_MARKED_NET',
    reconciled,
    confirmedAt: new Date().toISOString(),
  }
  state.status = 'live_gross_validated'
  if (!(state.executions || []).some((item) => item.hash === hash))
    state.executions = [...(state.executions || []), record]
  state.lastExecution = record
  writeProtectedJson(STATE_PATH, state)
  appendAudit('generic_execution_complete', record)
  appendAudit('mutation_effect', {
    kind: plan.kind,
    hash,
    intentId: plan.intentId,
    planHash: plan.planHash,
    result: 'CONFIRMED_SUCCESS',
    blockNumber: receipt.blockNumber,
    grossProfitWei: executed.grossProfit,
    netProfitUsdgWei: netProfit,
    reconciled,
  })
  return record
}

async function execute({ opportunityId = null, authorizationId = null, abortRequested = null } = {}) {
  const release = acquireWalletLock()
  try {
    assertLiveTransport(RUNTIME_CONFIG)
    assertGenericExecutionContext(authorizationId)
    const check = await executionPreflight({ print: true, opportunityId })
    if (authorizationId) {
      const liveArm = readJson(GENERIC_WATCH_ARM_PATH)
      if (liveArm?.authorizationId !== authorizationId) {
        throw new Error('generic watcher authorization id changed during exact preflight')
      }
      const usage = assertGenericWatchArm(liveArm, readJson(STATE_PATH), { allowCurrentExactPreflight: true })
      const expectedNonce = Number(liveArm.baselineNonce) + usage.confirmedExecutions
      if (check.wallet.nonceLatest !== expectedNonce) {
        throw new Error(
          `generic watcher nonce conflict: observed=${check.wallet.nonceLatest}, expected=${expectedNonce}`,
        )
      }
    }
    const currentSelection = await selectedCandidates({
      opportunityId: check.candidate.opportunityId,
      limit: opportunityId ? 32 : RUNTIME_CONFIG.genericPreflightCandidates,
    })
    if (!currentSelection.candidates.some((candidate) => candidate.opportunityId === check.candidate.opportunityId)) {
      throw new Error('selected route and amount left the positive board set after preflight')
    }
    const [latest, pending, block, gasPrice, executorUsdgBefore, walletEthBefore, boundary] = await Promise.all([
      publicClient.getTransactionCount({ address: WALLET, blockTag: 'latest' }),
      publicClient.getTransactionCount({ address: WALLET, blockTag: 'pending' }),
      publicClient.getBlock(),
      publicClient.getGasPrice(),
      publicClient.readContract({
        address: GENERIC_USDG,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [check.executor],
      }),
      publicClient.getBalance({ address: WALLET }),
      routeBoundarySnapshot(check.executor, check.candidate.route),
    ])
    if (latest !== check.wallet.nonceLatest || pending !== latest)
      throw new Error('nonce changed after execution preflight')
    if (executorUsdgBefore < check.candidate.amountIn) throw new Error('executor principal changed after preflight')
    assertCleanRouteBoundary(boundary)
    const deadline = block.timestamp + DEADLINE_SECONDS
    const baseArgs = [check.candidate.route, check.candidate.amountIn, MINIMUM_GROSS_PROFIT, deadline]
    const [simulation, estimatedGas, mark] = await Promise.all([
      publicClient.simulateContract({
        account: WALLET,
        address: check.executor,
        abi: check.compiled.abi,
        functionName: 'execute',
        args: baseArgs,
      }),
      publicClient.estimateContractGas({
        account: WALLET,
        address: check.executor,
        abi: check.compiled.abi,
        functionName: 'execute',
        args: baseArgs,
      }),
      nativeMark(block.number),
    ])
    const economics = deriveExecutionEconomics({
      simulatedGrossProfit: simulation.result[1],
      estimatedGas,
      gasPriceWei: gasPrice,
      nativeMarkInWei: NATIVE_MARK_INPUT,
      nativeMarkOutUsdg: mark,
      minimumGrossProfit: MINIMUM_GROSS_PROFIT,
      minimumNetProfit: check.minimumNetProfit,
      profitRetentionBps: BigInt(RUNTIME_CONFIG.genericProfitRetentionBps),
    })
    const minimumEthReserve = nonNegativeUnits(RUNTIME_CONFIG.genericMinEthReserve, 18, 'minimum ETH reserve')
    if (walletEthBefore < economics.gasLimit * economics.maxFeePerGas + minimumEthReserve) {
      throw new Error('wallet ETH reserve failed immediately before signing')
    }
    const protectedArgs = [check.candidate.route, check.candidate.amountIn, economics.minimumProfit, deadline]
    await publicClient.simulateContract({
      account: WALLET,
      address: check.executor,
      abi: check.compiled.abi,
      functionName: 'execute',
      args: protectedArgs,
    })
    const data = encodeFunctionData({
      abi: check.compiled.abi,
      functionName: 'execute',
      args: protectedArgs,
    })
    const assertStillAuthorized = authorizationId
      ? () => {
          if (abortRequested?.()) stopForPolicy('stop requested before signing')
          const liveArm = readJson(GENERIC_WATCH_ARM_PATH)
          if (liveArm?.authorizationId !== authorizationId) {
            throw new Error('generic watcher authorization id changed during exact preflight')
          }
          assertGenericWatchArm(liveArm, readJson(STATE_PATH), { allowCurrentExactPreflight: true })
          if (
            check.candidate.amountIn > BigInt(liveArm.maxPrincipalUsdgWei) ||
            check.candidate.screenedNetProfit < BigInt(liveArm.minimumScreenedNetProfitUsdgWei)
          ) {
            throw new Error('triggered candidate is outside the live generic watcher authorization')
          }
        }
      : null
    if (assertStillAuthorized) assertStillAuthorized()
    const plan = mutationPlan('generic-execute', {
      chainId: CHAIN_ID,
      wallet: WALLET,
      executor: check.executor,
      authorizationId,
      nonce: latest,
      to: check.executor,
      value: 0n,
      dataCommitment: keccak256(data),
      gasLimit: economics.gasLimit,
      maxFeePerGas: economics.maxFeePerGas,
      maxPriorityFeePerGas: 0n,
      candidateHash: check.candidate.candidateHash,
      executionKey: check.candidate.executionKey,
      opportunityId: check.candidate.opportunityId,
      quoteBlockNumber: check.candidate.quoteBlockNumber,
      quoteBlockHash: check.candidate.quoteBlockHash,
      routeHash: check.routeHash,
      routeLabel: check.candidate.routeLabel,
      route: check.candidate.route,
      targetToken: check.candidate.route.targetToken,
      amountIn: check.candidate.amountIn,
      simulatedAmountOut: simulation.result[0],
      simulatedGrossProfit: simulation.result[1],
      minimumGrossProfit: economics.minimumProfit,
      minimumNetProfit: check.minimumNetProfit,
      deadline,
      executorUsdgBefore,
      walletEthBefore,
    })
    const { hash, receipt } = await signBroadcastWait(
      plan,
      {
        chainId: CHAIN_ID,
        type: 'eip1559',
        to: check.executor,
        data,
        gas: economics.gasLimit,
        maxFeePerGas: economics.maxFeePerGas,
        maxPriorityFeePerGas: 0n,
        nonce: latest,
      },
      assertStillAuthorized,
    )
    if (receipt.status !== 'success') {
      const gasSpentWei = receipt.gasUsed * receipt.effectiveGasPrice
      const state = readJson(STATE_PATH)
      state.status = 'halted_after_revert'
      writeProtectedJson(STATE_PATH, state)
      appendAudit('generic_execution_reverted', { hash, gasSpentWei, blockNumber: receipt.blockNumber })
      appendAudit('mutation_reverted', {
        kind: plan.kind,
        authorizationId: plan.authorizationId || null,
        hash,
        planHash: plan.planHash,
        gasSpentWei,
      })
      throw new Error(`generic execution reverted and the lane is halted: ${hash}`)
    }
    const walletEthAfter = await publicClient.getBalance({ address: WALLET })
    const gasSpentWei = receipt.gasUsed * receipt.effectiveGasPrice
    if (walletEthBefore - walletEthAfter !== gasSpentWei) {
      const state = readJson(STATE_PATH)
      state.status = 'halted_wallet_delta_mismatch'
      writeProtectedJson(STATE_PATH, state)
      appendAudit('generic_wallet_delta_mismatch', {
        hash,
        walletEthBefore,
        walletEthAfter,
        receiptGasSpentWei: gasSpentWei,
      })
      throw new Error(
        'receipt succeeded but wallet ETH delta does not equal canonical gas; investigate external wallet use',
      )
    }
    const record = await executionStateFromReceipt(plan, hash, receipt, check.compiled)
    console.log(
      stringify({
        status: 'GENERIC_LIVE_EXECUTION_CONFIRMED',
        transaction: hash,
        explorer: `${EXPLORER_TX}${hash}`,
        route: record.routeLabel,
        amountInUsdg: formatUnits(BigInt(record.amountInWei), 6),
        amountOutUsdg: formatUnits(BigInt(record.amountOutWei), 6),
        grossProfitUsdg: formatUnits(BigInt(record.grossProfitWei), 6),
        gasSpentEth: formatEther(BigInt(record.gasSpentWei)),
        netProfitUsdg: record.netProfitUsdgWei === null ? null : formatUnits(BigInt(record.netProfitUsdgWei), 6),
        evidence: record.evidence,
      }),
    )
    return record
  } finally {
    release()
  }
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
    const [head, latestNonce, pendingNonce, transaction, receipt] = await Promise.all([
      client.getBlockNumber(),
      client.getTransactionCount({ address: WALLET, blockTag: 'latest' }),
      client.getTransactionCount({ address: WALLET, blockTag: 'pending' }),
      optionalLookup(() => client.getTransaction({ hash })),
      optionalLookup(() => client.getTransactionReceipt({ hash })),
    ])
    return { source, head, latestNonce, pendingNonce, transaction, receipt }
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
  assertLiveTransport(RUNTIME_CONFIG)
  assertGenericWatcherInactive()
  assertFixedSignerInactive()
  const release = acquireWalletLock()
  try {
    const records = readAuditRecords()
    const mutation = latestUnresolvedMutation(records)
    if (!mutation) {
      const result = { status: 'CLEAN', unresolvedMutation: null }
      console.log(stringify(result))
      return result
    }
    const plan = records.findLast((item) => item.event === 'mutation_plan' && item.planHash === mutation.planHash)
    if (!plan) throw new Error('persisted mutation plan is missing; state remains UNKNOWN')
    if (plan.lane !== 'generic-v2')
      throw new Error(`unresolved mutation belongs to ${plan.lane || 'fixed-v1'}; use its reconciler`)
    const rawFile = path.resolve(mutation.rawPrivateRef || '')
    const signedRoot = `${path.resolve(SIGNED_TX_DIR)}${path.sep}`
    if (!rawFile.startsWith(signedRoot) || !fs.existsSync(rawFile))
      throw new Error('persisted raw is missing or misplaced')
    assertPrivateFile(rawFile)
    const serializedTransaction = fs.readFileSync(rawFile, 'utf8').trim()
    if (keccak256(serializedTransaction).toLowerCase() !== mutation.hash.toLowerCase()) {
      throw new Error('persisted raw hash differs from the audit record')
    }
    const parsed = parseTransaction(serializedTransaction)
    const signer = await recoverTransactionAddress({ serializedTransaction })
    if (signer.toLowerCase() !== WALLET.toLowerCase() || parsed.nonce !== Number(plan.nonce)) {
      throw new Error('persisted raw signer or nonce differs from the plan')
    }
    assertRawMatchesPlan(parsed, plan)
    const readers = [{ client: publicClient, source: 'primary' }]
    if (secondaryClient) readers.push({ client: secondaryClient, source: 'secondary' })
    const observations = await Promise.all(
      readers.map(({ client, source }) => observeMutation(client, source, mutation.hash)),
    )
    const outcome = classifyReconciliation(observations, Number(mutation.nonce), RUNTIME_CONFIG.finalityConfirmations)
    appendAudit('generic_reconcile_observed', {
      kind: mutation.kind,
      hash: mutation.hash,
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
      const compiled = compileGenericContract()
      let effect
      if (mutation.kind === 'generic-deploy') {
        effect = await deploymentStateFromReceipt(plan, mutation.hash, outcome.receipt, compiled, true)
      } else if (mutation.kind === 'generic-execute') {
        effect = await executionStateFromReceipt(plan, mutation.hash, outcome.receipt, compiled, true)
      } else if (mutation.kind === 'generic-withdraw') {
        effect = await withdrawalStateFromReceipt(plan, mutation.hash, outcome.receipt, compiled, true)
      } else {
        throw new Error(`unsupported generic mutation kind ${mutation.kind}; state remains UNKNOWN`)
      }
      const result = { status: 'RECONCILED_SUCCESS', hash: mutation.hash, effect }
      console.log(stringify(result))
      return result
    }
    if (outcome.state === 'CONFIRMED_REVERTED') {
      const gasSpentWei = outcome.receipt.gasUsed * outcome.receipt.effectiveGasPrice
      appendAudit('generic_mutation_reverted', { kind: mutation.kind, hash: mutation.hash, gasSpentWei })
      appendAudit('mutation_reverted', {
        kind: mutation.kind,
        authorizationId: plan.authorizationId || null,
        hash: mutation.hash,
        planHash: plan.planHash,
        gasSpentWei,
      })
      const state = readJson(STATE_PATH)
      if (state) {
        state.status = 'halted_after_revert'
        writeProtectedJson(STATE_PATH, state)
      }
      const result = { status: 'RECONCILED_REVERTED', hash: mutation.hash, gasSpentWei }
      console.log(stringify(result))
      return result
    }
    if (outcome.state === 'NOT_OBSERVED' && process.argv.includes('--rebroadcast-same-raw')) {
      const results = await Promise.allSettled(
        [publicClient, ...(secondaryClient ? [secondaryClient] : [])].map(async (client) => {
          const acceptedHash = await client.sendRawTransaction({ serializedTransaction })
          if (acceptedHash.toLowerCase() !== mutation.hash.toLowerCase()) {
            throw new Error('rebroadcast endpoint returned a different transaction hash')
          }
          return acceptedHash
        }),
      )
      appendAudit('generic_same_raw_rebroadcast', {
        kind: mutation.kind,
        hash: mutation.hash,
        results: results.map((item) =>
          item.status === 'fulfilled'
            ? { status: item.status, hash: item.value }
            : { status: item.status, error: errorText(item.reason) },
        ),
      })
      console.log(stringify({ status: 'SAME_RAW_REBROADCAST', hash: mutation.hash, results }))
      return results
    }
    const result = { status: `RECONCILE_${outcome.state}`, hash: mutation.hash, outcome }
    console.log(stringify(result))
    return result
  } finally {
    release()
  }
}

async function withdrawalStateFromReceipt(plan, hash, receipt, compiled, reconciled = false) {
  const state = readJson(STATE_PATH)
  const executor = await assertGenericDeployment(state, compiled)
  if (receipt.status !== 'success') throw new Error('generic withdrawal receipt failed')
  const withdrawn = decodeExecutorEvent(receipt, compiled, executor, 'Withdrawn')
  if (
    !withdrawn ||
    withdrawn.token.toLowerCase() !== GENERIC_USDG.toLowerCase() ||
    withdrawn.to.toLowerCase() !== WALLET.toLowerCase() ||
    BigInt(withdrawn.amount) !== BigInt(plan.amount)
  ) {
    throw new Error('withdrawal event differs from the persisted plan')
  }
  const [executorAfter, walletAfter] = await Promise.all([
    publicClient.readContract({ address: GENERIC_USDG, abi: ERC20_ABI, functionName: 'balanceOf', args: [executor] }),
    publicClient.readContract({ address: GENERIC_USDG, abi: ERC20_ABI, functionName: 'balanceOf', args: [WALLET] }),
  ])
  if (executorAfter !== 0n || walletAfter !== BigInt(plan.walletUsdgBefore) + BigInt(plan.amount)) {
    throw new Error('withdrawal balances do not prove the planned effect')
  }
  const gasSpentWei = receipt.gasUsed * receipt.effectiveGasPrice
  const record = {
    hash,
    blockNumber: receipt.blockNumber.toString(),
    amountWei: String(plan.amount),
    gasSpentWei: gasSpentWei.toString(),
    executorUsdgAfterWei: executorAfter.toString(),
    walletUsdgAfterWei: walletAfter.toString(),
    reconciled,
    confirmedAt: new Date().toISOString(),
  }
  state.status = 'withdrawn'
  state.withdrawal = record
  writeProtectedJson(STATE_PATH, state)
  appendAudit('generic_withdrawal_complete', record)
  appendAudit('mutation_effect', {
    kind: plan.kind,
    hash,
    intentId: plan.intentId,
    planHash: plan.planHash,
    result: 'CONFIRMED_SUCCESS',
    blockNumber: receipt.blockNumber,
    reconciled,
  })
  return record
}

async function withdrawAll() {
  const release = acquireWalletLock()
  try {
    assertGenericWatcherInactive()
    assertLiveTransport(RUNTIME_CONFIG)
    assertFixedSignerInactive()
    const unresolved = latestUnresolved()
    if (unresolved) throw new Error(`unresolved ${unresolved.kind} mutation ${unresolved.hash}`)
    const compiled = compileGenericContract()
    const state = readJson(STATE_PATH)
    const executor = await assertGenericDeployment(state, compiled)
    const [amount, walletUsdgBefore, snapshot] = await Promise.all([
      publicClient.readContract({ address: GENERIC_USDG, abi: ERC20_ABI, functionName: 'balanceOf', args: [executor] }),
      publicClient.readContract({ address: GENERIC_USDG, abi: ERC20_ABI, functionName: 'balanceOf', args: [WALLET] }),
      walletSnapshot(),
    ])
    if (amount === 0n) throw new Error('generic executor has no USDG to withdraw')
    if (snapshot.nonceLatest !== snapshot.noncePending) throw new Error('wallet has a pending nonce')
    const data = encodeFunctionData({
      abi: compiled.abi,
      functionName: 'withdraw',
      args: [GENERIC_USDG, amount, WALLET],
    })
    await publicClient.call({ account: WALLET, to: executor, data })
    const estimatedGas = await publicClient.estimateGas({ account: WALLET, to: executor, data })
    const gasLimit = (estimatedGas * 11_000n + 9_999n) / 10_000n + 5_000n
    const maxFeePerGas = (snapshot.gasPrice * 10_500n + 9_999n) / 10_000n
    const plan = mutationPlan('generic-withdraw', {
      chainId: CHAIN_ID,
      wallet: WALLET,
      executor,
      nonce: snapshot.nonceLatest,
      to: executor,
      value: 0n,
      dataCommitment: keccak256(data),
      gasLimit,
      maxFeePerGas,
      maxPriorityFeePerGas: 0n,
      token: GENERIC_USDG,
      amount,
      walletUsdgBefore,
    })
    const { hash, receipt } = await signBroadcastWait(plan, {
      chainId: CHAIN_ID,
      type: 'eip1559',
      to: executor,
      data,
      gas: gasLimit,
      maxFeePerGas,
      maxPriorityFeePerGas: 0n,
      nonce: snapshot.nonceLatest,
    })
    if (receipt.status !== 'success') {
      const gasSpentWei = receipt.gasUsed * receipt.effectiveGasPrice
      state.status = 'halted_after_withdrawal_revert'
      writeProtectedJson(STATE_PATH, state)
      appendAudit('mutation_reverted', { kind: plan.kind, hash, planHash: plan.planHash, gasSpentWei })
      throw new Error(`generic withdrawal reverted: ${hash}`)
    }
    const record = await withdrawalStateFromReceipt(plan, hash, receipt, compiled)
    console.log(
      stringify({
        status: 'GENERIC_WITHDRAWAL_CONFIRMED',
        transaction: hash,
        explorer: `${EXPLORER_TX}${hash}`,
        amountUsdg: formatUnits(BigInt(record.amountWei), 6),
      }),
    )
    return record
  } finally {
    release()
  }
}

function configuredWatchMinimumScreenedNet() {
  const configured = RUNTIME_CONFIG.genericWatchMinScreenedNetUsdg || RUNTIME_CONFIG.genericMinNetUsdg
  return nonNegativeUnits(configured, 6, 'generic watcher minimum screened net profit')
}

function stopForPolicy(reason) {
  const error = new Error(`generic watch authorization stopped: ${reason}`)
  error.watchPolicyStop = true
  throw error
}

function genericWatchUsage(arm, deploymentState, records = readAuditRecords()) {
  const completedExecutions = (deploymentState?.executions || []).length - Number(arm.baselineExecutionCount)
  if (!Number.isSafeInteger(completedExecutions) || completedExecutions < 0) {
    throw new Error('generic watch execution baseline is ahead of the deployment ledger')
  }
  const authorized = records.filter((item) => item.authorizationId === arm.authorizationId)
  return {
    confirmedExecutions: completedExecutions,
    attempts: authorized.filter((item) => item.event === 'mutation_signed' && item.kind === 'generic-execute').length,
    failedGasWei: authorized
      .filter((item) => item.event === 'mutation_reverted' && item.kind === 'generic-execute')
      .reduce((total, item) => total + BigInt(item.gasSpentWei || 0), 0n),
    exactPreflights: authorized.filter((item) => item.event === 'generic_watch_exact_preflight_started').length,
    attemptedOpportunityIds: new Set(
      authorized
        .filter((item) => item.event === 'generic_watch_exact_preflight_started' && item.opportunityId)
        .map((item) => item.opportunityId),
    ),
  }
}

function genericWatchAuthorizationCommitment(arm) {
  return {
    schemaVersion: arm.schemaVersion,
    mode: arm.mode,
    policyVersion: arm.policyVersion,
    issuedAt: arm.issuedAt,
    expiresAt: arm.expiresAt,
    chainId: arm.chainId,
    wallet: arm.wallet,
    executor: arm.executor,
    sourceHash: arm.sourceHash,
    runtimeCodeHash: arm.runtimeCodeHash,
    maxPrincipalUsdgWei: arm.maxPrincipalUsdgWei,
    minimumGrossProfitUsdgWei: arm.minimumGrossProfitUsdgWei,
    minimumNetProfitUsdgWei: arm.minimumNetProfitUsdgWei,
    minimumScreenedNetProfitUsdgWei: arm.minimumScreenedNetProfitUsdgWei,
    profitRetentionBps: arm.profitRetentionBps,
    walletEthReserveWei: arm.walletEthReserveWei,
    maxConfirmedExecutions: arm.maxConfirmedExecutions,
    maxAttempts: arm.maxAttempts,
    maxExactPreflights: arm.maxExactPreflights,
    maxFailedGasWei: arm.maxFailedGasWei,
    baselineNonce: arm.baselineNonce,
    baselineExecutionCount: arm.baselineExecutionCount,
    pollIntervalMs: arm.pollIntervalMs,
    idleRpcBehavior: arm.idleRpcBehavior,
    escalationRpcBehavior: arm.escalationRpcBehavior,
    rpcSource: arm.rpcSource,
    principalUsdgWeiAtArm: arm.principalUsdgWeiAtArm,
    walletEthWeiAtArm: arm.walletEthWeiAtArm,
  }
}

function genericWatchAuthorizationId(arm) {
  return keccak256(toHex(stableStringify(genericWatchAuthorizationCommitment(arm))))
}

function assertGenericWatchArm(arm, deploymentState, { allowCurrentExactPreflight = false } = {}) {
  if (!arm || arm.status !== 'ARMED') stopForPolicy('not armed')
  if (
    arm.schemaVersion !== 1 ||
    arm.mode !== 'AUTO_POLICY' ||
    arm.policyVersion !== 'generic-v2-loopback-escalation-v1'
  ) {
    throw new Error('generic watch authorization policy version mismatch')
  }
  if (genericWatchAuthorizationId(arm) !== arm.authorizationId) {
    throw new Error('generic watch authorization commitment mismatch')
  }
  if (arm.chainId !== CHAIN_ID || arm.wallet?.toLowerCase() !== WALLET.toLowerCase()) {
    throw new Error('generic watch authorization chain or wallet mismatch')
  }
  if (
    arm.executor?.toLowerCase() !== deploymentState?.executor?.toLowerCase() ||
    arm.sourceHash !== deploymentState?.sourceHash ||
    arm.runtimeCodeHash !== deploymentState?.runtimeCodeHash
  ) {
    throw new Error('generic watch authorization is not bound to the current deployment')
  }
  if (!['deployed', 'live_gross_validated'].includes(deploymentState.status)) {
    throw new Error(`generic executor state ${deploymentState.status} is not eligible for automated execution`)
  }
  const configuredMinimumNet = nonNegativeUnits(RUNTIME_CONFIG.genericMinNetUsdg, 6, 'minimum net profit')
  const configuredReserve = nonNegativeUnits(RUNTIME_CONFIG.genericMinEthReserve, 18, 'minimum ETH reserve')
  if (
    BigInt(arm.minimumNetProfitUsdgWei) !== configuredMinimumNet ||
    BigInt(arm.walletEthReserveWei) !== configuredReserve ||
    Number(arm.profitRetentionBps) !== RUNTIME_CONFIG.genericProfitRetentionBps
  ) {
    throw new Error('generic watcher runtime economics differ from the signed authorization scope')
  }
  if (
    BigInt(arm.maxPrincipalUsdgWei) <= 0n ||
    BigInt(arm.maxPrincipalUsdgWei) > MAXIMUM_AMOUNT_IN ||
    BigInt(arm.minimumGrossProfitUsdgWei) !== MINIMUM_GROSS_PROFIT ||
    BigInt(arm.minimumScreenedNetProfitUsdgWei) < configuredMinimumNet
  ) {
    throw new Error('generic watch authorization has an invalid economic boundary')
  }
  const usage = genericWatchUsage(arm, deploymentState)
  const budget = evaluateGenericArmBudget(arm, usage)
  if (
    !budget.allowed &&
    !(
      allowCurrentExactPreflight &&
      budget.reason === 'exact-preflight-limit' &&
      usage.exactPreflights === arm.maxExactPreflights
    )
  ) {
    stopForPolicy(budget.reason)
  }
  return usage
}

async function armGenericWatcher() {
  const releaseWatch = acquireGenericWatchLock()
  const releaseWallet = acquireWalletLock()
  try {
    assertLiveTransport(RUNTIME_CONFIG)
    assertFixedSignerInactive()
    const existing = readJson(GENERIC_WATCH_ARM_PATH)
    if (existing?.status === 'ARMED') {
      const existingExpiry = Date.parse(existing.expiresAt)
      if (!Number.isFinite(existingExpiry)) throw new Error('existing generic watcher authorization has invalid expiry')
      if (Date.now() < existingExpiry) {
        throw new Error('an unexpired generic watcher authorization already exists; disarm it before replacing it')
      }
    }
    const unresolved = latestUnresolved()
    if (unresolved) throw new Error(`unresolved ${unresolved.kind} mutation ${unresolved.hash}`)
    await assertCanonicalBase()
    const compiled = compileGenericContract()
    const deploymentState = readJson(STATE_PATH)
    const executor = await assertGenericDeployment(deploymentState, compiled)
    loadAccount()
    const [wallet, principal] = await Promise.all([
      walletSnapshot(),
      publicClient.readContract({
        address: GENERIC_USDG,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [executor],
      }),
    ])
    if (wallet.nonceLatest !== wallet.noncePending) throw new Error('wallet has a pending nonce')
    const walletEthReserve = nonNegativeUnits(RUNTIME_CONFIG.genericMinEthReserve, 18, 'minimum ETH reserve')
    if (wallet.ethBalance <= walletEthReserve) throw new Error('wallet ETH is at or below the authorized gas reserve')
    if (principal <= 0n) throw new Error('generic executor has no USDG principal')
    const minimumNetProfit = nonNegativeUnits(RUNTIME_CONFIG.genericMinNetUsdg, 6, 'minimum net profit')
    const minimumScreenedNetProfit = configuredWatchMinimumScreenedNet()
    if (minimumScreenedNetProfit < minimumNetProfit) {
      throw new Error('watcher screened-net gate must be at least the exact minimum-net floor')
    }
    const maxPrincipal = principal < MAXIMUM_AMOUNT_IN ? principal : MAXIMUM_AMOUNT_IN
    const issuedAt = new Date()
    const expiresAt = new Date(issuedAt.getTime() + RUNTIME_CONFIG.genericWatchArmHours * 60 * 60 * 1_000)
    const scope = {
      policyVersion: 'generic-v2-loopback-escalation-v1',
      chainId: CHAIN_ID,
      wallet: WALLET,
      executor,
      sourceHash: deploymentState.sourceHash,
      runtimeCodeHash: deploymentState.runtimeCodeHash,
      maxPrincipalUsdgWei: maxPrincipal.toString(),
      minimumGrossProfitUsdgWei: MINIMUM_GROSS_PROFIT.toString(),
      minimumNetProfitUsdgWei: minimumNetProfit.toString(),
      minimumScreenedNetProfitUsdgWei: minimumScreenedNetProfit.toString(),
      profitRetentionBps: RUNTIME_CONFIG.genericProfitRetentionBps,
      walletEthReserveWei: walletEthReserve.toString(),
      maxConfirmedExecutions: RUNTIME_CONFIG.genericWatchMaxExecutions,
      maxAttempts: RUNTIME_CONFIG.maxAttempts,
      maxExactPreflights: RUNTIME_CONFIG.genericWatchMaxPreflights,
      maxFailedGasWei: RUNTIME_CONFIG.maxFailedGasWei.toString(),
      expiresAt: expiresAt.toISOString(),
    }
    const authorization = {
      schemaVersion: 1,
      mode: 'AUTO_POLICY',
      issuedAt: issuedAt.toISOString(),
      ...scope,
      baselineNonce: wallet.nonceLatest,
      baselineExecutionCount: (deploymentState.executions || []).length,
      pollIntervalMs: RUNTIME_CONFIG.genericWatchPollMs,
      idleRpcBehavior: 'LOOPBACK_BOARD_ONLY',
      escalationRpcBehavior: 'ONE_TRIGGERED_CANDIDATE_EXACT_PREFLIGHT_THEN_SIGN',
      rpcSource: RUNTIME_CONFIG.rpcSource,
      principalUsdgWeiAtArm: principal.toString(),
      walletEthWeiAtArm: wallet.ethBalance.toString(),
    }
    const arm = {
      ...authorization,
      authorizationId: genericWatchAuthorizationId(authorization),
      status: 'ARMED',
      reason: 'user explicitly approved autonomous generic-v2 live execution in the current Codex task',
    }
    writeProtectedJson(GENERIC_WATCH_ARM_PATH, arm)
    const watchState = {
      schemaVersion: 1,
      status: 'ARMED_NOT_RUNNING',
      authorizationId: arm.authorizationId,
      wallet: WALLET,
      executor,
      updatedAt: new Date().toISOString(),
    }
    writeProtectedJson(GENERIC_WATCH_STATE_PATH, watchState)
    appendAudit('generic_watch_armed', {
      authorizationId: arm.authorizationId,
      executor,
      expiresAt: arm.expiresAt,
      maxPrincipalUsdgWei: arm.maxPrincipalUsdgWei,
      minimumNetProfitUsdgWei: arm.minimumNetProfitUsdgWei,
      minimumScreenedNetProfitUsdgWei: arm.minimumScreenedNetProfitUsdgWei,
      maxConfirmedExecutions: arm.maxConfirmedExecutions,
      maxAttempts: arm.maxAttempts,
      maxExactPreflights: arm.maxExactPreflights,
      maxFailedGasWei: arm.maxFailedGasWei,
      baselineNonce: arm.baselineNonce,
      baselineExecutionCount: arm.baselineExecutionCount,
    })
    console.log(
      stringify({
        status: 'GENERIC_WATCH_ARMED',
        authorizationId: arm.authorizationId,
        executor,
        expiresAt: arm.expiresAt,
        principalCapUsdg: formatUnits(maxPrincipal, 6),
        minimumNetProfitUsdg: formatUnits(minimumNetProfit, 6),
        minimumScreenedNetProfitUsdg: formatUnits(minimumScreenedNetProfit, 6),
        maxConfirmedExecutions: arm.maxConfirmedExecutions,
        maxSignedAttempts: arm.maxAttempts,
        maxExactPreflights: arm.maxExactPreflights,
        maxFailedGasWei: arm.maxFailedGasWei,
        idleRpcBehavior: arm.idleRpcBehavior,
      }),
    )
    return arm
  } finally {
    releaseWallet()
    releaseWatch()
  }
}

function boardTransportFailure(error) {
  return isTransientRpcError(error) || /board snapshot HTTP (?:429|5\d\d)/i.test(errorText(error))
}

async function watchGeneric() {
  const release = acquireGenericWatchLock()
  let stopRequested = false
  let watchState = null
  const requestStop = () => {
    stopRequested = true
  }
  process.once('SIGTERM', requestStop)
  process.once('SIGINT', requestStop)
  try {
    assertLiveTransport(RUNTIME_CONFIG)
    assertFixedSignerInactive()
    const arm = readJson(GENERIC_WATCH_ARM_PATH)
    const deploymentState = readJson(STATE_PATH)
    const usage = assertGenericWatchArm(arm, deploymentState)
    const unresolved = latestUnresolved()
    if (unresolved) throw new Error(`unresolved ${unresolved.kind} mutation ${unresolved.hash}`)
    await assertCanonicalBase()
    const compiled = compileGenericContract()
    const executor = await assertGenericDeployment(deploymentState, compiled)
    loadAccount()
    const [wallet, principal] = await Promise.all([
      walletSnapshot(),
      publicClient.readContract({
        address: GENERIC_USDG,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [executor],
      }),
    ])
    const expectedNonce = Number(arm.baselineNonce) + usage.confirmedExecutions
    if (wallet.nonceLatest !== wallet.noncePending || wallet.nonceLatest !== expectedNonce || principal < 1n) {
      throw new Error(
        `generic watcher startup state mismatch: latest/pending/expected=${wallet.nonceLatest}/${wallet.noncePending}/${expectedNonce}, principal=${principal}`,
      )
    }
    const startedAt = new Date().toISOString()
    watchState = {
      schemaVersion: 1,
      status: 'RUNNING',
      pid: process.pid,
      authorizationId: arm.authorizationId,
      wallet: WALLET,
      executor,
      startedAt,
      updatedAt: startedAt,
      triggerMode: 'LOOPBACK_BOARD_THEN_TARGETED_EXACT_PREFLIGHT',
      idleRpcBehavior: 'NONE',
      pollIntervalMs: RUNTIME_CONFIG.genericWatchPollMs,
      processedBoardGenerations: 0,
      consecutiveBoardErrors: 0,
      consecutiveExecutionRpcErrors: 0,
      completedExecutionsThisArm: usage.confirmedExecutions,
      exactPreflightsThisArm: usage.exactPreflights,
      signedAttemptsThisArm: usage.attempts,
      lastDecision: 'STARTING',
    }
    writeProtectedJson(GENERIC_WATCH_STATE_PATH, watchState)
    appendAudit('generic_watch_started', {
      authorizationId: arm.authorizationId,
      pid: process.pid,
      executor,
      baselineNonce: arm.baselineNonce,
      idleRpcBehavior: watchState.idleRpcBehavior,
      triggerMode: watchState.triggerMode,
    })
    console.log(
      stringify({
        status: 'GENERIC_WATCH_RUNNING',
        authorizationId: arm.authorizationId,
        pid: process.pid,
        executor,
        expiresAt: arm.expiresAt,
        idleRpcBehavior: watchState.idleRpcBehavior,
      }),
    )

    let lastBoardGeneratedAt = null
    while (!stopRequested) {
      const loopStartedAt = Date.now()
      let phase = 'BOARD'
      try {
        const currentArm = readJson(GENERIC_WATCH_ARM_PATH)
        const currentDeploymentState = readJson(STATE_PATH)
        const currentUsage = assertGenericWatchArm(currentArm, currentDeploymentState)
        const unresolvedNow = latestUnresolved()
        if (unresolvedNow) throw new Error(`unresolved ${unresolvedNow.kind} mutation ${unresolvedNow.hash}`)

        const snapshot = await loadBoardSnapshot()
        if (!snapshot?.generatedAt || !Number.isFinite(Date.parse(snapshot.generatedAt))) {
          throw new Error('loopback board snapshot has no valid generation timestamp')
        }
        if (watchState.consecutiveBoardErrors !== 0) {
          watchState = {
            ...watchState,
            consecutiveBoardErrors: 0,
            updatedAt: new Date().toISOString(),
          }
          writeProtectedJson(GENERIC_WATCH_STATE_PATH, watchState)
        }
        if (snapshot.generatedAt === lastBoardGeneratedAt) {
          await sleep(RUNTIME_CONFIG.genericWatchPollMs)
          continue
        }
        lastBoardGeneratedAt = snapshot.generatedAt

        let candidates = []
        try {
          candidates = buildGenericExecutionCandidates(snapshot, {
            maxAgeMs: RUNTIME_CONFIG.genericMaxQuoteAgeMs,
            limit: 32,
          })
        } catch (error) {
          if (!isGenericOpportunityMiss(error)) throw error
        }
        const candidate = selectGenericWatchCandidate(candidates, {
          minimumScreenedNetProfit: BigInt(currentArm.minimumScreenedNetProfitUsdgWei),
          maxPrincipal: BigInt(currentArm.maxPrincipalUsdgWei),
          attemptedOpportunityIds: currentUsage.attemptedOpportunityIds,
        })
        watchState = {
          ...watchState,
          status: 'RUNNING',
          updatedAt: new Date().toISOString(),
          processedBoardGenerations: watchState.processedBoardGenerations + 1,
          consecutiveBoardErrors: 0,
          completedExecutionsThisArm: currentUsage.confirmedExecutions,
          exactPreflightsThisArm: currentUsage.exactPreflights,
          signedAttemptsThisArm: currentUsage.attempts,
          lastBoardGeneratedAt,
          lastDecision: candidate ? 'SCREEN_GATE_PASSED' : 'NO_ELIGIBLE_SCREEN',
          lastCandidate: candidate
            ? {
                opportunityId: candidate.opportunityId,
                candidateHash: candidate.candidateHash,
                route: candidate.routeLabel,
                amountInUsdg: formatUnits(candidate.amountIn, 6),
                screenedNetUsdg: formatUnits(candidate.screenedNetProfit, 6),
                quoteBlockNumber: candidate.quoteBlockNumber.toString(),
              }
            : null,
          lastLoopLatencyMs: Date.now() - loopStartedAt,
        }
        writeProtectedJson(GENERIC_WATCH_STATE_PATH, watchState)
        if (!candidate) {
          await sleep(Math.max(0, RUNTIME_CONFIG.genericWatchPollMs - (Date.now() - loopStartedAt)))
          continue
        }

        appendAudit('generic_watch_exact_preflight_started', {
          authorizationId: currentArm.authorizationId,
          opportunityId: candidate.opportunityId,
          candidateHash: candidate.candidateHash,
          route: candidate.routeLabel,
          amountIn: candidate.amountIn,
          screenedNetProfit: candidate.screenedNetProfit,
          quoteBlockNumber: candidate.quoteBlockNumber,
          quoteBlockHash: candidate.quoteBlockHash,
        })
        watchState = {
          ...watchState,
          status: 'EXECUTING',
          updatedAt: new Date().toISOString(),
          exactPreflightsThisArm: currentUsage.exactPreflights + 1,
          lastDecision: 'EXACT_PREFLIGHT_RUNNING',
        }
        writeProtectedJson(GENERIC_WATCH_STATE_PATH, watchState)
        phase = 'EXECUTION'
        const record = await execute({
          opportunityId: candidate.opportunityId,
          authorizationId: currentArm.authorizationId,
          abortRequested: () => stopRequested,
        })
        const confirmedState = readJson(STATE_PATH)
        const confirmedUsage = genericWatchUsage(currentArm, confirmedState)
        watchState = {
          ...watchState,
          status: 'RUNNING',
          updatedAt: new Date().toISOString(),
          completedExecutionsThisArm: confirmedUsage.confirmedExecutions,
          exactPreflightsThisArm: confirmedUsage.exactPreflights,
          signedAttemptsThisArm: confirmedUsage.attempts,
          consecutiveExecutionRpcErrors: 0,
          lastDecision: 'CONFIRMED_EXECUTION',
          lastTransaction: record.hash,
          lastConfirmedNetProfitUsdg:
            record.netProfitUsdgWei === null ? null : formatUnits(BigInt(record.netProfitUsdgWei), 6),
        }
        writeProtectedJson(GENERIC_WATCH_STATE_PATH, watchState)
        appendAudit('generic_watch_execution_confirmed', {
          authorizationId: currentArm.authorizationId,
          hash: record.hash,
          opportunityId: candidate.opportunityId,
          completedExecutionsThisArm: confirmedUsage.confirmedExecutions,
          netProfitUsdgWei: record.netProfitUsdgWei,
        })
      } catch (error) {
        const unresolvedNow = latestUnresolved()
        if (error.watchPolicyStop) {
          watchState = {
            ...watchState,
            status: 'STOPPED_POLICY',
            reason: error.message,
            updatedAt: new Date().toISOString(),
          }
          writeProtectedJson(GENERIC_WATCH_STATE_PATH, watchState)
          appendAudit('generic_watch_stopped_policy', {
            authorizationId: watchState.authorizationId,
            reason: error.message,
          })
          return watchState
        }
        if (unresolvedNow) {
          watchState = {
            ...watchState,
            status: 'HALTED_UNKNOWN',
            reason: errorText(error),
            transaction: unresolvedNow.hash,
            updatedAt: new Date().toISOString(),
          }
          writeProtectedJson(GENERIC_WATCH_STATE_PATH, watchState)
          appendAudit('generic_watch_halted_unknown', {
            authorizationId: watchState.authorizationId,
            hash: unresolvedNow.hash,
            reason: errorText(error),
          })
          return watchState
        }
        if (isGenericOpportunityMiss(error)) {
          watchState = {
            ...watchState,
            status: 'RUNNING',
            updatedAt: new Date().toISOString(),
            consecutiveExecutionRpcErrors: 0,
            lastDecision: 'CANDIDATE_REJECTED_EXACT',
            reason: errorText(error),
          }
          writeProtectedJson(GENERIC_WATCH_STATE_PATH, watchState)
          appendAudit('generic_watch_candidate_rejected_exact', {
            authorizationId: watchState.authorizationId,
            opportunityId: watchState.lastCandidate?.opportunityId || null,
            reason: errorText(error),
          })
        } else if (boardTransportFailure(error)) {
          const counter = phase === 'BOARD' ? 'consecutiveBoardErrors' : 'consecutiveExecutionRpcErrors'
          const consecutiveErrors = Number(watchState?.[counter] || 0) + 1
          watchState = {
            ...watchState,
            status:
              consecutiveErrors >= RUNTIME_CONFIG.genericWatchMaxConsecutiveErrors ? 'HALTED_RPC' : 'DEGRADED_RPC',
            updatedAt: new Date().toISOString(),
            [counter]: consecutiveErrors,
            lastDecision: 'RPC_ERROR',
            reason: errorText(error),
          }
          writeProtectedJson(GENERIC_WATCH_STATE_PATH, watchState)
          appendAudit('generic_watch_rpc_error', {
            authorizationId: watchState.authorizationId,
            consecutiveErrors,
            reason: errorText(error),
          })
          if (watchState.status === 'HALTED_RPC') return watchState
          await sleep(Math.min(30_000, RUNTIME_CONFIG.genericWatchPollMs * consecutiveErrors))
        } else if (/nonce/i.test(errorText(error))) {
          watchState = {
            ...watchState,
            status: 'HALTED_NONCE_CONFLICT',
            updatedAt: new Date().toISOString(),
            lastDecision: 'NONCE_CONFLICT',
            reason: errorText(error),
          }
          writeProtectedJson(GENERIC_WATCH_STATE_PATH, watchState)
          appendAudit('generic_watch_halted_nonce_conflict', {
            authorizationId: watchState.authorizationId,
            reason: errorText(error),
          })
          return watchState
        } else {
          watchState = {
            ...watchState,
            status: 'HALTED_INVARIANT',
            updatedAt: new Date().toISOString(),
            lastDecision: 'INVARIANT_FAILED',
            reason: errorText(error),
          }
          writeProtectedJson(GENERIC_WATCH_STATE_PATH, watchState)
          appendAudit('generic_watch_halted_invariant', {
            authorizationId: watchState.authorizationId,
            reason: errorText(error),
          })
          return watchState
        }
      }
      await sleep(Math.max(0, RUNTIME_CONFIG.genericWatchPollMs - (Date.now() - loopStartedAt)))
    }

    watchState = { ...watchState, status: 'STOPPED_BY_SIGNAL', updatedAt: new Date().toISOString() }
    writeProtectedJson(GENERIC_WATCH_STATE_PATH, watchState)
    appendAudit('generic_watch_stopped_signal', { authorizationId: watchState.authorizationId })
    return watchState
  } catch (error) {
    const unresolved = latestUnresolved()
    watchState = {
      ...(watchState || {
        schemaVersion: 1,
        pid: process.pid,
        wallet: WALLET,
        executor: readJson(STATE_PATH)?.executor || null,
        authorizationId: readJson(GENERIC_WATCH_ARM_PATH)?.authorizationId || null,
      }),
      status: error.watchPolicyStop ? 'STOPPED_POLICY' : unresolved ? 'HALTED_UNKNOWN' : 'HALTED_STARTUP',
      reason: errorText(error),
      transaction: unresolved?.hash || null,
      updatedAt: new Date().toISOString(),
    }
    writeProtectedJson(GENERIC_WATCH_STATE_PATH, watchState)
    appendAudit('generic_watch_startup_stopped', {
      authorizationId: watchState.authorizationId,
      status: watchState.status,
      reason: watchState.reason,
      unresolvedHash: unresolved?.hash || null,
    })
    return watchState
  } finally {
    process.removeListener('SIGTERM', requestStop)
    process.removeListener('SIGINT', requestStop)
    release()
  }
}

async function genericWatchStatus() {
  const arm = readJson(GENERIC_WATCH_ARM_PATH)
  const runtime = readJson(GENERIC_WATCH_STATE_PATH)
  const deploymentState = readJson(STATE_PATH)
  const processState = genericWatchLockHolder()
  let usage = null
  if (arm && deploymentState) {
    try {
      const observed = genericWatchUsage(arm, deploymentState)
      usage = {
        confirmedExecutions: observed.confirmedExecutions,
        signedAttempts: observed.attempts,
        exactPreflights: observed.exactPreflights,
        failedGasWei: observed.failedGasWei.toString(),
      }
    } catch (error) {
      usage = { error: errorText(error) }
    }
  }
  let board = null
  try {
    const selected = await boardCandidates({ limit: 32 })
    const candidate = selected.candidates[0]
    board = {
      evidence: 'LOOPBACK_BOARD_SCREEN_ONLY_NO_CHAIN_READBACK',
      generatedAt: selected.snapshot.generatedAt,
      candidateCount: selected.candidates.length,
      top: {
        opportunityId: candidate.opportunityId,
        route: candidate.routeLabel,
        amountInUsdg: formatUnits(candidate.amountIn, 6),
        screenedNetUsdg: formatUnits(candidate.screenedNetProfit, 6),
      },
    }
  } catch (error) {
    board = { status: 'NO_FRESH_ELIGIBLE_BOARD_SCREEN', error: errorText(error) }
  }
  let authorization = null
  if (arm) {
    try {
      authorization = {
        id: arm.authorizationId,
        status: arm.status,
        issuedAt: arm.issuedAt,
        expiresAt: arm.expiresAt,
        maxPrincipalUsdg: formatUnits(BigInt(arm.maxPrincipalUsdgWei), 6),
        minimumNetProfitUsdg: formatUnits(BigInt(arm.minimumNetProfitUsdgWei), 6),
        minimumScreenedNetProfitUsdg: formatUnits(BigInt(arm.minimumScreenedNetProfitUsdgWei), 6),
        maxConfirmedExecutions: arm.maxConfirmedExecutions,
        maxSignedAttempts: arm.maxAttempts,
        maxExactPreflights: arm.maxExactPreflights,
        maxFailedGasWei: arm.maxFailedGasWei,
      }
    } catch (error) {
      authorization = {
        id: arm.authorizationId || null,
        status: arm.status || 'INVALID',
        error: `INVALID_AUTHORIZATION_READBACK: ${errorText(error)}`,
      }
    }
  }
  const output = {
    status: runtime?.status || 'NOT_CONFIGURED',
    evidence: 'LOCAL_RUNTIME_AND_AUTHORIZATION_READBACK_NO_CHAIN_QUERY',
    process: processState,
    authorization,
    usage,
    runtime,
    deployment: deploymentState
      ? {
          status: deploymentState.status,
          executor: deploymentState.executor,
          confirmedExecutions: (deploymentState.executions || []).length,
        }
      : null,
    unresolvedMutation: latestUnresolved()
      ? { kind: latestUnresolved().kind || null, hash: latestUnresolved().hash }
      : null,
    board,
  }
  console.log(stringify(output))
  return output
}

async function disarmGenericWatcher() {
  const arm = readJson(GENERIC_WATCH_ARM_PATH)
  if (!arm) throw new Error('no generic watcher authorization exists')
  arm.status = 'DISARMED'
  arm.disarmedAt = new Date().toISOString()
  writeProtectedJson(GENERIC_WATCH_ARM_PATH, arm)
  const holder = genericWatchLockHolder()
  const runtime = readJson(GENERIC_WATCH_STATE_PATH)
  writeProtectedJson(GENERIC_WATCH_STATE_PATH, {
    ...(runtime || { schemaVersion: 1, wallet: WALLET, executor: readJson(STATE_PATH)?.executor || null }),
    status: holder.alive ? 'DISARM_REQUESTED' : 'DISARMED',
    authorizationId: arm.authorizationId,
    updatedAt: new Date().toISOString(),
  })
  if (holder.alive && holder.pid !== process.pid) process.kill(holder.pid, 'SIGTERM')
  appendAudit('generic_watch_disarmed', {
    authorizationId: arm.authorizationId,
    watcherPid: holder.pid,
    watcherWasAlive: holder.alive,
  })
  const output = {
    status: 'GENERIC_WATCH_DISARMED',
    authorizationId: arm.authorizationId,
    watcherPid: holder.pid,
    watcherWasAlive: holder.alive,
  }
  console.log(stringify(output))
  return output
}

async function genericRuntimeVerify() {
  assertLiveTransport(RUNTIME_CONFIG)
  assertFixedSignerInactive()
  const unresolved = latestUnresolved()
  if (unresolved) throw new Error(`unresolved ${unresolved.kind} mutation ${unresolved.hash}`)
  await assertCanonicalBase()
  const compiled = compileGenericContract()
  const deploymentState = readJson(STATE_PATH)
  const executor = await assertGenericDeployment(deploymentState, compiled)
  const [wallet, principal, board] = await Promise.all([
    walletSnapshot(),
    publicClient.readContract({
      address: GENERIC_USDG,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [executor],
    }),
    loadBoardSnapshot(),
  ])
  if (wallet.nonceLatest !== wallet.noncePending) throw new Error('wallet latest and pending nonce have not converged')
  if (
    board?.schemaVersion !== 2 ||
    board.service !== 'manga-opportunity-board' ||
    board.mode !== 'READ_ONLY_NO_SIGNING_NO_BROADCAST' ||
    board.selection?.executionAuthorized !== false
  ) {
    throw new Error('loopback opportunity board identity or read-only boundary is invalid')
  }
  const arm = readJson(GENERIC_WATCH_ARM_PATH)
  const output = {
    status: 'RUNTIME_VERIFIED_READY_FOR_GENERIC_ARM',
    evidence: 'CANONICAL_CHAIN_AND_LOOPBACK_BOARD_READBACK_NO_SIGNATURE_NO_BROADCAST',
    releaseSha: process.env.MANGA_RELEASE_SHA || 'UNKNOWN',
    chainId: CHAIN_ID,
    rpcSource: RUNTIME_CONFIG.rpcSource,
    wallet: WALLET,
    walletEth: formatEther(wallet.ethBalance),
    nonceLatest: wallet.nonceLatest,
    noncePending: wallet.noncePending,
    executor,
    executorUsdg: formatUnits(principal, 6),
    sourceHash: compiled.sourceHash,
    runtimeCodeHash: deploymentState.runtimeCodeHash,
    confirmedExecutions: (deploymentState.executions || []).length,
    unresolvedMutation: null,
    board: {
      service: board.service,
      mode: board.mode,
      generatedAt: board.generatedAt,
      status: board.health?.status || null,
      signerLoaded: board.health?.signerLoaded,
      executionAuthorized: board.selection.executionAuthorized,
    },
    authorization: arm ? { id: arm.authorizationId, status: arm.status, expiresAt: arm.expiresAt } : null,
  }
  appendAudit('generic_runtime_verified', output)
  console.log(stringify(output))
  return output
}

async function plan() {
  await assertCanonicalBase()
  const { snapshot, candidates } = await selectedCandidates()
  const result = {
    status: 'GENERIC_CANDIDATE_SET_PLANNED',
    evidence: 'BOARD_QUOTE_ONLY_NO_EXECUTOR_SIMULATION_NO_SIGNATURE',
    generatedAt: snapshot.generatedAt,
    candidates: candidates.map((candidate) => ({
      candidateHash: candidate.candidateHash,
      executionKey: candidate.executionKey,
      opportunityId: candidate.opportunityId,
      route: candidate.routeLabel,
      amountInUsdg: formatUnits(candidate.amountIn, 6),
      screenedNetUsdg: formatUnits(candidate.screenedNetProfit, 6),
      routePayload: candidate.route,
    })),
  }
  console.log(stringify(result))
  return result
}

async function status() {
  const state = readJson(STATE_PATH)
  const unresolved = latestUnresolved()
  let board = null
  try {
    const selected = await boardCandidates()
    const candidate = selected.candidates[0]
    board = {
      candidateCount: selected.candidates.length,
      candidateHash: candidate.candidateHash,
      route: candidate.routeLabel,
      amountInUsdg: formatUnits(candidate.amountIn, 6),
      screenedNetUsdg: formatUnits(candidate.screenedNetProfit, 6),
      quoteBlockNumber: candidate.quoteBlockNumber,
    }
  } catch (error) {
    board = { status: 'UNAVAILABLE_OR_NO_POSITIVE_SELECTION', error: errorText(error) }
  }
  const output = {
    status: state ? state.status : 'NOT_DEPLOYED',
    evidence: state?.deployment?.hash ? 'DEPLOYMENT_LEDGER_PRESENT_CHAIN_READBACK_NOT_RUN' : 'LOCAL_STATE_ONLY',
    wallet: WALLET,
    executor: state?.executor || null,
    sourceHash: state?.sourceHash || null,
    unresolvedMutation: unresolved ? { kind: unresolved.kind, hash: unresolved.hash } : null,
    board,
  }
  console.log(stringify(output))
  return output
}

async function main() {
  const command = process.argv[2] || 'status'
  if (command === 'compile') return console.log(stringify(compileGenericContract()))
  if (command === 'plan') return plan()
  if (command === 'status') return status()
  if (command === 'runtime-verify') return genericRuntimeVerify()
  if (command === 'deploy-preflight') return deployPreflight()
  if (command === 'deploy') return deploy()
  if (command === 'preflight') return executionPreflight()
  if (command === 'execute') return execute()
  if (command === 'reconcile') return reconcile()
  if (command === 'withdraw-all') return withdrawAll()
  if (command === 'watch-arm') return armGenericWatcher()
  if (command === 'watch') {
    const result = await watchGeneric()
    if (result.status.startsWith('HALTED')) process.exitCode = 1
    return result
  }
  if (command === 'watch-status') return genericWatchStatus()
  if (command === 'watch-disarm') return disarmGenericWatcher()
  throw new Error(`unknown generic command: ${command}`)
}

main().catch((error) => {
  appendAudit('generic_command_failed', { command: process.argv[2] || 'status', error: errorText(error) })
  console.error(error.stack || error)
  process.exitCode = 1
})
