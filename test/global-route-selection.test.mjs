import assert from 'node:assert/strict'
import test from 'node:test'

import {
  applyGlobalEventRouteBudget,
  applyGlobalRecoveryRouteBudget,
  selectGlobalRouteWorkset,
} from '../src/global-route-selection.mjs'

const WETH = '0x0000000000000000000000000000000000000001'
const ASSET = '0x0000000000000000000000000000000000000002'
const OTHER = '0x0000000000000000000000000000000000000003'
const THIRD = '0x0000000000000000000000000000000000000004'

function route(id, tokenIn, tokenOut, type = 'CYCLE') {
  return {
    id,
    type,
    opportunityKind: type === 'BPT' ? 'BPT_DISCOUNT' : 'CROSS_VENUE_2_HOP_CYCLE',
    edges: [
      {
        pool: `0x${String(100 + Number(id.replace(/\D/g, '') || 0)).padStart(40, '0')}`,
        tokenIn,
        tokenOut,
      },
    ],
  }
}

test('event workset receives projected non-hub dependencies and never fills hub-related routes', () => {
  const best = route('route-1', WETH, ASSET)
  const oneAsset = Array.from({ length: 9 }, (_, index) => route(`route-${index + 2}`, WETH, OTHER))
  const unrelated = route('route-99', OTHER, OTHER)
  const selected = selectGlobalRouteWorkset({
    routes: [unrelated, ...oneAsset, best],
    wakeAddresses: [ASSET],
    blockNumber: 123n,
    maximumRoutesPerWake: 32,
    maximumEventRoutesPerWake: 8,
  })
  assert.equal(selected.wakeKind, 'EVENT')
  assert.equal(selected.routes.length, 1)
  assert.equal(selected.routes[0].id, best.id)
  assert.equal(
    selected.routes.some((item) => item.id === unrelated.id),
    false,
  )
  assert.equal(selected.touchedRoutes, 1)
})

test('event workset ranks a route containing every changed non-hub asset first', () => {
  const both = route('route-1', ASSET, OTHER)
  const onlyFirst = route('route-2', ASSET, THIRD)
  const onlySecond = route('route-3', OTHER, THIRD)
  const selected = selectGlobalRouteWorkset({
    routes: [onlySecond, onlyFirst, both],
    wakeAddresses: [ASSET, OTHER],
    blockNumber: 123n,
    maximumRoutesPerWake: 32,
    maximumEventRoutesPerWake: 2,
  })
  assert.deepEqual(
    selected.routes.map((item) => item.id),
    ['route-1', 'route-2'],
  )
  assert.equal(selected.touchedRoutes, 3)
})

test('recovery workset retains BPT priority plus bounded broad rotation', () => {
  const routes = [
    route('route-1', WETH, ASSET, 'BPT'),
    ...Array.from({ length: 12 }, (_, i) => route(`route-${i + 2}`, WETH, OTHER)),
  ]
  const selected = selectGlobalRouteWorkset({
    routes,
    wakeAddresses: [],
    blockNumber: 5n,
    maximumRoutesPerWake: 8,
    maximumEventRoutesPerWake: 4,
  })
  assert.equal(selected.wakeKind, 'RECOVERY')
  assert.equal(selected.routes.length, 8)
  assert.equal(selected.routes[0].type, 'BPT')
  assert.ok(selected.routes.some((item) => item.type === 'CYCLE'))
  assert.equal(selected.routeLimit, 8)
})

test('one event budget is shared fairly across settlement assets', () => {
  const worksets = [
    {
      wakeKind: 'EVENT',
      routes: Array.from({ length: 8 }, (_, index) => route(`route-${index + 1}`, WETH, ASSET)),
    },
    {
      wakeKind: 'EVENT',
      routes: Array.from({ length: 8 }, (_, index) => route(`route-${index + 20}`, WETH, OTHER)),
    },
  ]
  const selected = applyGlobalEventRouteBudget(worksets, 8)
  assert.deepEqual(
    selected.map((workset) => workset.routes.length),
    [4, 4],
  )
  assert.deepEqual(
    selected.map((workset) => workset.preBudgetSelectedRoutes),
    [8, 8],
  )
})

test('an empty event lane yields its global route slots and recovery keeps its own bounds', () => {
  const event = applyGlobalEventRouteBudget(
    [
      { wakeKind: 'EVENT', routes: [] },
      {
        wakeKind: 'EVENT',
        routes: Array.from({ length: 10 }, (_, index) => route(`route-${index + 1}`, WETH, OTHER)),
      },
    ],
    8,
  )
  assert.deepEqual(
    event.map((workset) => workset.routes.length),
    [0, 8],
  )

  const recovery = [{ wakeKind: 'RECOVERY', routes: Array.from({ length: 12 }, (_, index) => route(`route-${index}`)) }]
  assert.equal(applyGlobalEventRouteBudget(recovery, 8), recovery)
})

test('dynamic settlement recovery shares one bounded route budget fairly', () => {
  const worksets = Array.from({ length: 4 }, (_, lane) => ({
    wakeKind: 'RECOVERY',
    routes: Array.from({ length: 12 }, (_, index) => route(`route-${lane * 20 + index + 1}`, WETH, OTHER)),
  }))
  const selected = applyGlobalRecoveryRouteBudget(worksets, 10)
  assert.equal(
    selected.reduce((total, workset) => total + workset.routes.length, 0),
    10,
  )
  assert.deepEqual(
    selected.map((workset) => workset.routes.length),
    [3, 3, 2, 2],
  )
})
