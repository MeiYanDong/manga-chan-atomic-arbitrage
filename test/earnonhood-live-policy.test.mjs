import assert from 'node:assert/strict'
import test from 'node:test'
import { encodeAbiParameters } from 'viem'
import { decodeEarnOnHoodReceiptRoute } from '../src/earnonhood-receipt.mjs'
import {
  buildEarnOnHoodProbeAmounts,
  deriveEarnOnHoodExecutionBounds,
  earnOnHoodGasSolvency,
  preservesEarnOnHoodLongTermProfit,
  selectEarnOnHoodGasCandidates,
} from '../src/earnonhood-live-policy.mjs'
import {
  EARN_HOOD_ECOSYSTEM_POOL,
  EARN_POOL_ADDRESSES,
  EARN_ROUTES,
  EARN_ROUTE_COMMITMENT,
  EARN_ROUTE_STEPS,
  EARN_SWAP_EVENT_TOPIC,
  EARN_VAULT,
  EARN_WETH,
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

test('reviewed route book covers both two-pool AI directions and every directed pool edge', () => {
  assert.deepEqual(
    EARN_ROUTES.map((route) => route.id),
    ['WETH_AI_WETH_STOCK_LONG', 'WETH_AI_WETH_LONG_STOCK', 'WETH_AI_MOO_WETH', 'WETH_MOO_AI_WETH'],
  )
  assert.deepEqual(
    EARN_ROUTES.slice(0, 2).map((route) => route.steps.length),
    [2, 2],
  )
  assert.equal(new Set(EARN_ROUTES.map((route) => route.id)).size, EARN_ROUTES.length)
  assert.equal(new Set(EARN_POOL_ADDRESSES.map((pool) => pool.toLowerCase())).size, 3)
  assert.equal(
    new Set(
      EARN_ROUTE_STEPS.map(
        (step) => `${step.pool.toLowerCase()}:${step.tokenIn.toLowerCase()}:${step.tokenOut.toLowerCase()}`,
      ),
    ).size,
    EARN_ROUTE_STEPS.length,
  )
  for (const route of EARN_ROUTES) {
    assert.equal(route.steps[0].tokenIn.toLowerCase(), EARN_WETH.toLowerCase())
    assert.equal(route.steps.at(-1).tokenOut.toLowerCase(), EARN_WETH.toLowerCase())
    assert.equal(new Set(route.steps.map((step) => step.pool.toLowerCase())).size, route.steps.length)
  }
})

test('bounded Gas evaluation represents every profitable route before global fill', () => {
  const route = (id) => ({ id })
  const quotes = [
    { route: route('three-hop-a'), amountIn: 100n, amountOut: 150n },
    { route: route('three-hop-a'), amountIn: 100n, amountOut: 149n },
    { route: route('three-hop-a'), amountIn: 100n, amountOut: 148n },
    { route: route('two-hop'), amountIn: 100n, amountOut: 120n },
    { route: route('reverse'), amountIn: 100n, amountOut: 110n },
    { route: route('loss'), amountIn: 100n, amountOut: 99n },
  ]
  const selected = selectEarnOnHoodGasCandidates(quotes, 4)
  assert.deepEqual(
    selected.map((quote) => quote.route.id),
    ['three-hop-a', 'two-hop', 'reverse', 'three-hop-a'],
  )
  assert.equal(selected[0].amountOut, 150n)
  assert.equal(selected.at(-1).amountOut, 149n)
})

test('receipt decoder requires the exact committed pool/token sequence and amount continuity', () => {
  const route = EARN_ROUTES.find((candidate) => candidate.id === 'WETH_AI_MOO_WETH')
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

test('receipt decoder accepts the exact committed two-pool AI sequence', () => {
  const route = EARN_ROUTES.find((candidate) => candidate.id === 'WETH_AI_WETH_STOCK_LONG')
  const amounts = [1_000n, 1_050n, 1_025n]
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
})
