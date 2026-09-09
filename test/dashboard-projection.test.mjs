import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildDashboardModel,
  coverageQuality,
  dashboardApiNeedsOpportunityDetails,
  dashboardApiNeedsOpportunityProjection,
  filterDashboardOpportunities,
  projectDashboardOpportunities,
  routeDashboardApi,
} from '../src/dashboard-projection.mjs'
import { stablePayloadHash } from '../src/source-provenance.mjs'

const NINECAT = '0x7D3f54f19038D5B819e8730606D048DE9D0d1e18'
const AI = '0x2e8c31162B855A2FFa90f6f8634643Ad6F111E18'

function evidence(evidenceId, producer, blockNumber = '45879015') {
  return {
    evidenceId,
    kind: 'RECEIPT_LOG',
    producer,
    observedAt: '2026-09-07T00:00:00.000Z',
    chainId: 4663,
    blockNumber,
    blockHash: `0x${'a'.repeat(64)}`,
    transactionHash: `0x${'b'.repeat(64)}`,
    payloadHash: `sha256:${'c'.repeat(64)}`,
    status: 'OBSERVED',
    payload: {},
  }
}

function runtimeFixture() {
  const longEvidence = evidence('long:ninecat', 'LONG_LAUNCHER_LOG_ADAPTER')
  const dopplerEvidence = evidence('doppler:ninecat', 'DOPPLER_CREATE_LOG_ADAPTER')
  const poolEvidence = evidence('pool:ninecat-ai', 'UNISWAP_V4_POOL_MANAGER_ADAPTER')
  const pairEvidence = {
    ...evidence('pair:ninecat', 'PAIR_CATALOG_API', null),
    kind: 'SOURCE_RESPONSE',
  }
  const registryPayload = { addresses: [] }
  const registryEvidence = {
    evidenceId: 'rh:test',
    kind: 'REGISTRY_SNAPSHOT',
    producer: 'ROBINHOOD_ASSETS_API',
    observedAt: '2026-09-07T00:00:00.000Z',
    chainId: 4663,
    blockNumber: null,
    blockHash: null,
    transactionHash: null,
    payloadHash: stablePayloadHash(registryPayload),
    status: 'OBSERVED',
    payload: registryPayload,
  }
  return {
    snapshot: {
      schemaVersion: 4,
      generatedAt: '2026-09-07T00:01:00.000Z',
      health: { status: 'RUNNING', signerLoaded: false },
      coverage: { candidateTokens: 0, counts: {} },
      items: [],
    },
    sourceCatalog: {
      schemaVersion: 4,
      registryVersion: 'test',
      summary: { pairListings: 1, longLaunches: 1, dopplerLaunches: 1, dopplerTargetsDiscovered: 1, genericPools: 1 },
      adapters: {},
      evidence: [pairEvidence, registryEvidence],
      pairListings: [
        {
          adapterId: 'pair.catalog.v1',
          targetAddress: NINECAT,
          platformId: 'PAIR',
          symbol: 'NINECAT',
          name: 'Nine Cat',
          evidenceIds: [pairEvidence.evidenceId],
        },
      ],
      assetRegistry: { addresses: [], evidenceIds: ['rh:test'] },
      longLaunches: [
        {
          asset: NINECAT,
          numeraire: AI,
          normalizedTicker: 'NINECAT',
          entryContract: '0x22e99278308B393ea1260859B181AD7E78f5eeED',
          evidence: longEvidence,
        },
      ],
      dopplerLaunches: [{ asset: NINECAT, numeraire: AI, evidence: dopplerEvidence }],
      pools: [
        {
          poolId: `0x${'d'.repeat(64)}`,
          currency0: AI,
          currency1: NINECAT,
          evidence: poolEvidence,
        },
      ],
    },
  }
}

