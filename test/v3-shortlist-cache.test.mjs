import assert from 'node:assert/strict'
import test from 'node:test'

import {
  V3ShortlistCache,
  seedV3ShortlistsFromObservations,
  selectV3BootstrapRoutes,
  v3DirectionKey,
} from '../src/v3-shortlist-cache.mjs'

const USDG = `0x${'1'.repeat(40)}`
const WETH = `0x${'2'.repeat(40)}`
const STOCK = `0x${'3'.repeat(40)}`
const POOL_A = `0x${'a'.repeat(40)}`
const POOL_B = `0x${'b'.repeat(40)}`
const route = (fee, pool, tokenIn = USDG, tokenOut = STOCK) => ({
  tokens: [tokenIn, tokenOut],
  fees: [fee],
  poolAddresses: [pool],
  path: `${tokenIn}${fee.toString(16).padStart(6, '0')}${tokenOut.slice(2)}`,
})

test('bounds, deduplicates and expires structural V3 shortlists', () => {
  const cache = new V3ShortlistCache({ maxRoutes: 2, refreshMs: 100 })
  const key = v3DirectionKey(USDG, STOCK, WETH)
  assert.equal(cache.set(key, [route(100, POOL_A), route(100, POOL_A), route(500, POOL_B)], 1_000), true)
  assert.equal(cache.get(key, 1_050).stale, false)
  assert.equal(cache.get(key, 1_100).stale, true)
  assert.deepEqual(
    cache.get(key).routes.map((item) => item.fees[0]),
    [100, 500],
  )
  assert.equal(cache.invalidateByPool(POOL_A), 1)
  assert.equal(cache.get(key, 1_001).stale, true)
})

test('hydrates USDG and WETH direction keys from prior amount quotes as stale seeds', () => {
  const cache = new V3ShortlistCache({ maxRoutes: 3, refreshMs: 300_000 })
  const observations = new Map([
    [
      'candidate',
      {
        quotedAt: '2026-09-08T00:00:00.000Z',
        baseOpportunities: {
          USDG: {
            amountQuotes: [
              {
                entryV3Tokens: [USDG, STOCK],
                entryV3Path: route(100, POOL_A).path,
                entryV3Pools: [POOL_A],
                legs: { entryV3Fees: [100] },
              },
            ],
          },
          WETH: {
            amountQuotes: [
              {
                exitV3Tokens: [STOCK, WETH],
                exitV3Path: route(500, POOL_B, STOCK, WETH).path,
                exitV3Pools: [POOL_B],
                legs: { exitV3Fees: [500] },
              },
            ],
          },
        },
      },
    ],
  ])

  assert.equal(seedV3ShortlistsFromObservations(cache, observations, { USDG, WETH }), 2)
  const usdg = cache.get(v3DirectionKey(USDG, STOCK, WETH), 1)
  const weth = cache.get(v3DirectionKey(STOCK, WETH, USDG), 1)
  assert.equal(usdg.routes[0].fees[0], 100)
  assert.equal(weth.routes[0].fees[0], 500)
  assert.equal(usdg.stale, true)
  assert.equal(weth.stale, true)
})

test('drops malformed or path-inconsistent route evidence rather than seeding it', () => {
  const cache = new V3ShortlistCache({ maxRoutes: 3, refreshMs: 100 })
  const key = v3DirectionKey(USDG, STOCK, WETH)
  assert.equal(cache.set(key, [{ tokens: [USDG], fees: [], poolAddresses: [], path: '0x' }]), false)
  assert.equal(cache.set(key, [{ ...route(100, POOL_A), path: route(500, POOL_A).path }]), false)
  assert.equal(cache.size, 0)
})

test('bootstrap discovery is deterministic, deduplicated and hard bounded', () => {
  const direct100 = route(100, POOL_A)
  const direct500 = route(500, POOL_B)
  const bridge = {
    tokens: [USDG, WETH, STOCK],
    fees: [100, 100],
    poolAddresses: [POOL_A, POOL_B],
    path: `${USDG}000064${WETH.slice(2)}000064${STOCK.slice(2)}`,
  }
  const selected = selectV3BootstrapRoutes([direct500, bridge, direct100, direct100], 2)
  assert.deepEqual(
    selected.map((item) => item.path),
    [direct100.path, bridge.path],
  )
  assert.throws(() => selectV3BootstrapRoutes([], 0), /positive integer/)
})
