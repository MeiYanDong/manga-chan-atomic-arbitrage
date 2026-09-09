export const ShadowWakeSource = Object.freeze({
  V4_SWAP: 'V4_SWAP',
  V4_INITIALIZE: 'V4_INITIALIZE',
  V3_SWAP: 'V3_SWAP',
})

export class FixedBlockPromiseCache {
  constructor() {
    this.blockNumber = null
    this.values = new Map()
  }

  /** @param {bigint} blockNumber @param {string} key @param {() => Promise<any>} operation @param {{evictRejected?: boolean}} [options] */
  getOrCreate(blockNumber, key, operation, options = {}) {
    if (this.blockNumber !== blockNumber) {
      this.blockNumber = blockNumber
      this.values.clear()
    }
    const cached = this.values.get(key)
    if (cached) return { promise: cached, hit: true }

    const promise = Promise.resolve().then(operation)
    this.values.set(key, promise)
    if (options.evictRejected !== false) {
      promise.catch(() => {
        if (this.values.get(key) === promise) this.values.delete(key)
      })
    }
    return { promise, hit: false }
  }
}

export class AsyncConcurrencyGate {
  /** @param {number} limit */
  constructor(limit) {
    if (!Number.isSafeInteger(limit) || limit <= 0) throw new Error('concurrency limit must be a positive safe integer')
    this.limit = limit
    this.active = 0
    this.peak = 0
    this.waiters = []
  }

  /** @param {() => Promise<any>} operation */
  async run(operation) {
    if (this.active >= this.limit) await new Promise((resolve) => this.waiters.push(resolve))
    this.active += 1
    this.peak = Math.max(this.peak, this.active)
    try {
      return await operation()
    } finally {
      this.active -= 1
      const next = this.waiters.shift()
      if (next) next()
    }
  }
}

/** @param {string[]} values @param {number} offset @param {number} limit */
export function rotatingSlice(values, offset, limit) {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 0) {
    throw new Error('rotation offset and limit must be non-negative safe integers')
  }
  if (values.length === 0 || limit === 0) return []
  const size = Math.min(limit, values.length)
  return Array.from({ length: size }, (_, index) => values[(offset + index) % values.length])
}

/**
 * Bound event waiting by the next mandatory reconciliation deadline. Event
 * wakes may run before the deadline, but an always-busy event stream cannot
 * postpone the periodic coverage/backfill cycle indefinitely.
 *
 * @param {number} waitMs
 * @param {number} nowMs
 * @param {number} reconciliationAtMs
 */
export function capEventWaitForReconciliation(waitMs, nowMs, reconciliationAtMs) {
  if (![waitMs, nowMs, reconciliationAtMs].every(Number.isSafeInteger)) {
    throw new Error('event wait timing values must be safe integers')
  }
  if (waitMs < 0 || nowMs < 0 || reconciliationAtMs < 0) {
    throw new Error('event wait timing values must be non-negative')
  }
  return Math.min(waitMs, Math.max(0, reconciliationAtMs - nowMs))
}

/**
 * Reserve a small, non-preemptible periodic tranche. This prevents a busy pool
 * event stream from starving broad-market coverage while keeping the event
 * path independently bounded and latency-sensitive.
 *
 * @param {{eventWake: boolean, cycleMaxCandidates: number, protectedPeriodicCandidates: number}} input
 */
export function quoteCyclePolicy(input) {
  if (![input.cycleMaxCandidates, input.protectedPeriodicCandidates].every(Number.isSafeInteger)) {
    throw new Error('quote cycle limits must be safe integers')
  }
  if (input.cycleMaxCandidates < 1 || input.protectedPeriodicCandidates < 1) {
    throw new Error('quote cycle limits must be positive')
  }
  if (input.eventWake) {
    return {
      mode: 'EVENT_HOT_PATH',
      preemptible: false,
      maxCandidates: input.cycleMaxCandidates,
    }
  }
  return {
    mode: 'PROTECTED_PERIODIC_RECONCILIATION',
    preemptible: false,
    maxCandidates: Math.min(input.cycleMaxCandidates, input.protectedPeriodicCandidates),
  }
}

