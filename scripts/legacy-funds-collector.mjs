import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  defineChain,
  encodeFunctionData,
  formatEther,
  formatUnits,
  http,
  keccak256,
  parseAbi,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { assertLiveTransport, loadRuntimeConfig } from '../src/config.mjs'
import { assertPrivateFile, buildMutationPlan, persistSignedRaw } from '../src/journal.mjs'
import {
  LEGACY_COLLECTION_CHAIN_ID,
  LEGACY_COLLECTION_RETAINED_ETH_WEI,
  LEGACY_COLLECTION_TARGETS,
  LEGACY_COLLECTION_USDG,
  LEGACY_COLLECTION_WALLET,
  buildLegacyCollectionBudget,
  validateLegacyTargetSnapshot,
} from '../src/legacy-collection.mjs'
import { errorText, latestUnresolvedMutation } from '../src/policy.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PUBLIC_READ_ONLY_RPC = 'https://rpc.mainnet.chain.robinhood.com'
const EXPLORER_TX = 'https://robinhoodchain.blockscout.com/tx/'
const RUNTIME_CONFIG = loadRuntimeConfig()
const RPC_URL = RUNTIME_CONFIG.rpcUrl || PUBLIC_READ_ONLY_RPC
const RUN_DIR = RUNTIME_CONFIG.runDir ? path.resolve(RUNTIME_CONFIG.runDir) : path.join(ROOT, 'runs')
const SPX_RUN_DIR = path.resolve(process.env.MANGA_SPX_RUN_DIR || '/var/lib/spx-arbitrage')
const AUDIT_PATH = path.join(RUN_DIR, 'legacy-collection-audit.jsonl')
const SIGNED_TX_DIR = path.join(RUN_DIR, 'signed')
const WALLET_LOCK_PATH = path.join(RUN_DIR, 'wallet.lock')
const SIGNER_LOCK_PATHS = [
  path.join(RUN_DIR, 'watch.lock'),
  path.join(RUN_DIR, 'generic-watch.lock'),
  path.join(RUN_DIR, 'dual-watch.lock'),
]

const chain = defineChain({
  id: LEGACY_COLLECTION_CHAIN_ID,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  blockExplorers: { default: { name: 'Robinhood Blockscout', url: 'https://robinhoodchain.blockscout.com' } },
})
const publicClient = createPublicClient({ chain, transport: http(RPC_URL, { timeout: 30_000, retryCount: 1 }) })

const ERC20_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
])
const EXECUTOR_ABI = parseAbi([
  'function operator() view returns (address)',
  'function withdraw(address token,uint256 amount,address to)',
  'event Withdrawn(address indexed token,address indexed to,uint256 amount)',
])

function stringify(value) {
  return JSON.stringify(value, (_, item) => (typeof item === 'bigint' ? item.toString() : item), 2)
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function writeProtectedJson(file, value) {
  const temporary = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temporary, `${stringify(value)}\n`, { mode: 0o600 })
  fs.renameSync(temporary, file)
  fs.chmodSync(file, 0o600)
}

