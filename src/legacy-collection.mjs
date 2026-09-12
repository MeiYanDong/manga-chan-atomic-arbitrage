import { getAddress } from 'viem'

export const LEGACY_COLLECTION_CHAIN_ID = 4_663
export const LEGACY_COLLECTION_WALLET = getAddress('0x77f771E83f118C32547A1291dda438a757B4b91B')
export const LEGACY_COLLECTION_USDG = getAddress('0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168')
export const LEGACY_COLLECTION_RETAINED_ETH_WEI = 2_500_000_000_000_000n

export const LEGACY_COLLECTION_TARGETS = Object.freeze([
  Object.freeze({
    id: 'MANGA',
    executor: getAddress('0x725B7B29679dF1de5A89B2A48CA7CED178bfa506'),
    runtimeCodeHash: '0x29c853078b2559e33b32eeee1bb5c74dfb597276d540243d1c079aef2330ba9e',
    deploymentTransaction: '0x4db5d6dc36a6c6ff6d3710880a98e7128158c789e23adefb277a531382464ee9',
    stateFile: 'state.json',
    stateLane: 'manga',
  }),
  Object.freeze({
    id: 'SPX',
    executor: getAddress('0x5eA86EAFB0F918557E1cE76E68F407568Dc2bCcd'),
    runtimeCodeHash: '0x27d996f187b176942b3181a93bbb061ddf96e99406752ea1290a663d40627577',
    deploymentTransaction: '0xb187570120b4d19d1baa9fbeb203adf29e808e50d033a1795d077b448eede0f0',
    stateFile: 'state.json',
    stateLane: 'spx',
  }),
])

/** @param {bigint} value @param {bigint} bps */
export function bpsCeil(value, bps) {
  if (value < 0n || bps < 0n) throw new Error('gas values must be non-negative')
  return (value * bps + 9_999n) / 10_000n
}

/**
 * @param {{
 *   id: string,
 *   executor: string,
 *   expectedExecutor: string,
 *   operator: string,
 *   expectedOperator: string,
 *   codeHash: string,
 *   expectedCodeHash: string,
 *   balance: bigint,
 *   simulationSucceeded: boolean,
 *   estimatedGas: bigint,
 * }} snapshot
 */
export function validateLegacyTargetSnapshot(snapshot) {
  if (snapshot.id !== 'MANGA' && snapshot.id !== 'SPX') throw new Error(`unsupported legacy target ${snapshot.id}`)
  if (getAddress(snapshot.executor) !== getAddress(snapshot.expectedExecutor)) {
    throw new Error(`${snapshot.id} executor mismatch`)
  }
  if (getAddress(snapshot.operator) !== getAddress(snapshot.expectedOperator)) {
    throw new Error(`${snapshot.id} operator mismatch`)
  }
  if (snapshot.codeHash.toLowerCase() !== snapshot.expectedCodeHash.toLowerCase()) {
    throw new Error(`${snapshot.id} runtime code hash mismatch`)
  }
  if (snapshot.balance <= 0n) throw new Error(`${snapshot.id} executor USDG balance is zero`)
  if (!snapshot.simulationSucceeded) throw new Error(`${snapshot.id} withdrawal simulation failed`)
  if (snapshot.estimatedGas <= 0n) throw new Error(`${snapshot.id} withdrawal gas estimate is invalid`)
  return snapshot
}

/**
 * Freeze the aggregate fee envelope before any signature. The caller must
 * re-check the nonce and target snapshot immediately before each signature.
 *
 * @param {{
 *   chainId: number,
 *   nonceLatest: number,
 *   noncePending: number,
 *   walletEth: bigint,
 *   gasPrice: bigint,
 *   retainedEth?: bigint,
 *   targets: Array<Parameters<typeof validateLegacyTargetSnapshot>[0]>,
 * }} input
 */
export function buildLegacyCollectionBudget(input) {
  if (input.chainId !== LEGACY_COLLECTION_CHAIN_ID) throw new Error(`wrong chain id ${input.chainId}`)
  if (input.nonceLatest !== input.noncePending) {
    throw new Error(`wallet has a pending nonce: ${input.nonceLatest}/${input.noncePending}`)
  }
  if (input.gasPrice <= 0n) throw new Error('gas price must be positive')
  if (input.targets.length === 0 || input.targets.length > LEGACY_COLLECTION_TARGETS.length) {
    throw new Error('the collection plan requires one or two allowlisted legacy targets')
  }
  const ids = new Set(input.targets.map((target) => target.id))
  /** @type {Set<string>} */
  const allowlistedIds = new Set(LEGACY_COLLECTION_TARGETS.map((target) => target.id))
  if (ids.size !== input.targets.length || [...ids].some((id) => !allowlistedIds.has(id))) {
    throw new Error('legacy collection targets must be unique allowlisted MANGA or SPX entries')
  }

  const retainedEth = input.retainedEth ?? LEGACY_COLLECTION_RETAINED_ETH_WEI
  if (retainedEth < LEGACY_COLLECTION_RETAINED_ETH_WEI) {
    throw new Error('retained ETH cannot be lower than the fixed 0.0025 ETH collection floor')
  }
  const maxFeePerGas = bpsCeil(input.gasPrice, 12_000n)
  const targets = input.targets.map((snapshot) => {
    validateLegacyTargetSnapshot(snapshot)
    const gasLimit = bpsCeil(snapshot.estimatedGas, 12_000n) + 5_000n
    const maxGasWei = gasLimit * maxFeePerGas
    return { ...snapshot, gasLimit, maxFeePerGas, maxGasWei }
  })
  const totalMaxGasWei = targets.reduce((sum, target) => sum + target.maxGasWei, 0n)
  const requiredWalletEth = retainedEth + totalMaxGasWei
  if (input.walletEth < requiredWalletEth) {
    throw new Error('wallet cannot fund both withdrawals while retaining the fixed ETH floor')
  }
  return {
    chainId: input.chainId,
    nonceStart: input.nonceLatest,
    walletEth: input.walletEth,
    gasPrice: input.gasPrice,
    retainedEth,
    totalMaxGasWei,
    requiredWalletEth,
    projectedMinimumWalletEth: input.walletEth - totalMaxGasWei,
    targets,
  }
}
