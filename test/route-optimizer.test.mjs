import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_AMOUNT_GRID_USDG,
  chooseBestAmountQuote,
  parseUsdgAmountGrid,
  refinementAmounts,
  shouldExpandAmountGrid,
} from '../src/route-optimizer.mjs'

test('amount grid is sorted, deduplicated and capped at 100 USDG', () => {
  assert.deepEqual(parseUsdgAmountGrid('25,5,12.5,5', DEFAULT_AMOUNT_GRID_USDG), [5_000_000n, 12_500_000n, 25_000_000n])
  assert.throws(() => parseUsdgAmountGrid('0', DEFAULT_AMOUNT_GRID_USDG), /greater than zero/)
  assert.throws(() => parseUsdgAmountGrid('100.000001', DEFAULT_AMOUNT_GRID_USDG), /at most 100/)
})

test('selection maximizes absolute net profit instead of ROI or input size', () => {
  const selected = chooseBestAmountQuote([
    { amountIn: 5_000_000n, grossProfitUsdg: 300_000n, screenedNetUsdg: 100_000n },
    { amountIn: 25_000_000n, grossProfitUsdg: 700_000n, screenedNetUsdg: 420_000n },
    { amountIn: 100_000_000n, grossProfitUsdg: 1_000_000n, screenedNetUsdg: -200_000n },
  ])
  assert.equal(selected.amountIn, 25_000_000n)

  const lowerCapitalTie = chooseBestAmountQuote([
    { amountIn: 10_000_000n, grossProfitUsdg: 500_000n, screenedNetUsdg: 300_000n },
    { amountIn: 25_000_000n, grossProfitUsdg: 500_000n, screenedNetUsdg: 300_000n },
  ])
  assert.equal(lowerCapitalTie.amountIn, 10_000_000n)
})

test('adaptive expansion reacts to edge, previous actionability, priority and periodic coverage', () => {
  const base = {
    probeQuotes: [],
    previousStatus: null,
    previousFullGridAt: null,
    priority: false,
    cycleNumber: 0,
    fullGridEveryCycles: 20,
    fullGridRefreshMs: 300_000,
    nowMs: 1_000_000,
  }
  assert.equal(shouldExpandAmountGrid(base), false)
  assert.equal(shouldExpandAmountGrid({ ...base, priority: true }), true)
  assert.equal(shouldExpandAmountGrid({ ...base, previousStatus: 'GROSS_POSITIVE_NET_NEGATIVE' }), true)
  assert.equal(
    shouldExpandAmountGrid({
      ...base,
      probeQuotes: [{ amountIn: 5_000_000n, grossProfitUsdg: 1n, screenedNetUsdg: -1n }],
    }),
    true,
  )
  assert.equal(shouldExpandAmountGrid({ ...base, cycleNumber: 19 }), true)
  assert.equal(
    shouldExpandAmountGrid({
      ...base,
      priority: true,
      previousStatus: 'SCREENED_NET_POSITIVE',
      previousFullGridAt: new Date(base.nowMs - 60_000).toISOString(),
    }),
    false,
  )
  assert.equal(
    shouldExpandAmountGrid({
      ...base,
      previousStatus: 'SCREENED_NET_POSITIVE',
      previousFullGridAt: new Date(base.nowMs - 300_000).toISOString(),
    }),
    true,
  )
})

test('midpoint refinement is bounded to the two neighbors of the coarse winner', () => {
  const grid = [5_000_000n, 10_000_000n, 25_000_000n, 50_000_000n]
  assert.deepEqual(refinementAmounts(grid, 25_000_000n), [17_500_000n, 37_500_000n])
  assert.deepEqual(refinementAmounts(grid, 5_000_000n), [7_500_000n])
  assert.deepEqual(refinementAmounts(grid, 12_000_000n), [])
})
