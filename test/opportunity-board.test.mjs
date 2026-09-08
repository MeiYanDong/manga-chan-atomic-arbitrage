import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  BoardStatus,
  EpisodeObservation,
  EpisodeState,
  applyFreshness,
  buildBoardSnapshot,
  chooseBestBaseOpportunity,
  catalogIsComplete,
  compactExecutionBoardSnapshot,
  materialEvents,
  nextCycleDelay,
  normalizePairCandidate,
  normalizePersistedBoardSnapshot,
  publicError,
  reconcileOpportunityEpisodes,
  screenRoundTrip,
  screenedPositiveObservationCount,
  screenWethRoundTrip,
  writeExecutionBoardSnapshot,
  writeJsonAtomic,
  writeStableJsonAtomic,
} from '../src/opportunity-board.mjs'
import { canonicalPoolKey, pairPoolId } from '../src/pair-catalog.mjs'
import { stablePayloadHash } from '../src/source-provenance.mjs'

test('cycle pacing preserves start interval and enforces a post-cycle cooldown', () => {
  assert.equal(nextCycleDelay({ scanIntervalMs: 120_000, cycleDurationMs: 45_000, minimumPauseMs: 60_000 }), 75_000)
  assert.equal(nextCycleDelay({ scanIntervalMs: 120_000, cycleDurationMs: 150_000, minimumPauseMs: 60_000 }), 60_000)
  assert.throws(
    () => nextCycleDelay({ scanIntervalMs: 120_000, cycleDurationMs: -1, minimumPauseMs: 60_000 }),
    /non-negative/,
  )
})

test('execution snapshot keeps only fresh positive rows without mutating the full dashboard snapshot', () => {
  const positive = { id: 'positive', status: BoardStatus.SCREENED_POSITIVE, fresh: true }
  const snapshot = {
    schemaVersion: 4,
    service: 'manga-opportunity-board',
    mode: 'READ_ONLY_NO_SIGNING_NO_BROADCAST',
    selection: { executionAuthorized: false, id: positive.id },
    items: [
      positive,
      { id: 'stale-positive', status: BoardStatus.SCREENED_POSITIVE, fresh: false },
      { id: 'no-edge', status: BoardStatus.NO_EDGE, fresh: true },
    ],
  }
  const compact = compactExecutionBoardSnapshot(snapshot)
  assert.deepEqual(compact.items, [positive])
  assert.equal(compact.selection, snapshot.selection)
  assert.equal(snapshot.items.length, 3)
})

test('execution snapshot retains a WETH-only positive lane while legacy USDG remains non-positive', () => {
  const wethOnly = {
    id: 'weth-only',
    status: BoardStatus.NO_EDGE,
    fresh: true,
    baseOpportunities: {
      WETH: { baseAsset: 'WETH', status: BoardStatus.SCREENED_POSITIVE, fresh: true },
    },
  }
  const compact = compactExecutionBoardSnapshot({ schemaVersion: 5, items: [wethOnly] })
  assert.deepEqual(compact.items, [wethOnly])
})

test('post-quote checkpoint counts each newly quoted candidate once across USDG and WETH lanes', () => {
  assert.equal(
    screenedPositiveObservationCount([
      { status: BoardStatus.SCREENED_POSITIVE },
      {
        status: BoardStatus.NO_EDGE,
        baseOpportunities: {
          USDG: { status: BoardStatus.NO_EDGE },
          WETH: { status: BoardStatus.SCREENED_POSITIVE },
        },
      },
      { status: BoardStatus.GROSS_POSITIVE },
      null,
    ]),
    2,
  )
  assert.throws(() => screenedPositiveObservationCount(/** @type {any} */ ({})), /must be an array/)
})

