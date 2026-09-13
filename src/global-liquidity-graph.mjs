import { getAddress, keccak256, toHex } from 'viem'

import { stableStringify } from './journal.mjs'

export const GLOBAL_GRAPH_POLICY = Object.freeze({
  version: 'ROBINHOOD_TYPED_MULTI_PROTOCOL_GRAPH_V1',
  maximumAssets: 512,
  maximumSwapEdges: 20_000,
  maximumCycleHops: 5,
  maximumPathHops: 3,
  maximumCycles: 20_000,
  venues: ['EARN', 'UNISWAP_V2', 'UNISWAP_V3', 'UNISWAP_V4'],
  funding: ['EXECUTOR_INVENTORY', 'MORPHO_ZERO_FEE_FLASH'],
})
export const GLOBAL_MAX_MANAGED_CANDIDATES_PER_WAKE = 16

function key(value) {
  return String(value).toLowerCase()
}

function address(value, label) {
  try {
    return getAddress(value)
  } catch {
    throw new Error(`${label} has an invalid address`)
  }
}

function finiteInteger(value, label, minimum = 0) {
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < minimum) throw new Error(`${label} is invalid`)
  return number
}

function edgeId(edge) {
  return keccak256(
    toHex(
      stableStringify({
        venue: edge.venue,
        pool: key(edge.pool),
        poolId: edge.poolId || null,
        tokenIn: key(edge.tokenIn),
        tokenOut: key(edge.tokenOut),
        fee: edge.fee ?? null,
        tickSpacing: edge.tickSpacing ?? null,
        hooks: edge.hooks ? key(edge.hooks) : null,
      }),
    ),
  )
}

function normalizeToken(source, fallbackSymbol = null) {
  const tokenAddress = address(typeof source === 'string' ? source : source.address, 'token')
  const symbol = String(
    typeof source === 'string' ? fallbackSymbol || '' : source.symbol || fallbackSymbol || '',
  ).trim()
  return {
    address: tokenAddress,
    symbol: symbol && /^[\p{L}\p{N} ._&/+()-]{1,48}$/u.test(symbol) ? symbol : null,
    decimals:
      typeof source === 'string' || source.decimals === undefined
        ? null
        : finiteInteger(source.decimals, 'token decimals'),
  }
}

function addAsset(assets, token) {
  const normalized = normalizeToken(token)
  const existing = assets.get(key(normalized.address))
  if (!existing) assets.set(key(normalized.address), normalized)
  else {
    if (existing.symbol === null && normalized.symbol !== null) existing.symbol = normalized.symbol
    if (existing.decimals === null && normalized.decimals !== null) existing.decimals = normalized.decimals
  }
  return normalized.address
}

function addSwapEdge(edges, adjacency, edge) {
  const normalized = { ...edge, id: edgeId(edge), executable: edge.executable !== false }
  if (edges.some((item) => item.id === normalized.id)) return
  edges.push(normalized)
  const adjacent = adjacency.get(key(normalized.tokenIn)) || []
  adjacent.push(normalized)
  adjacency.set(key(normalized.tokenIn), adjacent)
}

/**
 * Build one canonical asset graph from independently verified source records.
 * This function never infers pool existence; loaders must supply current
 * factory/event state and explicitly mark unsupported records.
 */
