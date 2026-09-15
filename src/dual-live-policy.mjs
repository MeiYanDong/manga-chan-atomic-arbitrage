import { keccak256, toHex } from 'viem'
import { EARN_SIZING_ALGORITHM } from './earnonhood-live-policy.mjs'
import {
  EARN_DISCOVERY_RPC_POLICY,
  EARN_EVENT_SOURCE_POLICY,
  EARN_MANAGED_FALLBACK_EVENT_LOGICAL_CALL_CAP,
  EARN_MANAGED_FALLBACK_RECOVERY_LOGICAL_CALL_CAP,
  EARN_PUBLIC_RECOVERY_POLL_MS,
} from './earn-rpc-policy.mjs'
import { EARN_ROUTE_DISCOVERY_POLICY, maximumEarnPublicExactQuotes } from './earnonhood-routes.mjs'
import {
  GLOBAL_ATOMIC_ROUTE_POLICY,
  GLOBAL_GRAPH_POLICY,
  GLOBAL_MAX_MANAGED_CANDIDATES_PER_WAKE,
} from './global-liquidity-graph.mjs'
import { GLOBAL_ROUTE_WORKSET_POLICY } from './global-route-selection.mjs'
import { GLOBAL_UNIVERSE_POLICY } from './global-universe-projection.mjs'
import {
  GLOBAL_MAX_SETTLEMENT_ASSETS_PER_WAKE,
  GLOBAL_MAX_SETTLEMENT_FUNDING_CHECKS_PER_WAKE,
  GLOBAL_SETTLEMENT_ADMISSION_POLICY,
} from './global-settlement-assets.mjs'
import {
  GLOBAL_EVENT_MAX_ROUTES_PER_WAKE,
  GLOBAL_FEED_MATCH_POLICY,
  GLOBAL_MANAGED_FALLBACK_EVENT_LOGICAL_CALL_CAP,
  GLOBAL_MANAGED_FALLBACK_RECOVERY_LOGICAL_CALL_CAP,
} from './global-wake-policy.mjs'
import { stableStringify } from './journal.mjs'
import { errorText, isGenericOpportunityMiss } from './policy.mjs'

export const DUAL_AUTHORIZATION_LIFETIME = 'UNTIL_REVOKED'
export const DUAL_PRINCIPAL_POLICY = 'ARM_PRINCIPAL_PLUS_CONFIRMED_GROSS_PROFIT_UP_TO_IMMUTABLE_CAP'
export const DUAL_AUTHORIZATION_POLICY_VERSION = 'dual-base-loopback-escalation-v13'
export const DUAL_WATCH_EXIT_STATUS = Object.freeze({
  UNKNOWN: 70,
  INVARIANT: 71,
  NONCE_CONFLICT: 72,
  TEMPORARY_FAILURE: 75,
})
const LEGACY_DUAL_AUTHORIZATION_POLICY_VERSION_V12 = 'dual-base-loopback-escalation-v12'
const LEGACY_DUAL_AUTHORIZATION_POLICY_VERSION_V11 = 'dual-base-loopback-escalation-v11'
const LEGACY_DUAL_AUTHORIZATION_POLICY_VERSION_V10 = 'dual-base-loopback-escalation-v10'
const LEGACY_DUAL_AUTHORIZATION_POLICY_VERSION_V9 = 'dual-base-loopback-escalation-v9'
const LEGACY_DUAL_AUTHORIZATION_POLICY_VERSION_V8 = 'dual-base-loopback-escalation-v8'
const LEGACY_DUAL_AUTHORIZATION_POLICY_VERSION_V7 = 'dual-base-loopback-escalation-v7'
const LEGACY_DUAL_AUTHORIZATION_POLICY_VERSION_V6 = 'dual-base-loopback-escalation-v6'
const LEGACY_DUAL_AUTHORIZATION_POLICY_VERSION_V5 = 'dual-base-loopback-escalation-v5'
const LEGACY_DUAL_AUTHORIZATION_POLICY_VERSION_V4 = 'dual-base-loopback-escalation-v4'
const LEGACY_DUAL_AUTHORIZATION_POLICY_VERSION = 'dual-base-loopback-escalation-v1'
const LEGACY_DUAL_AUTHORIZATION_POLICY_VERSION_V2 = 'dual-base-loopback-escalation-v2'
const LEGACY_DUAL_AUTHORIZATION_POLICY_VERSION_V3 = 'dual-base-loopback-escalation-v3'

