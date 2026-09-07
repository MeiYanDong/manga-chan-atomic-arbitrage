import { getAddress } from 'viem'
import { BoardStatus } from './opportunity-board.mjs'
import { AttributionStatus, PlatformId, ProtocolId, VenueId, stablePayloadHash } from './source-provenance.mjs'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
const KNOWN_ASSET_LABELS = new Map(
  [
    [ZERO_ADDRESS, 'ETH'],
    ['0x7d3f54f19038d5b819e8730606d048de9d0d1e18', 'NINECAT'],
    ['0x2e8c31162b855a2ffa90f6f8634643ad6f111e18', 'AI'],
    ['0x0bd7d308f8e1639fab988df18a8011f41eacad73', 'ETH'],
    ['0x5fc5360d0400a0fd4f2af552add042d716f1d168', 'USDG'],
  ].map(([address, symbol]) => [address.toLowerCase(), { symbol, name: symbol }]),
)

function safeAddress(value) {
  try {
    return getAddress(value)
  } catch {
    return null
  }
}

function shortAddress(value) {
  return value ? `${value.slice(0, 6)}…${value.slice(-4)}` : 'UNKNOWN'
}

function metadataIndex(snapshot, sourceCatalog) {
  const metadata = new Map(KNOWN_ASSET_LABELS)
  for (const listing of sourceCatalog?.pairListings || []) {
    metadata.set(listing.targetAddress.toLowerCase(), {
      symbol: listing.symbol || shortAddress(listing.targetAddress),
      name: listing.name || listing.symbol || shortAddress(listing.targetAddress),
    })
  }
  for (const item of snapshot?.items || []) {
    if (item.tokenAddress) {
      metadata.set(item.tokenAddress.toLowerCase(), {
        symbol: item.symbol || shortAddress(item.tokenAddress),
        name: item.name || item.symbol || shortAddress(item.tokenAddress),
      })
    }
    for (const pool of item.pools || []) {
      if (pool.quoteAddress) {
        metadata.set(pool.quoteAddress.toLowerCase(), {
          symbol: pool.quoteSymbol || shortAddress(pool.quoteAddress),
          name: pool.quoteSymbol || shortAddress(pool.quoteAddress),
        })
      }
    }
  }
  for (const launch of sourceCatalog?.longLaunches || []) {
    if (launch.asset && launch.normalizedTicker) {
      metadata.set(launch.asset.toLowerCase(), {
        symbol: launch.normalizedTicker,
        name: launch.normalizedTicker,
      })
    }
  }
  return metadata
}

function labelFor(address, metadata) {
  const normalized = safeAddress(address)
  if (!normalized) return { address: null, symbol: 'UNKNOWN', name: 'Unknown asset' }
  const known = metadata.get(normalized.toLowerCase()) || {}
  return {
    address: normalized,
    symbol: known.symbol || shortAddress(normalized),
    name: known.name || known.symbol || shortAddress(normalized),
  }
}

function canonicalAssetRegistry(sourceCatalog) {
  const declared = new Set((sourceCatalog?.assetRegistry?.addresses || []).map((item) => item.toLowerCase()))
  const evidenceById = new Map((sourceCatalog?.evidence || []).map((item) => [item.evidenceId, item]))
  const evidenceIds = sourceCatalog?.assetRegistry?.evidenceIds || []
  const valid = evidenceIds
    .map((evidenceId) => evidenceById.get(evidenceId))
    .filter(
      (item) =>
        item?.kind === 'REGISTRY_SNAPSHOT' &&
        item?.producer === 'ROBINHOOD_ASSETS_API' &&
        item?.status === 'OBSERVED' &&
        item?.payloadHash === stablePayloadHash(item?.payload) &&
        Array.isArray(item?.payload?.addresses),
    )
  if (valid.length === 0) return { checked: false, addresses: new Set(), evidenceIds: [] }
  const evidenced = new Set(valid.flatMap((item) => item.payload.addresses.map((value) => value.toLowerCase())))
  const matches = declared.size === evidenced.size && [...declared].every((item) => evidenced.has(item))
  return matches
    ? { checked: true, addresses: declared, evidenceIds: valid.map((item) => item.evidenceId) }
    : { checked: false, addresses: new Set(), evidenceIds: [] }
}

function classify(address, registry) {
  if (!address) return { value: 'UNKNOWN', status: AttributionStatus.UNKNOWN, evidenceIds: [] }
  if (!registry.checked) return { value: 'UNKNOWN', status: AttributionStatus.UNKNOWN, evidenceIds: [] }
  return {
    value: registry.addresses.has(address.toLowerCase()) ? 'RH_STOCK_TOKEN' : 'CUSTOM_TOKEN',
    status: 'REGISTRY_CHECKED',
    evidenceIds: registry.evidenceIds,
  }
}