export function buildUnifiedLiquidityGraph(input) {
  const assets = new Map()
  const edges = []
  const adjacency = new Map()
  const hyperedges = []
  const rejected = []

  const reject = (venue, source, error) => {
    rejected.push({
      venue,
      pool: /^0x[0-9a-f]{40}$/i.test(String(source?.address || source?.pool || ''))
        ? getAddress(source.address || source.pool)
        : null,
      reason: error instanceof Error ? error.message : String(error),
    })
  }

  for (const source of input?.earnPools || []) {
    try {
      const pool = address(source.address, 'Earn pool')
      if (source.initialized !== true || source.paused === true || source.recoveryMode === true) {
        throw new Error('Earn pool is not executable')
      }
      if (!Array.isArray(source.tokens) || source.tokens.length < 2 || source.tokens.length > 8) {
        throw new Error('Earn pool token count is outside 2..8')
      }
      const tokens = source.tokens.map((token) => addAsset(assets, token))
      addAsset(assets, { address: pool, symbol: source.symbol || source.name || null, decimals: 18 })
      for (const tokenIn of tokens) {
        for (const tokenOut of tokens) {
          if (tokenIn === tokenOut) continue
          addSwapEdge(edges, adjacency, {
            venue: 'EARN',
            pool,
            tokenIn,
            tokenOut,
            fee: null,
            source: source.source || 'CANONICAL_EARN_VAULT',
          })
        }
      }
      hyperedges.push({
        id: `EARN_REMOVE_${key(pool)}`,
        kind: 'EARN_REMOVE_PROPORTIONAL',
        venue: 'EARN',
        pool,
        inputs: [pool],
        outputs: tokens,
        executable: true,
      })
      hyperedges.push({
        id: `EARN_ADD_${key(pool)}`,
        kind: 'EARN_ADD_UNBALANCED',
        venue: 'EARN',
        pool,
        inputs: tokens,
        outputs: [pool],
        executable: true,
      })
    } catch (error) {
      reject('EARN', source, error)
    }
  }

  const addPairVenue = (venue, sources) => {
    for (const source of sources || []) {
      try {
        if (source.executable === false) throw new Error(source.reason || 'source is execution-unsupported')
        const pool = address(source.address || source.pool, `${venue} pool`)
        const token0 = addAsset(assets, source.token0)
        const token1 = addAsset(assets, source.token1)
        if (token0 === token1) throw new Error('pool repeats a token')
        const common = {
          venue,
          pool,
          fee: venue === 'UNISWAP_V3' ? finiteInteger(source.fee, 'V3 fee', 1) : null,
          tickSpacing: venue === 'UNISWAP_V4' ? finiteInteger(source.tickSpacing, 'V4 tick spacing', 1) : null,
          hooks: venue === 'UNISWAP_V4' ? address(source.hooks, 'V4 hook') : null,
          poolId: venue === 'UNISWAP_V4' ? String(source.poolId || '') : null,
          source: source.source || `CANONICAL_${venue}_FACTORY`,
        }
        if (venue === 'UNISWAP_V4') {
          common.fee = finiteInteger(source.fee, 'V4 fee')
          if (!/^0x[0-9a-f]{64}$/i.test(common.poolId)) throw new Error('V4 pool id is invalid')
        }
        addSwapEdge(edges, adjacency, { ...common, tokenIn: token0, tokenOut: token1 })
        addSwapEdge(edges, adjacency, { ...common, tokenIn: token1, tokenOut: token0 })
      } catch (error) {
        reject(venue, source, error)
      }
    }
  }
  addPairVenue('UNISWAP_V2', input?.v2Pools)
  addPairVenue('UNISWAP_V3', input?.v3Pools)
  addPairVenue('UNISWAP_V4', input?.v4Pools)

  if (assets.size > GLOBAL_GRAPH_POLICY.maximumAssets) throw new Error('global graph asset bound exceeded')
  if (edges.length > GLOBAL_GRAPH_POLICY.maximumSwapEdges) throw new Error('global graph edge bound exceeded')
  for (const adjacent of adjacency.values()) adjacent.sort((left, right) => left.id.localeCompare(right.id))
  hyperedges.sort((left, right) => left.id.localeCompare(right.id))
  edges.sort((left, right) => left.id.localeCompare(right.id))
  return {
    policy: GLOBAL_GRAPH_POLICY,
    assets,
    edges,
    adjacency,
    hyperedges,
    rejected,
    commitment: keccak256(
      toHex(
        stableStringify({
          policy: GLOBAL_GRAPH_POLICY,
          assets: [...assets.values()].sort((left, right) => left.address.localeCompare(right.address)),
          edges,
          hyperedges,
        }),
      ),
    ),
  }
}

export function fundingCapability({ token, inventoryWei = 0n, morphoLiquidityWei = 0n }) {
  const settlementToken = address(token, 'settlement token')
  if (typeof inventoryWei !== 'bigint' || typeof morphoLiquidityWei !== 'bigint') {
    throw new Error('funding balances must be bigint')
  }
  if (inventoryWei < 0n || morphoLiquidityWei < 0n) throw new Error('funding balances must be non-negative')
  return {
    token: settlementToken,
    inventoryWei,
    morphoLiquidityWei,
    modes: [
      ...(inventoryWei > 0n ? ['EXECUTOR_INVENTORY'] : []),
      ...(morphoLiquidityWei > 0n ? ['MORPHO_ZERO_FEE_FLASH'] : []),
    ],
    executable: inventoryWei > 0n || morphoLiquidityWei > 0n,
  }
}

