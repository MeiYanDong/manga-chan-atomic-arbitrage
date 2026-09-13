import { formatUnits, getAddress, keccak256, parseUnits, toHex } from 'viem'

import { stableStringify } from './journal.mjs'
import { EARN_ROUTE_DISCOVERY_POLICY, EARN_WETH } from './earnonhood-routes.mjs'

const ADDRESS = /^0x[0-9a-fA-F]{40}$/

function key(value) {
  return String(value).toLowerCase()
}

function safeLabel(value, fallback) {
  const label = String(value || '').trim()
  return /^[\p{L}\p{N} ._&/+()-]{1,48}$/u.test(label) ? label : fallback
}

function finiteNumber(value, label) {
  const number = Number(value)
  if (!Number.isFinite(number)) throw new Error(`${label} must be finite`)
  return number
}

/**
 * Treat the public EARN API as a discovery index only. Malformed entries are
 * rejected here; canonical Vault checks remain mandatory before signing.
 */
export function normalizeEarnOnHoodCatalog(snapshot, options = {}) {
  if (!snapshot?.ready || !Array.isArray(snapshot.pools)) throw new Error('EarnOnHood pool catalog is not ready')
  if (snapshot.pools.length > EARN_ROUTE_DISCOVERY_POLICY.maximumCatalogPools) {
    throw new Error('EarnOnHood pool catalog exceeds the reviewed bound')
  }
  const minimumTvlUsd = finiteNumber(options.minimumTvlUsd ?? 0, 'minimumTvlUsd')
  if (minimumTvlUsd < 0) throw new Error('minimumTvlUsd must be non-negative')
  const pools = []
  const rejected = []
  const seenPools = new Set()

  for (const source of snapshot.pools) {
    try {
      if (!source?.initialized) throw new Error('not initialized')
      if (!ADDRESS.test(String(source.address || ''))) throw new Error('invalid pool address')
      const address = getAddress(source.address)
      if (seenPools.has(key(address))) throw new Error('duplicate pool address')
      const tvlUsd = finiteNumber(source.tvlUsd ?? 0, 'pool tvlUsd')
      if (tvlUsd < minimumTvlUsd) throw new Error('below discovery TVL floor')
      const swapFee = finiteNumber(source.swapFee, 'pool swapFee')
      if (swapFee !== 0.3) throw new Error('unexpected public swap fee')
      if (
        !Array.isArray(source.tokens) ||
        source.tokens.length < 2 ||
        source.tokens.length > EARN_ROUTE_DISCOVERY_POLICY.maximumTokensPerPool
      ) {
        throw new Error('invalid token count')
      }
      const seenTokens = new Set()
      const tokens = source.tokens.map((token) => {
        if (!ADDRESS.test(String(token?.address || ''))) throw new Error('invalid token address')
        const tokenAddress = getAddress(token.address)
        if (seenTokens.has(key(tokenAddress))) throw new Error('duplicate token address')
        seenTokens.add(key(tokenAddress))
        const decimals = Number(token.decimals)
        const weight = finiteNumber(token.weight, 'token weight')
        const balance = BigInt(token.balance)
        if (!Number.isSafeInteger(decimals) || decimals < 0 || decimals > 36) throw new Error('invalid token decimals')
        if (weight <= 0 || balance <= 0n) throw new Error('token weight and balance must be positive')
        return {
          address: tokenAddress,
          symbol: safeLabel(token.symbol, `${tokenAddress.slice(0, 6)}…${tokenAddress.slice(-4)}`),
          decimals,
          balance: balance.toString(),
          weight,
          priceUsd: Number.isFinite(Number(token.priceUsd)) ? Number(token.priceUsd) : null,
        }
      })
      seenPools.add(key(address))
      pools.push({
        address,
        name: safeLabel(source.name, `${address.slice(0, 8)}…${address.slice(-4)}`),
        initialized: true,
        tvlUsd,
        swapFee,
        tokens,
      })
    } catch (error) {
      rejected.push({
        address: ADDRESS.test(String(source?.address || '')) ? getAddress(source.address) : null,
        name: safeLabel(source?.name, 'UNKNOWN'),
        reason: error instanceof Error ? error.message : 'invalid catalog entry',
      })
    }
  }
  return {
    calculatedAt: typeof snapshot.calculatedAt === 'string' ? snapshot.calculatedAt : null,
    pools,
    rejected,
  }
}

export function earnRouteId(baseToken, steps) {
  const payload = {
    baseToken: key(baseToken),
    steps: steps.map((step) => ({
      pool: key(step.pool),
      tokenIn: key(step.tokenIn),
      tokenOut: key(step.tokenOut),
    })),
  }
  return `EARN_DYNAMIC_${keccak256(toHex(stableStringify(payload)))
    .slice(2, 18)
    .toUpperCase()}`
}

