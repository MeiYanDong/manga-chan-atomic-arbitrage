import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_AMOUNT_GRID_USDG,
  chooseBestAmountQuote,
  equivalentWethAmountGrid,
  parseUsdgAmountGrid,
  refinementAmounts,
  selectEventProbeAmounts,
  planEventProbeAmounts,
  eventProbeNeedsExpansion,
  selectEventV4RoutePairs,
  selectV4RoutePairs,
  shouldExpandAmountGrid,
} from '../src/route-optimizer.mjs'

test('amount grid is sorted, deduplicated and capped at 100 USDG', () => {
  assert.deepEqual(parseUsdgAmountGrid('25,5,12.5,5', DEFAULT_AMOUNT_GRID_USDG), [5_000_000n, 12_500_000n, 25_000_000n])
  assert.throws(() => parseUsdgAmountGrid('0', DEFAULT_AMOUNT_GRID_USDG), /greater than zero/)
  assert.throws(() => parseUsdgAmountGrid('100.000001', DEFAULT_AMOUNT_GRID_USDG), /at most 100/)
})

test('USDG risk grid converts to same-block WETH equivalents without rounding risk upward', () => {
  const result = equivalentWethAmountGrid([5_000_000n, 10_000_000n, 25_000_000n], 4_000_000_000_000_000n, 10_000_000n)
  assert.deepEqual(result, [2_000_000_000_000_000n, 4_000_000_000_000_000n, 10_000_000_000_000_000n])
  assert.throws(() => equivalentWethAmountGrid([1n], 0n, 1n), /native mark/)
})

test('selection compares WETH candidates by normalized net USDG', () => {
  const selected = chooseBestAmountQuote([
    {
      amountIn: 2_000_000_000_000_000n,
      normalizedGrossProfitUsdg: 600_000n,
      normalizedScreenedNetUsdg: 300_000n,
    },
    {
      amountIn: 4_000_000_000_000_000n,
      normalizedGrossProfitUsdg: 800_000n,
      normalizedScreenedNetUsdg: 500_000n,
    },
  ])
  assert.equal(selected.amountIn, 4_000_000_000_000_000n)
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

test('V4 route-pair topology is ranked, deduplicated and bounded', () => {
  const route = (entry, exit, net) => ({
    entry: { pool: { poolId: entry } },
    exitPool: { poolId: exit },
    screening: { normalizedScreenedNetUsdg: net },
  })
  assert.deepEqual(
    selectV4RoutePairs([route('0xAA', '0xBB', 2n), route('0xaa', '0xbb', 1n), route('0xCC', '0xDD', 3n)], 2),
    [
      { entryPoolId: '0xcc', exitPoolId: '0xdd' },
      { entryPoolId: '0xaa', exitPoolId: '0xbb' },
    ],
  )
  assert.deepEqual(selectV4RoutePairs([route('0xAA', '0xaa', 3n)], 2), [])
  assert.throws(() => selectV4RoutePairs([], 0), /positive integer/)
})

test('event route probes prioritize the touched pool against the prior winning route', () => {
  const pools = [{ poolId: '0xAA' }, { poolId: '0xBB' }, { poolId: '0xCC' }]
  const previous = { legs: { entryPoolId: '0xAA', exitPoolId: '0xBB' } }
  assert.deepEqual(selectEventV4RoutePairs(pools, previous, ['0xCC'], 2), [
    { entryPoolId: '0xcc', exitPoolId: '0xbb' },
    { entryPoolId: '0xaa', exitPoolId: '0xcc' },
  ])
  assert.deepEqual(selectEventV4RoutePairs(pools, previous, ['0xAA'], 2), [
    { entryPoolId: '0xaa', exitPoolId: '0xbb' },
    { entryPoolId: '0xbb', exitPoolId: '0xaa' },
  ])
  assert.deepEqual(selectEventV4RoutePairs(pools, null, ['0xCC'], 1), [{ entryPoolId: '0xcc', exitPoolId: '0xaa' }])
  assert.deepEqual(selectEventV4RoutePairs([{ poolId: '0xAA' }], null, [], 2), [])
  assert.throws(() => selectEventV4RoutePairs(pools, previous, [], 0), /positive integer/)
})

test('event amount probes retain the prior winner plus the smallest affordable probe', () => {
  assert.deepEqual(selectEventProbeAmounts([10n, 5n], 17n, 100n, 2), [17n, 5n])
  assert.deepEqual(selectEventProbeAmounts([10n, 5n], 150n, 100n, 2), [5n, 10n])
  assert.deepEqual(selectEventProbeAmounts([5n, 10n], 5n, 100n, 2), [5n, 10n])
  assert.throws(() => selectEventProbeAmounts([5n], null, 0n, 2), /maximum amount/)
})

test('event probes defer the second size until a no-edge lane shows a gross signal', () => {
  assert.deepEqual(planEventProbeAmounts([5n, 10n], 10n, 100n, 2, false), {
    initial: [5n],
    deferred: [10n],
  })
  assert.deepEqual(planEventProbeAmounts([5n, 10n], 10n, 100n, 2, true), {
    initial: [10n, 5n],
    deferred: [],
  })
  assert.equal(eventProbeNeedsExpansion([{ grossProfitUsdg: 0n }]), false)
  assert.equal(eventProbeNeedsExpansion([{ grossProfitUsdg: -1n }]), false)
  assert.equal(eventProbeNeedsExpansion([{ grossProfitUsdg: 1n }]), true)
  assert.equal(eventProbeNeedsExpansion([{ error: 'UNQUOTABLE' }]), true)
  assert.equal(eventProbeNeedsExpansion([]), true)
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
