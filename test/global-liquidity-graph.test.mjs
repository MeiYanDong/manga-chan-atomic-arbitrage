import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import {
  buildEarnBptArbitrageTemplates,
  buildUnifiedLiquidityGraph,
  enumerateAtomicSwapCycles,
  enumerateCrossVenueCycles,
  fundingCapability,
  selectAffectedAtomicSwapCycles,
  selectBoundedManagedCandidates,
  selectRecoveryAtomicSwapCycles,
} from '../src/global-liquidity-graph.mjs'
import { buildGlobalWakeFromEarnEvent } from '../src/feed-signal-coalescer.mjs'
import {
  loadRobinhoodHubUniswapCatalog,
  mergeRobinhoodPartialCatalog,
  ROBINHOOD_CATALOG_MULTICALL_POLICY,
  ROBINHOOD_PARTIAL_CATALOG_RETENTION_POLICY,
} from '../src/robinhood-uniswap-catalog.mjs'

const USDG = '0x0000000000000000000000000000000000000001'
const WETH = '0x0000000000000000000000000000000000000002'
const STOCK = '0x0000000000000000000000000000000000000003'
const BPT = '0x0000000000000000000000000000000000000004'
const EARN_POOL = '0x0000000000000000000000000000000000000005'
const V3_A = '0x0000000000000000000000000000000000000011'
const V3_B = '0x0000000000000000000000000000000000000012'
const V4 = '0x0000000000000000000000000000000000000013'

function fixture() {
  return buildUnifiedLiquidityGraph({
    earnPools: [
      {
        address: BPT,
        name: 'arbitrary basket',
        initialized: true,
        paused: false,
        recoveryMode: false,
        tokens: [
          { address: WETH, symbol: 'WETH', decimals: 18 },
          { address: STOCK, symbol: 'STOCK', decimals: 18 },
        ],
      },
    ],
    v3Pools: [
      { address: V3_A, token0: USDG, token1: WETH, fee: 100 },
      { address: V3_B, token0: USDG, token1: BPT, fee: 500 },
    ],
    v4Pools: [
      {
        address: V4,
        poolId: `0x${'13'.repeat(32)}`,
        token0: USDG,
        token1: STOCK,
        fee: 1_500,
        tickSpacing: 15,
        hooks: '0x0000000000000000000000000000000000000000',
      },
    ],
  })
}

test('unifies Earn and Uniswap into asset edges plus Earn hyperedges', () => {
  const graph = fixture()
  assert.equal(graph.assets.size, 4)
  assert.equal(graph.edges.length, 8)
  assert.equal(graph.hyperedges.length, 2)
  assert.equal(graph.rejected.length, 0)
  assert.match(graph.commitment, /^0x[0-9a-f]{64}$/)
})

test('enumerates cross-venue cycles without token-name assumptions', () => {
  const cycles = enumerateCrossVenueCycles(fixture(), USDG)
  assert.ok(
    cycles.some(
      (cycle) =>
        cycle.edges.map((edge) => edge.venue).includes('EARN') &&
        cycle.edges.map((edge) => edge.venue).includes('UNISWAP_V3'),
    ),
  )
})

test('enumerates a same-venue multi-pool cycle without named-route assumptions', () => {
  const TOKEN_A = '0x0000000000000000000000000000000000000031'
  const TOKEN_B = '0x0000000000000000000000000000000000000032'
  const TOKEN_C = '0x0000000000000000000000000000000000000033'
  const graph = buildUnifiedLiquidityGraph({
    earnPools: [
      {
        address: '0x0000000000000000000000000000000000000041',
        initialized: true,
        tokens: [{ address: TOKEN_A }, { address: TOKEN_B }],
      },
      {
        address: '0x0000000000000000000000000000000000000042',
        initialized: true,
        tokens: [{ address: TOKEN_B }, { address: TOKEN_C }],
      },
      {
        address: '0x0000000000000000000000000000000000000043',
        initialized: true,
        tokens: [{ address: TOKEN_C }, { address: TOKEN_A }],
      },
    ],
  })
  const cycles = enumerateAtomicSwapCycles(graph, TOKEN_A, { maximumHops: 3, maximumCycles: 32 })
  const triangle = cycles.find(
    (cycle) => cycle.edges.length === 3 && cycle.edges.every((edge) => edge.venue === 'EARN'),
  )
  assert.ok(triangle)
  assert.equal(new Set(triangle.edges.map((edge) => edge.pool.toLowerCase())).size, 3)
})

