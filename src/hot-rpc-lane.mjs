export const HotRpcLaneDecision = Object.freeze({
  MANAGED: 'MANAGED_EVENT_HOT',
  PUBLIC_DISABLED: 'PUBLIC_HOT_RPC_DISABLED',
  PUBLIC_MISSING_ENDPOINT: 'PUBLIC_HOT_RPC_ENDPOINT_MISSING',
  PUBLIC_LOW_PRIORITY: 'PUBLIC_SHADOW_ONLY_EVENT',
  PUBLIC_EVENT_BUDGET_EXHAUSTED: 'PUBLIC_EVENT_BUDGET_EXHAUSTED',
  PUBLIC_LOGICAL_BUDGET_EXHAUSTED: 'PUBLIC_LOGICAL_BUDGET_EXHAUSTED',
  PUBLIC_TRANSIENT_FALLBACK: 'PUBLIC_TRANSIENT_FALLBACK',
})

/**
 * @param {{enabled: boolean, hotRpcUrl: string | null, publicRpcUrl: string | null}} input
 */
export function validateManagedHotRpcUrl(input) {
  if (!input.enabled) return
  if (!input.hotRpcUrl) throw new Error('MANGA_BOARD_HOT_RPC_ENABLED requires MANGA_BOARD_HOT_RPC_URL')
  let hotUrl
  try {
    hotUrl = new URL(input.hotRpcUrl)
  } catch {
    throw new Error('MANGA_BOARD_HOT_RPC_URL is not a valid URL')
  }
  if (!['http:', 'https:'].includes(hotUrl.protocol)) {
    throw new Error('MANGA_BOARD_HOT_RPC_URL must use HTTP or HTTPS')
  }
  if (hotUrl.hostname === 'rpc.mainnet.chain.robinhood.com') {
    throw new Error('MANGA_BOARD_HOT_RPC_URL must be a managed endpoint, not the official public RPC')
  }
  if (!input.publicRpcUrl) return
  let publicUrl
  try {
    publicUrl = new URL(input.publicRpcUrl)
  } catch {
    return
  }
  if (hotUrl.href === publicUrl.href) {
    throw new Error('MANGA_BOARD_HOT_RPC_URL must be distinct from MANGA_BOARD_RPC_URL')
  }
}

/** @param {number} nowMs */
export function utcDayKey(nowMs) {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) throw new Error('hot RPC clock must be a non-negative safe integer')
  return new Date(nowMs).toISOString().slice(0, 10)
}

/**
 * Only candidates matching the deployed executor's PoolKey shape may spend the
 * managed event-quote budget. Shadow-only discovery and every periodic cycle
 * stay on the public reader.
 *
 * @param {{enabled: boolean, endpointConfigured: boolean, candidatePriorities: number[], minimumPriority?: number}} input
 */
export function selectHotRpcLane(input) {
  const minimumPriority = input.minimumPriority ?? 1
  if (!Number.isSafeInteger(minimumPriority) || minimumPriority < 0) {
    throw new Error('hot RPC minimum priority must be a non-negative safe integer')
  }
  if (!input.enabled) return { selected: false, reason: HotRpcLaneDecision.PUBLIC_DISABLED }
  if (!input.endpointConfigured) return { selected: false, reason: HotRpcLaneDecision.PUBLIC_MISSING_ENDPOINT }
  if (!Array.isArray(input.candidatePriorities) || input.candidatePriorities.length === 0) {
    return { selected: false, reason: HotRpcLaneDecision.PUBLIC_LOW_PRIORITY }
  }
  if (input.candidatePriorities.some((priority) => !Number.isSafeInteger(priority) || priority < 0)) {
    throw new Error('hot RPC candidate priorities must be non-negative safe integers')
  }
  if (Math.max(...input.candidatePriorities) < minimumPriority) {
    return { selected: false, reason: HotRpcLaneDecision.PUBLIC_LOW_PRIORITY }
  }
  return { selected: true, reason: HotRpcLaneDecision.MANAGED }
}

/**
 * Count logical JSON-RPC operations inside one HTTP body. The managed client
 * currently disables batching, but counting an array keeps the budget correct
 * if transport batching is introduced later.
 *
 * @param {unknown} body
 */
export function jsonRpcCallCount(body) {
  if (typeof body !== 'string' || body.length === 0) return 1
  try {
    const parsed = JSON.parse(body)
    return Array.isArray(parsed) && parsed.length > 0 ? parsed.length : 1
  } catch {
    return 1
  }
}

/**
 * Classify JSON-RPC work without retaining calldata, endpoint URLs or other
 * request payloads. Contract labels are supplied by the caller so this helper
 * remains chain-agnostic and the public telemetry exposes only operator-safe
 * names such as V3_QUOTER or V4_QUOTER.
 *
 * @param {unknown} body
 * @param {Record<string, string>} [contractLabels]
 */
export function jsonRpcOperationLabels(body, contractLabels = {}) {
  if (typeof body !== 'string' || body.length === 0) return ['UNKNOWN']
  let parsed
  try {
    parsed = JSON.parse(body)
  } catch {
    return ['UNKNOWN']
  }
  const calls = Array.isArray(parsed) ? parsed : [parsed]
  if (calls.length === 0) return ['UNKNOWN']
  const normalizedContracts = new Map(
    Object.entries(contractLabels).map(([address, label]) => [address.toLowerCase(), String(label)]),
  )
  return calls.map((call) => {
    const method = typeof call?.method === 'string' && call.method.length > 0 ? call.method : 'UNKNOWN'
    if (method !== 'eth_call') return method
    const target = typeof call?.params?.[0]?.to === 'string' ? call.params[0].to.toLowerCase() : null
    return target && normalizedContracts.has(target) ? `eth_call:${normalizedContracts.get(target)}` : 'eth_call:OTHER'
  })
}

