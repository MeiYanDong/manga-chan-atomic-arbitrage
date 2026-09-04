import assert from 'node:assert/strict'
import test from 'node:test'
import {
  EventRevisionQueue,
  RpcErrorClass,
  classifyReconciliation,
  classifyRpcError,
  evaluateArmBudget,
  fixedSignerLaneConflict,
  latestUnresolvedMutation,
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