function readAudit(file) {
  if (!fs.existsSync(file)) return []
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

function appendAudit(event, details = {}) {
  fs.mkdirSync(RUN_DIR, { recursive: true, mode: 0o700 })
  fs.appendFileSync(
    AUDIT_PATH,
    `${JSON.stringify({ at: new Date().toISOString(), lane: 'legacy-usdg-collection', event, ...details }, (_, item) =>
      typeof item === 'bigint' ? item.toString() : item,
    )}\n`,
    { mode: 0o600 },
  )
  fs.chmodSync(AUDIT_PATH, 0o600)
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
  if (!fs.existsSync(file)) return { exists: false, pid: null, alive: false }
  let pid = null
  try {
    pid = Number(fs.readFileSync(file, 'utf8').trim().split(/\s+/)[0])
  } catch {}
  return { exists: true, pid: Number.isSafeInteger(pid) ? pid : null, alive: processIsAlive(pid) }
}

function assertSignerLanesInactive() {
  for (const file of SIGNER_LOCK_PATHS) {
    const holder = lockHolder(file)
    if (holder.alive) throw new Error(`signer lane is active as PID ${holder.pid}: ${file}`)
    if (holder.exists) throw new Error(`stale signer lock requires explicit reconciliation: ${file}`)
  }
}

function acquireWalletLock() {
  fs.mkdirSync(RUN_DIR, { recursive: true, mode: 0o700 })
  let descriptor
  try {
    descriptor = fs.openSync(WALLET_LOCK_PATH, 'wx', 0o600)
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error
    const holder = lockHolder(WALLET_LOCK_PATH)
    if (holder.alive) throw new Error(`wallet lock is held by PID ${holder.pid}`)
    throw new Error(`stale wallet lock requires explicit reconciliation: ${WALLET_LOCK_PATH}`)
  }
  fs.writeFileSync(descriptor, `${process.pid} ${new Date().toISOString()} legacy-usdg-collection\n`)
  return () => {
    try {
      fs.closeSync(descriptor)
    } catch {}
    try {
      fs.unlinkSync(WALLET_LOCK_PATH)
    } catch {}
  }
}

function targetFiles(target) {
  const runDir = target.stateLane === 'spx' ? SPX_RUN_DIR : RUN_DIR
  const manifestName = target.id === 'SPX' ? 'spx-aapl-nvda-mainnet.json' : 'robinhood-mainnet.json'
  return {
    runDir,
    statePath: path.join(runDir, target.stateFile),
    auditPath: path.join(runDir, 'audit.jsonl'),
    manifestPath: path.join(ROOT, 'deployments', manifestName),
  }
}

function assertLocalIdentity(target) {
  const files = targetFiles(target)
  const manifest = readJson(files.manifestPath)
  const state = readJson(files.statePath)
  const checks = [
    [Number(manifest.chainId) === LEGACY_COLLECTION_CHAIN_ID, `${target.id} manifest chain mismatch`],
    [
      manifest.operator?.toLowerCase() === LEGACY_COLLECTION_WALLET.toLowerCase(),
      `${target.id} manifest operator mismatch`,
    ],
    [manifest.executor?.toLowerCase() === target.executor.toLowerCase(), `${target.id} manifest executor mismatch`],
    [manifest.runtimeCodeHash?.toLowerCase() === target.runtimeCodeHash, `${target.id} manifest code hash mismatch`],
    [
      manifest.deploymentTransaction?.toLowerCase() === target.deploymentTransaction,
      `${target.id} manifest deployment transaction mismatch`,
    ],
    [state.wallet?.toLowerCase() === LEGACY_COLLECTION_WALLET.toLowerCase(), `${target.id} state wallet mismatch`],
    [state.executor?.toLowerCase() === target.executor.toLowerCase(), `${target.id} state executor mismatch`],
    [state.runtimeCodeHash?.toLowerCase() === target.runtimeCodeHash, `${target.id} state code hash mismatch`],
    [state.deployment?.hash?.toLowerCase() === target.deploymentTransaction, `${target.id} state deployment mismatch`],
  ]
  for (const [passed, message] of checks) if (!passed) throw new Error(message)
  return { ...files, manifest, state }
}

function assertNoUnresolvedMutations() {
  const ledgers = new Set([AUDIT_PATH, ...LEGACY_COLLECTION_TARGETS.map((target) => targetFiles(target).auditPath)])
  for (const file of ledgers) {
    const unresolved = latestUnresolvedMutation(readAudit(file))
    if (unresolved) {
      throw new Error(`unresolved ${unresolved.kind || 'mutation'} ${unresolved.hash} in ${file}`)
    }
  }
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
  if (account.address.toLowerCase() !== LEGACY_COLLECTION_WALLET.toLowerCase()) {
    throw new Error(`signer mismatch: expected ${LEGACY_COLLECTION_WALLET}, observed ${account.address}`)
  }
  return account
}

async function targetSnapshot(target, blockNumber) {
  const local = assertLocalIdentity(target)
  const [code, operator, balance, deploymentReceipt] = await Promise.all([
    publicClient.getBytecode({ address: target.executor, blockNumber }),
    publicClient.readContract({ address: target.executor, abi: EXECUTOR_ABI, functionName: 'operator', blockNumber }),
    publicClient.readContract({
      address: LEGACY_COLLECTION_USDG,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [target.executor],
      blockNumber,
    }),
    publicClient.getTransactionReceipt({ hash: target.deploymentTransaction }),
  ])
  if (!code) throw new Error(`${target.id} executor has no runtime code`)
  if (deploymentReceipt.status !== 'success') throw new Error(`${target.id} deployment receipt is not successful`)
  if (deploymentReceipt.contractAddress?.toLowerCase() !== target.executor.toLowerCase()) {
    throw new Error(`${target.id} deployment receipt contract mismatch`)
  }
  const codeHash = keccak256(code)
  if (operator.toLowerCase() !== LEGACY_COLLECTION_WALLET.toLowerCase()) {
    throw new Error(`${target.id} operator mismatch`)
  }
  if (codeHash.toLowerCase() !== target.runtimeCodeHash) throw new Error(`${target.id} runtime code hash mismatch`)
  if (balance === 0n) {
    if (local.state.status !== 'withdrawn') {
      throw new Error(`${target.id} has zero chain balance without a finalized local withdrawal state`)
    }
    return {
      id: target.id,
      executor: target.executor,
      operator,
      codeHash,
      balance,
      alreadyCollected: true,
      estimatedGas: 0n,
      local,
    }
  }
  const request = {
    account: LEGACY_COLLECTION_WALLET,
    address: target.executor,
    abi: EXECUTOR_ABI,
    functionName: 'withdraw',
    args: [LEGACY_COLLECTION_USDG, balance, LEGACY_COLLECTION_WALLET],
    blockNumber,
  }
  await publicClient.simulateContract(request)
  const estimatedGas = await publicClient.estimateContractGas(request)
  const snapshot = {
    id: target.id,
    executor: target.executor,
    expectedExecutor: target.executor,
    operator,
    expectedOperator: LEGACY_COLLECTION_WALLET,
    codeHash,
    expectedCodeHash: target.runtimeCodeHash,
    balance,
    simulationSucceeded: true,
    estimatedGas,
  }
  validateLegacyTargetSnapshot(snapshot)
  return { ...snapshot, alreadyCollected: false, local }
}

async function collectionSnapshot() {
  const blockNumber = await publicClient.getBlockNumber()
  const [block, chainId, walletEth, walletUsdg, nonceLatest, noncePending, gasPrice, decimals] = await Promise.all([
    publicClient.getBlock({ blockNumber }),
    publicClient.getChainId(),
    publicClient.getBalance({ address: LEGACY_COLLECTION_WALLET, blockNumber }),
    publicClient.readContract({
      address: LEGACY_COLLECTION_USDG,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [LEGACY_COLLECTION_WALLET],
      blockNumber,
    }),
    publicClient.getTransactionCount({ address: LEGACY_COLLECTION_WALLET, blockTag: 'latest' }),
    publicClient.getTransactionCount({ address: LEGACY_COLLECTION_WALLET, blockTag: 'pending' }),
    publicClient.getGasPrice(),
    publicClient.readContract({
      address: LEGACY_COLLECTION_USDG,
      abi: ERC20_ABI,
      functionName: 'decimals',
      blockNumber,
    }),
  ])
  if (decimals !== 6) throw new Error(`unexpected USDG decimals ${decimals}`)
  const observations = await Promise.all(LEGACY_COLLECTION_TARGETS.map((target) => targetSnapshot(target, blockNumber)))
  const targets = observations.filter((target) => !target.alreadyCollected)
  if (targets.length === 0) {
    return {
      alreadyCollected: true,
      blockNumber,
      block,
      chainId,
      nonceStart: nonceLatest,
      walletEth,
      walletUsdg,
      gasPrice,
      retainedEth: LEGACY_COLLECTION_RETAINED_ETH_WEI,
      totalMaxGasWei: 0n,
      requiredWalletEth: LEGACY_COLLECTION_RETAINED_ETH_WEI,
      projectedMinimumWalletEth: walletEth,
      targets: [],
      observations,
    }
  }
  const budget = buildLegacyCollectionBudget({ chainId, nonceLatest, noncePending, walletEth, gasPrice, targets })
  return { alreadyCollected: false, blockNumber, block, walletUsdg, observations, ...budget }
}

function publicSnapshot(snapshot) {
  return {
    status: snapshot.alreadyCollected ? 'ALREADY_COLLECTED' : 'PREFLIGHT_OK',
    evidence: 'SAME_BLOCK_CHAIN_STATE_SIMULATION_GAS_AND_LOCAL_IDENTITY',
    checkedAt: new Date().toISOString(),
    blockNumber: snapshot.blockNumber,
    blockTimestamp: new Date(Number(snapshot.block.timestamp) * 1_000).toISOString(),
    wallet: LEGACY_COLLECTION_WALLET,
    walletEth: formatEther(snapshot.walletEth),
    walletUsdg: formatUnits(snapshot.walletUsdg, 6),
    nonceLatest: snapshot.nonceStart,
    noncePending: snapshot.nonceStart,
    retainedEth: formatEther(snapshot.retainedEth),
    totalMaxGasEth: formatEther(snapshot.totalMaxGasWei),
    projectedMinimumWalletEth: formatEther(snapshot.projectedMinimumWalletEth),
    targets: snapshot.targets.map((target) => ({
      id: target.id,
      executor: target.executor,
      amountUsdg: formatUnits(target.balance, 6),
      operator: target.operator,
      codeHash: target.codeHash,
      deploymentTransaction: target.local.manifest.deploymentTransaction,
      simulation: 'SUCCESS',
      estimatedGas: target.estimatedGas,
      gasLimit: target.gasLimit,
      maxGasEth: formatEther(target.maxGasWei),
    })),
    alreadyCollected: snapshot.observations
      .filter((target) => target.alreadyCollected)
      .map((target) => ({ id: target.id, executor: target.executor, amountUsdg: '0' })),
  }
}

async function preflight() {
  assertLiveTransport(RUNTIME_CONFIG)
  assertNoUnresolvedMutations()
  const snapshot = await collectionSnapshot()
  const result = publicSnapshot(snapshot)
  console.log(stringify(result))
  return result
}

function decodeWithdrawal(receipt, executor) {
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== executor.toLowerCase()) continue
    try {
      const decoded = decodeEventLog({ abi: EXECUTOR_ABI, data: log.data, topics: log.topics })
      if (decoded.eventName === 'Withdrawn') return decoded.args
    } catch {}
  }
  return null
}