export function assertEarnRouteShape(route, options = {}) {
  const baseToken = getAddress(options.baseToken || EARN_WETH)
  const maximumHops = options.maximumHops || EARN_ROUTE_DISCOVERY_POLICY.maximumHops
  if (!route || !Array.isArray(route.steps) || route.steps.length < 2 || route.steps.length > maximumHops) {
    throw new Error('Earn route hop count is outside policy')
  }
  let current = baseToken
  const pools = new Set()
  const intermediateTokens = new Set([key(baseToken)])
  for (let index = 0; index < route.steps.length; index += 1) {
    const step = route.steps[index]
    const pool = getAddress(step.pool)
    const tokenIn = getAddress(step.tokenIn)
    const tokenOut = getAddress(step.tokenOut)
    if (key(tokenIn) !== key(current) || key(tokenOut) === key(tokenIn)) throw new Error('Earn route is discontinuous')
    if (pools.has(key(pool))) throw new Error('Earn route repeats a pool')
    pools.add(key(pool))
    const closing = index === route.steps.length - 1
    if (closing !== (key(tokenOut) === key(baseToken))) throw new Error('Earn route must close only at the final hop')
    if (!closing && intermediateTokens.has(key(tokenOut))) throw new Error('Earn route repeats an intermediate token')
    if (!closing) intermediateTokens.add(key(tokenOut))
    current = tokenOut
  }
  const expectedId = earnRouteId(baseToken, route.steps)
  if (route.id && route.id !== expectedId) throw new Error('Earn route id does not match its path')
  return { ...route, id: expectedId }
}

export function enumerateEarnOnHoodCycles(pools, options = {}) {
  const baseToken = getAddress(options.baseToken || EARN_WETH)
  const maximumHops = options.maximumHops || EARN_ROUTE_DISCOVERY_POLICY.maximumHops
  const maximumRoutes = options.maximumRoutes || EARN_ROUTE_DISCOVERY_POLICY.maximumEnumeratedRoutes
  if (!Array.isArray(pools) || pools.length === 0) return []
  if (!Number.isSafeInteger(maximumHops) || maximumHops < 2 || maximumHops > 6) {
    throw new Error('maximumHops must be within 2..6')
  }
  const poolsByToken = new Map()
  const tokenLabels = new Map()
  for (const pool of pools) {
    for (const token of pool.tokens) {
      const tokenKey = key(token.address)
      tokenLabels.set(tokenKey, token.symbol)
      const entries = poolsByToken.get(tokenKey) || []
      entries.push(pool)
      poolsByToken.set(tokenKey, entries)
    }
  }
  const routes = []
  const walk = (current, steps, usedPools, usedTokens) => {
    if (steps.length >= maximumHops) return
    for (const pool of poolsByToken.get(key(current)) || []) {
      if (usedPools.has(key(pool.address))) continue
      for (const outputToken of pool.tokens) {
        const tokenOut = outputToken.address
        if (key(tokenOut) === key(current)) continue
        const nextSteps = [...steps, { pool: pool.address, tokenIn: current, tokenOut }]
        if (key(tokenOut) === key(baseToken)) {
          if (nextSteps.length >= 2) {
            const route = assertEarnRouteShape({
              id: earnRouteId(baseToken, nextSteps),
              symbols: [
                tokenLabels.get(key(baseToken)) || 'WETH',
                ...nextSteps.map((step) => tokenLabels.get(key(step.tokenOut)) || step.tokenOut),
              ],
              poolNames: [...steps.map((step) => step.poolName), pool.name],
              steps: nextSteps.map(({ pool: stepPool, tokenIn, tokenOut: stepTokenOut }) => ({
                pool: stepPool,
                tokenIn,
                tokenOut: stepTokenOut,
              })),
            })
            routes.push(route)
            if (routes.length > maximumRoutes) throw new Error('Earn route graph exceeds the reviewed bound')
          }
          continue
        }
        if (usedTokens.has(key(tokenOut))) continue
        walk(
          tokenOut,
          [...steps, { ...nextSteps.at(-1), poolName: pool.name }],
          new Set([...usedPools, key(pool.address)]),
          new Set([...usedTokens, key(tokenOut)]),
        )
      }
    }
  }
  walk(baseToken, [], new Set(), new Set([key(baseToken)]))
  return routes.sort((left, right) => left.id.localeCompare(right.id))
}

export function weightedEarnAmountOut(pool, tokenInAddress, tokenOutAddress, amountInRaw) {
  const tokenIn = pool.tokens.find((token) => key(token.address) === key(tokenInAddress))
  const tokenOut = pool.tokens.find((token) => key(token.address) === key(tokenOutAddress))
  if (!tokenIn || !tokenOut || typeof amountInRaw !== 'bigint' || amountInRaw <= 0n) return null
  const amountIn = Number(formatUnits(amountInRaw, tokenIn.decimals))
  const balanceIn = Number(formatUnits(BigInt(tokenIn.balance), tokenIn.decimals))
  const balanceOut = Number(formatUnits(BigInt(tokenOut.balance), tokenOut.decimals))
  if (![amountIn, balanceIn, balanceOut].every(Number.isFinite) || amountIn <= 0 || balanceIn <= 0 || balanceOut <= 0) {
    return null
  }
  const afterFee = amountIn * (1 - pool.swapFee / 100)
  const ratio = balanceIn / (balanceIn + afterFee)
  const output = balanceOut * (1 - ratio ** (tokenIn.weight / tokenOut.weight))
  if (!Number.isFinite(output) || output <= 0) return null
  try {
    return parseUnits(output.toFixed(Math.min(tokenOut.decimals, 18)), tokenOut.decimals)
  } catch {
    return null
  }
}

