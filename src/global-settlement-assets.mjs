import { getAddress } from 'viem'

export const GLOBAL_SETTLEMENT_ADMISSION_POLICY =
  'RULES_BASED_GRAPH_CYCLE_WITH_ROTATING_FUNDING_AND_GRAPH_VERIFIED_USDG_NORMALIZATION_V2'
export const GLOBAL_MAX_SETTLEMENT_FUNDING_CHECKS_PER_WAKE = 64
export const GLOBAL_MAX_SETTLEMENT_ASSETS_PER_WAKE = 16

function key(value) {
  return String(value).toLowerCase()
}

/**
 * Seeds are always checked first, but do not form an allowlist. Other graph
 * assets may be admitted later by the same structural, funding and executable
 * valuation rules.
 */
export function globalSettlementSeeds(defaults, extraCsv = '') {
  const values = [...(defaults || []), ...String(extraCsv || '').split(',')]
  const unique = new Map()
  for (const raw of values) {
    const value = String(raw).trim()
    if (!value) continue
    const address = getAddress(value)
    unique.set(address.toLowerCase(), address)
  }
  if (unique.size < 2 || unique.size > 16) throw new Error('global settlement seed set must contain 2..16 assets')
  return [...unique.values()]
}

// Retain the old export for callers outside this repository while making the
// policy semantics explicit in all live code.
export const globalSettlementAssets = globalSettlementSeeds

/**
 * Search roots are a topology concern, not a custody decision. Keep the
 * configured settlement seeds visible even when the universal executor has no
 * current inventory or flash liquidity; funded dynamic assets are added under
 * the existing admission bound.
 */
export function selectSettlementSearchRoots(graph, { seeds = [], admitted = [] } = {}) {
  if (!(graph?.assets instanceof Map)) throw new Error('settlement search roots require a unified graph')
  const roots = new Map()
  for (const value of seeds) {
    const token = getAddress(value)
    if (graph.assets.has(key(token))) roots.set(key(token), token)
  }
  for (const profile of admitted) {
    const token = getAddress(profile?.token)
    if (!graph.assets.has(key(token))) throw new Error('funded settlement asset is absent from the graph')
    roots.set(key(token), token)
  }
  return [...roots.values()]
}

export function classifyGlobalSearchReadiness(input) {
  const searchableRouteCount = Number(input?.searchableRouteCount)
  const fundedCount = Number(input?.fundedCount)
  const evaluationValid = Number(input?.evaluationValid)
  if (![searchableRouteCount, fundedCount, evaluationValid].every(Number.isSafeInteger)) {
    throw new Error('global search readiness counts are invalid')
  }
  const selected = input?.selected === true
  const evaluationCoverage = String(input?.evaluationCoverage || '')
  const fundingBlocked =
    !selected && searchableRouteCount > 0 && fundedCount === 0 && input?.fundingEvidenceComplete === true
  const evaluationIncomplete =
    !selected &&
    !fundingBlocked &&
    evaluationValid === 0 &&
    ['EMPTY', 'UNAVAILABLE', 'PARTIAL'].includes(evaluationCoverage)
  return {
    status: selected
      ? 'EXACT_NET_POSITIVE'
      : fundingBlocked
        ? 'NO_EXECUTABLE_FUNDING'
        : evaluationIncomplete
          ? 'EVALUATION_INCOMPLETE_NO_SIGNATURE'
          : 'NO_EXACT_NET_OPPORTUNITY',
    evidenceCoverage: fundingBlocked || evaluationIncomplete ? 'PARTIAL' : evaluationCoverage,
    fundingBlocked,
    evaluationIncomplete,
  }
}

