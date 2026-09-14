import assert from 'node:assert/strict'
import test from 'node:test'

import {
  GLOBAL_FEED_MATCH_POLICY,
  buildGlobalFeedWatchPolicy,
  classifyGlobalFeedMatches,
} from '../src/global-wake-policy.mjs'

const PROTOCOL = '0x0000000000000000000000000000000000000001'
const MORPHO = '0x0000000000000000000000000000000000000002'
const FACTORY = '0x0000000000000000000000000000000000000003'
const EARN_POOL = '0x0000000000000000000000000000000000000004'
const V3_POOL = '0x0000000000000000000000000000000000000005'
const HOOK = '0x0000000000000000000000000000000000000006'
const WETH = '0x0000000000000000000000000000000000000011'
const ASSET = '0x0000000000000000000000000000000000000012'

function policy() {
  return buildGlobalFeedWatchPolicy(
    {
      earn: { pools: [{ address: EARN_POOL, tokens: [{ address: WETH }, { address: ASSET }] }] },
      uniswap: {
        v2Pools: [],
        v3Pools: [{ address: V3_POOL, token0: WETH, token1: ASSET }],
        v4Pools: [{ hooks: HOOK, token0: WETH, token1: ASSET }],
      },
    },
    { protocolAddresses: [PROTOCOL], ignoredAddresses: [MORPHO, FACTORY] },
  )
}

test('builds a classified feed policy without funding or factory noise', () => {
  const built = policy()
  assert.equal(built.policy, GLOBAL_FEED_MATCH_POLICY)
  assert.ok(built.triggerAddresses.some((address) => address.toLowerCase() === PROTOCOL))
  assert.ok(built.triggerAddresses.some((address) => address.toLowerCase() === EARN_POOL))
  assert.ok(built.triggerAddresses.some((address) => address.toLowerCase() === V3_POOL))
  assert.ok(built.triggerAddresses.some((address) => address.toLowerCase() === HOOK))
  assert.ok(built.assetAddresses.some((address) => address.toLowerCase() === WETH))
  assert.equal(
    built.watchedAddresses.some((address) => address.toLowerCase() === MORPHO),
    false,
  )
  assert.equal(
    built.watchedAddresses.some((address) => address.toLowerCase() === FACTORY),
    false,
  )
})

test('wakes for one protocol or pool address and filters one common asset transfer', () => {
  const built = policy()
  assert.deepEqual(classifyGlobalFeedMatches([WETH], built), {
    actionable: false,
    reason: 'SINGLE_ASSET_ONLY',
    matchedTriggerAddresses: [],
    matchedAssetAddresses: [WETH],
  })
  assert.equal(classifyGlobalFeedMatches([WETH, ASSET], built).reason, 'TWO_ASSET_PATH_MATCH')
  assert.equal(classifyGlobalFeedMatches([V3_POOL], built).reason, 'PROTOCOL_OR_POOL_MATCH')
  assert.equal(classifyGlobalFeedMatches(['0x0000000000000000000000000000000000000099'], built).actionable, false)
})