test('WETH screening subtracts native Gas exactly and normalizes conservatively to USDG', () => {
  const result = screenWethRoundTrip({
    amountIn: 4_000_000_000_000_000n,
    amountOut: 4_500_000_000_000_000n,
    quoterGas: [50_000n, 50_000n, 50_000n, 50_000n],
    overheadGas: 100_000n,
    gasPriceWei: 1_000_000_000n,
    nativeMarkInWei: 4_000_000_000_000_000n,
    nativeMarkOutUsdg: 10_000_000n,
  })

  assert.equal(result.grossProfitWei, 500_000_000_000_000n)
  assert.equal(result.gasCostWei, 300_000_000_000_000n)
  assert.equal(result.screenedNetWei, 200_000_000_000_000n)
  assert.equal(result.normalizedGrossProfitUsdg, 1_250_000n)
  assert.equal(result.normalizedGasCostUsdg, 750_000n)
  assert.equal(result.normalizedScreenedNetUsdg, 500_000n)
  assert.equal(result.status, BoardStatus.SCREENED_POSITIVE)
})

test('WETH screening does not promote an edge that rounds below one normalized USDG unit', () => {
  const result = screenWethRoundTrip({
    amountIn: 1_000_000n,
    amountOut: 1_000_002n,
    quoterGas: [1n],
    overheadGas: 0n,
    gasPriceWei: 1n,
    nativeMarkInWei: 1_000_000_000_000_000_000n,
    nativeMarkOutUsdg: 1_000_000n,
  })
  assert.equal(result.screenedNetWei, 1n)
  assert.equal(result.normalizedScreenedNetUsdg, -1n)
  assert.equal(result.status, BoardStatus.GROSS_POSITIVE)
})

test('global base selection compares only fresh positive lanes in normalized USDG', () => {
  const selected = chooseBestBaseOpportunity([
    {
      baseAsset: 'WETH',
      status: BoardStatus.SCREENED_POSITIVE,
      fresh: true,
      normalizedAmountInUsdg: '1',
      normalizedGrossProfitUsdg: '1',
      normalizedScreenedNetUsdg: '-1',
    },
    {
      baseAsset: 'USDG',
      status: BoardStatus.SCREENED_POSITIVE,
      fresh: true,
      normalizedAmountInUsdg: '25',
      normalizedGrossProfitUsdg: '0.9',
      normalizedScreenedNetUsdg: '0.4',
    },
    {
      baseAsset: 'WETH',
      status: BoardStatus.SCREENED_POSITIVE,
      fresh: true,
      normalizedAmountInUsdg: '10',
      normalizedGrossProfitUsdg: '1.2',
      normalizedScreenedNetUsdg: '0.7',
    },
    {
      baseAsset: 'WETH',
      status: BoardStatus.SCREENED_POSITIVE,
      fresh: false,
      normalizedAmountInUsdg: '5',
      normalizedGrossProfitUsdg: '5',
      normalizedScreenedNetUsdg: '4',
    },
  ])
  assert.equal(selected.baseAsset, 'WETH')
})

test('large stable JSON writes are atomic, parseable and hash-identical to canonical provenance', (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'manga-stable-json-'))
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const file = path.join(directory, 'source-catalog.json')
  const value = {
    zeta: '猫',
    items: Array.from({ length: 5_000 }, (_, index) => ({ z: index, a: `token-${index}` })),
    alpha: { nested: true, count: 5_000 },
  }

  const result = writeStableJsonAtomic(file, value)

  assert.equal(result.hash, stablePayloadHash(value))
  assert.equal(result.bytes, fs.statSync(file).size)
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), value)
  assert.equal(fs.statSync(file).mode & 0o777, 0o640)
  assert.deepEqual(fs.readdirSync(directory), ['source-catalog.json'])
})

test('execution snapshot is atomically persisted as a group-readable non-writable projection', (context) => {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manga-execution-snapshot-'))
  context.after(() => fs.rmSync(runDir, { recursive: true, force: true }))
  const file = path.join(runDir, 'execution-snapshot.json')
  const snapshot = {
    schemaVersion: 4,
    service: 'manga-opportunity-board',
    mode: 'READ_ONLY_NO_SIGNING_NO_BROADCAST',
    selection: { executionAuthorized: false },
    items: [
      { id: 'positive', status: BoardStatus.SCREENED_POSITIVE, fresh: true },
      { id: 'negative', status: BoardStatus.NO_EDGE, fresh: true },
    ],
  }

  const compact = writeExecutionBoardSnapshot(file, snapshot)
  const persisted = JSON.parse(fs.readFileSync(file, 'utf8'))

  assert.deepEqual(persisted, compact)
  assert.deepEqual(
    persisted.items.map((item) => item.id),
    ['positive'],
  )
  assert.equal(fs.statSync(file).mode & 0o777, 0o640)
  assert.equal(fs.existsSync(`${file}.${process.pid}.tmp`), false)
})

