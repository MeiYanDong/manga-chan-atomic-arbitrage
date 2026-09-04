import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import solc from 'solc'
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
  recoverTransactionAddress,
  toHex,
  webSocket,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { assertLiveTransport, loadRuntimeConfig } from '../src/config.mjs'
import { buildMutationPlan, assertPrivateFile, persistSignedRaw } from '../src/journal.mjs'
import {
  EventRevisionQueue,
  RpcErrorClass,
  classifyReconciliation,
  classifyRpcError,
  errorText,
  evaluateArmBudget,
  isTransientRpcError,
  latestUnresolvedMutation,
  quoteFailure,
} from '../src/policy.mjs'

const CHAIN_ID = 4663
const RUNTIME_CONFIG = loadRuntimeConfig()
const PUBLIC_READ_ONLY_RPC = 'https://rpc.mainnet.chain.robinhood.com'
const RPC_URL = RUNTIME_CONFIG.rpcUrl || PUBLIC_READ_ONLY_RPC
const WS_URL = RUNTIME_CONFIG.wsUrl
const READ_RPC_URL = RUNTIME_CONFIG.readRpcUrl
const RPC_SOURCE = RUNTIME_CONFIG.rpcSource
const EXPLORER_TX = 'https://robinhoodchain.blockscout.com/tx/'
const KEYCHAIN_SERVICE = RUNTIME_CONFIG.keychainService

const WALLET = getAddress('0x77f771E83f118C32547A1291dda438a757B4b91B')
const WETH = getAddress('0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73')
const USDG = getAddress('0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168')
const MANGA = getAddress('0xc28068cb109Dd0a0d5C6C6a925B048fEA00E31a6')
const MSFT = getAddress('0xe93237C50D904957Cf27E7B1133b510C669c2e74')
const NVDA = getAddress('0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC')
const HOOK = getAddress('0x16D1560630Ce74af4478d9b8AD46548A092A2000')
const POOL_MANAGER = getAddress('0x8366a39CC670B4001A1121B8F6A443A643e40951')
const V3_ROUTER = getAddress('0xCaf681a66D020601342297493863E78C959E5cb2')
const V3_QUOTER = getAddress('0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7')
const V4_QUOTER = getAddress('0x8Dc178eFB8111BB0973Dd9d722ebeFF267c98F94')
const ENTRY_V3_POOL = getAddress('0xeb60bCD1D920ad6E102690CCFC6fB488899E1510')
const EXIT_V3_POOL = getAddress('0xd4EB21209C4D6093f80B5b84f5C45cc093EA14a3')

const MSFT_MANGA_POOL_ID = '0x03b8a1d48536a15116713d1f697528bfd8ccde233a9a93f736684886c1a890f5'
const MANGA_NVDA_POOL_ID = '0x2a3a91cb47030dc14ab6a8639b18f9fa431311ea241893220d4ce0b2f81d9779'
const V3_SWAP_TOPIC = keccak256(toHex('Swap(address,address,int256,int256,uint160,uint128,int24)'))
const V4_SWAP_TOPIC = keccak256(toHex('Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)'))
const WATCHED_V4_POOL_IDS = new Set([MSFT_MANGA_POOL_ID.toLowerCase(), MANGA_NVDA_POOL_ID.toLowerCase()])
const msftMangaPoolKey = { currency0: MANGA, currency1: MSFT, fee: 10_000, tickSpacing: 200, hooks: HOOK }
const mangaNvdaPoolKey = { currency0: MANGA, currency1: NVDA, fee: 10_000, tickSpacing: 200, hooks: HOOK }

const SEED_ETH = parseEther('0.004')
const FORK_TEST_SEED_ETH = parseEther('0.006')
const SEED_SLIPPAGE_BPS = 100n
const MIN_WALLET_ETH_RESERVE = parseEther('0.004')
const MIN_GROSS_PROFIT = 50_000n
const MIN_NET_PROFIT = 20_000n
const PROFIT_FLOOR_BPS = 9_500n
const EXECUTION_GAS_BUFFER_BPS = 10_500n
const DEPLOYMENT_GAS_BUFFER_BPS = 11_500n
const MAX_FEE_HEADROOM_BPS = 10_500n
const DEADLINE_SECONDS = 90n
const AMOUNT_GRID = [5_000_000n, 7_500_000n, 10_000_000n, 12_500_000n, 15_000_000n]

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CONTRACT_PATH = path.join(ROOT, 'contracts', 'MangaChanAtomicArb.sol')
const DEPLOYMENT_MANIFEST_PATH = path.join(ROOT, 'deployments', 'robinhood-mainnet.json')
const RUN_DIR = RUNTIME_CONFIG.runDir ? path.resolve(RUNTIME_CONFIG.runDir) : path.join(ROOT, 'runs')
const STATE_PATH = path.join(RUN_DIR, 'state.json')
const AUDIT_PATH = path.join(RUN_DIR, 'audit.jsonl')
const LOCK_PATH = path.join(RUN_DIR, 'wallet.lock')
const WATCH_ARM_PATH = path.join(RUN_DIR, 'watch-arm.json')
const WATCH_STATE_PATH = path.join(RUN_DIR, 'watch-state.json')
const WATCH_LOCK_PATH = path.join(RUN_DIR, 'watch.lock')
const SIGNED_TX_DIR = path.join(RUN_DIR, 'signed')
const WATCH_POLL_MS = 5_000
const WATCH_RECOVERY_POLL_MS = 30_000
const WATCH_ARM_DURATION_MS = 24 * 60 * 60 * 1_000
const WATCH_MAX_EXECUTIONS = 5
const WATCH_HEARTBEAT_MS = 60_000
const WATCH_MAX_CONSECUTIVE_RPC_ERRORS = 10
const BLOCK_READINESS_DELAYS_MS = [0, 100, 250, 500, 1_000, 2_000]
const FINALITY_CONFIRMATIONS = RUNTIME_CONFIG.finalityConfirmations

const chain = defineChain({
  id: CHAIN_ID,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  blockExplorers: { default: { name: 'Robinhood Blockscout', url: 'https://robinhoodchain.blockscout.com' } },
})

const publicClient = createPublicClient({
  chain,
  transport: http(RPC_URL, { timeout: 30_000, retryCount: 1 }),
})

const secondaryPublicClient = READ_RPC_URL
  ? createPublicClient({ chain, transport: http(READ_RPC_URL, { timeout: 30_000, retryCount: 1 }) })
  : null

const watchClient = WS_URL
  ? createPublicClient({ chain, transport: webSocket(WS_URL, { timeout: 30_000, retryCount: 5 }) })
  : null

const ERC20_ABI = parseAbi([
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)',
])

const V3_POOL_ABI = parseAbi([
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function fee() view returns (uint24)',
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

const V4_QUOTER_ABI = [
  {
    type: 'function',
    name: 'quoteExactInputSingle',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          {
            name: 'poolKey',
            type: 'tuple',
            components: [
              { name: 'currency0', type: 'address' },
              { name: 'currency1', type: 'address' },
              { name: 'fee', type: 'uint24' },
              { name: 'tickSpacing', type: 'int24' },
              { name: 'hooks', type: 'address' },
            ],
          },
          { name: 'zeroForOne', type: 'bool' },
          { name: 'exactAmount', type: 'uint128' },
          { name: 'hookData', type: 'bytes' },
        ],
      },
    ],
    outputs: [
      { name: 'amountOut', type: 'uint256' },
      { name: 'gasEstimate', type: 'uint256' },
    ],
  },
]

function stringify(value) {
  return JSON.stringify(value, (_, item) => (typeof item === 'bigint' ? item.toString() : item), 2)
}

function bpsFloor(value, bps) {
  return (value * (10_000n - bps)) / 10_000n
}

function bpsCeil(value, bps) {
  return (value * bps + 9_999n) / 10_000n
}

function maxBigInt(...values) {
  return values.reduce((maximum, value) => (value > maximum ? value : maximum))
}

function appendAudit(event, details = {}) {
  fs.mkdirSync(RUN_DIR, { recursive: true, mode: 0o700 })
  const line = JSON.stringify({ at: new Date().toISOString(), event, ...details }, (_, item) =>
    typeof item === 'bigint' ? item.toString() : item,
  )
  fs.appendFileSync(AUDIT_PATH, `${line}\n`, { mode: 0o600 })
}

function recordMutationPlan(kind, fields) {
  const plan = buildMutationPlan(kind, fields)
  appendAudit('mutation_intent', { kind, intentId: plan.intentId, createdAt: plan.createdAt })
  appendAudit('mutation_plan', plan)
  return plan
}

function recordMutationSigned(plan, hash, rawPrivateRef) {
  appendAudit('mutation_signed', {
    kind: plan.kind,
    intentId: plan.intentId,
    planHash: plan.planHash,
    hash,
    nonce: plan.nonce,
    rawPrivateRef,
  })
}

function readState() {
  if (!fs.existsSync(STATE_PATH)) return null
  return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'))
}

function writeProtectedJson(file, value) {
  fs.mkdirSync(RUN_DIR, { recursive: true, mode: 0o700 })
  const temporary = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temporary, `${stringify(value)}\n`, { mode: 0o600 })
  fs.renameSync(temporary, file)
  fs.chmodSync(file, 0o600)
}

function writeState(state) {
  writeProtectedJson(STATE_PATH, state)
}

