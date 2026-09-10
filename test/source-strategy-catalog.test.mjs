import assert from 'node:assert/strict'
import test from 'node:test'
import { getAddress } from 'viem'
import {
  OFFICIAL_PAIR_HOOK,
  canonicalPoolKey,
  normalizeApiPool,
  pairPoolId,
  PoolAdmission,
} from '../src/pair-catalog.mjs'
import { sourceTargetAddresses } from '../src/source-adapters.mjs'
import { buildSourceStrategyCatalog } from '../src/source-strategy-catalog.mjs'

const TARGET = getAddress('0x1111111111111111111111111111111111111111')
const QUOTE_A = getAddress('0x2222222222222222222222222222222222222222')
const QUOTE_B = getAddress('0x3333333333333333333333333333333333333333')
const QUOTE_C = getAddress('0x4444444444444444444444444444444444444444')
const OTHER_HOOK = getAddress('0x5555555555555555555555555555555555555555')

function pool(target, quote, hooks, fee, tickSpacing, blockNumber) {
  const key = canonicalPoolKey(target, quote, fee, tickSpacing, hooks)
  return {
    poolId: pairPoolId(key),
    currency0: key.currency0,
    currency1: key.currency1,
    fee,
    tickSpacing,
    hooks,
    blockNumber: String(blockNumber),
    evidenceId: `rh:4663:log:0x${String(blockNumber).padStart(64, '0')}:1`,
  }
}

test('multi-source graph turns LONG and Doppler targets into bounded quote candidates', () => {
  const genericPools = [
    pool(TARGET, QUOTE_A, OTHER_HOOK, 3_000, 60, 100),
    pool(TARGET, QUOTE_B, OFFICIAL_PAIR_HOOK, 10_000, 200, 101),
    pool(TARGET, QUOTE_C, OFFICIAL_PAIR_HOOK, 10_000, 200, 102),
  ]
  const graph = buildSourceStrategyCatalog({
    pairListings: [],
    longLaunches: [
      {
        asset: TARGET,
        numeraire: QUOTE_A,
        normalizedTicker: 'SOURCE',
        blockNumber: '99',
        evidenceId: `rh:4663:log:0x${'9'.repeat(64)}:1`,
      },
    ],
    dopplerTargetIndex: [
      {
        asset: TARGET,
        numeraire: QUOTE_B,
        blockNumber: '99',
        evidenceId: `rh:4663:log:0x${'8'.repeat(64)}:1`,
      },
    ],
    genericPools,
    maxPoolsPerTarget: 2,
  })
  const target = graph.tokens.find((token) => token.address === TARGET)
  assert.equal(target.symbol, 'SOURCE')
  assert.deepEqual(target.catalogSources.sort(), ['DOPPLER_PROTOCOL', 'LONG_LAUNCH'])
  assert.equal(target.pairs.length, 2)
  assert.deepEqual(
    new Set(target.pairs.map((pair) => pair.quoteToken.address)),
    new Set([QUOTE_A, QUOTE_B]),
    'declared launch numeraires are retained ahead of unrelated pools',
  )
  assert.equal(
    target.pairs.every((pair) => pair.chainSourceAttested === true),
    true,
  )
  assert.equal(graph.summary.multiPoolTargets, 1)
  assert.equal(graph.summary.sourceOnlyMultiPoolTargets, 1)
  assert.equal(graph.summary.poolsDroppedByBound, 1)
})

test('chain-attested arbitrary hooks enter shadow quoting but never current execution admission', () => {
  const sourcePool = pool(TARGET, QUOTE_A, OTHER_HOOK, 3_000, 60, 100)
  const graph = buildSourceStrategyCatalog({
    longLaunches: [{ asset: TARGET, numeraire: QUOTE_A }],
    genericPools: [sourcePool, pool(TARGET, QUOTE_B, OTHER_HOOK, 3_000, 60, 101)],
  })
  const normalized = normalizeApiPool(TARGET, graph.tokens[0].pairs[0], { minDepthUsd: 100 })
  assert.equal(normalized.shadowEligible, true)
  assert.equal(normalized.chainSourceAttested, true)
  assert.equal(normalized.executionAdmission, PoolAdmission.SHADOW_ONLY_UNSUPPORTED_HOOK)
})

test('source-only singleton targets stay in source evidence without allocating strategy rows', () => {
  const graph = buildSourceStrategyCatalog({
    longLaunches: [{ asset: TARGET, numeraire: QUOTE_A }],
    genericPools: [pool(TARGET, QUOTE_A, OFFICIAL_PAIR_HOOK, 10_000, 200, 100)],
  })
  assert.equal(graph.summary.sourceTargets, 1)
  assert.equal(graph.summary.multiPoolTargets, 0)
  assert.equal(
    graph.tokens.some((token) => token.address === TARGET),
    false,
  )
})

test('a prevalidated source-target index preserves strategy graph output', () => {
  const input = {
    longLaunches: [{ asset: TARGET, numeraire: QUOTE_A }],
    genericPools: [
      pool(TARGET, QUOTE_A, OTHER_HOOK, 3_000, 60, 100),
      pool(TARGET, QUOTE_B, OTHER_HOOK, 3_000, 60, 101),
    ],
  }
  const baseline = buildSourceStrategyCatalog(input)
  const sourceTargetIndex = sourceTargetAddresses({ longLaunches: input.longLaunches })
  const cached = buildSourceStrategyCatalog({ ...input, sourceTargetIndex })
  assert.deepEqual(cached, baseline)
  assert.throws(
    () => buildSourceStrategyCatalog({ ...input, sourceTargetIndex: new Set([TARGET.toLowerCase()]) }),
    /sourceTargetIndex must come from sourceTargetAddresses/,
  )
})

test('existing PAIR pools are not displaced by the generic-pool bound', () => {
  const existingPools = [
    pool(TARGET, QUOTE_A, OFFICIAL_PAIR_HOOK, 10_000, 200, 100),
    pool(TARGET, QUOTE_B, OFFICIAL_PAIR_HOOK, 10_000, 200, 101),
  ].map((item) => ({
    poolId: item.poolId,
    canonical: true,
    ammVersion: 'V4_MULTI',
    hookAddress: item.hooks,
    poolFee: item.fee,
    tickSpacing: item.tickSpacing,
    activeVirtualSwapDepthUsd: '250',
    quoteToken: {
      address: item.currency0 === TARGET ? item.currency1 : item.currency0,
      symbol: 'QUOTE',
      decimals: 18,
      enabled: true,
    },
  }))
  const graph = buildSourceStrategyCatalog({
    apiTokens: [{ address: TARGET, symbol: 'PAIR-TARGET', pairs: existingPools }],
    pairListings: [{ targetAddress: TARGET, symbol: 'PAIR-TARGET' }],
    genericPools: [pool(TARGET, QUOTE_C, OTHER_HOOK, 3_000, 60, 102)],
    maxPoolsPerTarget: 2,
  })
  assert.deepEqual(
    new Set(graph.tokens[0].pairs.map((item) => item.poolId)),
    new Set(existingPools.map((item) => item.poolId)),
  )
  assert.equal(
    graph.tokens[0].pairs.every((item) => item.apiCanonicalClaim === true),
    true,
  )
})