const TOKEN = '0x7aad9faa5ee27bdeeb17d5a8c1870278824c4c59'
const GOOGL = '0x2e0847e8910a9732eb3fb1bb4b70a580adad4fe3'
const MU = '0xff080c8ce2e5feadaca0da81314ae59d232d4afd'
const HOOK = '0x16d1560630ce74af4478d9b8ad46548a092a2000'

function pair(overrides = {}) {
  const value = {
    ammVersion: 'V4_MULTI',
    canonical: true,
    poolFee: 10_000,
    tickSpacing: 200,
    hookAddress: HOOK,
    activeVirtualSwapDepthUsd: '687.12',
    impliedPriceUsd: '0.0000036',
    quoteToken: { address: GOOGL, symbol: 'GOOGL', decimals: 18, enabled: true },
    ...overrides,
  }
  return {
    ...value,
    poolId:
      overrides.poolId ||
      pairPoolId(
        canonicalPoolKey(TOKEN, value.quoteToken.address, value.poolFee, value.tickSpacing, value.hookAddress),
      ),
  }
}

function candidateFixture(overrides = {}) {
  return {
    address: TOKEN,
    symbol: 'SIGMA',
    name: 'SIGMA',
    hidden: false,
    flagged: false,
    totalDepthUsd: '3434.39',
    volume24hUsd: null,
    pairs: [
      pair(),
      pair({
        impliedPriceUsd: '0.0000038',
        quoteToken: { address: MU, symbol: 'MU', decimals: 18, enabled: true },
      }),
    ],
    ...overrides,
  }
}

test('PAIR discovery verifies PoolKeys and admits structurally safe shadow pools', () => {
  const stockAddresses = new Set([GOOGL, MU].map((address) => address.toLowerCase()))
  const candidate = normalizePairCandidate(candidateFixture(), { minDepthUsd: 100, stockAddresses })
  assert.equal(candidate.symbol, 'SIGMA')
  assert.equal(candidate.pools.length, 2)
  assert.equal(
    candidate.pools.every((pool) => pool.quoteKind === 'PAIR_QUOTE_ASSET'),
    true,
  )
  assert.equal(Number(candidate.indicativeGapPct.toFixed(2)), 5.56)

  assert.equal(normalizePairCandidate(candidateFixture({ hidden: true }), { minDepthUsd: 100 }), null)
  assert.equal(
    normalizePairCandidate(
      candidateFixture({ pairs: [pair(), pair({ canonical: false, poolId: `0x${'2'.repeat(64)}` })] }),
      { minDepthUsd: 100 },
    ),
    null,
  )
  assert.equal(
    normalizePairCandidate(
      candidateFixture({
        pairs: [pair(), pair({ activeVirtualSwapDepthUsd: '99.99', quoteToken: { address: MU, symbol: 'MU' } })],
      }),
      { minDepthUsd: 100 },
    ),
    null,
  )

  const unknownDepth = normalizePairCandidate(
    candidateFixture({
      pairs: [
        pair({ activeVirtualSwapDepthUsd: null }),
        pair({ activeVirtualSwapDepthUsd: null, quoteToken: { address: MU, symbol: 'MU', enabled: false } }),
      ],
    }),
    { minDepthUsd: 100, stockAddresses },
  )
  assert.equal(unknownDepth.pools.length, 2)
  assert.deepEqual(
    unknownDepth.pools.map((pool) => pool.executionAdmission).sort(),
    ['SHADOW_ONLY_DEPTH_UNKNOWN', 'SHADOW_ONLY_DISABLED_QUOTE'].sort(),
  )
})

test('catalog completeness is evaluated after newest-page reconciliation', () => {
  assert.equal(catalogIsComplete(1_729, 1_728), true)
  assert.equal(catalogIsComplete(1_727, 1_728), false)
  assert.equal(catalogIsComplete(0, 0), false)
})