/**
 * Exact candidates can decay between preflight and the final signing boundary.
 * This is a normal no-shot only while no signed mutation is unresolved; the
 * watcher checks that stronger condition before calling this classifier.
 *
 * @param {unknown} error
 */
export function isDualOpportunityMiss(error) {
  return (
    isGenericOpportunityMiss(error) ||
    /no dual-base candidate passed exact|no fresh typed dual-base|triggered dual-base candidate left|candidate exceeds realized authorized principal|principal is below candidate amount|exact normalized net profit is below|exact WETH simulation does not meet|WETH gross profit cannot fund|protected WETH max fee is below|worst-case Gas breaks|current gas price moved above|fee increased beyond the protected preflight cap|quote fell below the protected output floor|left the current dynamic Earn graph|absent from the current official catalog|selected opportunity decayed before signing|gross quote does not fund worst-case Gas plus net floor|protected gas limit is below the final exact estimate|global candidate (?:graph commitment|catalog version) changed before exact revalidation|global candidate (?:route|Earn pool) is absent from the current (?:committed graph|catalog)|global candidate principal exceeds current atomic funding/i.test(
      errorText(error),
    )
  )
}

/** @param {string | undefined | null} status */
export function dualWatcherExitCode(status) {
  if (status === 'HALTED_UNKNOWN') return DUAL_WATCH_EXIT_STATUS.UNKNOWN
  if (status === 'HALTED_NONCE_CONFLICT') return DUAL_WATCH_EXIT_STATUS.NONCE_CONFLICT
  if (['HALTED_INVARIANT', 'HALTED_STARTUP'].includes(String(status))) return DUAL_WATCH_EXIT_STATUS.INVARIANT
  if (status === 'HALTED_RPC') return DUAL_WATCH_EXIT_STATUS.TEMPORARY_FAILURE
  if (String(status || '').startsWith('HALTED')) return 1
  return 0
}

/**
 * The cheap board screen may be more permissive than the exact execution
 * floor, but it may never be zero or stricter than the execution floor. This
 * admits near-threshold read-only preflights without lowering the signed net
 * profit requirement.
 *
 * @param {bigint} screenedNetFloorUsdg
 * @param {bigint} exactNetFloorUsdg
 */
export function validateDualProfitFloors(screenedNetFloorUsdg, exactNetFloorUsdg) {
  if (exactNetFloorUsdg <= 0n || screenedNetFloorUsdg <= 0n || screenedNetFloorUsdg > exactNetFloorUsdg) {
    throw new Error('screened-net floor must be positive and no greater than the exact execution floor')
  }
  return { screenedNetFloorUsdg, exactNetFloorUsdg }
}

/** @param {bigint} numerator @param {bigint} denominator */
export function ceilDiv(numerator, denominator) {
  if (numerator < 0n || denominator <= 0n)
    throw new Error('ceil division requires non-negative numerator and positive denominator')
  return (numerator + denominator - 1n) / denominator
}

/**
 * Convert a USDG net floor into WETH at the exact block mark. The upward
 * rounding makes the WETH lane at least as strict as the common USDG floor.
 *
 * @param {bigint} minimumNetUsdg
 * @param {bigint} markInputWethWei
 * @param {bigint} markOutputUsdgWei
 */
export function wethFloorFromUsdg(minimumNetUsdg, markInputWethWei, markOutputUsdgWei) {
  if (minimumNetUsdg < 0n || markInputWethWei <= 0n || markOutputUsdgWei <= 0n) {
    throw new Error('invalid WETH floor conversion input')
  }
  return ceilDiv(minimumNetUsdg * markInputWethWei, markOutputUsdgWei)
}

/**
 * Conservatively normalize WETH profit into USDG for cross-lane ranking.
 * Downward rounding can never make a WETH candidate look more profitable.
 *
 * @param {bigint} wethWei
 * @param {bigint} markInputWethWei
 * @param {bigint} markOutputUsdgWei
 */
export function normalizeWethToUsdg(wethWei, markInputWethWei, markOutputUsdgWei) {
  if (wethWei < 0n || markInputWethWei <= 0n || markOutputUsdgWei <= 0n) {
    throw new Error('invalid WETH normalization input')
  }
  return (wethWei * markOutputUsdgWei) / markInputWethWei
}

/**
 * Advance authorized principal only by receipt-proven gross profit. The live
 * executor balance is still checked before signing, but it is deliberately not
 * the source of authority: an unrelated token transfer must not become
 * spendable merely because a later execution recorded the contract balance.
 *
 * @param {Record<string, any>} arm
 * @param {Record<string, any>} deploymentState
 * @param {'USDG' | 'WETH'} baseAsset
 */
