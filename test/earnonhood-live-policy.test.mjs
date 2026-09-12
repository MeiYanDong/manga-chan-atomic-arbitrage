import assert from 'node:assert/strict'
import test from 'node:test'
import { encodeAbiParameters } from 'viem'
import { decodeEarnOnHoodReceiptRoute } from '../src/earnonhood-receipt.mjs'
import {
  buildEarnOnHoodProbeAmounts,
  deriveEarnOnHoodExecutionBounds,
  earnOnHoodGasSolvency,
  preservesEarnOnHoodLongTermProfit,
} from '../src/earnonhood-live-policy.mjs'
import {
  EARN_HOOD_ECOSYSTEM_POOL,
  EARN_ROUTES,
  EARN_ROUTE_COMMITMENT,
  EARN_SWAP_EVENT_TOPIC,
  EARN_VAULT,
  isEarnOnHoodRouteSwap,
} from '../src/earnonhood-routes.mjs'

test('protected output floor guarantees the requested net profit at the full gas cap', () => {
  const result = deriveEarnOnHoodExecutionBounds({
    amountInWei: 2_000_000_000_000_000n,
    quotedAmountOutWei: 2_158_791_832_578_822n,
    estimatedGas: 570_990n,
    observedFeePerGasWei: 133_113_600n,
    minimumNetProfitWei: 20_000_000_000_000n,
    minimumQuoteHeadroomWei: 10_000_000_000_000n,
  })

  assert.equal(result.executable, true)
  assert.ok(result.minimumAmountOutWei + result.quoteHeadroomWei === 2_158_791_832_578_822n)
  assert.equal(result.minimumAmountOutWei - 2_000_000_000_000_000n - result.maximumGasCostWei, 20_000_000_000_000n)
  assert.ok(result.quotedNetAtGasCapWei > 20_000_000_000_000n)
})

test('a positive gross quote is rejected when it cannot cover gas, net floor, and headroom', () => {
  const result = deriveEarnOnHoodExecutionBounds({
    amountInWei: 2_000_000_000_000_000n,
    quotedAmountOutWei: 2_050_000_000_000_000n,
    estimatedGas: 570_990n,
    observedFeePerGasWei: 133_113_600n,
    minimumNetProfitWei: 20_000_000_000_000n,
    minimumQuoteHeadroomWei: 10_000_000_000_000n,
  })

  assert.equal(result.executable, false)
  assert.equal(result.reason, 'QUOTE_HEADROOM_BELOW_FLOOR')
  assert.ok(result.grossProfitWei > 0n)
  assert.ok(result.quotedNetAtGasCapWei < 0n)
})

test('buffers cannot silently reduce estimated gas or observed fee', () => {
  assert.throws(
    () =>
      deriveEarnOnHoodExecutionBounds({
        amountInWei: 1n,
        quotedAmountOutWei: 2n,
        estimatedGas: 1n,
        observedFeePerGasWei: 1n,
        minimumNetProfitWei: 1n,
        minimumQuoteHeadroomWei: 0n,
        gasLimitBufferBps: 9_999n,
      }),
    /buffers must be at least 10000 bps/,
  )
})

test('balance-scaled sizing has no fixed principal cap and reaches all spendable balance', () => {
  const result = buildEarnOnHoodProbeAmounts({
    walletBalanceWei: 5_000_000_000_000_000_000n,
    walletReserveWei: 250_000_000_000_000n,
    gasRiskAllowanceWei: 120_000_000_000_000n,
    probePoints: 24,
  })

  assert.equal(result.spendableWei, 4_999_630_000_000_000_000n)
  assert.equal(result.amounts.at(-1), result.spendableWei)
  assert.ok(result.amounts.at(-1) > 2_000_000_000_000_000n)
  assert.ok(result.amounts.every((amount, index) => index === 0 || amount > result.amounts[index - 1]))
})

test('lifetime Gas solvency rebuilds old and current receipt evidence without double counting', () => {
  const ledger = earnOnHoodGasSolvency([
    {
      lane: 'earnonhood-one-shot-v1',
      event: 'mutation_effect',
      transaction: '0x01',
      realizedNetProfitEth: '0.000131868227091194',
    },
    {
      lane: 'earnonhood-one-shot-v1',
      event: 'mutation_effect',
      transaction: '0x01',
      realizedNetProfitEth: '0.000131868227091194',
    },
    {
      lane: 'earnonhood-v2',
      kind: 'earnonhood-execute',
      event: 'mutation_reverted',
      hash: '0x02',
      gasSpentWei: '40000000000000',
    },
  ])

  assert.equal(ledger.confirmedProfitableExecutions, 1)
  assert.equal(ledger.revertedExecutions, 1)
  assert.equal(ledger.surplusWei, 91_868_227_091_194n)
  assert.equal(preservesEarnOnHoodLongTermProfit(ledger.surplusWei, 90_000_000_000_000n), true)
  assert.equal(preservesEarnOnHoodLongTermProfit(ledger.surplusWei, ledger.surplusWei), false)
})

test('reviewed Vault Swap topics wake only the committed Earn route book', () => {
  const poolTopic = `0x${'0'.repeat(24)}${EARN_HOOD_ECOSYSTEM_POOL.slice(2).toLowerCase()}`
  assert.equal(isEarnOnHoodRouteSwap({ topics: [EARN_SWAP_EVENT_TOPIC, poolTopic] }), true)
  assert.equal(isEarnOnHoodRouteSwap({ topics: [EARN_SWAP_EVENT_TOPIC, `0x${'0'.repeat(64)}`] }), false)
  assert.match(EARN_ROUTE_COMMITMENT, /^0x[0-9a-f]{64}$/)
})

test('receipt decoder requires the exact committed pool/token sequence and amount continuity', () => {
  const route = EARN_ROUTES[0]
  const amounts = [1_000n, 1_100n, 1_200n, 1_300n]
  const topicAddress = (address) => `0x${'0'.repeat(24)}${address.slice(2).toLowerCase()}`
  const logs = route.steps.map((step, index) => ({
    address: EARN_VAULT,
    topics: [EARN_SWAP_EVENT_TOPIC, topicAddress(step.pool), topicAddress(step.tokenIn), topicAddress(step.tokenOut)],
    data: encodeAbiParameters(
      [{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }],
      [amounts[index], amounts[index + 1], 3n, 4n],
    ),
  }))
  assert.equal(decodeEarnOnHoodReceiptRoute({ logs }, route, amounts[0]).finalAmountOutWei, amounts.at(-1))
  assert.throws(
    () =>
      decodeEarnOnHoodReceiptRoute(
        { logs: logs.map((log, index) => (index === 1 ? { ...log, data: logs[0].data } : log)) },
        route,
        amounts[0],
      ),
    /differs/,
  )
})
