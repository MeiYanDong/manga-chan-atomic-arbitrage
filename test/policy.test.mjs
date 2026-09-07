import assert from 'node:assert/strict'
import test from 'node:test'
import {
  EventRevisionQueue,
  RpcErrorClass,
  classifyReconciliation,
  classifyRpcError,
  diagnosticErrorText,
  errorText,
  evaluateArmBudget,
  evaluateExpiredMutationAbandonment,
  evaluateGenericArmBudget,
  evaluateGenericArmBudgetAtBroadcast,
  evaluateRawReplayDeadline,
  fixedSignerLaneConflict,
  genericSignerLaneConflict,
  isGenericOpportunityMiss,
  latestUnresolvedMutation,
  selectGenericWatchCandidate,
} from '../src/policy.mjs'

test('classifies a nested header-not-found failure as transient state readiness', () => {
  const error = new Error('Missing or invalid parameters')
  error.cause = { details: 'header not found', message: 'RPC error -32000' }
  assert.equal(classifyRpcError(error), RpcErrorClass.STATE_NOT_READY)
})

test('keeps a business invariant distinct from transport failures', () => {
  assert.equal(classifyRpcError(new Error('operator mismatch')), RpcErrorClass.INVARIANT)
  assert.equal(classifyRpcError(new Error('HTTP request timed out')), RpcErrorClass.NETWORK)
  assert.equal(classifyRpcError(new Error('429 Too Many Requests')), RpcErrorClass.THROTTLED)
})

test('classifies an identity-only unknown RPC wrapper as incomplete network evidence', () => {
  const inner = new Error('An unknown RPC error occurred.')
  inner.name = 'UnknownRpcError'
  const outer = new Error('contract call failed')
  outer.cause = inner
  assert.equal(classifyRpcError(outer), RpcErrorClass.NETWORK)
})

test('keeps an EVM quote revert distinct from its lower RPC transport wrapper', () => {
  const rpc = new Error('execution reverted: SPL')
  rpc.name = 'RpcRequestError'
  const reverted = new Error('Execution reverted with reason: SPL.')
  reverted.name = 'ExecutionRevertedError'
  reverted.cause = rpc
  const outer = new Error('The contract function reverted')
  outer.name = 'ContractFunctionRevertedError'
  outer.cause = reverted
  assert.equal(classifyRpcError(outer), RpcErrorClass.INVARIANT)
})

test('redacts credentialized RPC URLs before errors enter logs', () => {
  const error = new Error('HTTP request failed\nURL: https://node.example/v1/private-token?key=secret')
  assert.equal(errorText(error), 'HTTP request failed\nURL: <RPC_URL_REDACTED>')
  assert.doesNotMatch(errorText(error), /private-token|secret/)
  error.stack = `${error.stack}\n    at https://node.example/v1/private-token?key=secret:1:1`
  assert.match(diagnosticErrorText(error), /at <RPC_URL_REDACTED>/)
  assert.doesNotMatch(diagnosticErrorText(error), /private-token|secret/)
})

test('finds unresolved mutations across execute, deploy and withdraw', () => {
  /** @type {Array<Record<string, any>>} */
  const execute = [
    { event: 'mutation_signed', kind: 'execute', hash: '0x01' },
    { event: 'mutation_effect', kind: 'execute', hash: '0x01' },
    { event: 'mutation_signed', kind: 'withdraw', hash: '0x02' },
  ]
  assert.deepEqual(latestUnresolvedMutation(execute), { event: 'mutation_signed', kind: 'withdraw', hash: '0x02' })
  execute.push({ event: 'withdrawal_reverted', hash: '0x02' })
  assert.equal(latestUnresolvedMutation(execute), null)

  assert.equal(latestUnresolvedMutation([{ event: 'deployment_signed', hash: '0x03' }]).kind, 'deploy')
  assert.equal(
    latestUnresolvedMutation([
      { event: 'mutation_signed', kind: 'generic-execute', hash: '0x04' },
      { event: 'mutation_abandoned', hash: '0x04', result: 'EXPIRED_NOT_OBSERVED' },
    ]),
    null,
  )
})

test('reconciliation distinguishes final, provisional, pending and conflicting evidence', () => {
  const receipt = {
    transactionHash: '0xabc',
    blockHash: '0xdef',
    blockNumber: 100n,
    status: 'success',
  }
  assert.equal(
    classifyReconciliation([{ source: 'a', head: 102n, receipt, latestNonce: 2, pendingNonce: 2 }], 1, 3).state,
    'CONFIRMED_SUCCESS',
  )
  assert.equal(
    classifyReconciliation([{ source: 'a', head: 100n, receipt, latestNonce: 2, pendingNonce: 2 }], 1, 3).state,
    'PROVISIONAL_SUCCESS',
  )
  assert.equal(
    classifyReconciliation(
      [{ source: 'a', head: 100n, transaction: { hash: '0xabc' }, latestNonce: 1, pendingNonce: 2 }],
      1,
      3,
    ).state,
    'PENDING',
  )
  assert.equal(
    classifyReconciliation(
      [
        { source: 'a', head: 102n, receipt, latestNonce: 2, pendingNonce: 2 },
        { source: 'b', head: 102n, receipt: { ...receipt, blockHash: '0x999' }, latestNonce: 2, pendingNonce: 2 },
      ],
      1,
      3,
    ).state,
    'CONFLICT',
  )
})