export function dualSpendablePrincipal(arm, deploymentState, baseAsset) {
  if (!['USDG', 'WETH'].includes(baseAsset)) throw new Error(`unsupported principal base ${baseAsset}`)
  const isWeth = baseAsset === 'WETH'
  const baseline = Number(isWeth ? arm.baselineWethExecutionCount : arm.baselineUsdgExecutionCount)
  let principalAtArm
  let hardCap
  try {
    principalAtArm = BigInt(isWeth ? arm.wethPrincipalWeiAtArm : arm.usdgPrincipalWeiAtArm)
    hardCap = BigInt(isWeth ? arm.wethHardCapWei : arm.usdgHardCapWei)
  } catch {
    throw new Error(`${baseAsset} principal authorization values are invalid`)
  }
  const executions = deploymentState?.executions || []
  if (
    !Array.isArray(executions) ||
    !Number.isSafeInteger(baseline) ||
    baseline < 0 ||
    baseline > executions.length ||
    principalAtArm <= 0n ||
    hardCap <= 0n
  ) {
    throw new Error(`${baseAsset} principal authorization baseline is invalid`)
  }

  let authorized = principalAtArm
  for (const execution of executions.slice(baseline)) {
    let before
    let after
    let grossProfit
    try {
      before = BigInt(execution.executorBaseBeforeWei ?? execution.executorUsdgBeforeWei)
      after = BigInt(execution.executorBaseAfterWei ?? execution.executorUsdgAfterWei)
      grossProfit = BigInt(execution.grossProfitWei)
    } catch {
      throw new Error(`${baseAsset} execution ledger lacks canonical principal evidence`)
    }
    if (
      execution.baseAsset !== baseAsset ||
      execution.authorizationId !== arm.authorizationId ||
      before <= 0n ||
      grossProfit <= 0n ||
      after !== before + grossProfit
    ) {
      throw new Error(`${baseAsset} execution ledger principal evidence is inconsistent`)
    }
    authorized += grossProfit
  }
  return authorized < hardCap ? authorized : hardCap
}

/**
 * Select the largest exact, normalized net profit. Every viable evaluation
 * must come from the same current block so the USDG/WETH comparison is causal.
 *
 * @param {Array<Record<string, any>>} evaluations
 */
export function selectBestExactEvaluation(evaluations) {
  const viable = evaluations.filter((item) => !item.error && item.status === 'EXACT_POSITIVE')
  if (viable.length === 0) throw new Error('no dual-base candidate passed exact executor preflight')
  const blocks = new Set(viable.map((item) => String(item.exactBlockNumber)))
  if (blocks.size !== 1) throw new Error('dual-base exact evaluations were not produced at one block')
  for (const item of viable) {
    if (BigInt(item.normalizedExactNetUsdg) <= 0n) throw new Error('exact candidate is not normalized net-positive')
  }
  viable.sort((left, right) => {
    const leftNet = BigInt(left.normalizedExactNetUsdg)
    const rightNet = BigInt(right.normalizedExactNetUsdg)
    if (leftNet !== rightNet) return leftNet > rightNet ? -1 : 1
    const leftGas = BigInt(left.maximumGasCostWei)
    const rightGas = BigInt(right.maximumGasCostWei)
    if (leftGas !== rightGas) return leftGas < rightGas ? -1 : 1
    if (left.candidate.baseAsset !== right.candidate.baseAsset) {
      return left.candidate.baseAsset === 'WETH' ? -1 : 1
    }
    return String(left.candidate.candidateHash).localeCompare(String(right.candidate.candidateHash))
  })
  return viable[0]
}

