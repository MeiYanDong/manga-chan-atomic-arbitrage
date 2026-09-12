import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DUAL_AUTHORIZATION_LIFETIME,
  DUAL_AUTHORIZATION_POLICY_VERSION,
  DUAL_PRINCIPAL_POLICY,
  dualAuthorizationId,
  dualAuthorizationUsage,
  dualSpendablePrincipal,
  evaluateDualAuthorizationBudget,
  normalizeWethToUsdg,
  selectBestExactEvaluation,
  validateDualProfitFloors,
  validateDualSignedAttempt,
  wethFloorFromUsdg,
} from '../src/dual-live-policy.mjs'

function arm(overrides = {}) {
  const value = {
    schemaVersion: 1,
    mode: 'AUTO_POLICY',
    policyVersion: 'dual-base-loopback-escalation-v1',
    issuedAt: '2030-01-01T00:00:00.000Z',
    authorizationLifetime: DUAL_AUTHORIZATION_LIFETIME,
    principalPolicy: DUAL_PRINCIPAL_POLICY,
    chainId: 4_663,
    wallet: '0xwallet',
    usdgExecutor: '0xusdg',
    usdgSourceHash: '0x01',
    usdgRuntimeCodeHash: '0x02',
    usdgHardCapWei: '100000000',
    wethExecutor: '0xweth',
    wethSourceHash: '0x03',
    wethRuntimeCodeHash: '0x04',
    wethHardCapWei: '1000000000000000000',
    minimumNetProfitUsdgWei: '100000',
    minimumScreenedNetProfitUsdgWei: '100000',
    profitRetentionBps: 9500,
    walletEthReserveWei: '2000000000000000',
    maxFailedGasWei: '1000',
    baselineNonce: 12,
    baselineUsdgExecutionCount: 2,
    baselineWethExecutionCount: 1,
    usdgPrincipalWeiAtArm: '35000000',
    wethPrincipalWeiAtArm: '1000000000000000',
    pollIntervalMs: 1000,
    idleRpcBehavior: 'LOOPBACK_BOARD_ONLY',
    escalationRpcBehavior: 'SAME_BLOCK_DUAL_EXACT_PREFLIGHT_THEN_ONE_SIGNATURE',
    rpcSource: 'strategy_config',
    earnOnHood: {
      enabled: true,
      principalPolicy: 'AVAILABLE_WALLET_BALANCE_MINUS_GAS_AND_RESERVE_NO_FIXED_CAP',
      routeCommitment: '0xearn',
      initialGasSurplusWei: '5000',
      perAttemptGasCeilingWei: '500',
      walletReserveWei: '250',
    },
    ...overrides,
  }
  return { ...value, authorizationId: dualAuthorizationId(value) }
}

test('converts a common USDG net floor into WETH conservatively', () => {
  assert.equal(wethFloorFromUsdg(100_000n, 4_000_000_000_000_000n, 12_000_000n), 33_333_333_333_334n)
  assert.equal(normalizeWethToUsdg(33_333_333_333_334n, 4_000_000_000_000_000n, 12_000_000n), 100_000n)
  assert.equal(normalizeWethToUsdg(33_333_333_333_333n, 4_000_000_000_000_000n, 12_000_000n), 99_999n)
})

test('screen floor can trigger exact preflight without lowering the signed execution floor', () => {
  assert.deepEqual(validateDualProfitFloors(50_000n, 100_000n), {
    screenedNetFloorUsdg: 50_000n,
    exactNetFloorUsdg: 100_000n,
  })
  assert.throws(() => validateDualProfitFloors(0n, 100_000n), /positive/)
  assert.throws(() => validateDualProfitFloors(100_001n, 100_000n), /no greater/)

  const authorization = arm({
    policyVersion: DUAL_AUTHORIZATION_POLICY_VERSION,
    minimumScreenedNetProfitUsdgWei: '50000',
  })
  assert.deepEqual(evaluateDualAuthorizationBudget(authorization, { failedGasWei: 0n, earnGasSurplusWei: 5000n }), {
    allowed: true,
    reason: null,
  })
  assert.deepEqual(
    evaluateDualAuthorizationBudget(
      arm({ policyVersion: DUAL_AUTHORIZATION_POLICY_VERSION, minimumScreenedNetProfitUsdgWei: '100001' }),
      { failedGasWei: 0n, earnGasSurplusWei: 5000n },
    ),
    { allowed: false, reason: 'invalid-profit-floors' },
  )
})

