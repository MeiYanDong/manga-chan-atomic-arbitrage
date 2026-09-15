import assert from 'node:assert/strict'
import test from 'node:test'

import {
  assertEarnRouteShape,
  buildEarnOnHoodExactQuoteShortlist,
  enumerateEarnOnHoodCycles,
  normalizeEarnOnHoodCatalog,
} from '../src/earnonhood-graph.mjs'
import {
  buildEarnOnHoodCatalogFromOnchain,
  EARN_PARTIAL_CATALOG_RETENTION_POLICY,
  loadEarnOnHoodOnchainCatalog,
  mergeEarnOnHoodPartialCatalog,
  refreshEarnOnHoodCachedDynamicCatalog,
} from '../src/earnonhood-onchain-catalog.mjs'
import {
  EARN_OMNIPOOL_FACTORY,
  EARN_REVIEWED_LEGACY_OMNIPOOLS,
  EARN_ROUTE_DISCOVERY_POLICY,
  EARN_VAULT,
  EARN_WETH,
} from '../src/earnonhood-routes.mjs'

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

test('dynamic graph preserves an arbitrary non-WETH settlement through route validation', () => {
  const normalized = catalog()
  const routes = enumerateEarnOnHoodCycles(normalized.pools, { baseToken: PONS })
  const triangle = routes.find((route) => route.symbols.join('>') === 'PONS>CASHCAT>WETH>PONS')
  assert.ok(triangle)
  assert.equal(assertEarnRouteShape(triangle, { baseToken: PONS }).id, triangle.id)
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
    focusPools: ['0x0000000000000000000000000000000000000014', '0x0000000000000000000000000000000000000015'],
  })
  const directCount = routes.filter((route) => route.steps.length === 2).length
  assert.equal(
    shortlist.selectedRoutes.filter((route) => route.steps.length === 2).length,
    Math.min(directCount, EARN_ROUTE_DISCOVERY_POLICY.shortlistRoutesPerHop),
  )
  assert.ok(shortlist.selectedRoutes.some((route) => route.steps.length === 3))
  assert.ok(
    shortlist.selectedRoutes.some((route) =>
      route.steps.some((step) => step.pool.toLowerCase() === '0x0000000000000000000000000000000000000015'),
    ),
  )
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

test('canonical onchain factory catalog discovers non-AI cycles without the Earn web API', async () => {
  const poolA = '0x0000000000000000000000000000000000000011'
  const poolB = '0x0000000000000000000000000000000000000012'
  const poolTokens = new Map([
    [poolA.toLowerCase(), [EARN_WETH, PONS]],
    [poolB.toLowerCase(), [EARN_WETH, PONS]],
    [EARN_REVIEWED_LEGACY_OMNIPOOLS[0].toLowerCase(), [EARN_WETH, EARN]],
  ])
  const client = {
    async getCode() {
      return '0x6000'
    },
    async multicall({ contracts }) {
      return Promise.all(
        contracts.map(async (contract) => {
          try {
            return { status: 'success', result: await this.readContract(contract) }
          } catch (error) {
            return { status: 'failure', error }
          }
        }),
      )
    },
    async call({ to }) {
      if (to.toLowerCase() === EARN.toLowerCase()) throw new Error('Permit2 blocked')
      return { data: `0x${'0'.repeat(63)}1` }
    },
    async readContract({ address, functionName }) {
      if (address.toLowerCase() === EARN_OMNIPOOL_FACTORY.toLowerCase()) {
        if (functionName === 'getVault') return EARN_VAULT
        if (functionName === 'isDisabled') return false
        if (functionName === 'getPools') return [poolA, poolB]
      }
      const tokens = poolTokens.get(address.toLowerCase())
      if (functionName === 'getWeightedPoolImmutableData') {
        return {
          tokens,
          decimalScalingFactors: tokens.map(() => 1n),
          normalizedWeights: tokens.map(() => 500_000_000_000_000_000n),
          minTokenBalances: tokens.map(() => 1n),
        }
      }
      if (functionName === 'getWeightedPoolDynamicData') {
        return {
          balancesLiveScaled18: tokens.map(() => 1_000_000_000_000_000_000_000n),
          tokenRates: tokens.map(() => 1_000_000_000_000_000_000n),
          staticSwapFeePercentage: 3_000_000_000_000_000n,
          totalSupply: 1n,
          isPoolInitialized: true,
          isPoolPaused: false,
          isPoolInRecoveryMode: false,
        }
      }
      if (functionName === 'symbol') {
        if (address.toLowerCase() === EARN_WETH.toLowerCase()) return 'WETH'
        if (address.toLowerCase() === PONS.toLowerCase()) return 'PONS'
        if (address.toLowerCase() === EARN.toLowerCase()) return 'EARN'
        return 'POOL'
      }
      throw new Error(`unexpected ${functionName}`)
    },
  }

  const onchain = await loadEarnOnHoodOnchainCatalog(client, 123n, { expectedMulticallCodeHash: null })
  const routes = enumerateEarnOnHoodCycles(onchain.pools)
  assert.equal(onchain.source, 'CANONICAL_FACTORY_AND_POOL_STATE_ONCHAIN')
  assert.equal(onchain.discoveredFactoryPools, 2)
  assert.equal(onchain.reviewedLegacyPools, 1)
  assert.equal(onchain.rejected.length, 0)
  const legacy = onchain.pools.find(
    (pool) => pool.address.toLowerCase() === EARN_REVIEWED_LEGACY_OMNIPOOLS[0].toLowerCase(),
  )
  assert.equal(legacy.addLiquidityExecutable, false)
  assert.equal(
    legacy.tokens.find((token) => token.address.toLowerCase() === EARN.toLowerCase()).permit2Compatible,
    false,
  )
  assert.ok(routes.some((route) => route.symbols.join('>') === 'WETH>PONS>WETH'))
  await assert.rejects(() => loadEarnOnHoodOnchainCatalog(client, 123n), /Multicall3 bytecode mismatch/)
})