test('dependency-aware event traversal preserves the exact bounded cycle universe and ranking', () => {
  const graph = fixture()
  const complete = enumerateAtomicSwapCycles(graph, USDG, { maximumHops: 4, maximumCycles: 128 })
  const touched = complete.filter((cycle) =>
    cycle.edges.some((edge) =>
      [edge.pool, edge.hooks, edge.tokenIn, edge.tokenOut]
        .filter(Boolean)
        .some((value) => value.toLowerCase() === STOCK.toLowerCase()),
    ),
  )
  const expected = touched
    .map((cycle) => ({
      cycle,
      kind: `${new Set(cycle.edges.map((edge) => edge.venue)).size === 1 ? 'SAME_VENUE' : 'CROSS_VENUE'}_${cycle.edges.length}_HOP_ATOMIC_SWAP_CYCLE`,
    }))
    .sort(
      (left, right) =>
        left.cycle.edges.length - right.cycle.edges.length ||
        left.kind.localeCompare(right.kind) ||
        left.cycle.id.localeCompare(right.cycle.id),
    )
    .slice(0, 3)

  const selected = selectAffectedAtomicSwapCycles(graph, USDG, {
    wakeAddresses: [STOCK],
    maximumHops: 4,
    maximumCycles: 128,
    maximumSelected: 3,
  })
  assert.equal(selected.totalCycles, complete.length)
  assert.equal(selected.touchedCycles, touched.length)
  assert.deepEqual(
    selected.selected.map((item) => [item.cycle.id, item.opportunityKind]),
    expected.map((item) => [item.cycle.id, item.kind]),
  )
  assert.ok(selected.selected.every((item) => item.matchedDependencies.includes(STOCK)))
  assert.equal(selected.coverage, 'COMPLETE_BOUNDED_TOPOLOGY_TRAVERSAL')
})

test('dependency-aware event traversal keeps only its bounded best materialized routes', () => {
  const graph = fixture()
  const selected = selectAffectedAtomicSwapCycles(graph, USDG, {
    wakeAddresses: [STOCK, V4],
    maximumHops: 4,
    maximumCycles: 128,
    maximumSelected: 1,
  })
  assert.equal(selected.cycles.length, 1)
  assert.ok(selected.touchedCycles >= selected.cycles.length)
  assert.equal(selected.selected[0].matchedDependencyCount, 2)
  assert.throws(
    () =>
      selectAffectedAtomicSwapCycles(graph, USDG, {
        wakeAddresses: [],
        maximumHops: 4,
        maximumCycles: 128,
      }),
    /requires at least one wake dependency/,
  )
})

test('recovery traversal counts the complete universe but retains only a deterministic rotating reservoir', () => {
  const tokens = Array.from({ length: 6 }, (_, index) => `0x${String(index + 1).padStart(40, '0')}`)
  const v2Pools = []
  let poolIndex = 0x100
  for (let left = 0; left < tokens.length; left += 1) {
    for (let right = left + 1; right < tokens.length; right += 1) {
      v2Pools.push({
        address: `0x${String(poolIndex).padStart(40, '0')}`,
        token0: tokens[left],
        token1: tokens[right],
      })
      poolIndex += 1
    }
  }
  const graph = buildUnifiedLiquidityGraph({ v2Pools })
  const complete = enumerateAtomicSwapCycles(graph, tokens[0], { maximumHops: 4, maximumCycles: 512 })
  const first = selectRecoveryAtomicSwapCycles(graph, tokens[0], {
    maximumHops: 4,
    maximumCycles: 512,
    maximumSelected: 5,
    rotationSeed: 100n,
  })
  const repeat = selectRecoveryAtomicSwapCycles(graph, tokens[0], {
    maximumHops: 4,
    maximumCycles: 512,
    maximumSelected: 5,
    rotationSeed: 100n,
  })
  const rotated = selectRecoveryAtomicSwapCycles(graph, tokens[0], {
    maximumHops: 4,
    maximumCycles: 512,
    maximumSelected: 5,
    rotationSeed: 101n,
  })

  const completeIds = new Set(complete.map((cycle) => cycle.id))
  assert.equal(first.totalCycles, complete.length)
  assert.equal(first.cycles.length, 5)
  assert.ok(first.materializedCycles >= first.cycles.length)
  assert.ok(first.materializedCycles < first.totalCycles)
  assert.ok(first.cycles.every((cycle) => completeIds.has(cycle.id)))
  assert.deepEqual(first.cycles, repeat.cycles)
  assert.notDeepEqual(
    first.cycles.map((cycle) => cycle.id),
    rotated.cycles.map((cycle) => cycle.id),
  )
  assert.equal(first.selectionPolicy, 'DETERMINISTIC_STREAMING_RESERVOIR_V1')
  assert.equal(first.coverage, 'COMPLETE_BOUNDED_TOPOLOGY_TRAVERSAL')
  assert.ok(first.visitedEdges > first.totalCycles)
  assert.throws(
    () =>
      selectRecoveryAtomicSwapCycles(graph, tokens[0], {
        maximumHops: 4,
        maximumCycles: 512,
        maximumSelected: 5,
        rotationSeed: -1,
      }),
    /rotation seed is invalid/,
  )
  assert.throws(
    () =>
      selectRecoveryAtomicSwapCycles(graph, tokens[0], {
        maximumHops: 4,
        maximumCycles: 10,
        maximumSelected: 5,
        rotationSeed: 100n,
      }),
    /cycle enumeration bound exceeded/,
  )
})