test('selects the largest same-block normalized exact net across bases', () => {
  const selected = selectBestExactEvaluation([
    {
      status: 'EXACT_POSITIVE',
      exactBlockNumber: 10n,
      normalizedExactNetUsdg: 200_000n,
      maximumGasCostWei: 20n,
      candidate: { baseAsset: 'USDG', candidateHash: '0x02' },
    },
    {
      status: 'EXACT_POSITIVE',
      exactBlockNumber: 10n,
      normalizedExactNetUsdg: 210_000n,
      maximumGasCostWei: 30n,
      candidate: { baseAsset: 'WETH', candidateHash: '0x01' },
    },
    { status: 'REJECTED', error: 'revert', candidate: { baseAsset: 'USDG' } },
  ])
  assert.equal(selected.candidate.baseAsset, 'WETH')
  assert.throws(
    () =>
      selectBestExactEvaluation([
        {
          status: 'EXACT_POSITIVE',
          exactBlockNumber: 10n,
          normalizedExactNetUsdg: 1n,
          maximumGasCostWei: 1n,
          candidate: { baseAsset: 'USDG', candidateHash: 'a' },
        },
        {
          status: 'EXACT_POSITIVE',
          exactBlockNumber: 11n,
          normalizedExactNetUsdg: 2n,
          maximumGasCostWei: 1n,
          candidate: { baseAsset: 'WETH', candidateHash: 'b' },
        },
      ]),
    /one block/,
  )
})

test('authorization id excludes mutable status but commits every risk boundary', () => {
  const first = arm()
  assert.equal(dualAuthorizationId({ ...first, status: 'ARMED' }), first.authorizationId)
  assert.notEqual(dualAuthorizationId({ ...first, wethHardCapWei: '2' }), first.authorizationId)
  assert.notEqual(dualAuthorizationId({ ...first, baselineNonce: 13 }), first.authorizationId)
})

test('spendable principal compounds only receipt-proven profit and ignores external top-ups', () => {
  const authorization = arm({
    baselineUsdgExecutionCount: 1,
    baselineWethExecutionCount: 0,
    usdgPrincipalWeiAtArm: '35000000',
    usdgHardCapWei: '100000000',
  })
  const state = {
    executions: [
      { legacy: true },
      {
        baseAsset: 'USDG',
        authorizationId: authorization.authorizationId,
        executorBaseBeforeWei: '85000000',
        executorBaseAfterWei: '87500000',
        grossProfitWei: '2500000',
      },
    ],
  }

  assert.equal(dualSpendablePrincipal(authorization, state, 'USDG'), 37_500_000n)
  assert.equal(
    dualSpendablePrincipal(
      authorization,
      {
        executions: [
          ...state.executions,
          {
            baseAsset: 'USDG',
            authorizationId: authorization.authorizationId,
            executorBaseBeforeWei: '87500000',
            executorBaseAfterWei: '157500000',
            grossProfitWei: '70000000',
          },
        ],
      },
      'USDG',
    ),
    100_000_000n,
  )
})