/**
 * Buy managed-RPC execution truth for at most one best gross amount per route.
 * Raw units are compared only inside the same settlement asset; round-robin
 * then prevents USDG, WETH or one optional asset from consuming every slot.
 */
export function selectBoundedManagedCandidates(candidates, maximum = GLOBAL_MAX_MANAGED_CANDIDATES_PER_WAKE) {
  if (!Array.isArray(candidates) || !Number.isSafeInteger(maximum) || maximum <= 0 || maximum > 64) {
    throw new Error('managed candidate selection is outside bounds')
  }
  const bestByRoute = new Map()
  for (const candidate of candidates) {
    const settlement = address(candidate.settlementToken, 'managed candidate settlement')
    const templateId = String(candidate.templateId || '')
    const quoteDelta = BigInt(candidate.quoteDelta)
    if (!templateId || quoteDelta <= 0n) continue
    const routeKey = `${key(settlement)}:${templateId}`
    const prior = bestByRoute.get(routeKey)
    const preferInventoryAtEqualGross =
      quoteDelta === BigInt(prior?.quoteDelta || 0) &&
      candidate.fundingMode === 'EXECUTOR_INVENTORY' &&
      prior?.fundingMode !== 'EXECUTOR_INVENTORY'
    if (!prior || quoteDelta > BigInt(prior.quoteDelta) || preferInventoryAtEqualGross) {
      bestByRoute.set(routeKey, candidate)
    }
  }
  const groups = new Map()
  for (const candidate of bestByRoute.values()) {
    const settlement = key(candidate.settlementToken)
    const group = groups.get(settlement) || []
    group.push(candidate)
    groups.set(settlement, group)
  }
  for (const group of groups.values()) {
    group.sort(
      (left, right) =>
        (left.quoteDelta === right.quoteDelta ? 0 : left.quoteDelta > right.quoteDelta ? -1 : 1) ||
        (left.plan?.actions?.length || 0) - (right.plan?.actions?.length || 0) ||
        String(left.templateId).localeCompare(String(right.templateId)),
    )
  }
  const result = []
  const settlements = [...groups.keys()].sort()
  for (let index = 0; result.length < maximum; ++index) {
    let added = false
    for (const settlement of settlements) {
      const candidate = groups.get(settlement)?.[index]
      if (!candidate) continue
      result.push(candidate)
      added = true
      if (result.length === maximum) break
    }
    if (!added) break
  }
  return result
}

export function enumerateCrossVenueCycles(graph, settlementToken, options = {}) {
  const settlement = address(settlementToken, 'settlement token')
  const maximumHops = finiteInteger(
    options.maximumHops ?? GLOBAL_GRAPH_POLICY.maximumCycleHops,
    'maximum cycle hops',
    2,
  )
  const maximumCycles = finiteInteger(options.maximumCycles ?? GLOBAL_GRAPH_POLICY.maximumCycles, 'maximum cycles', 1)
  if (maximumHops > GLOBAL_GRAPH_POLICY.maximumCycleHops) throw new Error('cycle hop bound exceeded')
  const cycles = []
  const walk = (current, path, usedPools, usedTokens) => {
    if (path.length >= maximumHops) return
    for (const edge of graph.adjacency.get(key(current)) || []) {
      const edgePoolIdentity = `${edge.venue}:${edge.poolId || key(edge.pool)}`
      if (!edge.executable || usedPools.has(edgePoolIdentity)) continue
      const nextPath = [...path, edge]
      if (key(edge.tokenOut) === key(settlement)) {
        if (nextPath.length >= 2 && new Set(nextPath.map((item) => item.venue)).size >= 2) {
          cycles.push({
            id: `GLOBAL_CYCLE_${keccak256(toHex(stableStringify(nextPath.map((item) => item.id)))).slice(2, 18)}`,
            settlementToken: settlement,
            edges: nextPath,
          })
          if (cycles.length > maximumCycles) throw new Error('global cycle enumeration bound exceeded')
        }
        continue
      }
      if (usedTokens.has(key(edge.tokenOut))) continue
      walk(
        edge.tokenOut,
        nextPath,
        new Set([...usedPools, edgePoolIdentity]),
        new Set([...usedTokens, key(edge.tokenOut)]),
      )
    }
  }
  walk(settlement, [], new Set(), new Set([key(settlement)]))
  return cycles.sort((left, right) => left.id.localeCompare(right.id))
}