test('an exact Earn pool event reaches cross-protocol Global route search', () => {
  const graph = fixture()
  const wake = buildGlobalWakeFromEarnEvent(
    { eventPool: BPT, sourceReceivedAt: '2026-09-15T00:00:00.000Z' },
    { wakeSource: 'MANAGED_WSS_EARN_SWAP' },
  )
  const selected = selectAffectedAtomicSwapCycles(graph, USDG, {
    wakeAddresses: wake.routeAddresses,
    maximumHops: 4,
    maximumCycles: 128,
    maximumSelected: 8,
  })

  assert.ok(selected.touchedCycles > 0)
  assert.ok(selected.selected.every((item) => item.matchedDependencies.includes(BPT)))
  assert.ok(selected.selected.some((item) => new Set(item.cycle.edges.map((edge) => edge.venue)).size > 1))
})

test('historical PLTR competitor fixture is reachable after removing every token label', () => {
  const fixtureUrl = new URL('./fixtures/earn-pltr-three-pool.json', import.meta.url)
  const historical = JSON.parse(fs.readFileSync(fixtureUrl, 'utf8'))
  const graph = buildUnifiedLiquidityGraph({
    earnPools: historical.pools.map((pool) => ({ ...pool, initialized: true })),
  })
  const cycle = enumerateAtomicSwapCycles(graph, historical.settlementToken, {
    maximumHops: 3,
    maximumCycles: 32,
  }).find(
    (candidate) =>
      candidate.edges.length === 3 &&
      candidate.edges.every((edge, index) => edge.pool.toLowerCase() === historical.pools[index].address.toLowerCase()),
  )
  assert.ok(cycle)
  assert.ok(cycle.edges.every((edge) => edge.venue === 'EARN'))
})

test('derives both BPT price-dislocation shapes when every basket leg connects', () => {
  const templates = buildEarnBptArbitrageTemplates(fixture(), USDG)
  assert.deepEqual(
    templates.map((template) => template.kind),
    ['BPT_DISCOUNT_REMOVE_AND_SELL', 'BPT_PREMIUM_BUY_AND_ADD'],
  )
  assert.ok(templates.every((template) => template.pool.toLowerCase() === BPT.toLowerCase()))
})

test('settlement is executable only with inventory or flash liquidity', () => {
  assert.equal(fundingCapability({ token: USDG }).executable, false)
  assert.deepEqual(fundingCapability({ token: USDG, morphoLiquidityWei: 1n }).modes, ['MORPHO_ZERO_FEE_FLASH'])
  assert.deepEqual(fundingCapability({ token: WETH, inventoryWei: 2n }).modes, ['EXECUTOR_INVENTORY'])
})

test('quarantines malformed or explicitly unsupported source records', () => {
  const graph = buildUnifiedLiquidityGraph({
    v2Pools: [{ address: EARN_POOL, token0: USDG, token1: USDG }],
    v3Pools: [{ address: V3_A, token0: USDG, token1: WETH, fee: 500, executable: false, reason: 'no code' }],
  })
  assert.equal(graph.edges.length, 0)
  assert.equal(graph.rejected.length, 2)
})