/** @param {number[]} samples */
export function latencyPercentiles(samples) {
  const values = samples.filter((value) => Number.isFinite(value) && value >= 0).sort((left, right) => left - right)
  if (values.length === 0) return { samples: 0, p50Ms: null, p95Ms: null, p99Ms: null, maxMs: null }
  const percentile = (quantile) => values[Math.min(values.length - 1, Math.ceil(values.length * quantile) - 1)]
  const rounded = (value) => Number(value.toFixed(2))
  return {
    samples: values.length,
    p50Ms: rounded(percentile(0.5)),
    p95Ms: rounded(percentile(0.95)),
    p99Ms: rounded(percentile(0.99)),
    maxMs: rounded(values[values.length - 1]),
  }
}

export class DailyHotRpcBudget {
  /**
   * @param {{dailyEventCandidateCap: number, dailyLogicalCallCap: number, persisted?: Record<string, any> | null, now?: () => number, onChange?: (state: Record<string, any>) => void}} options
   */
  constructor(options) {
    if (!Number.isSafeInteger(options.dailyEventCandidateCap) || options.dailyEventCandidateCap < 1) {
      throw new Error('hot RPC daily event-candidate cap must be a positive safe integer')
    }
    if (!Number.isSafeInteger(options.dailyLogicalCallCap) || options.dailyLogicalCallCap < 1) {
      throw new Error('hot RPC daily logical-call cap must be a positive safe integer')
    }
    this.dailyEventCandidateCap = options.dailyEventCandidateCap
    this.dailyLogicalCallCap = options.dailyLogicalCallCap
    this.now = options.now || Date.now
    this.onChange = options.onChange || (() => {})
    const persisted = options.persisted || {}
    this.state = {
      schemaVersion: 1,
      dayUtc: typeof persisted.dayUtc === 'string' ? persisted.dayUtc : null,
      admittedEventCandidates: Number.isSafeInteger(persisted.admittedEventCandidates)
        ? Math.max(0, persisted.admittedEventCandidates)
        : 0,
      consumedLogicalCalls: Number.isSafeInteger(persisted.consumedLogicalCalls)
        ? Math.max(0, persisted.consumedLogicalCalls)
        : 0,
      updatedAt: typeof persisted.updatedAt === 'string' ? persisted.updatedAt : null,
    }
    this.refreshDay()
  }

  refreshDay() {
    const nowMs = this.now()
    const dayUtc = utcDayKey(nowMs)
    if (this.state.dayUtc === dayUtc) return false
    this.state = {
      schemaVersion: 1,
      dayUtc,
      admittedEventCandidates: 0,
      consumedLogicalCalls: 0,
      updatedAt: new Date(nowMs).toISOString(),
    }
    this.onChange(this.snapshot())
    return true
  }

  /** @param {number} count */
  admitEventCandidates(count) {
    if (!Number.isSafeInteger(count) || count < 1) {
      throw new Error('hot RPC event-candidate debit must be a positive safe integer')
    }
    this.refreshDay()
    if (this.state.consumedLogicalCalls >= this.dailyLogicalCallCap) {
      return { admitted: false, reason: HotRpcLaneDecision.PUBLIC_LOGICAL_BUDGET_EXHAUSTED }
    }
    if (this.state.admittedEventCandidates + count > this.dailyEventCandidateCap) {
      return { admitted: false, reason: HotRpcLaneDecision.PUBLIC_EVENT_BUDGET_EXHAUSTED }
    }
    this.state.admittedEventCandidates += count
    this.state.updatedAt = new Date(this.now()).toISOString()
    this.onChange(this.snapshot())
    return { admitted: true, reason: HotRpcLaneDecision.MANAGED }
  }

  /** @param {number} count */
  consumeLogicalCalls(count) {
    if (!Number.isSafeInteger(count) || count < 1) {
      throw new Error('hot RPC logical-call debit must be a positive safe integer')
    }
    this.refreshDay()
    if (this.state.consumedLogicalCalls + count > this.dailyLogicalCallCap) {
      return { consumed: false, reason: HotRpcLaneDecision.PUBLIC_LOGICAL_BUDGET_EXHAUSTED }
    }
    this.state.consumedLogicalCalls += count
    this.state.updatedAt = new Date(this.now()).toISOString()
    this.onChange(this.snapshot())
    return { consumed: true, reason: HotRpcLaneDecision.MANAGED }
  }

  snapshot() {
    this.refreshDay()
    return {
      ...this.state,
      dailyEventCandidateCap: this.dailyEventCandidateCap,
      dailyLogicalCallCap: this.dailyLogicalCallCap,
      remainingEventCandidates: Math.max(0, this.dailyEventCandidateCap - this.state.admittedEventCandidates),
      remainingLogicalCalls: Math.max(0, this.dailyLogicalCallCap - this.state.consumedLogicalCalls),
    }
  }
}
