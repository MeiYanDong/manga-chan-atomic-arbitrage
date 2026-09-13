import assert from 'node:assert/strict'
import test from 'node:test'

import {
  assertEarnRouteShape,
  buildEarnOnHoodExactQuoteShortlist,
  enumerateEarnOnHoodCycles,
  normalizeEarnOnHoodCatalog,
} from '../src/earnonhood-graph.mjs'
import { EARN_ROUTE_DISCOVERY_POLICY, EARN_WETH } from '../src/earnonhood-routes.mjs'

const EARN = '0xa3b6aee90017b72c0812dc1e013de70eb2917ba3'
const PONS = '0x39dbed3a2bd333467115de45665cc57f813c4571'
const CASHCAT = '0x020bfc650a365f8bb26819deaabf3e21291018b4'

function token(address, symbol, balance = '1000000000000000000000') {
  return { address, symbol, decimals: 18, balance, weight: 50, priceUsd: 1 }
}

function pool(address, name, tokens) {
  return { address, name, initialized: true, tvlUsd: 1_000, swapFee: 0.3, tokens }
}

function catalog() {
  return normalizeEarnOnHoodCatalog({
    ready: true,
    calculatedAt: '2030-01-01T00:00:00.000Z',
    pools: [
      pool('0x0000000000000000000000000000000000000011', 'WETH EARN A', [
        token(EARN_WETH, 'WETH'),
        token(EARN, 'EARN'),
      ]),
      pool('0x0000000000000000000000000000000000000012', 'WETH EARN B', [
        token(EARN_WETH, 'WETH'),
        token(EARN, 'EARN'),
      ]),
      pool('0x0000000000000000000000000000000000000013', 'PONS ECO', [token(EARN_WETH, 'WETH'), token(PONS, 'PONS')]),
      pool('0x0000000000000000000000000000000000000014', 'PONS CASHCAT', [
        token(PONS, 'PONS'),
        token(CASHCAT, 'CASHCAT'),
      ]),
      pool('0x0000000000000000000000000000000000000015', 'CASHCAT WETH', [
        token(CASHCAT, 'CASHCAT'),
        token(EARN_WETH, 'WETH'),
      ]),
    ],
  })
}

test('dynamic graph discovers non-AI two-pool and longer simple cycles', () => {
  const normalized = catalog()
  const routes = enumerateEarnOnHoodCycles(normalized.pools)
  assert.ok(routes.some((route) => route.symbols.join('>') === 'WETH>EARN>WETH'))
  assert.ok(routes.some((route) => route.symbols.join('>') === 'WETH>PONS>CASHCAT>WETH'))
  assert.ok(routes.every((route) => !route.symbols.includes('AI') && !route.symbols.includes('MOO')))
  for (const route of routes) {
    assert.equal(route.steps[0].tokenIn.toLowerCase(), EARN_WETH.toLowerCase())
    assert.equal(route.steps.at(-1).tokenOut.toLowerCase(), EARN_WETH.toLowerCase())
    assert.equal(new Set(route.steps.map((step) => step.pool.toLowerCase())).size, route.steps.length)
    assert.equal(assertEarnRouteShape(route).id, route.id)
  }
})

test('catalog rejects malformed pools but keeps unrelated valid discovery', () => {
  const source = {
    ready: true,
    pools: [
      pool('0x0000000000000000000000000000000000000011', 'valid', [token(EARN_WETH, 'WETH'), token(EARN, 'EARN')]),
      pool('0x0000000000000000000000000000000000000012', 'bad fee', [token(EARN_WETH, 'WETH'), token(PONS, 'PONS')]),
    ],
  }
  source.pools[1].swapFee = 1
  const normalized = normalizeEarnOnHoodCatalog(source)
  assert.equal(normalized.pools.length, 1)
  assert.equal(normalized.rejected.length, 1)
  assert.match(normalized.rejected[0].reason, /swap fee/)
})

test('shortlist locally ranks the full graph and preserves bounded hop diversity', () => {
  const normalized = catalog()
  const routes = enumerateEarnOnHoodCycles(normalized.pools)
  const shortlist = buildEarnOnHoodExactQuoteShortlist({
    pools: normalized.pools,
    routes,
    amounts: [10_000_000_000_000n, 20_000_000_000_000n, 40_000_000_000_000n, 80_000_000_000_000n],
    gasPriceWei: 100_000_000n,
    focusPool: '0x0000000000000000000000000000000000000014',
  })
  const directCount = routes.filter((route) => route.steps.length === 2).length
  assert.equal(
    shortlist.selectedRoutes.filter((route) => route.steps.length === 2).length,
    Math.min(directCount, EARN_ROUTE_DISCOVERY_POLICY.shortlistRoutesPerHop),
  )
  assert.ok(shortlist.selectedRoutes.some((route) => route.steps.length === 3))
  assert.ok(shortlist.selectedRoutes.length <= EARN_ROUTE_DISCOVERY_POLICY.maximumShortlistRoutes)
  assert.ok(
    shortlist.quoteInputs.length <=
      EARN_ROUTE_DISCOVERY_POLICY.maximumShortlistRoutes * EARN_ROUTE_DISCOVERY_POLICY.coarseAmountsPerRoute,
  )
})

test('route shape rejects discontinuity, repeated pools, and non-final settlement', () => {
  const normalized = catalog()
  const route = enumerateEarnOnHoodCycles(normalized.pools).find((candidate) => candidate.steps.length === 3)
  assert.throws(
    () =>
      assertEarnRouteShape({
        ...route,
        steps: route.steps.map((step, index) => (index === 1 ? { ...step, tokenIn: EARN } : step)),
      }),
    /discontinuous/,
  )
  assert.throws(
    () =>
      assertEarnRouteShape({
        ...route,
        steps: route.steps.map((step, index) => (index === 1 ? { ...step, pool: route.steps[0].pool } : step)),
      }),
    /repeats a pool/,
  )
  assert.throws(() => assertEarnRouteShape({ ...route, steps: route.steps.slice(0, 2) }), /close only at the final hop/)
})