function quoteState(item) {
  if (!item || !item.quotedAt) return 'UNQUOTED'
  if (item.status === BoardStatus.STALE || item.fresh === false) return 'STALE'
  if (item.status === BoardStatus.UNQUOTABLE) return 'UNQUOTABLE'
  if (item.status === BoardStatus.SCREENED_POSITIVE) return 'FRESH_PROXY_POSITIVE'
  return 'FRESH_NO_EDGE'
}

function evidenceTimeline({ listings, longLaunches, dopplerLaunches, pools, sourceEvidence }) {
  const envelopes = new Map((sourceEvidence || []).map((item) => [item.evidenceId, item]))
  for (const fact of [...longLaunches, ...dopplerLaunches, ...pools]) {
    if (fact?.evidence) envelopes.set(fact.evidence.evidenceId, fact.evidence)
  }
  const timeline = []
  const add = (claimType, label, status, evidenceIds) => {
    for (const evidenceId of evidenceIds || []) {
      const evidence = envelopes.get(evidenceId)
      timeline.push({
        claimType,
        label,
        status,
        evidenceId,
        observedAt: evidence?.observedAt || null,
        blockNumber: evidence?.blockNumber || null,
        blockHash: evidence?.blockHash || null,
        transactionHash: evidence?.transactionHash || null,
        producer: evidence?.producer || null,
      })
    }
  }
  for (const listing of listings) add('LISTING', 'PAIR catalog listing', 'OBSERVED', listing.evidenceIds)
  for (const launch of longLaunches) {
    add('PLATFORM_ROUTE', 'LONG route', AttributionStatus.CHAIN_ATTESTED, [launch.evidence?.evidenceId])
  }
  for (const launch of dopplerLaunches) {
    add('LAUNCH_PROTOCOL', 'Doppler', AttributionStatus.CHAIN_ATTESTED, [launch.evidence?.evidenceId])
  }
  for (const pool of pools) {
    add('LIQUIDITY_VENUE', 'Uniswap v4', AttributionStatus.CHAIN_ATTESTED, [pool.evidence?.evidenceId])
  }
  return timeline
    .filter((item) => item.evidenceId)
    .sort((left, right) => String(right.observedAt || '').localeCompare(String(left.observedAt || '')))
}

function currentItems(snapshot) {
  return new Map(
    (snapshot?.items || [])
      .filter((item) => safeAddress(item.tokenAddress || item.id))
      .map((item) => [(item.tokenAddress || item.id).toLowerCase(), item]),
  )
}

function sourceIndex(sourceCatalog) {
  const output = new Map()
  const ensure = (rawAddress) => {
    const address = safeAddress(rawAddress)
    if (!address || address.toLowerCase() === ZERO_ADDRESS) return null
    const key = address.toLowerCase()
    if (!output.has(key)) {
      output.set(key, { address, listings: [], longLaunches: [], dopplerLaunches: [], pools: [] })
    }
    return output.get(key)
  }
  for (const listing of sourceCatalog?.pairListings || []) ensure(listing.targetAddress)?.listings.push(listing)
  for (const launch of sourceCatalog?.longLaunches || []) ensure(launch.asset)?.longLaunches.push(launch)
  for (const launch of sourceCatalog?.dopplerLaunches || []) ensure(launch.asset)?.dopplerLaunches.push(launch)
  for (const pool of sourceCatalog?.pools || []) {
    ensure(pool.currency0)?.pools.push(pool)
    ensure(pool.currency1)?.pools.push(pool)
  }
  return output
}

function quoteAddresses(item, facts) {
  const target = facts.address.toLowerCase()
  const output = new Set()
  for (const pool of facts.pools) {
    const other = pool.currency0.toLowerCase() === target ? pool.currency1 : pool.currency0
    output.add(other.toLowerCase())
  }
  for (const pool of item?.pools || []) {
    if (pool.quoteAddress) output.add(pool.quoteAddress.toLowerCase())
  }
  for (const launch of facts.longLaunches) if (launch.numeraire) output.add(launch.numeraire.toLowerCase())
  for (const launch of facts.dopplerLaunches) if (launch.numeraire) output.add(launch.numeraire.toLowerCase())
  return [...output]
}

