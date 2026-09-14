import assert from 'node:assert/strict'
import test from 'node:test'

import {
  GLOBAL_FEED_MATCH_POLICY,
  buildGlobalFeedWatchPolicy,
  classifyEarnFeedMatches,
  classifyGlobalFeedMatches,
} from '../src/global-wake-policy.mjs'

const PROTOCOL = '0x0000000000000000000000000000000000000001'
const EARN_PROTOCOL = '0x0000000000000000000000000000000000000007'
const MORPHO = '0x0000000000000000000000000000000000000002'
const FACTORY = '0x0000000000000000000000000000000000000003'
const EARN_POOL = '0x0000000000000000000000000000000000000004'
const V3_POOL = '0x0000000000000000000000000000000000000005'
const HOOK = '0x0000000000000000000000000000000000000006'
const WETH = '0x0000000000000000000000000000000000000011'
const ASSET = '0x0000000000000000000000000000000000000012'
const OTHER_ASSET = '0x0000000000000000000000000000000000000013'

function policy() {
  return buildGlobalFeedWatchPolicy(
    {
      earn: {
        pools: [{ address: EARN_POOL, tokens: [{ address: WETH }, { address: ASSET }, { address: OTHER_ASSET }] }],
      },
      uniswap: {
        v2Pools: [],
        v3Pools: [{ address: V3_POOL, token0: WETH, token1: ASSET }],
        // v4 repeats the shared PoolManager in every catalog row. It is
        // protocol context, not a route-specific pool address.
        v4Pools: [{ address: PROTOCOL, hooks: HOOK, token0: WETH, token1: ASSET }],
      },
    },
    {
      protocolAddresses: [PROTOCOL],
      earnProtocolAddresses: [EARN_PROTOCOL],
      settlementAddresses: [WETH],
      ignoredAddresses: [MORPHO, FACTORY],
    },
  )
}

test('builds a classified feed policy without funding or factory noise', () => {
  const built = policy()
  assert.equal(built.policy, GLOBAL_FEED_MATCH_POLICY)
  assert.ok(built.protocolAddresses.some((address) => address.toLowerCase() === PROTOCOL))
  assert.ok(built.protocolAddresses.some((address) => address.toLowerCase() === EARN_PROTOCOL))
  assert.deepEqual(built.earnProtocolAddresses, [EARN_PROTOCOL])
  assert.equal(
    built.poolAddresses.some((address) => address.toLowerCase() === PROTOCOL),
    false,
  )
  assert.ok(built.poolAddresses.some((address) => address.toLowerCase() === EARN_POOL))
  assert.deepEqual(built.earnPoolAddresses, [EARN_POOL])
  assert.ok(built.triggerAddresses.some((address) => address.toLowerCase() === PROTOCOL))
  assert.ok(built.triggerAddresses.some((address) => address.toLowerCase() === EARN_POOL))
  assert.ok(built.triggerAddresses.some((address) => address.toLowerCase() === V3_POOL))
  assert.ok(built.triggerAddresses.some((address) => address.toLowerCase() === HOOK))
  assert.ok(built.assetAddresses.some((address) => address.toLowerCase() === WETH))
  assert.ok(built.earnAssetAddresses.some((address) => address.toLowerCase() === ASSET))
  assert.deepEqual(built.settlementAddresses, [WETH])
  assert.equal(
    built.watchedAddresses.some((address) => address.toLowerCase() === MORPHO),
    false,
  )
  assert.equal(
    built.watchedAddresses.some((address) => address.toLowerCase() === FACTORY),
    false,
  )
})

test('routes exact Earn feed frames to the Earn adapter without accepting protocol-only noise', () => {
  const built = policy()
  assert.deepEqual(classifyEarnFeedMatches([EARN_POOL], built).matchedPoolAddresses, [EARN_POOL])
  assert.equal(classifyEarnFeedMatches([EARN_POOL], built).reason, 'EARN_POOL_MATCH')
  assert.equal(classifyEarnFeedMatches([EARN_PROTOCOL], built).actionable, false)
  assert.equal(classifyEarnFeedMatches([EARN_PROTOCOL, ASSET], built).actionable, true)
  assert.equal(classifyEarnFeedMatches([EARN_PROTOCOL, ASSET], built).reason, 'EARN_PROTOCOL_ASSET_PATH_MATCH')
  assert.equal(classifyEarnFeedMatches([PROTOCOL, ASSET], built).actionable, false)
  assert.equal(classifyEarnFeedMatches([V3_POOL], built).actionable, false)
})

test('projects only route-specific pools and non-hub assets into event work', () => {
  const built = policy()
  assert.deepEqual(classifyGlobalFeedMatches([WETH], built), {
    actionable: false,
    reason: 'SHARED_HUB_CONTEXT_ONLY',
    matchedTriggerAddresses: [],
    matchedProtocolAddresses: [],
    matchedPoolAddresses: [],
    matchedAssetAddresses: [WETH],
    matchedSettlementAddresses: [WETH],
    matchedNonSettlementAssetAddresses: [],
    routeAddresses: [],
  })
  assert.deepEqual(classifyGlobalFeedMatches([PROTOCOL, WETH], built).routeAddresses, [])
  assert.equal(classifyGlobalFeedMatches([PROTOCOL, WETH], built).actionable, false)
  assert.equal(classifyGlobalFeedMatches([PROTOCOL], built).reason, 'SHARED_HUB_CONTEXT_ONLY')
  assert.deepEqual(classifyGlobalFeedMatches([WETH, ASSET], built).routeAddresses, [ASSET])
  assert.equal(classifyGlobalFeedMatches([WETH, ASSET], built).reason, 'NON_HUB_ASSET_PATH_MATCH')
  assert.deepEqual(classifyGlobalFeedMatches([PROTOCOL, ASSET], built).routeAddresses, [ASSET])
  assert.deepEqual(classifyGlobalFeedMatches([ASSET, OTHER_ASSET], built).routeAddresses, [ASSET, OTHER_ASSET])
  assert.deepEqual(classifyGlobalFeedMatches([V3_POOL], built).routeAddresses, [V3_POOL])
  assert.equal(classifyGlobalFeedMatches([V3_POOL], built).reason, 'SPECIFIC_POOL_OR_HOOK_MATCH')
  assert.equal(classifyGlobalFeedMatches([ASSET], built).reason, 'SINGLE_NON_HUB_ASSET_ONLY')
  assert.equal(classifyGlobalFeedMatches(['0x0000000000000000000000000000000000000099'], built).actionable, false)
})
