import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createPublicClient,
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
  webSocket,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { isChildProcessDeadlineError, runBoundedProcess } from '../src/bounded-child-process.mjs'
import { assertLiveTransport, loadRuntimeConfig } from '../src/config.mjs'
import { broadcastSameRawToSequencer } from '../src/direct-sequencer.mjs'
import {
  buildDualBaseExecutionCandidates,
  freezeDualExecutionTrigger,
  selectionFromFrozenDualTrigger,
} from '../src/dual-base-plan.mjs'
import {
  DUAL_AUTHORIZATION_LIFETIME,
  DUAL_AUTHORIZATION_POLICY_VERSION,
  DUAL_PRINCIPAL_POLICY,
  ceilDiv,
  dualAuthorizationId,
  dualAuthorizationUsage,
  dualSpendablePrincipal,
  dualWatcherExitCode,
  evaluateDualWalletNonce,
  evaluateDualAuthorizationBudget,
  expectedDualWalletNonce,
  isDualOpportunityMiss,
  normalizeWethToUsdg,
  selectBestExactEvaluation,
  validateDualSignedAttempt,
  validateDualProfitFloors,
  wethFloorFromUsdg,
} from '../src/dual-live-policy.mjs'
import { deriveExecutionEconomics, deriveWethExecutionEconomics } from '../src/execution-economics.mjs'
import { loadGenericContractArtifact, loadWethContractArtifact } from '../src/dual-contract-artifacts.mjs'
import {
  GLOBAL_MAX_SETTLEMENT_ASSETS_PER_WAKE,
  GLOBAL_MAX_SETTLEMENT_FUNDING_CHECKS_PER_WAKE,
  GLOBAL_SETTLEMENT_ADMISSION_POLICY,
  globalSettlementSeeds,
} from '../src/global-settlement-assets.mjs'
import {
  GLOBAL_ATOMIC_ROUTE_POLICY,
  GLOBAL_GRAPH_POLICY,
  GLOBAL_MAX_MANAGED_CANDIDATES_PER_WAKE,
} from '../src/global-liquidity-graph.mjs'
import { GLOBAL_ROUTE_WORKSET_POLICY } from '../src/global-route-selection.mjs'
import { GLOBAL_UNIVERSE_POLICY, readGlobalUniverseFile } from '../src/global-universe-projection.mjs'
import {
  GLOBAL_EVENT_MAX_ROUTES_PER_WAKE,
  GLOBAL_FEED_MATCH_POLICY,
  GLOBAL_MANAGED_FALLBACK_EVENT_LOGICAL_CALL_CAP,
  GLOBAL_MANAGED_FALLBACK_RECOVERY_LOGICAL_CALL_CAP,
  buildGlobalFeedWatchPolicy,
  classifyEarnFeedMatches,
  classifyGlobalFeedMatches,
} from '../src/global-wake-policy.mjs'
import {
  EARN_SIZING_ALGORITHM,
  earnOnHoodGasSolvency,
  earnOnHoodRouteQuarantine,
} from '../src/earnonhood-live-policy.mjs'
import {
  EARN_DISCOVERY_RPC_POLICY,
  EARN_EVENT_SOURCE_POLICY,
  EARN_MANAGED_FALLBACK_EVENT_LOGICAL_CALL_CAP,
  EARN_MANAGED_FALLBACK_RECOVERY_LOGICAL_CALL_CAP,
  EARN_PUBLIC_RECOVERY_POLL_MS,
} from '../src/earn-rpc-policy.mjs'
import { EARN_SWAP_ABI } from '../src/earnonhood-receipt.mjs'
import {
  EARN_BATCH_ROUTER,
  EARN_ROUTE_DISCOVERY_POLICY,
  EARN_ROUTE_COMMITMENT,
  EARN_VAULT,
  isEarnOnHoodVaultSwap,
  maximumEarnPublicExactQuotes,
} from '../src/earnonhood-routes.mjs'
import { retryReadOnly } from '../src/event-driven-shadow.mjs'
import { buildGlobalWakeFromEarnEvent } from '../src/feed-signal-coalescer.mjs'
import { GENERIC_USDG, GENERIC_WETH, assertDualBoardIdentity } from '../src/generic-plan.mjs'
import { assertPrivateFile, buildMutationPlan, persistSignedRaw } from '../src/journal.mjs'
import { readSafetyAuditRecords } from '../src/incremental-jsonl-reader.mjs'
import { ProtectedStrategyScheduler } from '../src/protected-strategy-scheduler.mjs'
import { classifyGlobalSearchHandoff, ResidentGlobalSearchClient } from '../src/resident-global-search.mjs'
import {
  MANAGED_EARN_RECONNECT_POLICY,
  ManagedEarnEventSource,
  managedEarnReconnectDelayMs,
} from '../src/managed-earn-event-source.mjs'
import { SequencerFeedWakeClient } from '../src/sequencer-feed.mjs'
import { loadUniversalContractArtifact } from '../src/universal-contract-artifact.mjs'
import {
  classifyReconciliation,
  diagnosticErrorText,
  errorText,
  evaluateExpiredMutationAbandonment,
  evaluateRawReplayDeadline,
  fixedSignerLaneConflict,
  genericSignerLaneConflict,
  isBoardSnapshotTransportFailure,
  isTransientRpcError,
  latestUnresolvedMutation,
} from '../src/policy.mjs'

const CHAIN_ID = 4_663
const PUBLIC_READ_ONLY_RPC = 'https://rpc.mainnet.chain.robinhood.com'
const WALLET = getAddress('0x77f771E83f118C32547A1291dda438a757B4b91B')
const POOL_MANAGER = getAddress('0x8366a39CC670B4001A1121B8F6A443A643e40951')
const V3_FACTORY = getAddress('0x1f7d7550B1b028f7571E69A784071F0205FD2EfA')
const V3_ROUTER = getAddress('0xCaf681a66D020601342297493863E78C959E5cb2')
const V3_QUOTER = getAddress('0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7')
const MORPHO = getAddress('0x9D53d5E3bd5E8d4Cbfa6DB1ca238AEA02E651010')
const EARN_ROUTER = getAddress('0xFCcDd6Df64de63b609042c55C629F223321340e1')
const PAIR_HOOK = getAddress('0x16D1560630Ce74af4478d9b8AD46548A092A2000')
const EXPLORER_TX = 'https://robinhoodchain.blockscout.com/tx/'
const USDG_MINIMUM_GROSS_PROFIT = 50_000n
const USDG_MAXIMUM_AMOUNT_IN = 100_000_000n
const WETH_HARD_MAXIMUM_AMOUNT_IN = 1_000_000_000_000_000_000n
const DEADLINE_SECONDS = 45n
const NATIVE_MARK_INPUT = 4_000_000_000_000_000n
const MAX_BOARD_SNAPSHOT_BYTES = 16 * 1024 * 1024
const STARTUP_RPC_ATTEMPTS = 5
const STARTUP_RPC_RETRY_DELAY_MS = 1_000
const UNKNOWN_RECONCILE_RETRY_MS = 5_000

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const RUNTIME_CONFIG = loadRuntimeConfig()
const RPC_URL = RUNTIME_CONFIG.rpcUrl || PUBLIC_READ_ONLY_RPC
const RUN_DIR = RUNTIME_CONFIG.runDir ? path.resolve(RUNTIME_CONFIG.runDir) : path.join(ROOT, 'runs')
const USDG_STATE_PATH = path.join(RUN_DIR, 'generic-state.json')
const WETH_STATE_PATH = path.join(RUN_DIR, 'weth-state.json')
const AUDIT_PATH = path.join(RUN_DIR, 'audit.jsonl')
const WALLET_LOCK_PATH = path.join(RUN_DIR, 'wallet.lock')
const FIXED_WATCH_LOCK_PATH = path.join(RUN_DIR, 'watch.lock')
const FIXED_WATCH_ARM_PATH = path.join(RUN_DIR, 'watch-arm.json')
const GENERIC_WATCH_LOCK_PATH = path.join(RUN_DIR, 'generic-watch.lock')
const GENERIC_WATCH_ARM_PATH = path.join(RUN_DIR, 'generic-watch-arm.json')
const DUAL_WATCH_LOCK_PATH = path.join(RUN_DIR, 'dual-watch.lock')
const DUAL_WATCH_ARM_PATH = path.join(RUN_DIR, 'dual-watch-arm.json')
const DUAL_WATCH_REVOCATION_PATH = path.join(RUN_DIR, 'dual-watch-revocation.json')
const DUAL_WATCH_STATE_PATH = path.join(RUN_DIR, 'dual-watch-state.json')
const EARN_AUDIT_PATH = path.join(RUN_DIR, 'earnonhood-audit.jsonl')
const UNIVERSAL_STATE_PATH = path.join(RUN_DIR, 'universal-state.json')
const GLOBAL_CATALOG_PATH = path.join(RUN_DIR, 'global-catalog.json')
const GLOBAL_UNIVERSE_PATH = RUNTIME_CONFIG.globalUniversePath
  ? path.resolve(RUNTIME_CONFIG.globalUniversePath)
  : path.join(RUN_DIR, 'global-universe.json')
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
const earnEventClient = createPublicClient({
  chain,
  transport: http(PUBLIC_READ_ONLY_RPC, { timeout: 30_000, retryCount: 2 }),
})
const managedEarnEventClient = RUNTIME_CONFIG.wsUrl
  ? createPublicClient({
      chain,
      transport: webSocket(RUNTIME_CONFIG.wsUrl, {
        keepAlive: { interval: 30_000 },
        reconnect: { attempts: 1_000_000, delay: 2_000 },
        retryCount: 2,
        timeout: 10_000,
      }),
    })
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

/** @type {{key: string, snapshot: Record<string, any>} | null} */
let boardSnapshotFileCache = null

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

function readAuditRecords(file = AUDIT_PATH) {
  return readSafetyAuditRecords(file)
}

function appendAudit(event, details = {}) {
  fs.mkdirSync(RUN_DIR, { recursive: true, mode: 0o700 })
  fs.appendFileSync(
    AUDIT_PATH,
    `${JSON.stringify({ at: new Date().toISOString(), lane: 'dual-v3', event, ...details }, (_, item) =>
      typeof item === 'bigint' ? item.toString() : item,
    )}\n`,
    { mode: 0o600 },
  )
}

function mutationPlan(kind, lane, fields) {
  const plan = buildMutationPlan(kind, { lane, ...fields })
  appendAudit('mutation_intent', { lane, kind, intentId: plan.intentId, createdAt: plan.createdAt })
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

function lockHolder(file) {
  if (!fs.existsSync(file)) return { pid: null, alive: false }
  let pid = null
  try {
    pid = Number(fs.readFileSync(file, 'utf8').trim().split(/\s+/)[0])
  } catch {}
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

function assertLegacySignersInactive() {
  const fixedHolder = lockHolder(FIXED_WATCH_LOCK_PATH)
  const fixedConflict = fixedSignerLaneConflict({
    arm: readJson(FIXED_WATCH_ARM_PATH),
    lockExists: fs.existsSync(FIXED_WATCH_LOCK_PATH),
    lockPid: fixedHolder.pid,
    processIsAlive,
  })
  if (fixedConflict) throw new Error(`${fixedConflict}; disarm it before dual-v3 signing`)
  const genericHolder = lockHolder(GENERIC_WATCH_LOCK_PATH)
  const genericConflict = genericSignerLaneConflict({
    arm: readJson(GENERIC_WATCH_ARM_PATH),
    lockExists: fs.existsSync(GENERIC_WATCH_LOCK_PATH),
    lockPid: genericHolder.pid,
    processIsAlive,
  })
  if (genericConflict) throw new Error(`${genericConflict}; disarm it before dual-v3 signing`)
}

function assertDualWatcherInactive() {
  const holder = lockHolder(DUAL_WATCH_LOCK_PATH)
  if (holder.alive && holder.pid !== process.pid) {
    throw new Error(`dual watcher is active as PID ${holder.pid}; stop or disarm it before this mutation`)
  }
}

function assertDualExecutionContext(authorizationId) {
  const holder = lockHolder(DUAL_WATCH_LOCK_PATH)
  if (!holder.alive) {
    if (authorizationId) throw new Error('dual watcher authorization was supplied without the watcher lock')
    const arm = readJson(DUAL_WATCH_ARM_PATH)
    if (arm?.status === 'ARMED' && !readDualRevocation(arm.authorizationId)) {
      throw new Error('the dual-v3 signing arm is still active; disarm it before manual execution')
    }
    return
  }
  const arm = readJson(DUAL_WATCH_ARM_PATH)
  if (holder.pid !== process.pid || !authorizationId || arm?.authorizationId !== authorizationId) {
    throw new Error(`dual watcher controls the signing lane as PID ${holder.pid}`)
  }
}

function readDualRevocation(authorizationId) {
  const marker = readJson(DUAL_WATCH_REVOCATION_PATH)
  return marker?.authorizationId === authorizationId ? marker : null
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
    throw new Error('dual board URL must use loopback HTTP')
  }
  return url
}

async function loadBoardSnapshot() {
  if (RUNTIME_CONFIG.genericBoardSnapshot) {
    const file = path.resolve(RUNTIME_CONFIG.genericBoardSnapshot)
    const metadata = fs.lstatSync(file)
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error('board snapshot must be a regular file')
    if ((metadata.mode & 0o022) !== 0) throw new Error('board snapshot must not be group- or world-writable')
    if (metadata.size > MAX_BOARD_SNAPSHOT_BYTES) throw new Error('board snapshot exceeds the 16 MiB safety limit')
    const key = `${metadata.dev}:${metadata.ino}:${metadata.size}:${metadata.mtimeMs}`
    if (boardSnapshotFileCache?.key === key) return boardSnapshotFileCache.snapshot
    const snapshot = JSON.parse(fs.readFileSync(file, 'utf8'))
    boardSnapshotFileCache = { key, snapshot }
    return snapshot
  }
  const url = assertLoopbackBoardUrl(RUNTIME_CONFIG.genericBoardUrl)
  url.searchParams.set('view', 'execution')
  const response = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(5_000) })
  if (!response.ok) throw new Error(`board snapshot HTTP ${response.status}`)
  return response.json()
}

async function boardCandidates({ candidateHash = null, limit = RUNTIME_CONFIG.genericPreflightCandidates } = {}) {
  const snapshot = await loadBoardSnapshot()
  const selection = buildDualBaseExecutionCandidates(snapshot, {
    maxAgeMs: RUNTIME_CONFIG.genericMaxQuoteAgeMs,
    limit: candidateHash ? 32 : limit,
  })
  const candidates = candidateHash
    ? selection.filter((candidate) => candidate.candidateHash === candidateHash)
    : selection
  if (candidateHash && candidates.length === 0)
    throw new Error('triggered dual-base candidate left the fresh board set')
  await assertCanonicalCandidateQuoteBlocks(candidates)
  return { snapshot, candidates }
}

/** @param {Record<string, any>[]} candidates */
async function assertCanonicalCandidateQuoteBlocks(candidates) {
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
}

/** @param {Record<string, any>} trigger */
async function frozenBoardCandidates(trigger) {
  const selection = selectionFromFrozenDualTrigger(trigger, {
    maxAgeMs: RUNTIME_CONFIG.genericMaxQuoteAgeMs,
  })
  await assertCanonicalCandidateQuoteBlocks(selection.candidates)
  return selection
}

function parseNonNegativeUnits(value, decimals, label) {
  const parsed = parseUnits(value, decimals)
  if (parsed < 0n) throw new Error(`${label} must be non-negative`)
  return parsed
}

function minimumScreenedNetUsdg() {
  return parseNonNegativeUnits(
    RUNTIME_CONFIG.genericWatchMinScreenedNetUsdg || RUNTIME_CONFIG.genericMinNetUsdg,
    6,
    'minimum screened net USDG',
  )
}

async function quoteWethToUsdg(amountIn, blockNumber) {
  const pathValue = encodePacked(['address', 'uint24', 'address'], [GENERIC_WETH, 100, GENERIC_USDG])
  const { result } = await publicClient.simulateContract({
    account: WALLET,
    address: V3_QUOTER,
    abi: V3_QUOTER_ABI,
    functionName: 'quoteExactInput',
    args: [pathValue, amountIn],
    blockNumber,
  })
  return result[0]
}

async function assertCanonicalBase() {
  const chainId = await publicClient.getChainId()
  if (chainId !== CHAIN_ID) throw new Error(`wrong chain id ${chainId}`)
  const targets = [GENERIC_USDG, GENERIC_WETH, POOL_MANAGER, V3_FACTORY, V3_ROUTER, V3_QUOTER, PAIR_HOOK]
  const [codes, usdgSymbol, usdgDecimals, wethDecimals] = await Promise.all([
    Promise.all(targets.map((address) => publicClient.getCode({ address }))),
    publicClient.readContract({ address: GENERIC_USDG, abi: ERC20_ABI, functionName: 'symbol' }),
    publicClient.readContract({ address: GENERIC_USDG, abi: ERC20_ABI, functionName: 'decimals' }),
    publicClient.readContract({ address: GENERIC_WETH, abi: ERC20_ABI, functionName: 'decimals' }),
  ])
  const missing = targets.filter((_, index) => !codes[index] || codes[index] === '0x')
  if (missing.length > 0) throw new Error(`canonical target has no bytecode: ${missing.join(', ')}`)
  if (usdgSymbol !== 'USDG' || usdgDecimals !== 6)
    throw new Error(`USDG identity mismatch: ${usdgSymbol}/${usdgDecimals}`)
  if (wethDecimals !== 18) throw new Error(`WETH decimal identity mismatch: ${wethDecimals}`)
}

async function walletSnapshot() {
  const [blockNumber, gasPrice, ethBalance, nonceLatest, noncePending] = await Promise.all([
    publicClient.getBlockNumber(),
    publicClient.getGasPrice(),
    publicClient.getBalance({ address: WALLET }),
    publicClient.getTransactionCount({ address: WALLET, blockTag: 'latest' }),
    publicClient.getTransactionCount({ address: WALLET, blockTag: 'pending' }),
  ])
  return { blockNumber, gasPrice, ethBalance, nonceLatest, noncePending }
}

async function assertUsdgDeployment(state, compiled) {
  if (
    state?.lane !== 'generic-v2' ||
    state.chainId !== CHAIN_ID ||
    state.wallet?.toLowerCase() !== WALLET.toLowerCase() ||
    !state.executor
  ) {
    throw new Error('valid generic-v2 USDG deployment state was not found')
  }
  if (state.sourceHash !== compiled.sourceHash || state.creationCodeHash !== compiled.creationCodeHash) {
    throw new Error('local USDG executor source/build differs from the deployment ledger')
  }
  const executor = getAddress(state.executor)
  const [code, operator, amountCap, profitFloor] = await Promise.all([
    publicClient.getCode({ address: executor }),
    publicClient.readContract({ address: executor, abi: compiled.abi, functionName: 'operator' }),
    publicClient.readContract({ address: executor, abi: compiled.abi, functionName: 'MAX_AMOUNT_IN' }),
    publicClient.readContract({ address: executor, abi: compiled.abi, functionName: 'MIN_GROSS_PROFIT' }),
  ])
  if (!code || code === '0x' || keccak256(code) !== state.runtimeCodeHash) {
    throw new Error('USDG executor bytecode differs from the deployment ledger')
  }
  if (operator.toLowerCase() !== WALLET.toLowerCase()) throw new Error('USDG executor operator mismatch')
  if (amountCap !== USDG_MAXIMUM_AMOUNT_IN || profitFloor !== USDG_MINIMUM_GROSS_PROFIT) {
    throw new Error('USDG executor economic constants mismatch')
  }
  return { executor, amountCap, profitFloor }
}

async function assertWethDeployment(state, compiled) {
  if (
    state?.lane !== 'weth-v1' ||
    state.chainId !== CHAIN_ID ||
    state.wallet?.toLowerCase() !== WALLET.toLowerCase() ||
    !state.executor
  ) {
    throw new Error('valid weth-v1 deployment state was not found')
  }
  if (
    state.sourceHash !== compiled.sourceHash ||
    state.dependencySourceHash !== compiled.dependencySourceHash ||
    state.sourceBundleHash !== compiled.sourceBundleHash ||
    state.creationCodeHash !== compiled.creationCodeHash
  ) {
    throw new Error('local WETH executor source/build differs from the deployment ledger')
  }
  const executor = getAddress(state.executor)
  const [code, operator, amountCap, profitFloor] = await Promise.all([
    publicClient.getCode({ address: executor }),
    publicClient.readContract({ address: executor, abi: compiled.abi, functionName: 'operator' }),
    publicClient.readContract({ address: executor, abi: compiled.abi, functionName: 'MAX_AMOUNT_IN' }),
    publicClient.readContract({ address: executor, abi: compiled.abi, functionName: 'MIN_GROSS_PROFIT' }),
  ])
  if (!code || code === '0x' || keccak256(code) !== state.runtimeCodeHash) {
    throw new Error('WETH executor bytecode differs from the deployment ledger')
  }
  if (operator.toLowerCase() !== WALLET.toLowerCase()) throw new Error('WETH executor operator mismatch')
  if (
    amountCap !== BigInt(state.policy?.maxAmountInWei) ||
    profitFloor !== BigInt(state.policy?.minimumGrossProfitWei)
  ) {
    throw new Error('WETH executor economic constants differ from the deployment ledger')
  }
  if (amountCap <= 0n || amountCap > WETH_HARD_MAXIMUM_AMOUNT_IN || profitFloor <= 0n || profitFloor > amountCap) {
    throw new Error('WETH executor economic constants are outside reviewed bounds')
  }
  return { executor, amountCap, profitFloor }
}

async function routeBoundarySnapshot(executor, route, baseToken, blockNumber = undefined) {
  const intermediateTokens = [...new Set([route.entryToken, route.targetToken, route.exitToken])].filter(
    (token) => token.toLowerCase() !== baseToken.toLowerCase(),
  )
  const residuals = Object.fromEntries(
    await Promise.all(
      intermediateTokens.map(async (token) => [
        token,
        await publicClient.readContract({
          address: token,
          abi: ERC20_ABI,
          functionName: 'balanceOf',
          args: [executor],
          blockNumber,
        }),
      ]),
    ),
  )
  const baseAllowance = await publicClient.readContract({
    address: baseToken,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [executor, V3_ROUTER],
    blockNumber,
  })
  const exitAllowance =
    route.exitToken.toLowerCase() === baseToken.toLowerCase()
      ? 0n
      : await publicClient.readContract({
          address: route.exitToken,
          abi: ERC20_ABI,
          functionName: 'allowance',
          args: [executor, V3_ROUTER],
          blockNumber,
        })
  return { residuals, allowances: { base: baseAllowance, exit: exitAllowance } }
}