export function approximateEarnCycle(poolsByAddress, route, amountIn) {
  let amount = amountIn
  for (const step of route.steps) {
    const pool = poolsByAddress.get(key(step.pool))
    if (!pool) return null
    amount = weightedEarnAmountOut(pool, step.tokenIn, step.tokenOut, amount)
    if (amount === null) return null
  }
  return amount
}

export function estimatedEarnGasUnits(hops) {
  if (!Number.isSafeInteger(hops) || hops < 2 || hops > 6) throw new Error('invalid Earn hop count')
  return 180_000n + BigInt(hops) * 100_000n
}

function compareApproximate(left, right) {
  if (left.approximateNetWei !== right.approximateNetWei) {
    return left.approximateNetWei > right.approximateNetWei ? -1 : 1
  }
  if (left.approximateGrossWei !== right.approximateGrossWei) {
    return left.approximateGrossWei > right.approximateGrossWei ? -1 : 1
  }
  return left.route.id.localeCompare(right.route.id)
}

/**
 * Rank the full graph locally, then preserve hop-count diversity. The model is
 * never execution evidence; it only decides which bounded exact quotes to buy.
 */
export function buildEarnOnHoodExactQuoteShortlist({ pools, routes, amounts, gasPriceWei, focusPool = null }) {
  if (!Array.isArray(amounts) || amounts.length < 2 || amounts.some((amount) => typeof amount !== 'bigint')) {
    throw new Error('Earn shortlist requires at least two bigint amounts')
  }
  if (typeof gasPriceWei !== 'bigint' || gasPriceWei <= 0n) throw new Error('Earn shortlist requires gasPriceWei')
  const poolMap = new Map(pools.map((pool) => [key(pool.address), pool]))
  const focus = focusPool ? key(getAddress(focusPool)) : null
  const ranked = []
  for (const route of routes) {
    let best = null
    for (let index = 0; index < amounts.length; index += 1) {
      const amountIn = amounts[index]
      const amountOut = approximateEarnCycle(poolMap, route, amountIn)
      if (amountOut === null) continue
      const approximateGrossWei = BigInt(amountOut) - BigInt(amountIn)
      const approximateNetWei = approximateGrossWei - estimatedEarnGasUnits(route.steps.length) * gasPriceWei
      const candidate = { route, amountIn, amountOut, amountIndex: index, approximateGrossWei, approximateNetWei }
      if (!best || compareApproximate(candidate, best) < 0) best = candidate
    }
    if (best) ranked.push(best)
  }
  ranked.sort(compareApproximate)
  const selected = new Map()
  const add = (candidate) => {
    if (selected.size >= EARN_ROUTE_DISCOVERY_POLICY.maximumShortlistRoutes) return
    selected.set(candidate.route.id, candidate)
  }
  // Direct two-pool cycles are cheapest and are the dominant observed bot
  // shape, so reserve a full hop bucket for them without letting a dense graph
  // consume the complete quote budget.
  for (const candidate of ranked
    .filter((item) => item.route.steps.length === 2)
    .slice(0, EARN_ROUTE_DISCOVERY_POLICY.shortlistRoutesPerHop)) {
    add(candidate)
  }
  if (focus) {
    for (const hops of [2, 3, 4]) {
      for (const candidate of ranked
        .filter((item) => item.route.steps.length === hops && item.route.steps.some((step) => key(step.pool) === focus))
        .slice(0, Math.ceil(EARN_ROUTE_DISCOVERY_POLICY.shortlistRoutesPerHop / 2))) {
        add(candidate)
      }
    }
  }
  for (const hops of [2, 3, 4]) {
    for (const candidate of ranked
      .filter((item) => item.route.steps.length === hops)
      .slice(0, EARN_ROUTE_DISCOVERY_POLICY.shortlistRoutesPerHop)) {
      add(candidate)
    }
  }
  for (const candidate of ranked) add(candidate)

  const selectedRoutes = [...selected.values()]
  const quoteInputs = []
  for (const candidate of selectedRoutes) {
    const indexes = new Set([
      Math.max(0, candidate.amountIndex - 1),
      candidate.amountIndex,
      Math.min(amounts.length - 1, candidate.amountIndex + 1),
    ])
    for (const index of indexes) quoteInputs.push({ route: candidate.route, amountIn: amounts[index] })
  }
  return {
    routeCount: routes.length,
    selectedRoutes: selectedRoutes.map((item) => item.route),
    quoteInputs,
    approximateBest: ranked[0] || null,
  }
}

export function routeExistsInCatalog(route, routes) {
  try {
    const checked = assertEarnRouteShape(route)
    return routes.some((candidate) => candidate.id === checked.id)
  } catch {
    return false
  }
}
