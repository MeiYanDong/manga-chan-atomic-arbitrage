import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildBptExecutionPlan,
  buildCycleExecutionPlan,
  equalPremiumAllocations,
} from '../src/global-execution-plan.mjs'
import {
  buildEarnBptArbitrageTemplates,
  buildUnifiedLiquidityGraph,
  enumerateCrossVenueCycles,
} from '../src/global-liquidity-graph.mjs'

const USDG = '0x0000000000000000000000000000000000000001'
const TOKEN = '0x0000000000000000000000000000000000000002'
const BPT = '0x0000000000000000000000000000000000000003'
const V3_A = '0x0000000000000000000000000000000000000011'
const V3_B = '0x0000000000000000000000000000000000000012'

function templates() {
  const graph = buildUnifiedLiquidityGraph({
    earnPools: [
      {
        address: BPT,
        initialized: true,
        tokens: [
          { address: USDG, symbol: 'USDG', decimals: 6 },
          { address: TOKEN, symbol: 'ANY', decimals: 18 },
        ],
      },
    ],
    v3Pools: [
      { address: V3_A, token0: USDG, token1: TOKEN, fee: 500 },
      { address: V3_B, token0: USDG, token1: BPT, fee: 500 },
    ],
  })
  return buildEarnBptArbitrageTemplates(graph, USDG)
}

function fixtureGraph() {
  return buildUnifiedLiquidityGraph({
    earnPools: [
      {
        address: BPT,
        initialized: true,
        tokens: [
          { address: USDG, symbol: 'USDG', decimals: 6 },
          { address: TOKEN, symbol: 'ANY', decimals: 18 },
        ],
      },
    ],
    v3Pools: [
      { address: V3_A, token0: USDG, token1: TOKEN, fee: 500 },
      { address: V3_B, token0: USDG, token1: BPT, fee: 500 },
    ],
  })
}

test('builds typed discount plan with remove hyperedge and zero-balance sentinels', () => {
  const template = templates().find((item) => item.kind === 'BPT_DISCOUNT_REMOVE_AND_SELL')
  const plan = buildBptExecutionPlan(template, { principal: 100n, minimumProfit: 1n, deadline: 1_000n })
  assert.deepEqual(
    plan.actions.map((item) => item.kind),
    [1, 5, 1],
  )
  assert.equal(plan.actions[0].amountIn, 100n)
  assert.equal(plan.actions[2].amountIn, 0n)
})

test('builds typed premium plan and consumes the exact allocation budget', () => {
  const template = templates().find((item) => item.kind === 'BPT_PREMIUM_BUY_AND_ADD')
  const allocations = equalPremiumAllocations(101n, template.buyComponents.length)
  assert.equal(
    allocations.reduce((total, amount) => total + amount, 0n),
    101n,
  )
  const plan = buildBptExecutionPlan(template, {
    principal: 101n,
    allocations,
    minimumProfit: 1n,
    deadline: 1_000n,
  })
  assert.ok(plan.actions.some((item) => item.kind === 4))
  assert.equal(plan.actions.at(-1).amountIn, 0n)
})

test('cross-venue cycle becomes one contiguous typed atomic plan', () => {
  const [cycle] = enumerateCrossVenueCycles(fixtureGraph(), USDG, { maximumHops: 3, maximumCycles: 32 })
  const plan = buildCycleExecutionPlan(cycle, { principal: 100n, minimumProfit: 5n, deadline: 999n })
  assert.equal(plan.settlementToken, USDG)
  assert.equal(plan.actions.length, cycle.edges.length)
  assert.equal(plan.actions[0].amountIn, 100n)
  assert.ok(plan.actions.slice(1).every((action) => action.amountIn === 0n))
  assert.equal(plan.actions.at(-1).tokenOut, USDG)
  assert.ok(new Set(cycle.edges.map((edge) => edge.venue)).size >= 2)
})