/**
 * A periodic read may yield only when a newer accepted pool event appeared
 * after that read cycle began. Pending backlog from before the cycle is not a
 * reason to abort mandatory reconciliation work.
 *
 * @param {{preemptible?: boolean, acceptedEventsAtStart?: number, preempted?: boolean} | undefined} context
 * @param {number} currentAcceptedEvents
 */
export function shouldPreemptPeriodicQuote(context, currentAcceptedEvents) {
  if (!Number.isSafeInteger(currentAcceptedEvents) || currentAcceptedEvents < 0) {
    throw new Error('accepted event revision must be a non-negative safe integer')
  }
  if (!context?.preemptible) return false
  const baseline = context.acceptedEventsAtStart ?? 0
  if (!Number.isSafeInteger(baseline) || baseline < 0) {
    throw new Error('accepted event baseline must be a non-negative safe integer')
  }
  return context.preempted === true || currentAcceptedEvents > baseline
}

/**
 * Keep the hot poller on a fixed success cadence while applying bounded
 * exponential backoff after public-RPC failures. Time already spent polling
 * counts toward the interval so a slow request is never followed by an
 * unnecessary full delay.
 *
 * @param {number} baseMs
 * @param {number} consecutiveErrors
 * @param {number} elapsedMs
 */
export function nextHotPollDelay(baseMs, consecutiveErrors, elapsedMs) {
  if (![baseMs, consecutiveErrors, elapsedMs].every(Number.isSafeInteger)) {
    throw new Error('hot poll timing values must be safe integers')
  }
  if (baseMs <= 0 || consecutiveErrors < 0 || elapsedMs < 0) {
    throw new Error('invalid hot poll timing policy')
  }
  const errorMultiplier = 2 ** Math.min(consecutiveErrors, 4)
  const intervalMs = Math.min(60_000, baseMs * errorMultiplier)
  return Math.max(0, intervalMs - elapsedMs)
}

/**
 * Give latency-sensitive event quotes a smaller retry budget without changing
 * the more complete periodic reconciliation policy.
 *
 * @param {{eventHotPath?: boolean} | undefined} context
 * @param {{periodic: {attempts: number, delayMs: number}, event: {attempts: number, delayMs: number}}} policies
 */
export function selectRpcRetryPolicy(context, policies) {
  const eventHotPath = context?.eventHotPath === true
  const selected = eventHotPath ? policies.event : policies.periodic
  if (!Number.isSafeInteger(selected?.attempts) || selected.attempts < 1) {
    throw new Error('RPC retry attempts must be a positive safe integer')
  }
  if (!Number.isSafeInteger(selected.delayMs) || selected.delayMs < 0) {
    throw new Error('RPC retry delay must be a non-negative safe integer')
  }
  return { ...selected, eventHotPath }
}

/**
 * Retry only failures explicitly classified as transient by the caller. This
 * helper has no default retry policy, so an EVM/business revert cannot be
 * retried accidentally.
 *
 * @param {() => Promise<any>} operation
 * @param {{attempts: number, delayMs: number, shouldRetry: (error: unknown) => boolean, onRetry?: (error: unknown, attempt: number) => void}} options
 */
export async function retryReadOnly(operation, options) {
  if (!Number.isSafeInteger(options.attempts) || options.attempts <= 0) {
    throw new Error('retry attempts must be a positive safe integer')
  }
  if (!Number.isSafeInteger(options.delayMs) || options.delayMs < 0) {
    throw new Error('retry delay must be a non-negative safe integer')
  }
  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      if (attempt === options.attempts || !options.shouldRetry(error)) throw error
      options.onRetry?.(error, attempt)
      const delay = options.delayMs * 2 ** (attempt - 1)
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }
  throw new Error('unreachable retry state')
}

/**
 * Select priority rows, the currently actionable set, and exactly one bounded
 * coverage batch. An empty actionable quota never expands into extra
 * unobserved work.
 *
 * @param {Record<string, any>[]} catalog
 * @param {Map<string, Record<string, any>>} observations
 * @param {{priorityIds: string[], positiveStatuses: string[], topRefreshSize: number, batchSize: number, cursor: number, maxCandidates?: number}} options
 */