/** @param {Record<string, any>} arm */
export function dualAuthorizationCommitment(arm) {
  return {
    schemaVersion: arm.schemaVersion,
    mode: arm.mode,
    policyVersion: arm.policyVersion,
    issuedAt: arm.issuedAt,
    authorizationLifetime: arm.authorizationLifetime,
    principalPolicy: arm.principalPolicy,
    chainId: arm.chainId,
    wallet: arm.wallet,
    usdgExecutor: arm.usdgExecutor,
    usdgSourceHash: arm.usdgSourceHash,
    usdgRuntimeCodeHash: arm.usdgRuntimeCodeHash,
    usdgHardCapWei: arm.usdgHardCapWei,
    wethExecutor: arm.wethExecutor,
    wethSourceHash: arm.wethSourceHash,
    wethRuntimeCodeHash: arm.wethRuntimeCodeHash,
    wethHardCapWei: arm.wethHardCapWei,
    minimumNetProfitUsdgWei: arm.minimumNetProfitUsdgWei,
    minimumScreenedNetProfitUsdgWei: arm.minimumScreenedNetProfitUsdgWei,
    profitRetentionBps: arm.profitRetentionBps,
    walletEthReserveWei: arm.walletEthReserveWei,
    maxFailedGasWei: arm.maxFailedGasWei,
    baselineNonce: arm.baselineNonce,
    baselineUsdgExecutionCount: arm.baselineUsdgExecutionCount,
    baselineWethExecutionCount: arm.baselineWethExecutionCount,
    usdgPrincipalWeiAtArm: arm.usdgPrincipalWeiAtArm,
    wethPrincipalWeiAtArm: arm.wethPrincipalWeiAtArm,
    pollIntervalMs: arm.pollIntervalMs,
    idleRpcBehavior: arm.idleRpcBehavior,
    escalationRpcBehavior: arm.escalationRpcBehavior,
    rpcSource: arm.rpcSource,
    earnOnHood: arm.earnOnHood,
    global: arm.global,
  }
}

/** @param {Record<string, any>} arm */
export function dualAuthorizationId(arm) {
  return keccak256(toHex(stableStringify(dualAuthorizationCommitment(arm))))
}

/**
 * Derive usage from canonical execution ledgers plus append-only mutation
 * records. Runtime display files are deliberately excluded.
 *
 * @param {Record<string, any>} arm
 * @param {Record<string, any>} usdgState
 * @param {Record<string, any>} wethState
 * @param {Array<Record<string, any>>} records
 */
export function dualAuthorizationUsage(arm, usdgState, wethState, records) {
  const usdgExecutions = usdgState?.executions || []
  const wethExecutions = wethState?.executions || []
  const baselineUsdg = Number(arm.baselineUsdgExecutionCount)
  const baselineWeth = Number(arm.baselineWethExecutionCount)
  if (
    !Array.isArray(usdgExecutions) ||
    !Array.isArray(wethExecutions) ||
    !Number.isSafeInteger(baselineUsdg) ||
    !Number.isSafeInteger(baselineWeth) ||
    baselineUsdg < 0 ||
    baselineWeth < 0 ||
    baselineUsdg > usdgExecutions.length ||
    baselineWeth > wethExecutions.length
  ) {
    throw new Error('dual authorization execution baseline is invalid')
  }
  const signedAttempts = records.filter(
    (record) =>
      record.event === 'mutation_signed' &&
      record.authorizationId === arm.authorizationId &&
      ['generic-execute', 'weth-execute', 'earnonhood-execute', 'global-execute'].includes(record.kind),
  ).length
  const exactPreflights = records.filter(
    (record) =>
      [
        'dual_watch_exact_preflight_started',
        'earn_watch_exact_preflight_started',
        'global_watch_exact_preflight_started',
      ].includes(record.event) && record.authorizationId === arm.authorizationId,
  ).length
  const revertedByHash = new Map()
  for (const [index, record] of records.entries()) {
    if (
      record.event !== 'mutation_reverted' ||
      record.authorizationId !== arm.authorizationId ||
      !['generic-execute', 'weth-execute', 'earnonhood-execute', 'global-execute'].includes(record.kind)
    ) {
      continue
    }
    const key = String(record.hash || record.planHash || `legacy-revert-${index}`).toLowerCase()
    const prior = revertedByHash.get(key)
    if (prior && BigInt(prior.gasSpentWei || 0) !== BigInt(record.gasSpentWei || 0)) {
      throw new Error('duplicate reverted transaction has conflicting canonical Gas')
    }
    if (!prior) revertedByHash.set(key, record)
  }
  const revertedTransactions = [...revertedByHash.values()]
  const failedGasWei = revertedTransactions.reduce((total, record) => total + BigInt(record.gasSpentWei || 0), 0n)
  const earnEffects = records.filter(
    (record) =>
      record.event === 'mutation_effect' &&
      record.authorizationId === arm.authorizationId &&
      record.kind === 'earnonhood-execute',
  )
  const earnConfirmed = new Set(earnEffects.map((record) => record.hash).filter(Boolean)).size
  const globalEffects = records.filter(
    (record) =>
      record.event === 'mutation_effect' &&
      record.authorizationId === arm.authorizationId &&
      record.kind === 'global-execute',
  )
  const globalConfirmed = new Set(globalEffects.map((record) => record.hash).filter(Boolean)).size
  const globalRealizedNetProfitUsdgWei = globalEffects.reduce(
    (total, record) => total + BigInt(record.normalizedNetProfitUsdgWei || 0),
    0n,
  )
  const earnRealizedNetProfitWei = earnEffects.reduce(
    (total, record) => total + BigInt(record.realizedNetProfitWei || 0),
    0n,
  )
  const earnFailedGasWei = revertedTransactions
    .filter((record) => record.kind === 'earnonhood-execute')
    .reduce((total, record) => total + BigInt(record.gasSpentWei || 0), 0n)
  const earnInitialGasSurplusWei = BigInt(arm.earnOnHood?.initialGasSurplusWei || 0)
  const earnGasSurplusWei = earnInitialGasSurplusWei + earnRealizedNetProfitWei - earnFailedGasWei
  const usdgConfirmed = usdgExecutions.length - baselineUsdg
  const wethConfirmed = wethExecutions.length - baselineWeth
  const confirmedExecutions = usdgConfirmed + wethConfirmed + earnConfirmed + globalConfirmed
  const revertedExecutionCount = revertedTransactions.length
  return {
    usdgConfirmed,
    wethConfirmed,
    earnConfirmed,
    globalConfirmed,
    confirmedExecutions,
    revertedExecutionCount,
    nonceConsumptions: confirmedExecutions + revertedExecutionCount,
    signedAttempts,
    exactPreflights,
    failedGasWei,
    earnRealizedNetProfitWei,
    earnFailedGasWei,
    earnGasSurplusWei,
    globalRealizedNetProfitUsdgWei,
  }
}