function updateTargetState(target, record) {
  const { statePath } = targetFiles(target)
  const state = readJson(statePath)
  if (state.executor?.toLowerCase() !== target.executor.toLowerCase()) {
    throw new Error(`${target.id} state executor changed before finalization`)
  }
  state.status = 'withdrawn'
  state.withdrawal = record
  state.updatedAt = record.confirmedAt
  writeProtectedJson(statePath, state)
}

async function postStateForPlan(plan, receipt) {
  const [executorAfter, walletUsdgAfter, walletEthAfter, nonceLatest, noncePending] = await Promise.all([
    publicClient.readContract({
      address: LEGACY_COLLECTION_USDG,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [plan.executor],
    }),
    publicClient.readContract({
      address: LEGACY_COLLECTION_USDG,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [LEGACY_COLLECTION_WALLET],
    }),
    publicClient.getBalance({ address: LEGACY_COLLECTION_WALLET }),
    publicClient.getTransactionCount({ address: LEGACY_COLLECTION_WALLET, blockTag: 'latest' }),
    publicClient.getTransactionCount({ address: LEGACY_COLLECTION_WALLET, blockTag: 'pending' }),
  ])
  const gasSpentWei = receipt.gasUsed * receipt.effectiveGasPrice
  if (executorAfter !== 0n) throw new Error(`${plan.targetId} executor balance is not zero after receipt`)
  if (walletUsdgAfter - BigInt(plan.walletUsdgBefore) !== BigInt(plan.amount)) {
    throw new Error(`${plan.targetId} wallet USDG delta does not match withdrawal`)
  }
  if (BigInt(plan.walletEthBefore) - walletEthAfter !== gasSpentWei) {
    throw new Error(`${plan.targetId} wallet ETH delta does not match receipt Gas`)
  }
  if (nonceLatest !== Number(plan.nonce) + 1 || noncePending !== nonceLatest) {
    throw new Error(`${plan.targetId} nonce did not converge after receipt`)
  }
  const withdrawn = decodeWithdrawal(receipt, plan.executor)
  if (
    !withdrawn ||
    withdrawn.token.toLowerCase() !== LEGACY_COLLECTION_USDG.toLowerCase() ||
    withdrawn.to.toLowerCase() !== LEGACY_COLLECTION_WALLET.toLowerCase() ||
    withdrawn.amount !== BigInt(plan.amount)
  ) {
    throw new Error(`${plan.targetId} receipt is missing the exact Withdrawn effect`)
  }
  return { executorAfter, walletUsdgAfter, walletEthAfter, nonceLatest, noncePending, gasSpentWei }
}