function assertCleanRouteBoundary(boundary) {
  if (Object.values(boundary.residuals).some((balance) => balance !== 0n)) {
    throw new Error('executor has an intermediate-token residual for the selected route')
  }
  if (boundary.allowances.base !== 0n || boundary.allowances.exit !== 0n) {
    throw new Error('executor has a non-zero router allowance')
  }
}

function deploymentGasBounds(estimatedGas, gasPrice) {
  const gasLimit = ceilDiv(estimatedGas * 11_000n, 10_000n) + 10_000n
  const maxFeePerGas = ceilDiv(gasPrice * 10_500n, 10_000n)
  return { gasLimit, maxFeePerGas }
}

async function wethDeployPreflight({ print = true } = {}) {
  assertDualWatcherInactive()
  assertLegacySignersInactive()
  const unresolved = latestUnresolved()
  if (unresolved) throw new Error(`unresolved ${unresolved.kind} mutation ${unresolved.hash}`)
  if (readJson(WETH_STATE_PATH)?.executor) throw new Error('WETH executor is already recorded as deployed')
  const seedEth = parseNonNegativeUnits(RUNTIME_CONFIG.wethSeedEth, 18, 'WETH deployment seed')
  const maximumAmount = parseNonNegativeUnits(RUNTIME_CONFIG.wethMaxAmountWeth, 18, 'WETH maximum amount')
  const minimumGrossProfit = parseNonNegativeUnits(
    RUNTIME_CONFIG.wethMinGrossProfitWeth,
    18,
    'WETH minimum gross profit',
  )
  const minimumEthReserve = parseNonNegativeUnits(RUNTIME_CONFIG.genericMinEthReserve, 18, 'minimum ETH reserve')
  if (
    seedEth <= 0n ||
    maximumAmount <= 0n ||
    maximumAmount > WETH_HARD_MAXIMUM_AMOUNT_IN ||
    minimumGrossProfit <= 0n ||
    minimumGrossProfit > maximumAmount ||
    seedEth > maximumAmount
  ) {
    throw new Error('WETH deployment bounds violate the reviewed constructor limits')
  }
  await assertCanonicalBase()
  const compiled = loadWethContractArtifact()
  const snapshot = await walletSnapshot()
  if (snapshot.nonceLatest !== snapshot.noncePending) throw new Error('wallet has a pending nonce')
  const data = encodeDeployData({
    abi: compiled.abi,
    bytecode: compiled.bytecode,
    args: [WALLET, maximumAmount, minimumGrossProfit],
  })
  await publicClient.call({ account: WALLET, data, value: seedEth, blockNumber: snapshot.blockNumber })
  const estimatedGas = await publicClient.estimateGas({
    account: WALLET,
    data,
    value: seedEth,
    blockNumber: snapshot.blockNumber,
  })
  const { gasLimit, maxFeePerGas } = deploymentGasBounds(estimatedGas, snapshot.gasPrice)
  const maximumGasCost = gasLimit * maxFeePerGas
  if (snapshot.ethBalance < seedEth + maximumGasCost + minimumEthReserve) {
    throw new Error('wallet cannot fund WETH seed, worst-case deployment gas, and the configured reserve')
  }
  const report = {
    status: 'WETH_DEPLOYMENT_READY',
    evidence: 'EXACT_CONSTRUCTOR_CALL_AND_GAS_ESTIMATE_NO_SIGNATURE_NO_BROADCAST',
    wallet: WALLET,
    nonce: snapshot.nonceLatest,
    seedWeth: formatUnits(seedEth, 18),
    maximumTradeWeth: formatUnits(maximumAmount, 18),
    immutableMinimumGrossProfitWeth: formatUnits(minimumGrossProfit, 18),
    estimatedGas,
    maximumGasCostEth: formatEther(maximumGasCost),
    walletEth: formatEther(snapshot.ethBalance),
    retainedWalletEthReserve: formatEther(minimumEthReserve),
    sourceHash: compiled.sourceHash,
    dependencySourceHash: compiled.dependencySourceHash,
    sourceBundleHash: compiled.sourceBundleHash,
    creationCodeHash: compiled.creationCodeHash,
  }
  appendAudit('weth_deploy_preflight', report)
  if (print) console.log(stringify(report))
  return {
    compiled,
    snapshot,
    data,
    seedEth,
    maximumAmount,
    minimumGrossProfit,
    gasLimit,
    maxFeePerGas,
    report,
  }
}

async function signBroadcastWait(plan, transaction, assertStillAuthorized = null) {
  if (assertStillAuthorized) assertStillAuthorized({ stage: 'before-sign' })
  const account = loadAccount()
  const serializedTransaction = await account.signTransaction(transaction)
  if (assertStillAuthorized) assertStillAuthorized({ stage: 'after-sign-before-persist' })
  const hash = keccak256(serializedTransaction)
  const rawPrivateRef = persistSignedRaw(SIGNED_TX_DIR, hash, serializedTransaction)
  const currentSignedAttempt = {
    kind: plan.kind,
    authorizationId: plan.authorizationId || null,
    intentId: plan.intentId,
    planHash: plan.planHash,
    hash,
    nonce: plan.nonce,
    rawPrivateRef,
  }
  appendAudit('mutation_signed', currentSignedAttempt)
  if (assertStillAuthorized) assertStillAuthorized({ stage: 'before-broadcast', currentSignedAttempt })
  try {
    const broadcast = await broadcastSameRawToSequencer({ serializedTransaction, managedRpcUrl: RPC_URL })
    appendAudit('dual_broadcast_result', {
      kind: plan.kind,
      hash,
      nonce: plan.nonce,
      directSequencerStatus: broadcast.direct.status,
      managedFallbackStatus: broadcast.fallback?.status || null,
    })
  } catch (error) {
    appendAudit('dual_broadcast_unknown', { kind: plan.kind, hash, nonce: plan.nonce, error: errorText(error) })
  }
  try {
    const receipt = await publicClient.waitForTransactionReceipt({
      hash,
      confirmations: RUNTIME_CONFIG.finalityConfirmations,
      timeout: 120_000,
    })
    return { hash, receipt }
  } catch (error) {
    appendAudit('dual_receipt_unknown', { kind: plan.kind, hash, error: errorText(error) })
    throw new Error(`transaction receipt is UNKNOWN; reconcile before any new nonce: ${hash}`)
  }
}