test('spendable principal rejects incomplete, inconsistent or cross-authorization ledger evidence', () => {
  const authorization = arm({ baselineWethExecutionCount: 0 })
  const valid = {
    baseAsset: 'WETH',
    authorizationId: authorization.authorizationId,
    executorBaseBeforeWei: '1000000000000000',
    executorBaseAfterWei: '1100000000000000',
    grossProfitWei: '100000000000000',
  }
  assert.equal(dualSpendablePrincipal(authorization, { executions: [valid] }, 'WETH'), 1_100_000_000_000_000n)
  assert.throws(
    () => dualSpendablePrincipal(authorization, { executions: [{ ...valid, authorizationId: 'other' }] }, 'WETH'),
    /inconsistent/,
  )
  assert.throws(
    () => dualSpendablePrincipal(authorization, { executions: [{ ...valid, executorBaseAfterWei: '1' }] }, 'WETH'),
    /inconsistent/,
  )
  assert.throws(
    () => dualSpendablePrincipal(authorization, { executions: [{ ...valid, grossProfitWei: undefined }] }, 'WETH'),
    /lacks canonical/,
  )
})

test('usage comes from both ledgers and the append-only audit', () => {
  const authorization = arm()
  const records = [
    { event: 'mutation_signed', authorizationId: authorization.authorizationId, kind: 'generic-execute' },
    { event: 'mutation_signed', authorizationId: authorization.authorizationId, kind: 'weth-execute' },
    { event: 'dual_watch_exact_preflight_started', authorizationId: authorization.authorizationId },
    {
      event: 'mutation_reverted',
      authorizationId: authorization.authorizationId,
      kind: 'weth-execute',
      gasSpentWei: '40',
    },
    {
      event: 'mutation_signed',
      authorizationId: authorization.authorizationId,
      kind: 'earnonhood-execute',
    },
    {
      event: 'earn_watch_exact_preflight_started',
      authorizationId: authorization.authorizationId,
    },
    {
      event: 'mutation_effect',
      authorizationId: authorization.authorizationId,
      kind: 'earnonhood-execute',
      hash: '0xearn',
      realizedNetProfitWei: '250',
    },
  ]
  const usage = dualAuthorizationUsage(
    authorization,
    { executions: [{}, {}, {}] },
    { executions: [{}, {}, {}] },
    records,
  )
  assert.deepEqual(usage, {
    usdgConfirmed: 1,
    wethConfirmed: 2,
    earnConfirmed: 1,
    confirmedExecutions: 4,
    signedAttempts: 3,
    exactPreflights: 2,
    failedGasWei: 40n,
    earnRealizedNetProfitWei: 250n,
    earnFailedGasWei: 0n,
    earnGasSurplusWei: 5250n,
  })
  assert.equal(evaluateDualAuthorizationBudget(authorization, usage).allowed, true)
  assert.equal(
    evaluateDualAuthorizationBudget(authorization, { ...usage, failedGasWei: 1000n }).reason,
    'failed-gas-limit',
  )
})

test('broadcast reservation accepts only the unique latest unresolved signed raw', () => {
  const authorization = arm()
  const attempt = {
    event: 'mutation_signed',
    authorizationId: authorization.authorizationId,
    kind: 'weth-execute',
    intentId: 'intent',
    planHash: 'plan',
    hash: 'hash',
    nonce: 12,
  }
  assert.equal(validateDualSignedAttempt(authorization, [attempt], attempt, attempt).allowed, true)
  assert.equal(
    validateDualSignedAttempt(authorization, [attempt], { ...attempt, hash: 'other' }, attempt).allowed,
    false,
  )
})

test('v3 authorization counts Earn receipts in the single wallet nonce lane', () => {
  const authorization = arm({ policyVersion: DUAL_AUTHORIZATION_POLICY_VERSION })
  const attempt = {
    event: 'mutation_signed',
    authorizationId: authorization.authorizationId,
    kind: 'earnonhood-execute',
    intentId: 'earn-intent',
    planHash: 'earn-plan',
    hash: 'earn-hash',
    nonce: 12,
  }
  assert.equal(validateDualSignedAttempt(authorization, [attempt], attempt, attempt).allowed, true)
  assert.deepEqual(evaluateDualAuthorizationBudget(authorization, { failedGasWei: 0n, earnGasSurplusWei: 5000n }), {
    allowed: true,
    reason: null,
  })
  assert.equal(
    evaluateDualAuthorizationBudget(authorization, { failedGasWei: 0n, earnGasSurplusWei: 0n }).reason,
    'invalid-earnonhood-economics',
  )
})
