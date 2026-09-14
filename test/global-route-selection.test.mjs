import assert from 'node:assert/strict'
import test from 'node:test'

import { selectGlobalRouteWorkset } from '../src/global-route-selection.mjs'

const WETH = '0x0000000000000000000000000000000000000001'
const ASSET = '0x0000000000000000000000000000000000000002'
const OTHER = '0x0000000000000000000000000000000000000003'

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

test('event workset ranks two-asset relevance and never fills unrelated routes', () => {
  const best = route('route-1', WETH, ASSET)
  const oneAsset = Array.from({ length: 9 }, (_, index) => route(`route-${index + 2}`, WETH, OTHER))
  const unrelated = route('route-99', OTHER, OTHER)
  const selected = selectGlobalRouteWorkset({
    routes: [unrelated, ...oneAsset, best],
    wakeAddresses: [WETH, ASSET],
    blockNumber: 123n,
    maximumRoutesPerWake: 32,
    maximumEventRoutesPerWake: 8,
  })
  assert.equal(selected.wakeKind, 'EVENT')
  assert.equal(selected.routes.length, 8)
  assert.equal(selected.routes[0].id, best.id)
  assert.equal(
    selected.routes.some((item) => item.id === unrelated.id),
    false,
  )
  assert.equal(selected.touchedRoutes, 10)
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
