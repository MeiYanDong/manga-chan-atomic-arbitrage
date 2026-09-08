const ADDRESS_PATTERN = /^0x[0-9a-f]{40}$/i
const HEX_PATTERN = /^0x(?:[0-9a-f]{2})+$/i

/** @param {string} tokenIn @param {string} tokenOut @param {string} bridgeToken */
export function v3DirectionKey(tokenIn, tokenOut, bridgeToken) {
  return `${tokenIn.toLowerCase()}:${tokenOut.toLowerCase()}:${bridgeToken.toLowerCase()}`
}

/**
 * Pick a deterministic, bounded first-look set before any route has successful
 * quote evidence. Lower aggregate fee is only a discovery heuristic; every
 * selected path still goes through the canonical Quoter and later periodic
 * work can run the complete topology search.
 *
 * @param {Record<string, any>[]} routes
 * @param {number} limit
 */
export function selectV3BootstrapRoutes(routes, limit) {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('V3 bootstrap limit must be a positive integer')
  const unique = new Map()
  for (const route of routes) {
    const normalized = normalizeRoute(route)
    if (normalized) unique.set(normalized.path.toLowerCase(), normalized)
  }
  return [...unique.values()]
    .sort((left, right) => {
      const leftFee = left.fees.reduce((sum, fee) => sum + fee, 0)
      const rightFee = right.fees.reduce((sum, fee) => sum + fee, 0)
      return leftFee - rightFee || left.fees.length - right.fees.length || left.path.localeCompare(right.path)
    })
    .slice(0, limit)
}

/**
 * Re-quote only the strongest previously proven topology in an event wake.
 * The caller still obtains fresh current-block quotes; this helper only bounds
 * structural route selection and never expands into discovery.
 *
 * @param {Record<string, any>[]} routes
 * @param {number} limit
 */
export function selectEventV3Routes(routes, limit) {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('event V3 route limit must be a positive integer')
  return routes.slice(0, limit)
}

/** @param {Record<string, any>} route */
function normalizeRoute(route) {
  const tokens = Array.isArray(route?.tokens) ? route.tokens : []
  const fees = Array.isArray(route?.fees) ? route.fees : []
  const poolAddresses = Array.isArray(route?.poolAddresses) ? route.poolAddresses : []
  if (
    tokens.length !== fees.length + 1 ||
    fees.length < 1 ||
    poolAddresses.length !== fees.length ||
    !tokens.every((value) => typeof value === 'string' && ADDRESS_PATTERN.test(value)) ||
    !poolAddresses.every((value) => typeof value === 'string' && ADDRESS_PATTERN.test(value)) ||
    !fees.every((value) => Number.isSafeInteger(value) && value > 0) ||
    typeof route.path !== 'string' ||
    !HEX_PATTERN.test(route.path)
  ) {
    return null
  }
  const canonicalPath = tokens
    .slice(1)
    .reduce(
      (path, token, index) => `${path}${fees[index].toString(16).padStart(6, '0')}${token.slice(2).toLowerCase()}`,
      tokens[0].toLowerCase(),
    )
  if (route.path.toLowerCase() !== canonicalPath) return null
  return {
    tokens: [...tokens],
    fees: [...fees],
    poolAddresses: [...poolAddresses],
    path: route.path,
  }
}

export class V3ShortlistCache {
  /** @param {{maxRoutes: number, refreshMs: number}} options */
  constructor(options) {
    if (!Number.isSafeInteger(options.maxRoutes) || options.maxRoutes < 1) {
      throw new Error('V3 shortlist maxRoutes must be a positive integer')
    }
    if (!Number.isSafeInteger(options.refreshMs) || options.refreshMs < 1) {
      throw new Error('V3 shortlist refreshMs must be a positive integer')
    }
    this.maxRoutes = options.maxRoutes
    this.refreshMs = options.refreshMs
    this.entries = new Map()
  }

  get size() {
    return this.entries.size
  }