export function selectPeriodicShadowCandidates(catalog, observations, options) {
  const maxCandidates = options.maxCandidates ?? Number.MAX_SAFE_INTEGER
  if (!Number.isSafeInteger(maxCandidates) || maxCandidates < 1) {
    throw new Error('periodic candidate cap must be a positive safe integer')
  }
  const byId = new Map(catalog.map((candidate) => [candidate.id, candidate]))
  const selected = []
  const seen = new Set()
  const add = (candidate) => {
    if (!candidate || seen.has(candidate.id) || selected.length >= maxCandidates) return false
    seen.add(candidate.id)
    selected.push(candidate)
    return true
  }

  const highPriority = options.priorityIds.map((id) => byId.get(id.toLowerCase())).filter(Boolean)
  const currentPositive = [...observations.entries()]
    .filter(([, observation]) =>
      [observation.status, ...Object.values(observation.baseOpportunities || {}).map((lane) => lane?.status)].some(
        (status) => options.positiveStatuses.includes(status),
      ),
    )
    .sort(
      (left, right) =>
        Number(right[1].preferredNormalizedScreenedNetUsdg ?? right[1].screenedNetUsdg) -
        Number(left[1].preferredNormalizedScreenedNetUsdg ?? left[1].screenedNetUsdg),
    )
    .slice(0, options.topRefreshSize)
  highPriority.push(...currentPositive.map(([id]) => byId.get(id)).filter(Boolean))

  const highPriorityTarget = Math.max(0, maxCandidates - 1)
  for (const candidate of highPriority) {
    if (selected.length >= highPriorityTarget) break
    add(candidate)
  }

  let coverageAdded = 0
  for (const candidate of catalog) {
    if (coverageAdded >= options.batchSize || selected.length >= maxCandidates) break
    if (!observations.has(candidate.id) && add(candidate)) coverageAdded += 1
  }

  let examined = 0
  while (
    catalog.length > 0 &&
    coverageAdded < options.batchSize &&
    selected.length < maxCandidates &&
    examined < catalog.length
  ) {
    const candidate = catalog[(options.cursor + examined) % catalog.length]
    examined += 1
    if (add(candidate)) coverageAdded += 1
  }
  for (const candidate of highPriority) {
    if (selected.length >= maxCandidates) break
    add(candidate)
  }
  const nextCursor = catalog.length > 0 ? (options.cursor + Math.max(examined, options.batchSize)) % catalog.length : 0
  return { selected, nextCursor, coverageAdded }
}

/** @param {Record<string, any>} event */
export function shadowEventId(event) {
  return `${event.transactionHash || event.blockHash || 'block'}:${event.logIndex ?? -1}:${event.type}`
}

/**
 * A hot-log range can contain many swaps for the same pool. The board uses
 * events only to request a canonical re-quote, so one latest revision per pool
 * carries the same wake information without repeatedly fanning out an already
 * pending candidate set. Initialize events remain independent catalog facts.
 *
 * @param {Record<string, any>[]} events
 */
export function coalesceLatestSwapPerPool(events) {
  const retained = []
  const latestByPool = new Map()
  for (const event of events) {
    const poolIdentity =
      event.type === ShadowWakeSource.V4_SWAP
        ? event.poolId
        : event.type === ShadowWakeSource.V3_SWAP
          ? event.poolAddress
          : null
    if (!poolIdentity) {
      retained.push(event)
      continue
    }
    const key = `${event.type}:${String(poolIdentity).toLowerCase()}`
    const previous = latestByPool.get(key)
    if (
      !previous ||
      event.blockNumber > previous.blockNumber ||
      (event.blockNumber === previous.blockNumber && event.logIndex >= previous.logIndex)
    ) {
      latestByPool.set(key, event)
    }
  }
  return [...retained, ...latestByPool.values()].sort((left, right) => {
    if (left.blockNumber !== right.blockNumber) return left.blockNumber < right.blockNumber ? -1 : 1
    return left.logIndex - right.logIndex
  })
}