export function assessSettlementFunding(candidate, evidence) {
  const decimals = Number(evidence?.decimals)
  if (!Number.isSafeInteger(decimals) || decimals < 0 || decimals > 36) {
    throw new Error('token decimals are outside 0..36')
  }
  if (candidate.catalogDecimals !== null && candidate.catalogDecimals !== decimals) {
    throw new Error('catalog and onchain decimals disagree')
  }
  const morphoLiquidity = BigInt(evidence?.morphoLiquidity ?? 0)
  const inventory = BigInt(evidence?.inventory ?? 0)
  if (morphoLiquidity < 0n || inventory < 0n) throw new Error('funding balances must be non-negative')
  const fundingModes = [
    ...(morphoLiquidity > 0n ? ['MORPHO_FLASH'] : []),
    ...(inventory > 0n ? ['EXECUTOR_INVENTORY'] : []),
  ]
  if (fundingModes.length === 0) throw new Error('no Morpho liquidity or protected executor inventory')
  return {
    ...candidate,
    decimals,
    morphoLiquidity,
    inventory,
    fundingModes,
    fundingEvidence: 'FIXED_BLOCK_MORPHO_AND_EXECUTOR_BALANCES',
  }
}

export function selectSettlementFundingCandidates(ranked, options = {}) {
  if (!Array.isArray(ranked?.candidates) || !Number.isSafeInteger(Number(ranked?.structurallyEligible))) {
    throw new Error('ranked settlement candidates are invalid')
  }
  const eventWake = options.eventWake === true
  const candidates = eventWake
    ? ranked.candidates.filter((candidate) => candidate.seeded || candidate.eventTouched)
    : [...ranked.candidates]
  return {
    candidates,
    admissionScope: eventWake ? 'SEEDS_AND_EVENT_TOUCHED' : 'ROTATING_GRAPH_RECOVERY',
    deferred: eventWake
      ? Math.max(0, Number(ranked.structurallyEligible) - candidates.length)
      : Number(ranked.deferred || 0),
  }
}

/**
 * Return only valuation routes that are already present as executable V3
 * edges in the fixed-block unified graph. This removes speculative fee-tier
 * probing from the latency-critical admission path.
 */
export function enumerateV3ValuationRoutes(graph, tokenIn, tokenOut, bridgeToken) {
  if (!Array.isArray(graph?.edges)) throw new Error('V3 valuation requires a unified graph')
  const input = getAddress(tokenIn)
  const output = getAddress(tokenOut)
  const bridge = getAddress(bridgeToken)
  if (key(input) === key(output)) return []
  const matching = (from, to) =>
    graph.edges
      .filter(
        (edge) =>
          edge.venue === 'UNISWAP_V3' &&
          edge.executable !== false &&
          key(edge.tokenIn) === key(from) &&
          key(edge.tokenOut) === key(to),
      )
      .sort((left, right) => Number(left.fee) - Number(right.fee) || key(left.pool).localeCompare(key(right.pool)))
  const routes = matching(input, output).map((edge) => ({
    tokens: [input, output],
    fees: [Number(edge.fee)],
    pools: [getAddress(edge.pool)],
  }))
  if (key(input) !== key(bridge) && key(output) !== key(bridge)) {
    for (const first of matching(input, bridge)) {
      for (const second of matching(bridge, output)) {
        routes.push({
          tokens: [input, bridge, output],
          fees: [Number(first.fee), Number(second.fee)],
          pools: [getAddress(first.pool), getAddress(second.pool)],
        })
      }
    }
  }
  const unique = new Map()
  for (const route of routes) {
    const identity = route.tokens.map((token, index) => `${key(token)}:${route.fees[index] ?? ''}`).join('>')
    if (!unique.has(identity)) unique.set(identity, route)
  }
  return [...unique.values()]
}

/**
 * Produce a bounded, deterministic funding-check workset from the complete
 * graph. Seeds are policy anchors, not the complete settlement allowlist.
 * Event-touched assets and the endpoints of touched pools move to the front;
 * the remaining graph is ranked by independent pool connectivity.
 */
