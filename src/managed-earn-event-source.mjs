const DEFAULT_MAXIMUM_DEDUPE_KEYS = 4_096

function positiveInteger(value, label, maximum) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new RangeError(`${label} must be an integer from 1 to ${maximum}`)
  }
  return value
}

function logKey(log) {
  const block = log?.blockHash || (log?.blockNumber === null || log?.blockNumber === undefined ? null : log.blockNumber)
  const transaction = log?.transactionHash
  const index = log?.logIndex
  if (block === null || block === undefined || !transaction || index === null || index === undefined) {
    throw new Error('managed Earn event lacks canonical block, transaction, or log-index identity')
  }
  return `${String(block).toLowerCase()}:${String(transaction).toLowerCase()}:${String(index)}`
}

function orderedLogs(logs) {
  return [...logs].sort((left, right) => {
    const leftBlock = BigInt(left.blockNumber ?? 0)
    const rightBlock = BigInt(right.blockNumber ?? 0)
    if (leftBlock !== rightBlock) return leftBlock < rightBlock ? -1 : 1
    return Number(left.logIndex ?? 0) - Number(right.logIndex ?? 0)
  })
}

/**
 * A bounded, provider-agnostic adapter around viem's watchEvent. The adapter
 * emits one coalesced wake for each callback and suppresses reconnect replay by
 * canonical log identity without retaining full log payloads.
 */
export class ManagedEarnEventSource {
  /**
   * @param {{client: any, chainId: number, address: string, event: any,
   * eventFilter?: (log: any) => boolean, onWake: (signal: Record<string, any>) => void,
   * onState?: (state: Record<string, any>) => void, errorText?: (error: unknown) => string,
   * maximumDedupeKeys?: number, now?: () => number}} options
   */
  constructor(options) {
    if (
      !options?.client ||
      typeof options.client.getChainId !== 'function' ||
      typeof options.client.watchEvent !== 'function'
    ) {
      throw new Error('managed Earn event source requires a viem-compatible client')
    }
    if (!Number.isSafeInteger(options.chainId) || options.chainId <= 0)
      throw new Error('managed Earn chain id is invalid')
    if (typeof options.onWake !== 'function') throw new Error('managed Earn wake callback is required')
    this.client = options.client
    this.chainId = options.chainId
    this.address = options.address
    this.event = options.event
    this.eventFilter = options.eventFilter || (() => true)
    this.onWake = options.onWake
    this.onState = options.onState || (() => {})
    this.errorText = options.errorText || ((error) => String(error))
    this.maximumDedupeKeys = positiveInteger(
      options.maximumDedupeKeys ?? DEFAULT_MAXIMUM_DEDUPE_KEYS,
      'managed Earn dedupe-key bound',
      100_000,
    )
    this.now = options.now || Date.now
    this.seen = new Map()
    this.unwatch = null
    this.state = {
      policy: 'MANAGED_WSS_EARN_SWAP',
      status: 'IDLE',
      subscribedAt: null,
      lastEventAt: null,
      lastEventBlockNumber: null,
      lastErrorAt: null,
      lastError: null,
      acceptedLogs: 0,
      duplicateLogs: 0,
    }
  }

  publish(patch) {
    this.state = { ...this.state, ...patch }
    this.onState(this.snapshot())
  }

  remember(key) {
    if (this.seen.has(key)) return false
    this.seen.set(key, true)
    while (this.seen.size > this.maximumDedupeKeys) this.seen.delete(this.seen.keys().next().value)
    return true
  }

  handleLogs(logs) {
    const relevant = orderedLogs(Array.isArray(logs) ? logs.filter(this.eventFilter) : [])
    const fresh = []
    let duplicateLogs = 0
    for (const log of relevant) {
      if (this.remember(logKey(log))) fresh.push(log)
      else duplicateLogs += 1
    }
    if (fresh.length === 0) {
      if (duplicateLogs > 0) this.publish({ duplicateLogs: this.state.duplicateLogs + duplicateLogs })
      return
    }
    const latest = fresh.at(-1)
    const sourceReceivedAt = new Date(this.now()).toISOString()
    this.publish({
      status: 'SUBSCRIBED',
      lastEventAt: sourceReceivedAt,
      lastEventBlockNumber: String(latest.blockNumber),
      lastError: null,
      acceptedLogs: this.state.acceptedLogs + fresh.length,
      duplicateLogs: this.state.duplicateLogs + duplicateLogs,
    })
    this.onWake({
      source: 'MANAGED_WSS_EARN_SWAP',
      sourceReceivedAt,
      eventBlockNumber: latest.blockNumber,
      eventTransactionHash: latest.transactionHash,
      eventLogIndex: latest.logIndex,
      eventPool: latest.args?.pool || null,
      eventPools: [...new Set(fresh.map((log) => log.args?.pool).filter(Boolean))],
      coalescedLogCount: fresh.length,
    })
  }

  handleError(error) {
    this.publish({
      status: 'DEGRADED',
      lastErrorAt: new Date(this.now()).toISOString(),
      lastError: this.errorText(error),
    })
  }

  async start() {
    if (this.unwatch) return this.snapshot()
    this.publish({ status: 'CONNECTING' })
    try {
      const observedChainId = await this.client.getChainId()
      if (observedChainId !== this.chainId)
        throw new Error(`managed Earn WSS returned wrong chain id ${observedChainId}`)
      this.unwatch = this.client.watchEvent({
        address: this.address,
        event: this.event,
        poll: false,
        onLogs: (logs) => this.handleLogs(logs),
        onError: (error) => this.handleError(error),
      })
      const subscribedAt = new Date(this.now()).toISOString()
      this.publish({ status: 'SUBSCRIBED', subscribedAt, lastError: null })
      return this.snapshot()
    } catch (error) {
      this.handleError(error)
      throw error
    }
  }

  stop() {
    if (this.unwatch) this.unwatch()
    this.unwatch = null
    this.publish({ status: 'STOPPED' })
  }

  snapshot() {
    return {
      ...this.state,
      subscriptionActive: Boolean(this.unwatch),
      dedupeKeys: this.seen.size,
      maximumDedupeKeys: this.maximumDedupeKeys,
    }
  }
}