test('gas proxy uses the exact route gas, overhead and fixed-block native mark', () => {
  const expensive = screenRoundTrip({
    amountIn: 10_000_000n,
    amountOut: 10_500_000n,
    quoterGas: [50_000n, 50_000n, 50_000n, 50_000n],
    overheadGas: 50_000n,
    gasPriceWei: 1_000_000_000n,
    nativeMarkInWei: 4_000_000_000_000_000n,
    nativeMarkOutUsdg: 10_000_000n,
  })
  assert.equal(expensive.routeGas, 200_000n)
  assert.equal(expensive.gasUnitsProxy, 250_000n)
  assert.equal(expensive.gasCostUsdg, 625_000n)
  assert.equal(expensive.grossProfitUsdg, 500_000n)
  assert.equal(expensive.screenedNetUsdg, -125_000n)
  assert.equal(expensive.status, BoardStatus.GROSS_POSITIVE)

  const cheap = screenRoundTrip({
    amountIn: 10_000_000n,
    amountOut: 10_500_000n,
    quoterGas: [50_000n, 50_000n, 50_000n, 50_000n],
    overheadGas: 50_000n,
    gasPriceWei: 100_000_000n,
    nativeMarkInWei: 4_000_000_000_000_000n,
    nativeMarkOutUsdg: 10_000_000n,
  })
  assert.equal(cheap.gasCostUsdg, 62_500n)
  assert.equal(cheap.screenedNetUsdg, 437_500n)
  assert.equal(cheap.status, BoardStatus.SCREENED_POSITIVE)
})

test('freshness fails closed without changing the underlying quote classification', () => {
  const item = { status: BoardStatus.SCREENED_POSITIVE, quotedAt: '2026-09-04T00:00:00.000Z' }
  assert.equal(
    applyFreshness(item, Date.parse('2026-09-04T00:00:29.000Z'), 30_000).status,
    BoardStatus.SCREENED_POSITIVE,
  )
  const stale = applyFreshness(item, Date.parse('2026-09-04T00:00:31.000Z'), 30_000)
  assert.equal(stale.status, BoardStatus.STALE)
  assert.equal(stale.underlyingStatus, BoardStatus.SCREENED_POSITIVE)
  assert.equal(stale.fresh, false)
})

test('persisted execution evidence migrates the obsolete deployment claim without mutating input', () => {
  const persisted = {
    schemaVersion: 3,
    items: [
      { id: 'legacy', executionEstimate: 'NOT_RUN_GENERIC_EXECUTOR_NOT_DEPLOYED' },
      { id: 'current', executionEstimate: 'NOT_RUN_EXACT_EXECUTOR_PREFLIGHT_REQUIRED' },
      { id: 'unquoted', executionEstimate: 'NOT_RUN' },
    ],
  }

  const normalized = normalizePersistedBoardSnapshot(persisted)
  assert.notEqual(normalized, persisted)
  assert.notEqual(normalized.items, persisted.items)
  assert.equal(normalized.items[0].executionEstimate, 'NOT_RUN_EXACT_EXECUTOR_PREFLIGHT_REQUIRED')
  assert.equal(normalized.items[1], persisted.items[1])
  assert.equal(normalized.items[2], persisted.items[2])
  assert.equal(persisted.items[0].executionEstimate, 'NOT_RUN_GENERIC_EXECUTOR_NOT_DEPLOYED')

  const candidate = normalizePairCandidate(candidateFixture(), { minDepthUsd: 100 })
  const snapshot = buildBoardSnapshot({
    generatedAt: '2026-09-07T00:00:01.000Z',
    catalog: [candidate],
    observations: new Map([
      [
        candidate.id,
        {
          status: BoardStatus.NO_EDGE,
          quotedAt: '2026-09-07T00:00:00.000Z',
          executionEstimate: 'NOT_RUN_GENERIC_EXECUTOR_NOT_DEPLOYED',
        },
      ],
    ]),
    staleMs: 60_000,
    sourceState: { catalogComplete: true },
    serviceState: { status: 'RUNNING' },
  })
  assert.equal(snapshot.items[0].executionEstimate, 'NOT_RUN_EXACT_EXECUTOR_PREFLIGHT_REQUIRED')
})