/**
 * A canonical revert consumes a wallet nonce just like a successful receipt.
 * Counting only profitable executions would make the next valid nonce look
 * like external wallet interference after the first reverted transaction.
 *
 * @param {Record<string, any>} arm
 * @param {{nonceConsumptions: number}} usage
 */
export function expectedDualWalletNonce(arm, usage) {
  const baselineNonce = Number(arm?.baselineNonce)
  const nonceConsumptions = Number(usage?.nonceConsumptions)
  if (!Number.isSafeInteger(baselineNonce) || baselineNonce < 0) throw new Error('invalid authorization baseline nonce')
  if (!Number.isSafeInteger(nonceConsumptions) || nonceConsumptions < 0) {
    throw new Error('invalid authorization nonce consumption count')
  }
  return baselineNonce + nonceConsumptions
}

/**
 * While one signed transaction is unresolved, the signer stays quarantined
 * but the supervisor may remain alive. The two permitted states are: not yet
 * observed (latest/pending at the planned nonce), pending, or already mined
 * but not yet reconciled (one nonce ahead).
 *
 * @param {Record<string, any>} arm
 * @param {{nonceConsumptions: number}} usage
 * @param {{nonceLatest: number, noncePending: number}} wallet
 * @param {Record<string, any> | null} unresolved
 */
export function evaluateDualWalletNonce(arm, usage, wallet, unresolved = null) {
  const expectedNonce = expectedDualWalletNonce(arm, usage)
  const latest = Number(wallet?.nonceLatest)
  const pending = Number(wallet?.noncePending)
  if (!Number.isSafeInteger(latest) || !Number.isSafeInteger(pending)) {
    return { allowed: false, expectedNonce, reason: 'invalid-wallet-nonce-read' }
  }
  if (!unresolved) {
    return latest === expectedNonce && pending === expectedNonce
      ? { allowed: true, expectedNonce, state: 'CONVERGED', reason: null }
      : { allowed: false, expectedNonce, reason: 'settled-wallet-nonce-mismatch' }
  }
  if (
    unresolved.authorizationId !== arm.authorizationId ||
    !Number.isSafeInteger(Number(unresolved.nonce)) ||
    Number(unresolved.nonce) !== expectedNonce
  ) {
    return { allowed: false, expectedNonce, reason: 'unresolved-mutation-not-next-authorized-nonce' }
  }
  if (latest < expectedNonce || latest > expectedNonce + 1 || pending < latest || pending > expectedNonce + 1) {
    return { allowed: false, expectedNonce, reason: 'quarantined-wallet-nonce-outside-expected-window' }
  }
  return { allowed: true, expectedNonce, state: 'SIGNING_QUARANTINED', reason: null }
}