export function shortestSwapPaths(graph, tokenIn, tokenOut, options = {}) {
  const start = address(tokenIn, 'path input token')
  const target = address(tokenOut, 'path output token')
  if (key(start) === key(target)) return [[]]
  const maximumHops = finiteInteger(options.maximumHops ?? GLOBAL_GRAPH_POLICY.maximumPathHops, 'maximum path hops', 1)
  const excludedVenue = options.excludedVenue || null
  const excludedPool = options.excludedPool ? key(options.excludedPool) : null
  const queue = [{ token: start, edges: [], used: new Set([key(start)]) }]
  const results = []
  let shortest = null
  while (queue.length > 0) {
    const current = queue.shift()
    if (shortest !== null && current.edges.length >= shortest) continue
    for (const edge of graph.adjacency.get(key(current.token)) || []) {
      if (
        !edge.executable ||
        edge.venue === excludedVenue ||
        key(edge.pool) === excludedPool ||
        String(edge.poolId || '').toLowerCase() === excludedPool
      )
        continue
      if (current.used.has(key(edge.tokenOut)) && key(edge.tokenOut) !== key(target)) continue
      const next = [...current.edges, edge]
      if (key(edge.tokenOut) === key(target)) {
        shortest = next.length
        results.push(next)
        continue
      }
      if (next.length < maximumHops) {
        queue.push({ token: edge.tokenOut, edges: next, used: new Set([...current.used, key(edge.tokenOut)]) })
      }
    }
  }
  return results.sort((left, right) => stableStringify(left).localeCompare(stableStringify(right)))
}

/**
 * Derive generic BPT discount/premium templates for every executable Earn pool.
 * No token symbol or named pool is privileged; a template exists only when
 * every leg is connected to the chosen settlement asset outside that Earn pool.
 */
export function buildEarnBptArbitrageTemplates(graph, settlementToken, options = {}) {
  const settlement = address(settlementToken, 'settlement token')
  const maximumPathHops = options.maximumPathHops ?? GLOBAL_GRAPH_POLICY.maximumPathHops
  const templates = []
  const removes = graph.hyperedges.filter((item) => item.kind === 'EARN_REMOVE_PROPORTIONAL')
  for (const remove of removes) {
    const buyBpt = shortestSwapPaths(graph, settlement, remove.pool, {
      maximumHops: maximumPathHops,
      excludedVenue: 'EARN',
      excludedPool: remove.pool,
    })[0]
    const sellComponents = remove.outputs.map(
      (token) =>
        shortestSwapPaths(graph, token, settlement, {
          maximumHops: maximumPathHops,
          excludedVenue: 'EARN',
          excludedPool: remove.pool,
        })[0] || null,
    )
    if (buyBpt && sellComponents.every(Boolean)) {
      templates.push({
        id: `BPT_DISCOUNT_${key(remove.pool)}`,
        kind: 'BPT_DISCOUNT_REMOVE_AND_SELL',
        settlementToken: settlement,
        pool: remove.pool,
        buyBpt,
        remove,
        sellComponents,
      })
    }

    const buyComponents = remove.outputs.map(
      (token) =>
        shortestSwapPaths(graph, settlement, token, {
          maximumHops: maximumPathHops,
          excludedVenue: 'EARN',
          excludedPool: remove.pool,
        })[0] || null,
    )
    const sellBpt = shortestSwapPaths(graph, remove.pool, settlement, {
      maximumHops: maximumPathHops,
      excludedVenue: 'EARN',
      excludedPool: remove.pool,
    })[0]
    const add = graph.hyperedges.find(
      (item) => item.kind === 'EARN_ADD_UNBALANCED' && key(item.pool) === key(remove.pool),
    )
    if (add && sellBpt && buyComponents.every(Boolean)) {
      templates.push({
        id: `BPT_PREMIUM_${key(remove.pool)}`,
        kind: 'BPT_PREMIUM_BUY_AND_ADD',
        settlementToken: settlement,
        pool: remove.pool,
        buyComponents,
        add,
        sellBpt,
      })
    }
  }
  return templates.sort((left, right) => left.id.localeCompare(right.id))
}