async function finalizeSuccessfulPlan(target, plan, hash, receipt, reconciled = false) {
  if (receipt.status !== 'success') throw new Error(`${target.id} receipt is not successful`)
  const post = await postStateForPlan(plan, receipt)
  const record = {
    hash,
    targetId: target.id,
    executor: target.executor,
    token: LEGACY_COLLECTION_USDG,
    destination: LEGACY_COLLECTION_WALLET,
    amount: plan.amount,
    amountUsdg: formatUnits(BigInt(plan.amount), 6),
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed,
    effectiveGasPriceWei: receipt.effectiveGasPrice,
    gasSpentWei: post.gasSpentWei,
    walletEthAfterWei: post.walletEthAfter,
    walletUsdgAfterWei: post.walletUsdgAfter,
    nonceAfter: post.nonceLatest,
    confirmedAt: new Date().toISOString(),
    confirmations: RUNTIME_CONFIG.finalityConfirmations,
    reconciled,
    explorer: `${EXPLORER_TX}${hash}`,
  }
  updateTargetState(target, record)
  appendAudit('withdrawal_complete', record)
  appendAudit('mutation_effect', {
    kind: 'legacy-withdraw',
    hash,
    intentId: plan.intentId,
    planHash: plan.planHash,
    effect: 'EXECUTOR_ZERO_AND_OPERATOR_USDG_DELTA_CONFIRMED',
    gasSpentWei: post.gasSpentWei,
    reconciled,
  })
  return record
}