export class CandidateWakeQueue {
  constructor(maxRemembered = 20_000) {
    this.maxRemembered = maxRemembered
    this.seen = new Set()
    this.seenOrder = []
    this.pending = new Map()
    this.dedupedEvents = 0
    this.acceptedEvents = 0
    this.staleCandidateDrops = 0
  }

  /** @param {Record<string, any>} event @param {string[]} candidateIds @param {number} [observedAtMs] */
  offer(event, candidateIds, observedAtMs = Date.now()) {
    const eventId = shadowEventId(event)
    if (this.seen.has(eventId)) {
      this.dedupedEvents += 1
      return { accepted: false, candidateCount: 0 }
    }
    this.seen.add(eventId)
    this.seenOrder.push(eventId)
    while (this.seenOrder.length > this.maxRemembered) this.seen.delete(this.seenOrder.shift())
    this.acceptedEvents += 1

    const uniqueIds = [...new Set(candidateIds.map((id) => String(id).toLowerCase()))]
    const poolKey = event.poolId || event.poolAddress || null
    for (const candidateId of uniqueIds) {
      const before = this.pending.get(candidateId)
      if (!before) {
        this.pending.set(candidateId, {
          candidateId,
          firstObservedAtMs: observedAtMs,
          lastObservedAtMs: observedAtMs,
          minBlock: event.blockNumber,
          maxBlock: event.blockNumber,
          eventCount: 1,
          sources: [event.type],
          poolKeys: poolKey ? [String(poolKey).toLowerCase()] : [],
        })
        continue
      }
      before.lastObservedAtMs = observedAtMs
      before.minBlock = event.blockNumber < before.minBlock ? event.blockNumber : before.minBlock
      before.maxBlock = event.blockNumber > before.maxBlock ? event.blockNumber : before.maxBlock
      before.eventCount += 1
      if (!before.sources.includes(event.type)) before.sources.push(event.type)
      if (poolKey && !before.poolKeys.includes(String(poolKey).toLowerCase())) {
        before.poolKeys.push(String(poolKey).toLowerCase())
      }
    }
    return { accepted: true, candidateCount: uniqueIds.length }
  }

  /**
   * @param {number} limit
   * @param {{nowMs?: number, maxAgeMs?: number, newestFirst?: boolean}} [options]
   */
  take(limit, options = {}) {
    if (!Number.isSafeInteger(limit) || limit <= 0) throw new Error('wake limit must be a positive safe integer')
    const nowMs = options.nowMs ?? Date.now()
    const maxAgeMs = options.maxAgeMs ?? Number.MAX_SAFE_INTEGER
    if (!Number.isSafeInteger(nowMs) || nowMs < 0 || !Number.isSafeInteger(maxAgeMs) || maxAgeMs < 0) {
      throw new Error('wake freshness values must be non-negative safe integers')
    }
    let staleDropped = 0
    for (const [candidateId, item] of this.pending) {
      if (nowMs - item.lastObservedAtMs <= maxAgeMs) continue
      this.pending.delete(candidateId)
      staleDropped += 1
    }
    this.staleCandidateDrops += staleDropped
    const selected = [...this.pending.values()]
      .sort((left, right) => {
        const timeOrder = options.newestFirst
          ? right.lastObservedAtMs - left.lastObservedAtMs
          : left.firstObservedAtMs - right.firstObservedAtMs
        return timeOrder || left.candidateId.localeCompare(right.candidateId)
      })
      .slice(0, limit)
    for (const item of selected) this.pending.delete(item.candidateId)
    return {
      candidateIds: selected.map((item) => item.candidateId),
      triggers: selected,
      oldestObservedAtMs: selected.length > 0 ? Math.min(...selected.map((item) => item.firstObservedAtMs)) : null,
      newestObservedAtMs: selected.length > 0 ? Math.max(...selected.map((item) => item.lastObservedAtMs)) : null,
      staleDropped,
    }
  }

  get size() {
    return this.pending.size
  }
}

