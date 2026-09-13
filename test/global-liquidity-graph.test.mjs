import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildEarnBptArbitrageTemplates,
  buildUnifiedLiquidityGraph,
  enumerateCrossVenueCycles,
  fundingCapability,
  selectBoundedManagedCandidates,
} from '../src/global-liquidity-graph.mjs'
import { loadRobinhoodHubUniswapCatalog } from '../src/robinhood-uniswap-catalog.mjs'

const USDG = '0x0000000000000000000000000000000000000001'
const WETH = '0x0000000000000000000000000000000000000002'
const STOCK = '0x0000000000000000000000000000000000000003'
const BPT = '0x0000000000000000000000000000000000000004'
const EARN_POOL = '0x0000000000000000000000000000000000000005'
const V3_A = '0x0000000000000000000000000000000000000011'
const V3_B = '0x0000000000000000000000000000000000000012'
const V4 = '0x0000000000000000000000000000000000000013'

function fixture() {
  return buildUnifiedLiquidityGraph({
    earnPools: [
      {
        address: BPT,
        name: 'arbitrary basket',
        initialized: true,
        paused: false,
        recoveryMode: false,
        tokens: [
          { address: WETH, symbol: 'WETH', decimals: 18 },
          { address: STOCK, symbol: 'STOCK', decimals: 18 },
        ],
      },
    ],
    v3Pools: [
      { address: V3_A, token0: USDG, token1: WETH, fee: 100 },
      { address: V3_B, token0: USDG, token1: BPT, fee: 500 },
    ],
    v4Pools: [
      {
        address: V4,
        poolId: `0x${'13'.repeat(32)}`,
        token0: USDG,
        token1: STOCK,
        fee: 1_500,
        tickSpacing: 15,
        hooks: '0x0000000000000000000000000000000000000000',
      },
    ],
  })
}

test('unifies Earn and Uniswap into asset edges plus Earn hyperedges', () => {
  const graph = fixture()
  assert.equal(graph.assets.size, 4)
  assert.equal(graph.edges.length, 8)
  assert.equal(graph.hyperedges.length, 2)
  assert.equal(graph.rejected.length, 0)
  assert.match(graph.commitment, /^0x[0-9a-f]{64}$/)
})

test('enumerates cross-venue cycles without token-name assumptions', () => {
  const cycles = enumerateCrossVenueCycles(fixture(), USDG)
  assert.ok(
    cycles.some(
      (cycle) =>
        cycle.edges.map((edge) => edge.venue).includes('EARN') &&
        cycle.edges.map((edge) => edge.venue).includes('UNISWAP_V3'),
    ),
  )
})

test('derives both BPT price-dislocation shapes when every basket leg connects', () => {
  const templates = buildEarnBptArbitrageTemplates(fixture(), USDG)
  assert.deepEqual(
    templates.map((template) => template.kind),
    ['BPT_DISCOUNT_REMOVE_AND_SELL', 'BPT_PREMIUM_BUY_AND_ADD'],
  )
  assert.ok(templates.every((template) => template.pool.toLowerCase() === BPT.toLowerCase()))
})

test('settlement is executable only with inventory or flash liquidity', () => {
  assert.equal(fundingCapability({ token: USDG }).executable, false)
  assert.deepEqual(fundingCapability({ token: USDG, morphoLiquidityWei: 1n }).modes, ['MORPHO_ZERO_FEE_FLASH'])
  assert.deepEqual(fundingCapability({ token: WETH, inventoryWei: 2n }).modes, ['EXECUTOR_INVENTORY'])
})

test('quarantines malformed or explicitly unsupported source records', () => {
  const graph = buildUnifiedLiquidityGraph({
    v2Pools: [{ address: EARN_POOL, token0: USDG, token1: USDG }],
    v3Pools: [{ address: V3_A, token0: USDG, token1: WETH, fee: 500, executable: false, reason: 'no code' }],
  })
  assert.equal(graph.edges.length, 0)
  assert.equal(graph.rejected.length, 2)
})

test('catalog quarantines factory entries that have no executable liquidity', async () => {
  const v2Pool = '0x0000000000000000000000000000000000000021'
  const v3Pool = '0x0000000000000000000000000000000000000022'
  const client = {
    async readContract({ functionName }) {
      if (functionName === 'getPair') return v2Pool
      if (functionName === 'getReserves') return [0n, 1n, 0]
      if (functionName === 'getPool') return v3Pool
      if (functionName === 'liquidity') return 0n
      throw new Error(`unexpected read ${functionName}`)
    },
  }
  const catalog = await loadRobinhoodHubUniswapCatalog(client, [STOCK], 123n)
  assert.equal(catalog.v2Pools.length, 0)
  assert.equal(catalog.v3Pools.length, 0)
  assert.ok(catalog.rejected.some((item) => item.venue === 'UNISWAP_V2' && item.reason === 'zero reserve'))
  assert.ok(catalog.rejected.some((item) => item.venue === 'UNISWAP_V3' && item.reason === 'zero active liquidity'))
})

test('managed exact work keeps one best amount per route and fair settlement coverage', () => {
  const candidate = (settlementToken, templateId, quoteDelta, fundingMode = 'MORPHO_FLASH') => ({
    settlementToken,
    templateId,
    quoteDelta: BigInt(quoteDelta),
    fundingMode,
    plan: { actions: [{}, {}] },
  })
  const selected = selectBoundedManagedCandidates(
    [
      candidate(USDG, 'usd-a', 4),
      candidate(USDG, 'usd-a', 8),
      candidate(USDG, 'usd-b', 7),
      candidate(WETH, 'eth-a', 3),
      candidate(WETH, 'eth-b', 2),
    ],
    3,
  )
  assert.deepEqual(
    selected.map((item) => `${item.settlementToken.toLowerCase()}:${item.templateId}:${item.quoteDelta}`),
    [`${USDG}:usd-a:8`, `${WETH}:eth-a:3`, `${USDG}:usd-b:7`],
  )
})