/**
 * Count limits are intentionally absent for the until-revoked compounding
 * policy. Failed transaction gas remains a finite breaker.
 *
 * @param {Record<string, any>} arm
 * @param {{failedGasWei: bigint, earnGasSurplusWei?: bigint}} usage
 */
export function evaluateDualAuthorizationBudget(arm, usage) {
  if (
    arm.schemaVersion !== 1 ||
    arm.mode !== 'AUTO_POLICY' ||
    ![
      DUAL_AUTHORIZATION_POLICY_VERSION,
      LEGACY_DUAL_AUTHORIZATION_POLICY_VERSION_V12,
      LEGACY_DUAL_AUTHORIZATION_POLICY_VERSION_V11,
      LEGACY_DUAL_AUTHORIZATION_POLICY_VERSION_V10,
      LEGACY_DUAL_AUTHORIZATION_POLICY_VERSION_V9,
      LEGACY_DUAL_AUTHORIZATION_POLICY_VERSION_V8,
      LEGACY_DUAL_AUTHORIZATION_POLICY_VERSION_V7,
      LEGACY_DUAL_AUTHORIZATION_POLICY_VERSION_V6,
      LEGACY_DUAL_AUTHORIZATION_POLICY_VERSION_V5,
      LEGACY_DUAL_AUTHORIZATION_POLICY_VERSION_V4,
      LEGACY_DUAL_AUTHORIZATION_POLICY_VERSION_V3,
      LEGACY_DUAL_AUTHORIZATION_POLICY_VERSION_V2,
      LEGACY_DUAL_AUTHORIZATION_POLICY_VERSION,
    ].includes(arm.policyVersion) ||
    arm.authorizationLifetime !== DUAL_AUTHORIZATION_LIFETIME ||
    arm.principalPolicy !== DUAL_PRINCIPAL_POLICY ||
    arm.expiresAt !== undefined
  ) {
    return { allowed: false, reason: 'invalid-authorization-policy' }
  }
  if (
    [
      LEGACY_DUAL_AUTHORIZATION_POLICY_VERSION_V12,
      LEGACY_DUAL_AUTHORIZATION_POLICY_VERSION_V11,
      LEGACY_DUAL_AUTHORIZATION_POLICY_VERSION_V10,
      LEGACY_DUAL_AUTHORIZATION_POLICY_VERSION_V9,
      LEGACY_DUAL_AUTHORIZATION_POLICY_VERSION_V8,
    ].includes(arm.policyVersion)
  ) {
    return { allowed: false, reason: 'invalid-authorization-policy' }
  }
  if (
    arm.policyVersion === DUAL_AUTHORIZATION_POLICY_VERSION &&
    (arm.global?.enabled !== true ||
      arm.global?.lane !== 'global-v1' ||
      !/^0x[0-9a-f]{40}$/i.test(String(arm.global?.executor || '')) ||
      !/^0x[0-9a-f]{64}$/i.test(String(arm.global?.sourceHash || '')) ||
      !/^0x[0-9a-f]{64}$/i.test(String(arm.global?.runtimeCodeHash || '')) ||
      !Array.isArray(arm.global?.settlementSeeds) ||
      arm.global.settlementSeeds.length < 2 ||
      arm.global.settlementSeeds.length > 16 ||
      arm.global.settlementSeeds.some((asset) => !/^0x[0-9a-f]{40}$/i.test(String(asset))) ||
      new Set(arm.global.settlementSeeds.map((asset) => String(asset).toLowerCase())).size !==
        arm.global.settlementSeeds.length ||
      arm.global?.settlementPolicy !== GLOBAL_SETTLEMENT_ADMISSION_POLICY ||
      arm.global?.maximumSettlementFundingChecksPerWake !== GLOBAL_MAX_SETTLEMENT_FUNDING_CHECKS_PER_WAKE ||
      arm.global?.maximumSettlementAssetsPerWake !== GLOBAL_MAX_SETTLEMENT_ASSETS_PER_WAKE ||
      arm.global?.fundingPolicy !== 'MORPHO_ZERO_FEE_FLASH_OR_PROTECTED_EXECUTOR_INVENTORY' ||
      arm.global?.universePolicy !== GLOBAL_UNIVERSE_POLICY.version ||
      arm.global?.graphPolicy !== GLOBAL_GRAPH_POLICY.version ||
      arm.global?.routePolicy !== GLOBAL_ATOMIC_ROUTE_POLICY ||
      arm.global?.routeWorksetPolicy !== GLOBAL_ROUTE_WORKSET_POLICY ||
      !Number.isSafeInteger(arm.global?.maximumRoutesPerWake) ||
      arm.global.maximumRoutesPerWake < GLOBAL_EVENT_MAX_ROUTES_PER_WAKE ||
      arm.global.maximumRoutesPerWake > 256 ||
      arm.global?.maximumEventRoutesPerWake !== GLOBAL_EVENT_MAX_ROUTES_PER_WAKE ||
      !Number.isSafeInteger(arm.global?.quoteConcurrency) ||
      arm.global.quoteConcurrency < 1 ||
      arm.global.quoteConcurrency > 16 ||
      arm.global?.managedMaximumCandidatesPerWake !== GLOBAL_MAX_MANAGED_CANDIDATES_PER_WAKE ||
      !Number.isSafeInteger(arm.global?.managedFallbackDailyLogicalCallCap) ||
      arm.global.managedFallbackDailyLogicalCallCap < 1_000 ||
      arm.global.managedFallbackDailyLogicalCallCap > 1_000_000 ||
      arm.global?.managedFallbackEventLogicalCallCap !== GLOBAL_MANAGED_FALLBACK_EVENT_LOGICAL_CALL_CAP ||
      arm.global?.managedFallbackRecoveryLogicalCallCap !== GLOBAL_MANAGED_FALLBACK_RECOVERY_LOGICAL_CALL_CAP ||
      arm.global?.submissionPolicy !== 'DIRECT_SEQUENCER_THEN_SAME_RAW_MANAGED_FALLBACK' ||
      arm.global?.feedPolicy !== GLOBAL_FEED_MATCH_POLICY)
  ) {
    return { allowed: false, reason: 'invalid-global-policy' }
  }
  if (
    arm.policyVersion === DUAL_AUTHORIZATION_POLICY_VERSION &&
    (arm.earnOnHood?.discoveryRpc !== EARN_DISCOVERY_RPC_POLICY ||
      arm.earnOnHood?.eventSource !== EARN_EVENT_SOURCE_POLICY ||
      arm.earnOnHood?.eventPollMs !== EARN_PUBLIC_RECOVERY_POLL_MS ||
      arm.earnOnHood?.escalationRpc !== 'MANGA_RPC_URL_ONLY_AFTER_PUBLIC_NET_POSITIVE' ||
      !Number.isSafeInteger(arm.earnOnHood?.managedFallbackDailyLogicalCallCap) ||
      arm.earnOnHood.managedFallbackDailyLogicalCallCap < 1_000 ||
      arm.earnOnHood.managedFallbackDailyLogicalCallCap > 1_000_000 ||
      arm.earnOnHood?.managedFallbackEventLogicalCallCap !== EARN_MANAGED_FALLBACK_EVENT_LOGICAL_CALL_CAP ||
      arm.earnOnHood?.managedFallbackRecoveryLogicalCallCap !== EARN_MANAGED_FALLBACK_RECOVERY_LOGICAL_CALL_CAP)
  ) {
    return { allowed: false, reason: 'invalid-earnonhood-rpc-policy' }
  }
  let maxFailedGas
  let minimumNetProfitUsdg
  let minimumScreenedNetProfitUsdg
  try {
    maxFailedGas = BigInt(arm.maxFailedGasWei)
    minimumNetProfitUsdg = BigInt(arm.minimumNetProfitUsdgWei)
    minimumScreenedNetProfitUsdg = BigInt(arm.minimumScreenedNetProfitUsdgWei)
  } catch {
    return { allowed: false, reason: 'invalid-authorization-economics' }
  }
  if (maxFailedGas <= 0n) return { allowed: false, reason: 'invalid-failed-gas-limit' }
  try {
    validateDualProfitFloors(minimumScreenedNetProfitUsdg, minimumNetProfitUsdg)
  } catch {
    return { allowed: false, reason: 'invalid-profit-floors' }
  }
  if (usage.failedGasWei >= maxFailedGas) return { allowed: false, reason: 'failed-gas-limit' }
  if (
    [
      DUAL_AUTHORIZATION_POLICY_VERSION,
      LEGACY_DUAL_AUTHORIZATION_POLICY_VERSION_V5,
      LEGACY_DUAL_AUTHORIZATION_POLICY_VERSION_V4,
      LEGACY_DUAL_AUTHORIZATION_POLICY_VERSION_V3,
    ].includes(arm.policyVersion)
  ) {
    let initialGasSurplusWei
    let perAttemptGasCeilingWei
    let walletReserveWei
    try {
      initialGasSurplusWei = BigInt(arm.earnOnHood?.initialGasSurplusWei)
      perAttemptGasCeilingWei = BigInt(arm.earnOnHood?.perAttemptGasCeilingWei)
      walletReserveWei = BigInt(arm.earnOnHood?.walletReserveWei)
    } catch {
      return { allowed: false, reason: 'invalid-earnonhood-economics' }
    }
    if (
      arm.earnOnHood?.enabled !== true ||
      arm.earnOnHood?.principalPolicy !== 'AVAILABLE_WALLET_BALANCE_MINUS_GAS_AND_RESERVE_NO_FIXED_CAP' ||
      !arm.earnOnHood?.routeCommitment ||
      initialGasSurplusWei <= 0n ||
      perAttemptGasCeilingWei <= 0n ||
      walletReserveWei < 0n ||
      typeof usage.earnGasSurplusWei !== 'bigint' ||
      usage.earnGasSurplusWei <= 0n
    ) {
      return { allowed: false, reason: 'invalid-earnonhood-economics' }
    }
    if (
      [DUAL_AUTHORIZATION_POLICY_VERSION, LEGACY_DUAL_AUTHORIZATION_POLICY_VERSION_V6].includes(arm.policyVersion) &&
      (arm.earnOnHood?.sizingAlgorithm !== EARN_SIZING_ALGORITHM ||
        !Number.isSafeInteger(Number(arm.earnOnHood?.coarseProbePoints)) ||
        Number(arm.earnOnHood.coarseProbePoints) < 4 ||
        Number(arm.earnOnHood.coarseProbePoints) > 16 ||
        !Number.isSafeInteger(Number(arm.earnOnHood?.refinementPoints)) ||
        Number(arm.earnOnHood.refinementPoints) < 2 ||
        Number(arm.earnOnHood.refinementPoints) > 16 ||
        arm.earnOnHood?.poolScope !== EARN_ROUTE_DISCOVERY_POLICY.poolScope ||
        arm.earnOnHood?.catalogSource !== EARN_ROUTE_DISCOVERY_POLICY.catalogSource ||
        arm.earnOnHood?.factory?.toLowerCase() !== EARN_ROUTE_DISCOVERY_POLICY.factory.toLowerCase() ||
        Number(arm.earnOnHood?.maximumHops) !== EARN_ROUTE_DISCOVERY_POLICY.maximumHops ||
        Number(arm.earnOnHood?.publicMaximumExactQuotesPerWake) !==
          maximumEarnPublicExactQuotes(Number(arm.earnOnHood.refinementPoints)) ||
        Number(arm.earnOnHood?.managedMaximumExactQuotesPerWake) !== Number(arm.earnOnHood.refinementPoints) + 3)
    ) {
      return { allowed: false, reason: 'invalid-earnonhood-sizing-policy' }
    }
  }
  return { allowed: true, reason: null }
}

