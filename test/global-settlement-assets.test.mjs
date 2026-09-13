import assert from 'node:assert/strict'
import test from 'node:test'

import { globalSettlementAssets } from '../src/global-settlement-assets.mjs'

const USDG = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168'
const WETH = '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73'
const EXTRA = '0xA3b6AEe90017b72c0812dC1e013De70eB2917ba3'

test('settlement allowlist deduplicates defaults and explicit extras', () => {
  assert.deepEqual(globalSettlementAssets([USDG, WETH], `${USDG.toLowerCase()}, ${EXTRA}`), [USDG, WETH, EXTRA])
})

test('settlement allowlist rejects malformed and unbounded input', () => {
  assert.throws(() => globalSettlementAssets([USDG, WETH], 'not-an-address'))
  const extras = Array.from({ length: 15 }, (_, index) => `0x${(index + 10).toString(16).padStart(40, '0')}`)
  assert.throws(() => globalSettlementAssets([USDG, WETH], extras.join(',')), /2\.\.16/)
})