async function execute() {
  assertLiveTransport(RUNTIME_CONFIG)
  assertSignerLanesInactive()
  const release = acquireWalletLock()
  try {
    assertSignerLanesInactive()
    assertNoUnresolvedMutations()
    const frozen = await collectionSnapshot()
    if (frozen.alreadyCollected) {
      const result = publicSnapshot(frozen)
      console.log(stringify(result))
      return result
    }
    const account = loadAccount()
    const walletClient = createWalletClient({
      account,
      chain,
      transport: http(RPC_URL, { timeout: 30_000, retryCount: 0 }),
    })
    const authorization = {
      mode: 'OPERATOR_MAINTENANCE',
      scope: 'EXACT_ALLOWLISTED_MANGA_AND_SPX_FULL_USDG_WITHDRAWAL_TO_OPERATOR',
      reason: 'user instructed Codex to complete collection without an external ETH top-up',
      retainedEthWei: frozen.retainedEth,
    }
    const aggregatePlan = buildMutationPlan('legacy-usdg-collection', {
      lane: 'legacy-usdg-collection',
      chainId: LEGACY_COLLECTION_CHAIN_ID,
      wallet: LEGACY_COLLECTION_WALLET,
      token: LEGACY_COLLECTION_USDG,
      nonceStart: frozen.nonceStart,
      authorization,
      totalMaxGasWei: frozen.totalMaxGasWei,
      targets: frozen.targets.map((target) => ({ id: target.id, executor: target.executor, amount: target.balance })),
    })
    appendAudit('legacy_collection_intent', {
      intentId: aggregatePlan.intentId,
      planHash: aggregatePlan.planHash,
      authorization,
    })
    appendAudit('legacy_collection_preflight', {
      intentId: aggregatePlan.intentId,
      blockNumber: frozen.blockNumber,
      nonceStart: frozen.nonceStart,
      walletEthWei: frozen.walletEth,
      retainedEthWei: frozen.retainedEth,
      totalMaxGasWei: frozen.totalMaxGasWei,
      targets: frozen.targets.map((target) => ({
        id: target.id,
        executor: target.executor,
        amount: target.balance,
        estimatedGas: target.estimatedGas,
        gasLimit: target.gasLimit,
        maxFeePerGas: target.maxFeePerGas,
      })),
    })

    const completed = []
    for (let index = 0; index < frozen.targets.length; index += 1) {
      const frozenTarget = frozen.targets[index]
      const target = LEGACY_COLLECTION_TARGETS.find((candidate) => candidate.id === frozenTarget.id)
      if (!target) throw new Error(`missing allowlisted target ${frozenTarget.id}`)
      const blockNumber = await publicClient.getBlockNumber()
      const [liveTarget, walletEthBefore, walletUsdgBefore, nonceLatest, noncePending, gasPrice] = await Promise.all([
        targetSnapshot(target, blockNumber),
        publicClient.getBalance({ address: LEGACY_COLLECTION_WALLET, blockNumber }),
        publicClient.readContract({
          address: LEGACY_COLLECTION_USDG,
          abi: ERC20_ABI,
          functionName: 'balanceOf',
          args: [LEGACY_COLLECTION_WALLET],
          blockNumber,
        }),
        publicClient.getTransactionCount({ address: LEGACY_COLLECTION_WALLET, blockTag: 'latest' }),
        publicClient.getTransactionCount({ address: LEGACY_COLLECTION_WALLET, blockTag: 'pending' }),
        publicClient.getGasPrice(),
      ])
      if (liveTarget.balance !== frozenTarget.balance) throw new Error(`${target.id} balance changed after plan freeze`)
      if (nonceLatest !== frozen.nonceStart + index || noncePending !== nonceLatest) {
        throw new Error(`${target.id} nonce changed after plan freeze: ${nonceLatest}/${noncePending}`)
      }
      if (gasPrice > frozenTarget.maxFeePerGas)
        throw new Error(`${target.id} gas price exceeded the frozen fee envelope`)
      if (liveTarget.estimatedGas > frozenTarget.gasLimit) {
        throw new Error(`${target.id} gas estimate exceeded the frozen gas limit`)
      }
      const remainingMaxGasWei = frozen.targets.slice(index).reduce((sum, candidate) => sum + candidate.maxGasWei, 0n)
      if (walletEthBefore < frozen.retainedEth + remainingMaxGasWei) {
        throw new Error(`${target.id} wallet no longer covers remaining Gas and retained ETH`)
      }

      const data = encodeFunctionData({
        abi: EXECUTOR_ABI,
        functionName: 'withdraw',
        args: [LEGACY_COLLECTION_USDG, liveTarget.balance, LEGACY_COLLECTION_WALLET],
      })
      const plan = buildMutationPlan('legacy-withdraw', {
        lane: 'legacy-usdg-collection',
        parentIntentId: aggregatePlan.intentId,
        targetId: target.id,
        chainId: LEGACY_COLLECTION_CHAIN_ID,
        wallet: LEGACY_COLLECTION_WALLET,
        executor: target.executor,
        nonce: nonceLatest,
        to: target.executor,
        value: 0n,
        dataCommitment: keccak256(data),
        gasLimit: frozenTarget.gasLimit,
        maxFeePerGas: frozenTarget.maxFeePerGas,
        maxPriorityFeePerGas: 0n,
        token: LEGACY_COLLECTION_USDG,
        amount: liveTarget.balance,
        destination: LEGACY_COLLECTION_WALLET,
        executorUsdgBefore: liveTarget.balance,
        walletUsdgBefore,
        walletEthBefore,
        retainedEthWei: frozen.retainedEth,
      })
      appendAudit('mutation_intent', { kind: plan.kind, intentId: plan.intentId, createdAt: plan.createdAt })
      appendAudit('mutation_plan', plan)
      const serializedTransaction = await account.signTransaction({
        chainId: LEGACY_COLLECTION_CHAIN_ID,
        type: 'eip1559',
        to: target.executor,
        data,
        value: 0n,
        gas: frozenTarget.gasLimit,
        maxFeePerGas: frozenTarget.maxFeePerGas,
        maxPriorityFeePerGas: 0n,
        nonce: nonceLatest,
      })
      const hash = keccak256(serializedTransaction)
      const rawPrivateRef = persistSignedRaw(SIGNED_TX_DIR, hash, serializedTransaction)
      appendAudit('mutation_signed', {
        kind: plan.kind,
        targetId: target.id,
        hash,
        nonce: nonceLatest,
        intentId: plan.intentId,
        planHash: plan.planHash,
        rawPrivateRef,
      })
      try {
        const acceptedHash = await walletClient.sendRawTransaction({ serializedTransaction })
        if (acceptedHash.toLowerCase() !== hash.toLowerCase()) throw new Error('RPC returned a different hash')
        appendAudit('withdrawal_broadcast', { targetId: target.id, hash, nonce: nonceLatest })
      } catch (error) {
        appendAudit('withdrawal_broadcast_unknown', {
          targetId: target.id,
          hash,
          nonce: nonceLatest,
          error: errorText(error),
        })
      }
      let receipt
      try {
        receipt = await publicClient.waitForTransactionReceipt({
          hash,
          confirmations: RUNTIME_CONFIG.finalityConfirmations,
          timeout: 120_000,
        })
      } catch (error) {
        appendAudit('withdrawal_receipt_unknown', { targetId: target.id, hash, error: errorText(error) })
        throw new Error(`${target.id} withdrawal was broadcast but its receipt is UNKNOWN: ${hash}`)
      }
      if (receipt.status !== 'success') {
        const gasSpentWei = receipt.gasUsed * receipt.effectiveGasPrice
        appendAudit('withdrawal_reverted', { targetId: target.id, hash, blockNumber: receipt.blockNumber, gasSpentWei })
        appendAudit('mutation_reverted', {
          kind: plan.kind,
          hash,
          intentId: plan.intentId,
          planHash: plan.planHash,
          gasSpentWei,
        })
        throw new Error(`${target.id} withdrawal reverted: ${hash}`)
      }
      completed.push(await finalizeSuccessfulPlan(target, plan, hash, receipt))
    }

    const [walletUsdgAfter, walletEthAfter, nonceLatest, noncePending, targetBalances] = await Promise.all([
      publicClient.readContract({
        address: LEGACY_COLLECTION_USDG,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [LEGACY_COLLECTION_WALLET],
      }),
      publicClient.getBalance({ address: LEGACY_COLLECTION_WALLET }),
      publicClient.getTransactionCount({ address: LEGACY_COLLECTION_WALLET, blockTag: 'latest' }),
      publicClient.getTransactionCount({ address: LEGACY_COLLECTION_WALLET, blockTag: 'pending' }),
      Promise.all(
        LEGACY_COLLECTION_TARGETS.map((target) =>
          publicClient.readContract({
            address: LEGACY_COLLECTION_USDG,
            abi: ERC20_ABI,
            functionName: 'balanceOf',
            args: [target.executor],
          }),
        ),
      ),
    ])
    const totalAmount = frozen.targets.reduce((sum, target) => sum + target.balance, 0n)
    if (walletUsdgAfter - frozen.walletUsdg !== totalAmount) throw new Error('aggregate wallet USDG delta mismatch')
    if (targetBalances.some((balance) => balance !== 0n)) throw new Error('a legacy executor still holds USDG')
    if (walletEthAfter < LEGACY_COLLECTION_RETAINED_ETH_WEI) throw new Error('wallet ended below retained ETH floor')
    if (nonceLatest !== frozen.nonceStart + frozen.targets.length || noncePending !== nonceLatest) {
      throw new Error('aggregate nonce did not converge')
    }
    const result = {
      status: 'COLLECTION_COMPLETE',
      evidence: 'FINAL_RECEIPTS_WITHDRAWN_EVENTS_BALANCE_DELTAS_GAS_AND_NONCE_RECONCILED',
      wallet: LEGACY_COLLECTION_WALLET,
      amountUsdg: formatUnits(totalAmount, 6),
      walletUsdgAfter: formatUnits(walletUsdgAfter, 6),
      walletEthAfter: formatEther(walletEthAfter),
      nonceLatest,
      noncePending,
      transactions: completed,
    }
    appendAudit('legacy_collection_complete', result)
    console.log(stringify(result))
    return result
  } finally {
    release()
  }
}