test('onchain catalog quarantines a paused pool and rejects inconsistent weighted state', () => {
  const records = [
    {
      address: '0x0000000000000000000000000000000000000011',
      immutableData: {
        tokens: [EARN_WETH, PONS],
        normalizedWeights: [500_000_000_000_000_000n, 500_000_000_000_000_000n],
      },
      dynamicData: {
        balancesLiveScaled18: [1_000n, 1_000n],
        staticSwapFeePercentage: 3_000_000_000_000_000n,
        isPoolInitialized: true,
        isPoolPaused: true,
        isPoolInRecoveryMode: false,
      },
    },
    {
      address: '0x0000000000000000000000000000000000000012',
      immutableData: {
        tokens: [EARN_WETH, PONS],
        normalizedWeights: [400_000_000_000_000_000n, 400_000_000_000_000_000n],
      },
      dynamicData: {
        balancesLiveScaled18: [1_000n, 1_000n],
        staticSwapFeePercentage: 3_000_000_000_000_000n,
        isPoolInitialized: true,
        isPoolPaused: false,
        isPoolInRecoveryMode: false,
      },
    },
  ]
  const catalog = buildEarnOnHoodCatalogFromOnchain({ records, blockNumber: 123n })
  assert.equal(catalog.pools.length, 0)
  assert.equal(catalog.rejected.length, 2)
  assert.ok(catalog.rejected.some((record) => /paused/.test(record.reason)))
  assert.ok(catalog.rejected.some((record) => /sum to one/.test(record.reason)))
})