function snapshotAt(generatedAt, observation) {
  const candidate = normalizePairCandidate(candidateFixture(), { minDepthUsd: 100 })
  return buildBoardSnapshot({
    generatedAt,
    catalog: [candidate],
    observations: new Map([[candidate.id, observation]]),
    staleMs: 60_000,
    sourceState: { catalogComplete: true },
    serviceState: { status: 'RUNNING' },
  })
}

test('material event ledger reports entry, meaningful delta and exit without stale noise', () => {
  const baseObservation = {
    status: BoardStatus.NO_EDGE,
    quotedAt: '2026-09-04T00:00:00.000Z',
    screenedNetUsdg: '-0.100000',
  }
  const previous = snapshotAt('2026-09-04T00:00:01.000Z', baseObservation)
  const entered = snapshotAt('2026-09-04T00:00:02.000Z', {
    ...baseObservation,
    quotedAt: '2026-09-04T00:00:02.000Z',
    status: BoardStatus.SCREENED_POSITIVE,
    screenedNetUsdg: '0.120000',
    route: 'GOOGL → SIGMA → MU',
    blockNumber: '100',
  })
  assert.deepEqual(
    materialEvents(previous, entered).map((event) => event.type),
    ['SCREENED_POSITIVE_ENTERED'],
  )

  const changed = snapshotAt('2026-09-04T00:00:03.000Z', {
    ...entered.items[0],
    quotedAt: '2026-09-04T00:00:03.000Z',
    screenedNetUsdg: '0.190000',
  })
  assert.deepEqual(
    materialEvents(entered, changed).map((event) => event.type),
    ['MATERIAL_NET_CHANGE'],
  )

  const left = snapshotAt('2026-09-04T00:00:04.000Z', {
    ...entered.items[0],
    quotedAt: '2026-09-04T00:00:04.000Z',
    status: BoardStatus.NO_EDGE,
    screenedNetUsdg: '-0.020000',
  })
  assert.deepEqual(
    materialEvents(entered, left).map((event) => event.type),
    ['SCREENED_POSITIVE_LEFT'],
  )

  const stale = snapshotAt('2026-09-04T00:02:00.000Z', entered.items[0])
  assert.deepEqual(materialEvents(entered, stale), [])
})

test('economic episode survives stale refresh without a duplicate entry', () => {
  const noEdge = snapshotAt('2026-09-04T00:00:00.000Z', {
    status: BoardStatus.NO_EDGE,
    quotedAt: '2026-09-04T00:00:00.000Z',
    screenedNetUsdg: '-0.100000',
  })
  const positive = snapshotAt('2026-09-04T00:00:01.000Z', {
    status: BoardStatus.SCREENED_POSITIVE,
    quotedAt: '2026-09-04T00:00:01.000Z',
    amountInUsdg: '10',
    amountOutUsdg: '10.600000',
    grossProfitUsdg: '0.600000',
    gasCostProxyUsdg: '0.400000',
    screenedNetUsdg: '0.200000',
    route: 'GOOGL → SIGMA → MU',
    routeKey: 'pool-a:pool-b',
    blockNumber: '100',
    blockHash: `0x${'1'.repeat(64)}`,
    evidenceLevel: 'FIXED_BLOCK_QUOTER_SCREEN',
  })
  const entered = reconcileOpportunityEpisodes(noEdge, positive)
  assert.deepEqual(
    entered.events.map((event) => event.type),
    ['SCREENED_POSITIVE_ENTERED'],
  )
  assert.equal(entered.events[0].grossProfitUsdg, '0.600000')
  assert.equal(entered.events[0].gasCostProxyUsdg, '0.400000')
  assert.equal(entered.snapshot.items[0].economicEpisode.state, 'OPEN')

  const stale = snapshotAt('2026-09-04T00:02:30.000Z', positive.items[0])
  const staleTransition = reconcileOpportunityEpisodes(entered.snapshot, stale)
  assert.deepEqual(staleTransition.events, [])
  assert.equal(staleTransition.snapshot.items[0].economicEpisode.state, 'OPEN')
  assert.equal(staleTransition.snapshot.items[0].economicEpisode.observation, 'UNKNOWN')

  const refreshed = snapshotAt('2026-09-04T00:02:31.000Z', {
    ...positive.items[0],
    quotedAt: '2026-09-04T00:02:31.000Z',
    blockNumber: '101',
    blockHash: `0x${'2'.repeat(64)}`,
    screenedNetUsdg: '0.210000',
  })
  const refreshTransition = reconcileOpportunityEpisodes(staleTransition.snapshot, refreshed)
  assert.deepEqual(refreshTransition.events, [])
  assert.equal(
    refreshTransition.snapshot.items[0].economicEpisode.episodeId,
    entered.snapshot.items[0].economicEpisode.episodeId,
  )
})

