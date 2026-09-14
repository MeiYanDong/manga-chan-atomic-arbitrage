import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DUAL_AUTHORIZATION_LIFETIME,
  DUAL_AUTHORIZATION_POLICY_VERSION,
  DUAL_PRINCIPAL_POLICY,
  dualAuthorizationId,
  dualAuthorizationUsage,
  dualSpendablePrincipal,
  dualWatcherExitCode,
  evaluateDualAuthorizationBudget,
  evaluateDualWalletNonce,
  expectedDualWalletNonce,
  isDualOpportunityMiss,
  normalizeWethToUsdg,
  selectBestExactEvaluation,
  validateDualProfitFloors,
  validateDualSignedAttempt,
  wethFloorFromUsdg,
} from '../src/dual-live-policy.mjs'
import { EARN_SIZING_ALGORITHM } from '../src/earnonhood-live-policy.mjs'
import {
  EARN_DISCOVERY_RPC_POLICY,
  EARN_EVENT_SOURCE_POLICY,
  EARN_MANAGED_FALLBACK_EVENT_LOGICAL_CALL_CAP,
  EARN_MANAGED_FALLBACK_RECOVERY_LOGICAL_CALL_CAP,
  EARN_PUBLIC_RECOVERY_POLL_MS,
} from '../src/earn-rpc-policy.mjs'
import { EARN_ROUTE_DISCOVERY_POLICY, maximumEarnPublicExactQuotes } from '../src/earnonhood-routes.mjs'
import { GLOBAL_ATOMIC_ROUTE_POLICY, GLOBAL_GRAPH_POLICY } from '../src/global-liquidity-graph.mjs'
import { GLOBAL_ROUTE_WORKSET_POLICY } from '../src/global-route-selection.mjs'
import {
  GLOBAL_MAX_SETTLEMENT_ASSETS_PER_WAKE,
  GLOBAL_MAX_SETTLEMENT_FUNDING_CHECKS_PER_WAKE,
  GLOBAL_SETTLEMENT_ADMISSION_POLICY,
} from '../src/global-settlement-assets.mjs'
import {
  GLOBAL_EVENT_MAX_ROUTES_PER_WAKE,
  GLOBAL_FEED_MATCH_POLICY,
  GLOBAL_MANAGED_FALLBACK_EVENT_LOGICAL_CALL_CAP,
  GLOBAL_MANAGED_FALLBACK_RECOVERY_LOGICAL_CALL_CAP,
} from '../src/global-wake-policy.mjs'

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
      sizingAlgorithm: EARN_SIZING_ALGORITHM,
      poolScope: EARN_ROUTE_DISCOVERY_POLICY.poolScope,
      catalogSource: EARN_ROUTE_DISCOVERY_POLICY.catalogSource,
      factory: EARN_ROUTE_DISCOVERY_POLICY.factory,
      maximumHops: EARN_ROUTE_DISCOVERY_POLICY.maximumHops,
      coarseProbePoints: 8,
      refinementPoints: 6,
      publicMaximumExactQuotesPerWake: maximumEarnPublicExactQuotes(6),
      managedMaximumExactQuotesPerWake: 9,
      eventPollMs: EARN_PUBLIC_RECOVERY_POLL_MS,
      periodicMs: 300_000,
      discoveryRpc: EARN_DISCOVERY_RPC_POLICY,
      eventSource: EARN_EVENT_SOURCE_POLICY,
      escalationRpc: 'MANGA_RPC_URL_ONLY_AFTER_PUBLIC_NET_POSITIVE',
      managedFallbackDailyLogicalCallCap: 40_000,
      managedFallbackEventLogicalCallCap: EARN_MANAGED_FALLBACK_EVENT_LOGICAL_CALL_CAP,
      managedFallbackRecoveryLogicalCallCap: EARN_MANAGED_FALLBACK_RECOVERY_LOGICAL_CALL_CAP,
    },
    global: {
      enabled: true,
      lane: 'global-v1',
      executor: '0x0000000000000000000000000000000000000001',
      sourceHash: `0x${'11'.repeat(32)}`,
      runtimeCodeHash: `0x${'22'.repeat(32)}`,
      fundingPolicy: 'MORPHO_ZERO_FEE_FLASH_OR_PROTECTED_EXECUTOR_INVENTORY',
      settlementSeeds: ['0x0000000000000000000000000000000000000002', '0x0000000000000000000000000000000000000003'],
      settlementPolicy: GLOBAL_SETTLEMENT_ADMISSION_POLICY,
      maximumSettlementFundingChecksPerWake: GLOBAL_MAX_SETTLEMENT_FUNDING_CHECKS_PER_WAKE,
      maximumSettlementAssetsPerWake: GLOBAL_MAX_SETTLEMENT_ASSETS_PER_WAKE,
      graphPolicy: GLOBAL_GRAPH_POLICY.version,
      routePolicy: GLOBAL_ATOMIC_ROUTE_POLICY,
      routeWorksetPolicy: GLOBAL_ROUTE_WORKSET_POLICY,
      maximumRoutesPerWake: 32,
      maximumEventRoutesPerWake: GLOBAL_EVENT_MAX_ROUTES_PER_WAKE,
      quoteConcurrency: 8,
      managedMaximumCandidatesPerWake: 16,
      managedFallbackDailyLogicalCallCap: 20_000,
      managedFallbackEventLogicalCallCap: GLOBAL_MANAGED_FALLBACK_EVENT_LOGICAL_CALL_CAP,
      managedFallbackRecoveryLogicalCallCap: GLOBAL_MANAGED_FALLBACK_RECOVERY_LOGICAL_CALL_CAP,
      submissionPolicy: 'DIRECT_SEQUENCER_THEN_SAME_RAW_MANAGED_FALLBACK',
      feedPolicy: GLOBAL_FEED_MATCH_POLICY,
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

test('last-moment fee and quote decay reject one candidate without halting the watcher', () => {
  assert.equal(isDualOpportunityMiss(new Error('fee increased beyond the protected preflight cap')), true)
  assert.equal(isDualOpportunityMiss(new Error('quote fell below the protected output floor')), true)
  assert.equal(isDualOpportunityMiss(new Error('exact simulation does not meet the net floor')), true)
  assert.equal(isDualOpportunityMiss(new Error('candidate left the current dynamic Earn graph')), true)
  assert.equal(isDualOpportunityMiss(new Error('candidate pool is absent from the current official catalog')), true)
  assert.equal(isDualOpportunityMiss(new Error('reconciled receipt and wallet balance disagree')), false)
  assert.equal(isDualOpportunityMiss(new Error('executor operator mismatch')), false)
})

test('global quote and Gas drift are normal no-shot outcomes before a signature exists', () => {
  assert.equal(isDualOpportunityMiss(new Error('selected opportunity decayed before signing')), true)
  assert.equal(isDualOpportunityMiss(new Error('gross quote does not fund worst-case Gas plus net floor')), true)
  assert.equal(isDualOpportunityMiss(new Error('protected gas limit is below the final exact estimate')), true)
})

test('dual watcher exit codes restart only temporary failures', () => {
  assert.equal(dualWatcherExitCode('RUNNING'), 0)
  assert.equal(dualWatcherExitCode('STOPPED_POLICY'), 0)
  assert.equal(dualWatcherExitCode('HALTED_UNKNOWN'), 70)
  assert.equal(dualWatcherExitCode('HALTED_INVARIANT'), 71)
  assert.equal(dualWatcherExitCode('HALTED_STARTUP'), 71)
  assert.equal(dualWatcherExitCode('HALTED_NONCE_CONFLICT'), 72)
  assert.equal(dualWatcherExitCode('HALTED_RPC'), 75)
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

test('v12 authorization binds dynamic settlement admission, route relevance, RPC cost, and executor identity', () => {
  const valid = arm({ policyVersion: DUAL_AUTHORIZATION_POLICY_VERSION })
  assert.deepEqual(evaluateDualAuthorizationBudget(valid, { failedGasWei: 0n, earnGasSurplusWei: 5_000n }), {
    allowed: true,
    reason: null,
  })

  for (const managedFallbackDailyLogicalCallCap of [999, 1_000_001, null]) {
    assert.deepEqual(
      evaluateDualAuthorizationBudget(
        arm({
          policyVersion: DUAL_AUTHORIZATION_POLICY_VERSION,
          global: { ...valid.global, managedFallbackDailyLogicalCallCap },
        }),
        { failedGasWei: 0n, earnGasSurplusWei: 5_000n },
      ),
      { allowed: false, reason: 'invalid-global-policy' },
    )
  }

  for (const global of [
    { ...valid.global, maximumEventRoutesPerWake: GLOBAL_EVENT_MAX_ROUTES_PER_WAKE + 1 },
    { ...valid.global, managedFallbackEventLogicalCallCap: GLOBAL_MANAGED_FALLBACK_EVENT_LOGICAL_CALL_CAP + 1 },
    { ...valid.global, managedFallbackRecoveryLogicalCallCap: GLOBAL_MANAGED_FALLBACK_RECOVERY_LOGICAL_CALL_CAP + 1 },
    { ...valid.global, feedPolicy: 'SINGLE_COMMON_ASSET_WAKE' },
    { ...valid.global, routeWorksetPolicy: 'FILL_UNRELATED_ROUTES' },
    { ...valid.global, settlementPolicy: 'ALLOW_ANY_TOKEN' },
    { ...valid.global, maximumSettlementFundingChecksPerWake: 65 },
    { ...valid.global, maximumSettlementAssetsPerWake: 17 },
    { ...valid.global, graphPolicy: 'ROUTE_SPECIFIC' },
    { ...valid.global, routePolicy: 'CROSS_VENUE_ONLY' },
  ]) {
    assert.deepEqual(
      evaluateDualAuthorizationBudget(arm({ policyVersion: DUAL_AUTHORIZATION_POLICY_VERSION, global }), {
        failedGasWei: 0n,
        earnGasSurplusWei: 5_000n,
      }),
      { allowed: false, reason: 'invalid-global-policy' },
    )
  }

  for (const earnOnHood of [
    { ...valid.earnOnHood, sizingAlgorithm: 'UNREVIEWED' },
    { ...valid.earnOnHood, coarseProbePoints: 3 },
    { ...valid.earnOnHood, refinementPoints: 17 },
    { ...valid.earnOnHood, poolScope: 'FIXED_POOLS' },
    { ...valid.earnOnHood, catalogSource: 'WEB_API' },
    { ...valid.earnOnHood, factory: '0x0000000000000000000000000000000000000001' },
    { ...valid.earnOnHood, maximumHops: 5 },
    { ...valid.earnOnHood, publicMaximumExactQuotesPerWake: 57 },
    { ...valid.earnOnHood, managedMaximumExactQuotesPerWake: 10 },
    { ...valid.earnOnHood, discoveryRpc: 'PUBLIC_ONLY' },
    { ...valid.earnOnHood, eventSource: 'PUBLIC_POLL_ONLY' },
    { ...valid.earnOnHood, eventPollMs: 1_000 },
    { ...valid.earnOnHood, managedFallbackDailyLogicalCallCap: 999 },
    { ...valid.earnOnHood, managedFallbackEventLogicalCallCap: 129 },
    { ...valid.earnOnHood, managedFallbackRecoveryLogicalCallCap: 193 },
  ]) {
    assert.deepEqual(
      evaluateDualAuthorizationBudget(arm({ policyVersion: DUAL_AUTHORIZATION_POLICY_VERSION, earnOnHood }), {
        failedGasWei: 0n,
        earnGasSurplusWei: 5_000n,
      }),
      {
        allowed: false,
        reason:
          earnOnHood.sizingAlgorithm !== valid.earnOnHood.sizingAlgorithm ||
          earnOnHood.coarseProbePoints !== valid.earnOnHood.coarseProbePoints ||
          earnOnHood.refinementPoints !== valid.earnOnHood.refinementPoints ||
          earnOnHood.poolScope !== valid.earnOnHood.poolScope ||
          earnOnHood.catalogSource !== valid.earnOnHood.catalogSource ||
          earnOnHood.factory !== valid.earnOnHood.factory ||
          earnOnHood.maximumHops !== valid.earnOnHood.maximumHops ||
          earnOnHood.publicMaximumExactQuotesPerWake !== valid.earnOnHood.publicMaximumExactQuotesPerWake ||
          earnOnHood.managedMaximumExactQuotesPerWake !== valid.earnOnHood.managedMaximumExactQuotesPerWake
            ? 'invalid-earnonhood-sizing-policy'
            : 'invalid-earnonhood-rpc-policy',
      },
    )
  }
})

test('superseded v11 through v8 authorizations cannot bypass the v12 dynamic route policy', () => {
  for (const policyVersion of [
    'dual-base-loopback-escalation-v11',
    'dual-base-loopback-escalation-v10',
    'dual-base-loopback-escalation-v9',
    'dual-base-loopback-escalation-v8',
  ]) {
    const legacy = arm({ policyVersion })
    assert.deepEqual(evaluateDualAuthorizationBudget(legacy, { failedGasWei: 0n, earnGasSurplusWei: 5_000n }), {
      allowed: false,
      reason: 'invalid-authorization-policy',
    })
  }
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
      hash: '0xreverted',
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
    {
      event: 'mutation_signed',
      authorizationId: authorization.authorizationId,
      kind: 'global-execute',
    },
    {
      event: 'global_watch_exact_preflight_started',
      authorizationId: authorization.authorizationId,
    },
    {
      event: 'mutation_effect',
      authorizationId: authorization.authorizationId,
      kind: 'global-execute',
      hash: '0xglobal',
      normalizedNetProfitUsdgWei: '300000',
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
    globalConfirmed: 1,
    confirmedExecutions: 5,
    revertedExecutionCount: 1,
    nonceConsumptions: 6,
    signedAttempts: 4,
    exactPreflights: 3,
    failedGasWei: 40n,
    earnRealizedNetProfitWei: 250n,
    earnFailedGasWei: 0n,
    earnGasSurplusWei: 5250n,
    globalRealizedNetProfitUsdgWei: 300000n,
  })
  assert.equal(evaluateDualAuthorizationBudget(authorization, usage).allowed, true)
  assert.equal(
    evaluateDualAuthorizationBudget(authorization, { ...usage, failedGasWei: 1000n }).reason,
    'failed-gas-limit',
  )
})

test('canonical reverts consume nonce and allow the next authorized transaction', () => {
  const authorization = arm({ baselineNonce: 40 })
  const usage = {
    nonceConsumptions: 2,
  }
  assert.equal(expectedDualWalletNonce(authorization, usage), 42)
  assert.deepEqual(evaluateDualWalletNonce(authorization, usage, { nonceLatest: 42, noncePending: 42 }, null), {
    allowed: true,
    expectedNonce: 42,
    state: 'CONVERGED',
    reason: null,
  })
})

test('one unresolved transaction quarantines signing without requiring the supervisor to stop', () => {
  const authorization = arm({ baselineNonce: 40 })
  const usage = { nonceConsumptions: 1 }
  const unresolved = {
    authorizationId: authorization.authorizationId,
    nonce: 41,
    hash: '0xunknown',
  }
  for (const wallet of [
    { nonceLatest: 41, noncePending: 41 },
    { nonceLatest: 41, noncePending: 42 },
    { nonceLatest: 42, noncePending: 42 },
  ]) {
    assert.deepEqual(evaluateDualWalletNonce(authorization, usage, wallet, unresolved), {
      allowed: true,
      expectedNonce: 41,
      state: 'SIGNING_QUARANTINED',
      reason: null,
    })
  }
  assert.equal(
    evaluateDualWalletNonce(authorization, usage, { nonceLatest: 43, noncePending: 43 }, unresolved).reason,
    'quarantined-wallet-nonce-outside-expected-window',
  )
  assert.equal(
    evaluateDualWalletNonce(
      authorization,
      usage,
      { nonceLatest: 41, noncePending: 41 },
      {
        ...unresolved,
        authorizationId: 'other',
      },
    ).reason,
    'unresolved-mutation-not-next-authorized-nonce',
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

test('current authorization counts Earn receipts in the single wallet nonce lane', () => {
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