test('reconciliation requires two clean readers before declaring not observed', () => {
  const one = [{ source: 'a', head: 100n, latestNonce: 1, pendingNonce: 1, transaction: null, receipt: null }]
  assert.equal(classifyReconciliation(one, 1, 3).state, 'UNKNOWN')
  assert.equal(classifyReconciliation([...one, { ...one[0], source: 'b' }], 1, 3).state, 'NOT_OBSERVED')
  assert.equal(classifyReconciliation([{ ...one[0], latestNonce: 2 }], 1, 3).state, 'NONCE_CONFLICT')
})

test('only an expired generic execution with two-reader absence can be abandoned', () => {
  const plan = { kind: 'generic-execute', nonce: 8, deadline: 100n }
  const observation = {
    head: 10n,
    headTimestamp: 101n,
    latestNonce: 8,
    pendingNonce: 8,
    transaction: null,
    receipt: null,
  }
  const absent = [
    { ...observation, source: 'primary' },
    { ...observation, source: 'secondary' },
  ]
  assert.equal(evaluateExpiredMutationAbandonment(plan, absent).allowed, true)
  assert.equal(
    evaluateExpiredMutationAbandonment(plan, [{ ...observation, source: 'primary' }]).reason,
    'reconciliation-unknown',
  )
  assert.equal(
    evaluateExpiredMutationAbandonment(plan, [
      { ...observation, source: 'primary', headTimestamp: 100n },
      { ...observation, source: 'secondary' },
    ]).reason,
    'deadline-not-expired-on-every-reader',
  )
  assert.equal(
    evaluateExpiredMutationAbandonment({ ...plan, kind: 'generic-withdraw' }, absent).reason,
    'unsupported-mutation-kind',
  )
  assert.equal(
    evaluateExpiredMutationAbandonment(
      plan,
      absent.map((item) => ({ ...item, latestNonce: 9 })),
    ).reason,
    'reconciliation-nonce_conflict',
  )
})

test('generic raw replay requires every reader timestamp to remain within deadline', () => {
  const plan = { kind: 'generic-execute', deadline: 100n }
  const observations = [
    { source: 'primary', headTimestamp: 100n },
    { source: 'secondary', headTimestamp: 99n },
  ]
  assert.equal(evaluateRawReplayDeadline(plan, observations).allowed, true)
  assert.equal(
    evaluateRawReplayDeadline(plan, [{ ...observations[0], headTimestamp: 101n }, observations[1]]).reason,
    'mutation-deadline-expired',
  )
  assert.equal(evaluateRawReplayDeadline(plan, observations.slice(0, 1)).reason, 'insufficient-reader-timestamps')
  assert.equal(evaluateRawReplayDeadline({ kind: 'generic-withdraw' }, []).allowed, true)
})

test('arm budget stops on each independent boundary', () => {
  const arm = {
    expiresAt: '2030-01-01T00:00:00.000Z',
    maxConfirmedExecutions: 5,
    maxAttempts: 5,
    maxFailedGasWei: '1000',
  }
  const base = { confirmedExecutions: 0, attempts: 0, failedGasWei: 0n, now: Date.parse('2029-01-01T00:00:00Z') }
  assert.equal(evaluateArmBudget(arm, base).allowed, true)
  assert.equal(evaluateArmBudget(arm, { ...base, confirmedExecutions: 5 }).reason, 'confirmed-execution-limit')
  assert.equal(evaluateArmBudget(arm, { ...base, attempts: 5 }).reason, 'attempt-limit')
  assert.equal(evaluateArmBudget(arm, { ...base, failedGasWei: 1000n }).reason, 'failed-gas-limit')
  assert.equal(evaluateArmBudget(arm, { ...base, now: Date.parse('2030-01-01T00:00:00Z') }).reason, 'expired')
})