/** @param {Map<string, Set<string>>} map @param {string} key @param {string} candidateId */
function addDependency(map, key, candidateId) {
  const canonicalKey = key.toLowerCase()
  if (!map.has(canonicalKey)) map.set(canonicalKey, new Set())
  map.get(canonicalKey).add(candidateId.toLowerCase())
}

/** @param {unknown} value */
function addressList(value) {
  if (!Array.isArray(value)) return []
  return value.filter((address) => typeof address === 'string' && /^0x[0-9a-f]{40}$/i.test(address))
}

/**
 * V4 pools are known from the catalog. V3 dependencies are deliberately
 * limited to routes that were actually quoted; the periodic reconciliation
 * sweep covers a previously unused V3 route becoming best.
 *
 * @param {Record<string, any>[]} catalog
 * @param {Map<string, Record<string, any>>} observations
 */
export function buildShadowDependencyIndex(catalog, observations = new Map()) {
  const v4PoolToCandidates = new Map()
  const v3PoolToCandidates = new Map()
  for (const candidate of catalog || []) {
    for (const pool of candidate.pools || []) addDependency(v4PoolToCandidates, pool.poolId, candidate.id)
    const observation = observations.get(candidate.id)
    const baseVariants = Object.values(observation?.baseOpportunities || {}).flatMap((lane) => [
      lane,
      ...(lane?.amountQuotes || []),
    ])
    const variants = [observation, ...(observation?.amountQuotes || []), ...baseVariants].filter(Boolean)
    for (const variant of variants) {
      for (const address of [...addressList(variant.entryV3Pools), ...addressList(variant.exitV3Pools)]) {
        addDependency(v3PoolToCandidates, address, candidate.id)
      }
    }
  }
  return { v4PoolToCandidates, v3PoolToCandidates }
}

/** @param {Record<string, any>} event @param {ReturnType<typeof buildShadowDependencyIndex>} index */
export function routeShadowEvent(event, index) {
  if (event.type === ShadowWakeSource.V4_INITIALIZE) {
    return { candidateIds: [], catalogRefresh: true }
  }
  const dependencies =
    event.type === ShadowWakeSource.V4_SWAP
      ? index.v4PoolToCandidates.get(String(event.poolId).toLowerCase())
      : event.type === ShadowWakeSource.V3_SWAP
        ? index.v3PoolToCandidates.get(String(event.poolAddress).toLowerCase())
        : null
  return { candidateIds: dependencies ? [...dependencies] : [], catalogRefresh: false }
}

/** @param {Record<string, any>} mirror @param {Record<string, any>} event */
export function applyPoolMirrorEvent(mirror, event) {
  if (![ShadowWakeSource.V4_SWAP, ShadowWakeSource.V3_SWAP].includes(event.type)) return mirror
  const key = String(event.poolId || event.poolAddress).toLowerCase()
  return {
    ...mirror,
    [key]: {
      source: event.type,
      blockNumber: event.blockNumber.toString(),
      blockHash: event.blockHash || null,
      transactionHash: event.transactionHash || null,
      logIndex: event.logIndex,
      sqrtPriceX96: event.sqrtPriceX96.toString(),
      liquidity: event.liquidity.toString(),
      tick: event.tick,
      fee: event.fee ?? null,
    },
  }
}

/**
 * Plan one bounded inclusive log range. A null cursor starts at the next safe
 * block, because the initial full quote sweep already reconciles current state.
 *
 * @param {bigint | null} nextBlock
 * @param {bigint} head
 * @param {{confirmations: bigint, maxBlockRange: bigint}} options
 */
export function planHotLogRange(nextBlock, head, options) {
  if (options.confirmations < 0n || options.maxBlockRange <= 0n) throw new Error('invalid hot log range policy')
  const safeHead = head > options.confirmations ? head - options.confirmations : 0n
  if (nextBlock === null) return { safeHead, initializedNextBlock: safeHead + 1n, range: null }
  if (nextBlock > safeHead) return { safeHead, initializedNextBlock: nextBlock, range: null }
  const toBlock = nextBlock + options.maxBlockRange - 1n < safeHead ? nextBlock + options.maxBlockRange - 1n : safeHead
  return {
    safeHead,
    initializedNextBlock: nextBlock,
    range: { fromBlock: nextBlock, toBlock },
  }
}