export function projectDashboardOpportunities({ snapshot, sourceCatalog }) {
  const metadata = metadataIndex(snapshot, sourceCatalog)
  const assetRegistry = canonicalAssetRegistry(sourceCatalog)
  const current = currentItems(snapshot)
  const sources = sourceIndex(sourceCatalog)
  for (const [address] of current) {
    if (!sources.has(address)) {
      sources.set(address, {
        address: safeAddress(address),
        listings: [],
        longLaunches: [],
        dopplerLaunches: [],
        pools: [],
      })
    }
  }

  const results = []
  for (const [key, facts] of sources) {
    const item = current.get(key) || null
    const sourceOnlyEligible =
      facts.longLaunches.length > 0 || facts.dopplerLaunches.length > 0 || facts.pools.length >= 2
    if (!item && !sourceOnlyEligible) continue
    const target = labelFor(facts.address, metadata)
    target.classification = classify(target.address, assetRegistry)
    const quotes = quoteAddresses(item, facts).map((address) => {
      const quote = labelFor(address, metadata)
      quote.classification = classify(quote.address, assetRegistry)
      return quote
    })
    const quoteClasses = [...new Set(quotes.map((quote) => quote.classification.value))]
    const quoteClass = quoteClasses.length === 0 ? 'UNKNOWN' : quoteClasses.length === 1 ? quoteClasses[0] : 'MIXED'
    const platformAttribution =
      facts.longLaunches.length > 0
        ? {
            platformId: PlatformId.LONG_ROUTE,
            status: AttributionStatus.CHAIN_ATTESTED,
            entryContract: facts.longLaunches[0].entryContract,
            evidenceIds: facts.longLaunches.map((launch) => launch.evidence?.evidenceId).filter(Boolean),
          }
        : {
            platformId: facts.pools.length > 0 ? PlatformId.UNATTRIBUTED_CHAIN : null,
            status: AttributionStatus.UNKNOWN,
            entryContract: null,
            evidenceIds: [],
          }
    const launchProtocol =
      facts.dopplerLaunches.length > 0
        ? {
            protocolId: ProtocolId.DOPPLER,
            status: AttributionStatus.CHAIN_ATTESTED,
            evidenceIds: facts.dopplerLaunches.map((launch) => launch.evidence?.evidenceId).filter(Boolean),
          }
        : { protocolId: ProtocolId.UNKNOWN, status: AttributionStatus.UNKNOWN, evidenceIds: [] }
    const venue = facts.pools.length > 0 || item?.pools?.length > 0 ? VenueId.UNISWAP_V4 : VenueId.UNKNOWN
    const state = quoteState(item)
    const currentNet = item?.screenedNetUsdg ?? null
    const sourceRouteQuotes = quotes.slice(0, 5).map((quote) => quote.symbol)
    const sourceRouteSuffix =
      quotes.length > sourceRouteQuotes.length ? ` +${quotes.length - sourceRouteQuotes.length}` : ''
    results.push({
      opportunityId: item?.id || `source:${key}`,
      target,
      quoteAssets: quotes,
      pairClass: `${target.classification.value}/${quoteClass}`,
      routeLabel:
        item?.route ||
        `${target.symbol} / ${sourceRouteQuotes.length > 0 ? sourceRouteQuotes.join(' · ') : 'UNKNOWN'}${sourceRouteSuffix}`,
      provenance: {
        discovery: [
          ...(facts.listings.length > 0 ? [{ adapterId: 'pair.catalog.v1', claim: 'PAIR_LISTING' }] : []),
          ...(facts.longLaunches.length > 0 ? [{ adapterId: 'long.launcher.v1', claim: 'LAUNCH_EVENT' }] : []),
          ...(facts.pools.length > 0 ? [{ adapterId: 'uniswap-v4.pool-manager.v1', claim: 'POOL_INITIALIZE' }] : []),
        ],
        listings: facts.listings,
        platformAttribution,
        launchFrontend: { value: null, status: AttributionStatus.UNKNOWN, evidenceIds: [] },
        launchProtocol,
        liquidityVenue: {
          venueId: venue,
          status: venue === VenueId.UNKNOWN ? AttributionStatus.UNKNOWN : AttributionStatus.CHAIN_ATTESTED,
          evidenceIds: facts.pools.map((pool) => pool.evidence?.evidenceId).filter(Boolean),
        },
      },
      axes: {
        attribution: platformAttribution.status,
        catalog: item ? 'ADMITTED_SHADOW' : 'DISCOVERED',
        quote: state,
        exactPreflight: 'NOT_RUN',
        execution: 'NONE',
        economics: state === 'FRESH_PROXY_POSITIVE' ? 'SCREENED_PROXY' : 'UNPROVEN',
      },
      quote: {
        state,
        blockNumber: item?.blockNumber || null,
        blockHash: item?.blockHash || null,
        quotedAt: item?.quotedAt || null,
        bestSizeUsdg: item?.amountInUsdg || null,
        grossProfitUsdg: item?.grossProfitUsdg || null,
        gasCostProxyUsdg: item?.gasCostProxyUsdg || null,
        screenedNetUsdg: currentNet,
        method: item?.evidenceLevel || null,
      },
      execution: {
        state: 'NONE',
        exactPreflight: 'NOT_RUN',
        transactionHash: null,
        receiptEvidence: item?.receiptEvidence || 'NONE',
        realizedNetUsdg: null,
      },
      pools: facts.pools,
      evidenceTimeline: evidenceTimeline({
        listings: facts.listings,
        longLaunches: facts.longLaunches,
        dopplerLaunches: facts.dopplerLaunches,
        pools: facts.pools,
        sourceEvidence: sourceCatalog?.evidence,
      }),
      rawBoardStatus: item?.status || BoardStatus.DISCOVERED,
      rank: item?.rank || null,
    })
  }
  return results.sort((left, right) => {
    const leftPositive = left.axes.quote === 'FRESH_PROXY_POSITIVE' ? 1 : 0
    const rightPositive = right.axes.quote === 'FRESH_PROXY_POSITIVE' ? 1 : 0
    if (leftPositive !== rightPositive) return rightPositive - leftPositive
    const leftNet = Number(left.quote.screenedNetUsdg ?? Number.NEGATIVE_INFINITY)
    const rightNet = Number(right.quote.screenedNetUsdg ?? Number.NEGATIVE_INFINITY)
    if (leftNet !== rightNet) return rightNet - leftNet
    return left.target.symbol.localeCompare(right.target.symbol)
  })
}

