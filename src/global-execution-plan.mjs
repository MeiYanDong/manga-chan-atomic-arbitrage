import { getAddress } from 'viem'

const ZERO = getAddress('0x0000000000000000000000000000000000000000')
const ACTION_KIND = Object.freeze({
  UNISWAP_V2: 0,
  UNISWAP_V3: 1,
  UNISWAP_V4: 2,
  EARN: 3,
})

function key(value) {
  return String(value).toLowerCase()
}

function blankV4() {
  return { currency0: ZERO, currency1: ZERO, fee: 0, tickSpacing: 0, hooks: ZERO }
}

export function executionActionFromEdge(edge, amountIn) {
  const common = {
    tokenIn: getAddress(edge.tokenIn),
    tokenOut: getAddress(edge.tokenOut),
    amountIn,
    minimumAmountOut: 1n,
  }
  if (edge.venue === 'UNISWAP_V2') {
    return { ...common, kind: ACTION_KIND.UNISWAP_V2, pool: getAddress(edge.pool), fee: 0, v4Pool: blankV4() }
  }
  if (edge.venue === 'UNISWAP_V3') {
    return {
      ...common,
      kind: ACTION_KIND.UNISWAP_V3,
      pool: getAddress(edge.pool),
      fee: Number(edge.fee),
      v4Pool: blankV4(),
    }
  }
  if (edge.venue === 'UNISWAP_V4') {
    const [currency0, currency1] =
      key(edge.tokenIn) < key(edge.tokenOut)
        ? [getAddress(edge.tokenIn), getAddress(edge.tokenOut)]
        : [getAddress(edge.tokenOut), getAddress(edge.tokenIn)]
    return {
      ...common,
      kind: ACTION_KIND.UNISWAP_V4,
      pool: ZERO,
      fee: 0,
      v4Pool: {
        currency0,
        currency1,
        fee: Number(edge.fee),
        tickSpacing: Number(edge.tickSpacing),
        hooks: getAddress(edge.hooks),
      },
    }
  }
  if (edge.venue === 'EARN') {
    return { ...common, kind: ACTION_KIND.EARN, pool: getAddress(edge.pool), fee: 0, v4Pool: blankV4() }
  }
  throw new Error(`execution-unsupported venue ${edge.venue}`)
}

function appendPath(actions, path, firstAmount) {
  path.forEach((edge, index) => actions.push(executionActionFromEdge(edge, index === 0 ? firstAmount : 0n)))
}

function trackedFromTemplate(template) {
  const tokens = new Map()
  const add = (token) => {
    const normalized = getAddress(token)
    tokens.set(key(normalized), normalized)
  }
  add(template.settlementToken)
  add(template.pool)
  const paths =
    template.kind === 'BPT_DISCOUNT_REMOVE_AND_SELL'
      ? [template.buyBpt, ...template.sellComponents]
      : [...template.buyComponents, template.sellBpt]
  for (const path of paths) {
    for (const edge of path) {
      add(edge.tokenIn)
      add(edge.tokenOut)
    }
  }
  const components = template.kind === 'BPT_DISCOUNT_REMOVE_AND_SELL' ? template.remove.outputs : template.add.inputs
  for (const token of components) add(token)
  return [...tokens.values()].map((token) => ({ token, maximumResidual: 1n }))
}