test('catalog quarantines factory entries that have no executable liquidity', async () => {
  const v2Pool = '0x0000000000000000000000000000000000000021'
  const v3Pool = '0x0000000000000000000000000000000000000022'
  let rpcRequests = 0
  const client = {
    async multicall({ contracts }) {
      rpcRequests += 1
      return contracts.map(({ functionName }) => {
        if (functionName === 'getPair') return { status: 'success', result: v2Pool }
        if (functionName === 'getReserves') return { status: 'success', result: [0n, 1n, 0] }
        if (functionName === 'getPool') return { status: 'success', result: v3Pool }
        if (functionName === 'liquidity') return { status: 'success', result: 0n }
        throw new Error(`unexpected read ${functionName}`)
      })
    },
  }
  const catalog = await loadRobinhoodHubUniswapCatalog(client, [STOCK], 123n, {
    expectedMulticallCodeHash: null,
  })
  assert.equal(catalog.v2Pools.length, 0)
  assert.equal(catalog.v3Pools.length, 0)
  assert.deepEqual(catalog.readEvidence, {
    status: 'COMPLETE',
    complete: true,
    requestedPairs: 3,
    requestedV3FeeQueries: 12,
    v2TransportErrors: 0,
    v3TransportErrors: 0,
    bulkRead: {
      policy: ROBINHOOD_CATALOG_MULTICALL_POLICY.version,
      multicallCodeHash: null,
      rpcRequests: 4,
      subcalls: 30,
    },
  })
  assert.equal(rpcRequests, 4)
  assert.ok(catalog.rejected.some((item) => item.venue === 'UNISWAP_V2' && item.reason === 'zero reserve'))
  assert.ok(catalog.rejected.some((item) => item.venue === 'UNISWAP_V3' && item.reason === 'zero active liquidity'))
})

test('catalog discovers active V2/V3 pools through bounded canonical Multicall requests', async () => {
  const zero = '0x0000000000000000000000000000000000000000'
  const v2Pool = '0x0000000000000000000000000000000000000021'
  const v3Pool = '0x0000000000000000000000000000000000000022'
  let rpcRequests = 0
  const client = {
    async multicall({ contracts }) {
      rpcRequests += 1
      return contracts.map(({ functionName, args }) => {
        const pair = new Set((args || []).slice(0, 2).map((address) => address.toLowerCase()))
        const targetPair = pair.has(STOCK.toLowerCase()) && pair.has(USDG.toLowerCase())
        if (functionName === 'getPair') return { status: 'success', result: targetPair ? v2Pool : zero }
        if (functionName === 'getReserves') return { status: 'success', result: [10n, 20n, 0] }
        if (functionName === 'getPool') {
          return { status: 'success', result: targetPair && args[2] === 500 ? v3Pool : zero }
        }
        if (functionName === 'liquidity') return { status: 'success', result: 30n }
        throw new Error(`unexpected read ${functionName}`)
      })
    },
  }
  const catalog = await loadRobinhoodHubUniswapCatalog(client, [STOCK], 123n, {
    hubs: [USDG, WETH],
    expectedMulticallCodeHash: null,
  })

  assert.equal(catalog.v2Pools.length, 1)
  assert.equal(catalog.v2Pools[0].address, v2Pool)
  assert.equal(catalog.v3Pools.length, 1)
  assert.equal(catalog.v3Pools[0].address, v3Pool)
  assert.equal(catalog.readEvidence.complete, true)
  assert.deepEqual(catalog.readEvidence.bulkRead, {
    policy: ROBINHOOD_CATALOG_MULTICALL_POLICY.version,
    multicallCodeHash: null,
    rpcRequests: 4,
    subcalls: 17,
  })
  assert.equal(rpcRequests, 4)
})

test('catalog rejects an untrusted prior Multicall identity before making a request', async () => {
  let requests = 0
  const client = {
    async multicall() {
      requests += 1
      return []
    },
  }
  await assert.rejects(
    loadRobinhoodHubUniswapCatalog(client, [STOCK], 123n, {
      verifiedMulticallCodeHash: `0x${'00'.repeat(32)}`,
    }),
    /prior verification mismatch/,
  )
  assert.equal(requests, 0)
})