test('generic arm independently bounds paid exact preflights', () => {
  const arm = {
    expiresAt: '2030-01-01T00:00:00.000Z',
    maxConfirmedExecutions: 5,
    maxAttempts: 5,
    maxFailedGasWei: '1000',
    maxExactPreflights: 2,
  }
  const usage = {
    confirmedExecutions: 0,
    attempts: 0,
    failedGasWei: 0n,
    exactPreflights: 1,
    now: Date.parse('2029-01-01T00:00:00Z'),
  }
  assert.equal(evaluateGenericArmBudget(arm, usage).allowed, true)
  assert.equal(evaluateGenericArmBudget(arm, { ...usage, exactPreflights: 2 }).reason, 'exact-preflight-limit')
  assert.equal(
    evaluateGenericArmBudget({ ...arm, maxExactPreflights: 0 }, usage).reason,
    'invalid-exact-preflight-limit',
  )
})

test('the exact fifth signed attempt can cross its broadcast boundary but cannot authorize a sixth', () => {
  const arm = {
    authorizationId: 'arm-1',
    expiresAt: '2030-01-01T00:00:00.000Z',
    maxConfirmedExecutions: 5,
    maxAttempts: 5,
    maxFailedGasWei: '1000',
    maxExactPreflights: 24,
  }
  const usage = {
    confirmedExecutions: 4,
    attempts: 5,
    failedGasWei: 0n,
    exactPreflights: 5,
    now: Date.parse('2029-01-01T00:00:00Z'),
  }
  const older = Array.from({ length: 4 }, (_, index) => ({
    event: 'mutation_signed',
    authorizationId: arm.authorizationId,
    kind: 'generic-execute',
    intentId: `intent-${index}`,
    planHash: `plan-${index}`,
    hash: `hash-${index}`,
    nonce: index,
  }))
  const current = {
    event: 'mutation_signed',
    authorizationId: arm.authorizationId,
    kind: 'generic-execute',
    intentId: 'intent-4',
    planHash: 'plan-4',
    hash: 'hash-4',
    nonce: 4,
  }
  const records = [...older, current]

  assert.equal(evaluateGenericArmBudgetAtBroadcast(arm, usage, records, current).allowed, true)
  assert.equal(evaluateGenericArmBudget(arm, usage).reason, 'attempt-limit')
  assert.equal(
    evaluateGenericArmBudgetAtBroadcast(arm, { ...usage, attempts: 6 }, records, current).reason,
    'signed-attempt-reservation-mismatch',
  )
})

test('broadcast reservation must be the exact latest unresolved signed mutation', () => {
  const arm = {
    authorizationId: 'arm-1',
    expiresAt: '2030-01-01T00:00:00.000Z',
    maxConfirmedExecutions: 5,
    maxAttempts: 5,
    maxFailedGasWei: '1000',
    maxExactPreflights: 24,
  }
  const usage = {
    confirmedExecutions: 4,
    attempts: 5,
    failedGasWei: 0n,
    exactPreflights: 5,
    now: Date.parse('2029-01-01T00:00:00Z'),
  }
  const current = {
    event: 'mutation_signed',
    authorizationId: arm.authorizationId,
    kind: 'generic-execute',
    intentId: 'intent-4',
    planHash: 'plan-4',
    hash: 'hash-4',
    nonce: 4,
  }
  const records = [
    ...Array.from({ length: 4 }, (_, index) => ({
      ...current,
      intentId: `intent-${index}`,
      planHash: `plan-${index}`,
      hash: `hash-${index}`,
      nonce: index,
    })),
    current,
  ]

  for (const [field, value] of Object.entries({
    authorizationId: 'wrong-arm',
    kind: 'generic-withdraw',
    intentId: 'wrong-intent',
    planHash: 'wrong-plan',
    hash: 'wrong-hash',
    nonce: 99,
  })) {
    assert.equal(
      evaluateGenericArmBudgetAtBroadcast(arm, usage, records, { ...current, [field]: value }).reason,
      'signed-attempt-reservation-mismatch',
      field,
    )
  }
  assert.equal(
    evaluateGenericArmBudgetAtBroadcast(arm, { ...usage, attempts: 6 }, [...records, current], current).reason,
    'signed-attempt-reservation-mismatch',
  )
  assert.equal(
    evaluateGenericArmBudgetAtBroadcast(
      arm,
      usage,
      [...records, { event: 'mutation_effect', hash: current.hash }],
      current,
    ).reason,
    'signed-attempt-reservation-mismatch',
  )
})