  /** @param {string} key @param {number} [nowMs] */
  get(key, nowMs = Date.now()) {
    const entry = this.entries.get(key)
    if (!entry) return null
    return {
      routes: entry.routes.map((route) => ({
        ...route,
        tokens: [...route.tokens],
        fees: [...route.fees],
        poolAddresses: [...route.poolAddresses],
      })),
      refreshedAtMs: entry.refreshedAtMs,
      stale: entry.refreshedAtMs === 0 || nowMs - entry.refreshedAtMs >= this.refreshMs,
    }
  }

  /** @param {string} key @param {Record<string, any>[]} routes @param {number} [refreshedAtMs] */
  set(key, routes, refreshedAtMs = Date.now()) {
    if (!Number.isSafeInteger(refreshedAtMs) || refreshedAtMs < 0) throw new Error('invalid shortlist refresh time')
    const normalized = []
    const seen = new Set()
    for (const route of routes) {
      const value = normalizeRoute(route)
      if (!value) continue
      const identity = value.path.toLowerCase()
      if (seen.has(identity)) continue
      seen.add(identity)
      normalized.push(value)
      if (normalized.length >= this.maxRoutes) break
    }
    if (normalized.length === 0) {
      this.entries.delete(key)
      return false
    }
    this.entries.set(key, { routes: normalized, refreshedAtMs })
    return true
  }

  /** @param {string} key @param {Record<string, any>[]} routes */
  seed(key, routes) {
    const existing = this.entries.get(key)?.routes || []
    return this.set(key, [...existing, ...routes], 0)
  }

  /** @param {string} key */
  delete(key) {
    return this.entries.delete(key)
  }

  /** @param {string} poolAddress */
  invalidateByPool(poolAddress) {
    const normalized = poolAddress.toLowerCase()
    let invalidated = 0
    for (const entry of this.entries.values()) {
      if (!entry.routes.some((route) => route.poolAddresses.some((address) => address.toLowerCase() === normalized))) {
        continue
      }
      if (entry.refreshedAtMs !== 0) invalidated += 1
      entry.refreshedAtMs = 0
    }
    return invalidated
  }
}

/** @param {Record<string, any>} quote @param {'entry' | 'exit'} leg */
function routeFromQuote(quote, leg) {
  const prefix = leg === 'entry' ? 'entryV3' : 'exitV3'
  return normalizeRoute({
    tokens: quote?.[`${prefix}Tokens`],
    fees: quote?.[`${prefix}Fees`] || quote?.legs?.[`${prefix}Fees`],
    poolAddresses: quote?.[`${prefix}Pools`] || quote?.legs?.[`${prefix}Pools`],
    path: quote?.[`${prefix}Path`],
  })
}

/**
 * Seed structural route candidates from prior fixed-block observations. They
 * start stale, so periodic work refreshes them gradually; event cycles can use
 * them immediately for current-block quotes instead of rediscovering every fee
 * combination after each restart.
 *
 * @param {V3ShortlistCache} cache
 * @param {Map<string, Record<string, any>>} observations
 * @param {{USDG: string, WETH: string}} baseTokens
 */
export function seedV3ShortlistsFromObservations(cache, observations, baseTokens) {
  const ordered = [...observations.values()].sort(
    (left, right) => Date.parse(right?.quotedAt || '') - Date.parse(left?.quotedAt || ''),
  )
  let seededRoutes = 0
  for (const observation of ordered) {
    const lanes = observation?.baseOpportunities
      ? Object.entries(observation.baseOpportunities)
      : [['USDG', observation]]
    for (const [baseSymbol, lane] of lanes) {
      if (baseSymbol !== 'USDG' && baseSymbol !== 'WETH') continue
      const bridgeToken = baseSymbol === 'WETH' ? baseTokens.USDG : baseTokens.WETH
      const quotes = [lane, ...(Array.isArray(lane?.amountQuotes) ? lane.amountQuotes : [])]
      for (const quote of quotes) {
        for (const leg of ['entry', 'exit']) {
          const route = routeFromQuote(quote, /** @type {'entry' | 'exit'} */ (leg))
          if (!route) continue
          const key = v3DirectionKey(route.tokens[0], route.tokens.at(-1), bridgeToken)
          const before = cache.get(key)?.routes.length || 0
          cache.seed(key, [route])
          const after = cache.get(key)?.routes.length || 0
          seededRoutes += Math.max(0, after - before)
        }
      }
    }
  }
  return seededRoutes
}