test('catalog exposes typed incomplete evidence without retaining endpoints, request bodies, or calldata', async () => {
  const credentializedEndpoint = `${'https'}://${['reader', 'secret'].join(':')}@example.invalid/rpc`
  const client = {
    async multicall() {
      const error = new Error(`http request failed at ${credentializedEndpoint}; Request body: {"data":"0xdeadbeef"}`)
      error.name = 'HttpRequestError'
      throw error
    },
  }
  const catalog = await loadRobinhoodHubUniswapCatalog(client, [STOCK], 123n, {
    expectedMulticallCodeHash: null,
  })

  assert.equal(catalog.readEvidence.status, 'PARTIAL')
  assert.equal(catalog.readEvidence.complete, false)
  assert.equal(catalog.readEvidence.v2TransportErrors, 3)
  assert.equal(catalog.readEvidence.v3TransportErrors, 12)
  assert.ok(catalog.rejected.every((item) => item.error === 'PUBLIC_RPC_NETWORK'))
  assert.ok(
    catalog.rejected.every((item) => !/secret|Request body|deadbeef|example\.invalid/i.test(JSON.stringify(item))),
  )
})

test('partial catalog refresh retains only exact transiently failed queries inside the evidence lifetime', () => {
  const previous = {
    blockNumber: '100',
    v2Pools: [{ address: EARN_POOL, token0: USDG, token1: STOCK, reserve0: '1', reserve1: '2' }],
    v3Pools: [{ address: V3_A, token0: USDG, token1: STOCK, fee: 500, liquidity: '3' }],
  }
  const current = {
    blockNumber: '200',
    v2Pools: [],
    v3Pools: [],
    v4Pools: [],
    rejected: [
      { venue: 'UNISWAP_V2', token0: STOCK, token1: USDG, error: 'temporary', rpcClass: 'NETWORK' },
      { venue: 'UNISWAP_V3', token0: STOCK, token1: USDG, fee: 500, error: 'temporary', rpcClass: 'THROTTLED' },
      { venue: 'UNISWAP_V3', token0: STOCK, token1: USDG, fee: 3_000, reason: 'zero active liquidity' },
    ],
    readEvidence: {
      status: 'PARTIAL',
      complete: false,
      requestedPairs: 1,
      requestedV3FeeQueries: 4,
      v2TransportErrors: 1,
      v3TransportErrors: 1,
    },
  }
  const merged = mergeRobinhoodPartialCatalog(current, previous, {
    generatedAt: '2026-09-15T00:05:00.000Z',
    previousGeneratedAt: '2026-09-15T00:00:00.000Z',
  })

  assert.equal(merged.v2Pools.length, 1)
  assert.equal(merged.v3Pools.length, 1)
  assert.ok(
    [...merged.v2Pools, ...merged.v3Pools].every(
      (pool) =>
        pool.lastVerifiedAt === '2026-09-15T00:00:00.000Z' &&
        pool.catalogObservation === 'RETAINED_AFTER_CURRENT_TRANSIENT_QUERY_FAILURE',
    ),
  )
  assert.deepEqual(merged.readEvidence.topologyRetention, {
    policy: ROBINHOOD_PARTIAL_CATALOG_RETENTION_POLICY.version,
    previousCatalogBlock: '100',
    freshV2Pools: 0,
    freshV3Pools: 0,
    retainedV2Pools: 1,
    retainedV3Pools: 1,
    expiredV2Pools: 0,
    expiredV3Pools: 0,
  })
})