async function wethDeploymentStateFromReceipt(plan, hash, receipt, compiled, reconciled = false) {
  if (receipt.status !== 'success' || !receipt.contractAddress) throw new Error('WETH deployment receipt failed')
  const executor = getAddress(receipt.contractAddress)
  const [
    code,
    operator,
    seededWeth,
    strandedNative,
    amountCap,
    profitFloor,
    nonceLatest,
    noncePending,
    walletEthAfter,
  ] = await Promise.all([
    publicClient.getCode({ address: executor }),
    publicClient.readContract({ address: executor, abi: compiled.abi, functionName: 'operator' }),
    publicClient.readContract({ address: GENERIC_WETH, abi: ERC20_ABI, functionName: 'balanceOf', args: [executor] }),
    publicClient.getBalance({ address: executor }),
    publicClient.readContract({ address: executor, abi: compiled.abi, functionName: 'MAX_AMOUNT_IN' }),
    publicClient.readContract({ address: executor, abi: compiled.abi, functionName: 'MIN_GROSS_PROFIT' }),
    publicClient.getTransactionCount({ address: WALLET, blockTag: 'latest' }),
    publicClient.getTransactionCount({ address: WALLET, blockTag: 'pending' }),
    publicClient.getBalance({ address: WALLET }),
  ])
  if (!code || code === '0x' || operator.toLowerCase() !== WALLET.toLowerCase()) {
    throw new Error('WETH deployment post-state identity mismatch')
  }
  if (
    seededWeth !== BigInt(plan.value) ||
    strandedNative !== 0n ||
    amountCap !== BigInt(plan.maximumAmount) ||
    profitFloor !== BigInt(plan.minimumGrossProfit)
  ) {
    throw new Error('WETH deployment post-state economic boundary mismatch')
  }
  const gasSpentWei = receipt.gasUsed * receipt.effectiveGasPrice
  if (nonceLatest !== Number(plan.nonce) + 1 || noncePending !== nonceLatest) {
    throw new Error('WETH deployment nonce did not converge cleanly')
  }
  if (BigInt(plan.walletEthBefore) - walletEthAfter !== BigInt(plan.value) + gasSpentWei) {
    throw new Error('WETH deployment wallet ETH delta differs from seed plus canonical gas')
  }
  const state = {
    schemaVersion: 1,
    lane: 'weth-v1',
    name: 'bounded WETH-based PAIR atomic arbitrage',
    status: 'deployed',
    chainId: CHAIN_ID,
    wallet: WALLET,
    executor,
    runtimeCodeHash: keccak256(code),
    sourceHash: compiled.sourceHash,
    dependencySourceHash: compiled.dependencySourceHash,
    sourceBundleHash: compiled.sourceBundleHash,
    creationCodeHash: compiled.creationCodeHash,
    policy: {
      maxAmountInWei: String(plan.maximumAmount),
      maximumAmountWeth: formatUnits(BigInt(plan.maximumAmount), 18),
      minimumGrossProfitWei: String(plan.minimumGrossProfit),
      minimumGrossProfitWeth: formatUnits(BigInt(plan.minimumGrossProfit), 18),
      runtimeNetFloor: 'SAME_BLOCK_USDG_FLOOR_CONVERTED_UP_TO_WETH',
      profitAsset: 'WETH',
      retainedProfitCompounds: true,
      nativeEthUse: 'GAS_ONLY_AFTER_DEPLOYMENT',
      noWalletTokenApproval: true,
      autonomousExecutionRequiresArm: true,
    },
    deployment: {
      hash,
      blockNumber: receipt.blockNumber.toString(),
      gasUsed: receipt.gasUsed.toString(),
      effectiveGasPriceWei: receipt.effectiveGasPrice.toString(),
      gasSpentWei: gasSpentWei.toString(),
      seededWethWei: seededWeth.toString(),
      walletEthAfterWei: walletEthAfter.toString(),
      reconciled,
    },
    executions: [],
    deployedAt: new Date().toISOString(),
  }
  writeProtectedJson(WETH_STATE_PATH, state)
  appendAudit('weth_deployment_complete', { lane: 'weth-v1', executor, hash, seededWeth, gasSpentWei, reconciled })
  appendAudit('mutation_effect', {
    lane: 'weth-v1',
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

async function deployWeth() {
  const release = acquireLock(WALLET_LOCK_PATH, 'dual-v3-wallet')
  try {
    assertLiveTransport(RUNTIME_CONFIG)
    const check = await wethDeployPreflight({ print: true })
    const [latest, pending] = await Promise.all([
      publicClient.getTransactionCount({ address: WALLET, blockTag: 'latest' }),
      publicClient.getTransactionCount({ address: WALLET, blockTag: 'pending' }),
    ])
    if (latest !== check.snapshot.nonceLatest || pending !== latest)
      throw new Error('nonce changed after WETH deploy preflight')
    const plan = mutationPlan('weth-deploy', 'weth-v1', {
      chainId: CHAIN_ID,
      wallet: WALLET,
      nonce: latest,
      to: null,
      value: check.seedEth,
      dataCommitment: keccak256(check.data),
      gasLimit: check.gasLimit,
      maxFeePerGas: check.maxFeePerGas,
      maxPriorityFeePerGas: 0n,
      maximumAmount: check.maximumAmount,
      minimumGrossProfit: check.minimumGrossProfit,
      walletEthBefore: check.snapshot.ethBalance,
      sourceHash: check.compiled.sourceHash,
      dependencySourceHash: check.compiled.dependencySourceHash,
      sourceBundleHash: check.compiled.sourceBundleHash,
      creationCodeHash: check.compiled.creationCodeHash,
    })
    const { hash, receipt } = await signBroadcastWait(plan, {
      chainId: CHAIN_ID,
      type: 'eip1559',
      data: check.data,
      value: check.seedEth,
      gas: check.gasLimit,
      maxFeePerGas: check.maxFeePerGas,
      maxPriorityFeePerGas: 0n,
      nonce: latest,
    })
    if (receipt.status !== 'success') {
      const gasSpentWei = receipt.gasUsed * receipt.effectiveGasPrice
      appendAudit('mutation_reverted', { lane: 'weth-v1', kind: plan.kind, hash, planHash: plan.planHash, gasSpentWei })
      throw new Error(`WETH deployment reverted: ${hash}`)
    }
    const state = await wethDeploymentStateFromReceipt(plan, hash, receipt, check.compiled)
    console.log(
      stringify({
        status: 'WETH_DEPLOYMENT_CONFIRMED',
        executor: state.executor,
        transaction: hash,
        explorer: `${EXPLORER_TX}${hash}`,
        seededWeth: formatUnits(BigInt(state.deployment.seededWethWei), 18),
      }),
    )
    return state
  } finally {
    release()
  }
}

async function loadVerifiedDeployments() {
  const [usdgCompiled, wethCompiled, universalCompiled] = [
    loadGenericContractArtifact(),
    loadWethContractArtifact(),
    loadUniversalContractArtifact(),
  ]
  const universalState = readJson(UNIVERSAL_STATE_PATH)
  const [usdg, weth, universal] = await Promise.all([
    assertUsdgDeployment(readJson(USDG_STATE_PATH), usdgCompiled),
    assertWethDeployment(readJson(WETH_STATE_PATH), wethCompiled),
    assertUniversalDeployment(universalState, universalCompiled),
  ])
  return {
    usdg: { ...usdg, state: readJson(USDG_STATE_PATH), compiled: usdgCompiled, baseToken: GENERIC_USDG, decimals: 6 },
    weth: { ...weth, state: readJson(WETH_STATE_PATH), compiled: wethCompiled, baseToken: GENERIC_WETH, decimals: 18 },
    universal: { ...universal, state: universalState, compiled: universalCompiled },
  }
}

async function assertUniversalDeployment(state, compiled) {
  if (
    state?.schemaVersion !== 1 ||
    state.lane !== 'global-v1' ||
    state.chainId !== CHAIN_ID ||
    state.wallet?.toLowerCase() !== WALLET.toLowerCase() ||
    !state.executor ||
    state.sourceHash !== compiled.sourceHash ||
    state.creationCodeHash !== compiled.creationCodeHash
  ) {
    throw new Error('valid global-v1 universal deployment state was not found')
  }
  const executor = getAddress(state.executor)
  const [code, operator, morpho] = await Promise.all([
    publicClient.getCode({ address: executor }),
    publicClient.readContract({ address: executor, abi: compiled.abi, functionName: 'operator' }),
    publicClient.readContract({ address: executor, abi: compiled.abi, functionName: 'MORPHO' }),
  ])
  if (!code || code === '0x' || keccak256(code) !== state.runtimeCodeHash) {
    throw new Error('universal executor bytecode differs from the deployment ledger')
  }
  if (operator.toLowerCase() !== WALLET.toLowerCase() || morpho.toLowerCase() !== MORPHO.toLowerCase()) {
    throw new Error('universal executor protocol identity mismatch')
  }
  return { executor }
}

function deploymentForCandidate(deployments, candidate) {
  if (candidate.baseAsset === 'USDG') return deployments.usdg
  if (candidate.baseAsset === 'WETH') return deployments.weth
  throw new Error(`unsupported candidate base asset ${candidate.baseAsset}`)
}

function candidateScreenedNetUsdg(candidate) {
  return BigInt(candidate.normalizedScreenedNetUsdg ?? candidate.screenedNetProfit)
}

function assertArmCandidateBounds(arm, candidate, deployments) {
  const hardCap = BigInt(candidate.baseAsset === 'USDG' ? arm.usdgHardCapWei : arm.wethHardCapWei)
  if (candidate.amountIn > hardCap) throw new Error(`${candidate.baseAsset} candidate exceeds the authorized hard cap`)
  if (deployments) {
    const deployment = deploymentForCandidate(deployments, candidate)
    if (candidate.amountIn > dualSpendablePrincipal(arm, deployment.state, candidate.baseAsset)) {
      throw new Error(`${candidate.baseAsset} candidate exceeds realized authorized principal`)
    }
  }
  if (candidateScreenedNetUsdg(candidate) < BigInt(arm.minimumScreenedNetProfitUsdgWei)) {
    throw new Error(`${candidate.baseAsset} candidate is below the authorized screened-net floor`)
  }
}

function assertDualAuthorization(arm, deployments, { currentSignedAttempt = null } = {}) {
  if (!arm || arm.status !== 'ARMED') {
    const error = new Error('dual watcher is not armed')
    error.watchPolicyStop = true
    throw error
  }
  if (readDualRevocation(arm.authorizationId)) {
    const error = new Error('dual watcher authorization was disarmed')
    error.watchPolicyStop = true
    throw error
  }
  if (dualAuthorizationId(arm) !== arm.authorizationId) throw new Error('dual authorization commitment mismatch')
  if (arm.chainId !== CHAIN_ID || arm.wallet?.toLowerCase() !== WALLET.toLowerCase()) {
    throw new Error('dual authorization chain or wallet mismatch')
  }
  if (
    arm.usdgExecutor?.toLowerCase() !== deployments.usdg.executor.toLowerCase() ||
    arm.usdgSourceHash !== deployments.usdg.state.sourceHash ||
    arm.usdgRuntimeCodeHash !== deployments.usdg.state.runtimeCodeHash ||
    BigInt(arm.usdgHardCapWei) !== deployments.usdg.amountCap ||
    arm.wethExecutor?.toLowerCase() !== deployments.weth.executor.toLowerCase() ||
    arm.wethSourceHash !== deployments.weth.state.sourceHash ||
    arm.wethRuntimeCodeHash !== deployments.weth.state.runtimeCodeHash ||
    BigInt(arm.wethHardCapWei) !== deployments.weth.amountCap ||
    arm.global?.executor?.toLowerCase() !== deployments.universal.executor.toLowerCase() ||
    arm.global?.sourceHash !== deployments.universal.state.sourceHash ||
    arm.global?.runtimeCodeHash !== deployments.universal.state.runtimeCodeHash
  ) {
    throw new Error('dual authorization is not bound to the current deployments')
  }
  if (
    !['deployed', 'live_gross_validated'].includes(deployments.usdg.state.status) ||
    !['deployed', 'live_gross_validated'].includes(deployments.weth.state.status)
  ) {
    throw new Error('one executor state is not eligible for automated execution')
  }
  // Validate both principal ledgers on every authorization check. A corrupt or
  // cross-authorization record in the idle lane must halt the shared signer;
  // it must not be hidden merely because the other lane currently ranks first.
  dualSpendablePrincipal(arm, deployments.usdg.state, 'USDG')
  dualSpendablePrincipal(arm, deployments.weth.state, 'WETH')
  const configuredMinimumNet = parseNonNegativeUnits(RUNTIME_CONFIG.genericMinNetUsdg, 6, 'minimum net USDG')
  const configuredScreenedNet = minimumScreenedNetUsdg()
  const configuredReserve = parseNonNegativeUnits(RUNTIME_CONFIG.genericMinEthReserve, 18, 'minimum ETH reserve')
  const configuredEarnMinimumNet = parseNonNegativeUnits(
    RUNTIME_CONFIG.earnLiveMinNetWeth,
    18,
    'EarnOnHood minimum net WETH',
  )
  const configuredEarnHeadroom = parseNonNegativeUnits(
    RUNTIME_CONFIG.earnLiveMinHeadroomWeth,
    18,
    'EarnOnHood quote headroom WETH',
  )
  const configuredEarnGasCeiling = parseNonNegativeUnits(
    RUNTIME_CONFIG.earnLiveMaxFailedGasWeth,
    18,
    'EarnOnHood per-attempt Gas ceiling',
  )
  const configuredEarnReserve = parseNonNegativeUnits(
    RUNTIME_CONFIG.earnLiveWalletReserveWeth,
    18,
    'EarnOnHood wallet reserve',
  )
  const configuredGlobalSettlementSeeds = globalSettlementSeeds(
    [GENERIC_USDG, GENERIC_WETH],
    RUNTIME_CONFIG.globalExtraSettlementAssets,
  )
  if (
    !RUNTIME_CONFIG.genericWatchUntilRevoked ||
    RUNTIME_CONFIG.genericWatchAutoRenew ||
    RUNTIME_CONFIG.genericWatchMaxExecutions !== null ||
    RUNTIME_CONFIG.genericWatchMaxAttempts !== null ||
    RUNTIME_CONFIG.genericWatchMaxPreflights !== null ||
    BigInt(arm.minimumNetProfitUsdgWei) !== configuredMinimumNet ||
    BigInt(arm.minimumScreenedNetProfitUsdgWei) !== configuredScreenedNet ||
    BigInt(arm.walletEthReserveWei) !== configuredReserve ||
    Number(arm.profitRetentionBps) !== RUNTIME_CONFIG.genericProfitRetentionBps ||
    Number(arm.pollIntervalMs) !== RUNTIME_CONFIG.genericWatchPollMs ||
    BigInt(arm.maxFailedGasWei) !== RUNTIME_CONFIG.maxFailedGasWei ||
    !RUNTIME_CONFIG.earnWatchEnabled ||
    arm.earnOnHood?.enabled !== true ||
    arm.earnOnHood.routeCommitment !== EARN_ROUTE_COMMITMENT ||
    arm.earnOnHood.vault?.toLowerCase() !== EARN_VAULT.toLowerCase() ||
    arm.earnOnHood.batchRouter?.toLowerCase() !== EARN_BATCH_ROUTER.toLowerCase() ||
    arm.earnOnHood.poolScope !== EARN_ROUTE_DISCOVERY_POLICY.poolScope ||
    arm.earnOnHood.catalogSource !== EARN_ROUTE_DISCOVERY_POLICY.catalogSource ||
    arm.earnOnHood.factory?.toLowerCase() !== EARN_ROUTE_DISCOVERY_POLICY.factory.toLowerCase() ||
    Number(arm.earnOnHood.maximumHops) !== EARN_ROUTE_DISCOVERY_POLICY.maximumHops ||
    BigInt(arm.earnOnHood.minimumNetProfitWei) !== configuredEarnMinimumNet ||
    BigInt(arm.earnOnHood.minimumQuoteHeadroomWei) !== configuredEarnHeadroom ||
    BigInt(arm.earnOnHood.perAttemptGasCeilingWei) !== configuredEarnGasCeiling ||
    BigInt(arm.earnOnHood.walletReserveWei) !== configuredEarnReserve ||
    Number(arm.earnOnHood.eventPollMs) !== RUNTIME_CONFIG.earnWatchEventPollMs ||
    Number(arm.earnOnHood.periodicMs) !== RUNTIME_CONFIG.earnWatchPeriodicMs ||
    arm.earnOnHood.sizingAlgorithm !== EARN_SIZING_ALGORITHM ||
    Number(arm.earnOnHood.coarseProbePoints) !== RUNTIME_CONFIG.earnLiveCoarseProbePoints ||
    Number(arm.earnOnHood.refinementPoints) !== RUNTIME_CONFIG.earnLiveRefinementPoints ||
    Number(arm.earnOnHood.publicMaximumExactQuotesPerWake) !==
      maximumEarnPublicExactQuotes(RUNTIME_CONFIG.earnLiveRefinementPoints) ||
    Number(arm.earnOnHood.managedMaximumExactQuotesPerWake) !== RUNTIME_CONFIG.earnLiveRefinementPoints + 3 ||
    arm.earnOnHood.discoveryRpc !== EARN_DISCOVERY_RPC_POLICY ||
    arm.earnOnHood.eventSource !== EARN_EVENT_SOURCE_POLICY ||
    Number(arm.earnOnHood.eventPollMs) !== RUNTIME_CONFIG.earnWatchEventPollMs ||
    Number(arm.earnOnHood.periodicMs) !== RUNTIME_CONFIG.earnWatchPeriodicMs ||
    Number(arm.earnOnHood.managedFallbackDailyLogicalCallCap) !==
      RUNTIME_CONFIG.earnManagedFallbackDailyLogicalCallCap ||
    Number(arm.earnOnHood.managedFallbackEventLogicalCallCap) !== EARN_MANAGED_FALLBACK_EVENT_LOGICAL_CALL_CAP ||
    Number(arm.earnOnHood.managedFallbackRecoveryLogicalCallCap) !== EARN_MANAGED_FALLBACK_RECOVERY_LOGICAL_CALL_CAP ||
    !RUNTIME_CONFIG.globalWatchEnabled ||
    arm.global?.enabled !== true ||
    arm.global.fundingPolicy !== 'MORPHO_ZERO_FEE_FLASH_OR_PROTECTED_EXECUTOR_INVENTORY' ||
    arm.global.universePolicy !== GLOBAL_UNIVERSE_POLICY.version ||
    arm.global.feedPolicy !== GLOBAL_FEED_MATCH_POLICY ||
    arm.global.routeWorksetPolicy !== GLOBAL_ROUTE_WORKSET_POLICY ||
    arm.global.submissionPolicy !== 'DIRECT_SEQUENCER_THEN_SAME_RAW_MANAGED_FALLBACK' ||
    BigInt(arm.global.minimumNetProfitUsdgWei) !== configuredMinimumNet ||
    Number(arm.global.maximumRoutesPerWake) !== RUNTIME_CONFIG.globalMaxRoutesPerWake ||
    Number(arm.global.maximumEventRoutesPerWake) !== GLOBAL_EVENT_MAX_ROUTES_PER_WAKE ||
    Number(arm.global.quoteConcurrency) !== RUNTIME_CONFIG.globalQuoteConcurrency ||
    Number(arm.global.managedMaximumCandidatesPerWake) !== GLOBAL_MAX_MANAGED_CANDIDATES_PER_WAKE ||
    Number(arm.global.managedFallbackDailyLogicalCallCap) !== RUNTIME_CONFIG.globalManagedFallbackDailyLogicalCallCap ||
    Number(arm.global.managedFallbackEventLogicalCallCap) !== GLOBAL_MANAGED_FALLBACK_EVENT_LOGICAL_CALL_CAP ||
    Number(arm.global.managedFallbackRecoveryLogicalCallCap) !== GLOBAL_MANAGED_FALLBACK_RECOVERY_LOGICAL_CALL_CAP ||
    arm.global.settlementPolicy !== GLOBAL_SETTLEMENT_ADMISSION_POLICY ||
    Number(arm.global.maximumSettlementFundingChecksPerWake) !== GLOBAL_MAX_SETTLEMENT_FUNDING_CHECKS_PER_WAKE ||
    Number(arm.global.maximumSettlementAssetsPerWake) !== GLOBAL_MAX_SETTLEMENT_ASSETS_PER_WAKE ||
    arm.global.graphPolicy !== GLOBAL_GRAPH_POLICY.version ||
    arm.global.routePolicy !== GLOBAL_ATOMIC_ROUTE_POLICY ||
    !Array.isArray(arm.global.settlementSeeds) ||
    arm.global.settlementSeeds.length !== configuredGlobalSettlementSeeds.length ||
    arm.global.settlementSeeds.some(
      (token, index) => token.toLowerCase() !== configuredGlobalSettlementSeeds[index].toLowerCase(),
    ) ||
    Number(arm.global.minimumWakeIntervalMs) !== RUNTIME_CONFIG.globalWatchMinIntervalMs ||
    Number(arm.global.periodicMs) !== RUNTIME_CONFIG.globalWatchPeriodicMs
  ) {
    throw new Error('dual watcher runtime economics differ from the authorization scope')
  }
  const records = readAuditRecords()
  const usage = dualAuthorizationUsage(arm, deployments.usdg.state, deployments.weth.state, records)
  const budget = evaluateDualAuthorizationBudget(arm, usage)
  if (!budget.allowed) {
    const error = new Error(budget.reason)
    error.watchPolicyStop = true
    throw error
  }
  if (currentSignedAttempt) {
    const reservation = validateDualSignedAttempt(arm, records, currentSignedAttempt, latestUnresolved())
    if (!reservation.allowed) throw new Error(reservation.reason)
  }
  return usage
}

async function evaluateCandidate(candidate, deployment, context) {
  try {
    if (candidate.amountIn > deployment.amountCap) throw new Error('candidate exceeds executor hard cap')
    if (context.principals[candidate.baseAsset] < candidate.amountIn) {
      throw new Error(`${candidate.baseAsset} principal is below candidate amount`)
    }
    if (context.arm) assertArmCandidateBounds(context.arm, candidate, context.deployments)
    const tokens = [...new Set([candidate.route.targetToken, candidate.route.entryToken, candidate.route.exitToken])]
    const [codes, boundary] = await Promise.all([
      Promise.all(tokens.map((address) => publicClient.getCode({ address, blockNumber: context.block.number }))),
      routeBoundarySnapshot(deployment.executor, candidate.route, deployment.baseToken, context.block.number),
    ])
    if (codes.some((code) => !code || code === '0x')) throw new Error('route contains a token without bytecode')
    assertCleanRouteBoundary(boundary)
    const minimumContractProfit = deployment.profitFloor
    const args = [candidate.route, candidate.amountIn, minimumContractProfit, context.deadline]
    const [simulation, estimatedGas, routeHash] = await Promise.all([
      publicClient.simulateContract({
        account: WALLET,
        address: deployment.executor,
        abi: deployment.compiled.abi,
        functionName: 'execute',
        args,
        blockNumber: context.block.number,
      }),
      publicClient.estimateContractGas({
        account: WALLET,
        address: deployment.executor,
        abi: deployment.compiled.abi,
        functionName: 'execute',
        args,
        blockNumber: context.block.number,
      }),
      publicClient.readContract({
        address: deployment.executor,
        abi: deployment.compiled.abi,
        functionName: 'routeHash',
        args: [candidate.route],
        blockNumber: context.block.number,
      }),
    ])
    let economics
    let normalizedExactNetUsdg
    if (candidate.baseAsset === 'USDG') {
      economics = deriveExecutionEconomics({
        simulatedGrossProfit: simulation.result[1],
        estimatedGas,
        gasPriceWei: context.gasPrice,
        nativeMarkInWei: NATIVE_MARK_INPUT,
        nativeMarkOutUsdg: context.nativeMarkUsdg,
        minimumGrossProfit: deployment.profitFloor,
        minimumNetProfit: context.minimumNetUsdg,
        profitRetentionBps: BigInt(RUNTIME_CONFIG.genericProfitRetentionBps),
      })
      normalizedExactNetUsdg = economics.expectedNetProfitUsdg
    } else {
      economics = deriveWethExecutionEconomics({
        simulatedGrossProfit: simulation.result[1],
        estimatedGas,
        gasPriceWei: context.gasPrice,
        minimumGrossProfit: deployment.profitFloor,
        minimumNetProfit: context.minimumNetWeth,
        profitRetentionBps: BigInt(RUNTIME_CONFIG.genericProfitRetentionBps),
      })
      normalizedExactNetUsdg = normalizeWethToUsdg(
        economics.expectedNetProfitWei,
        NATIVE_MARK_INPUT,
        context.nativeMarkUsdg,
      )
    }
    if (normalizedExactNetUsdg < context.minimumNetUsdg) {
      throw new Error('exact normalized net profit is below the common USDG floor')
    }
    const maximumGasCostWei = economics.gasLimit * economics.maxFeePerGas
    if (context.walletEth < maximumGasCostWei + context.minimumEthReserve) {
      throw new Error('wallet cannot fund worst-case gas and the retained ETH reserve')
    }
    return {
      status: 'EXACT_POSITIVE',
      candidate,
      deployment,
      exactBlockNumber: context.block.number,
      simulation,
      estimatedGas,
      routeHash,
      economics,
      normalizedExactNetUsdg,
      maximumGasCostWei,
    }
  } catch (error) {
    return {
      status: 'REJECTED',
      candidate,
      exactBlockNumber: context.block.number,
      error: errorText(error),
    }
  }
}

function exactEvaluationView(item) {
  const decimals = item.candidate.baseDecimals
  if (item.error) {
    return {
      baseAsset: item.candidate.baseAsset,
      route: item.candidate.routeLabel,
      amountIn: formatUnits(item.candidate.amountIn, decimals),
      status: 'REJECTED',
      reason: item.error,
    }
  }
  return {
    baseAsset: item.candidate.baseAsset,
    route: item.candidate.routeLabel,
    amountIn: formatUnits(item.candidate.amountIn, decimals),
    status: item.status,
    grossProfit: formatUnits(item.simulation.result[1], decimals),
    normalizedNetUsdg: formatUnits(item.normalizedExactNetUsdg, 6),
    estimatedGas: item.estimatedGas,
  }
}

async function executionPreflight({
  print = true,
  candidateHash = null,
  authorizationId = null,
  frozenTrigger = null,
} = {}) {
  assertLegacySignersInactive()
  assertDualExecutionContext(authorizationId)
  const unresolved = latestUnresolved()
  if (unresolved) throw new Error(`unresolved ${unresolved.kind} mutation ${unresolved.hash}`)
  await assertCanonicalBase()
  const deployments = await loadVerifiedDeployments()
  const arm = authorizationId ? readJson(DUAL_WATCH_ARM_PATH) : null
  if (authorizationId) {
    if (arm?.authorizationId !== authorizationId) throw new Error('dual watcher authorization changed before preflight')
    assertDualAuthorization(arm, deployments)
  }
  const [{ snapshot: board, candidates }, wallet] = await Promise.all([
    frozenTrigger ? frozenBoardCandidates(frozenTrigger) : boardCandidates({ candidateHash }),
    walletSnapshot(),
  ])
  if (wallet.nonceLatest !== wallet.noncePending) throw new Error('wallet has a pending nonce')
  const [block, nativeMarkUsdg, usdgPrincipal, wethPrincipal] = await Promise.all([
    publicClient.getBlock({ blockNumber: wallet.blockNumber }),
    quoteWethToUsdg(NATIVE_MARK_INPUT, wallet.blockNumber),
    publicClient.readContract({
      address: GENERIC_USDG,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [deployments.usdg.executor],
      blockNumber: wallet.blockNumber,
    }),
    publicClient.readContract({
      address: GENERIC_WETH,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [deployments.weth.executor],
      blockNumber: wallet.blockNumber,
    }),
  ])
  const minimumNetUsdg = parseNonNegativeUnits(RUNTIME_CONFIG.genericMinNetUsdg, 6, 'minimum net USDG')
  const minimumNetWeth = wethFloorFromUsdg(minimumNetUsdg, NATIVE_MARK_INPUT, nativeMarkUsdg)
  const minimumEthReserve = parseNonNegativeUnits(RUNTIME_CONFIG.genericMinEthReserve, 18, 'minimum ETH reserve')
  const context = {
    block,
    gasPrice: wallet.gasPrice,
    walletEth: wallet.ethBalance,
    nativeMarkUsdg,
    minimumNetUsdg,
    minimumNetWeth,
    minimumEthReserve,
    principals: { USDG: usdgPrincipal, WETH: wethPrincipal },
    deadline: block.timestamp + DEADLINE_SECONDS,
    arm,
    deployments,
  }
  const evaluated = await Promise.all(
    candidates.map((candidate) =>
      evaluateCandidate(candidate, deploymentForCandidate(deployments, candidate), context),
    ),
  )
  let selected
  try {
    selected = selectBestExactEvaluation(evaluated)
  } catch (error) {
    throw new Error(
      `${errorText(error)}: ${evaluated
        .map((item) => exactEvaluationView(item).reason)
        .filter(Boolean)
        .join(' | ')}`,
    )
  }
  const report = {
    status: 'DUAL_BASE_READY_TO_EXECUTE',
    evidence: 'SAME_BLOCK_EXACT_CALL_AND_GAS_ESTIMATE_NO_SIGNATURE_NO_BROADCAST',
    executionHandoff: frozenTrigger?.handoff || 'CURRENT_BOARD_SELECTION',
    exactBlockNumber: block.number,
    wallet: WALLET,
    nonce: wallet.nonceLatest,
    boardGeneratedAt: board.generatedAt,
    screenedCandidates: candidates.length,
    exactCandidatesPassed: evaluated.filter((item) => !item.error).length,
    selected: {
      baseAsset: selected.candidate.baseAsset,
      route: selected.candidate.routeLabel,
      amountIn: formatUnits(selected.candidate.amountIn, selected.candidate.baseDecimals),
      grossProfit: formatUnits(selected.simulation.result[1], selected.candidate.baseDecimals),
      normalizedNetUsdg: formatUnits(selected.normalizedExactNetUsdg, 6),
      candidateHash: selected.candidate.candidateHash,
    },
    commonNetFloorUsdg: formatUnits(minimumNetUsdg, 6),
    walletEth: formatEther(wallet.ethBalance),
    retainedWalletEthReserve: formatEther(minimumEthReserve),
    executorBalances: {
      usdg: formatUnits(usdgPrincipal, 6),
      weth: formatUnits(wethPrincipal, 18),
    },
    evaluated: evaluated.map(exactEvaluationView),
  }
  appendAudit('dual_execution_preflight', report)
  if (print) console.log(stringify(report))
  return { deployments, board, candidates, wallet, context, evaluated, selected, report }
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

async function executionStateFromReceipt(plan, hash, receipt, reconciled = false) {
  const isWeth = plan.kind === 'weth-execute'
  const statePath = isWeth ? WETH_STATE_PATH : USDG_STATE_PATH
  const state = readJson(statePath)
  const compiled = isWeth ? loadWethContractArtifact() : loadGenericContractArtifact()
  const deployment = isWeth ? await assertWethDeployment(state, compiled) : await assertUsdgDeployment(state, compiled)
  const baseToken = isWeth ? GENERIC_WETH : GENERIC_USDG
  const baseAsset = isWeth ? 'WETH' : 'USDG'
  const decimals = isWeth ? 18 : 6
  if (receipt.status !== 'success') throw new Error(`${baseAsset} execution receipt failed`)
  const executed = decodeExecutorEvent(receipt, compiled, deployment.executor, 'Executed')
  if (
    !executed ||
    executed.routeHash.toLowerCase() !== String(plan.routeHash).toLowerCase() ||
    executed.targetToken.toLowerCase() !== String(plan.targetToken).toLowerCase() ||
    BigInt(executed.amountIn) !== BigInt(plan.amountIn)
  ) {
    throw new Error(`${baseAsset} Executed event differs from the persisted plan`)
  }
  const [baseBalanceAfter, boundary] = await Promise.all([
    publicClient.readContract({
      address: baseToken,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [deployment.executor],
    }),
    routeBoundarySnapshot(deployment.executor, plan.route, baseToken),
  ])
  assertCleanRouteBoundary(boundary)
  const grossProfit = BigInt(executed.grossProfit)
  if (
    baseBalanceAfter !== BigInt(plan.executorBaseBefore) + grossProfit ||
    BigInt(executed.amountOut) !== BigInt(executed.amountIn) + grossProfit
  ) {
    throw new Error(`${baseAsset} receipt and exact post-state balance disagree`)
  }
  const gasSpentWei = receipt.gasUsed * receipt.effectiveGasPrice
  const receiptMark = await quoteWethToUsdg(NATIVE_MARK_INPUT, receipt.blockNumber)
  let netProfitBase
  let normalizedNetUsdg
  if (isWeth) {
    if (grossProfit < gasSpentWei) throw new Error('confirmed WETH gross profit is below canonical gas')
    netProfitBase = grossProfit - gasSpentWei
    normalizedNetUsdg = normalizeWethToUsdg(netProfitBase, NATIVE_MARK_INPUT, receiptMark)
  } else {
    const gasUsdg = ceilDiv(gasSpentWei * receiptMark, NATIVE_MARK_INPUT)
    if (grossProfit < gasUsdg) throw new Error('confirmed USDG gross profit is below marked canonical gas')
    netProfitBase = grossProfit - gasUsdg
    normalizedNetUsdg = netProfitBase
  }
  if (netProfitBase < BigInt(plan.minimumNetProfitBase) || normalizedNetUsdg < BigInt(plan.minimumNetProfitUsdg)) {
    throw new Error('confirmed execution net profit is below the immutable plan floor')
  }
  const record = {
    hash,
    blockNumber: receipt.blockNumber.toString(),
    blockHash: receipt.blockHash,
    baseAsset,
    candidateHash: plan.candidateHash,
    executionKey: plan.executionKey,
    opportunityId: plan.opportunityId,
    authorizationId: plan.authorizationId || null,
    routeHash: plan.routeHash,
    routeLabel: plan.routeLabel,
    targetToken: plan.targetToken,
    amountInWei: BigInt(executed.amountIn).toString(),
    amountOutWei: BigInt(executed.amountOut).toString(),
    grossProfitWei: grossProfit.toString(),
    netProfitBaseWei: netProfitBase.toString(),
    normalizedNetProfitUsdgWei: normalizedNetUsdg.toString(),
    gasUsed: receipt.gasUsed.toString(),
    effectiveGasPriceWei: receipt.effectiveGasPrice.toString(),
    gasSpentWei: gasSpentWei.toString(),
    executorBaseBeforeWei: String(plan.executorBaseBefore),
    executorBaseAfterWei: baseBalanceAfter.toString(),
    evidence: 'CONFIRMED_BASE_BALANCE_DELTA_AND_CANONICAL_GAS',
    reconciled,
    confirmedAt: new Date().toISOString(),
  }
  if (!isWeth) {
    record.netProfitUsdgWei = normalizedNetUsdg.toString()
    record.executorUsdgBeforeWei = String(plan.executorBaseBefore)
    record.executorUsdgAfterWei = baseBalanceAfter.toString()
  }
  state.status = 'live_gross_validated'
  if (!(state.executions || []).some((item) => item.hash === hash))
    state.executions = [...(state.executions || []), record]
  state.lastExecution = record
  writeProtectedJson(statePath, state)
  appendAudit('dual_execution_complete', record)
  appendAudit('mutation_effect', {
    lane: isWeth ? 'weth-v1' : 'generic-v2',
    kind: plan.kind,
    hash,
    intentId: plan.intentId,
    planHash: plan.planHash,
    result: 'CONFIRMED_SUCCESS',
    blockNumber: receipt.blockNumber,
    grossProfitWei: grossProfit,
    normalizedNetProfitUsdgWei: normalizedNetUsdg,
    reconciled,
  })
  return { ...record, decimals }
}

async function execute({ authorizationId = null, abortRequested = null, frozenTrigger = null } = {}) {
  const release = acquireLock(WALLET_LOCK_PATH, 'dual-v3-wallet')
  try {
    assertLiveTransport(RUNTIME_CONFIG)
    assertLegacySignersInactive()
    assertDualExecutionContext(authorizationId)
    const check = await executionPreflight({ print: true, authorizationId, frozenTrigger })
    const selected = check.selected
    const candidate = selected.candidate
    const deployment = selected.deployment
    if (authorizationId) {
      const liveArm = readJson(DUAL_WATCH_ARM_PATH)
      if (liveArm?.authorizationId !== authorizationId) {
        throw new Error('dual watcher authorization changed during exact preflight')
      }
      const usage = assertDualAuthorization(liveArm, check.deployments)
      const expectedNonce = expectedDualWalletNonce(liveArm, usage)
      if (check.wallet.nonceLatest !== expectedNonce) {
        throw new Error(`dual watcher nonce conflict: observed=${check.wallet.nonceLatest}, expected=${expectedNonce}`)
      }
      assertArmCandidateBounds(liveArm, candidate, check.deployments)
    }
    const [latest, pending, currentGasPrice, executorBaseBefore, walletEthBefore, boundary] = await Promise.all([
      publicClient.getTransactionCount({ address: WALLET, blockTag: 'latest' }),
      publicClient.getTransactionCount({ address: WALLET, blockTag: 'pending' }),
      publicClient.getGasPrice(),
      publicClient.readContract({
        address: deployment.baseToken,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [deployment.executor],
      }),
      publicClient.getBalance({ address: WALLET }),
      routeBoundarySnapshot(deployment.executor, candidate.route, deployment.baseToken),
    ])
    if (latest !== check.wallet.nonceLatest || pending !== latest)
      throw new Error('nonce changed after exact preflight')
    if (executorBaseBefore < candidate.amountIn) throw new Error('executor principal changed after exact preflight')
    if (currentGasPrice > selected.economics.maxFeePerGas) {
      throw new Error('current gas price moved above the protected max fee after exact preflight')
    }
    assertCleanRouteBoundary(boundary)
    const maximumGasCostWei = selected.economics.gasLimit * selected.economics.maxFeePerGas
    if (walletEthBefore < maximumGasCostWei + check.context.minimumEthReserve) {
      throw new Error('wallet ETH reserve failed immediately before signing')
    }
    const protectedArgs = [
      candidate.route,
      candidate.amountIn,
      selected.economics.minimumProfit,
      check.context.deadline,
    ]
    await publicClient.simulateContract({
      account: WALLET,
      address: deployment.executor,
      abi: deployment.compiled.abi,
      functionName: 'execute',
      args: protectedArgs,
    })
    const data = encodeFunctionData({
      abi: deployment.compiled.abi,
      functionName: 'execute',
      args: protectedArgs,
    })
    const kind = candidate.baseAsset === 'WETH' ? 'weth-execute' : 'generic-execute'
    const lane = candidate.baseAsset === 'WETH' ? 'weth-v1' : 'generic-v2'
    const minimumNetProfitBase =
      candidate.baseAsset === 'WETH' ? check.context.minimumNetWeth : check.context.minimumNetUsdg
    const plan = mutationPlan(kind, lane, {
      chainId: CHAIN_ID,
      wallet: WALLET,
      executor: deployment.executor,
      baseAsset: candidate.baseAsset,
      baseToken: deployment.baseToken,
      authorizationId,
      nonce: latest,
      to: deployment.executor,
      value: 0n,
      dataCommitment: keccak256(data),
      gasLimit: selected.economics.gasLimit,
      maxFeePerGas: selected.economics.maxFeePerGas,
      maxPriorityFeePerGas: 0n,
      candidateHash: candidate.candidateHash,
      executionKey: candidate.executionKey,
      opportunityId: candidate.opportunityId,
      quoteBlockNumber: candidate.quoteBlockNumber,
      quoteBlockHash: candidate.quoteBlockHash,
      exactBlockNumber: check.context.block.number,
      routeHash: selected.routeHash,
      routeLabel: candidate.routeLabel,
      route: candidate.route,
      targetToken: candidate.route.targetToken,
      amountIn: candidate.amountIn,
      simulatedAmountOut: selected.simulation.result[0],
      simulatedGrossProfit: selected.simulation.result[1],
      normalizedExpectedNetUsdg: selected.normalizedExactNetUsdg,
      minimumGrossProfit: selected.economics.minimumProfit,
      minimumNetProfitBase,
      minimumNetProfitUsdg: check.context.minimumNetUsdg,
      nativeMarkInputWethWei: NATIVE_MARK_INPUT,
      nativeMarkOutputUsdgWei: check.context.nativeMarkUsdg,
      deadline: check.context.deadline,
      executorBaseBefore,
      walletEthBefore,
    })
    const assertStillAuthorized = authorizationId
      ? ({ currentSignedAttempt = null } = {}) => {
          if (abortRequested?.()) {
            const error = new Error('stop requested before signing')
            error.watchPolicyStop = true
            throw error
          }
          const liveArm = readJson(DUAL_WATCH_ARM_PATH)
          if (liveArm?.authorizationId !== authorizationId || readDualRevocation(authorizationId)) {
            const error = new Error('dual watcher authorization changed or was revoked')
            error.watchPolicyStop = true
            throw error
          }
          assertDualAuthorization(liveArm, check.deployments, { currentSignedAttempt })
          assertArmCandidateBounds(liveArm, candidate, check.deployments)
        }
      : null
    if (assertStillAuthorized) assertStillAuthorized()
    const { hash, receipt } = await signBroadcastWait(
      plan,
      {
        chainId: CHAIN_ID,
        type: 'eip1559',
        to: deployment.executor,
        data,
        gas: selected.economics.gasLimit,
        maxFeePerGas: selected.economics.maxFeePerGas,
        maxPriorityFeePerGas: 0n,
        nonce: latest,
      },
      assertStillAuthorized,
    )
    if (receipt.status !== 'success') {
      const gasSpentWei = receipt.gasUsed * receipt.effectiveGasPrice
      appendAudit('mutation_reverted', {
        lane,
        kind,
        authorizationId,
        hash,
        planHash: plan.planHash,
        gasSpentWei,
      })
      const result = {
        status: 'DUAL_BASE_EXECUTION_REVERTED_CONFIRMED',
        evidence: 'CANONICAL_REVERT_RECEIPT',
        hash,
        transaction: hash,
        baseAsset: candidate.baseAsset,
        routeLabel: candidate.routeLabel,
        gasSpentWei: gasSpentWei.toString(),
      }
      console.log(
        stringify({
          ...result,
          explorer: `${EXPLORER_TX}${hash}`,
          gasSpentEth: formatEther(gasSpentWei),
        }),
      )
      return result
    }
    const walletEthAfter = await publicClient.getBalance({ address: WALLET })
    const gasSpentWei = receipt.gasUsed * receipt.effectiveGasPrice
    if (walletEthBefore - walletEthAfter !== gasSpentWei) {
      const statePath = candidate.baseAsset === 'WETH' ? WETH_STATE_PATH : USDG_STATE_PATH
      const state = readJson(statePath)
      if (state) {
        state.status = 'halted_wallet_delta_mismatch'
        writeProtectedJson(statePath, state)
      }
      appendAudit('dual_wallet_delta_mismatch', {
        lane,
        kind,
        hash,
        walletEthBefore,
        walletEthAfter,
        receiptGasSpentWei: gasSpentWei,
      })
      throw new Error(
        'receipt succeeded but wallet ETH delta does not equal canonical gas; reconcile external wallet use',
      )
    }
    const record = await executionStateFromReceipt(plan, hash, receipt)
    console.log(
      stringify({
        status: 'DUAL_BASE_LIVE_EXECUTION_CONFIRMED',
        transaction: hash,
        explorer: `${EXPLORER_TX}${hash}`,
        baseAsset: record.baseAsset,
        route: record.routeLabel,
        amountIn: formatUnits(BigInt(record.amountInWei), record.decimals),
        grossProfit: formatUnits(BigInt(record.grossProfitWei), record.decimals),
        gasSpentEth: formatEther(BigInt(record.gasSpentWei)),
        normalizedNetProfitUsdg: formatUnits(BigInt(record.normalizedNetProfitUsdgWei), 6),
        evidence: record.evidence,
      }),
    )
    return record
  } finally {
    release()
  }
}

async function wethWithdrawalStateFromReceipt(plan, hash, receipt, reconciled = false) {
  const compiled = loadWethContractArtifact()
  const state = readJson(WETH_STATE_PATH)
  const deployment = await assertWethDeployment(state, compiled)
  if (receipt.status !== 'success') throw new Error('WETH withdrawal receipt failed')
  const withdrawn = decodeExecutorEvent(receipt, compiled, deployment.executor, 'Withdrawn')
  if (
    !withdrawn ||
    withdrawn.token.toLowerCase() !== GENERIC_WETH.toLowerCase() ||
    withdrawn.to.toLowerCase() !== WALLET.toLowerCase() ||
    BigInt(withdrawn.amount) !== BigInt(plan.amount)
  ) {
    throw new Error('WETH withdrawal event differs from the persisted plan')
  }
  const [executorAfter, walletAfter] = await Promise.all([
    publicClient.readContract({
      address: GENERIC_WETH,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [deployment.executor],
    }),
    publicClient.readContract({ address: GENERIC_WETH, abi: ERC20_ABI, functionName: 'balanceOf', args: [WALLET] }),
  ])
  if (executorAfter !== 0n || walletAfter !== BigInt(plan.walletBaseBefore) + BigInt(plan.amount)) {
    throw new Error('WETH withdrawal balances do not prove the planned effect')
  }
  const gasSpentWei = receipt.gasUsed * receipt.effectiveGasPrice
  const record = {
    hash,
    blockNumber: receipt.blockNumber.toString(),
    amountWei: String(plan.amount),
    gasSpentWei: gasSpentWei.toString(),
    executorWethAfterWei: executorAfter.toString(),
    walletWethAfterWei: walletAfter.toString(),
    reconciled,
    confirmedAt: new Date().toISOString(),
  }
  state.status = 'withdrawn'
  state.withdrawal = record
  writeProtectedJson(WETH_STATE_PATH, state)
  appendAudit('weth_withdrawal_complete', record)
  appendAudit('mutation_effect', {
    lane: 'weth-v1',
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

async function withdrawWethAll() {
  const release = acquireLock(WALLET_LOCK_PATH, 'dual-v3-wallet')
  try {
    assertLiveTransport(RUNTIME_CONFIG)
    assertDualWatcherInactive()
    assertLegacySignersInactive()
    const unresolved = latestUnresolved()
    if (unresolved) throw new Error(`unresolved ${unresolved.kind} mutation ${unresolved.hash}`)
    const compiled = loadWethContractArtifact()
    const state = readJson(WETH_STATE_PATH)
    const deployment = await assertWethDeployment(state, compiled)
    const [amount, walletBaseBefore, wallet] = await Promise.all([
      publicClient.readContract({
        address: GENERIC_WETH,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [deployment.executor],
      }),
      publicClient.readContract({ address: GENERIC_WETH, abi: ERC20_ABI, functionName: 'balanceOf', args: [WALLET] }),
      walletSnapshot(),
    ])
    if (amount === 0n) throw new Error('WETH executor has no principal to withdraw')
    if (wallet.nonceLatest !== wallet.noncePending) throw new Error('wallet has a pending nonce')
    const data = encodeFunctionData({
      abi: compiled.abi,
      functionName: 'withdraw',
      args: [GENERIC_WETH, amount, WALLET],
    })
    await publicClient.call({ account: WALLET, to: deployment.executor, data })
    const estimatedGas = await publicClient.estimateGas({ account: WALLET, to: deployment.executor, data })
    const { gasLimit, maxFeePerGas } = deploymentGasBounds(estimatedGas, wallet.gasPrice)
    const reserve = parseNonNegativeUnits(RUNTIME_CONFIG.genericMinEthReserve, 18, 'minimum ETH reserve')
    if (wallet.ethBalance < gasLimit * maxFeePerGas + reserve) {
      throw new Error('wallet cannot fund WETH withdrawal gas and the retained ETH reserve')
    }
    const plan = mutationPlan('weth-withdraw', 'weth-v1', {
      chainId: CHAIN_ID,
      wallet: WALLET,
      executor: deployment.executor,
      nonce: wallet.nonceLatest,
      to: deployment.executor,
      value: 0n,
      dataCommitment: keccak256(data),
      gasLimit,
      maxFeePerGas,
      maxPriorityFeePerGas: 0n,
      amount,
      walletBaseBefore,
    })
    const { hash, receipt } = await signBroadcastWait(plan, {
      chainId: CHAIN_ID,
      type: 'eip1559',
      to: deployment.executor,
      data,
      gas: gasLimit,
      maxFeePerGas,
      maxPriorityFeePerGas: 0n,
      nonce: wallet.nonceLatest,
    })
    if (receipt.status !== 'success') {
      const gasSpentWei = receipt.gasUsed * receipt.effectiveGasPrice
      appendAudit('mutation_reverted', { lane: 'weth-v1', kind: plan.kind, hash, planHash: plan.planHash, gasSpentWei })
      throw new Error(`WETH withdrawal reverted: ${hash}`)
    }
    const record = await wethWithdrawalStateFromReceipt(plan, hash, receipt)
    console.log(
      stringify({
        status: 'WETH_WITHDRAWAL_CONFIRMED',
        transaction: hash,
        explorer: `${EXPLORER_TX}${hash}`,
        amountWeth: formatUnits(BigInt(record.amountWei), 18),
        gasSpentEth: formatEther(BigInt(record.gasSpentWei)),
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
  assertLiveTransport(RUNTIME_CONFIG)
  assertDualWatcherInactive()
  assertLegacySignersInactive()
  const unresolvedBeforeLock = latestUnresolvedMutation(readAuditRecords())
  if (unresolvedBeforeLock?.kind === 'earnonhood-execute') {
    const result = await runEarnOnHoodChild('reconcile')
    console.log(stringify(result))
    return result
  }
  if (['global-deploy', 'global-execute'].includes(unresolvedBeforeLock?.kind)) {
    const result = await runChildScript('global-arb.mjs', 'reconcile')
    console.log(stringify(result))
    return result
  }
  const release = acquireLock(WALLET_LOCK_PATH, 'dual-v3-wallet')
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
    const supportedKinds = new Set(['weth-deploy', 'weth-execute', 'generic-execute', 'weth-withdraw'])
    if (!supportedKinds.has(mutation.kind)) {
      throw new Error(`unresolved ${mutation.kind} belongs to the legacy executor; use npm run generic:reconcile`)
    }
    const abandonExpired = process.argv.includes('--abandon-expired')
    const rebroadcastSameRaw = process.argv.includes('--rebroadcast-same-raw')
    if (abandonExpired && rebroadcastSameRaw) {
      throw new Error('choose either --abandon-expired or --rebroadcast-same-raw, never both')
    }
    const rawFile = path.resolve(mutation.rawPrivateRef || '')
    const signedRoot = `${path.resolve(SIGNED_TX_DIR)}${path.sep}`
    if (!rawFile.startsWith(signedRoot) || !fs.existsSync(rawFile)) {
      throw new Error('persisted raw is missing or misplaced')
    }
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
    appendAudit('dual_reconcile_observed', {
      kind: mutation.kind,
      hash: mutation.hash,
      outcome: outcome.state,
      sources: observations.map((item) => ({
        source: item.source,
        head: item.head,
        headTimestamp: item.headTimestamp,
        latestNonce: item.latestNonce,
        pendingNonce: item.pendingNonce,
        transactionSeen: Boolean(item.transaction),
        receiptStatus: item.receipt?.status || null,
        error: item.error || null,
      })),
    })
    if (outcome.state === 'CONFIRMED_SUCCESS') {
      let effect
      if (mutation.kind === 'weth-deploy') {
        effect = await wethDeploymentStateFromReceipt(
          plan,
          mutation.hash,
          outcome.receipt,
          loadWethContractArtifact(),
          true,
        )
      } else if (['weth-execute', 'generic-execute'].includes(mutation.kind)) {
        effect = await executionStateFromReceipt(plan, mutation.hash, outcome.receipt, true)
      } else {
        effect = await wethWithdrawalStateFromReceipt(plan, mutation.hash, outcome.receipt, true)
      }
      const result = { status: 'RECONCILED_SUCCESS', hash: mutation.hash, effect }
      console.log(stringify(result))
      return result
    }
    if (outcome.state === 'CONFIRMED_REVERTED') {
      const gasSpentWei = outcome.receipt.gasUsed * outcome.receipt.effectiveGasPrice
      appendAudit('mutation_reverted', {
        lane: plan.lane,
        kind: mutation.kind,
        authorizationId: plan.authorizationId || null,
        hash: mutation.hash,
        planHash: plan.planHash,
        gasSpentWei,
      })
      const result = { status: 'RECONCILED_REVERTED', hash: mutation.hash, gasSpentWei }
      console.log(stringify(result))
      return result
    }
    if (outcome.state === 'NOT_OBSERVED' && abandonExpired) {
      const abandonment = evaluateExpiredMutationAbandonment(plan, observations)
      if (!abandonment.allowed) throw new Error(`signed mutation cannot be abandoned: ${abandonment.reason}`)
      appendAudit('mutation_abandoned', {
        lane: plan.lane,
        kind: mutation.kind,
        authorizationId: plan.authorizationId || null,
        hash: mutation.hash,
        intentId: plan.intentId,
        planHash: plan.planHash,
        nonce: plan.nonce,
        deadline: plan.deadline,
        result: 'EXPIRED_NOT_OBSERVED',
      })
      const result = { status: 'RECONCILED_EXPIRED_NOT_OBSERVED', hash: mutation.hash }
      console.log(stringify(result))
      return result
    }
    if (outcome.state === 'NOT_OBSERVED' && rebroadcastSameRaw) {
      const replay = evaluateRawReplayDeadline(plan, observations)
      if (!replay.allowed) throw new Error(`persisted raw must not be rebroadcast: ${replay.reason}`)
      const results = await Promise.allSettled(
        [publicClient, ...(secondaryClient ? [secondaryClient] : [])].map(async (client) => {
          const acceptedHash = await client.sendRawTransaction({ serializedTransaction })
          if (acceptedHash.toLowerCase() !== mutation.hash.toLowerCase()) {
            throw new Error('rebroadcast endpoint returned a different transaction hash')
          }
          return acceptedHash
        }),
      )
      appendAudit('dual_same_raw_rebroadcast', {
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

async function screenedBoardCandidates(limit = 32) {
  const snapshot = await loadBoardSnapshot()
  let candidates = []
  try {
    candidates = buildDualBaseExecutionCandidates(snapshot, {
      maxAgeMs: RUNTIME_CONFIG.genericMaxQuoteAgeMs,
      limit,
    })
  } catch (error) {
    if (!/snapshot has no fresh typed dual-base screened-positive candidate/i.test(errorText(error))) throw error
  }
  return { snapshot, candidates }
}

function refreshDeploymentLedgers(deployments) {
  return {
    usdg: { ...deployments.usdg, state: readJson(USDG_STATE_PATH) },
    weth: { ...deployments.weth, state: readJson(WETH_STATE_PATH) },
    universal: { ...deployments.universal, state: readJson(UNIVERSAL_STATE_PATH) },
  }
}

async function armDualWatcher() {
  const releaseWatch = acquireLock(DUAL_WATCH_LOCK_PATH, 'dual-v3-watch')
  const releaseWallet = acquireLock(WALLET_LOCK_PATH, 'dual-v3-wallet')
  try {
    assertLiveTransport(RUNTIME_CONFIG)
    assertLegacySignersInactive()
    if (!RUNTIME_CONFIG.genericWatchUntilRevoked || RUNTIME_CONFIG.genericWatchAutoRenew) {
      throw new Error('dual watcher requires MANGA_GENERIC_WATCH_UNTIL_REVOKED=1 and auto-renew disabled')
    }
    if (
      RUNTIME_CONFIG.genericWatchMaxExecutions !== null ||
      RUNTIME_CONFIG.genericWatchMaxAttempts !== null ||
      RUNTIME_CONFIG.genericWatchMaxPreflights !== null
    ) {
      throw new Error('dual watcher requires execution, attempt, and exact-preflight count limits set to unlimited')
    }
    if (!RUNTIME_CONFIG.earnWatchEnabled) {
      throw new Error('unified dual watcher requires EARN_WATCH_ENABLED=1')
    }
    if (RUNTIME_CONFIG.earnWatchEventPollMs !== EARN_PUBLIC_RECOVERY_POLL_MS) {
      throw new Error(`unified dual watcher requires a ${EARN_PUBLIC_RECOVERY_POLL_MS}ms public Earn recovery poll`)
    }
    if (!RUNTIME_CONFIG.globalWatchEnabled) {
      throw new Error('unified watcher requires GLOBAL_WATCH_ENABLED=1')
    }
    const existing = readJson(DUAL_WATCH_ARM_PATH)
    if (existing?.status === 'ARMED' && !readDualRevocation(existing.authorizationId)) {
      throw new Error('an active dual watcher authorization already exists; disarm it before replacing it')
    }
    const unresolved = latestUnresolved()
    if (unresolved) throw new Error(`unresolved ${unresolved.kind} mutation ${unresolved.hash}`)
    assertDualBoardIdentity(await loadBoardSnapshot())
    const { deployments, wallet, usdgPrincipal, wethPrincipal } = await retryReadOnly(
      async () => {
        await assertCanonicalBase()
        const verifiedDeployments = await loadVerifiedDeployments()
        const walletReadback = await walletSnapshot()
        if (walletReadback.nonceLatest !== walletReadback.noncePending) {
          throw new Error('wallet has a pending nonce')
        }
        const [usdgBalance, wethBalance] = await Promise.all([
          publicClient.readContract({
            address: GENERIC_USDG,
            abi: ERC20_ABI,
            functionName: 'balanceOf',
            args: [verifiedDeployments.usdg.executor],
            blockNumber: walletReadback.blockNumber,
          }),
          publicClient.readContract({
            address: GENERIC_WETH,
            abi: ERC20_ABI,
            functionName: 'balanceOf',
            args: [verifiedDeployments.weth.executor],
            blockNumber: walletReadback.blockNumber,
          }),
        ])
        return {
          deployments: verifiedDeployments,
          wallet: walletReadback,
          usdgPrincipal: usdgBalance,
          wethPrincipal: wethBalance,
        }
      },
      {
        attempts: STARTUP_RPC_ATTEMPTS,
        delayMs: STARTUP_RPC_RETRY_DELAY_MS,
        shouldRetry: isTransientRpcError,
        onRetry: (error, attempt) => {
          appendAudit('dual_arm_rpc_retry', {
            attempt,
            retryDelayMs: STARTUP_RPC_RETRY_DELAY_MS * 2 ** (attempt - 1),
            reason: errorText(error),
          })
        },
      },
    )
    if (usdgPrincipal <= 0n || wethPrincipal <= 0n)
      throw new Error('both USDG and WETH executors require positive principal')
    const walletEthReserve = parseNonNegativeUnits(RUNTIME_CONFIG.genericMinEthReserve, 18, 'minimum ETH reserve')
    if (walletEthReserve <= 0n) throw new Error('dual watcher requires a positive wallet ETH reserve')
    if (wallet.ethBalance <= walletEthReserve) throw new Error('wallet ETH is at or below the authorized gas reserve')
    const minimumNetProfitUsdg = parseNonNegativeUnits(RUNTIME_CONFIG.genericMinNetUsdg, 6, 'minimum net USDG')
    const minimumScreenedNetProfitUsdg = minimumScreenedNetUsdg()
    validateDualProfitFloors(minimumScreenedNetProfitUsdg, minimumNetProfitUsdg)
    if (RUNTIME_CONFIG.maxFailedGasWei <= 0n) throw new Error('dual watcher requires a positive failed-Gas breaker')
    const historicalEarnGas = earnOnHoodGasSolvency(readAuditRecords(EARN_AUDIT_PATH))
    const earnMinimumNetProfitWei = parseNonNegativeUnits(
      RUNTIME_CONFIG.earnLiveMinNetWeth,
      18,
      'EarnOnHood minimum net WETH',
    )
    const earnMinimumHeadroomWei = parseNonNegativeUnits(
      RUNTIME_CONFIG.earnLiveMinHeadroomWeth,
      18,
      'EarnOnHood minimum quote headroom WETH',
    )
    const earnPerAttemptGasCeilingWei = parseNonNegativeUnits(
      RUNTIME_CONFIG.earnLiveMaxFailedGasWeth,
      18,
      'EarnOnHood per-attempt Gas ceiling',
    )
    const earnWalletReserveWei = parseNonNegativeUnits(
      RUNTIME_CONFIG.earnLiveWalletReserveWeth,
      18,
      'EarnOnHood wallet reserve',
    )
    if (
      historicalEarnGas.surplusWei <= 0n ||
      earnMinimumNetProfitWei <= 0n ||
      earnPerAttemptGasCeilingWei <= 0n ||
      historicalEarnGas.surplusWei <= 1n
    ) {
      throw new Error('EarnOnHood requires positive receipt-proven lifetime net and positive per-transaction economics')
    }
    // The arm is a local policy write, not a transaction. Validate the signer
    // only after every retryable chain read and every economic invariant has
    // converged, so transient RPC failures never load signing material.
    loadAccount()
    const issuedAt = new Date().toISOString()
    const authorization = {
      schemaVersion: 1,
      mode: 'AUTO_POLICY',
      policyVersion: DUAL_AUTHORIZATION_POLICY_VERSION,
      issuedAt,
      authorizationLifetime: DUAL_AUTHORIZATION_LIFETIME,
      principalPolicy: DUAL_PRINCIPAL_POLICY,
      chainId: CHAIN_ID,
      wallet: WALLET,
      usdgExecutor: deployments.usdg.executor,
      usdgSourceHash: deployments.usdg.state.sourceHash,
      usdgRuntimeCodeHash: deployments.usdg.state.runtimeCodeHash,
      usdgHardCapWei: deployments.usdg.amountCap.toString(),
      wethExecutor: deployments.weth.executor,
      wethSourceHash: deployments.weth.state.sourceHash,
      wethRuntimeCodeHash: deployments.weth.state.runtimeCodeHash,
      wethHardCapWei: deployments.weth.amountCap.toString(),
      minimumNetProfitUsdgWei: minimumNetProfitUsdg.toString(),
      minimumScreenedNetProfitUsdgWei: minimumScreenedNetProfitUsdg.toString(),
      profitRetentionBps: RUNTIME_CONFIG.genericProfitRetentionBps,
      walletEthReserveWei: walletEthReserve.toString(),
      maxFailedGasWei: RUNTIME_CONFIG.maxFailedGasWei.toString(),
      baselineNonce: wallet.nonceLatest,
      baselineUsdgExecutionCount: (deployments.usdg.state.executions || []).length,
      baselineWethExecutionCount: (deployments.weth.state.executions || []).length,
      usdgPrincipalWeiAtArm: usdgPrincipal.toString(),
      wethPrincipalWeiAtArm: wethPrincipal.toString(),
      pollIntervalMs: RUNTIME_CONFIG.genericWatchPollMs,
      idleRpcBehavior: 'LOOPBACK_BOARD_PLUS_MANAGED_EARN_WSS_WITH_PUBLIC_RECOVERY',
      escalationRpcBehavior: 'MANAGED_EXACT_PREFLIGHT_ONLY_AFTER_POSITIVE_SCREEN_THEN_ONE_SIGNATURE',
      rpcSource: RUNTIME_CONFIG.rpcSource,
      global: {
        enabled: true,
        lane: 'global-v1',
        executor: deployments.universal.executor,
        sourceHash: deployments.universal.state.sourceHash,
        runtimeCodeHash: deployments.universal.state.runtimeCodeHash,
        fundingPolicy: 'MORPHO_ZERO_FEE_FLASH_OR_PROTECTED_EXECUTOR_INVENTORY',
        universePolicy: GLOBAL_UNIVERSE_POLICY.version,
        settlementSeeds: globalSettlementSeeds(
          [GENERIC_USDG, GENERIC_WETH],
          RUNTIME_CONFIG.globalExtraSettlementAssets,
        ),
        settlementPolicy: GLOBAL_SETTLEMENT_ADMISSION_POLICY,
        maximumSettlementFundingChecksPerWake: GLOBAL_MAX_SETTLEMENT_FUNDING_CHECKS_PER_WAKE,
        maximumSettlementAssetsPerWake: GLOBAL_MAX_SETTLEMENT_ASSETS_PER_WAKE,
        graphPolicy: GLOBAL_GRAPH_POLICY.version,
        routePolicy: GLOBAL_ATOMIC_ROUTE_POLICY,
        routeWorksetPolicy: GLOBAL_ROUTE_WORKSET_POLICY,
        maximumRoutesPerWake: RUNTIME_CONFIG.globalMaxRoutesPerWake,
        maximumEventRoutesPerWake: GLOBAL_EVENT_MAX_ROUTES_PER_WAKE,
        quoteConcurrency: RUNTIME_CONFIG.globalQuoteConcurrency,
        managedMaximumCandidatesPerWake: GLOBAL_MAX_MANAGED_CANDIDATES_PER_WAKE,
        managedFallbackDailyLogicalCallCap: RUNTIME_CONFIG.globalManagedFallbackDailyLogicalCallCap,
        managedFallbackEventLogicalCallCap: GLOBAL_MANAGED_FALLBACK_EVENT_LOGICAL_CALL_CAP,
        managedFallbackRecoveryLogicalCallCap: GLOBAL_MANAGED_FALLBACK_RECOVERY_LOGICAL_CALL_CAP,
        feedPolicy: GLOBAL_FEED_MATCH_POLICY,
        submissionPolicy: 'DIRECT_SEQUENCER_THEN_SAME_RAW_MANAGED_FALLBACK',
        minimumNetProfitUsdgWei: minimumNetProfitUsdg.toString(),
        minimumWakeIntervalMs: RUNTIME_CONFIG.globalWatchMinIntervalMs,
        periodicMs: RUNTIME_CONFIG.globalWatchPeriodicMs,
      },
      earnOnHood: {
        enabled: true,
        lane: 'earnonhood-v2',
        principalPolicy: 'AVAILABLE_WALLET_BALANCE_MINUS_GAS_AND_RESERVE_NO_FIXED_CAP',
        routeCommitment: EARN_ROUTE_COMMITMENT,
        vault: EARN_VAULT,
        batchRouter: EARN_BATCH_ROUTER,
        poolScope: EARN_ROUTE_DISCOVERY_POLICY.poolScope,
        catalogSource: EARN_ROUTE_DISCOVERY_POLICY.catalogSource,
        factory: EARN_ROUTE_DISCOVERY_POLICY.factory,
        maximumHops: EARN_ROUTE_DISCOVERY_POLICY.maximumHops,
        minimumNetProfitWei: earnMinimumNetProfitWei.toString(),
        minimumQuoteHeadroomWei: earnMinimumHeadroomWei.toString(),
        walletReserveWei: earnWalletReserveWei.toString(),
        perAttemptGasCeilingWei: earnPerAttemptGasCeilingWei.toString(),
        initialGasSurplusWei: historicalEarnGas.surplusWei.toString(),
        eventPollMs: RUNTIME_CONFIG.earnWatchEventPollMs,
        periodicMs: RUNTIME_CONFIG.earnWatchPeriodicMs,
        sizingAlgorithm: EARN_SIZING_ALGORITHM,
        coarseProbePoints: RUNTIME_CONFIG.earnLiveCoarseProbePoints,
        refinementPoints: RUNTIME_CONFIG.earnLiveRefinementPoints,
        publicMaximumExactQuotesPerWake: maximumEarnPublicExactQuotes(RUNTIME_CONFIG.earnLiveRefinementPoints),
        managedMaximumExactQuotesPerWake: RUNTIME_CONFIG.earnLiveRefinementPoints + 3,
        discoveryRpc: EARN_DISCOVERY_RPC_POLICY,
        eventSource: EARN_EVENT_SOURCE_POLICY,
        managedFallbackDailyLogicalCallCap: RUNTIME_CONFIG.earnManagedFallbackDailyLogicalCallCap,
        managedFallbackEventLogicalCallCap: EARN_MANAGED_FALLBACK_EVENT_LOGICAL_CALL_CAP,
        managedFallbackRecoveryLogicalCallCap: EARN_MANAGED_FALLBACK_RECOVERY_LOGICAL_CALL_CAP,
        escalationRpc: 'MANGA_RPC_URL_ONLY_AFTER_PUBLIC_NET_POSITIVE',
      },
    }
    const arm = {
      ...authorization,
      authorizationId: dualAuthorizationId(authorization),
      status: 'ARMED',
      reason: 'user explicitly approved until-revoked unified dual-base and EarnOnHood live execution',
    }
    if (readDualRevocation(arm.authorizationId)) throw new Error('refusing to reuse a revoked dual authorization ID')
    writeProtectedJson(DUAL_WATCH_ARM_PATH, arm)
    writeProtectedJson(DUAL_WATCH_STATE_PATH, {
      schemaVersion: 1,
      status: 'ARMED_NOT_RUNNING',
      authorizationId: arm.authorizationId,
      wallet: WALLET,
      executors: { USDG: deployments.usdg.executor, WETH: deployments.weth.executor },
      updatedAt: issuedAt,
    })
    appendAudit('dual_watch_armed', {
      authorizationId: arm.authorizationId,
      authorizationLifetime: arm.authorizationLifetime,
      principalPolicy: arm.principalPolicy,
      usdgExecutor: arm.usdgExecutor,
      wethExecutor: arm.wethExecutor,
      usdgPrincipalWeiAtArm: arm.usdgPrincipalWeiAtArm,
      wethPrincipalWeiAtArm: arm.wethPrincipalWeiAtArm,
      minimumNetProfitUsdgWei: arm.minimumNetProfitUsdgWei,
      minimumScreenedNetProfitUsdgWei: arm.minimumScreenedNetProfitUsdgWei,
      earnOnHood: arm.earnOnHood,
      global: arm.global,
      maxConfirmedExecutions: null,
      maxAttempts: null,
      maxExactPreflights: null,
      maxFailedGasWei: arm.maxFailedGasWei,
      baselineNonce: arm.baselineNonce,
    })
    const output = {
      status: 'DUAL_WATCH_ARMED',
      authorizationId: arm.authorizationId,
      authorizationLifetime: arm.authorizationLifetime,
      principalPolicy: arm.principalPolicy,
      executors: { USDG: arm.usdgExecutor, WETH: arm.wethExecutor },
      universalExecutor: arm.global.executor,
      principal: {
        usdg: formatUnits(usdgPrincipal, 6),
        weth: formatUnits(wethPrincipal, 18),
      },
      hardCaps: {
        usdg: formatUnits(deployments.usdg.amountCap, 6),
        weth: formatUnits(deployments.weth.amountCap, 18),
      },
      minimumNetProfitUsdg: formatUnits(minimumNetProfitUsdg, 6),
      minimumScreenedNetProfitUsdg: formatUnits(minimumScreenedNetProfitUsdg, 6),
      countLimits: 'UNLIMITED',
      failedGasBreakerEth: formatEther(BigInt(arm.maxFailedGasWei)),
      idleRpcBehavior: arm.idleRpcBehavior,
      earnOnHood: {
        principalPolicy: arm.earnOnHood.principalPolicy,
        fixedPrincipalCap: null,
        catalogSource: arm.earnOnHood.catalogSource,
        poolScope: arm.earnOnHood.poolScope,
        maximumHops: arm.earnOnHood.maximumHops,
        initialGasSurplusEth: formatEther(BigInt(arm.earnOnHood.initialGasSurplusWei)),
        perAttemptGasCeilingEth: formatEther(BigInt(arm.earnOnHood.perAttemptGasCeilingWei)),
        sizingAlgorithm: arm.earnOnHood.sizingAlgorithm,
        publicMaximumExactQuotesPerWake: arm.earnOnHood.publicMaximumExactQuotesPerWake,
        managedMaximumExactQuotesPerWake: arm.earnOnHood.managedMaximumExactQuotesPerWake,
        periodicMs: arm.earnOnHood.periodicMs,
      },
      global: {
        executor: arm.global.executor,
        fundingPolicy: arm.global.fundingPolicy,
        universePolicy: arm.global.universePolicy,
        settlementPolicy: arm.global.settlementPolicy,
        settlementSeeds: arm.global.settlementSeeds,
        maximumSettlementAssetsPerWake: arm.global.maximumSettlementAssetsPerWake,
        feedPolicy: arm.global.feedPolicy,
        routeWorksetPolicy: arm.global.routeWorksetPolicy,
        submissionPolicy: arm.global.submissionPolicy,
        maximumEventRoutesPerWake: arm.global.maximumEventRoutesPerWake,
        managedFallbackDailyLogicalCallCap: arm.global.managedFallbackDailyLogicalCallCap,
        managedFallbackEventLogicalCallCap: arm.global.managedFallbackEventLogicalCallCap,
        managedFallbackRecoveryLogicalCallCap: arm.global.managedFallbackRecoveryLogicalCallCap,
        minimumWakeIntervalMs: arm.global.minimumWakeIntervalMs,
        periodicMs: arm.global.periodicMs,
      },
    }
    console.log(stringify(output))
    return arm
  } finally {
    releaseWallet()
    releaseWatch()
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function watcherUsageView(usage) {
  return {
    confirmedExecutions: usage.confirmedExecutions,
    confirmedByBase: {
      USDG: usage.usdgConfirmed,
      WETH: usage.wethConfirmed,
      EARN_ETH: usage.earnConfirmed,
      GLOBAL: usage.globalConfirmed,
    },
    revertedExecutions: usage.revertedExecutionCount,
    consumedNonces: usage.nonceConsumptions,
    signedAttempts: usage.signedAttempts,
    exactPreflights: usage.exactPreflights,
    failedGasEth: formatEther(usage.failedGasWei),
    earnLifetimeGasSurplusEth: formatEther(usage.earnGasSurplusWei),
    earnCurrentAuthorizationNetEth: formatEther(usage.earnRealizedNetProfitWei),
    earnCurrentAuthorizationFailedGasEth: formatEther(usage.earnFailedGasWei),
    globalCurrentAuthorizationNetUsdg: formatUnits(usage.globalRealizedNetProfitUsdgWei, 6),
  }
}

async function pollEarnOnHoodWake(cursor) {
  const head = await earnEventClient.getBlockNumber()
  if (cursor === null)
    return { cursor: head, event: false, head, scannedFrom: null, sourceReceivedAt: new Date().toISOString() }
  if (head <= cursor)
    return { cursor, event: false, head, scannedFrom: null, sourceReceivedAt: new Date().toISOString() }
  const scannedFrom = head - cursor > 200n ? head - 199n : cursor + 1n
  const logs = await earnEventClient.getLogs({
    address: EARN_VAULT,
    event: EARN_SWAP_ABI[0],
    fromBlock: scannedFrom,
    toBlock: head,
  })
  const routeLogs = logs.filter(isEarnOnHoodVaultSwap)
  const latestRouteLog = routeLogs.at(-1) || null
  const sourceReceivedAt = new Date().toISOString()
  return {
    cursor: head,
    event: routeLogs.length > 0,
    head,
    scannedFrom,
    skippedBlocks: scannedFrom > cursor + 1n ? scannedFrom - cursor - 1n : 0n,
    sourceReceivedAt,
    eventBlockNumber: latestRouteLog?.blockNumber ?? null,
    eventTransactionHash: latestRouteLog?.transactionHash ?? null,
    eventLogIndex: latestRouteLog?.logIndex ?? null,
    eventPool: latestRouteLog?.args?.pool ?? null,
    eventPools: [...new Set(routeLogs.map((log) => log.args?.pool).filter(Boolean))],
  }
}

function parseEarnChildOutput(stdout) {
  const output = stdout.trim()
  if (!output) throw new Error('EarnOnHood child returned no structured result')
  try {
    return JSON.parse(output)
  } catch {
    throw new Error('EarnOnHood child returned malformed structured output')
  }
}

async function runEarnOnHoodChild(command, extraEnvironment = {}, timeoutMs = 180_000) {
  const childEnvironment = { ...process.env, ...extraEnvironment }
  if (!extraEnvironment.EARN_SHARED_AUTHORIZATION_ID) delete childEnvironment.EARN_SHARED_AUTHORIZATION_ID
  if (!extraEnvironment.EARN_SHARED_WATCH_PID) delete childEnvironment.EARN_SHARED_WATCH_PID
  const result = await runBoundedProcess(
    process.execPath,
    [path.join(ROOT, 'scripts', 'earnonhood-live.mjs'), command],
    {
      cwd: ROOT,
      env: childEnvironment,
      timeoutMs,
      label: `EarnOnHood ${command} child`,
    },
  )
  return parseEarnChildOutput(result.stdout)
}

function runEarnOnHoodShared(arm, signal, wakeReason) {
  const eventPools = [...new Set([...(signal?.eventPools || []), signal?.eventPool].filter(Boolean))]
  return runEarnOnHoodChild(
    'execute',
    {
      EARN_LIVE_ARM: '1',
      EARN_SHARED_AUTHORIZATION_ID: arm.authorizationId,
      EARN_SHARED_WATCH_PID: String(process.pid),
      EARN_WAKE_RECEIVED_AT: signal?.sourceReceivedAt || '',
      EARN_WAKE_BLOCK_NUMBER: signal?.eventBlockNumber === null ? '' : String(signal?.eventBlockNumber || ''),
      EARN_WAKE_TRANSACTION_HASH: signal?.eventTransactionHash || '',
      EARN_WAKE_POOL: signal?.eventPool || '',
      EARN_WAKE_POOLS: eventPools.join(','),
      EARN_WAKE_REASON: wakeReason || '',
    },
    RUNTIME_CONFIG.earnWatchChildTimeoutMs,
  )
}

function runGlobalShared(arm, signal, wakeReason, scheduling = {}) {
  return runChildScript(
    'global-arb.mjs',
    'execute',
    {
      // Broad topology refresh is a separate signer-free slow lane. A live
      // child may consume the last atomic catalog snapshot but must never let
      // public factory fanout enter its 60-second execution deadline.
      GLOBAL_SEARCH_READONLY_CATALOG: '1',
      GLOBAL_SHARED_AUTHORIZATION_ID: arm.authorizationId,
      GLOBAL_SHARED_WATCH_PID: String(process.pid),
      GLOBAL_WAKE_RECEIVED_AT: signal?.receivedAt || signal?.sourceReceivedAt || '',
      GLOBAL_WAKE_SEQUENCE_NUMBER:
        signal?.firstSequenceNumber === null || signal?.firstSequenceNumber === undefined
          ? ''
          : String(signal.firstSequenceNumber),
      GLOBAL_WAKE_LAST_SEQUENCE_NUMBER:
        signal?.lastSequenceNumber === null || signal?.lastSequenceNumber === undefined
          ? ''
          : String(signal.lastSequenceNumber),
      GLOBAL_WAKE_ENQUEUED_AT:
        Number.isFinite(Number(scheduling.scheduledAt)) && Number(scheduling.scheduledAt) >= 0
          ? new Date(Number(scheduling.scheduledAt)).toISOString()
          : '',
      GLOBAL_WAKE_CLAIMED_AT:
        Number.isFinite(Number(scheduling.claimedAt)) && Number(scheduling.claimedAt) >= 0
          ? new Date(Number(scheduling.claimedAt)).toISOString()
          : '',
      GLOBAL_WAKE_ROUTE_ADDRESSES: (signal?.routeAddresses || []).join(','),
      GLOBAL_WAKE_CLASSIFICATION: signal?.classificationReason || '',
      GLOBAL_WAKE_SOURCE: signal?.wakeSource || '',
      GLOBAL_WAKE_SOURCES: (signal?.wakeSources || []).join(','),
      GLOBAL_WAKE_REASON: wakeReason || '',
    },
    RUNTIME_CONFIG.globalWatchChildTimeoutMs,
  )
}

function reconcileSharedMutation(arm, mutation) {
  if (mutation.kind === 'earnonhood-execute') {
    return runEarnOnHoodChild(
      'reconcile',
      {
        EARN_SHARED_AUTHORIZATION_ID: arm.authorizationId,
        EARN_SHARED_WATCH_PID: String(process.pid),
      },
      RUNTIME_CONFIG.earnWatchChildTimeoutMs,
    )
  }
  if (['global-deploy', 'global-execute'].includes(mutation.kind)) {
    return runChildScript(
      'global-arb.mjs',
      'reconcile',
      {
        GLOBAL_SHARED_AUTHORIZATION_ID: arm.authorizationId,
        GLOBAL_SHARED_WATCH_PID: String(process.pid),
      },
      RUNTIME_CONFIG.globalWatchChildTimeoutMs,
    )
  }
  return reconcile()
}

function globalFeedWatchPolicy() {
  const catalog = readJson(GLOBAL_CATALOG_PATH)
  const universe = readGlobalUniverseFile(GLOBAL_UNIVERSE_PATH)
  const currentProjection = universe.projection
  const policy = buildGlobalFeedWatchPolicy(
    {
      ...catalog,
      uniswap: {
        ...(catalog?.uniswap || {}),
        v4Pools: [...(catalog?.uniswap?.v4Pools || []), ...(currentProjection?.v4Pools || [])],
      },
    },
    {
      protocolAddresses: [EARN_VAULT, EARN_ROUTER, EARN_BATCH_ROUTER, POOL_MANAGER],
      earnProtocolAddresses: [EARN_VAULT, EARN_ROUTER, EARN_BATCH_ROUTER],
      settlementAddresses: globalSettlementSeeds(
        [GENERIC_USDG, GENERIC_WETH],
        RUNTIME_CONFIG.globalExtraSettlementAssets,
      ),
      ignoredAddresses: [MORPHO, V3_FACTORY],
    },
  )
  return {
    ...policy,
    universeStatus: universe.status,
    universeTopologyHash: currentProjection?.topologyHash || null,
  }
}

function applyGlobalFeedWatchPolicy(feed) {
  const policy = globalFeedWatchPolicy()
  feed.setWatchedAddresses(policy.watchedAddresses)
  feed.setMatchFilter((signal) => {
    const globalMatch = classifyGlobalFeedMatches(signal.matchedAddresses, policy)
    const earnMatch = classifyEarnFeedMatches(signal.matchedAddresses, policy)
    return globalMatch.actionable || earnMatch.actionable
  })
  return policy
}

async function runChildScript(script, command, extraEnvironment = {}, timeoutMs = 240_000) {
  const result = await runBoundedProcess(process.execPath, [path.join(ROOT, 'scripts', script), command], {
    cwd: ROOT,
    env: { ...process.env, ...extraEnvironment },
    timeoutMs,
    label: `global ${command} child`,
  })
  return parseEarnChildOutput(result.stdout)
}

async function executeGlobalWatcherWake({
  arm,
  watchState,
  deployments,
  wakeReason,
  signal,
  nextPeriodicAt,
  feed,
  scheduledAt,
  claimedAt,
  preparedSearchResult = null,
}) {
  appendAudit('global_watch_wake', {
    authorizationId: arm.authorizationId,
    wakeReason,
    sourceReceivedAt: signal?.receivedAt || null,
    feedSequenceNumber: signal?.firstSequenceNumber ?? null,
    matchedAddressCount: signal?.matchedAddresses?.length || 0,
    routeAddressCount: signal?.routeAddresses?.length || 0,
    classificationReason: signal?.classificationReason || null,
    coalescedWakeCount: signal?.coalescedWakeCount || 0,
  })
  let nextState = {
    ...watchState,
    status: 'EXECUTING',
    updatedAt: new Date().toISOString(),
    lastDecision: 'GLOBAL_EXACT_PREFLIGHT_RUNNING',
    global: {
      ...watchState.global,
      status: 'PREFLIGHT_RUNNING',
      lastWakeReason: wakeReason,
      lastWakeClassification: signal?.classificationReason || null,
      lastWakeRouteAddressCount: signal?.routeAddresses?.length || 0,
      coalescedFeedWakes: signal?.coalescedWakeCount || watchState.global?.coalescedFeedWakes || 0,
      lastPreflightAt: new Date().toISOString(),
      nextPeriodicAt: new Date(nextPeriodicAt).toISOString(),
      feed: feed.snapshot(),
    },
  }
  writeProtectedJson(DUAL_WATCH_STATE_PATH, nextState)
  const handoff = classifyGlobalSearchHandoff(preparedSearchResult)
  appendAudit('global_watch_exact_preflight_started', {
    authorizationId: arm.authorizationId,
    wakeReason,
    preflightSource:
      handoff.mode === 'REUSE_READ_ONLY_RESULT'
        ? 'RESIDENT_SIGNER_FREE_WORKER_REUSED'
        : handoff.mode === 'LIVE_REVALIDATION'
          ? 'RESIDENT_POSITIVE_THEN_BOUNDED_SIGNER_CHILD'
          : preparedSearchResult
            ? 'RESIDENT_INCOMPLETE_THEN_BOUNDED_SIGNER_CHILD'
            : 'BOUNDED_SIGNER_CHILD',
  })
  const preparedSnapshot = handoff.snapshot
  const result =
    handoff.mode === 'REUSE_READ_ONLY_RESULT'
      ? { status: preparedSnapshot.status, ...preparedSnapshot }
      : await runGlobalShared(arm, signal, wakeReason, { scheduledAt, claimedAt })
  const feedPolicy = applyGlobalFeedWatchPolicy(feed)
  const nextDeployments = refreshDeploymentLedgers(deployments)
  const usage = assertDualAuthorization(arm, nextDeployments)
  const confirmed = result.status === 'GLOBAL_LIVE_NET_PROFIT_CONFIRMED'
  const reverted = result.status === 'GLOBAL_EXECUTION_REVERTED_CONFIRMED'
  const budgetLimited = result.status === 'NO_SIGNATURE_RPC_BUDGET_EXHAUSTED'
  const fundingBlocked = result.status === 'NO_EXECUTABLE_FUNDING'
  const evaluationIncomplete = result.status === 'EVALUATION_INCOMPLETE_NO_SIGNATURE'
  const decisionClassification =
    result.decisionClassification || result.latestOpportunity?.decisionClassification || null
  const evidenceUnavailable = ['RPC_ERROR', 'STATE_UNAVAILABLE'].includes(decisionClassification)
  nextState = {
    ...nextState,
    status: 'RUNNING',
    updatedAt: new Date().toISOString(),
    usage: watcherUsageView(usage),
    consecutiveGlobalErrors: 0,
    lastDecision: confirmed
      ? 'GLOBAL_CONFIRMED_EXECUTION'
      : reverted
        ? 'GLOBAL_EXECUTION_REVERTED_CONTINUE'
        : budgetLimited
          ? 'GLOBAL_RPC_BUDGET_LIMITED_NO_SIGNATURE'
          : fundingBlocked
            ? 'GLOBAL_NO_EXECUTABLE_FUNDING'
            : evaluationIncomplete
              ? 'GLOBAL_EVALUATION_INCOMPLETE_NO_SIGNATURE'
              : evidenceUnavailable
                ? 'GLOBAL_EVIDENCE_UNAVAILABLE_NO_SIGNATURE'
                : 'GLOBAL_NO_NET_OPPORTUNITY',
    reason:
      budgetLimited || evidenceUnavailable || evaluationIncomplete
        ? result.reason ||
          result.evaluation?.exact?.samples?.[0]?.reason ||
          result.evaluation?.discovery?.samples?.[0]?.reason
        : null,
    lastTransaction: confirmed || reverted ? result.transaction : nextState.lastTransaction,
    lastExecutionBaseAsset: confirmed ? 'GLOBAL' : nextState.lastExecutionBaseAsset,
    global: {
      ...nextState.global,
      status: budgetLimited || evaluationIncomplete || evidenceUnavailable ? 'DEGRADED_EVIDENCE' : 'WATCHING',
      lastResult: result.status,
      lastTransaction: result.transaction || nextState.global.lastTransaction,
      lastNormalizedNetProfitUsdg: result.normalizedNetProfitUsdg || null,
      graph: result.graph || result.latestOpportunity?.graph || nextState.global.graph || null,
      rpc: result.rpc || result.latestOpportunity?.rpc || null,
      wake: result.wake || result.latestOpportunity?.wake || null,
      workset: result.workset || result.latestOpportunity?.workset || null,
      timing: result.timing || result.latestOpportunity?.timing || null,
      lifecycle: result.lifecycle || result.latestOpportunity?.lifecycle || null,
      evaluation: result.evaluation || result.latestOpportunity?.evaluation || null,
      decisionClassification,
      evidenceCoverage: result.evidenceCoverage || result.latestOpportunity?.evidenceCoverage || null,
      feed: feed.snapshot(),
    },
  }
  writeProtectedJson(DUAL_WATCH_STATE_PATH, nextState)
  appendAudit('global_watch_result', {
    authorizationId: arm.authorizationId,
    wakeReason,
    status: result.status,
    transaction: result.transaction || null,
    normalizedNetProfitUsdg: result.normalizedNetProfitUsdg || null,
    evaluated: result.evaluated ?? null,
    grossPositive: result.grossPositive ?? null,
    exactNetPositive: result.exactNetPositive ?? null,
    decisionClassification: result.decisionClassification || null,
    evidenceCoverage: result.evidenceCoverage || null,
    lifecycle: result.lifecycle || null,
    workset: result.workset || null,
    timing: result.timing || null,
  })
  return { watchState: nextState, deployments: nextDeployments, feedPolicy }
}

async function executeEarnWatcherWake({
  arm,
  watchState,
  deployments,
  wakeReason,
  signal,
  eventCursor,
  nextPeriodicAt,
}) {
  appendAudit('earn_watch_wake', {
    authorizationId: arm.authorizationId,
    wakeReason,
    publicEventCursor: eventCursor,
    sourceReceivedAt: signal?.sourceReceivedAt || null,
    eventBlockNumber: signal?.eventBlockNumber ?? null,
    eventTransactionHash: signal?.eventTransactionHash || null,
    eventLogIndex: signal?.eventLogIndex ?? null,
    eventPool: signal?.eventPool || null,
    eventPools: signal?.eventPools || (signal?.eventPool ? [signal.eventPool] : []),
    feedSequenceNumber: signal?.firstSequenceNumber ?? null,
    classificationReason: signal?.classificationReason || null,
  })
  let nextState = {
    ...watchState,
    status: 'EXECUTING',
    updatedAt: new Date().toISOString(),
    lastDecision: 'EARN_PUBLIC_NET_PREFLIGHT_RUNNING',
    earnOnHood: {
      ...watchState.earnOnHood,
      status: 'PREFLIGHT_RUNNING',
      lastWakeReason: wakeReason,
      lastPreflightAt: new Date().toISOString(),
      nextPeriodicAt: new Date(nextPeriodicAt).toISOString(),
    },
  }
  writeProtectedJson(DUAL_WATCH_STATE_PATH, nextState)
  const earnResult = await runEarnOnHoodShared(arm, signal, wakeReason)
  const nextDeployments = refreshDeploymentLedgers(deployments)
  const earnUsage = assertDualAuthorization(arm, nextDeployments)
  const confirmed = earnResult.status === 'CONFIRMED_NET_PROFIT'
  const reverted = earnResult.status === 'CONFIRMED_REVERTED'
  const activeRouteQuarantine = earnOnHoodRouteQuarantine(readAuditRecords())
  const lastQuarantinedRoute =
    activeRouteQuarantine.reduce((latest, entry) => {
      if (!latest) return entry
      return Date.parse(String(entry.revertedAt || '')) > Date.parse(String(latest.revertedAt || '')) ? entry : latest
    }, null) || null
  nextState = {
    ...nextState,
    status: 'RUNNING',
    updatedAt: new Date().toISOString(),
    usage: watcherUsageView(earnUsage),
    consecutiveEarnErrors: 0,
    lastDecision: confirmed
      ? 'EARN_CONFIRMED_EXECUTION'
      : reverted
        ? 'EARN_EXECUTION_REVERTED_CONTINUE'
        : 'EARN_NO_NET_OPPORTUNITY',
    reason: null,
    lastTransaction: confirmed || reverted ? earnResult.transaction : nextState.lastTransaction,
    lastExecutionBaseAsset: confirmed ? 'EARN_ETH' : nextState.lastExecutionBaseAsset,
    earnOnHood: {
      ...nextState.earnOnHood,
      status: 'WATCHING',
      lastResult: earnResult.status,
      lastTransaction: earnResult.transaction || nextState.earnOnHood.lastTransaction,
      lastRouteId: earnResult.routeId || nextState.earnOnHood.lastRouteId || null,
      lastRoutePools: earnResult.pools || nextState.earnOnHood.lastRoutePools || [],
      routeQuarantine: reverted
        ? {
            routeId: earnResult.routeId || null,
            pools: earnResult.pools || [],
            receiptBlockNumber: earnResult.blockNumber ?? null,
            reason: 'CANONICAL_REVERT_AWAITING_RELEVANT_POOL_CHANGE',
          }
        : lastQuarantinedRoute
          ? {
              routeId: lastQuarantinedRoute.routeId,
              pools: lastQuarantinedRoute.pools,
              receiptBlockNumber: lastQuarantinedRoute.blockNumber,
              reason: 'CANONICAL_REVERT_AWAITING_RELEVANT_POOL_CHANGE',
            }
          : null,
      quarantinedRouteCount: activeRouteQuarantine.length,
      lastRealizedNetProfitEth: earnResult.realizedNetProfitEth || null,
      lastDynamicMaximumPrincipalEth: earnResult.dynamicMaximumPrincipalEth || null,
      lastQuotedNetAtGasCapEth: earnResult.quotedNetAtGasCapEth || earnResult.bestQuotedNetAtGasCapEth || null,
      lastReasons: earnResult.reasons || [],
      rpc: earnResult.rpc || nextState.earnOnHood.rpc || null,
    },
  }
  writeProtectedJson(DUAL_WATCH_STATE_PATH, nextState)
  appendAudit('earn_watch_result', {
    authorizationId: arm.authorizationId,
    wakeReason,
    status: earnResult.status,
    transaction: earnResult.transaction || null,
    realizedNetProfitEth: earnResult.realizedNetProfitEth || null,
    routeId: earnResult.routeId || null,
    pools: earnResult.pools || [],
    blockNumber: earnResult.blockNumber ?? null,
    gasSpentEth: earnResult.gasSpentEth || null,
  })
  return { watchState: nextState, deployments: nextDeployments }
}

async function watchDual() {
  const release = acquireLock(DUAL_WATCH_LOCK_PATH, 'dual-v3-watch')
  let stopRequested = false
  let stopRecorded = false
  let watchState = null
  let startupRpcRetries = 0
  let sequencerFeed = null
  let managedEarnEventSource = null
  let globalSearchWorker = null
  const persistStopRequested = () => {
    if (!watchState) return
    watchState = { ...watchState, status: 'STOPPED_BY_SIGNAL', updatedAt: new Date().toISOString() }
    writeProtectedJson(DUAL_WATCH_STATE_PATH, watchState)
    if (!stopRecorded) {
      appendAudit('dual_watch_stopped_signal', { authorizationId: watchState.authorizationId })
      stopRecorded = true
    }
  }
  const requestStop = () => {
    stopRequested = true
    // A bounded child may still be finishing when systemd asks us to stop.
    // Persist the maintenance state synchronously so the health timer does not
    // mistake an intentional release switch for an unexplained outage.
    persistStopRequested()
  }
  process.once('SIGTERM', requestStop)
  process.once('SIGINT', requestStop)
  try {
    assertLegacySignersInactive()
    const arm = readJson(DUAL_WATCH_ARM_PATH)
    if (!arm || arm.status !== 'ARMED') {
      const error = new Error('dual watcher is not armed')
      error.watchPolicyStop = true
      throw error
    }
    if (readDualRevocation(arm.authorizationId)) {
      const error = new Error('dual watcher authorization was disarmed')
      error.watchPolicyStop = true
      throw error
    }
    assertLiveTransport(RUNTIME_CONFIG, { requireWss: true })
    const startup = await retryReadOnly(
      async () => {
        await assertCanonicalBase()
        const deployments = await loadVerifiedDeployments()
        const usage = assertDualAuthorization(arm, deployments)
        const wallet = await walletSnapshot()
        const [usdgPrincipal, wethPrincipal] = await Promise.all([
          publicClient.readContract({
            address: GENERIC_USDG,
            abi: ERC20_ABI,
            functionName: 'balanceOf',
            args: [deployments.usdg.executor],
          }),
          publicClient.readContract({
            address: GENERIC_WETH,
            abi: ERC20_ABI,
            functionName: 'balanceOf',
            args: [deployments.weth.executor],
          }),
        ])
        const nonceState = evaluateDualWalletNonce(arm, usage, wallet, latestUnresolved())
        const spendableUsdg = dualSpendablePrincipal(arm, deployments.usdg.state, 'USDG')
        const spendableWeth = dualSpendablePrincipal(arm, deployments.weth.state, 'WETH')
        if (!nonceState.allowed || usdgPrincipal < spendableUsdg || wethPrincipal < spendableWeth) {
          throw new Error(
            `dual watcher startup state mismatch: nonce=${wallet.nonceLatest}/${wallet.noncePending}/${nonceState.expectedNonce}/${nonceState.reason || nonceState.state}, USDG=${usdgPrincipal}/${spendableUsdg}, WETH=${wethPrincipal}/${spendableWeth}`,
          )
        }
        return { deployments, usage, wallet }
      },
      {
        attempts: STARTUP_RPC_ATTEMPTS,
        delayMs: STARTUP_RPC_RETRY_DELAY_MS,
        shouldRetry: (error) => !stopRequested && isTransientRpcError(error),
        onRetry: (error, attempt) => {
          startupRpcRetries = attempt
          const retryDelayMs = STARTUP_RPC_RETRY_DELAY_MS * 2 ** (attempt - 1)
          const updatedAt = new Date().toISOString()
          watchState = {
            schemaVersion: 1,
            status: 'DEGRADED_STARTUP_RPC',
            pid: process.pid,
            wallet: WALLET,
            authorizationId: arm.authorizationId,
            startedAt: null,
            updatedAt,
            startupRpcRetries,
            nextStartupRetryDelayMs: retryDelayMs,
            reason: errorText(error),
          }
          writeProtectedJson(DUAL_WATCH_STATE_PATH, watchState)
          appendAudit('dual_watch_startup_rpc_retry', {
            authorizationId: arm.authorizationId,
            attempt,
            retryDelayMs,
            reason: errorText(error),
          })
          console.log(
            stringify({
              status: 'DUAL_WATCH_STARTUP_RPC_RETRY',
              authorizationId: arm.authorizationId,
              attempt,
              retryDelayMs,
              reason: errorText(error),
            }),
          )
        },
      },
    )
    let { deployments } = startup
    const { usage } = startup
    // The private credential is not loaded until all retryable public-chain
    // identity, deployment, balance and nonce reads have converged.
    loadAccount()
    const startedAt = new Date().toISOString()
    const strategyScheduler = new ProtectedStrategyScheduler({
      startedAt: Date.parse(startedAt),
      lanes: [
        { id: 'EARN', periodMs: RUNTIME_CONFIG.earnWatchPeriodicMs, minimumIntervalMs: 0 },
        {
          id: 'GLOBAL',
          periodMs: RUNTIME_CONFIG.globalWatchPeriodicMs,
          minimumIntervalMs: RUNTIME_CONFIG.globalWatchMinIntervalMs,
        },
      ],
    })
    watchState = {
      schemaVersion: 1,
      status: 'RUNNING',
      pid: process.pid,
      authorizationId: arm.authorizationId,
      wallet: WALLET,
      executors: {
        USDG: deployments.usdg.executor,
        WETH: deployments.weth.executor,
        UNIVERSAL: deployments.universal.executor,
      },
      startedAt,
      updatedAt: startedAt,
      triggerMode: 'ONE_SUPERVISOR_ROUTES_LOOPBACK_EVENTS_AND_ORDERED_FEED_TO_TYPED_ADAPTERS',
      idleRpcBehavior: 'LOOPBACK_BOARD_PLUS_MANAGED_EARN_WSS_PLUS_PUBLIC_RECOVERY_PLUS_SHARED_ORDERED_FEED',
      pollIntervalMs: RUNTIME_CONFIG.genericWatchPollMs,
      authorizationLifetime: arm.authorizationLifetime,
      principalPolicy: arm.principalPolicy,
      usage: watcherUsageView(usage),
      startupRpcRetries,
      nextStartupRetryDelayMs: null,
      consecutiveBoardErrors: 0,
      consecutiveExecutionRpcErrors: 0,
      consecutiveEarnErrors: 0,
      consecutiveGlobalErrors: 0,
      processedBoardGenerations: 0,
      screenedPositiveBoardGenerations: 0,
      lastBoardGeneratedAt: null,
      lastBoardCandidateCount: 0,
      lastDecision: 'STARTING',
      strategyScheduler: strategyScheduler.snapshot(),
      earnOnHood: {
        status: 'STARTING',
        triggerMode: 'MANAGED_WSS_OR_FILTERED_ORDERED_FEED_OR_PUBLIC_RECOVERY_OR_PERIODIC_RECOVERY',
        principalPolicy: arm.earnOnHood.principalPolicy,
        fixedPrincipalCap: null,
        routeCommitment: arm.earnOnHood.routeCommitment,
        publicEventCursor: String(startup.wallet.blockNumber),
        eventSource: null,
        nextPeriodicAt: new Date(strategyScheduler.laneSnapshot('EARN').nextPeriodicAt).toISOString(),
        lastWakeReason: null,
        lastPreflightAt: null,
        lastResult: null,
        lastTransaction: null,
      },
      global: {
        status: 'STARTING',
        triggerMode: 'RESIDENT_SIGNER_FREE_EVENT_SEARCH_OR_PERIODIC_RECOVERY_THEN_SINGLE_SIGNER_REVALIDATION',
        executor: arm.global.executor,
        fundingPolicy: arm.global.fundingPolicy,
        settlementPolicy: arm.global.settlementPolicy,
        settlementSeeds: arm.global.settlementSeeds,
        nextPeriodicAt: new Date(strategyScheduler.laneSnapshot('GLOBAL').nextPeriodicAt).toISOString(),
        lastWakeReason: null,
        lastPreflightAt: null,
        lastResult: null,
        lastTransaction: null,
        rpc: null,
        feed: null,
        searchWorker: null,
      },
    }
    writeProtectedJson(DUAL_WATCH_STATE_PATH, watchState)
    appendAudit('dual_watch_started', {
      authorizationId: arm.authorizationId,
      pid: process.pid,
      baselineNonce: arm.baselineNonce,
      triggerMode: watchState.triggerMode,
      idleRpcBehavior: watchState.idleRpcBehavior,
    })
    console.log(
      stringify({
        status: 'DUAL_WATCH_RUNNING',
        authorizationId: arm.authorizationId,
        pid: process.pid,
        executors: watchState.executors,
        authorizationLifetime: arm.authorizationLifetime,
        idleRpcBehavior: watchState.idleRpcBehavior,
      }),
    )

    let lastGeneration = null
    let attemptedHashes = new Set()
    let earnEventCursor = startup.wallet.blockNumber
    let lastEarnEventPollAt = 0
    let managedEarnStartFailures = 0
    let managedEarnNextRetryAt = 0
    const readyGlobalSearchResults = new Map()
    const enqueueEarnMarketWake = (wakeReason, signal) => {
      strategyScheduler.enqueueEvent('EARN', {
        reason: wakeReason,
        signal,
        priority: wakeReason === 'FILTERED_SEQUENCER_FEED' ? 100 : wakeReason === 'MANAGED_WSS_EARN_SWAP' ? 90 : 50,
      })
    }
    const enqueueLegacyGlobalFeedWake = (signal, reason = 'FILTERED_SEQUENCER_FEED') => {
      strategyScheduler.enqueueEvent('GLOBAL', {
        reason,
        signal: { ...signal, requiresLegacyGlobalSearch: true },
        priority: 75,
      })
    }
    globalSearchWorker = new ResidentGlobalSearchClient({
      scriptPath: path.join(ROOT, 'scripts', 'global-search-worker.mjs'),
      cwd: ROOT,
      environment: process.env,
      timeoutMs: RUNTIME_CONFIG.globalWatchChildTimeoutMs,
      onResult: ({ requestId, signal, result, durationMs, superseded }) => {
        const snapshot = result?.snapshot || null
        const positive = snapshot?.status === 'EXACT_NET_POSITIVE'
        appendAudit('global_search_worker_result', {
          authorizationId: arm.authorizationId,
          requestId,
          status: snapshot?.status || result?.status || 'UNKNOWN',
          decisionClassification: snapshot?.decisionClassification || null,
          evidenceCoverage: snapshot?.evidenceCoverage || null,
          durationMs,
          superseded,
          selected: positive,
          lifecycle: snapshot?.lifecycle || null,
          workset: snapshot?.workset || null,
        })
        if (superseded && !positive) return
        readyGlobalSearchResults.set(requestId, result)
        while (readyGlobalSearchResults.size > 16) {
          readyGlobalSearchResults.delete(readyGlobalSearchResults.keys().next().value)
        }
        strategyScheduler.enqueueEvent('GLOBAL', {
          reason: positive ? 'RESIDENT_GLOBAL_SEARCH_POSITIVE' : 'RESIDENT_GLOBAL_SEARCH_RESULT',
          signal: { ...signal, searchResultId: requestId, searchResultIds: [requestId] },
          priority: positive ? 85 : 75,
        })
      },
      onFailure: ({ signal, reason }) => {
        appendAudit('global_search_worker_degraded', {
          authorizationId: arm.authorizationId,
          reason,
          fallback: 'BOUNDED_GLOBAL_CHILD',
        })
        enqueueLegacyGlobalFeedWake(signal, 'RESIDENT_GLOBAL_SEARCH_FALLBACK')
      },
    })
    if (!globalSearchWorker.start()) {
      appendAudit('global_search_worker_degraded', {
        authorizationId: arm.authorizationId,
        reason: globalSearchWorker.snapshot().lastError,
        fallback: 'BOUNDED_GLOBAL_CHILD',
      })
    }
    const enqueueGlobalFeedWake = (signal) => {
      if (!globalSearchWorker.enqueue(signal)) enqueueLegacyGlobalFeedWake(signal)
    }
    let activeGlobalFeedPolicy = globalFeedWatchPolicy()
    managedEarnEventSource = new ManagedEarnEventSource({
      client: managedEarnEventClient,
      chainId: CHAIN_ID,
      address: EARN_VAULT,
      event: EARN_SWAP_ABI[0],
      eventFilter: isEarnOnHoodVaultSwap,
      errorText,
      onWake: (signal) => {
        if (signal.eventBlockNumber !== null && signal.eventBlockNumber !== undefined) {
          const eventBlockNumber = BigInt(signal.eventBlockNumber)
          if (eventBlockNumber > earnEventCursor) earnEventCursor = eventBlockNumber
        }
        enqueueEarnMarketWake('MANAGED_WSS_EARN_SWAP', signal)
        const globalWake = buildGlobalWakeFromEarnEvent(signal, { wakeSource: 'MANAGED_WSS_EARN_SWAP' })
        if (globalWake) enqueueGlobalFeedWake(globalWake)
      },
      onState: (eventSource) => {
        if (!watchState) return
        watchState = {
          ...watchState,
          updatedAt: new Date().toISOString(),
          earnOnHood: { ...watchState.earnOnHood, eventSource },
        }
        writeProtectedJson(DUAL_WATCH_STATE_PATH, watchState)
      },
    })
    const recordManagedEarnRetry = (error) => {
      managedEarnStartFailures += 1
      const retryAfterMs = managedEarnReconnectDelayMs(managedEarnStartFailures)
      managedEarnNextRetryAt = Date.now() + retryAfterMs
      watchState = {
        ...watchState,
        updatedAt: new Date().toISOString(),
        earnOnHood: {
          ...watchState.earnOnHood,
          eventSourceRetry: {
            policy: MANAGED_EARN_RECONNECT_POLICY.version,
            consecutiveFailures: managedEarnStartFailures,
            retryAfterMs,
            nextRetryAt: new Date(managedEarnNextRetryAt).toISOString(),
          },
        },
      }
      writeProtectedJson(DUAL_WATCH_STATE_PATH, watchState)
      appendAudit('earn_managed_wss_degraded', {
        authorizationId: arm.authorizationId,
        reason: errorText(error),
        reconnectPolicy: MANAGED_EARN_RECONNECT_POLICY.version,
        consecutiveFailures: managedEarnStartFailures,
        retryAfterMs,
      })
    }
    const recordManagedEarnRecovered = () => {
      managedEarnStartFailures = 0
      managedEarnNextRetryAt = 0
      watchState = {
        ...watchState,
        updatedAt: new Date().toISOString(),
        earnOnHood: {
          ...watchState.earnOnHood,
          eventSourceRetry: {
            policy: MANAGED_EARN_RECONNECT_POLICY.version,
            consecutiveFailures: 0,
            retryAfterMs: null,
            nextRetryAt: null,
          },
        },
      }
      writeProtectedJson(DUAL_WATCH_STATE_PATH, watchState)
    }
    try {
      await managedEarnEventSource.start()
      recordManagedEarnRecovered()
      appendAudit('earn_managed_wss_subscribed', {
        authorizationId: arm.authorizationId,
        policy: EARN_EVENT_SOURCE_POLICY,
      })
    } catch (error) {
      recordManagedEarnRetry(error)
    }
    let reconciliationTask = null
    let reconciliationHash = null
    let reconciliationAttempts = 0
    let reconciliationLastResult = null
    let reconciliationNextAttemptAt = 0
    let signingPauseStartedAt = null
    sequencerFeed = new SequencerFeedWakeClient({
      requestedSequenceNumber: startup.wallet.blockNumber,
      watchedAddresses: activeGlobalFeedPolicy.watchedAddresses,
      minimumAddressMatches: 1,
      matchFilter: (signal) => {
        const globalMatch = classifyGlobalFeedMatches(signal.matchedAddresses, activeGlobalFeedPolicy)
        const earnMatch = classifyEarnFeedMatches(signal.matchedAddresses, activeGlobalFeedPolicy)
        return globalMatch.actionable || earnMatch.actionable
      },
      onWake: (signal) => {
        const globalClassification = classifyGlobalFeedMatches(signal.matchedAddresses, activeGlobalFeedPolicy)
        const earnClassification = classifyEarnFeedMatches(signal.matchedAddresses, activeGlobalFeedPolicy)
        if (earnClassification.actionable) {
          enqueueEarnMarketWake('FILTERED_SEQUENCER_FEED', {
            ...signal,
            sourceReceivedAt: signal.receivedAt,
            eventPool: earnClassification.matchedPoolAddresses[0] || null,
            eventPools: earnClassification.matchedPoolAddresses,
            routeAddresses: earnClassification.routeAddresses,
            classificationReason: earnClassification.reason,
          })
        }
        if (globalClassification.actionable) {
          enqueueGlobalFeedWake({
            ...signal,
            wakeSource: 'SEQUENCER_FEED',
            wakeSources: ['SEQUENCER_FEED'],
            routeAddresses: globalClassification.routeAddresses,
            classificationReason: globalClassification.reason,
          })
        }
      },
    })
    sequencerFeed.start()
    while (!stopRequested) {
      const loopStartedAt = Date.now()
      let phase = 'BOARD'
      try {
        const currentArm = readJson(DUAL_WATCH_ARM_PATH)
        deployments = refreshDeploymentLedgers(deployments)
        const currentUsage = assertDualAuthorization(currentArm, deployments)
        watchState = {
          ...watchState,
          global: { ...watchState.global, searchWorker: globalSearchWorker?.snapshot() || null },
        }
        const unresolvedNow = latestUnresolved()
        if (unresolvedNow) {
          const now = Date.now()
          if (reconciliationHash !== unresolvedNow.hash) {
            reconciliationHash = unresolvedNow.hash
            reconciliationAttempts = 0
            reconciliationLastResult = null
            reconciliationNextAttemptAt = 0
            signingPauseStartedAt = new Date().toISOString()
            appendAudit('dual_watch_signing_quarantined', {
              authorizationId: currentArm.authorizationId,
              kind: unresolvedNow.kind,
              hash: unresolvedNow.hash,
              scope: 'SHARED_WALLET_NONCE_DOMAIN',
              discoveryContinues: true,
            })
          }
          if (!reconciliationTask && now >= reconciliationNextAttemptAt) {
            reconciliationAttempts += 1
            const attempt = reconciliationAttempts
            const attemptedHash = unresolvedNow.hash
            const attemptedKind = unresolvedNow.kind
            reconciliationTask = reconcileSharedMutation(currentArm, unresolvedNow)
              .then((result) => {
                reconciliationLastResult = {
                  attempt,
                  status: result?.status || 'UNKNOWN_RESULT',
                  completedAt: new Date().toISOString(),
                  error: null,
                }
              })
              .catch((error) => {
                reconciliationLastResult = {
                  attempt,
                  status: 'RECONCILE_RETRY_SCHEDULED',
                  completedAt: new Date().toISOString(),
                  error: errorText(error),
                }
                appendAudit('dual_watch_reconcile_retry_scheduled', {
                  authorizationId: currentArm.authorizationId,
                  kind: attemptedKind,
                  hash: attemptedHash,
                  attempt,
                  reason: errorText(error),
                })
              })
              .finally(() => {
                reconciliationNextAttemptAt = Date.now() + UNKNOWN_RECONCILE_RETRY_MS
                reconciliationTask = null
              })
          }

          if (Date.now() - lastEarnEventPollAt >= RUNTIME_CONFIG.earnWatchEventPollMs) {
            lastEarnEventPollAt = Date.now()
            try {
              const wake = await pollEarnOnHoodWake(earnEventCursor)
              earnEventCursor = wake.cursor
              if (wake.event) {
                enqueueEarnMarketWake('REVIEWED_POOL_SWAP_EVENT', wake)
                const globalWake = buildGlobalWakeFromEarnEvent(wake, { wakeSource: 'PUBLIC_EARN_LOG_BACKSTOP' })
                if (globalWake) enqueueGlobalFeedWake(globalWake)
              }
              watchState = {
                ...watchState,
                earnOnHood: {
                  ...watchState.earnOnHood,
                  status: 'WATCHING_SIGNING_PAUSED',
                  publicEventCursor: String(wake.cursor),
                  lastEventPollAt: new Date().toISOString(),
                  skippedBlocks: String(wake.skippedBlocks || 0n),
                  eventError: null,
                },
              }
            } catch (error) {
              watchState = {
                ...watchState,
                earnOnHood: {
                  ...watchState.earnOnHood,
                  status: 'DEGRADED_PUBLIC_EVENT_RPC',
                  lastEventPollAt: new Date().toISOString(),
                  eventError: errorText(error),
                },
              }
            }
          }

          try {
            const board = await screenedBoardCandidates(32)
            if (board.snapshot?.generatedAt && Number.isFinite(Date.parse(board.snapshot.generatedAt))) {
              if (board.snapshot.generatedAt !== lastGeneration) {
                lastGeneration = board.snapshot.generatedAt
                attemptedHashes = new Set()
                watchState = {
                  ...watchState,
                  processedBoardGenerations: watchState.processedBoardGenerations + 1,
                  screenedPositiveBoardGenerations:
                    watchState.screenedPositiveBoardGenerations + (board.candidates.length > 0 ? 1 : 0),
                  lastBoardGeneratedAt: lastGeneration,
                  lastBoardCandidateCount: board.candidates.length,
                }
              }
            }
          } catch (error) {
            watchState = {
              ...watchState,
              consecutiveBoardErrors: Number(watchState.consecutiveBoardErrors || 0) + 1,
              lastBoardObservationError: errorText(error),
            }
          }

          watchState = {
            ...watchState,
            status: 'RECONCILING_UNKNOWN',
            updatedAt: new Date().toISOString(),
            usage: watcherUsageView(currentUsage),
            strategyScheduler: strategyScheduler.snapshot(),
            executionPaused: true,
            discoveryActive: true,
            lastDecision: 'SIGNING_PAUSED_ASYNC_RECONCILIATION',
            reason: '一笔交易的链上结果尚未确认；自动签名暂缓，市场扫描继续。',
            transaction: unresolvedNow.hash,
            signingPause: {
              scope: 'SHARED_WALLET_NONCE_DOMAIN',
              startedAt: signingPauseStartedAt,
              kind: unresolvedNow.kind,
            },
            reconciliation: {
              status: reconciliationTask ? 'RUNNING' : 'RETRY_WAIT',
              attempts: reconciliationAttempts,
              lastResult: reconciliationLastResult,
              nextAttemptAt:
                reconciliationTask || reconciliationNextAttemptAt <= Date.now()
                  ? null
                  : new Date(reconciliationNextAttemptAt).toISOString(),
            },
            global: {
              ...watchState.global,
              status: 'WATCHING_SIGNING_PAUSED',
              feed: sequencerFeed?.snapshot() || null,
            },
          }
          writeProtectedJson(DUAL_WATCH_STATE_PATH, watchState)
          await sleep(Math.max(0, RUNTIME_CONFIG.genericWatchPollMs - (Date.now() - loopStartedAt)))
          continue
        }
        if (reconciliationHash) {
          appendAudit('dual_watch_signing_resumed_after_reconcile', {
            authorizationId: currentArm.authorizationId,
            hash: reconciliationHash,
            attempts: reconciliationAttempts,
            result: reconciliationLastResult?.status || null,
          })
          reconciliationHash = null
          reconciliationAttempts = 0
          reconciliationLastResult = null
          reconciliationNextAttemptAt = 0
          signingPauseStartedAt = null
          watchState = {
            ...watchState,
            status: 'RUNNING',
            updatedAt: new Date().toISOString(),
            executionPaused: false,
            discoveryActive: true,
            signingPause: null,
            reconciliation: null,
            reason: null,
          }
          writeProtectedJson(DUAL_WATCH_STATE_PATH, watchState)
        }
        if (
          managedEarnEventSource?.snapshot().status === 'DEGRADED' &&
          !managedEarnEventSource.snapshot().subscriptionActive &&
          Date.now() >= managedEarnNextRetryAt
        ) {
          try {
            await managedEarnEventSource.start()
            recordManagedEarnRecovered()
            appendAudit('earn_managed_wss_recovered', {
              authorizationId: currentArm.authorizationId,
              policy: EARN_EVENT_SOURCE_POLICY,
            })
          } catch (error) {
            recordManagedEarnRetry(error)
          }
        }
        if (Date.now() - lastEarnEventPollAt >= RUNTIME_CONFIG.earnWatchEventPollMs) {
          lastEarnEventPollAt = Date.now()
          try {
            const wake = await pollEarnOnHoodWake(earnEventCursor)
            earnEventCursor = wake.cursor
            if (wake.event) {
              enqueueEarnMarketWake('REVIEWED_POOL_SWAP_EVENT', wake)
              const globalWake = buildGlobalWakeFromEarnEvent(wake, { wakeSource: 'PUBLIC_EARN_LOG_BACKSTOP' })
              if (globalWake) enqueueGlobalFeedWake(globalWake)
            }
            watchState = {
              ...watchState,
              earnOnHood: {
                ...watchState.earnOnHood,
                status: 'WATCHING',
                publicEventCursor: String(wake.cursor),
                lastEventPollAt: new Date().toISOString(),
                skippedBlocks: String(wake.skippedBlocks || 0n),
                eventError: null,
              },
            }
          } catch (error) {
            watchState = {
              ...watchState,
              earnOnHood: {
                ...watchState.earnOnHood,
                status: 'DEGRADED_PUBLIC_EVENT_RPC',
                lastEventPollAt: new Date().toISOString(),
                eventError: errorText(error),
              },
            }
          }
        }
        const scheduledWork = strategyScheduler.claimNext(Date.now())
        if (scheduledWork) {
          watchState = { ...watchState, strategyScheduler: strategyScheduler.snapshot() }
          appendAudit('strategy_work_claimed', {
            authorizationId: currentArm.authorizationId,
            lane: scheduledWork.laneId,
            kind: scheduledWork.kind,
            wakeReason: scheduledWork.reason,
            scheduledAt: new Date(scheduledWork.scheduledAt).toISOString(),
            claimedAt: new Date(scheduledWork.claimedAt).toISOString(),
            latenessMs: scheduledWork.latenessMs ?? null,
            waitMs: scheduledWork.waitMs ?? null,
            nextPeriodicAt: new Date(scheduledWork.nextPeriodicAt).toISOString(),
          })
          if (scheduledWork.laneId === 'EARN') {
            phase = 'EARN'
            const earnRun = await executeEarnWatcherWake({
              arm: currentArm,
              watchState,
              deployments,
              wakeReason: scheduledWork.reason,
              signal: scheduledWork.signal,
              eventCursor: earnEventCursor,
              nextPeriodicAt: scheduledWork.nextPeriodicAt,
            })
            watchState = earnRun.watchState
            deployments = earnRun.deployments
          } else {
            phase = 'GLOBAL'
            const searchResultIds = scheduledWork.signal?.searchResultIds || []
            const preparedResults = searchResultIds
              .map((requestId) => ({ requestId, result: readyGlobalSearchResults.get(requestId) }))
              .filter((item) => item.result)
            for (const requestId of searchResultIds) readyGlobalSearchResults.delete(requestId)
            const preparedSearchResult = scheduledWork.signal?.requiresLegacyGlobalSearch
              ? null
              : preparedResults.find((item) => item.result?.snapshot?.status === 'EXACT_NET_POSITIVE')?.result ||
                preparedResults.at(-1)?.result ||
                null
            const globalRun = await executeGlobalWatcherWake({
              arm: currentArm,
              watchState,
              deployments,
              wakeReason: scheduledWork.reason,
              signal: scheduledWork.signal,
              nextPeriodicAt: scheduledWork.nextPeriodicAt,
              feed: sequencerFeed,
              scheduledAt: scheduledWork.scheduledAt,
              claimedAt: scheduledWork.claimedAt,
              preparedSearchResult,
            })
            watchState = globalRun.watchState
            deployments = globalRun.deployments
            activeGlobalFeedPolicy = globalRun.feedPolicy
          }
          await sleep(Math.max(0, RUNTIME_CONFIG.genericWatchPollMs - (Date.now() - loopStartedAt)))
          continue
        }
        watchState = { ...watchState, strategyScheduler: strategyScheduler.snapshot() }
        const board = await screenedBoardCandidates(32)
        if (!board.snapshot?.generatedAt || !Number.isFinite(Date.parse(board.snapshot.generatedAt))) {
          throw new Error('loopback board snapshot has no valid generation timestamp')
        }
        if (board.snapshot.generatedAt !== lastGeneration) {
          lastGeneration = board.snapshot.generatedAt
          attemptedHashes = new Set()
          watchState = {
            ...watchState,
            processedBoardGenerations: watchState.processedBoardGenerations + 1,
            screenedPositiveBoardGenerations:
              watchState.screenedPositiveBoardGenerations + (board.candidates.length > 0 ? 1 : 0),
            lastBoardGeneratedAt: lastGeneration,
            lastBoardCandidateCount: board.candidates.length,
          }
        }
        if (board.candidates.length === 0) {
          watchState = {
            ...watchState,
            status: 'RUNNING',
            updatedAt: new Date().toISOString(),
            usage: watcherUsageView(currentUsage),
            consecutiveBoardErrors: 0,
            lastDecision: 'NO_SCREENED_OPPORTUNITY',
            reason: null,
          }
          writeProtectedJson(DUAL_WATCH_STATE_PATH, watchState)
          await sleep(Math.max(0, RUNTIME_CONFIG.genericWatchPollMs - (Date.now() - loopStartedAt)))
          continue
        }
        const candidate = board.candidates.find((item) => {
          if (attemptedHashes.has(item.candidateHash)) return false
          try {
            assertArmCandidateBounds(currentArm, item, deployments)
            return true
          } catch {
            return false
          }
        })
        if (!candidate) {
          watchState = {
            ...watchState,
            status: 'RUNNING',
            updatedAt: new Date().toISOString(),
            usage: watcherUsageView(currentUsage),
            consecutiveBoardErrors: 0,
            lastDecision: 'NO_AUTHORIZED_SCREENED_OPPORTUNITY',
            reason: null,
          }
          writeProtectedJson(DUAL_WATCH_STATE_PATH, watchState)
          await sleep(Math.max(0, RUNTIME_CONFIG.genericWatchPollMs - (Date.now() - loopStartedAt)))
          continue
        }
        attemptedHashes.add(candidate.candidateHash)
        const frozenTrigger = freezeDualExecutionTrigger(board.snapshot, candidate, {
          maxAgeMs: RUNTIME_CONFIG.genericMaxQuoteAgeMs,
        })
        appendAudit('dual_watch_exact_preflight_started', {
          authorizationId: currentArm.authorizationId,
          triggeringCandidateHash: candidate.candidateHash,
          triggeringBaseAsset: candidate.baseAsset,
          triggeringRoute: candidate.routeLabel,
          screenedNetUsdgWei: candidateScreenedNetUsdg(candidate),
          executionHandoff: frozenTrigger.handoff,
          triggerBoardGeneratedAt: frozenTrigger.boardGeneratedAt,
          triggerCapturedAt: frozenTrigger.capturedAt,
        })
        watchState = {
          ...watchState,
          status: 'EXECUTING',
          updatedAt: new Date().toISOString(),
          usage: watcherUsageView({ ...currentUsage, exactPreflights: currentUsage.exactPreflights + 1 }),
          lastDecision: 'SAME_BLOCK_DUAL_EXACT_PREFLIGHT_RUNNING',
          lastTrigger: {
            baseAsset: candidate.baseAsset,
            route: candidate.routeLabel,
            candidateHash: candidate.candidateHash,
          },
        }
        writeProtectedJson(DUAL_WATCH_STATE_PATH, watchState)
        phase = 'EXECUTION'
        const record = await execute({
          authorizationId: currentArm.authorizationId,
          abortRequested: () => stopRequested,
          frozenTrigger,
        })
        deployments = refreshDeploymentLedgers(deployments)
        const confirmedUsage = assertDualAuthorization(currentArm, deployments)
        const reverted = record.status === 'DUAL_BASE_EXECUTION_REVERTED_CONFIRMED'
        watchState = {
          ...watchState,
          status: 'RUNNING',
          updatedAt: new Date().toISOString(),
          usage: watcherUsageView(confirmedUsage),
          consecutiveExecutionRpcErrors: 0,
          lastDecision: reverted ? 'DUAL_BASE_EXECUTION_REVERTED_CONTINUE' : 'CONFIRMED_EXECUTION',
          reason: null,
          lastTransaction: record.hash,
          lastExecutionBaseAsset: record.baseAsset,
          lastNormalizedNetProfitUsdg: reverted
            ? watchState.lastNormalizedNetProfitUsdg || null
            : formatUnits(BigInt(record.normalizedNetProfitUsdgWei), 6),
        }
        writeProtectedJson(DUAL_WATCH_STATE_PATH, watchState)
        appendAudit(reverted ? 'dual_watch_execution_reverted_continue' : 'dual_watch_execution_confirmed', {
          authorizationId: currentArm.authorizationId,
          hash: record.hash,
          baseAsset: record.baseAsset,
          normalizedNetProfitUsdgWei: record.normalizedNetProfitUsdgWei || null,
          gasSpentWei: record.gasSpentWei || null,
          confirmedExecutionsThisArm: confirmedUsage.confirmedExecutions,
          revertedExecutionsThisArm: confirmedUsage.revertedExecutionCount,
        })
      } catch (error) {
        const unresolvedNow = latestUnresolved()
        deployments = refreshDeploymentLedgers(deployments)
        let currentUsage = null
        try {
          const currentArm = readJson(DUAL_WATCH_ARM_PATH)
          currentUsage = currentArm
            ? dualAuthorizationUsage(currentArm, deployments.usdg.state, deployments.weth.state, readAuditRecords())
            : null
        } catch {}
        if (error.watchPolicyStop) {
          watchState = {
            ...watchState,
            status: 'STOPPED_POLICY',
            updatedAt: new Date().toISOString(),
            usage: currentUsage ? watcherUsageView(currentUsage) : watchState?.usage,
            reason: errorText(error),
          }
          writeProtectedJson(DUAL_WATCH_STATE_PATH, watchState)
          appendAudit('dual_watch_stopped_policy', {
            authorizationId: watchState.authorizationId,
            reason: errorText(error),
          })
          return watchState
        }
        if (unresolvedNow) {
          const startedAt = watchState.signingPause?.startedAt || new Date().toISOString()
          watchState = {
            ...watchState,
            status: 'RECONCILING_UNKNOWN',
            updatedAt: new Date().toISOString(),
            usage: currentUsage ? watcherUsageView(currentUsage) : watchState?.usage,
            executionPaused: true,
            discoveryActive: true,
            lastDecision: 'SIGNING_PAUSED_ASYNC_RECONCILIATION',
            reason: '一笔交易的链上结果尚未确认；自动签名暂缓，市场扫描继续。',
            transaction: unresolvedNow.hash,
            signingPause: {
              scope: 'SHARED_WALLET_NONCE_DOMAIN',
              startedAt,
              kind: unresolvedNow.kind,
            },
          }
          writeProtectedJson(DUAL_WATCH_STATE_PATH, watchState)
          appendAudit('dual_watch_unknown_queued_for_reconciliation', {
            authorizationId: watchState.authorizationId,
            kind: unresolvedNow.kind,
            hash: unresolvedNow.hash,
            reason: errorText(error),
          })
          await sleep(Math.max(0, RUNTIME_CONFIG.genericWatchPollMs - (Date.now() - loopStartedAt)))
          continue
        }
        if (isChildProcessDeadlineError(error) && ['EARN', 'GLOBAL'].includes(phase)) {
          const globalPhase = phase === 'GLOBAL'
          const counter = globalPhase ? 'consecutiveGlobalErrors' : 'consecutiveEarnErrors'
          const consecutiveErrors = Number(watchState[counter] || 0) + 1
          watchState = {
            ...watchState,
            status: globalPhase ? 'DEGRADED_GLOBAL' : 'DEGRADED_EARN',
            updatedAt: new Date().toISOString(),
            usage: currentUsage ? watcherUsageView(currentUsage) : watchState?.usage,
            [counter]: consecutiveErrors,
            lastDecision: globalPhase ? 'GLOBAL_TIMEOUT_RETRY_SCHEDULED' : 'EARN_TIMEOUT_RETRY_SCHEDULED',
            reason: errorText(error),
            ...(globalPhase
              ? {
                  global: {
                    ...watchState.global,
                    status: 'DEGRADED_TIMEOUT',
                    lastResult: 'CHILD_TIMEOUT_NO_UNRESOLVED_MUTATION',
                    feed: sequencerFeed?.snapshot() || null,
                  },
                }
              : {
                  earnOnHood: {
                    ...watchState.earnOnHood,
                    status: 'DEGRADED_TIMEOUT',
                    lastResult: 'CHILD_TIMEOUT_NO_UNRESOLVED_MUTATION',
                  },
                }),
          }
          writeProtectedJson(DUAL_WATCH_STATE_PATH, watchState)
          appendAudit(globalPhase ? 'global_watch_child_timeout' : 'earn_watch_child_timeout', {
            authorizationId: watchState.authorizationId,
            consecutiveErrors,
            timeoutMs: error.timeoutMs,
            result: 'NO_UNRESOLVED_MUTATION_CONTINUE',
          })
        } else if (isDualOpportunityMiss(error)) {
          watchState = {
            ...watchState,
            status: 'RUNNING',
            updatedAt: new Date().toISOString(),
            usage: currentUsage ? watcherUsageView(currentUsage) : watchState?.usage,
            consecutiveExecutionRpcErrors: 0,
            lastDecision: 'CANDIDATE_REJECTED_EXACT',
            reason: errorText(error),
          }
          writeProtectedJson(DUAL_WATCH_STATE_PATH, watchState)
          appendAudit('dual_watch_candidate_rejected_exact', {
            authorizationId: watchState.authorizationId,
            reason: errorText(error),
          })
        } else if (['EARN', 'GLOBAL'].includes(phase) && isTransientRpcError(error)) {
          const globalPhase = phase === 'GLOBAL'
          const counter = globalPhase ? 'consecutiveGlobalErrors' : 'consecutiveEarnErrors'
          const consecutiveErrors = Number(watchState[counter] || 0) + 1
          watchState = {
            ...watchState,
            status: globalPhase ? 'DEGRADED_GLOBAL' : 'DEGRADED_EARN',
            updatedAt: new Date().toISOString(),
            usage: currentUsage ? watcherUsageView(currentUsage) : watchState?.usage,
            [counter]: consecutiveErrors,
            lastDecision: globalPhase ? 'GLOBAL_RPC_RETRY_SCHEDULED' : 'EARN_RPC_RETRY_SCHEDULED',
            reason: errorText(error),
            ...(globalPhase
              ? {
                  global: {
                    ...watchState.global,
                    status: 'DEGRADED_RPC',
                    lastResult: 'RPC_ERROR_NO_SIGNATURE_OR_UNRESOLVED_MUTATION',
                    feed: sequencerFeed?.snapshot() || null,
                  },
                }
              : {
                  earnOnHood: {
                    ...watchState.earnOnHood,
                    status: 'DEGRADED_RPC',
                    lastResult: 'RPC_ERROR_NO_SIGNATURE_OR_UNRESOLVED_MUTATION',
                  },
                }),
          }
          writeProtectedJson(DUAL_WATCH_STATE_PATH, watchState)
          appendAudit(globalPhase ? 'global_watch_rpc_error' : 'earn_watch_rpc_error', {
            authorizationId: watchState.authorizationId,
            consecutiveErrors,
            reason: errorText(error),
          })
          await sleep(
            Math.min(
              30_000,
              (globalPhase ? RUNTIME_CONFIG.globalWatchMinIntervalMs : RUNTIME_CONFIG.earnWatchEventPollMs) *
                consecutiveErrors,
            ),
          )
        } else if (isBoardSnapshotTransportFailure(error)) {
          const counter = phase === 'BOARD' ? 'consecutiveBoardErrors' : 'consecutiveExecutionRpcErrors'
          const consecutiveErrors = Number(watchState[counter] || 0) + 1
          const shouldStop = phase !== 'BOARD' && consecutiveErrors >= RUNTIME_CONFIG.genericWatchMaxConsecutiveErrors
          watchState = {
            ...watchState,
            status: shouldStop ? 'HALTED_RPC' : phase === 'BOARD' ? 'DEGRADED_BOARD' : 'DEGRADED_RPC',
            updatedAt: new Date().toISOString(),
            usage: currentUsage ? watcherUsageView(currentUsage) : watchState?.usage,
            [counter]: consecutiveErrors,
            lastDecision: phase === 'BOARD' ? 'BOARD_RETRY_SCHEDULED' : 'RPC_ERROR',
            reason: errorText(error),
          }
          writeProtectedJson(DUAL_WATCH_STATE_PATH, watchState)
          appendAudit('dual_watch_rpc_error', {
            authorizationId: watchState.authorizationId,
            phase,
            consecutiveErrors,
            reason: errorText(error),
          })
          if (shouldStop) return watchState
          await sleep(Math.min(30_000, RUNTIME_CONFIG.genericWatchPollMs * consecutiveErrors))
        } else if (/nonce/i.test(errorText(error))) {
          watchState = {
            ...watchState,
            status: 'HALTED_NONCE_CONFLICT',
            updatedAt: new Date().toISOString(),
            lastDecision: 'NONCE_CONFLICT',
            reason: errorText(error),
          }
          writeProtectedJson(DUAL_WATCH_STATE_PATH, watchState)
          return watchState
        } else {
          watchState = {
            ...watchState,
            status: 'HALTED_INVARIANT',
            updatedAt: new Date().toISOString(),
            lastDecision: 'INVARIANT_FAILED',
            reason: errorText(error),
          }
          writeProtectedJson(DUAL_WATCH_STATE_PATH, watchState)
          appendAudit('dual_watch_halted_invariant', {
            authorizationId: watchState.authorizationId,
            reason: errorText(error),
          })
          return watchState
        }
      }
      await sleep(Math.max(0, RUNTIME_CONFIG.genericWatchPollMs - (Date.now() - loopStartedAt)))
    }
    persistStopRequested()
    return watchState
  } catch (error) {
    const unresolved = latestUnresolved()
    watchState = {
      ...(watchState || {
        schemaVersion: 1,
        pid: process.pid,
        wallet: WALLET,
        authorizationId: readJson(DUAL_WATCH_ARM_PATH)?.authorizationId || null,
      }),
      status: error.watchPolicyStop
        ? 'STOPPED_POLICY'
        : unresolved
          ? 'HALTED_UNKNOWN'
          : isTransientRpcError(error)
            ? 'HALTED_RPC'
            : 'HALTED_STARTUP',
      reason: errorText(error),
      transaction: unresolved?.hash || null,
      updatedAt: new Date().toISOString(),
    }
    writeProtectedJson(DUAL_WATCH_STATE_PATH, watchState)
    appendAudit('dual_watch_startup_stopped', {
      authorizationId: watchState.authorizationId,
      status: watchState.status,
      reason: watchState.reason,
      unresolvedHash: unresolved?.hash || null,
    })
    return watchState
  } finally {
    globalSearchWorker?.stop()
    managedEarnEventSource?.stop()
    sequencerFeed?.stop()
    process.removeListener('SIGTERM', requestStop)
    process.removeListener('SIGINT', requestStop)
    release()
  }
}

async function dualWatchStatus() {
  const arm = readJson(DUAL_WATCH_ARM_PATH)
  const runtime = readJson(DUAL_WATCH_STATE_PATH)
  const usdgState = readJson(USDG_STATE_PATH)
  const wethState = readJson(WETH_STATE_PATH)
  const universalState = readJson(UNIVERSAL_STATE_PATH)
  const processState = lockHolder(DUAL_WATCH_LOCK_PATH)
  let usage = null
  let principal = null
  if (arm && usdgState && wethState) {
    try {
      const observed = dualAuthorizationUsage(arm, usdgState, wethState, readAuditRecords())
      usage = watcherUsageView(observed)
      principal = {
        usdg: formatUnits(dualSpendablePrincipal(arm, usdgState, 'USDG'), 6),
        weth: formatUnits(dualSpendablePrincipal(arm, wethState, 'WETH'), 18),
      }
    } catch (error) {
      usage = { error: errorText(error) }
    }
  }
  let board
  try {
    const selection = await screenedBoardCandidates(32)
    const top = selection.candidates[0]
    board = {
      evidence: 'LOCAL_SIGNER_FREE_BOARD_SCREEN_ONLY',
      generatedAt: selection.snapshot.generatedAt,
      candidateCount: selection.candidates.length,
      top: top
        ? {
            baseAsset: top.baseAsset,
            route: top.routeLabel,
            amountIn: formatUnits(top.amountIn, top.baseDecimals),
            normalizedScreenedNetUsdg: formatUnits(candidateScreenedNetUsdg(top), 6),
          }
        : null,
    }
  } catch (error) {
    board = { status: 'NO_FRESH_ELIGIBLE_DUAL_SCREEN', error: errorText(error) }
  }
  let authorization = null
  if (arm) {
    try {
      authorization = {
        id: arm.authorizationId,
        status: arm.status,
        revokedAt: readDualRevocation(arm.authorizationId)?.revokedAt || null,
        authorizationLifetime: arm.authorizationLifetime,
        principalPolicy: arm.principalPolicy,
        executors: { USDG: arm.usdgExecutor, WETH: arm.wethExecutor },
        currentSpendablePrincipal: principal,
        hardCaps: {
          usdg: formatUnits(BigInt(arm.usdgHardCapWei), 6),
          weth: formatUnits(BigInt(arm.wethHardCapWei), 18),
        },
        minimumNetProfitUsdg: formatUnits(BigInt(arm.minimumNetProfitUsdgWei), 6),
        minimumScreenedNetProfitUsdg: formatUnits(BigInt(arm.minimumScreenedNetProfitUsdgWei), 6),
        countLimits: 'UNLIMITED',
        failedGasBreakerEth: formatEther(BigInt(arm.maxFailedGasWei)),
        earnOnHood: arm.earnOnHood
          ? {
              principalPolicy: arm.earnOnHood.principalPolicy,
              fixedPrincipalCap: null,
              initialGasSurplusEth: formatEther(BigInt(arm.earnOnHood.initialGasSurplusWei)),
              perAttemptGasCeilingEth: formatEther(BigInt(arm.earnOnHood.perAttemptGasCeilingWei)),
              minimumNetProfitEth: formatEther(BigInt(arm.earnOnHood.minimumNetProfitWei)),
              sizingAlgorithm: arm.earnOnHood.sizingAlgorithm || null,
              coarseProbePoints: arm.earnOnHood.coarseProbePoints || null,
              refinementPoints: arm.earnOnHood.refinementPoints || null,
              publicMaximumExactQuotesPerWake: arm.earnOnHood.publicMaximumExactQuotesPerWake || null,
              managedMaximumExactQuotesPerWake: arm.earnOnHood.managedMaximumExactQuotesPerWake || null,
              eventPollMs: arm.earnOnHood.eventPollMs,
              periodicMs: arm.earnOnHood.periodicMs,
            }
          : null,
        global: arm.global
          ? {
              executor: arm.global.executor,
              fundingPolicy: arm.global.fundingPolicy,
              universePolicy: arm.global.universePolicy,
              settlementPolicy: arm.global.settlementPolicy,
              settlementSeeds: arm.global.settlementSeeds,
              maximumSettlementAssetsPerWake: arm.global.maximumSettlementAssetsPerWake,
              feedPolicy: arm.global.feedPolicy,
              routeWorksetPolicy: arm.global.routeWorksetPolicy,
              submissionPolicy: arm.global.submissionPolicy,
              maximumEventRoutesPerWake: arm.global.maximumEventRoutesPerWake,
              managedFallbackDailyLogicalCallCap: arm.global.managedFallbackDailyLogicalCallCap,
              managedFallbackEventLogicalCallCap: arm.global.managedFallbackEventLogicalCallCap,
              managedFallbackRecoveryLogicalCallCap: arm.global.managedFallbackRecoveryLogicalCallCap,
              minimumWakeIntervalMs: arm.global.minimumWakeIntervalMs,
              periodicMs: arm.global.periodicMs,
            }
          : null,
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
    evidence: 'LOCAL_RUNTIME_AUTHORIZATION_AND_SIGNER_FREE_BOARD_READBACK_NO_CHAIN_QUERY',
    process: processState,
    authorization,
    usage,
    runtime,
    deployments: {
      USDG: usdgState
        ? {
            status: usdgState.status,
            executor: usdgState.executor,
            confirmedExecutions: (usdgState.executions || []).length,
          }
        : null,
      WETH: wethState
        ? {
            status: wethState.status,
            executor: wethState.executor,
            confirmedExecutions: (wethState.executions || []).length,
          }
        : null,
      UNIVERSAL: universalState
        ? {
            status: universalState.status,
            executor: universalState.executor,
            confirmedExecutions: (universalState.executions || []).length,
          }
        : null,
    },
    unresolvedMutation: latestUnresolved()
      ? { kind: latestUnresolved().kind || null, hash: latestUnresolved().hash }
      : null,
    board,
  }
  console.log(stringify(output))
  return output
}

async function disarmDualWatcher() {
  const arm = readJson(DUAL_WATCH_ARM_PATH)
  if (!arm) throw new Error('no dual watcher authorization exists')
  const revokedAt = new Date().toISOString()
  writeProtectedJson(DUAL_WATCH_REVOCATION_PATH, {
    schemaVersion: 1,
    authorizationId: arm.authorizationId,
    revokedAt,
  })
  arm.status = 'DISARMED'
  arm.disarmedAt = revokedAt
  writeProtectedJson(DUAL_WATCH_ARM_PATH, arm)
  const holder = lockHolder(DUAL_WATCH_LOCK_PATH)
  writeProtectedJson(DUAL_WATCH_STATE_PATH, {
    ...(readJson(DUAL_WATCH_STATE_PATH) || { schemaVersion: 1, wallet: WALLET }),
    status: holder.alive ? 'DISARM_REQUESTED' : 'DISARMED',
    authorizationId: arm.authorizationId,
    updatedAt: revokedAt,
  })
  if (holder.alive && holder.pid !== process.pid) process.kill(holder.pid, 'SIGTERM')
  appendAudit('dual_watch_disarmed', {
    authorizationId: arm.authorizationId,
    watcherPid: holder.pid,
    watcherWasAlive: holder.alive,
  })
  const output = {
    status: 'DUAL_WATCH_DISARMED',
    authorizationId: arm.authorizationId,
    watcherPid: holder.pid,
    watcherWasAlive: holder.alive,
  }
  console.log(stringify(output))
  return output
}

async function runtimeVerify() {
  assertLiveTransport(RUNTIME_CONFIG)
  assertLegacySignersInactive()
  const unresolved = latestUnresolved()
  if (unresolved) throw new Error(`unresolved ${unresolved.kind} mutation ${unresolved.hash}`)
  await assertCanonicalBase()
  const deployments = await loadVerifiedDeployments()
  const [wallet, usdgPrincipal, wethPrincipal, board] = await Promise.all([
    walletSnapshot(),
    publicClient.readContract({
      address: GENERIC_USDG,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [deployments.usdg.executor],
    }),
    publicClient.readContract({
      address: GENERIC_WETH,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [deployments.weth.executor],
    }),
    loadBoardSnapshot(),
  ])
  if (wallet.nonceLatest !== wallet.noncePending) throw new Error('wallet latest and pending nonce have not converged')
  assertDualBoardIdentity(board)
  const arm = readJson(DUAL_WATCH_ARM_PATH)
  const output = {
    status: 'RUNTIME_VERIFIED_READY_FOR_DUAL_ARM',
    evidence: 'CANONICAL_CHAIN_DEPLOYMENT_AND_LOOPBACK_BOARD_READBACK_NO_SIGNATURE_NO_BROADCAST',
    releaseSha: process.env.MANGA_RELEASE_SHA || 'UNKNOWN',
    chainId: CHAIN_ID,
    rpcSource: RUNTIME_CONFIG.rpcSource,
    wallet: WALLET,
    walletEth: formatEther(wallet.ethBalance),
    nonceLatest: wallet.nonceLatest,
    noncePending: wallet.noncePending,
    executors: {
      USDG: {
        address: deployments.usdg.executor,
        balance: formatUnits(usdgPrincipal, 6),
        sourceHash: deployments.usdg.state.sourceHash,
        runtimeCodeHash: deployments.usdg.state.runtimeCodeHash,
      },
      WETH: {
        address: deployments.weth.executor,
        balance: formatUnits(wethPrincipal, 18),
        sourceHash: deployments.weth.state.sourceHash,
        runtimeCodeHash: deployments.weth.state.runtimeCodeHash,
      },
    },
    unresolvedMutation: null,
    board: {
      service: board.service,
      mode: board.mode,
      schemaVersion: board.schemaVersion,
      generatedAt: board.generatedAt,
      status: board.health?.status || null,
      signerLoaded: board.health?.signerLoaded,
      executionAuthorized: board.baseSelection.executionAuthorized,
      preferredBaseAsset: board.baseSelection.baseAsset || null,
    },
    authorization: arm ? { id: arm.authorizationId, status: arm.status, lifetime: arm.authorizationLifetime } : null,
  }
  appendAudit('dual_runtime_verified', output)
  console.log(stringify(output))
  return output
}

async function plan() {
  await assertCanonicalBase()
  const { snapshot, candidates } = await boardCandidates({ limit: 32 })
  const output = {
    status: 'DUAL_BASE_CANDIDATE_SET_PLANNED',
    evidence: 'BOARD_QUOTE_AND_CANONICAL_QUOTE_BLOCK_ONLY_NO_EXECUTOR_SIMULATION_NO_SIGNATURE',
    generatedAt: snapshot.generatedAt,
    candidates: candidates.map((candidate) => ({
      baseAsset: candidate.baseAsset,
      candidateHash: candidate.candidateHash,
      route: candidate.routeLabel,
      amountIn: formatUnits(candidate.amountIn, candidate.baseDecimals),
      normalizedScreenedNetUsdg: formatUnits(candidateScreenedNetUsdg(candidate), 6),
    })),
  }
  console.log(stringify(output))
  return output
}

async function status() {
  const usdgState = readJson(USDG_STATE_PATH)
  const wethState = readJson(WETH_STATE_PATH)
  const unresolved = latestUnresolved()
  let board
  try {
    const selection = await screenedBoardCandidates(32)
    const top = selection.candidates[0]
    board = {
      generatedAt: selection.snapshot.generatedAt,
      candidateCount: selection.candidates.length,
      preferredBaseAsset: top?.baseAsset || null,
      route: top?.routeLabel || null,
      normalizedScreenedNetUsdg: top ? formatUnits(candidateScreenedNetUsdg(top), 6) : null,
    }
  } catch (error) {
    board = { status: 'UNAVAILABLE_OR_NO_POSITIVE_SELECTION', error: errorText(error) }
  }
  const output = {
    status: wethState ? 'DUAL_DEPLOYMENT_LEDGER_PRESENT' : 'WETH_NOT_DEPLOYED',
    evidence: 'LOCAL_STATE_AND_SIGNER_FREE_BOARD_ONLY_NO_CHAIN_READBACK',
    wallet: WALLET,
    executors: { USDG: usdgState?.executor || null, WETH: wethState?.executor || null },
    unresolvedMutation: unresolved ? { kind: unresolved.kind, hash: unresolved.hash } : null,
    board,
  }
  console.log(stringify(output))
  return output
}

async function main() {
  const command = process.argv[2] || 'status'
  if (command === 'compile') {
    const [{ compileGenericContract }, { compileWethContract }] = await Promise.all([
      import('./generic-contract-compile.mjs'),
      import('./weth-contract-compile.mjs'),
    ])
    const generic = compileGenericContract()
    const weth = compileWethContract()
    return console.log(
      stringify({
        status: 'DUAL_CONTRACTS_COMPILED',
        USDG: { sourceHash: generic.sourceHash, creationCodeHash: generic.creationCodeHash },
        WETH: {
          sourceHash: weth.sourceHash,
          dependencySourceHash: weth.dependencySourceHash,
          sourceBundleHash: weth.sourceBundleHash,
          creationCodeHash: weth.creationCodeHash,
        },
      }),
    )
  }
  if (command === 'plan') return plan()
  if (command === 'status') return status()
  if (command === 'runtime-verify') return runtimeVerify()
  if (command === 'weth-deploy-preflight') return wethDeployPreflight()
  if (command === 'weth-deploy') return deployWeth()
  if (command === 'preflight') return executionPreflight()
  if (command === 'execute') return execute()
  if (command === 'reconcile') return reconcile()
  if (command === 'weth-withdraw-all') return withdrawWethAll()
  if (command === 'watch-arm') return armDualWatcher()
  if (command === 'watch') {
    const result = await watchDual()
    process.exitCode = dualWatcherExitCode(result.status)
    return result
  }
  if (command === 'watch-status') return dualWatchStatus()
  if (command === 'watch-disarm') return disarmDualWatcher()
  throw new Error(`unknown dual-base command: ${command}`)
}

main().catch((error) => {
  appendAudit('dual_command_failed', { command: process.argv[2] || 'status', error: errorText(error) })
  console.error(diagnosticErrorText(error))
  process.exitCode = 1
})