export function rankDynamicSettlementCandidates(graph, options = {}) {
  if (!(graph?.assets instanceof Map) || !Array.isArray(graph?.edges)) {
    throw new Error('dynamic settlement admission requires a unified graph')
  }
  const maximum = Number(options.maximum ?? GLOBAL_MAX_SETTLEMENT_FUNDING_CHECKS_PER_WAKE)
  if (!Number.isSafeInteger(maximum) || maximum < 2 || maximum > GLOBAL_MAX_SETTLEMENT_FUNDING_CHECKS_PER_WAKE) {
    throw new Error('dynamic settlement funding-check bound is invalid')
  }
  const seeds = new Map(
    (options.seeds || []).map((value) => {
      const normalized = getAddress(value)
      return [key(normalized), normalized]
    }),
  )
  let rotationOffset
  try {
    rotationOffset = BigInt(options.rotationOffset ?? 0)
  } catch {
    throw new Error('dynamic settlement rotation offset is invalid')
  }
  if (rotationOffset < 0n) throw new Error('dynamic settlement rotation offset is invalid')
  const wakeAddresses = new Set(
    (options.wakeAddresses || [])
      .map((value) => {
        try {
          return key(getAddress(value))
        } catch {
          return null
        }
      })
      .filter(Boolean),
  )
  const stats = new Map()
  for (const [assetKey, asset] of graph.assets.entries()) {
    stats.set(assetKey, {
      token: getAddress(asset.address),
      symbol: asset.symbol || null,
      catalogDecimals: Number.isSafeInteger(asset.decimals) ? asset.decimals : null,
      directedEdges: 0,
      pools: new Set(),
      seeded: seeds.has(assetKey),
      eventTouched: wakeAddresses.has(assetKey),
    })
  }
  for (const edge of graph.edges) {
    const poolIdentity = `${edge.venue}:${String(edge.poolId || edge.pool).toLowerCase()}`
    const poolTouched = wakeAddresses.has(key(edge.pool)) || wakeAddresses.has(String(edge.poolId || '').toLowerCase())
    for (const token of [edge.tokenIn, edge.tokenOut]) {
      const item = stats.get(key(token))
      if (!item) continue
      item.pools.add(poolIdentity)
      if (key(token) === key(edge.tokenIn)) item.directedEdges += 1
      if (poolTouched) item.eventTouched = true
    }
  }
  for (const [seedKey, token] of seeds) {
    if (!stats.has(seedKey)) {
      stats.set(seedKey, {
        token,
        symbol: null,
        catalogDecimals: null,
        directedEdges: 0,
        pools: new Set(),
        seeded: true,
        eventTouched: wakeAddresses.has(seedKey),
      })
    }
  }
  const structurallyEligible = [...stats.values()]
    .filter((item) => item.seeded || (item.directedEdges >= 2 && item.pools.size >= 2))
    .map((item) => ({
      token: item.token,
      symbol: item.symbol,
      catalogDecimals: item.catalogDecimals,
      directedEdges: item.directedEdges,
      distinctPools: item.pools.size,
      seeded: item.seeded,
      eventTouched: item.eventTouched,
    }))
  const rank = (left, right) =>
    right.distinctPools - left.distinctPools ||
    right.directedEdges - left.directedEdges ||
    key(left.token).localeCompare(key(right.token))
  const fixed = structurallyEligible
    .filter((item) => item.seeded || item.eventTouched)
    .sort((left, right) => {
      return (
        Number(right.seeded) - Number(left.seeded) ||
        Number(right.eventTouched) - Number(left.eventTouched) ||
        rank(left, right)
      )
    })
  const rotating = structurallyEligible.filter((item) => !item.seeded && !item.eventTouched).sort(rank)
  const rotation = rotating.length === 0 ? 0 : Number(rotationOffset % BigInt(rotating.length))
  const ordered = [...fixed, ...rotating.slice(rotation), ...rotating.slice(0, rotation)]
  return {
    policy: GLOBAL_SETTLEMENT_ADMISSION_POLICY,
    graphAssets: graph.assets.size,
    structurallyEligible: structurallyEligible.length,
    candidates: ordered.slice(0, maximum),
    deferred: Math.max(0, structurallyEligible.length - maximum),
    maximumFundingChecks: maximum,
    rotationOffset: rotation,
  }
}