export function filterDashboardOpportunities(opportunities, filters = {}) {
  const query = String(filters.query || '')
    .trim()
    .toLowerCase()
  const minimumNet = filters.minimumNet === null || filters.minimumNet === undefined ? null : Number(filters.minimumNet)
  return opportunities.filter((item) => {
    if (filters.platform && item.provenance.platformAttribution.platformId !== filters.platform) return false
    if (filters.protocol && item.provenance.launchProtocol.protocolId !== filters.protocol) return false
    if (filters.pairClass && item.pairClass !== filters.pairClass) return false
    if (filters.quoteState && item.axes.quote !== filters.quoteState) return false
    if (filters.attribution && item.axes.attribution !== filters.attribution) return false
    if (Number.isFinite(minimumNet) && Number(item.quote.screenedNetUsdg ?? Number.NEGATIVE_INFINITY) < minimumNet) {
      return false
    }
    if (
      query &&
      ![
        item.target.symbol,
        item.target.name,
        item.target.address,
        item.routeLabel,
        ...item.quoteAssets.flatMap((asset) => [asset.symbol, asset.address]),
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query))
    ) {
      return false
    }
    return true
  })
}

export function summarizeDashboardOpportunity(item) {
  return {
    opportunityId: item.opportunityId,
    target: {
      address: item.target.address,
      symbol: item.target.symbol,
      name: item.target.name,
      classification: {
        value: item.target.classification.value,
        status: item.target.classification.status,
      },
    },
    quoteAssets: item.quoteAssets.slice(0, 8).map((asset) => ({
      address: asset.address,
      symbol: asset.symbol,
      name: asset.name,
      classification: {
        value: asset.classification.value,
        status: asset.classification.status,
      },
    })),
    quoteAssetCount: item.quoteAssets.length,
    pairClass: item.pairClass,
    routeLabel: item.routeLabel,
    provenance: {
      platformAttribution: {
        platformId: item.provenance.platformAttribution.platformId,
        status: item.provenance.platformAttribution.status,
      },
      launchFrontend: {
        value: item.provenance.launchFrontend.value,
        status: item.provenance.launchFrontend.status,
      },
      launchProtocol: {
        protocolId: item.provenance.launchProtocol.protocolId,
        status: item.provenance.launchProtocol.status,
      },
      liquidityVenue: {
        venueId: item.provenance.liquidityVenue.venueId,
        status: item.provenance.liquidityVenue.status,
      },
    },
    axes: item.axes,
    quote: {
      state: item.quote.state,
      quotedAt: item.quote.quotedAt,
      bestSizeUsdg: item.quote.bestSizeUsdg,
      screenedNetUsdg: item.quote.screenedNetUsdg,
      method: item.quote.method,
    },
    execution: {
      state: item.execution.state,
      receiptEvidence: item.execution.receiptEvidence,
    },
    rawBoardStatus: item.rawBoardStatus,
    rank: item.rank,
  }
}

