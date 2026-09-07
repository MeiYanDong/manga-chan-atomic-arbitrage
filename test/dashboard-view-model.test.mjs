import assert from 'node:assert/strict'
import test from 'node:test'
import {
  compactAddress,
  currentPage,
  economicHeadline,
  formatMetric,
  relativeAge,
  toneForStatus,
} from '../ui/src/view-model.mjs'

test('dashboard navigation only accepts known workspaces', () => {
  assert.equal(currentPage('#/radar'), 'radar')
  assert.equal(currentPage('#/execution/detail'), 'execution')
  assert.equal(currentPage('#/not-a-page'), 'overview')
})

test('display helpers keep unknown values explicit', () => {
  assert.equal(formatMetric(null), '—')
  assert.equal(compactAddress(null), 'UNKNOWN')
  assert.equal(relativeAge(null), 'never')
  assert.equal(relativeAge('2026-09-07T00:00:00.000Z', Date.parse('2026-09-07T00:01:01.000Z')), '1m')
})

test('screened proxy and exact-ready headlines stay distinct', () => {
  assert.equal(economicHeadline({ screenedPositive: 1, exactReady: 0 }), 'PROXY EDGE OBSERVED')
  assert.equal(economicHeadline({ screenedPositive: 1, exactReady: 1 }), 'EXACT PREFLIGHT READY')
  assert.equal(economicHeadline({ screenedPositive: 0, exactReady: 0 }), 'NO FRESH PROXY EDGE')
  assert.equal(toneForStatus('FRESH_PROXY_POSITIVE'), 'proxy')
  assert.equal(toneForStatus('CONFIRMED'), 'verified')
})