/**
 * At the last broadcast boundary, require the signed raw record to be the
 * unique latest unresolved mutation for this authorization.
 *
 * @param {Record<string, any>} arm
 * @param {Array<Record<string, any>>} records
 * @param {Record<string, any>} currentAttempt
 * @param {Record<string, any> | null} unresolved
 */
export function validateDualSignedAttempt(arm, records, currentAttempt, unresolved) {
  const matches = (record) =>
    record?.event === 'mutation_signed' &&
    record.authorizationId === arm.authorizationId &&
    record.kind === currentAttempt?.kind &&
    record.intentId === currentAttempt?.intentId &&
    record.planHash === currentAttempt?.planHash &&
    record.hash === currentAttempt?.hash &&
    String(record.nonce) === String(currentAttempt?.nonce)
  const authorized = records.filter(
    (record) =>
      record.event === 'mutation_signed' &&
      record.authorizationId === arm.authorizationId &&
      ['generic-execute', 'weth-execute', 'earnonhood-execute', 'global-execute'].includes(record.kind),
  )
  if (
    !currentAttempt ||
    !['generic-execute', 'weth-execute', 'earnonhood-execute', 'global-execute'].includes(currentAttempt.kind)
  ) {
    return { allowed: false, reason: 'signed-attempt-reservation-mismatch' }
  }
  if (
    authorized.filter(matches).length !== 1 ||
    authorized.at(-1) !== authorized.find(matches) ||
    !matches(unresolved)
  ) {
    return { allowed: false, reason: 'signed-attempt-reservation-mismatch' }
  }
  return { allowed: true, reason: null }
}