export function buildDashboardModel({
  snapshot,
  sourceCatalog,
  episodes = [],
  executions = [],
  persistence = null,
  release = null,
  readModel = 'sqlite',
}) {
  const opportunities = projectDashboardOpportunities({ snapshot, sourceCatalog })
  const fresh = opportunities.filter((item) => ['FRESH_NO_EDGE', 'FRESH_PROXY_POSITIVE'].includes(item.axes.quote))
  const screenedPositive = opportunities.filter((item) => item.axes.quote === 'FRESH_PROXY_POSITIVE')
  const exactReady = opportunities.filter((item) => item.axes.exactPreflight === 'PASSED')
  const confirmed = executions.filter((item) => item.state === 'CONFIRMED')
  const realized = executions.filter((item) => item.economicsState === 'REALIZED_NET_VERIFIED')
  const realizedNetUsdg = realized.reduce((sum, item) => sum + Number(item.realizedNetUsdg || 0), 0)
  return {
    schemaVersion: 4,
    generatedAt: snapshot?.generatedAt || null,
    mode: 'READ_ONLY_NO_SIGNING_NO_BROADCAST',
    readModel,
    overview: {
      freshCandidates: fresh.length,
      screenedPositive: screenedPositive.length,
      exactReady: exactReady.length,
      confirmed: confirmed.length,
      realizedNetUsdg: realizedNetUsdg.toFixed(6),
      coverage: snapshot?.coverage || null,
      rpc: snapshot?.health?.eventDrivenShadow?.rpcTransport || null,
      signer: snapshot?.health?.signerLoaded === false ? 'NOT_LOADED' : 'UNKNOWN',
      serviceStatus: snapshot?.health?.status || 'STARTING',
    },
    opportunities,
    sources: Object.values(sourceCatalog?.adapters || {}),
    episodes,
    executions,
    system: {
      release,
      persistence,
      health: snapshot?.health || null,
      sourceSummary: sourceCatalog?.summary || null,
      sourceSafeHead: sourceCatalog?.safeHead || null,
      registryVersion: sourceCatalog?.registryVersion || null,
    },
  }
}

export function routeDashboardApi(pathname, searchParams, model) {
  if (!pathname.startsWith('/api/v1/')) return null
  if (!model) return { status: 503, payload: { status: 'READ_MODEL_NOT_READY' } }
  if (pathname === '/api/v1/overview') {
    return {
      status: 200,
      payload: {
        schemaVersion: model.schemaVersion,
        generatedAt: model.generatedAt,
        mode: model.mode,
        readModel: model.readModel,
        ...model.overview,
      },
    }
  }
  if (pathname === '/api/v1/opportunities') {
    const items = filterDashboardOpportunities(model.opportunities, {
      platform: searchParams.get('platform'),
      protocol: searchParams.get('protocol'),
      pairClass: searchParams.get('pairClass'),
      quoteState: searchParams.get('quoteState'),
      attribution: searchParams.get('attribution'),
      minimumNet: searchParams.has('minimumNet') ? searchParams.get('minimumNet') : null,
      query: searchParams.get('query'),
    })
    return {
      status: 200,
      payload: {
        schemaVersion: model.schemaVersion,
        generatedAt: model.generatedAt,
        count: items.length,
        view: 'SUMMARY',
        items: items.map((item) => summarizeDashboardOpportunity(item)),
      },
    }
  }
  if (pathname.startsWith('/api/v1/opportunities/')) {
    let opportunityId
    try {
      opportunityId = decodeURIComponent(pathname.slice('/api/v1/opportunities/'.length))
    } catch {
      return { status: 400, payload: { error: 'invalid opportunity id' } }
    }
    const item = model.opportunities.find((candidate) => candidate.opportunityId === opportunityId)
    return { status: item ? 200 : 404, payload: item || { error: 'opportunity not found' } }
  }
  if (pathname === '/api/v1/sources') {
    return {
      status: 200,
      payload: { schemaVersion: model.schemaVersion, generatedAt: model.generatedAt, items: model.sources },
    }
  }
  if (pathname === '/api/v1/episodes') {
    return { status: 200, payload: { generatedAt: model.generatedAt, items: model.episodes } }
  }
  if (pathname === '/api/v1/executions') {
    return { status: 200, payload: { generatedAt: model.generatedAt, items: model.executions } }
  }
  if (pathname === '/api/v1/system') return { status: 200, payload: model.system }
  return { status: 404, payload: { error: 'not found' } }
}
