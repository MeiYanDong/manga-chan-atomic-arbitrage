import assert from 'node:assert/strict'
import test from 'node:test'
import {
  LEGACY_COLLECTION_CHAIN_ID,
  LEGACY_COLLECTION_RETAINED_ETH_WEI,
  LEGACY_COLLECTION_TARGETS,
  LEGACY_COLLECTION_WALLET,
  buildLegacyCollectionBudget,
  validateLegacyTargetSnapshot,
} from '../src/legacy-collection.mjs'

function snapshots() {
  return LEGACY_COLLECTION_TARGETS.map((target) => ({
    id: target.id,
    executor: target.executor,
    expectedExecutor: target.executor,
    operator: LEGACY_COLLECTION_WALLET,
    expectedOperator: LEGACY_COLLECTION_WALLET,
    codeHash: target.runtimeCodeHash,
    expectedCodeHash: target.runtimeCodeHash,
    balance: target.id === 'MANGA' ? 10_045_402n : 5_631_216n,
    simulationSucceeded: true,
    estimatedGas: 71_428n,
  }))
}

test('freezes both allowlisted withdrawals under one aggregate reserve envelope', () => {
  const budget = buildLegacyCollectionBudget({
    chainId: LEGACY_COLLECTION_CHAIN_ID,
    nonceLatest: 16,
    noncePending: 16,
    walletEth: 2_759_654_781_831_194n,
    gasPrice: 99_800_000n,
    targets: snapshots(),
  })
  assert.equal(budget.targets[0].gasLimit, 90_714n)
  assert.equal(budget.targets[0].maxFeePerGas, 119_760_000n)
  assert.equal(budget.totalMaxGasWei, 21_727_817_280_000n)
  assert.equal(budget.projectedMinimumWalletEth, 2_737_926_964_551_194n)
  assert.ok(budget.projectedMinimumWalletEth > LEGACY_COLLECTION_RETAINED_ETH_WEI)
})

test('rejects a pending nonce or insufficient aggregate ETH before signing', () => {
  const base = {
    chainId: LEGACY_COLLECTION_CHAIN_ID,
    nonceLatest: 16,
    noncePending: 16,
    walletEth: 2_759_654_781_831_194n,
    gasPrice: 99_800_000n,
    targets: snapshots(),
  }
  assert.throws(() => buildLegacyCollectionBudget({ ...base, noncePending: 17 }), /pending nonce/)
  assert.throws(
    () => buildLegacyCollectionBudget({ ...base, walletEth: LEGACY_COLLECTION_RETAINED_ETH_WEI }),
    /cannot fund both withdrawals/,
  )
})

test('fails closed on target, operator, code, balance, simulation and gas drift', () => {
  const [target] = snapshots()
  assert.throws(
    () => validateLegacyTargetSnapshot({ ...target, operator: '0x0000000000000000000000000000000000000001' }),
    /operator mismatch/,
  )
  assert.throws(() => validateLegacyTargetSnapshot({ ...target, codeHash: `0x${'00'.repeat(32)}` }), /code hash/)
  assert.throws(() => validateLegacyTargetSnapshot({ ...target, balance: 0n }), /balance is zero/)
  assert.throws(() => validateLegacyTargetSnapshot({ ...target, simulationSucceeded: false }), /simulation failed/)
  assert.throws(() => validateLegacyTargetSnapshot({ ...target, estimatedGas: 0n }), /gas estimate/)
})

test('accepts a recovery subset but rejects empty, duplicate or unknown targets', () => {
  const targetSet = snapshots()
  const base = {
    chainId: LEGACY_COLLECTION_CHAIN_ID,
    nonceLatest: 16,
    noncePending: 16,
    walletEth: 3_000_000_000_000_000n,
    gasPrice: 100_000_000n,
  }
  assert.equal(buildLegacyCollectionBudget({ ...base, targets: targetSet.slice(0, 1) }).targets.length, 1)
  assert.throws(() => buildLegacyCollectionBudget({ ...base, targets: [] }), /one or two allowlisted/)
  assert.throws(
    () => buildLegacyCollectionBudget({ ...base, targets: [targetSet[0], { ...targetSet[1], id: 'MANGA' }] }),
    /unique allowlisted/,
  )
  assert.throws(
    () => buildLegacyCollectionBudget({ ...base, targets: [{ ...targetSet[0], id: 'OTHER' }] }),
    /unique allowlisted/,
  )
})