/**
 * Keep the latency-sensitive event cursor near the canonical head. Historical
 * catalog cursors retain their own completeness guarantees; this cursor may
 * skip an old interval only when the gap is recorded explicitly.
 *
 * @param {Record<string, any>} cursor
 * @param {bigint} head
 * @param {{confirmations: bigint, maxLagBlocks: bigint, reorgLookback: bigint, observedAt?: string}} options
 */
export function recoverStaleHotCursor(cursor, head, options) {
  if (options.confirmations < 0n || options.maxLagBlocks <= 0n || options.reorgLookback <= 0n) {
    throw new Error('invalid stale hot cursor policy')
  }
  const safeHead = head > options.confirmations ? head - options.confirmations : 0n
  if (cursor?.nextBlock === null || cursor?.nextBlock === undefined) {
    return { cursor: { ...cursor }, safeHead, lagBlocks: 0n, fastForwarded: false, gap: null }
  }
  const nextBlock = BigInt(cursor.nextBlock)
  const lagBlocks = nextBlock <= safeHead ? safeHead - nextBlock + 1n : 0n
  if (lagBlocks <= options.maxLagBlocks) {
    return { cursor: { ...cursor }, safeHead, lagBlocks, fastForwarded: false, gap: null }
  }

  const resumeBlock = safeHead + 1n > options.reorgLookback ? safeHead - options.reorgLookback + 1n : 0n
  if (resumeBlock <= nextBlock) {
    return { cursor: { ...cursor }, safeHead, lagBlocks, fastForwarded: false, gap: null }
  }
  const observedAt = options.observedAt || new Date().toISOString()
  const gap = {
    reason: 'STALE_REALTIME_CURSOR_FAST_FORWARD',
    fromBlock: nextBlock.toString(),
    toBlock: (resumeBlock - 1n).toString(),
    skippedBlocks: (resumeBlock - nextBlock).toString(),
    resumedAtBlock: resumeBlock.toString(),
    safeHead: safeHead.toString(),
    observedAt,
  }
  return {
    cursor: {
      ...cursor,
      nextBlock: resumeBlock.toString(),
      lastProcessedBlock: null,
      lastProcessedBlockHash: null,
      fastForwardCount: Number(cursor.fastForwardCount || 0) + 1,
      skippedRealtimeBlocks: (BigInt(cursor.skippedRealtimeBlocks || 0) + BigInt(gap.skippedBlocks)).toString(),
      lastFastForwardAt: observedAt,
      lastCoverageGap: gap,
      coverageMode: 'REALTIME_WITH_EXPLICIT_GAPS',
    },
    safeHead,
    lagBlocks,
    fastForwarded: true,
    gap,
  }
}

/**
 * Verify the persisted canonical anchor before advancing. A mismatch rewinds a
 * bounded number of blocks and makes the replay explicit.
 *
 * @param {Record<string, any>} cursor
 * @param {string | null} observedHash
 * @param {{startBlock: bigint, reorgLookback: bigint}} options
 * @returns {Record<string, any>}
 */
export function reconcileHotCursorAnchor(cursor, observedHash, options) {
  if (!cursor?.lastProcessedBlock) return { ...cursor, reorgDetected: false }
  if (String(cursor.lastProcessedBlockHash).toLowerCase() === String(observedHash).toLowerCase()) {
    return { ...cursor, reorgDetected: false }
  }
  const last = BigInt(cursor.lastProcessedBlock)
  const rewind = last >= options.reorgLookback ? last - options.reorgLookback + 1n : options.startBlock
  const nextBlock = rewind > options.startBlock ? rewind : options.startBlock
  return {
    ...cursor,
    nextBlock: nextBlock.toString(),
    lastProcessedBlock: null,
    lastProcessedBlockHash: null,
    reorgDetected: true,
    reorgCount: Number(cursor.reorgCount || 0) + 1,
  }
}