function readAuditRecords() {
  if (!fs.existsSync(AUDIT_PATH)) return []
  return fs
    .readFileSync(AUDIT_PATH, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

function readJsonIfExists(file) {
  if (!fs.existsSync(file)) return null
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function readWatchArm() {
  return readJsonIfExists(WATCH_ARM_PATH)
}

function readWatchState() {
  return readJsonIfExists(WATCH_STATE_PATH)
}

function writeWatchState(state) {
  writeProtectedJson(WATCH_STATE_PATH, state)
}

function latestUnresolvedExecution() {
  return latestUnresolvedMutation(readAuditRecords())
}

function writeSignedRaw(hash, serializedTransaction) {
  return persistSignedRaw(SIGNED_TX_DIR, hash, serializedTransaction)
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

function acquireLock(lockPath = LOCK_PATH) {
  fs.mkdirSync(RUN_DIR, { recursive: true, mode: 0o700 })
  let descriptor
  try {
    descriptor = fs.openSync(lockPath, 'wx', 0o600)
    fs.writeFileSync(descriptor, `${process.pid} ${new Date().toISOString()}\n`)
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error
    let holderPid = null
    try {
      holderPid = Number(fs.readFileSync(lockPath, 'utf8').trim().split(/\s+/)[0])
    } catch {}
    if (processIsAlive(holderPid)) throw new Error(`执行锁已被 PID ${holderPid} 持有：${lockPath}`)
    try {
      fs.unlinkSync(lockPath)
    } catch {}
    descriptor = fs.openSync(lockPath, 'wx', 0o600)
    fs.writeFileSync(descriptor, `${process.pid} ${new Date().toISOString()}\n`)
  }
  return () => {
    try {
      fs.closeSync(descriptor)
    } catch {}
    try {
      fs.unlinkSync(lockPath)
    } catch {}
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function watchLockHolder() {
  if (!fs.existsSync(WATCH_LOCK_PATH)) return { pid: null, alive: false }
  let pid = null
  try {
    pid = Number(fs.readFileSync(WATCH_LOCK_PATH, 'utf8').trim().split(/\s+/)[0])
  } catch {}
  return { pid: Number.isSafeInteger(pid) ? pid : null, alive: processIsAlive(pid) }
}

function assertWatchArm(arm, state) {
  if (!arm || arm.status !== 'ARMED') throw new Error('MANGA watcher 尚未 arm')
  if (arm.chainId !== CHAIN_ID || arm.wallet?.toLowerCase() !== WALLET.toLowerCase())
    throw new Error('watch arm 的链或钱包不匹配')
  if (arm.executor?.toLowerCase() !== state?.executor?.toLowerCase()) throw new Error('watch arm 的执行器不匹配')
  if (arm.sourceHash !== state.sourceHash || arm.runtimeCodeHash !== state.runtimeCodeHash)
    throw new Error('watch arm 的源码或 runtime hash 不匹配')
  if (!Number.isFinite(Date.parse(arm.expiresAt)) || Date.now() >= Date.parse(arm.expiresAt))
    throw new Error('watch arm 已过期')
  const completed = (state.executions || []).length - arm.baselineExecutionCount
  const records = readAuditRecords()
  const signedAttempts = records.filter(
    (item) =>
      item.event === 'mutation_signed' && item.kind === 'execute' && Date.parse(item.at) >= Date.parse(arm.issuedAt),
  ).length
  const failedGasWei = records
    .filter((item) => item.event === 'execution_reverted' && Date.parse(item.at) >= Date.parse(arm.issuedAt))
    .reduce((total, item) => total + BigInt(item.gasSpentWei || 0), 0n)
  const budget = evaluateArmBudget(arm, {
    confirmedExecutions: completed,
    attempts: signedAttempts,
    failedGasWei,
  })
  if (!budget.allowed) throw new Error(`watch arm 已停止：${budget.reason}`)
  if (!['deployed', 'live_validated'].includes(state.status))
    throw new Error(`执行器状态 ${state.status} 不允许自动交易`)
  return completed
}

function isNoShotError(error) {
  const message = error?.shortMessage || error?.message || ''
  return /当前没有达到|当前净利润不足|净利保护允许的 maxFee|gasPrice .*超过净利保护|最新 ETH\/USDG 价格/i.test(message)
}

function loadAccount() {
  let privateKey
  if (RUNTIME_CONFIG.privateKeyFile) {
    assertPrivateFile(RUNTIME_CONFIG.privateKeyFile)
    privateKey = fs.readFileSync(RUNTIME_CONFIG.privateKeyFile, 'utf8').trim()
  } else {
    if (process.platform !== 'darwin') throw new Error('Linux 实盘必须配置 MANGA_PRIVATE_KEY_FILE')
    try {
      privateKey = execFileSync('/usr/bin/security', ['find-generic-password', '-w', '-s', KEYCHAIN_SERVICE], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim()
    } catch {
      throw new Error(`macOS Keychain 中找不到 ${KEYCHAIN_SERVICE}`)
    }
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) throw new Error('Keychain 项目不是有效的 32-byte EVM 私钥')
  const account = privateKeyToAccount(privateKey)
  privateKey = undefined
  if (account.address.toLowerCase() !== WALLET.toLowerCase()) {
    throw new Error(`Keychain 私钥地址不匹配；预期 ${WALLET}，实际 ${account.address}`)
  }
  return account
}

function compileContract() {
  const source = fs.readFileSync(CONTRACT_PATH, 'utf8')
  const input = {
    language: 'Solidity',
    sources: { 'MangaChanAtomicArb.sol': { content: source } },
    settings: {
      evmVersion: 'cancun',
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
      outputSelection: {
        '*': {
          MangaChanAtomicArb: ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object', 'evm.immutableReferences'],
        },
      },
    },
  }
  const output = JSON.parse(solc.compile(JSON.stringify(input)))
  const errors = (output.errors || []).filter((item) => item.severity === 'error')
  if (errors.length) throw new Error(errors.map((item) => item.formattedMessage).join('\n'))
  const contract = output.contracts?.['MangaChanAtomicArb.sol']?.MangaChanAtomicArb
  if (!contract) throw new Error('未生成 MangaChanAtomicArb 编译产物')
  const bytecode = `0x${contract.evm.bytecode.object}`
  const deployedTemplate = `0x${contract.evm.deployedBytecode.object}`
  return {
    abi: contract.abi,
    bytecode,
    deployedTemplate,
    creationBytes: contract.evm.bytecode.object.length / 2,
    runtimeBytes: contract.evm.deployedBytecode.object.length / 2,
    sourceHash: keccak256(toHex(source)),
    creationCodeHash: keccak256(bytecode),
  }
}

function v3Path(tokenIn, fee, tokenOut) {
  return encodePacked(['address', 'uint24', 'address'], [tokenIn, fee, tokenOut])
}

async function quoteV3(tokenIn, fee, tokenOut, amountIn, blockNumber) {
  const { result } = await publicClient.simulateContract({
    account: WALLET,
    address: V3_QUOTER,
    abi: V3_QUOTER_ABI,
    functionName: 'quoteExactInput',
    args: [v3Path(tokenIn, fee, tokenOut), amountIn],
    ...(blockNumber === undefined ? {} : { blockNumber }),
  })
  return { amountOut: result[0], gasEstimate: result[3] }
}

async function quoteV4(poolKey, zeroForOne, amountIn, blockNumber) {
  const { result } = await publicClient.simulateContract({
    account: WALLET,
    address: V4_QUOTER,
    abi: V4_QUOTER_ABI,
    functionName: 'quoteExactInputSingle',
    args: [{ poolKey, zeroForOne, exactAmount: amountIn, hookData: '0x' }],
    ...(blockNumber === undefined ? {} : { blockNumber }),
  })
  return { amountOut: result[0], gasEstimate: result[1] }
}

async function quoteRoute(amountIn, blockNumber) {
  const leg = async (name, operation) => {
    try {
      return await operation()
    } catch (error) {
      const failure = quoteFailure(name, error)
      const wrapped = new Error(`${failure.leg}:${failure.class}:${failure.message}`, { cause: error })
      wrapped.quoteFailure = failure
      throw wrapped
    }
  }
  const entry = await leg('USDG_TO_MSFT_V3', () => quoteV3(USDG, 3_000, MSFT, amountIn, blockNumber))
  const first = await leg('MSFT_TO_MANGA_V4', () => quoteV4(msftMangaPoolKey, false, entry.amountOut, blockNumber))
  const second = await leg('MANGA_TO_NVDA_V4', () => quoteV4(mangaNvdaPoolKey, true, first.amountOut, blockNumber))
  const exit = await leg('NVDA_TO_USDG_V3', () => quoteV3(NVDA, 500, USDG, second.amountOut, blockNumber))
  return {
    amountIn,
    amountOut: exit.amountOut,
    grossProfit: exit.amountOut - amountIn,
    legs: {
      usdgToMsft: entry.amountOut,
      msftToManga: first.amountOut,
      mangaToNvda: second.amountOut,
      nvdaToUsdg: exit.amountOut,
    },
    quoterGas: [entry.gasEstimate, first.gasEstimate, second.gasEstimate, exit.gasEstimate],
  }
}

async function quoteGrid(maxAmount = 15_000_000n, blockNumber) {
  const amounts = AMOUNT_GRID.filter((amount) => amount <= maxAmount)
  const quotes = await Promise.all(
    amounts.map(async (amount) => {
      try {
        return await quoteRoute(amount, blockNumber)
      } catch (error) {
        const failure = error.quoteFailure || quoteFailure('UNKNOWN', error)
        return { amountIn: amount, error: failure.message, errorClass: failure.class, errorLeg: failure.leg }
      }
    }),
  )
  const viable = quotes.filter((item) => item.grossProfit > 0n)
  viable.sort((left, right) =>
    left.grossProfit > right.grossProfit ? -1 : left.grossProfit < right.grossProfit ? 1 : 0,
  )
  return { quotes, best: viable[0] || null }
}

async function awaitReadableBlock(blockNumber) {
  let lastError = null
  for (const delay of BLOCK_READINESS_DELAYS_MS) {
    if (delay > 0) await sleep(delay)
    try {
      const head = await publicClient.getBlockNumber()
      if (head < blockNumber) {
        lastError = new Error(`HTTP head ${head} is behind event block ${blockNumber}`)
        continue
      }
      await publicClient.getBlock({ blockNumber })
      return blockNumber
    } catch (error) {
      lastError = error
      if (classifyRpcError(error) !== RpcErrorClass.STATE_NOT_READY && !isTransientRpcError(error)) throw error
    }
  }
  const readinessError = new Error(`区块 ${blockNumber} 在 HTTP RPC 上尚不可读：${errorText(lastError)}`, {
    cause: lastError,
  })
  readinessError.rpcClass = RpcErrorClass.STATE_NOT_READY
  throw readinessError
}

function startPoolEventSubscriptions(queue, onError) {
  if (!watchClient) return () => {}
  const offer = (log, source) => {
    if (log.blockNumber === null || log.blockNumber === undefined) return
    queue.offer({
      blockNumber: log.blockNumber,
      transactionHash: log.transactionHash,
      logIndex: log.logIndex,
      source,
    })
  }
  const unwatchV3 = watchClient.watchEvent({
    address: [ENTRY_V3_POOL, EXIT_V3_POOL],
    onLogs(logs) {
      for (const log of logs) {
        if (log.topics[0]?.toLowerCase() === V3_SWAP_TOPIC.toLowerCase()) offer(log, 'V3_SWAP')
      }
    },
    onError,
  })
  const unwatchV4 = watchClient.watchEvent({
    address: POOL_MANAGER,
    onLogs(logs) {
      for (const log of logs) {
        if (
          log.topics[0]?.toLowerCase() === V4_SWAP_TOPIC.toLowerCase() &&
          log.topics[1] &&
          WATCHED_V4_POOL_IDS.has(log.topics[1].toLowerCase())
        ) {
          offer(log, 'V4_SWAP')
        }
      }
    },
    onError,
  })
  return () => {
    unwatchV3()
    unwatchV4()
  }
}

async function assertCanonicalTargets() {
  const chainId = await publicClient.getChainId()
  if (chainId !== CHAIN_ID) throw new Error(`RPC chainId=${chainId}，预期 ${CHAIN_ID}`)
  const targets = [
    WETH,
    USDG,
    MANGA,
    MSFT,
    NVDA,
    HOOK,
    POOL_MANAGER,
    V3_ROUTER,
    V3_QUOTER,
    V4_QUOTER,
    ENTRY_V3_POOL,
    EXIT_V3_POOL,
  ]
  const codes = await Promise.all(targets.map((address) => publicClient.getCode({ address })))
  const missing = targets.filter((_, index) => !codes[index] || codes[index] === '0x')
  if (missing.length) throw new Error(`目标地址无 bytecode：${missing.join(', ')}`)

  const [
    usdgSymbol,
    usdgDecimals,
    mangaSymbol,
    msftSymbol,
    nvdaSymbol,
    entry0,
    entry1,
    entryFee,
    exit0,
    exit1,
    exitFee,
  ] = await Promise.all([
    publicClient.readContract({ address: USDG, abi: ERC20_ABI, functionName: 'symbol' }),
    publicClient.readContract({ address: USDG, abi: ERC20_ABI, functionName: 'decimals' }),
    publicClient.readContract({ address: MANGA, abi: ERC20_ABI, functionName: 'symbol' }),
    publicClient.readContract({ address: MSFT, abi: ERC20_ABI, functionName: 'symbol' }),
    publicClient.readContract({ address: NVDA, abi: ERC20_ABI, functionName: 'symbol' }),
    publicClient.readContract({ address: ENTRY_V3_POOL, abi: V3_POOL_ABI, functionName: 'token0' }),
    publicClient.readContract({ address: ENTRY_V3_POOL, abi: V3_POOL_ABI, functionName: 'token1' }),
    publicClient.readContract({ address: ENTRY_V3_POOL, abi: V3_POOL_ABI, functionName: 'fee' }),
    publicClient.readContract({ address: EXIT_V3_POOL, abi: V3_POOL_ABI, functionName: 'token0' }),
    publicClient.readContract({ address: EXIT_V3_POOL, abi: V3_POOL_ABI, functionName: 'token1' }),
    publicClient.readContract({ address: EXIT_V3_POOL, abi: V3_POOL_ABI, functionName: 'fee' }),
  ])
  if (
    usdgSymbol !== 'USDG' ||
    usdgDecimals !== 6 ||
    mangaSymbol !== 'MANGA' ||
    msftSymbol !== 'MSFT' ||
    nvdaSymbol !== 'NVDA'
  ) {
    throw new Error(`代币元数据异常：${usdgSymbol}/${usdgDecimals}, ${mangaSymbol}, ${msftSymbol}, ${nvdaSymbol}`)
  }
  if (
    entry0.toLowerCase() !== USDG.toLowerCase() ||
    entry1.toLowerCase() !== MSFT.toLowerCase() ||
    entryFee !== 3_000
  ) {
    throw new Error('入口 V3 池的 token0/token1/fee 不匹配')
  }
  if (exit0.toLowerCase() !== USDG.toLowerCase() || exit1.toLowerCase() !== NVDA.toLowerCase() || exitFee !== 500) {
    throw new Error('出口 V3 池的 token0/token1/fee 不匹配')
  }
}

async function walletSnapshot() {
  const [blockNumber, gasPrice, ethBalance, usdgBalance, nonceLatest, noncePending] = await Promise.all([
    publicClient.getBlockNumber(),
    publicClient.getGasPrice(),
    publicClient.getBalance({ address: WALLET }),
    publicClient.readContract({ address: USDG, abi: ERC20_ABI, functionName: 'balanceOf', args: [WALLET] }),
    publicClient.getTransactionCount({ address: WALLET, blockTag: 'latest' }),
    publicClient.getTransactionCount({ address: WALLET, blockTag: 'pending' }),
  ])
  return { blockNumber, gasPrice, ethBalance, usdgBalance, nonceLatest, noncePending }
}

async function deployPreflight({ print = true } = {}) {
  const unresolved = latestUnresolvedExecution()
  if (unresolved) throw new Error(`存在未收敛 ${unresolved.kind || 'mutation'} ${unresolved.hash}，禁止部署`)
  if (readState()?.executor) throw new Error('已有部署状态；禁止重复部署')
  await assertCanonicalTargets()
  const compiled = compileContract()
  const snapshot = await walletSnapshot()
  if (snapshot.nonceLatest !== snapshot.noncePending) {
    throw new Error(`存在 pending nonce：latest=${snapshot.nonceLatest}, pending=${snapshot.noncePending}`)
  }
  const seedQuote = await quoteV3(WETH, 100, USDG, SEED_ETH)
  const minimumSeedOut = bpsFloor(seedQuote.amountOut, SEED_SLIPPAGE_BPS)
  const data = encodeDeployData({ abi: compiled.abi, bytecode: compiled.bytecode, args: [WALLET, minimumSeedOut] })
  await publicClient.call({ account: WALLET, data, value: SEED_ETH })
  const estimatedGas = await publicClient.estimateGas({ account: WALLET, data, value: SEED_ETH })
  const gasLimit = bpsCeil(estimatedGas, DEPLOYMENT_GAS_BUFFER_BPS) + 10_000n
  const maxGasBudgetWei = gasLimit * bpsCeil(snapshot.gasPrice, 12_500n)
  const requiredEth = SEED_ETH + maxGasBudgetWei + MIN_WALLET_ETH_RESERVE
  if (snapshot.ethBalance < requiredEth) {
    throw new Error(
      `ETH 余额不足：${formatEther(snapshot.ethBalance)}，部署+种子+${formatEther(MIN_WALLET_ETH_RESERVE)} ETH 储备至少需要 ${formatEther(requiredEth)}`,
    )
  }
  const report = {
    status: 'READY_TO_DEPLOY',
    blockNumber: snapshot.blockNumber,
    wallet: WALLET,
    nonce: snapshot.nonceLatest,
    balances: { eth: formatEther(snapshot.ethBalance), usdg: formatUnits(snapshot.usdgBalance, 6) },
    seed: {
      eth: formatEther(SEED_ETH),
      expectedUsdg: formatUnits(seedQuote.amountOut, 6),
      minimumUsdg: formatUnits(minimumSeedOut, 6),
    },
    deployment: {
      creationBytes: compiled.creationBytes,
      runtimeBytes: compiled.runtimeBytes,
      sourceHash: compiled.sourceHash,
      creationCodeHash: compiled.creationCodeHash,
      estimatedGas,
      gasLimit,
      gasPriceWei: snapshot.gasPrice,
      maxGasBudgetEth: formatEther(maxGasBudgetWei),
    },
    walletEthAfterWorstCase: formatEther(snapshot.ethBalance - SEED_ETH - maxGasBudgetWei),
    route: { entry: 'USDG→MSFT', bridge: 'MSFT→MANGA→NVDA', exit: 'NVDA→USDG' },
  }
  appendAudit('deploy_preflight', report)
  if (print) console.log(stringify(report))
  return { compiled, snapshot, seedQuote, minimumSeedOut, gasLimit, report }
}

async function deploy() {
  const release = acquireLock()
  try {
    assertLiveTransport(RUNTIME_CONFIG)
    const check = await deployPreflight({ print: true })
    const account = loadAccount()
    const walletClient = createWalletClient({
      account,
      chain,
      transport: http(RPC_URL, { timeout: 30_000, retryCount: 0 }),
    })
    const latest = await publicClient.getTransactionCount({ address: WALLET, blockTag: 'latest' })
    const pending = await publicClient.getTransactionCount({ address: WALLET, blockTag: 'pending' })
    if (latest !== check.snapshot.nonceLatest || pending !== latest) throw new Error('部署前 nonce 已变化，禁止广播')

    const maxFeePerGas = bpsCeil(check.snapshot.gasPrice, 12_500n)
    const data = encodeDeployData({
      abi: check.compiled.abi,
      bytecode: check.compiled.bytecode,
      args: [WALLET, check.minimumSeedOut],
    })
    const plan = recordMutationPlan('deploy', {
      chainId: CHAIN_ID,
      wallet: WALLET,
      nonce: latest,
      to: null,
      value: SEED_ETH,
      dataCommitment: keccak256(data),
      gasLimit: check.gasLimit,
      maxFeePerGas,
      maxPriorityFeePerGas: 0n,
      minimumSeedOut: check.minimumSeedOut,
      sourceHash: check.compiled.sourceHash,
    })
    appendAudit('deployment_prepared', {
      intentId: plan.intentId,
      planHash: plan.planHash,
      nonce: latest,
      seedEthWei: SEED_ETH,
      minimumSeedOut: check.minimumSeedOut,
      gasLimit: check.gasLimit,
      maxFeePerGas,
      sourceHash: check.compiled.sourceHash,
    })
    const serializedTransaction = await account.signTransaction({
      chainId: CHAIN_ID,
      type: 'eip1559',
      data,
      value: SEED_ETH,
      gas: check.gasLimit,
      maxFeePerGas,
      maxPriorityFeePerGas: 0n,
      nonce: latest,
    })
    const hash = keccak256(serializedTransaction)
    const rawPrivateRef = writeSignedRaw(hash, serializedTransaction)
    recordMutationSigned(plan, hash, rawPrivateRef)
    appendAudit('deployment_signed', {
      hash,
      nonce: latest,
      intentId: plan.intentId,
      planHash: plan.planHash,
      rawPrivateRef,
    })
    try {
      const acceptedHash = await walletClient.sendRawTransaction({ serializedTransaction })
      if (acceptedHash.toLowerCase() !== hash.toLowerCase())
        throw new Error('RPC 返回的部署交易哈希与本地签名哈希不一致')
      appendAudit('deployment_broadcast', { hash, nonce: latest, explorer: `${EXPLORER_TX}${hash}` })
    } catch (error) {
      appendAudit('deployment_broadcast_unknown', {
        hash,
        nonce: latest,
        error: errorText(error),
        explorer: `${EXPLORER_TX}${hash}`,
      })
    }

    let receipt
    try {
      receipt = await publicClient.waitForTransactionReceipt({
        hash,
        confirmations: FINALITY_CONFIRMATIONS,
        timeout: 120_000,
      })
    } catch (error) {
      appendAudit('deployment_receipt_unknown', { hash, error: errorText(error) })
      throw new Error(`部署已广播但回执未知，禁止重发：${hash}`)
    }
    if (receipt.status !== 'success' || !receipt.contractAddress) {
      const gasSpentWei = receipt.gasUsed * receipt.effectiveGasPrice
      appendAudit('deployment_reverted', { hash, blockNumber: receipt.blockNumber, gasSpentWei })
      appendAudit('mutation_reverted', { kind: 'deploy', hash, intentId: plan.intentId, gasSpentWei })
      throw new Error(`部署回执失败：${hash}`)
    }
    const executor = getAddress(receipt.contractAddress)
    const [code, operator, seededUsdg, nonceAfter, walletEthAfter] = await Promise.all([
      publicClient.getCode({ address: executor }),
      publicClient.readContract({ address: executor, abi: check.compiled.abi, functionName: 'operator' }),
      publicClient.readContract({ address: USDG, abi: ERC20_ABI, functionName: 'balanceOf', args: [executor] }),
      publicClient.getTransactionCount({ address: WALLET, blockTag: 'latest' }),
      publicClient.getBalance({ address: WALLET }),
    ])
    if (!code || code === '0x') throw new Error('部署回执成功但合约无 bytecode')
    if (operator.toLowerCase() !== WALLET.toLowerCase()) throw new Error(`operator 回读异常：${operator}`)
    if (seededUsdg < check.minimumSeedOut) throw new Error(`种子 USDG 回读低于保护线：${seededUsdg}`)
    if (nonceAfter !== latest + 1) throw new Error(`部署后 nonce 异常：${nonceAfter}`)
    const gasSpentWei = receipt.gasUsed * receipt.effectiveGasPrice
    const state = {
      schemaVersion: 2,
      name: 'MANGA CHAN atomic arbitrage live one',
      status: 'deployed',
      chainId: CHAIN_ID,
      wallet: WALLET,
      executor,
      runtimeCodeHash: keccak256(code),
      sourceHash: check.compiled.sourceHash,
      creationCodeHash: check.compiled.creationCodeHash,
      route: {
        token: MANGA,
        entryToken: MSFT,
        exitToken: NVDA,
        entryV3Pool: ENTRY_V3_POOL,
        exitV3Pool: EXIT_V3_POOL,
        msftMangaPoolId: MSFT_MANGA_POOL_ID,
        mangaNvdaPoolId: MANGA_NVDA_POOL_ID,
      },
      policy: {
        maxAmountInUsdg: '15',
        minimumGrossProfitUsdg: formatUnits(MIN_GROSS_PROFIT, 6),
        minimumNetProfitUsdg: formatUnits(MIN_NET_PROFIT, 6),
        walletEthReserve: formatEther(MIN_WALLET_ETH_RESERVE),
        noWalletTokenApproval: true,
      },
      deployment: {
        hash,
        blockNumber: receipt.blockNumber.toString(),
        gasUsed: receipt.gasUsed.toString(),
        effectiveGasPriceWei: receipt.effectiveGasPrice.toString(),
        gasSpentWei: gasSpentWei.toString(),
        seedEthWei: SEED_ETH.toString(),
        seededUsdgWei: seededUsdg.toString(),
        walletEthAfterWei: walletEthAfter.toString(),
      },
      executions: [],
      deployedAt: new Date().toISOString(),
    }
    writeState(state)
    appendAudit('deployment_complete', {
      executor,
      hash,
      seededUsdg,
      gasSpentWei,
      nonceAfter,
      runtimeCodeHash: state.runtimeCodeHash,
    })
    appendAudit('mutation_effect', {
      kind: 'deploy',
      hash,
      intentId: plan.intentId,
      planHash: plan.planHash,
      result: 'CONFIRMED_SUCCESS',
      blockNumber: receipt.blockNumber,
      confirmations: FINALITY_CONFIRMATIONS,
      executor,
    })
    console.log(
      stringify({
        status: 'DEPLOYED_AND_SEEDED',
        executor,
        transaction: hash,
        explorer: `${EXPLORER_TX}${hash}`,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed,
        gasSpentEth: formatEther(gasSpentWei),
        seededUsdg: formatUnits(seededUsdg, 6),
        walletEthAfter: formatEther(walletEthAfter),
      }),
    )
    return state
  } finally {
    release()
  }
}

async function recoverDeployment() {
  const release = acquireLock()
  try {
    if (readState()?.executor) throw new Error('部署状态已经存在，无需恢复')
    await assertCanonicalTargets()
    const compiled = compileContract()
    const records = readAuditRecords()
    const broadcastIndex = records.findLastIndex((item) => item.event === 'deployment_broadcast')
    if (broadcastIndex < 0) throw new Error('审计账本中没有 deployment_broadcast，禁止猜测恢复')
    const broadcast = records[broadcastIndex]
    const prepared = records
      .slice(0, broadcastIndex)
      .findLast((item) => item.event === 'deployment_prepared' && Number(item.nonce) === Number(broadcast.nonce))
    const preflight = records
      .slice(0, broadcastIndex)
      .findLast((item) => item.event === 'deploy_preflight' && Number(item.nonce) === Number(broadcast.nonce))
    if (!prepared?.minimumSeedOut || !preflight?.balances?.eth) throw new Error('部署审计上下文不完整，禁止恢复')

    const hash = broadcast.hash
    const [transaction, receipt] = await Promise.all([
      publicClient.getTransaction({ hash }),
      publicClient.getTransactionReceipt({ hash }),
    ])
    if (receipt.status !== 'success' || !receipt.contractAddress) throw new Error(`部署交易未成功：${hash}`)
    if (transaction.from.toLowerCase() !== WALLET.toLowerCase() || transaction.to !== null)
      throw new Error('部署交易 sender/to 不匹配')
    if (transaction.nonce !== Number(prepared.nonce) || transaction.value !== SEED_ETH)
      throw new Error('部署交易 nonce/value 不匹配')
    const minimumSeedOut = BigInt(prepared.minimumSeedOut)
    const expectedInput = encodeDeployData({
      abi: compiled.abi,
      bytecode: compiled.bytecode,
      args: [WALLET, minimumSeedOut],
    })
    if (transaction.input.toLowerCase() !== expectedInput.toLowerCase())
      throw new Error('部署交易 calldata 与本地源码/参数不匹配')

    const executor = getAddress(receipt.contractAddress)
    const [code, operator, seededUsdg, nonceAfter, pendingAfter, walletEthAfter, block] = await Promise.all([
      publicClient.getCode({ address: executor }),
      publicClient.readContract({ address: executor, abi: compiled.abi, functionName: 'operator' }),
      publicClient.readContract({ address: USDG, abi: ERC20_ABI, functionName: 'balanceOf', args: [executor] }),
      publicClient.getTransactionCount({ address: WALLET, blockTag: 'latest' }),
      publicClient.getTransactionCount({ address: WALLET, blockTag: 'pending' }),
      publicClient.getBalance({ address: WALLET }),
      publicClient.getBlock({ blockNumber: receipt.blockNumber }),
    ])
    if (!code || code === '0x') throw new Error('部署回执成功但执行器无 bytecode')
    if (operator.toLowerCase() !== WALLET.toLowerCase()) throw new Error(`operator 回读异常：${operator}`)
    if (seededUsdg < minimumSeedOut) throw new Error('执行器 USDG 低于部署保护线')
    if (nonceAfter !== transaction.nonce + 1 || pendingAfter !== nonceAfter)
      throw new Error(`部署后 nonce 未干净收敛：${nonceAfter}/${pendingAfter}`)
    const gasSpentWei = receipt.gasUsed * receipt.effectiveGasPrice
    const walletEthBefore = parseEther(preflight.balances.eth)
    if (walletEthBefore - walletEthAfter !== transaction.value + gasSpentWei)
      throw new Error('钱包 ETH 变化与部署 value + Gas 不一致')

    const state = {
      schemaVersion: 1,
      name: 'MANGA CHAN atomic arbitrage live one',
      status: 'deployed',
      chainId: CHAIN_ID,
      wallet: WALLET,
      executor,
      runtimeCodeHash: keccak256(code),
      sourceHash: compiled.sourceHash,
      creationCodeHash: compiled.creationCodeHash,
      route: {
        token: MANGA,
        entryToken: MSFT,
        exitToken: NVDA,
        entryV3Pool: ENTRY_V3_POOL,
        exitV3Pool: EXIT_V3_POOL,
        msftMangaPoolId: MSFT_MANGA_POOL_ID,
        mangaNvdaPoolId: MANGA_NVDA_POOL_ID,
      },
      policy: {
        maxAmountInUsdg: '15',
        minimumGrossProfitUsdg: formatUnits(MIN_GROSS_PROFIT, 6),
        minimumNetProfitUsdg: formatUnits(MIN_NET_PROFIT, 6),
        walletEthReserve: formatEther(MIN_WALLET_ETH_RESERVE),
        noWalletTokenApproval: true,
      },
      deployment: {
        hash,
        blockNumber: receipt.blockNumber.toString(),
        gasUsed: receipt.gasUsed.toString(),
        effectiveGasPriceWei: receipt.effectiveGasPrice.toString(),
        gasSpentWei: gasSpentWei.toString(),
        seedEthWei: transaction.value.toString(),
        seededUsdgWei: seededUsdg.toString(),
        walletEthAfterWei: walletEthAfter.toString(),
        recoveredFromAudit: true,
      },
      executions: [],
      deployedAt: new Date(Number(block.timestamp) * 1000).toISOString(),
    }
    writeState(state)
    appendAudit('deployment_recovered', {
      executor,
      hash,
      seededUsdg,
      gasSpentWei,
      nonceAfter,
      runtimeCodeHash: state.runtimeCodeHash,
    })
    console.log(
      stringify({
        status: 'DEPLOYMENT_RECOVERED_AND_VALIDATED',
        executor,
        transaction: hash,
        explorer: `${EXPLORER_TX}${hash}`,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed,
        gasSpentEth: formatEther(gasSpentWei),
        seededUsdg: formatUnits(seededUsdg, 6),
        walletEthAfter: formatEther(walletEthAfter),
        nonceAfter,
      }),
    )
    return state
  } finally {
    release()
  }
}

async function assertDeployedState(state, compiled) {
  if (!state?.executor || state.chainId !== CHAIN_ID || state.wallet?.toLowerCase() !== WALLET.toLowerCase()) {
    throw new Error('缺少有效的 MANGA 实盘部署状态')
  }
  const executor = getAddress(state.executor)
  const [code, operator] = await Promise.all([
    publicClient.getCode({ address: executor }),
    publicClient.readContract({ address: executor, abi: compiled.abi, functionName: 'operator' }),
  ])
  if (!code || code === '0x' || keccak256(code) !== state.runtimeCodeHash)
    throw new Error('执行器 bytecode 与部署账本不一致')
  if (operator.toLowerCase() !== WALLET.toLowerCase()) throw new Error('执行器 operator 与钱包不一致')
  if (state.sourceHash !== compiled.sourceHash || state.creationCodeHash !== compiled.creationCodeHash) {
    throw new Error('本地源码/编译参数已变化，禁止对旧部署盲目广播')
  }
  return executor
}

async function executionPreflight({ print = true } = {}) {
  const unresolved = latestUnresolvedExecution()
  if (unresolved) throw new Error(`存在未收敛执行 ${unresolved.hash}，禁止创建新交易`)
  await assertCanonicalTargets()
  const state = readState()
  const compiled = compileContract()
  const executor = await assertDeployedState(state, compiled)
  const snapshot = await walletSnapshot()
  if (snapshot.nonceLatest !== snapshot.noncePending) {
    throw new Error(`存在 pending nonce：latest=${snapshot.nonceLatest}, pending=${snapshot.noncePending}`)
  }
  const principal = await publicClient.readContract({
    address: USDG,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [executor],
  })
  const { quotes, best } = await quoteGrid(principal < 15_000_000n ? principal : 15_000_000n, snapshot.blockNumber)
  if (!best || best.grossProfit < MIN_GROSS_PROFIT) throw new Error('当前没有达到 0.05 USDG 毛利下限的 MANGA 路径')

  const block = await publicClient.getBlock({ blockNumber: snapshot.blockNumber })
  const provisionalDeadline = block.timestamp + DEADLINE_SECONDS
  const provisional = await publicClient.simulateContract({
    account: WALLET,
    address: executor,
    abi: compiled.abi,
    functionName: 'execute',
    args: [best.amountIn, MIN_GROSS_PROFIT, provisionalDeadline],
    blockNumber: snapshot.blockNumber,
  })
  const estimatedGas = await publicClient.estimateContractGas({
    account: WALLET,
    address: executor,
    abi: compiled.abi,
    functionName: 'execute',
    args: [best.amountIn, MIN_GROSS_PROFIT, provisionalDeadline],
  })
  const simulatedOut = provisional.result[0]
  const simulatedGross = provisional.result[1]
  if (simulatedOut !== best.amountOut || simulatedGross !== best.grossProfit) {
    throw new Error('组合 Quoter 与执行器 eth_call 输出不一致')
  }

  const nativeMark = await quoteV3(WETH, 100, USDG, SEED_ETH, snapshot.blockNumber)
  const expectedGasCostUsdg = (estimatedGas * snapshot.gasPrice * nativeMark.amountOut) / SEED_ETH
  const expectedNetProfit = simulatedGross - expectedGasCostUsdg
  const minProfit = maxBigInt(
    MIN_GROSS_PROFIT,
    (simulatedGross * PROFIT_FLOOR_BPS) / 10_000n,
    (expectedGasCostUsdg * 10_500n) / 10_000n + MIN_NET_PROFIT,
  )
  if (expectedNetProfit < MIN_NET_PROFIT || minProfit > simulatedGross) {
    throw new Error(
      `当前净利润不足：毛利 ${formatUnits(simulatedGross, 6)}，预计 Gas ${formatUnits(expectedGasCostUsdg, 6)}，预计净利 ${formatUnits(expectedNetProfit, 6)}`,
    )
  }

  const deadline = block.timestamp + DEADLINE_SECONDS
  await publicClient.simulateContract({
    account: WALLET,
    address: executor,
    abi: compiled.abi,
    functionName: 'execute',
    args: [best.amountIn, minProfit, deadline],
    blockNumber: snapshot.blockNumber,
  })
  const gasLimit = bpsCeil(estimatedGas, EXECUTION_GAS_BUFFER_BPS) + 3_000n
  const netBudgetUsdg = minProfit - MIN_NET_PROFIT
  const maxFeeByProfit = (netBudgetUsdg * SEED_ETH) / (gasLimit * nativeMark.amountOut)
  const maxFeeByHeadroom = bpsCeil(snapshot.gasPrice, MAX_FEE_HEADROOM_BPS)
  const maxFeePerGas = maxFeeByProfit < maxFeeByHeadroom ? maxFeeByProfit : maxFeeByHeadroom
  if (maxFeePerGas < snapshot.gasPrice) {
    throw new Error(`净利保护允许的 maxFee ${maxFeePerGas} wei 低于当前 gasPrice ${snapshot.gasPrice} wei`)
  }
  const maximumGasCostUsdg = (gasLimit * maxFeePerGas * nativeMark.amountOut) / SEED_ETH
  if (minProfit < maximumGasCostUsdg + MIN_NET_PROFIT) throw new Error('最坏 Gas 成本无法满足净利润硬下限')
  if (snapshot.ethBalance < gasLimit * maxFeePerGas + MIN_WALLET_ETH_RESERVE)
    throw new Error(`钱包 ETH 无法同时覆盖本次 Gas 与 ${formatEther(MIN_WALLET_ETH_RESERVE)} ETH 储备`)

  const report = {
    status: 'READY_TO_EXECUTE',
    blockNumber: snapshot.blockNumber,
    wallet: WALLET,
    executor,
    nonce: snapshot.nonceLatest,
    executorUsdg: formatUnits(principal, 6),
    quotes: quotes.map((item) =>
      item.error
        ? {
            amountIn: formatUnits(item.amountIn, 6),
            error: item.error,
          }
        : {
            amountIn: formatUnits(item.amountIn, 6),
            amountOut: formatUnits(item.amountOut, 6),
            grossProfit: formatUnits(item.grossProfit, 6),
            quoterGas: item.quoterGas,
          },
    ),
    selected: {
      amountIn: formatUnits(best.amountIn, 6),
      simulatedOut: formatUnits(simulatedOut, 6),
      simulatedGrossProfit: formatUnits(simulatedGross, 6),
      minimumGrossProfit: formatUnits(minProfit, 6),
      expectedGasCostUsdg: formatUnits(expectedGasCostUsdg, 6),
      expectedNetProfitUsdg: formatUnits(expectedNetProfit, 6),
      minimumNetProfitUsdg: formatUnits(MIN_NET_PROFIT, 6),
    },
    gas: {
      estimatedGas,
      gasLimit,
      gasPriceWei: snapshot.gasPrice,
      maxFeePerGasWei: maxFeePerGas,
      maximumCostUsdg: formatUnits(maximumGasCostUsdg, 6),
    },
    deadline,
  }
  appendAudit('execution_preflight', report)
  if (print) console.log(stringify(report))
  return {
    state,
    compiled,
    executor,
    snapshot,
    principal,
    best,
    minProfit,
    deadline,
    gasLimit,
    maxFeePerGas,
    expectedGasCostUsdg,
    expectedNetProfit,
    report,
  }
}

async function execute() {
  const release = acquireLock()
  try {
    assertLiveTransport(RUNTIME_CONFIG)
    const check = await executionPreflight({ print: true })
    const account = loadAccount()
    const walletClient = createWalletClient({
      account,
      chain,
      transport: http(RPC_URL, { timeout: 30_000, retryCount: 0 }),
    })

    const [latest, pending, blockBefore, liveGasPrice, usdgBefore, ethBefore] = await Promise.all([
      publicClient.getTransactionCount({ address: WALLET, blockTag: 'latest' }),
      publicClient.getTransactionCount({ address: WALLET, blockTag: 'pending' }),
      publicClient.getBlock(),
      publicClient.getGasPrice(),
      publicClient.readContract({ address: USDG, abi: ERC20_ABI, functionName: 'balanceOf', args: [check.executor] }),
      publicClient.getBalance({ address: WALLET }),
    ])
    if (latest !== check.snapshot.nonceLatest || pending !== latest) throw new Error('广播前 nonce 已变化，禁止广播')
    if (liveGasPrice > check.maxFeePerGas)
      throw new Error(`广播前 gasPrice ${liveGasPrice} 已超过净利保护 maxFee ${check.maxFeePerGas}`)

    const liveDeadline = blockBefore.timestamp + DEADLINE_SECONDS
    const liveSimulation = await publicClient.simulateContract({
      account: WALLET,
      address: check.executor,
      abi: check.compiled.abi,
      functionName: 'execute',
      args: [check.best.amountIn, check.minProfit, liveDeadline],
    })
    const liveNativeMark = await quoteV3(WETH, 100, USDG, SEED_ETH, blockBefore.number)
    const liveMaximumGasCostUsdg = (check.gasLimit * check.maxFeePerGas * liveNativeMark.amountOut) / SEED_ETH
    if (check.minProfit < liveMaximumGasCostUsdg + MIN_NET_PROFIT) {
      throw new Error('广播前最新 ETH/USDG 价格使最坏 Gas 成本突破净利保护')
    }
    const data = encodeFunctionData({
      abi: check.compiled.abi,
      functionName: 'execute',
      args: [check.best.amountIn, check.minProfit, liveDeadline],
    })
    const activeArm = readWatchArm()
    const plan = recordMutationPlan('execute', {
      chainId: CHAIN_ID,
      wallet: WALLET,
      executor: check.executor,
      authorizationId: activeArm?.status === 'ARMED' ? activeArm.authorizationId : null,
      nonce: latest,
      to: check.executor,
      value: 0n,
      dataCommitment: keccak256(data),
      gasLimit: check.gasLimit,
      maxFeePerGas: check.maxFeePerGas,
      maxPriorityFeePerGas: 0n,
      blockNumber: blockBefore.number,
      amountIn: check.best.amountIn,
      minimumGrossProfit: check.minProfit,
      deadline: liveDeadline,
      executorUsdgBefore: usdgBefore,
      walletEthBefore: ethBefore,
    })
    appendAudit('execution_prepared', {
      intentId: plan.intentId,
      planHash: plan.planHash,
      nonce: latest,
      blockNumber: blockBefore.number,
      amountIn: check.best.amountIn,
      simulatedAmountOut: liveSimulation.result[0],
      simulatedGrossProfit: liveSimulation.result[1],
      minimumGrossProfit: check.minProfit,
      gasLimit: check.gasLimit,
      maxFeePerGas: check.maxFeePerGas,
      liveMaximumGasCostUsdg,
      deadline: liveDeadline,
      executorUsdgBefore: usdgBefore,
      walletEthBefore: ethBefore,
    })
    const serializedTransaction = await account.signTransaction({
      chainId: CHAIN_ID,
      type: 'eip1559',
      to: check.executor,
      data,
      gas: check.gasLimit,
      maxFeePerGas: check.maxFeePerGas,
      maxPriorityFeePerGas: 0n,
      nonce: latest,
    })
    const hash = keccak256(serializedTransaction)
    const rawPrivateRef = writeSignedRaw(hash, serializedTransaction)
    recordMutationSigned(plan, hash, rawPrivateRef)
    appendAudit('execution_signed', {
      hash,
      nonce: latest,
      intentId: plan.intentId,
      planHash: plan.planHash,
      payloadCommitment: keccak256(data),
      rawPrivateRef,
      deadline: liveDeadline,
    })

    try {
      const acceptedHash = await walletClient.sendRawTransaction({ serializedTransaction })
      if (acceptedHash.toLowerCase() !== hash.toLowerCase()) throw new Error('RPC 返回的交易哈希与本地签名哈希不一致')
      appendAudit('execution_broadcast_accepted', { hash, nonce: latest, explorer: `${EXPLORER_TX}${hash}` })
    } catch (error) {
      appendAudit('execution_broadcast_unknown', {
        hash,
        nonce: latest,
        error: errorText(error),
        explorer: `${EXPLORER_TX}${hash}`,
      })
    }

    let receipt
    try {
      receipt = await publicClient.waitForTransactionReceipt({
        hash,
        confirmations: FINALITY_CONFIRMATIONS,
        timeout: 120_000,
      })
    } catch (error) {
      appendAudit('execution_receipt_unknown', { hash, error: errorText(error) })
      throw new Error(`执行已广播但回执未知，禁止重发：${hash}`)
    }
    appendAudit('execution_receipt_observed', {
      hash,
      status: receipt.status,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed,
      effectiveGasPriceWei: receipt.effectiveGasPrice,
    })
    if (receipt.status !== 'success') {
      const [usdgAfterRevert, ethAfterRevert, nonceAfterRevert, pendingAfterRevert] = await Promise.all([
        publicClient.readContract({ address: USDG, abi: ERC20_ABI, functionName: 'balanceOf', args: [check.executor] }),
        publicClient.getBalance({ address: WALLET }),
        publicClient.getTransactionCount({ address: WALLET, blockTag: 'latest' }),
        publicClient.getTransactionCount({ address: WALLET, blockTag: 'pending' }),
      ])
      const revertedGasSpentWei = receipt.gasUsed * receipt.effectiveGasPrice
      const revertedRecord = {
        hash,
        blockNumber: receipt.blockNumber.toString(),
        amountInWei: check.best.amountIn.toString(),
        result: 'REVERTED',
        gasUsed: receipt.gasUsed.toString(),
        effectiveGasPriceWei: receipt.effectiveGasPrice.toString(),
        gasSpentWei: revertedGasSpentWei.toString(),
        executorUsdgBeforeWei: usdgBefore.toString(),
        executorUsdgAfterWei: usdgAfterRevert.toString(),
        walletEthAfterWei: ethAfterRevert.toString(),
        nonceAfter: nonceAfterRevert,
        pendingAfter: pendingAfterRevert,
        confirmedAt: new Date().toISOString(),
      }
      const revertedState = readState()
      revertedState.status = 'halted_after_revert'
      revertedState.failedExecutions = [...(revertedState.failedExecutions || []), revertedRecord]
      writeState(revertedState)
      appendAudit('execution_reverted', revertedRecord)
      appendAudit('mutation_reverted', {
        kind: 'execute',
        hash,
        intentId: plan.intentId,
        planHash: plan.planHash,
        gasSpentWei: revertedGasSpentWei,
        blockNumber: receipt.blockNumber,
      })
      throw new Error(`执行已链上回滚并停止自动通道：${hash}`)
    }

    const [usdgAfter, ethAfter, nonceAfter, pendingAfter] = await Promise.all([
      publicClient.readContract({ address: USDG, abi: ERC20_ABI, functionName: 'balanceOf', args: [check.executor] }),
      publicClient.getBalance({ address: WALLET }),
      publicClient.getTransactionCount({ address: WALLET, blockTag: 'latest' }),
      publicClient.getTransactionCount({ address: WALLET, blockTag: 'pending' }),
    ])
    const grossProfit = usdgAfter - usdgBefore
    const gasSpentWei = receipt.gasUsed * receipt.effectiveGasPrice
    const gasSpentUsdg = (gasSpentWei * (await quoteV3(WETH, 100, USDG, SEED_ETH)).amountOut) / SEED_ETH
    const netProfit = grossProfit - gasSpentUsdg
    if (grossProfit < check.minProfit) throw new Error(`回执成功但毛利低于链上保护线：${grossProfit}`)
    if (nonceAfter !== latest + 1 || pendingAfter !== nonceAfter) throw new Error('执行后 nonce 未干净收敛')
    if (ethBefore - ethAfter !== gasSpentWei) throw new Error('钱包 ETH 变化与回执 Gas 不一致')

    const state = readState()
    const record = {
      hash,
      blockNumber: receipt.blockNumber.toString(),
      amountInWei: check.best.amountIn.toString(),
      amountOutWei: (check.best.amountIn + grossProfit).toString(),
      grossProfitWei: grossProfit.toString(),
      gasUsed: receipt.gasUsed.toString(),
      effectiveGasPriceWei: receipt.effectiveGasPrice.toString(),
      gasSpentWei: gasSpentWei.toString(),
      gasSpentUsdgWei: gasSpentUsdg.toString(),
      netProfitUsdgWei: netProfit.toString(),
      executorUsdgBeforeWei: usdgBefore.toString(),
      executorUsdgAfterWei: usdgAfter.toString(),
      walletEthAfterWei: ethAfter.toString(),
      confirmedAt: new Date().toISOString(),
    }
    state.status = 'live_validated'
    state.executions = [...(state.executions || []), record]
    state.lastExecution = record
    writeState(state)
    appendAudit('execution_complete', record)
    appendAudit('mutation_effect', {
      kind: 'execute',
      hash,
      intentId: plan.intentId,
      planHash: plan.planHash,
      result: 'CONFIRMED_SUCCESS',
      confirmations: FINALITY_CONFIRMATIONS,
      blockNumber: receipt.blockNumber,
      grossProfitWei: grossProfit,
      netProfitUsdgWei: netProfit,
    })
    console.log(
      stringify({
        status: 'LIVE_EXECUTION_CONFIRMED',
        transaction: hash,
        explorer: `${EXPLORER_TX}${hash}`,
        blockNumber: receipt.blockNumber,
        amountInUsdg: formatUnits(check.best.amountIn, 6),
        amountOutUsdg: formatUnits(check.best.amountIn + grossProfit, 6),
        grossProfitUsdg: formatUnits(grossProfit, 6),
        gasUsed: receipt.gasUsed,
        gasSpentEth: formatEther(gasSpentWei),
        gasSpentUsdg: formatUnits(gasSpentUsdg, 6),
        netProfitUsdg: formatUnits(netProfit, 6),
        executorUsdgAfter: formatUnits(usdgAfter, 6),
        walletEthAfter: formatEther(ethAfter),
        nonceAfter,
      }),
    )
    return state
  } finally {
    release()
  }
}

async function optionalChainLookup(operation) {
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
      optionalChainLookup(() => client.getTransaction({ hash })),
      optionalChainLookup(() => client.getTransactionReceipt({ hash })),
    ])
    return { source, head, latestNonce, pendingNonce, transaction, receipt }
  } catch (error) {
    return { source, error: errorText(error) }
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

async function finalizeReconciledSuccess(mutation, plan, receipt) {
  const compiled = compileContract()
  const gasSpentWei = receipt.gasUsed * receipt.effectiveGasPrice

  if (mutation.kind === 'execute') {
    const state = readState()
    const executor = await assertDeployedState(state, compiled)
    const executed = decodeExecutorEvent(receipt, compiled, executor, 'Executed')
    if (!executed) throw new Error('成功回执缺少执行器 Executed 事件，保持 UNKNOWN')
    if (BigInt(executed.amountIn) !== BigInt(plan.amountIn)) throw new Error('Executed amountIn 与持久化计划不一致')
    const executorUsdg = await publicClient.readContract({
      address: USDG,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [executor],
    })
    const expectedExecutorUsdg = BigInt(plan.executorUsdgBefore) + BigInt(executed.grossProfit)
    if (executorUsdg !== expectedExecutorUsdg)
      throw new Error('执行器余额与计划前余额 + Executed 毛利不一致，保持 UNKNOWN')
    let gasSpentUsdg = null
    try {
      const mark = await quoteV3(WETH, 100, USDG, SEED_ETH, receipt.blockNumber)
      gasSpentUsdg = (gasSpentWei * mark.amountOut) / SEED_ETH
    } catch {}
    const record = {
      hash: mutation.hash,
      blockNumber: receipt.blockNumber.toString(),
      blockHash: receipt.blockHash,
      result: 'CONFIRMED_SUCCESS',
      reconciled: true,
      amountInWei: BigInt(executed.amountIn).toString(),
      amountOutWei: BigInt(executed.amountOut).toString(),
      grossProfitWei: BigInt(executed.grossProfit).toString(),
      gasUsed: receipt.gasUsed.toString(),
      effectiveGasPriceWei: receipt.effectiveGasPrice.toString(),
      gasSpentWei: gasSpentWei.toString(),
      gasSpentUsdgWei: gasSpentUsdg?.toString() || null,
      netProfitUsdgWei: gasSpentUsdg === null ? null : (BigInt(executed.grossProfit) - gasSpentUsdg).toString(),
      executorUsdgBeforeWei: BigInt(plan.executorUsdgBefore).toString(),
      executorUsdgAfterWei: executorUsdg.toString(),
      confirmedAt: new Date().toISOString(),
    }
    state.status = 'live_validated'
    if (!(state.executions || []).some((item) => item.hash === mutation.hash))
      state.executions = [...(state.executions || []), record]
    state.lastExecution = record
    writeState(state)
    appendAudit('execution_complete', record)
    appendAudit('mutation_effect', {
      kind: mutation.kind,
      hash: mutation.hash,
      intentId: mutation.intentId,
      planHash: mutation.planHash,
      result: 'CONFIRMED_SUCCESS',
      reconciled: true,
      blockNumber: receipt.blockNumber,
    })
    return record
  }

  if (mutation.kind === 'withdraw') {
    const state = readState()
    const executor = await assertDeployedState(state, compiled)
    const withdrawn = decodeExecutorEvent(receipt, compiled, executor, 'Withdrawn')
    if (!withdrawn || BigInt(withdrawn.amount) !== BigInt(plan.amount)) {
      throw new Error('成功回执缺少匹配的 Withdrawn 事件，保持 UNKNOWN')
    }
    const [executorAfter, walletAfter] = await Promise.all([
      publicClient.readContract({ address: USDG, abi: ERC20_ABI, functionName: 'balanceOf', args: [executor] }),
      publicClient.readContract({ address: USDG, abi: ERC20_ABI, functionName: 'balanceOf', args: [WALLET] }),
    ])
    if (executorAfter !== 0n || walletAfter - BigInt(plan.walletUsdgBefore) !== BigInt(plan.amount)) {
      throw new Error('撤回后的执行器/钱包 USDG 余额与计划不一致，保持 UNKNOWN')
    }
    const record = {
      hash: mutation.hash,
      blockNumber: receipt.blockNumber.toString(),
      blockHash: receipt.blockHash,
      amountWei: BigInt(plan.amount).toString(),
      gasUsed: receipt.gasUsed.toString(),
      effectiveGasPriceWei: receipt.effectiveGasPrice.toString(),
      gasSpentWei: gasSpentWei.toString(),
      executorUsdgAfterWei: executorAfter.toString(),
      walletUsdgAfterWei: walletAfter.toString(),
      reconciled: true,
      confirmedAt: new Date().toISOString(),
    }
    state.status = 'withdrawn'
    state.withdrawal = record
    writeState(state)
    appendAudit('withdrawal_complete', record)
    appendAudit('mutation_effect', {
      kind: mutation.kind,
      hash: mutation.hash,
      intentId: mutation.intentId,
      planHash: mutation.planHash,
      result: 'CONFIRMED_SUCCESS',
      reconciled: true,
      blockNumber: receipt.blockNumber,
    })
    return record
  }

  if (mutation.kind === 'deploy') {
    if (!receipt.contractAddress) throw new Error('部署成功回执缺少 contractAddress，保持 UNKNOWN')
    const executor = getAddress(receipt.contractAddress)
    const [code, operator, seededUsdg, walletEthAfter] = await Promise.all([
      publicClient.getCode({ address: executor }),
      publicClient.readContract({ address: executor, abi: compiled.abi, functionName: 'operator' }),
      publicClient.readContract({ address: USDG, abi: ERC20_ABI, functionName: 'balanceOf', args: [executor] }),
      publicClient.getBalance({ address: WALLET }),
    ])
    if (!code || code === '0x' || operator.toLowerCase() !== WALLET.toLowerCase()) {
      throw new Error('部署回执后的 bytecode/operator 验证失败，保持 UNKNOWN')
    }
    if (seededUsdg < BigInt(plan.minimumSeedOut)) throw new Error('部署种子余额低于计划保护线，保持 UNKNOWN')
    const state = {
      schemaVersion: 2,
      name: 'MANGA CHAN atomic arbitrage',
      status: 'deployed',
      chainId: CHAIN_ID,
      wallet: WALLET,
      executor,
      runtimeCodeHash: keccak256(code),
      sourceHash: compiled.sourceHash,
      creationCodeHash: compiled.creationCodeHash,
      route: {
        token: MANGA,
        entryToken: MSFT,
        exitToken: NVDA,
        entryV3Pool: ENTRY_V3_POOL,
        exitV3Pool: EXIT_V3_POOL,
        msftMangaPoolId: MSFT_MANGA_POOL_ID,
        mangaNvdaPoolId: MANGA_NVDA_POOL_ID,
      },
      policy: {
        maxAmountInUsdg: '15',
        minimumGrossProfitUsdg: formatUnits(MIN_GROSS_PROFIT, 6),
        minimumNetProfitUsdg: formatUnits(MIN_NET_PROFIT, 6),
        walletEthReserve: formatEther(MIN_WALLET_ETH_RESERVE),
        noWalletTokenApproval: true,
      },
      deployment: {
        hash: mutation.hash,
        blockNumber: receipt.blockNumber.toString(),
        gasUsed: receipt.gasUsed.toString(),
        effectiveGasPriceWei: receipt.effectiveGasPrice.toString(),
        gasSpentWei: gasSpentWei.toString(),
        seedEthWei: BigInt(plan.value).toString(),
        seededUsdgWei: seededUsdg.toString(),
        walletEthAfterWei: walletEthAfter.toString(),
        reconciled: true,
      },
      executions: [],
      deployedAt: new Date().toISOString(),
    }
    writeState(state)
    appendAudit('deployment_complete', {
      hash: mutation.hash,
      executor,
      seededUsdg,
      gasSpentWei,
      runtimeCodeHash: state.runtimeCodeHash,
      reconciled: true,
    })
    appendAudit('mutation_effect', {
      kind: mutation.kind,
      hash: mutation.hash,
      intentId: mutation.intentId,
      planHash: mutation.planHash,
      result: 'CONFIRMED_SUCCESS',
      reconciled: true,
      blockNumber: receipt.blockNumber,
      executor,
    })
    return state.deployment
  }

  throw new Error(`不支持的 mutation kind：${mutation.kind}`)
}

async function reconcile() {
  assertLiveTransport(RUNTIME_CONFIG)
  const release = acquireLock()
  try {
    const records = readAuditRecords()
    const mutation = latestUnresolvedMutation(records)
    if (!mutation) {
      const result = { status: 'CLEAN', unresolvedMutation: null }
      console.log(stringify(result))
      return result
    }
    const plan = records.findLast((item) => item.event === 'mutation_plan' && item.planHash === mutation.planHash)
    if (!plan) throw new Error(`未找到 ${mutation.hash} 的持久化 mutation_plan，保持 UNKNOWN`)
    const rawPrivateRef = path.resolve(mutation.rawPrivateRef || '')
    const signedRoot = `${path.resolve(SIGNED_TX_DIR)}${path.sep}`
    if (!rawPrivateRef.startsWith(signedRoot) || !fs.existsSync(rawPrivateRef)) {
      throw new Error(`签名 raw 不在策略私有目录或已经丢失：${mutation.hash}`)
    }
    assertPrivateFile(rawPrivateRef)
    const serializedTransaction = fs.readFileSync(rawPrivateRef, 'utf8').trim()
    if (keccak256(serializedTransaction).toLowerCase() !== mutation.hash.toLowerCase()) {
      throw new Error(`持久化 raw 的哈希与审计记录不一致：${mutation.hash}`)
    }
    const parsed = parseTransaction(serializedTransaction)
    const signer = await recoverTransactionAddress({ serializedTransaction })
    if (signer.toLowerCase() !== WALLET.toLowerCase() || parsed.nonce !== Number(mutation.nonce)) {
      throw new Error('持久化 raw 的签名者或 nonce 与审计计划不一致')
    }

    const readers = [{ client: publicClient, source: 'primary' }]
    if (secondaryPublicClient) readers.push({ client: secondaryPublicClient, source: 'secondary' })
    const observations = await Promise.all(
      readers.map(({ client, source }) => observeMutation(client, source, mutation.hash)),
    )
    const outcome = classifyReconciliation(observations, Number(mutation.nonce), FINALITY_CONFIRMATIONS)
    appendAudit('mutation_reconcile_observed', {
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
        receiptBlock: item.receipt?.blockNumber || null,
        error: item.error || null,
      })),
    })

    if (outcome.state === 'CONFIRMED_SUCCESS') {
      const effect = await finalizeReconciledSuccess(mutation, plan, outcome.receipt)
      const result = { status: 'RECONCILED_SUCCESS', hash: mutation.hash, effect }
      console.log(stringify(result))
      return result
    }
    if (outcome.state === 'CONFIRMED_REVERTED') {
      const gasSpentWei = outcome.receipt.gasUsed * outcome.receipt.effectiveGasPrice
      const event =
        mutation.kind === 'execute'
          ? 'execution_reverted'
          : mutation.kind === 'withdraw'
            ? 'withdrawal_reverted'
            : 'deployment_reverted'
      appendAudit(event, {
        hash: mutation.hash,
        blockNumber: outcome.receipt.blockNumber,
        gasSpentWei,
        reconciled: true,
      })
      appendAudit('mutation_reverted', {
        kind: mutation.kind,
        hash: mutation.hash,
        intentId: mutation.intentId,
        planHash: mutation.planHash,
        gasSpentWei,
        reconciled: true,
      })
      const state = readState()
      if (state) {
        state.status = 'halted_after_revert'
        writeState(state)
      }
      const result = { status: 'RECONCILED_REVERTED', hash: mutation.hash, gasSpentWei }
      console.log(stringify(result))
      return result
    }

    if (outcome.state === 'NOT_OBSERVED' && process.argv.includes('--rebroadcast-same-raw')) {
      const broadcasters = [
        { client: publicClient, source: 'primary' },
        ...(secondaryPublicClient ? [{ client: secondaryPublicClient, source: 'secondary' }] : []),
      ]
      const results = await Promise.allSettled(
        broadcasters.map(async ({ client, source }) => {
          const acceptedHash = await client.sendRawTransaction({ serializedTransaction })
          if (acceptedHash.toLowerCase() !== mutation.hash.toLowerCase()) throw new Error('广播端返回不同交易哈希')
          return { source, acceptedHash }
        }),
      )
      appendAudit('mutation_same_raw_rebroadcast', {
        kind: mutation.kind,
        hash: mutation.hash,
        results: results.map((item) =>
          item.status === 'fulfilled'
            ? { status: item.status, ...item.value }
            : { status: item.status, error: errorText(item.reason) },
        ),
      })
      const result = { status: 'SAME_RAW_REBROADCAST', hash: mutation.hash, outcome, results }
      console.log(stringify(result))
      return result
    }

    const result = { status: `RECONCILE_${outcome.state}`, hash: mutation.hash, outcome }
    console.log(stringify(result))
    return result
  } finally {
    release()
  }
}

async function withdrawAll() {
  const release = acquireLock()
  try {
    assertLiveTransport(RUNTIME_CONFIG)
    const unresolved = latestUnresolvedExecution()
    if (unresolved)
      throw new Error(`存在未收敛 ${unresolved.kind || 'mutation'} ${unresolved.hash}，禁止撤回或创建新 nonce`)
    const state = readState()
    const compiled = compileContract()
    const executor = await assertDeployedState(state, compiled)
    const account = loadAccount()
    const walletClient = createWalletClient({
      account,
      chain,
      transport: http(RPC_URL, { timeout: 30_000, retryCount: 0 }),
    })
    const [amount, walletUsdgBefore, walletEthBefore, nonceLatest, noncePending, gasPrice] = await Promise.all([
      publicClient.readContract({ address: USDG, abi: ERC20_ABI, functionName: 'balanceOf', args: [executor] }),
      publicClient.readContract({ address: USDG, abi: ERC20_ABI, functionName: 'balanceOf', args: [WALLET] }),
      publicClient.getBalance({ address: WALLET }),
      publicClient.getTransactionCount({ address: WALLET, blockTag: 'latest' }),
      publicClient.getTransactionCount({ address: WALLET, blockTag: 'pending' }),
      publicClient.getGasPrice(),
    ])
    if (amount === 0n) throw new Error('执行器 USDG 余额已经为 0')
    if (nonceLatest !== noncePending) throw new Error(`存在 pending nonce：${nonceLatest}/${noncePending}`)
    const request = {
      account,
      address: executor,
      abi: compiled.abi,
      functionName: 'withdraw',
      args: [USDG, amount, WALLET],
    }
    await publicClient.simulateContract(request)
    const estimatedGas = await publicClient.estimateContractGas(request)
    const gasLimit = bpsCeil(estimatedGas, 12_000n) + 5_000n
    const maxFeePerGas = bpsCeil(gasPrice, 12_000n)
    if (walletEthBefore < gasLimit * maxFeePerGas + MIN_WALLET_ETH_RESERVE)
      throw new Error('钱包 ETH 不足以安全撤回执行器资金')

    const data = encodeFunctionData({ abi: compiled.abi, functionName: 'withdraw', args: [USDG, amount, WALLET] })
    const plan = recordMutationPlan('withdraw', {
      chainId: CHAIN_ID,
      wallet: WALLET,
      executor,
      nonce: nonceLatest,
      to: executor,
      value: 0n,
      dataCommitment: keccak256(data),
      gasLimit,
      maxFeePerGas,
      maxPriorityFeePerGas: 0n,
      token: USDG,
      amount,
      destination: WALLET,
      executorUsdgBefore: amount,
      walletUsdgBefore,
      walletEthBefore,
    })
    appendAudit('withdrawal_prepared', {
      executor,
      amount,
      nonce: nonceLatest,
      estimatedGas,
      gasLimit,
      maxFeePerGas,
      intentId: plan.intentId,
      planHash: plan.planHash,
    })
    const serializedTransaction = await account.signTransaction({
      chainId: CHAIN_ID,
      type: 'eip1559',
      to: executor,
      data,
      value: 0n,
      gas: gasLimit,
      maxFeePerGas,
      maxPriorityFeePerGas: 0n,
      nonce: nonceLatest,
    })
    const hash = keccak256(serializedTransaction)
    const rawPrivateRef = writeSignedRaw(hash, serializedTransaction)
    recordMutationSigned(plan, hash, rawPrivateRef)
    appendAudit('withdrawal_signed', {
      hash,
      nonce: nonceLatest,
      intentId: plan.intentId,
      planHash: plan.planHash,
      rawPrivateRef,
    })
    try {
      const acceptedHash = await walletClient.sendRawTransaction({ serializedTransaction })
      if (acceptedHash.toLowerCase() !== hash.toLowerCase())
        throw new Error('RPC 返回的撤回交易哈希与本地签名哈希不一致')
      appendAudit('withdrawal_broadcast', { hash, nonce: nonceLatest, explorer: `${EXPLORER_TX}${hash}` })
    } catch (error) {
      appendAudit('withdrawal_broadcast_unknown', {
        hash,
        nonce: nonceLatest,
        error: errorText(error),
        explorer: `${EXPLORER_TX}${hash}`,
      })
    }
    let receipt
    try {
      receipt = await publicClient.waitForTransactionReceipt({
        hash,
        confirmations: FINALITY_CONFIRMATIONS,
        timeout: 120_000,
      })
    } catch (error) {
      appendAudit('withdrawal_receipt_unknown', { hash, error: errorText(error) })
      throw new Error(`撤回已广播但回执未知，禁止重发：${hash}`)
    }
    if (receipt.status !== 'success') {
      const gasSpentWei = receipt.gasUsed * receipt.effectiveGasPrice
      appendAudit('withdrawal_reverted', { hash, blockNumber: receipt.blockNumber, gasSpentWei })
      appendAudit('mutation_reverted', {
        kind: 'withdraw',
        hash,
        intentId: plan.intentId,
        planHash: plan.planHash,
        gasSpentWei,
      })
      throw new Error(`撤回回执失败：${hash}`)
    }
    const [executorAfter, walletUsdgAfter, walletEthAfter, nonceAfter, pendingAfter] = await Promise.all([
      publicClient.readContract({ address: USDG, abi: ERC20_ABI, functionName: 'balanceOf', args: [executor] }),
      publicClient.readContract({ address: USDG, abi: ERC20_ABI, functionName: 'balanceOf', args: [WALLET] }),
      publicClient.getBalance({ address: WALLET }),
      publicClient.getTransactionCount({ address: WALLET, blockTag: 'latest' }),
      publicClient.getTransactionCount({ address: WALLET, blockTag: 'pending' }),
    ])
    if (executorAfter !== 0n || walletUsdgAfter - walletUsdgBefore !== amount)
      throw new Error('撤回回执成功但 USDG 余额读回不一致')
    if (nonceAfter !== nonceLatest + 1 || pendingAfter !== nonceAfter) throw new Error('撤回后 nonce 未干净收敛')
    const gasSpentWei = receipt.gasUsed * receipt.effectiveGasPrice
    if (walletEthBefore - walletEthAfter !== gasSpentWei) throw new Error('撤回钱包 ETH 变化与回执 Gas 不一致')
    const record = {
      hash,
      blockNumber: receipt.blockNumber.toString(),
      amountWei: amount.toString(),
      gasUsed: receipt.gasUsed.toString(),
      effectiveGasPriceWei: receipt.effectiveGasPrice.toString(),
      gasSpentWei: gasSpentWei.toString(),
      executorUsdgAfterWei: executorAfter.toString(),
      walletUsdgAfterWei: walletUsdgAfter.toString(),
      walletEthAfterWei: walletEthAfter.toString(),
      confirmedAt: new Date().toISOString(),
    }
    state.status = 'withdrawn'
    state.withdrawal = record
    writeState(state)
    appendAudit('withdrawal_complete', record)
    appendAudit('mutation_effect', {
      kind: 'withdraw',
      hash,
      intentId: plan.intentId,
      planHash: plan.planHash,
      result: 'CONFIRMED_SUCCESS',
      confirmations: FINALITY_CONFIRMATIONS,
      blockNumber: receipt.blockNumber,
      amountWei: amount,
    })
    console.log(
      stringify({
        status: 'WITHDRAWAL_CONFIRMED',
        transaction: hash,
        explorer: `${EXPLORER_TX}${hash}`,
        amountUsdg: formatUnits(amount, 6),
        executorUsdgAfter: formatUnits(executorAfter, 6),
        walletUsdgAfter: formatUnits(walletUsdgAfter, 6),
        gasUsed: receipt.gasUsed,
        gasSpentEth: formatEther(gasSpentWei),
        nonceAfter,
      }),
    )
  } finally {
    release()
  }
}

async function armWatcher() {
  const release = acquireLock(WATCH_LOCK_PATH)
  try {
    assertLiveTransport(RUNTIME_CONFIG, { requireWss: true })
    const unresolved = latestUnresolvedExecution()
    if (unresolved) throw new Error(`存在未收敛执行 ${unresolved.hash}，禁止 arm`)
    await assertCanonicalTargets()
    const compiled = compileContract()
    const state = readState()
    const executor = await assertDeployedState(state, compiled)
    loadAccount()
    const [snapshot, principal] = await Promise.all([
      walletSnapshot(),
      publicClient.readContract({ address: USDG, abi: ERC20_ABI, functionName: 'balanceOf', args: [executor] }),
    ])
    if (snapshot.nonceLatest !== snapshot.noncePending)
      throw new Error(`存在 pending nonce：${snapshot.nonceLatest}/${snapshot.noncePending}`)
    if (snapshot.ethBalance <= MIN_WALLET_ETH_RESERVE) throw new Error('钱包 ETH 已触及 Gas 储备线')
    if (principal < AMOUNT_GRID[0]) throw new Error(`执行器本金低于最小报价档：${formatUnits(principal, 6)} USDG`)

    const issuedAt = new Date()
    const expiresAt = new Date(issuedAt.getTime() + WATCH_ARM_DURATION_MS)
    const scope = {
      policyVersion: 'manga-chan-watch-v1',
      chainId: CHAIN_ID,
      wallet: WALLET,
      executor,
      sourceHash: state.sourceHash,
      runtimeCodeHash: state.runtimeCodeHash,
      maxPrincipalUsdgWei: '15000000',
      minimumGrossProfitUsdgWei: MIN_GROSS_PROFIT.toString(),
      minimumNetProfitUsdgWei: MIN_NET_PROFIT.toString(),
      walletEthReserveWei: MIN_WALLET_ETH_RESERVE.toString(),
      maxConfirmedExecutions: WATCH_MAX_EXECUTIONS,
      maxAttempts: RUNTIME_CONFIG.maxAttempts,
      maxFailedGasWei: RUNTIME_CONFIG.maxFailedGasWei.toString(),
      expiresAt: expiresAt.toISOString(),
    }
    const arm = {
      schemaVersion: 1,
      authorizationId: keccak256(toHex(JSON.stringify({ ...scope, issuedAt: issuedAt.toISOString() }))),
      status: 'ARMED',
      mode: 'AUTO_POLICY',
      reason: 'user explicitly requested live implementation in the current Codex task',
      issuedAt: issuedAt.toISOString(),
      ...scope,
      baselineNonce: snapshot.nonceLatest,
      baselineExecutionCount: (state.executions || []).length,
      pollIntervalMs: WATCH_POLL_MS,
      rpcSource: RPC_SOURCE,
      principalUsdgWeiAtArm: principal.toString(),
      walletEthWeiAtArm: snapshot.ethBalance.toString(),
    }
    writeProtectedJson(WATCH_ARM_PATH, arm)
    writeWatchState({
      schemaVersion: 1,
      status: 'ARMED_NOT_RUNNING',
      authorizationId: arm.authorizationId,
      wallet: WALLET,
      executor,
      updatedAt: new Date().toISOString(),
    })
    appendAudit('watch_armed', {
      authorizationId: arm.authorizationId,
      expiresAt: arm.expiresAt,
      maxConfirmedExecutions: arm.maxConfirmedExecutions,
      maxAttempts: arm.maxAttempts,
      maxFailedGasWei: arm.maxFailedGasWei,
      baselineNonce: arm.baselineNonce,
      baselineExecutionCount: arm.baselineExecutionCount,
      principal,
      walletEth: snapshot.ethBalance,
    })
    console.log(
      stringify({
        status: 'WATCH_ARMED',
        authorizationId: arm.authorizationId,
        wallet: WALLET,
        executor,
        expiresAt: arm.expiresAt,
        maxConfirmedExecutions: arm.maxConfirmedExecutions,
        maxAttempts: arm.maxAttempts,
        maxFailedGasWei: arm.maxFailedGasWei,
        pollIntervalMs: arm.pollIntervalMs,
        principalUsdg: formatUnits(principal, 6),
        walletEth: formatEther(snapshot.ethBalance),
        nonce: snapshot.nonceLatest,
      }),
    )
    return arm
  } finally {
    release()
  }
}

async function watch() {
  const release = acquireLock(WATCH_LOCK_PATH)
  let stopRequested = false
  let stopPoolSubscriptions = () => {}
  const requestStop = () => {
    stopRequested = true
  }
  process.once('SIGTERM', requestStop)
  process.once('SIGINT', requestStop)
  let watchState = null
  try {
    assertLiveTransport(RUNTIME_CONFIG, { requireWss: true })
    const arm = readWatchArm()
    const state = readState()
    const completedAtStart = assertWatchArm(arm, state)
    const unresolvedAtStart = latestUnresolvedExecution()
    if (unresolvedAtStart) throw new Error(`存在未收敛执行 ${unresolvedAtStart.hash}，watcher 拒绝启动`)
    await assertCanonicalTargets()
    const compiled = compileContract()
    const executor = await assertDeployedState(state, compiled)
    loadAccount()
    const snapshot = await walletSnapshot()
    const expectedNonce = arm.baselineNonce + completedAtStart
    if (snapshot.nonceLatest !== snapshot.noncePending || snapshot.nonceLatest !== expectedNonce) {
      throw new Error(
        `启动 nonce 不匹配：latest/pending/expected=${snapshot.nonceLatest}/${snapshot.noncePending}/${expectedNonce}`,
      )
    }

    const revisionQueue = new EventRevisionQueue()
    let lastWsError = null
    stopPoolSubscriptions = startPoolEventSubscriptions(revisionQueue, (error) => {
      lastWsError = error
    })
    revisionQueue.offer({
      blockNumber: snapshot.blockNumber,
      transactionHash: `startup-${snapshot.blockNumber}`,
      logIndex: 0,
      source: 'STARTUP',
    })

    const startedAt = new Date().toISOString()
    watchState = {
      schemaVersion: 2,
      status: 'RUNNING',
      pid: process.pid,
      authorizationId: arm.authorizationId,
      wallet: WALLET,
      executor,
      startedAt,
      updatedAt: startedAt,
      triggerMode: watchClient ? 'WSS_TARGETED_SWAP_WITH_RECOVERY_POLL' : 'RECOVERY_POLL_ONLY',
      recoveryPollMs: WATCH_RECOVERY_POLL_MS,
      rpcSource: RPC_SOURCE,
      pollCount: 0,
      consecutiveErrors: 0,
      completedExecutionsThisArm: completedAtStart,
      lastBlockNumber: null,
      lastDecision: 'STARTING',
    }
    writeWatchState(watchState)
    appendAudit('watch_started', {
      pid: process.pid,
      authorizationId: arm.authorizationId,
      baselineNonce: arm.baselineNonce,
      completedExecutionsThisArm: completedAtStart,
      triggerMode: watchState.triggerMode,
      recoveryPollMs: WATCH_RECOVERY_POLL_MS,
      rpcSource: RPC_SOURCE,
    })
    console.log(
      stringify({
        status: 'WATCH_RUNNING',
        pid: process.pid,
        authorizationId: arm.authorizationId,
        expiresAt: arm.expiresAt,
      }),
    )

    let lastBlockNumber = null
    let retryTargetBlock = null
    let lastHeartbeatAt = 0
    while (!stopRequested) {
      const loopStartedAt = Date.now()
      try {
        const currentArm = readWatchArm()
        const currentState = readState()
        let completed
        try {
          completed = assertWatchArm(currentArm, currentState)
        } catch (error) {
          watchState = {
            ...watchState,
            status: 'STOPPED_POLICY',
            reason: error.message,
            updatedAt: new Date().toISOString(),
          }
          writeWatchState(watchState)
          appendAudit('watch_stopped_policy', { reason: error.message, authorizationId: arm.authorizationId })
          return watchState
        }

        const unresolved = latestUnresolvedExecution()
        if (unresolved) {
          watchState = {
            ...watchState,
            status: 'HALTED_UNKNOWN',
            reason: `未收敛执行 ${unresolved.hash}`,
            transaction: unresolved.hash,
            updatedAt: new Date().toISOString(),
          }
          writeWatchState(watchState)
          appendAudit('watch_halted_unknown', { hash: unresolved.hash, authorizationId: arm.authorizationId })
          return watchState
        }

        if (lastWsError) {
          const wsFailure = lastWsError
          lastWsError = null
          appendAudit('watch_ws_error', {
            authorizationId: arm.authorizationId,
            class: classifyRpcError(wsFailure),
            error: errorText(wsFailure),
          })
        }

        const revision = await revisionQueue.wait(WATCH_RECOVERY_POLL_MS)
        const targetBlock = revision?.maxBlock ?? (await publicClient.getBlockNumber())
        retryTargetBlock = targetBlock
        if (lastBlockNumber !== null && targetBlock <= lastBlockNumber) {
          retryTargetBlock = null
          continue
        }
        const blockNumber = await awaitReadableBlock(targetBlock)
        const principal = await publicClient.readContract({
          address: USDG,
          abi: ERC20_ABI,
          functionName: 'balanceOf',
          args: [executor],
        })
        if (principal < AMOUNT_GRID[0]) throw new Error(`执行器本金低于最小报价档：${formatUnits(principal, 6)} USDG`)
        const grid = await quoteGrid(principal < 15_000_000n ? principal : 15_000_000n, blockNumber)
        const validQuotes = grid.quotes.filter((item) => !item.error)
        if (validQuotes.length === 0) {
          const classes = [...new Set(grid.quotes.map((item) => item.errorClass || RpcErrorClass.INVARIANT))]
          const quoteError = new Error(`全部路径报价失败 [${classes.join(',')}]：${grid.quotes[0]?.error || 'UNKNOWN'}`)
          quoteError.rpcClass = classes.every((item) => item !== RpcErrorClass.INVARIANT)
            ? classes[0]
            : RpcErrorClass.INVARIANT
          throw quoteError
        }
        lastBlockNumber = blockNumber
        retryTargetBlock = null
        const bestGross = grid.best?.grossProfit || 0n
        const decision = bestGross >= MIN_GROSS_PROFIT ? 'CANDIDATE' : 'NO_SHOT'
        watchState = {
          ...watchState,
          status: 'RUNNING',
          updatedAt: new Date().toISOString(),
          pollCount: watchState.pollCount + 1,
          consecutiveErrors: 0,
          completedExecutionsThisArm: completed,
          lastBlockNumber: blockNumber.toString(),
          lastDecision: decision,
          lastBestAmountInUsdg: grid.best ? formatUnits(grid.best.amountIn, 6) : null,
          lastBestGrossProfitUsdg: grid.best ? formatUnits(grid.best.grossProfit, 6) : null,
          lastQuoteErrorCount: grid.quotes.length - validQuotes.length,
          lastTrigger: revision
            ? {
                minBlock: revision.minBlock.toString(),
                maxBlock: revision.maxBlock.toString(),
                count: revision.count,
                sources: revision.sources,
              }
            : { source: 'RECOVERY_POLL' },
          lastPollLatencyMs: Date.now() - loopStartedAt,
        }
        writeWatchState(watchState)

        if (decision === 'CANDIDATE') {
          appendAudit('watch_candidate_observed', {
            authorizationId: arm.authorizationId,
            blockNumber,
            amountIn: grid.best.amountIn,
            grossProfit: grid.best.grossProfit,
          })
          watchState = { ...watchState, status: 'EXECUTING', updatedAt: new Date().toISOString() }
          writeWatchState(watchState)
          try {
            const executedState = await execute()
            const completedAfter = (executedState.executions || []).length - arm.baselineExecutionCount
            watchState = {
              ...watchState,
              status: 'RUNNING',
              updatedAt: new Date().toISOString(),
              completedExecutionsThisArm: completedAfter,
              lastDecision: 'CONFIRMED_EXECUTION',
              lastTransaction: executedState.lastExecution?.hash || null,
            }
            writeWatchState(watchState)
            appendAudit('watch_execution_confirmed', {
              authorizationId: arm.authorizationId,
              hash: executedState.lastExecution?.hash,
              completedExecutionsThisArm: completedAfter,
            })
          } catch (error) {
            const unresolvedAfter = latestUnresolvedExecution()
            if (unresolvedAfter) {
              watchState = {
                ...watchState,
                status: 'HALTED_UNKNOWN',
                reason: error.message,
                transaction: unresolvedAfter.hash,
                updatedAt: new Date().toISOString(),
              }
              writeWatchState(watchState)
              appendAudit('watch_halted_unknown', {
                hash: unresolvedAfter.hash,
                reason: error.message,
                authorizationId: arm.authorizationId,
              })
              return watchState
            }
            if (isNoShotError(error)) {
              watchState = {
                ...watchState,
                status: 'RUNNING',
                lastDecision: 'CANDIDATE_EVAPORATED',
                reason: error.message,
                updatedAt: new Date().toISOString(),
              }
              writeWatchState(watchState)
              appendAudit('watch_candidate_evaporated', { reason: error.message, authorizationId: arm.authorizationId })
            } else if (isTransientRpcError(error)) {
              throw error
            } else {
              watchState = {
                ...watchState,
                status: 'HALTED_INVARIANT',
                reason: error.message,
                updatedAt: new Date().toISOString(),
              }
              writeWatchState(watchState)
              appendAudit('watch_halted_invariant', { reason: error.message, authorizationId: arm.authorizationId })
              return watchState
            }
          }
        }

        if (Date.now() - lastHeartbeatAt >= WATCH_HEARTBEAT_MS) {
          const heartbeatSnapshot = await walletSnapshot()
          const heartbeatState = readState()
          const heartbeatCompleted = (heartbeatState.executions || []).length - arm.baselineExecutionCount
          const heartbeatExpectedNonce = arm.baselineNonce + heartbeatCompleted
          if (
            heartbeatSnapshot.nonceLatest !== heartbeatSnapshot.noncePending ||
            heartbeatSnapshot.nonceLatest !== heartbeatExpectedNonce
          ) {
            watchState = {
              ...watchState,
              status: 'HALTED_NONCE_CONFLICT',
              reason: `latest/pending/expected=${heartbeatSnapshot.nonceLatest}/${heartbeatSnapshot.noncePending}/${heartbeatExpectedNonce}`,
              updatedAt: new Date().toISOString(),
            }
            writeWatchState(watchState)
            appendAudit('watch_halted_nonce_conflict', {
              latest: heartbeatSnapshot.nonceLatest,
              pending: heartbeatSnapshot.noncePending,
              expected: heartbeatExpectedNonce,
              authorizationId: arm.authorizationId,
            })
            return watchState
          }
          lastHeartbeatAt = Date.now()
          appendAudit('watch_heartbeat', {
            authorizationId: arm.authorizationId,
            blockNumber,
            decision: watchState.lastDecision,
            completedExecutionsThisArm: heartbeatCompleted,
            walletEth: heartbeatSnapshot.ethBalance,
            nonce: heartbeatSnapshot.nonceLatest,
          })
        }
      } catch (error) {
        const unresolved = latestUnresolvedExecution()
        if (unresolved) {
          watchState = {
            ...watchState,
            status: 'HALTED_UNKNOWN',
            reason: error.message,
            transaction: unresolved.hash,
            updatedAt: new Date().toISOString(),
          }
          writeWatchState(watchState)
          appendAudit('watch_halted_unknown', {
            hash: unresolved.hash,
            reason: error.message,
            authorizationId: arm.authorizationId,
          })
          return watchState
        }
        if (!isTransientRpcError(error)) {
          watchState = {
            ...watchState,
            status: 'HALTED_INVARIANT',
            reason: error.message,
            updatedAt: new Date().toISOString(),
          }
          writeWatchState(watchState)
          appendAudit('watch_halted_invariant', { reason: error.message, authorizationId: arm.authorizationId })
          return watchState
        }
        const consecutiveErrors = (watchState.consecutiveErrors || 0) + 1
        watchState = {
          ...watchState,
          status: consecutiveErrors >= WATCH_MAX_CONSECUTIVE_RPC_ERRORS ? 'HALTED_RPC' : 'DEGRADED_RPC',
          reason: errorText(error),
          consecutiveErrors,
          updatedAt: new Date().toISOString(),
        }
        writeWatchState(watchState)
        appendAudit('watch_rpc_error', {
          consecutiveErrors,
          error: errorText(error),
          authorizationId: arm.authorizationId,
        })
        if (consecutiveErrors >= WATCH_MAX_CONSECUTIVE_RPC_ERRORS) return watchState
        const retryBlock = retryTargetBlock ?? (await publicClient.getBlockNumber())
        revisionQueue.offer({
          blockNumber: retryBlock,
          transactionHash: `retry-${retryBlock}-${consecutiveErrors}`,
          logIndex: consecutiveErrors,
          source: 'READINESS_RETRY',
        })
        await sleep(Math.min(30_000, WATCH_POLL_MS * consecutiveErrors))
      }
    }

    watchState = { ...watchState, status: 'STOPPED_BY_SIGNAL', updatedAt: new Date().toISOString() }
    writeWatchState(watchState)
    appendAudit('watch_stopped_signal', { authorizationId: arm.authorizationId })
    return watchState
  } catch (error) {
    const currentArm = readWatchArm()
    const unresolved = latestUnresolvedExecution()
    watchState = {
      ...(watchState || {
        schemaVersion: 1,
        pid: process.pid,
        wallet: WALLET,
        executor: readState()?.executor || null,
      }),
      status: unresolved ? 'HALTED_UNKNOWN' : 'HALTED_STARTUP',
      reason: error.shortMessage || error.message,
      transaction: unresolved?.hash || null,
      authorizationId: currentArm?.authorizationId || null,
      updatedAt: new Date().toISOString(),
    }
    writeWatchState(watchState)
    appendAudit('watch_halted_startup', {
      authorizationId: currentArm?.authorizationId || null,
      reason: error.shortMessage || error.message,
      unresolvedHash: unresolved?.hash || null,
    })
    console.error(error.stack || error)
    return watchState
  } finally {
    stopPoolSubscriptions()
    process.removeListener('SIGTERM', requestStop)
    process.removeListener('SIGINT', requestStop)
    release()
  }
}

async function watchStatus() {
  const arm = readWatchArm()
  const localState = readWatchState()
  const lock = watchLockHolder()
  const deploymentState = readState()
  const snapshot = await walletSnapshot()
  const executorUsdg = deploymentState?.executor
    ? await publicClient.readContract({
        address: USDG,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [getAddress(deploymentState.executor)],
      })
    : 0n
  console.log(
    stringify({
      status: localState?.status || 'NOT_CONFIGURED',
      rpcSource: RPC_SOURCE,
      process: lock,
      authorization: arm
        ? {
            id: arm.authorizationId,
            status: arm.status,
            issuedAt: arm.issuedAt,
            expiresAt: arm.expiresAt,
            maxConfirmedExecutions: arm.maxConfirmedExecutions,
            maxAttempts: arm.maxAttempts,
            maxFailedGasWei: arm.maxFailedGasWei,
            baselineExecutionCount: arm.baselineExecutionCount,
          }
        : null,
      runtime: localState,
      chain: {
        blockNumber: snapshot.blockNumber,
        wallet: WALLET,
        walletEth: formatEther(snapshot.ethBalance),
        nonceLatest: snapshot.nonceLatest,
        noncePending: snapshot.noncePending,
        executor: deploymentState?.executor || null,
        executorUsdg: formatUnits(executorUsdg, 6),
        confirmedExecutions: (deploymentState?.executions || []).length,
        unresolvedMutation: latestUnresolvedExecution()
          ? { hash: latestUnresolvedExecution().hash, kind: latestUnresolvedExecution().kind || null }
          : null,
      },
    }),
  )
}

async function disarmWatcher() {
  const arm = readWatchArm()
  if (!arm) throw new Error('没有可停用的 watch arm')
  arm.status = 'DISARMED'
  arm.disarmedAt = new Date().toISOString()
  writeProtectedJson(WATCH_ARM_PATH, arm)
  const lock = watchLockHolder()
  if (lock.alive && lock.pid !== process.pid) process.kill(lock.pid, 'SIGTERM')
  appendAudit('watch_disarmed', {
    authorizationId: arm.authorizationId,
    watcherPid: lock.pid,
    watcherWasAlive: lock.alive,
  })
  console.log(
    stringify({
      status: 'WATCH_DISARMED',
      authorizationId: arm.authorizationId,
      watcherPid: lock.pid,
      watcherWasAlive: lock.alive,
    }),
  )
}

async function status() {
  await assertCanonicalTargets()
  const compiled = compileContract()
  const state = readState()
  const snapshot = await walletSnapshot()
  let executor = null
  if (state?.executor) {
    const address = getAddress(state.executor)
    const [code, operator, usdg] = await Promise.all([
      publicClient.getCode({ address }),
      publicClient.readContract({ address, abi: compiled.abi, functionName: 'operator' }),
      publicClient.readContract({ address: USDG, abi: ERC20_ABI, functionName: 'balanceOf', args: [address] }),
    ])
    executor = {
      address,
      codeHash: code && code !== '0x' ? keccak256(code) : null,
      operator,
      usdg: formatUnits(usdg, 6),
    }
  }
  const grid = await quoteGrid(
    executor
      ? BigInt(
          await publicClient.readContract({
            address: USDG,
            abi: ERC20_ABI,
            functionName: 'balanceOf',
            args: [executor.address],
          }),
        )
      : 15_000_000n,
  )
  console.log(
    stringify({
      status: state?.status || 'NOT_DEPLOYED',
      rpcSource: RPC_SOURCE,
      blockNumber: snapshot.blockNumber,
      gasPriceGwei: formatUnits(snapshot.gasPrice, 9),
      wallet: {
        address: WALLET,
        eth: formatEther(snapshot.ethBalance),
        usdg: formatUnits(snapshot.usdgBalance, 6),
        nonceLatest: snapshot.nonceLatest,
        noncePending: snapshot.noncePending,
      },
      executor,
      bestQuote: grid.best
        ? {
            amountIn: formatUnits(grid.best.amountIn, 6),
            amountOut: formatUnits(grid.best.amountOut, 6),
            grossProfit: formatUnits(grid.best.grossProfit, 6),
          }
        : null,
      quoteFailures: grid.quotes
        .filter((item) => item.error)
        .map((item) => ({
          amountIn: formatUnits(item.amountIn, 6),
          leg: item.errorLeg,
          class: item.errorClass,
          error: item.error,
        })),
      source: {
        path: CONTRACT_PATH,
        hash: compiled.sourceHash,
        creationBytes: compiled.creationBytes,
        runtimeBytes: compiled.runtimeBytes,
      },
      statePath: STATE_PATH,
    }),
  )
}

async function runtimeVerify() {
  assertLiveTransport(RUNTIME_CONFIG, { requireWss: true })
  await assertCanonicalTargets()
  const compiled = compileContract()
  const state = readState()
  const executor = await assertDeployedState(state, compiled)
  const manifest = JSON.parse(fs.readFileSync(DEPLOYMENT_MANIFEST_PATH, 'utf8'))
  if (
    manifest.chainId !== CHAIN_ID ||
    manifest.operator.toLowerCase() !== WALLET.toLowerCase() ||
    manifest.executor.toLowerCase() !== executor.toLowerCase() ||
    manifest.sourceHash !== compiled.sourceHash ||
    manifest.runtimeCodeHash !== state.runtimeCodeHash
  ) {
    throw new Error('部署 manifest、运行账本、本地源码或链上执行器不一致')
  }
  const [snapshot, wsChainId, wsHead, executorUsdg] = await Promise.all([
    walletSnapshot(),
    watchClient.getChainId(),
    watchClient.getBlockNumber(),
    publicClient.readContract({ address: USDG, abi: ERC20_ABI, functionName: 'balanceOf', args: [executor] }),
  ])
  if (wsChainId !== CHAIN_ID) throw new Error(`WSS chainId=${wsChainId}，预期 ${CHAIN_ID}`)
  const headDistance = snapshot.blockNumber > wsHead ? snapshot.blockNumber - wsHead : wsHead - snapshot.blockNumber
  if (headDistance > 100n) throw new Error(`HTTP/WSS head 相差 ${headDistance} 个区块，拒绝进入 ready 状态`)
  if (snapshot.nonceLatest !== snapshot.noncePending) throw new Error('latest/pending nonce 未收敛')
  const unresolved = latestUnresolvedExecution()
  if (unresolved) throw new Error(`存在未收敛 ${unresolved.kind || 'mutation'} ${unresolved.hash}`)
  const arm = readWatchArm()
  const result = {
    status: 'RUNTIME_VERIFIED_READY_FOR_ARM',
    releaseSha: process.env.MANGA_RELEASE_SHA || 'UNKNOWN',
    chainId: CHAIN_ID,
    rpcSource: RPC_SOURCE,
    httpHead: snapshot.blockNumber,
    wsHead,
    headDistance,
    wallet: WALLET,
    executor,
    executorUsdg: formatUnits(executorUsdg, 6),
    nonceLatest: snapshot.nonceLatest,
    noncePending: snapshot.noncePending,
    sourceHash: compiled.sourceHash,
    runtimeCodeHash: state.runtimeCodeHash,
    unresolvedMutation: null,
    authorization: arm ? { status: arm.status, id: arm.authorizationId, expiresAt: arm.expiresAt } : null,
  }
  appendAudit('runtime_verified', result)
  console.log(stringify(result))
  return result
}

async function compileOnly() {
  const compiled = compileContract()
  console.log(
    stringify({
      status: 'COMPILED',
      compiler: solc.version(),
      evmVersion: 'cancun',
      optimizerRuns: 200,
      creationBytes: compiled.creationBytes,
      runtimeBytes: compiled.runtimeBytes,
      sourceHash: compiled.sourceHash,
      creationCodeHash: compiled.creationCodeHash,
    }),
  )
}

async function selfTest() {
  const compiled = compileContract()
  const testAccount = privateKeyToAccount(keccak256(toHex('manga-chan-self-test-only')))
  const data = encodeFunctionData({
    abi: compiled.abi,
    functionName: 'execute',
    args: [5_000_000n, MIN_GROSS_PROFIT, 1n],
  })
  const serializedTransaction = await testAccount.signTransaction({
    chainId: CHAIN_ID,
    type: 'eip1559',
    to: WALLET,
    data,
    gas: 400_000n,
    maxFeePerGas: 1_000_000_000n,
    maxPriorityFeePerGas: 0n,
    nonce: 0,
  })
  const parsed = parseTransaction(serializedTransaction)
  const recovered = await recoverTransactionAddress({ serializedTransaction })
  if (recovered.toLowerCase() !== testAccount.address.toLowerCase()) throw new Error('self-test 无法恢复测试签名者')
  if (parsed.chainId !== CHAIN_ID || parsed.nonce !== 0 || parsed.to?.toLowerCase() !== WALLET.toLowerCase()) {
    throw new Error('self-test 签名交易字段不匹配')
  }
  if (parsed.data?.toLowerCase() !== data.toLowerCase()) throw new Error('self-test 签名 calldata 不匹配')
  console.log(
    stringify({
      status: 'SELF_TEST_PASSED',
      sourceHash: compiled.sourceHash,
      signedRawHashVerified: true,
      signerRecoveryVerified: true,
      payloadRoundTripVerified: true,
      noBroadcast: true,
    }),
  )
}

async function forkTest() {
  if (!/^http:\/\/(127\.0\.0\.1|localhost)(:|\/)/.test(RPC_URL)) {
    throw new Error('fork-test 只允许连接 localhost Anvil，禁止在主网 RPC 上使用测试私钥')
  }
  const forkBlock = Number(process.env.FORK_BLOCK_NUMBER || '53981032')
  const forkSource = process.env.FORK_SOURCE_URL || 'https://rpc.mainnet.chain.robinhood.com'
  if (process.env.SKIP_ANVIL_RESET !== '1') {
    await publicClient.request({
      method: 'anvil_reset',
      params: [{ forking: { jsonRpcUrl: forkSource, blockNumber: forkBlock } }],
    })
  }

  const compiled = compileContract()
  const account = privateKeyToAccount(keccak256(toHex('manga-chan-fork-operator-only')))
  const other = privateKeyToAccount(keccak256(toHex('manga-chan-fork-other-only')))
  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(RPC_URL, { timeout: 30_000, retryCount: 0 }),
  })
  const minimumSeedOut = 14_800_000n
  const deployHash = await walletClient.deployContract({
    abi: compiled.abi,
    bytecode: compiled.bytecode,
    args: [account.address, minimumSeedOut],
    value: FORK_TEST_SEED_ETH,
  })
  const deployReceipt = await publicClient.waitForTransactionReceipt({ hash: deployHash })
  if (deployReceipt.status !== 'success' || !deployReceipt.contractAddress) throw new Error('fork 部署失败')
  const executor = getAddress(deployReceipt.contractAddress)
  const seeded = await publicClient.readContract({
    address: USDG,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [executor],
  })
  if (seeded < minimumSeedOut) throw new Error('fork 种子余额不足')

  const block = await publicClient.getBlock()
  const deadline = block.timestamp + 300n
  const positiveArgs = [12_500_000n, MIN_GROSS_PROFIT, deadline]
  const simulation = await publicClient.simulateContract({
    account,
    address: executor,
    abi: compiled.abi,
    functionName: 'execute',
    args: positiveArgs,
  })
  const estimatedGas = await publicClient.estimateContractGas({
    account,
    address: executor,
    abi: compiled.abi,
    functionName: 'execute',
    args: positiveArgs,
  })

  function hasExpectedCustomError(error, name, signature) {
    const selector = keccak256(toHex(signature)).slice(0, 10).toLowerCase()
    const pending = [error]
    const visited = new Set()
    while (pending.length > 0) {
      const item = pending.shift()
      if (!item || visited.has(item)) continue
      if (typeof item === 'string') {
        const lower = item.toLowerCase()
        if (item.includes(name) || lower.includes(selector)) return true
        continue
      }
      if (typeof item !== 'object') continue
      visited.add(item)
      if (item.errorName === name) return true
      for (const value of Object.values(item)) pending.push(value)
    }
    return false
  }

  async function mustRevert(label, expectedName, signature, request) {
    try {
      await publicClient.simulateContract(request)
    } catch (error) {
      if (!hasExpectedCustomError(error, expectedName, signature)) {
        throw new Error(`负向测试 ${label} 回滚原因错误；预期 ${expectedName}，实际 ${errorText(error)}`)
      }
      return label
    }
    throw new Error(`负向测试未回滚：${label}`)
  }

  const negativeChecks = await Promise.all([
    mustRevert('non_operator', 'NotOperator', 'NotOperator()', {
      account: other,
      address: executor,
      abi: compiled.abi,
      functionName: 'execute',
      args: positiveArgs,
    }),
    mustRevert('amount_over_cap', 'InvalidAmount', 'InvalidAmount()', {
      account,
      address: executor,
      abi: compiled.abi,
      functionName: 'execute',
      args: [15_000_001n, MIN_GROSS_PROFIT, deadline],
    }),
    mustRevert('profit_floor_too_low', 'ProfitFloorTooLow', 'ProfitFloorTooLow()', {
      account,
      address: executor,
      abi: compiled.abi,
      functionName: 'execute',
      args: [12_500_000n, MIN_GROSS_PROFIT - 1n, deadline],
    }),
    mustRevert('expired', 'Expired', 'Expired()', {
      account,
      address: executor,
      abi: compiled.abi,
      functionName: 'execute',
      args: [12_500_000n, MIN_GROSS_PROFIT, block.timestamp - 1n],
    }),
    mustRevert('unprofitable_atomic_revert', 'ProfitTooLow', 'ProfitTooLow(uint256,uint256)', {
      account,
      address: executor,
      abi: compiled.abi,
      functionName: 'execute',
      args: [12_500_000n, 1_000_000n, deadline],
    }),
    mustRevert('forged_v3_callback', 'UnauthorizedCallback', 'UnauthorizedCallback()', {
      account,
      address: executor,
      abi: compiled.abi,
      functionName: 'uniswapV3SwapCallback',
      args: [1n, -1n, '0x'],
    }),
    mustRevert('forged_unlock_callback', 'UnauthorizedCallback', 'UnauthorizedCallback()', {
      account,
      address: executor,
      abi: compiled.abi,
      functionName: 'unlockCallback',
      args: ['0x'],
    }),
  ])

  const [before, testNonce, testGasPrice] = await Promise.all([
    publicClient.readContract({ address: USDG, abi: ERC20_ABI, functionName: 'balanceOf', args: [executor] }),
    publicClient.getTransactionCount({ address: account.address, blockTag: 'latest' }),
    publicClient.getGasPrice(),
  ])
  const testData = encodeFunctionData({ abi: compiled.abi, functionName: 'execute', args: positiveArgs })
  const serializedTransaction = await account.signTransaction({
    chainId: CHAIN_ID,
    type: 'eip1559',
    to: executor,
    data: testData,
    gas: bpsCeil(estimatedGas, EXECUTION_GAS_BUFFER_BPS) + 3_000n,
    maxFeePerGas: bpsCeil(testGasPrice, 12_000n),
    maxPriorityFeePerGas: 0n,
    nonce: testNonce,
  })
  const executeHash = keccak256(serializedTransaction)
  const acceptedHash = await walletClient.sendRawTransaction({ serializedTransaction })
  if (acceptedHash.toLowerCase() !== executeHash.toLowerCase()) throw new Error('fork raw 广播哈希不一致')
  const executeReceipt = await publicClient.waitForTransactionReceipt({ hash: executeHash })
  const [after, residualMsft, residualManga, residualNvda] = await Promise.all([
    publicClient.readContract({ address: USDG, abi: ERC20_ABI, functionName: 'balanceOf', args: [executor] }),
    publicClient.readContract({ address: MSFT, abi: ERC20_ABI, functionName: 'balanceOf', args: [executor] }),
    publicClient.readContract({ address: MANGA, abi: ERC20_ABI, functionName: 'balanceOf', args: [executor] }),
    publicClient.readContract({ address: NVDA, abi: ERC20_ABI, functionName: 'balanceOf', args: [executor] }),
  ])
  if (executeReceipt.status !== 'success' || after - before !== simulation.result[1])
    throw new Error('fork 正向执行或利润读回不一致')
  if (residualMsft !== 0n || residualManga !== 0n || residualNvda !== 0n) throw new Error('fork 执行留下中间资产残余')

  console.log(
    stringify({
      status: 'FORK_TEST_PASSED',
      forkBlock,
      executor,
      deployment: { hash: deployHash, gasUsed: deployReceipt.gasUsed, seededUsdg: formatUnits(seeded, 6) },
      execution: {
        hash: executeHash,
        signedRawHashVerified: true,
        estimatedGas,
        gasUsed: executeReceipt.gasUsed,
        amountInUsdg: '12.5',
        amountOutUsdg: formatUnits(simulation.result[0], 6),
        grossProfitUsdg: formatUnits(after - before, 6),
      },
      negativeChecks,
      residuals: { msft: residualMsft, manga: residualManga, nvda: residualNvda },
    }),
  )
}

async function main() {
  const command = process.argv[2] || 'status'
  if (command === 'compile') return compileOnly()
  if (command === 'self-test') return selfTest()
  if (command === 'status') return status()
  if (command === 'runtime-verify') return runtimeVerify()
  if (command === 'deploy-preflight') return deployPreflight()
  if (command === 'deploy') return deploy()
  if (command === 'recover-deployment') return recoverDeployment()
  if (command === 'preflight') return executionPreflight()
  if (command === 'execute') return execute()
  if (command === 'reconcile') return reconcile()
  if (command === 'withdraw-all') return withdrawAll()
  if (command === 'watch-arm') return armWatcher()
  if (command === 'watch') {
    const result = await watch()
    if (result?.status?.startsWith('HALTED')) process.exitCode = 2
    return result
  }
  if (command === 'watch-status') return watchStatus()
  if (command === 'watch-disarm') return disarmWatcher()
  if (command === 'fork-test') return forkTest()
  throw new Error(`未知命令：${command}`)
}

async function closeWatchTransport() {
  try {
    const rpcClient = await watchClient?.transport?.getRpcClient?.()
    rpcClient?.close()
  } catch {}
}

main()
  .then(closeWatchTransport)
  .catch(async (error) => {
    appendAudit('command_failed', { command: process.argv[2] || 'status', error: errorText(error) })
    console.error(error.stack || error)
    process.exitCode = 1
    await closeWatchTransport()
  })