/** Convert a generic graph template into the executor's typed ABI plan. */
export function buildBptExecutionPlan(template, options) {
  const principal = BigInt(options.principal)
  const minimumProfit = BigInt(options.minimumProfit)
  const deadline = BigInt(options.deadline)
  if (principal <= 0n || minimumProfit <= 0n || deadline <= 0n) throw new Error('execution bounds must be positive')
  const actions = []
  if (template.kind === 'BPT_DISCOUNT_REMOVE_AND_SELL') {
    appendPath(actions, template.buyBpt, principal)
    actions.push({
      kind: 5,
      tokenIn: getAddress(template.pool),
      tokenOut: ZERO,
      pool: getAddress(template.pool),
      amountIn: 0n,
      minimumAmountOut: 0n,
      fee: 0,
      v4Pool: blankV4(),
    })
    for (const path of template.sellComponents) appendPath(actions, path, 0n)
  } else if (template.kind === 'BPT_PREMIUM_BUY_AND_ADD') {
    const allocations = (options.allocations || []).map(BigInt)
    if (
      allocations.length !== template.buyComponents.length ||
      allocations.some((amount) => amount <= 0n) ||
      allocations.reduce((total, amount) => total + amount, 0n) > principal
    ) {
      throw new Error('premium component allocations are invalid')
    }
    template.buyComponents.forEach((path, index) => appendPath(actions, path, allocations[index]))
    actions.push({
      kind: 4,
      tokenIn: ZERO,
      tokenOut: getAddress(template.pool),
      pool: getAddress(template.pool),
      amountIn: 0n,
      minimumAmountOut: 1n,
      fee: 0,
      v4Pool: blankV4(),
    })
    appendPath(actions, template.sellBpt, 0n)
  } else {
    throw new Error(`unsupported BPT template ${template.kind}`)
  }
  if (actions.length === 0 || actions.length > 24) throw new Error('typed action count is outside executor bounds')
  const trackedTokens = trackedFromTemplate(template)
  if (trackedTokens.length > 16) throw new Error('tracked token count is outside executor bounds')
  return {
    settlementToken: getAddress(template.settlementToken),
    trackedTokens,
    actions,
    minimumProfit,
    deadline,
  }
}

/** Convert a closed cross-venue swap cycle into the executor's typed ABI plan. */
export function buildCycleExecutionPlan(cycle, options) {
  const principal = BigInt(options.principal)
  const minimumProfit = BigInt(options.minimumProfit)
  const deadline = BigInt(options.deadline)
  if (principal <= 0n || minimumProfit <= 0n || deadline <= 0n) throw new Error('execution bounds must be positive')
  if (!Array.isArray(cycle?.edges) || cycle.edges.length < 2 || cycle.edges.length > 5) {
    throw new Error('cycle edge count is outside executor bounds')
  }
  const settlementToken = getAddress(cycle.settlementToken)
  if (
    key(cycle.edges[0].tokenIn) !== key(settlementToken) ||
    key(cycle.edges.at(-1).tokenOut) !== key(settlementToken)
  ) {
    throw new Error('cycle is not closed over its settlement token')
  }
  const venues = new Set()
  const tracked = new Map([[key(settlementToken), settlementToken]])
  const actions = cycle.edges.map((edge, index) => {
    if (index > 0 && key(cycle.edges[index - 1].tokenOut) !== key(edge.tokenIn)) {
      throw new Error('cycle edges are not contiguous')
    }
    venues.add(edge.venue)
    tracked.set(key(getAddress(edge.tokenIn)), getAddress(edge.tokenIn))
    tracked.set(key(getAddress(edge.tokenOut)), getAddress(edge.tokenOut))
    return executionActionFromEdge(edge, index === 0 ? principal : 0n)
  })
  if (venues.size < 2) throw new Error('cycle must cross at least two venues')
  return {
    settlementToken,
    trackedTokens: [...tracked.values()].map((token) => ({ token, maximumResidual: 1n })),
    actions,
    minimumProfit,
    deadline,
  }
}

export function equalPremiumAllocations(principal, componentCount) {
  const amount = BigInt(principal)
  if (amount <= 0n || !Number.isSafeInteger(componentCount) || componentCount <= 0) {
    throw new Error('invalid equal allocation input')
  }
  const each = amount / BigInt(componentCount)
  if (each <= 0n) throw new Error('principal is too small for every component')
  const allocations = Array.from({ length: componentCount }, () => each)
  allocations[0] += amount - each * BigInt(componentCount)
  return allocations
}
