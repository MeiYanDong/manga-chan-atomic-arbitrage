import assert from 'node:assert/strict'
import test from 'node:test'

import { encodeAbiParameters, encodeEventTopics } from 'viem'

import {
  assertEarnCompetitorSnapshot,
  buildEarnCompetitorSnapshot,
  findEarnClosedCycles,
  findReviewedEarnCycles,
  reviewedReceiptRecord,
} from '../src/earn-competitor-census.mjs'
import { EARN_SWAP_ABI } from '../src/earnonhood-receipt.mjs'
import { EARN_ROUTES, EARN_VAULT } from '../src/earnonhood-routes.mjs'

const OWN = '0x1111111111111111111111111111111111111111'
const EXTERNAL = '0x2222222222222222222222222222222222222222'

function swapLog(step, amountIn, amountOut, logIndex) {
  return {
    address: EARN_VAULT,
    topics: encodeEventTopics({
      abi: EARN_SWAP_ABI,
      eventName: 'Swap',
      args: { pool: step.pool, tokenIn: step.tokenIn, tokenOut: step.tokenOut },
    }),
    data: encodeAbiParameters(
      [{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }],
      [amountIn, amountOut, 0n, 0n],
    ),
    logIndex,
  }
}

function receipt(route = EARN_ROUTES[0], actor = EXTERNAL) {
  let amount = 1_000_000_000_000_000n
  const logs = route.steps.map((step, index) => {
    const output = index === route.steps.length - 1 ? 1_100_000_000_000_000n : amount * 2n
    const log = swapLog(step, amount, output, index)
    amount = output
    return log
  })
  return {
    transactionHash: `0x${'a'.repeat(64)}`,
    blockNumber: 100n,
    blockHash: `0x${'b'.repeat(64)}`,
    from: actor,
    gasUsed: 10_000n,
    effectiveGasPrice: 1_000_000_000n,
    logs,
  }
}

test('competitor census accepts only an exact amount-linked reviewed route', () => {
  const exact = receipt()
  const cycles = findReviewedEarnCycles(exact)
  assert.equal(cycles.length, 1)
  assert.equal(cycles[0].routeId, EARN_ROUTES[0].id)
  const broken = receipt()
  broken.logs[1] = swapLog(EARN_ROUTES[0].steps[1], 3_000_000_000_000_000n, 3_100_000_000_000_000n, 1)
  assert.deepEqual(findReviewedEarnCycles(broken), [])
})

test('receipt record keeps route economics as an estimate and aliases the actor', () => {
  const record = reviewedReceiptRecord({
    receipt: receipt(),
    occurredAt: '2026-09-13T00:00:00.000Z',
    ownActors: [OWN],
  })
  assert.equal(record.actorClass, 'EXTERNAL')
  assert.match(record.actorAlias, /^外部地址 #[0-9a-f]{6}$/)
  assert.equal(record.grossProfitWeth, '0.0001')
  assert.equal(record.gasCostEth, '0.00001')
  assert.equal(record.estimatedNetEth, '0.00009')
  assert.equal(record.economicsState, 'WETH_CLOSED_CYCLE_RECEIPT_NET_ESTIMATE')
  assert.equal(record.wethCycleCount, 1)
})

test('generic census detects an arbitrary non-AI closed cycle without inventing ETH profit', () => {
  const TOKEN_A = '0x3333333333333333333333333333333333333333'
  const TOKEN_B = '0x4444444444444444444444444444444444444444'
  const route = /** @type {any} */ ({
    id: 'ARBITRARY_NON_AI',
    symbols: ['A', 'B', 'A'],
    steps: [
      { pool: '0x5555555555555555555555555555555555555555', tokenIn: TOKEN_A, tokenOut: TOKEN_B },
      { pool: '0x6666666666666666666666666666666666666666', tokenIn: TOKEN_B, tokenOut: TOKEN_A },
    ],
  })
  const closed = receipt(route)
  const cycles = findEarnClosedCycles(closed)
  assert.equal(cycles.length, 1)
  assert.equal(cycles[0].baseToken.toLowerCase(), TOKEN_A.toLowerCase())
  const record = reviewedReceiptRecord({ receipt: closed, occurredAt: '2026-09-13T00:00:00.000Z' })
  assert.equal(record.nonWethCycleCount, 1)
  assert.equal(record.estimatedNetEth, null)
  assert.equal(record.economicsState, 'NON_WETH_CLOSED_CYCLE_UNNORMALIZED')
})

test('public census delays exact evidence and never invents a lost race count', () => {
  const record = reviewedReceiptRecord({
    receipt: receipt(),
    occurredAt: '2026-09-13T00:08:00.000Z',
  })
  const state = {
    status: 'BACKFILLING',
    transactionsReviewed: 7,
    startBlock: '1',
    cursorBlock: '99',
    safeHeadBlock: '120',
  }
  const delayed = buildEarnCompetitorSnapshot({
    state,
    records: [record],
    now: new Date('2026-09-13T00:10:00.000Z'),
  })
  assert.equal(delayed.summary.externalCycleReceipts, 0)
  assert.equal(delayed.coverage.delayedReceipts, 1)
  assert.equal(delayed.summary.confirmedLostRaces, null)
  const disclosed = buildEarnCompetitorSnapshot({
    state: { ...state, status: 'CURRENT' },
    records: [record],
    now: new Date('2026-09-13T00:20:00.000Z'),
  })
  assert.equal(disclosed.summary.externalCycleReceipts, 1)
  assert.equal(disclosed.summary.distinctExternalActors, 1)
  assert.equal(disclosed.recentEvidence[0].route, 'WETH → AI → WETH')
  assert.doesNotThrow(() => assertEarnCompetitorSnapshot(disclosed))
})
