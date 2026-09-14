export const GLOBAL_ROUTE_WORKSET_POLICY = 'SPECIFIC_EVENT_GLOBAL_BUDGET_THEN_PERIODIC_ROTATION_V3'

function lowerAddress(value) {
  return /^0x[0-9a-f]{40}$/i.test(String(value || '')) ? String(value).toLowerCase() : null
}

/** @param {Record<string, any>} route */
export function globalRouteAddresses(route) {
  const values = new Set()
  const add = (value) => {
    const address = lowerAddress(value)
    if (address) values.add(address)
  }
  add(route.pool)
  for (const edge of route.edges || []) {
    add(edge.pool)
    add(edge.hooks)
    add(edge.tokenIn)
    add(edge.tokenOut)
  }
  return values
}

function routeOrder(left, right) {
  return (
    (left.edges?.length || 0) - (right.edges?.length || 0) ||
    String(left.opportunityKind || '').localeCompare(String(right.opportunityKind || '')) ||
    String(left.id).localeCompare(String(right.id))
  )
}

function rotate(values, offset) {
  if (values.length === 0) return []
  const index = Number(BigInt(offset) % BigInt(values.length))
  return [...values.slice(index), ...values.slice(0, index)]
}

/**
 * Event wakes never fill their workset with unrelated routes. Recovery wakes
 * keep a small rotating BPT priority tranche and use the remaining slots for
 * broad deterministic rotation.
 *
 * @param {{routes: Array<Record<string, any>>, wakeAddresses?: string[], blockNumber: bigint | number,
 * maximumRoutesPerWake: number, maximumEventRoutesPerWake: number}} input
 */
export function selectGlobalRouteWorkset(input) {
  if (
    !Array.isArray(input.routes) ||
    !Number.isSafeInteger(input.maximumRoutesPerWake) ||
    input.maximumRoutesPerWake < 1 ||
    !Number.isSafeInteger(input.maximumEventRoutesPerWake) ||
    input.maximumEventRoutesPerWake < 1 ||
    input.maximumEventRoutesPerWake > input.maximumRoutesPerWake
  ) {
    throw new Error('global route workset limits are invalid')
  }
  const wakeAddresses = new Set((input.wakeAddresses || []).map(lowerAddress).filter(Boolean))
  if (wakeAddresses.size > 0) {
    const scored = input.routes
      .map((route) => ({
        route,
        matches: [...globalRouteAddresses(route)].filter((address) => wakeAddresses.has(address)).length,
      }))
      .filter((item) => item.matches > 0)
      .sort(
        (left, right) =>
          right.matches - left.matches ||
          routeOrder(left.route, right.route) ||
          String(left.route.id).localeCompare(String(right.route.id)),
      )
    return {
      policy: GLOBAL_ROUTE_WORKSET_POLICY,
      wakeKind: 'EVENT',
      routes: scored.slice(0, input.maximumEventRoutesPerWake).map((item) => item.route),
      totalRoutes: input.routes.length,
      touchedRoutes: scored.length,
      routeLimit: input.maximumEventRoutesPerWake,
    }
  }

  const bpt = input.routes.filter((route) => route.type === 'BPT').sort(routeOrder)
  const bptSlots = Math.min(bpt.length, Math.max(1, Math.floor(input.maximumRoutesPerWake / 4)))
  const priority = rotate(bpt, input.blockNumber).slice(0, bptSlots)
  const priorityIds = new Set(priority.map((route) => route.id))
  const broad = input.routes.filter((route) => !priorityIds.has(route.id)).sort(routeOrder)
  const routes = [...priority, ...rotate(broad, input.blockNumber)].slice(0, input.maximumRoutesPerWake)
  return {
    policy: GLOBAL_ROUTE_WORKSET_POLICY,
    wakeKind: 'RECOVERY',
    routes,
    totalRoutes: input.routes.length,
    touchedRoutes: 0,
    routeLimit: input.maximumRoutesPerWake,
  }
}

/**
 * Share one event-route budget across settlement assets. Each settlement gets
 * one route per round while it has work, so USDG cannot starve WETH (or vice
 * versa) and an unused lane yields its slots to the others. Recovery worksets
 * keep their independently bounded rotation because they are not latency-
 * sensitive event work.
 *
 * @param {Array<Record<string, any> & {routes: Array<Record<string, any>>, wakeKind: string}>} worksets
 * @param {number} maximumEventRoutesPerWake
 */
export function applyGlobalEventRouteBudget(worksets, maximumEventRoutesPerWake) {
  if (!Array.isArray(worksets) || !Number.isSafeInteger(maximumEventRoutesPerWake) || maximumEventRoutesPerWake < 1) {
    throw new Error('global event route budget is invalid')
  }
  if (worksets.length === 0 || worksets.every((workset) => workset.wakeKind === 'RECOVERY')) return worksets
  if (!worksets.every((workset) => workset.wakeKind === 'EVENT' && Array.isArray(workset.routes))) {
    throw new Error('global event route worksets cannot mix wake kinds')
  }

  const allocated = worksets.map(() => [])
  let selected = 0
  let rank = 0
  while (selected < maximumEventRoutesPerWake) {
    let progressed = false
    for (let lane = 0; lane < worksets.length && selected < maximumEventRoutesPerWake; lane += 1) {
      const route = worksets[lane].routes[rank]
      if (!route) continue
      allocated[lane].push(route)
      selected += 1
      progressed = true
    }
    if (!progressed) break
    rank += 1
  }

  return worksets.map((workset, lane) => ({
    ...workset,
    routes: allocated[lane],
    preBudgetSelectedRoutes: workset.routes.length,
    allocatedRouteLimit: allocated[lane].length,
  }))
}
