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
 * @param {{priorityIds: string[], positiveStatuses: string[], topRefreshSize: number, batchSize: number, cursor: number}} options
 */
export function selectPeriodicShadowCandidates(catalog, observations, options) {
  const byId = new Map(catalog.map((candidate) => [candidate.id, candidate]))
  const selected = []
  const seen = new Set()
  const add = (candidate) => {
    if (!candidate || seen.has(candidate.id)) return false
    seen.add(candidate.id)
    selected.push(candidate)
    return true
  }

  for (const id of options.priorityIds) add(byId.get(id.toLowerCase()))
  const currentPositive = [...observations.entries()]
    .filter(([, observation]) => options.positiveStatuses.includes(observation.status))
    .sort((left, right) => Number(right[1].screenedNetUsdg) - Number(left[1].screenedNetUsdg))
    .slice(0, options.topRefreshSize)
  for (const [id] of currentPositive) add(byId.get(id))

  let coverageAdded = 0
  for (const candidate of catalog) {
    if (coverageAdded >= options.batchSize) break
    if (!observations.has(candidate.id) && add(candidate)) coverageAdded += 1
  }

  let examined = 0
  while (catalog.length > 0 && coverageAdded < options.batchSize && examined < catalog.length) {
    const candidate = catalog[(options.cursor + examined) % catalog.length]
    examined += 1
    if (add(candidate)) coverageAdded += 1
  }
  const nextCursor = catalog.length > 0 ? (options.cursor + Math.max(examined, options.batchSize)) % catalog.length : 0
  return { selected, nextCursor, coverageAdded }
}

/** @param {Record<string, any>} event */
export function shadowEventId(event) {
  return `${event.transactionHash || event.blockHash || 'block'}:${event.logIndex ?? -1}:${event.type}`
}

export class CandidateWakeQueue {
  constructor(maxRemembered = 20_000) {
    this.maxRemembered = maxRemembered
    this.seen = new Set()
    this.seenOrder = []
    this.pending = new Map()
    this.dedupedEvents = 0
    this.acceptedEvents = 0
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
        })
        continue
      }
      before.lastObservedAtMs = observedAtMs
      before.minBlock = event.blockNumber < before.minBlock ? event.blockNumber : before.minBlock
      before.maxBlock = event.blockNumber > before.maxBlock ? event.blockNumber : before.maxBlock
      before.eventCount += 1
      if (!before.sources.includes(event.type)) before.sources.push(event.type)
    }
    return { accepted: true, candidateCount: uniqueIds.length }
  }

  /** @param {number} limit */
  take(limit) {
    if (!Number.isSafeInteger(limit) || limit <= 0) throw new Error('wake limit must be a positive safe integer')
    const selected = [...this.pending.values()]
      .sort(
        (left, right) =>
          left.firstObservedAtMs - right.firstObservedAtMs || left.candidateId.localeCompare(right.candidateId),
      )
      .slice(0, limit)
    for (const item of selected) this.pending.delete(item.candidateId)
    return {
      candidateIds: selected.map((item) => item.candidateId),
      triggers: selected,
      oldestObservedAtMs: selected.length > 0 ? Math.min(...selected.map((item) => item.firstObservedAtMs)) : null,
    }
  }

  get size() {
    return this.pending.size
  }
}

/**
 * Advance the bounded hot-log poll before consuming an existing quote backlog.
 * The poll may coalesce fresher revisions into the queue or consume a bounded
 * wake itself. A transient poll failure must not prevent already-observed
 * candidates from making progress.
 *
 * The queue is resolved after the poll because a reorg may replace it.
 *
 * @param {{poll: () => Promise<Record<string, any>>, getQueue: () => CandidateWakeQueue, limit: number}} options
 */
export async function pollBeforeDrainingWakeQueue(options) {
  let pollResult = null
  let pollError = null
  try {
    pollResult = await options.poll()
  } catch (error) {
    pollError = error
  }

  const queue = options.getQueue()
  const polledWake = Array.isArray(pollResult?.candidateIds) && pollResult.candidateIds.length > 0
  const wake = polledWake
    ? pollResult
    : queue.size > 0
      ? { ...queue.take(options.limit), catalogRefresh: false, initialized: false }
      : null
  return { pollResult, pollError, wake }
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
    const variants = [observation, ...(observation?.amountQuotes || [])].filter(Boolean)
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