test('source-only NINECAT reads LONG route / Doppler / Uniswap v4 / custom NINECAT-AI', () => {
  const opportunities = projectDashboardOpportunities(runtimeFixture())
  assert.equal(opportunities.length, 1)
  const item = opportunities[0]
  assert.equal(item.target.symbol, 'NINECAT')
  assert.equal(item.quoteAssets[0].symbol, 'AI')
  assert.equal(item.quoteAssets.length, 1)
  assert.equal(item.pairClass, 'CUSTOM_TOKEN/CUSTOM_TOKEN')
  assert.equal(item.provenance.platformAttribution.platformId, 'LONG_ROUTE')
  assert.equal(item.provenance.platformAttribution.status, 'CHAIN_ATTESTED')
  assert.equal(item.provenance.launchFrontend.status, 'UNKNOWN')
  assert.equal(item.provenance.launchProtocol.protocolId, 'DOPPLER')
  assert.equal(item.provenance.liquidityVenue.venueId, 'UNISWAP_V4')
  assert.equal(item.axes.quote, 'UNQUOTED')
  assert.equal(item.axes.execution, 'NONE')
})

test('PAIR listing is visible but cannot overwrite a LONG route', () => {
  const [item] = projectDashboardOpportunities(runtimeFixture())
  assert.equal(item.provenance.listings[0].platformId, 'PAIR')
  assert.equal(item.provenance.platformAttribution.platformId, 'LONG_ROUTE')
})

test('compact runtime facts retain evidence timelines without embedding duplicate payloads', () => {
  const fixture = runtimeFixture()
  for (const collection of ['longLaunches', 'dopplerLaunches', 'pools']) {
    fixture.sourceCatalog[collection] = fixture.sourceCatalog[collection].map((fact) => {
      const evidenceId = fact.evidence.evidenceId
      const compact = { ...fact }
      delete compact.evidence
      return { ...compact, evidenceId }
    })
  }
  const [item] = projectDashboardOpportunities(fixture)
  assert.equal(item.provenance.platformAttribution.evidenceIds[0], 'long:ninecat')
  assert.equal(item.provenance.launchProtocol.evidenceIds[0], 'doppler:ninecat')
  assert.equal(item.evidenceTimeline.length, 4)
})

test('schema-v5 dashboard derives Doppler attribution from the compact target index', () => {
  const fixture = runtimeFixture()
  const longEvidenceId = fixture.sourceCatalog.longLaunches[0].evidence.evidenceId
  delete fixture.sourceCatalog.longLaunches[0].evidence
  delete fixture.sourceCatalog.longLaunches[0].entryContract
  fixture.sourceCatalog.longLaunches[0].evidenceId = longEvidenceId
  const dopplerEvidenceId = fixture.sourceCatalog.dopplerLaunches[0].evidence.evidenceId
  delete fixture.sourceCatalog.dopplerLaunches
  fixture.sourceCatalog.schemaVersion = 5
  fixture.sourceCatalog.runtimeProjection = {
    version: 1,
    factShape: 'EVIDENCE_LINKED_ROUTE_MINIMUM',
    chainEvidenceStore: 'APPEND_ONLY_JSONL_AND_SQLITE',
    dopplerLaunchDetails: 'DERIVED_FROM_TARGET_INDEX',
  }
  fixture.sourceCatalog.sourceAdapterCursors = { 'uniswap-v4.pool-manager.v1': '45879016' }
  fixture.sourceCatalog.dopplerTargetIndex = [
    { asset: NINECAT, numeraire: AI, blockNumber: '45879015', evidenceId: dopplerEvidenceId },
  ]
  const [item] = projectDashboardOpportunities(fixture)
  assert.equal(
    item.provenance.platformAttribution.entryContract.toLowerCase(),
    '0x22e99278308b393ea1260859b181ad7e78f5eeed',
  )
  assert.equal(item.provenance.launchProtocol.protocolId, 'DOPPLER')
  assert.equal(item.provenance.launchProtocol.evidenceIds[0], 'doppler:ninecat')
})