async function reconcile() {
  assertLiveTransport(RUNTIME_CONFIG)
  assertSignerLanesInactive()
  const release = acquireWalletLock()
  try {
    assertSignerLanesInactive()
    const records = readAudit(AUDIT_PATH)
    const unresolved = latestUnresolvedMutation(records)
    if (!unresolved) {
      const result = { status: 'CLEAN', unresolvedMutation: null }
      console.log(stringify(result))
      return result
    }
    const plan = records.find((record) => record.event === 'mutation_plan' && record.planHash === unresolved.planHash)
    if (!plan) throw new Error(`missing mutation plan for ${unresolved.hash}`)
    const target = LEGACY_COLLECTION_TARGETS.find((candidate) => candidate.id === plan.targetId)
    if (!target) throw new Error(`unresolved mutation has unsupported target ${plan.targetId}`)
    const receipt = await publicClient.getTransactionReceipt({ hash: unresolved.hash }).catch(() => null)
    if (!receipt) {
      const [transaction, nonceLatest, noncePending] = await Promise.all([
        publicClient.getTransaction({ hash: unresolved.hash }).catch(() => null),
        publicClient.getTransactionCount({ address: LEGACY_COLLECTION_WALLET, blockTag: 'latest' }),
        publicClient.getTransactionCount({ address: LEGACY_COLLECTION_WALLET, blockTag: 'pending' }),
      ])
      const result = {
        status: 'RECONCILE_UNKNOWN',
        hash: unresolved.hash,
        transactionVisible: Boolean(transaction),
        nonceLatest,
        noncePending,
        action: 'DO_NOT_RESIGN_OR_ADVANCE_THIS_WALLET_LANE',
      }
      appendAudit('mutation_reconcile_observed', result)
      console.log(stringify(result))
      return result
    }
    const head = await publicClient.getBlockNumber()
    const confirmations = head >= receipt.blockNumber ? Number(head - receipt.blockNumber + 1n) : 0
    if (confirmations < RUNTIME_CONFIG.finalityConfirmations) {
      const result = { status: 'RECONCILE_PROVISIONAL', hash: unresolved.hash, confirmations }
      appendAudit('mutation_reconcile_observed', result)
      console.log(stringify(result))
      return result
    }
    if (receipt.status !== 'success') {
      const gasSpentWei = receipt.gasUsed * receipt.effectiveGasPrice
      appendAudit('withdrawal_reverted', {
        targetId: target.id,
        hash: unresolved.hash,
        blockNumber: receipt.blockNumber,
        gasSpentWei,
      })
      appendAudit('mutation_reverted', {
        kind: plan.kind,
        hash: unresolved.hash,
        intentId: plan.intentId,
        planHash: plan.planHash,
        gasSpentWei,
        reconciled: true,
      })
      const result = { status: 'RECONCILED_REVERTED', hash: unresolved.hash, gasSpentWei }
      console.log(stringify(result))
      return result
    }
    const record = await finalizeSuccessfulPlan(target, plan, unresolved.hash, receipt, true)
    const result = { status: 'RECONCILED_SUCCESS', transaction: record }
    console.log(stringify(result))
    return result
  } finally {
    release()
  }
}