test('UNQUOTABLE is unknown continuity and only a fresh economic negative closes the episode', () => {
  const positive = snapshotAt('2026-09-04T00:00:01.000Z', {
    status: BoardStatus.SCREENED_POSITIVE,
    quotedAt: '2026-09-04T00:00:01.000Z',
    amountInUsdg: '10',
    amountOutUsdg: '10.600000',
    grossProfitUsdg: '0.600000',
    gasCostProxyUsdg: '0.400000',
    screenedNetUsdg: '0.200000',
    route: 'GOOGL → SIGMA → MU',
    routeKey: 'pool-a:pool-b',
    blockNumber: '100',
    blockHash: `0x${'1'.repeat(64)}`,
  })
  const baseline = reconcileOpportunityEpisodes(null, positive).snapshot
  const unquotable = snapshotAt('2026-09-04T00:00:02.000Z', {
    status: BoardStatus.UNQUOTABLE,
    quotedAt: '2026-09-04T00:00:02.000Z',
    blockNumber: '101',
    blockHash: `0x${'2'.repeat(64)}`,
    screenedNetUsdg: null,
  })
  const unknown = reconcileOpportunityEpisodes(baseline, unquotable)
  assert.deepEqual(unknown.events, [])
  assert.equal(unknown.snapshot.items[0].economicEpisode.state, 'OPEN')

  const recovered = snapshotAt('2026-09-04T00:00:03.000Z', {
    ...positive.items[0],
    quotedAt: '2026-09-04T00:00:03.000Z',
    blockNumber: '102',
    blockHash: `0x${'3'.repeat(64)}`,
  })
  const recoveredTransition = reconcileOpportunityEpisodes(unknown.snapshot, recovered)
  assert.deepEqual(recoveredTransition.events, [])

  const negative = snapshotAt('2026-09-04T00:00:04.000Z', {
    ...positive.items[0],
    status: BoardStatus.GROSS_POSITIVE,
    quotedAt: '2026-09-04T00:00:04.000Z',
    blockNumber: '103',
    blockHash: `0x${'4'.repeat(64)}`,
    grossProfitUsdg: '0.300000',
    gasCostProxyUsdg: '0.400000',
    screenedNetUsdg: '-0.100000',
  })
  const closed = reconcileOpportunityEpisodes(recoveredTransition.snapshot, negative)
  assert.deepEqual(
    closed.events.map((event) => event.type),
    ['SCREENED_POSITIVE_LEFT'],
  )
  assert.equal(closed.events[0].previousGrossProfitUsdg, '0.600000')
  assert.equal(closed.events[0].currentStatus, BoardStatus.GROSS_POSITIVE)
  assert.equal(closed.snapshot.items[0].economicEpisode.state, 'CLOSED')
})