test('native zero-address liquidity is a route leg, never a standalone opportunity target', () => {
  const fixture = runtimeFixture()
  fixture.sourceCatalog.pools.push({
    poolId: `0x${'e'.repeat(64)}`,
    currency0: '0x0000000000000000000000000000000000000000',
    currency1: AI,
    evidence: evidence('pool:ai-native', 'UNISWAP_V4_POOL_MANAGER_ADAPTER'),
  })
  const opportunities = projectDashboardOpportunities(fixture)
  assert.equal(
    opportunities.some((item) => item.target.address.toLowerCase() === '0x0000000000000000000000000000000000000000'),
    false,
  )
})

test('filters expose explicit attribution and economic axes', () => {
  const opportunities = projectDashboardOpportunities(runtimeFixture())
  assert.equal(filterDashboardOpportunities(opportunities, { platform: 'LONG_ROUTE' }).length, 1)
  assert.equal(filterDashboardOpportunities(opportunities, { platform: 'PAIR' }).length, 0)
  assert.equal(filterDashboardOpportunities(opportunities, { attribution: 'CHAIN_ATTESTED' }).length, 1)
  assert.equal(filterDashboardOpportunities(opportunities, { query: 'artificial' }).length, 0)
  assert.equal(filterDashboardOpportunities(opportunities, { query: AI.slice(0, 8) }).length, 1)
})

test('overview never merges proxy screens, exact-ready, receipts and realized net', () => {
  const fixture = runtimeFixture()
  fixture.snapshot.items = [
    {
      id: NINECAT.toLowerCase(),
      tokenAddress: NINECAT,
      symbol: 'NINECAT',
      status: 'SCREENED_NET_POSITIVE',
      fresh: true,
      quotedAt: fixture.snapshot.generatedAt,
      screenedNetUsdg: '0.25',
      amountInUsdg: '25',
      pools: [],
    },
  ]
  const model = buildDashboardModel({
    ...fixture,
    executions: [
      { executionId: 'one', state: 'CONFIRMED', economicsState: 'RECEIPT_ONLY' },
      { executionId: 'two', state: 'CONFIRMED', economicsState: 'REALIZED_NET_VERIFIED', realizedNetUsdg: '0.5' },
    ],
  })
  assert.equal(model.overview.screenedPositive, 1)
  assert.equal(model.overview.exactReady, 0)
  assert.equal(model.overview.confirmed, 2)
  assert.equal(model.overview.realizedNetUsdg, '0.500000')
})

test('coverage funnel keeps discovered pools, fresh quotes and receipts as separate stages', () => {
  const fixture = runtimeFixture()
  fixture.snapshot.coverage = { candidateTokens: 10, freshQuotedTokens: 2, counts: {} }
  fixture.snapshot.health.eventDrivenShadow = {
    lastPeriodicCycleAt: '2026-09-07T00:00:30.000Z',
    lastEventToQuoteMs: 12_000,
  }
  fixture.sourceCatalog.summary.genericPools = 100
  fixture.sourceCatalog.summary.strategyGraph = {
    multiPoolTargets: 30,
    admittedCandidates: 10,
    executorShapeMultiPoolTargets: 3,
  }
  const model = buildDashboardModel({
    ...fixture,
    executions: [{ state: 'CONFIRMED', economicsState: 'REALIZED_NET_VERIFIED', realizedNetUsdg: '0.1' }],
  })
  assert.deepEqual(model.overview.funnel, {
    discoveredPools: 100,
    multiPoolTargets: 30,
    admittedCandidates: 10,
    freshQuotes: 2,
    proxyPositive: 0,
    exactReady: 0,
    confirmedReceipts: 1,
    executorShapeCandidates: 3,
  })
  assert.equal(model.overview.coverageQuality.status, 'LIMITED')
  assert.equal(model.overview.coverageQuality.freshCoveragePct, 20)
  assert.deepEqual(model.overview.coverageQuality.reasons, ['FRESH_QUOTES_COVER_PART_OF_GRAPH'])
})