async function status() {
  const blockNumber = await publicClient.getBlockNumber()
  const [walletEth, walletUsdg, nonceLatest, noncePending, targetBalances] = await Promise.all([
    publicClient.getBalance({ address: LEGACY_COLLECTION_WALLET, blockNumber }),
    publicClient.readContract({
      address: LEGACY_COLLECTION_USDG,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [LEGACY_COLLECTION_WALLET],
      blockNumber,
    }),
    publicClient.getTransactionCount({ address: LEGACY_COLLECTION_WALLET, blockTag: 'latest' }),
    publicClient.getTransactionCount({ address: LEGACY_COLLECTION_WALLET, blockTag: 'pending' }),
    Promise.all(
      LEGACY_COLLECTION_TARGETS.map((target) =>
        publicClient.readContract({
          address: LEGACY_COLLECTION_USDG,
          abi: ERC20_ABI,
          functionName: 'balanceOf',
          args: [target.executor],
          blockNumber,
        }),
      ),
    ),
  ])
  const unresolved = latestUnresolvedMutation(readAudit(AUDIT_PATH))
  const result = {
    status: unresolved ? 'UNKNOWN_MUTATION' : targetBalances.every((balance) => balance === 0n) ? 'COLLECTED' : 'READY',
    evidence: 'CURRENT_CHAIN_BALANCES_AND_LOCAL_COLLECTION_LEDGER',
    blockNumber,
    wallet: LEGACY_COLLECTION_WALLET,
    walletEth: formatEther(walletEth),
    walletUsdg: formatUnits(walletUsdg, 6),
    nonceLatest,
    noncePending,
    retainedEth: formatEther(LEGACY_COLLECTION_RETAINED_ETH_WEI),
    targets: LEGACY_COLLECTION_TARGETS.map((target, index) => ({
      id: target.id,
      executor: target.executor,
      balanceUsdg: formatUnits(targetBalances[index], 6),
    })),
    unresolvedMutation: unresolved
      ? { kind: unresolved.kind, hash: unresolved.hash, nonce: unresolved.nonce, targetId: unresolved.targetId }
      : null,
  }
  console.log(stringify(result))
  return result
}

const command = process.argv[2] || 'status'
try {
  if (command === 'preflight') await preflight()
  else if (command === 'execute') await execute()
  else if (command === 'reconcile') await reconcile()
  else if (command === 'status') await status()
  else throw new Error(`unknown command ${command}`)
} catch (error) {
  appendAudit('command_failed', { command, error: errorText(error) })
  console.error(errorText(error))
  process.exitCode = 1
}
