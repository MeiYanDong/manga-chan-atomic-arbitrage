import { keccak256, toHex } from 'viem'
import { stableStringify } from './journal.mjs'

export const DUAL_AUTHORIZATION_LIFETIME = 'UNTIL_REVOKED'
export const DUAL_PRINCIPAL_POLICY = 'ARM_PRINCIPAL_PLUS_CONFIRMED_GROSS_PROFIT_UP_TO_IMMUTABLE_CAP'
export const DUAL_AUTHORIZATION_POLICY_VERSION = 'dual-base-loopback-escalation-v2'
const LEGACY_DUAL_AUTHORIZATION_POLICY_VERSION = 'dual-base-loopback-escalation-v1'

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
      ['generic-execute', 'weth-execute'].includes(record.kind),
  ).length
  const exactPreflights = records.filter(
    (record) => record.event === 'dual_watch_exact_preflight_started' && record.authorizationId === arm.authorizationId,
  ).length
  const failedGasWei = records
    .filter(
      (record) =>
        record.event === 'mutation_reverted' &&
        record.authorizationId === arm.authorizationId &&
        ['generic-execute', 'weth-execute'].includes(record.kind),
    )
    .reduce((total, record) => total + BigInt(record.gasSpentWei || 0), 0n)
  const usdgConfirmed = usdgExecutions.length - baselineUsdg
  const wethConfirmed = wethExecutions.length - baselineWeth
  return {
    usdgConfirmed,
    wethConfirmed,
    confirmedExecutions: usdgConfirmed + wethConfirmed,
    signedAttempts,
    exactPreflights,
    failedGasWei,
  }
}

/**
 * Count limits are intentionally absent for the until-revoked compounding
 * policy. Failed transaction gas remains a finite breaker.
 *
 * @param {Record<string, any>} arm
 * @param {{failedGasWei: bigint}} usage
 */
export function evaluateDualAuthorizationBudget(arm, usage) {
  if (
    arm.schemaVersion !== 1 ||
    arm.mode !== 'AUTO_POLICY' ||
    ![DUAL_AUTHORIZATION_POLICY_VERSION, LEGACY_DUAL_AUTHORIZATION_POLICY_VERSION].includes(arm.policyVersion) ||
    arm.authorizationLifetime !== DUAL_AUTHORIZATION_LIFETIME ||
    arm.principalPolicy !== DUAL_PRINCIPAL_POLICY ||
    arm.expiresAt !== undefined
  ) {
    return { allowed: false, reason: 'invalid-authorization-policy' }
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
      ['generic-execute', 'weth-execute'].includes(record.kind),
  )
  if (!currentAttempt || !['generic-execute', 'weth-execute'].includes(currentAttempt.kind)) {
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