test('Earn partial refresh retains only exact transient pool-state failures inside the evidence lifetime', () => {
  const address = '0x0000000000000000000000000000000000000011'
  const priorPool = pool(address, 'WETH PONS', [token(EARN_WETH, 'WETH'), token(PONS, 'PONS')])
  const previous = {
    source: EARN_ROUTE_DISCOVERY_POLICY.catalogSource,
    blockNumber: '100',
    pools: [priorPool],
  }
  const current = {
    source: EARN_ROUTE_DISCOVERY_POLICY.catalogSource,
    blockNumber: '200',
    pools: [],
    rejected: [{ address, reason: 'temporary', rpcClass: 'NETWORK', phase: 'POOL_STATE' }],
  }
  const merged = mergeEarnOnHoodPartialCatalog(current, previous, {
    generatedAt: '2026-09-15T00:05:00.000Z',
    previousGeneratedAt: '2026-09-15T00:00:00.000Z',
  })

  assert.equal(merged.pools.length, 1)
  assert.equal(merged.pools[0].lastVerifiedAt, '2026-09-15T00:00:00.000Z')
  assert.equal(merged.pools[0].catalogObservation, 'RETAINED_AFTER_CURRENT_TRANSIENT_POOL_READ_FAILURE')
  assert.deepEqual(merged.readEvidence.topologyRetention, {
    policy: EARN_PARTIAL_CATALOG_RETENTION_POLICY.version,
    previousCatalogBlock: '100',
    freshPools: 0,
    retainedPools: 1,
    expiredPools: 0,
  })

  const deterministic = mergeEarnOnHoodPartialCatalog(
    {
      ...current,
      rejected: [{ address, reason: 'invalid state', rpcClass: 'INVARIANT', phase: 'POOL_STATE' }],
    },
    previous,
    { generatedAt: '2026-09-15T00:05:00.000Z', previousGeneratedAt: '2026-09-15T00:00:00.000Z' },
  )
  assert.equal(deterministic.pools.length, 0)

  const expired = mergeEarnOnHoodPartialCatalog(current, previous, {
    generatedAt: '2026-09-15T06:00:00.001Z',
    previousGeneratedAt: '2026-09-15T00:00:00.000Z',
  })
  assert.equal(expired.pools.length, 0)
  assert.equal(expired.readEvidence.topologyRetention.expiredPools, 1)

  const fresh = mergeEarnOnHoodPartialCatalog({ ...current, pools: [{ ...priorPool, tvlUsd: 2_000 }] }, previous, {
    generatedAt: '2026-09-15T00:05:00.000Z',
    previousGeneratedAt: '2026-09-15T00:00:00.000Z',
  })
  assert.equal(fresh.pools.length, 1)
  assert.equal(fresh.pools[0].tvlUsd, 2_000)
  assert.equal(fresh.pools[0].catalogObservation, 'CURRENT_FIXED_BLOCK_POOL_READ')
})

test('onchain Earn rejection preserves typed pool-state failure evidence for reconciliation', () => {
  const address = '0x0000000000000000000000000000000000000011'
  const catalog = buildEarnOnHoodCatalogFromOnchain({
    blockNumber: 123n,
    records: [{ address, error: 'temporary read failure', rpcClass: 'THROTTLED', phase: 'POOL_STATE' }],
  })
  assert.deepEqual(catalog.rejected[0], {
    address,
    name: 'UNKNOWN',
    reason: 'PUBLIC_RPC_THROTTLED',
    rpcClass: 'THROTTLED',
    phase: 'POOL_STATE',
  })
})

test('event hot path refreshes only mutable pool state from a canonical protected catalog', async () => {
  const cached = {
    ...catalog(),
    source: EARN_ROUTE_DISCOVERY_POLICY.catalogSource,
    blockNumber: '100',
    discoveredFactoryPools: 5,
    reviewedLegacyPools: 0,
  }
  let logicalCalls = 0
  const client = {
    async multicall({ contracts }) {
      logicalCalls += contracts.length
      return contracts.map(() => ({
        status: 'success',
        result: {
          balancesLiveScaled18: [2_000n, 3_000n],
          tokenRates: [1_000_000_000_000_000_000n, 1_000_000_000_000_000_000n],
          staticSwapFeePercentage: 3_000_000_000_000_000n,
          totalSupply: 1n,
          isPoolInitialized: true,
          isPoolPaused: false,
          isPoolInRecoveryMode: false,
        },
      }))
    },
  }
  const refreshed = await refreshEarnOnHoodCachedDynamicCatalog(client, cached, 101n)
  assert.equal(logicalCalls, cached.pools.length)
  assert.equal(refreshed.blockNumber, '101')
  assert.equal(refreshed.pools.length, cached.pools.length)
  assert.equal(refreshed.pools[0].tokens[0].balance, '2000')
  assert.equal(refreshed.refreshMode, 'PROTECTED_CANONICAL_STATIC_CACHE_PLUS_FIXED_BLOCK_DYNAMIC_MULTICALL')
})