test('a running daemon without a completed periodic scan is reported as limited coverage', () => {
  const fixture = runtimeFixture()
  fixture.snapshot.coverage = { candidateTokens: 10, freshQuotedTokens: 0, counts: {} }
  fixture.sourceCatalog.summary.strategyGraph = { multiPoolTargets: 10, admittedCandidates: 10 }
  assert.deepEqual(coverageQuality(fixture.snapshot, fixture.sourceCatalog).reasons, [
    'NO_COMPLETED_PERIODIC_RECONCILIATION',
    'FRESH_QUOTES_COVER_PART_OF_GRAPH',
  ])
})

test('dashboard selects a WETH-only positive lane without exposing raw nested quote fields', () => {
  const fixture = runtimeFixture()
  fixture.snapshot.schemaVersion = 5
  fixture.snapshot.items = [
    {
      id: NINECAT.toLowerCase(),
      tokenAddress: NINECAT,
      symbol: 'NINECAT',
      status: 'NO_EDGE',
      fresh: true,
      quotedAt: fixture.snapshot.generatedAt,
      amountInUsdg: '25',
      screenedNetUsdg: '-0.2',
      preferredBaseAsset: 'WETH',
      baseOpportunities: {
        USDG: {
          baseAsset: 'USDG',
          status: 'NO_EDGE',
          fresh: true,
          quotedAt: fixture.snapshot.generatedAt,
          amountInBase: '25',
          normalizedAmountInUsdg: '25',
          normalizedScreenedNetUsdg: '-0.2',
          route: 'AI → NINECAT → AI',
        },
        WETH: {
          baseAsset: 'WETH',
          status: 'SCREENED_NET_POSITIVE',
          fresh: true,
          quotedAt: fixture.snapshot.generatedAt,
          blockNumber: '45879015',
          blockHash: `0x${'d'.repeat(64)}`,
          amountInBase: '0.003019633961984217',
          normalizedAmountInUsdg: '10',
          normalizedGrossProfitUsdg: '0.9',
          normalizedGasCostProxyUsdg: '0.2',
          normalizedScreenedNetUsdg: '0.7',
          route: 'USDG → NINECAT → AI',
          evidenceLevel: 'FIXED_BLOCK_QUOTER_SCREEN_WITH_POOL_ATTESTATION_AND_V3_SHORTLIST',
        },
      },
      pools: [],
    },
  ]

  const [item] = projectDashboardOpportunities(fixture)
  assert.equal(item.axes.quote, 'FRESH_PROXY_POSITIVE')
  assert.equal(item.routeLabel, 'USDG → NINECAT → AI')
  assert.equal(item.quote.baseAsset, 'WETH')
  assert.equal(item.quote.bestSizeBase, '0.003019633961984217')
  assert.equal(item.quote.bestSizeUsdg, '10')
  assert.equal(item.quote.grossProfitUsdg, '0.9')
  assert.equal(item.quote.gasCostProxyUsdg, '0.2')
  assert.equal(item.quote.screenedNetUsdg, '0.7')
  assert.equal('baseOpportunities' in item.quote, false)
  const summary = buildDashboardModel(fixture).opportunities[0]
  assert.equal(summary.quote.baseAsset, 'WETH')
  assert.equal(summary.quote.bestSizeBase, '0.003019633961984217')
})