test('an in-flight reservation never relaxes expiry, confirmed execution, failed gas, or preflight caps', () => {
  const arm = {
    authorizationId: 'arm-1',
    expiresAt: '2030-01-01T00:00:00.000Z',
    maxConfirmedExecutions: 5,
    maxAttempts: 5,
    maxFailedGasWei: '1000',
    maxExactPreflights: 5,
  }
  const current = {
    event: 'mutation_signed',
    authorizationId: arm.authorizationId,
    kind: 'generic-execute',
    intentId: 'intent-4',
    planHash: 'plan-4',
    hash: 'hash-4',
    nonce: 4,
  }
  const records = [current]
  const usage = {
    confirmedExecutions: 4,
    attempts: 1,
    failedGasWei: 0n,
    exactPreflights: 4,
    now: Date.parse('2029-01-01T00:00:00Z'),
  }

  assert.equal(
    evaluateGenericArmBudgetAtBroadcast(arm, { ...usage, confirmedExecutions: 5 }, records, current).reason,
    'confirmed-execution-limit',
  )
  assert.equal(
    evaluateGenericArmBudgetAtBroadcast(arm, { ...usage, failedGasWei: 1000n }, records, current).reason,
    'failed-gas-limit',
  )
  assert.equal(
    evaluateGenericArmBudgetAtBroadcast(arm, { ...usage, exactPreflights: 5 }, records, current).reason,
    'exact-preflight-limit',
  )
  assert.equal(
    evaluateGenericArmBudgetAtBroadcast(arm, { ...usage, now: Date.parse('2030-01-01T00:00:00Z') }, records, current)
      .reason,
    'expired',
  )
})

test('generic watch selection enforces dedupe, principal and screened-net boundaries before RPC escalation', () => {
  const candidates = [
    { opportunityId: 'too-large', amountIn: 30_000_000n, screenedNetProfit: 500_000n },
    { opportunityId: 'attempted', amountIn: 10_000_000n, screenedNetProfit: 400_000n },
    { opportunityId: 'below-floor', amountIn: 10_000_000n, screenedNetProfit: 99_999n },
    { opportunityId: 'eligible', amountIn: 10_000_000n, screenedNetProfit: 100_000n },
  ]
  assert.equal(
    selectGenericWatchCandidate(candidates, {
      maxPrincipal: 15_000_000n,
      minimumScreenedNetProfit: 100_000n,
      attemptedOpportunityIds: ['attempted'],
    }).opportunityId,
    'eligible',
  )
  assert.equal(
    selectGenericWatchCandidate(candidates, {
      maxPrincipal: 5_000_000n,
      minimumScreenedNetProfit: 100_000n,
    }),
    null,
  )
})

test('generic watcher distinguishes economic misses from safety invariants', () => {
  assert.equal(isGenericOpportunityMiss(new Error('exact simulation does not meet the net floor')), true)
  assert.equal(isGenericOpportunityMiss(new Error('triggered candidate left the fresh board set')), true)
  assert.equal(isGenericOpportunityMiss(new Error('generic executor operator mismatch')), false)
})

test('generic signer lane fails closed on active or malformed fixed-signer state', () => {
  const nowMs = Date.parse('2026-09-05T00:00:00.000Z')
  const base = { lockExists: false, nowMs, processIsAlive: () => false }
  assert.match(
    fixedSignerLaneConflict({
      ...base,
      arm: { status: 'ARMED', expiresAt: '2026-09-05T00:01:00.000Z' },
    }),
    /still active/,
  )
  assert.match(fixedSignerLaneConflict({ ...base, arm: { status: 'ARMED', expiresAt: 'invalid' } }), /invalid expiry/)
  assert.match(fixedSignerLaneConflict({ ...base, lockExists: true, lockPid: null }), /lock is malformed/)
  assert.match(
    fixedSignerLaneConflict({ ...base, lockExists: true, lockPid: 42, processIsAlive: () => true }),
    /PID 42/,
  )
  assert.equal(
    fixedSignerLaneConflict({
      ...base,
      arm: { status: 'ARMED', expiresAt: '2026-09-04T23:59:59.000Z' },
      lockExists: true,
      lockPid: 42,
    }),
    null,
  )
})

test('fixed signer lane fails closed on an active generic-v2 signer', () => {
  const conflict = genericSignerLaneConflict({
    arm: { status: 'ARMED', expiresAt: '2030-01-01T00:00:00.000Z' },
    lockExists: false,
    nowMs: Date.parse('2029-01-01T00:00:00.000Z'),
    processIsAlive: () => false,
  })
  assert.match(conflict, /generic-v2 signing arm is still active/)
})

test('event queue deduplicates logs and collapses out-of-order revisions to the newest block', async () => {
  const queue = new EventRevisionQueue()
  assert.equal(queue.offer({ blockNumber: 10n, transactionHash: '0xa', logIndex: 1, source: 'V3_SWAP' }), true)
  assert.equal(queue.offer({ blockNumber: 10n, transactionHash: '0xa', logIndex: 1, source: 'V3_SWAP' }), false)
  queue.offer({ blockNumber: 8n, transactionHash: '0xb', logIndex: 0, source: 'V4_SWAP' })
  queue.offer({ blockNumber: 12n, transactionHash: '0xc', logIndex: 0, source: 'V4_SWAP' })
  assert.deepEqual(await queue.wait(1), {
    minBlock: 8n,
    maxBlock: 12n,
    count: 3,
    sources: ['V3_SWAP', 'V4_SWAP'],
  })
  assert.equal(await queue.wait(1), null)
})