test('economic episodes include WETH-only positives and remain unknown until every base is freshly negative', () => {
  const quotedAt = '2026-09-04T00:00:00.000Z'
  const lane = (baseAsset, status, net, overrides = {}) => ({
    baseAsset,
    status,
    quotedAt,
    route: `WETH → SIGMA → ${baseAsset}`,
    routeKey: `pool-a:pool-b`,
    amountInBase: baseAsset === 'WETH' ? '0.004' : '10',
    normalizedAmountInUsdg: '10',
    normalizedAmountOutUsdg: '10.8',
    normalizedGrossProfitUsdg: '0.8',
    normalizedGasCostProxyUsdg: '0.2',
    normalizedScreenedNetUsdg: net,
    ...overrides,
  })
  const previous = snapshotAt('2026-09-04T00:00:01.000Z', {
    status: BoardStatus.NO_EDGE,
    quotedAt,
    screenedNetUsdg: '-0.1',
    baseOpportunities: {
      USDG: lane('USDG', BoardStatus.NO_EDGE, '-0.1'),
      WETH: lane('WETH', BoardStatus.NO_EDGE, '-0.2'),
    },
  })
  const positive = snapshotAt('2026-09-04T00:00:02.000Z', {
    status: BoardStatus.NO_EDGE,
    quotedAt: '2026-09-04T00:00:02.000Z',
    screenedNetUsdg: '-0.1',
    baseOpportunities: {
      USDG: lane('USDG', BoardStatus.NO_EDGE, '-0.1', { quotedAt: '2026-09-04T00:00:02.000Z' }),
      WETH: lane('WETH', BoardStatus.SCREENED_POSITIVE, '0.6', {
        quotedAt: '2026-09-04T00:00:02.000Z',
      }),
    },
  })
  const entered = reconcileOpportunityEpisodes(previous, positive)
  assert.deepEqual(
    entered.events.map((event) => event.type),
    ['SCREENED_POSITIVE_ENTERED'],
  )
  assert.equal(entered.events[0].baseAsset, 'WETH')
  assert.equal(entered.events[0].amountInBase, '0.004')
  assert.equal(entered.events[0].screenedNetUsdg, '0.6')
  assert.equal(entered.snapshot.items[0].economicEpisode.lastPositiveBaseAsset, 'WETH')

  const incomplete = snapshotAt('2026-09-04T00:00:03.000Z', {
    ...positive.items[0],
    quotedAt: '2026-09-04T00:00:03.000Z',
    baseOpportunities: {
      USDG: lane('USDG', BoardStatus.NO_EDGE, '-0.1', { quotedAt: '2026-09-04T00:00:03.000Z' }),
      WETH: lane('WETH', BoardStatus.UNQUOTABLE, null, { quotedAt: '2026-09-04T00:00:03.000Z' }),
    },
  })
  const unknown = reconcileOpportunityEpisodes(entered.snapshot, incomplete)
  assert.deepEqual(unknown.events, [])
  assert.equal(unknown.snapshot.items[0].economicEpisode.observation, EpisodeObservation.UNKNOWN)

  const negative = snapshotAt('2026-09-04T00:00:04.000Z', {
    ...positive.items[0],
    quotedAt: '2026-09-04T00:00:04.000Z',
    baseOpportunities: {
      USDG: lane('USDG', BoardStatus.NO_EDGE, '-0.1', { quotedAt: '2026-09-04T00:00:04.000Z' }),
      WETH: lane('WETH', BoardStatus.GROSS_POSITIVE, '-0.05', { quotedAt: '2026-09-04T00:00:04.000Z' }),
    },
  })
  const closed = reconcileOpportunityEpisodes(unknown.snapshot, negative)
  assert.deepEqual(
    closed.events.map((event) => event.type),
    ['SCREENED_POSITIVE_LEFT'],
  )
  assert.equal(closed.snapshot.items[0].economicEpisode.state, EpisodeState.CLOSED)
})

test('snapshot publishing is atomic, private to the service group and contains no endpoint error', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'manga-board-'))
  const file = path.join(directory, 'snapshot.json')
  try {
    writeJsonAtomic(file, { ok: true })
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { ok: true })
    assert.equal(fs.statSync(file).mode & 0o007, 0)
    assert.deepEqual(fs.readdirSync(directory), ['snapshot.json'])
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }

  const redacted = publicError(
    new Error(
      'request failed https://provider.example/v1/secret-key 0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    ),
  )
  assert.equal(redacted.includes('secret-key'), false)
  assert.equal(redacted.includes('aaaaaaaa'), false)
  assert.match(redacted, /redacted-endpoint/)

  const nested = new Error('An unknown RPC error occurred.')
  nested.cause = { details: 'Rate Limit Hit, limit will reset in 60 seconds', message: 'RPC error 429' }
  assert.match(publicError(nested), /Rate Limit Hit/)
  assert.match(publicError(nested), /429/)
})