test('runtime opportunity projection excludes discovery-only rows and omits detail payloads', () => {
  const fixture = runtimeFixture()
  assert.equal(
    buildDashboardModel({
      ...fixture,
      includeSourceOnly: false,
    }).opportunities.length,
    0,
  )
  fixture.snapshot.items = [
    {
      id: NINECAT.toLowerCase(),
      tokenAddress: NINECAT,
      symbol: 'NINECAT',
      status: 'NO_EDGE',
      fresh: true,
      quotedAt: fixture.snapshot.generatedAt,
      pools: [],
    },
  ]
  const model = buildDashboardModel({
    ...fixture,
    includeSourceOnly: false,
    includeOpportunityDetails: false,
  })
  assert.equal(model.opportunities.length, 1)
  assert.deepEqual(model.opportunities[0].evidenceTimeline, [])
  assert.deepEqual(model.opportunities[0].pools, [])
  assert.deepEqual(model.opportunities[0].provenance.listings, [])
  assert.equal(model.opportunities[0].provenance.platformAttribution.platformId, 'LONG_ROUTE')
})

test('control-plane projection computes overview without materializing opportunities', () => {
  const fixture = runtimeFixture()
  fixture.snapshot.items = [
    {
      id: NINECAT.toLowerCase(),
      tokenAddress: NINECAT,
      status: 'SCREENED_NET_POSITIVE',
      fresh: true,
      quotedAt: fixture.snapshot.generatedAt,
      pools: [],
    },
  ]
  const model = buildDashboardModel({
    ...fixture,
    includeOpportunities: false,
  })
  assert.deepEqual(model.opportunities, [])
  assert.equal(model.overview.freshCandidates, 1)
  assert.equal(model.overview.screenedPositive, 1)
})

test('dashboard API declares whether a route needs summaries or claim-level details', () => {
  assert.equal(dashboardApiNeedsOpportunityProjection('/api/v1/system'), false)
  assert.equal(dashboardApiNeedsOpportunityProjection('/api/v1/opportunities'), true)
  assert.equal(dashboardApiNeedsOpportunityDetails('/api/v1/opportunities'), false)
  assert.equal(dashboardApiNeedsOpportunityDetails(`/api/v1/opportunities/${NINECAT}`), true)
})

test('read-only API router exposes all v1 projections and rejects malformed detail ids', () => {
  const fixture = runtimeFixture()
  const model = buildDashboardModel(fixture)
  const query = routeDashboardApi('/api/v1/opportunities', new URLSearchParams({ platform: 'LONG_ROUTE' }), model)
  assert.equal(query.status, 200)
  assert.equal(query.payload.count, 1)
  assert.equal(query.payload.view, 'SUMMARY')
  assert.equal(query.payload.items[0].evidenceTimeline, undefined)
  const detail = routeDashboardApi(
    `/api/v1/opportunities/${encodeURIComponent(query.payload.items[0].opportunityId)}`,
    new URLSearchParams(),
    model,
  )
  assert.equal(detail.status, 200)
  assert.equal(detail.payload.evidenceTimeline.length, 4)
  assert.equal(
    detail.payload.evidenceTimeline.some((item) => item.claimType === 'PLATFORM_ROUTE'),
    true,
  )
  assert.equal(routeDashboardApi('/api/v1/overview', new URLSearchParams(), model).status, 200)
  const sources = routeDashboardApi('/api/v1/sources', new URLSearchParams(), model)
  assert.equal(sources.status, 200)
  assert.equal(sources.payload.summary.dopplerTargetsDiscovered, 1)
  assert.equal(routeDashboardApi('/api/v1/episodes', new URLSearchParams(), model).status, 200)
  assert.equal(routeDashboardApi('/api/v1/executions', new URLSearchParams(), model).status, 200)
  assert.equal(routeDashboardApi('/api/v1/system', new URLSearchParams(), model).status, 200)
  assert.equal(routeDashboardApi('/api/v1/opportunities/%E0%A4%A', new URLSearchParams(), model).status, 400)
  assert.equal(routeDashboardApi('/api/v1/unknown', new URLSearchParams(), model).status, 404)
  assert.equal(routeDashboardApi('/api/v1/overview', new URLSearchParams(), null).status, 503)
})