test('catalog retention does not preserve deterministic negatives, stale pools, or duplicate a fresh result', () => {
  const previous = {
    blockNumber: '100',
    v2Pools: [{ address: EARN_POOL, token0: USDG, token1: STOCK, reserve0: '1', reserve1: '2' }],
    v3Pools: [{ address: V3_A, token0: USDG, token1: STOCK, fee: 500, liquidity: '3' }],
  }
  const base = {
    blockNumber: '200',
    v2Pools: [],
    v3Pools: [],
    v4Pools: [],
    readEvidence: {
      status: 'PARTIAL',
      complete: false,
      requestedPairs: 1,
      requestedV3FeeQueries: 4,
      v2TransportErrors: 1,
      v3TransportErrors: 1,
    },
  }
  const deterministic = mergeRobinhoodPartialCatalog(
    {
      ...base,
      rejected: [
        { venue: 'UNISWAP_V2', token0: USDG, token1: STOCK, error: 'reverted', rpcClass: 'INVARIANT' },
        { venue: 'UNISWAP_V3', token0: USDG, token1: STOCK, fee: 500, error: 'reverted', rpcClass: 'INVARIANT' },
      ],
    },
    previous,
    { generatedAt: '2026-09-15T00:05:00.000Z', previousGeneratedAt: '2026-09-15T00:00:00.000Z' },
  )
  assert.equal(deterministic.v2Pools.length, 0)
  assert.equal(deterministic.v3Pools.length, 0)

  const expired = mergeRobinhoodPartialCatalog(
    {
      ...base,
      rejected: [
        { venue: 'UNISWAP_V2', token0: USDG, token1: STOCK, error: 'timeout', rpcClass: 'NETWORK' },
        { venue: 'UNISWAP_V3', token0: USDG, token1: STOCK, fee: 500, error: 'timeout', rpcClass: 'NETWORK' },
      ],
    },
    previous,
    { generatedAt: '2026-09-15T07:00:00.001Z', previousGeneratedAt: '2026-09-15T00:00:00.000Z' },
  )
  assert.equal(expired.v2Pools.length, 0)
  assert.equal(expired.v3Pools.length, 0)
  assert.equal(expired.readEvidence.topologyRetention.expiredV2Pools, 1)
  assert.equal(expired.readEvidence.topologyRetention.expiredV3Pools, 1)

  const fresh = mergeRobinhoodPartialCatalog(
    {
      ...base,
      v2Pools: [{ address: EARN_POOL, token0: USDG, token1: STOCK, reserve0: '4', reserve1: '5' }],
      rejected: [{ venue: 'UNISWAP_V2', token0: USDG, token1: STOCK, error: 'timeout', rpcClass: 'NETWORK' }],
    },
    previous,
    { generatedAt: '2026-09-15T00:05:00.000Z', previousGeneratedAt: '2026-09-15T00:00:00.000Z' },
  )
  assert.equal(fresh.v2Pools.length, 1)
  assert.equal(fresh.v2Pools[0].reserve0, '4')
  assert.equal(fresh.v2Pools[0].catalogObservation, 'CURRENT_FIXED_BLOCK_READ')
})

test('Permit2-incompatible Earn tokens disable only their input edges and add hyperedge', () => {
  const graph = buildUnifiedLiquidityGraph({
    earnPools: [
      {
        address: BPT,
        initialized: true,
        addLiquidityExecutable: false,
        addLiquidityReason: 'blocked token approval',
        tokens: [
          { address: USDG, symbol: 'USDG', decimals: 6, permit2Compatible: true },
          { address: STOCK, symbol: 'BLOCKED', decimals: 18, permit2Compatible: false },
        ],
      },
    ],
  })
  assert.ok(graph.edges.some((edge) => edge.tokenIn === USDG && edge.tokenOut === STOCK))
  assert.ok(!graph.edges.some((edge) => edge.tokenIn === STOCK && edge.venue === 'EARN'))
  assert.ok(graph.hyperedges.some((edge) => edge.kind === 'EARN_REMOVE_PROPORTIONAL'))
  assert.ok(!graph.hyperedges.some((edge) => edge.kind === 'EARN_ADD_UNBALANCED'))
  assert.ok(graph.rejected.some((item) => item.venue === 'EARN_ADD' && item.reason === 'blocked token approval'))
  assert.ok(graph.rejected.some((item) => item.venue === 'EARN_INPUT' && item.token === STOCK))
})

test('managed exact work keeps one best amount per route and fair settlement coverage', () => {
  const candidate = (settlementToken, templateId, quoteDelta, fundingMode = 'MORPHO_FLASH') => ({
    settlementToken,
    templateId,
    quoteDelta: BigInt(quoteDelta),
    fundingMode,
    plan: { actions: [{}, {}] },
  })
  const selected = selectBoundedManagedCandidates(
    [
      candidate(USDG, 'usd-a', 4),
      candidate(USDG, 'usd-a', 8),
      candidate(USDG, 'usd-b', 7),
      candidate(WETH, 'eth-a', 3),
      candidate(WETH, 'eth-b', 2),
    ],
    3,
  )
  assert.deepEqual(
    selected.map((item) => `${item.settlementToken.toLowerCase()}:${item.templateId}:${item.quoteDelta}`),
    [`${USDG}:usd-a:8`, `${WETH}:eth-a:3`, `${USDG}:usd-b:7`],
  )
})
