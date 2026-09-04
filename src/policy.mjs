export const RpcErrorClass = Object.freeze({
  STATE_NOT_READY: 'STATE_NOT_READY',
  THROTTLED: 'THROTTLED',
  NETWORK: 'NETWORK',
  INVARIANT: 'INVARIANT',
})

/** @param {unknown} error */
export function errorText(error) {
  const parts = []
  const visited = new Set()
  let current = error
  for (let depth = 0; current && depth < 6 && !visited.has(current); depth += 1) {
    visited.add(current)
    if (typeof current === 'string') {
      parts.push(current)
      break
    }
    if (typeof current === 'object') {
      const object = /** @type {Record<string, any>} */ (current)
      for (const key of ['shortMessage', 'message', 'details']) {
        const value = object[key]
        if (typeof value === 'string') parts.push(value)
      }
      current = object.cause
    } else {
      parts.push(String(current))
      break
    }
  }
  return [...new Set(parts)].join(' | ') || 'UNKNOWN'
}

/** @param {unknown} error */
export function classifyRpcError(error) {
  const explicitClass = error && typeof error === 'object' ? /** @type {Record<string, any>} */ (error).rpcClass : null
  if (Object.values(RpcErrorClass).includes(explicitClass)) return explicitClass
  const message = errorText(error)
  if (
    /header not found|unknown block|block not found|missing trie node|state .*not available|requested block .*not found/i.test(
      message,
    )
  ) {
    return RpcErrorClass.STATE_NOT_READY
  }
  if (/\b429\b|too many requests|rate.?limit|quota exceeded/i.test(message)) return RpcErrorClass.THROTTLED
  if (
    /timeout|timed out|econnreset|econnrefused|fetch failed|network|socket|websocket|http request failed|rpc request failed/i.test(
      message,
    )
  ) {
    return RpcErrorClass.NETWORK
  }
  return RpcErrorClass.INVARIANT
}

/** @param {unknown} error */
export function isTransientRpcError(error) {
  return classifyRpcError(error) !== RpcErrorClass.INVARIANT
}

/** @param {string} leg @param {unknown} error */
export function quoteFailure(leg, error) {
  return { leg, class: classifyRpcError(error), message: errorText(error) }
}

const SIGNED_EVENTS = new Map([
  ['mutation_signed', null],
  ['execution_signed', 'execute'],
  ['deployment_signed', 'deploy'],
  ['withdrawal_signed', 'withdraw'],
])

const TERMINAL_EVENTS = new Set([
  'mutation_effect',
  'mutation_reverted',
  'execution_complete',
  'execution_reverted',
  'deployment_complete',
  'deployment_recovered',
  'deployment_reverted',
  'withdrawal_complete',
  'withdrawal_reverted',
])

/** @param {Array<Record<string, any>>} records */
export function latestUnresolvedMutation(records) {
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index]
    if (!SIGNED_EVENTS.has(record.event) || !record.hash) continue
    const terminal = records
      .slice(index + 1)
      .some((candidate) => TERMINAL_EVENTS.has(candidate.event) && candidate.hash === record.hash)
    if (!terminal) return { ...record, kind: record.kind || SIGNED_EVENTS.get(record.event) }
  }
  return null
}

/**
 * @param {Array<{source: string, receipt?: any, transaction?: any, latestNonce?: number, pendingNonce?: number, head?: bigint, error?: unknown}>} observations
 * @param {number} nonce
 * @param {number} minConfirmations
 */
export function classifyReconciliation(observations, nonce, minConfirmations = 3) {
  const usable = observations.filter((item) => !item.error)
  const receipts = usable
    .filter((item) => item.receipt)
    .map((item) => ({ source: item.source, ...item.receipt, head: item.head }))
  if (receipts.length > 1) {
    const first = receipts[0]
    const conflict = receipts.some(
      (item) =>
        item.transactionHash?.toLowerCase() !== first.transactionHash?.toLowerCase() ||
        item.blockHash?.toLowerCase() !== first.blockHash?.toLowerCase() ||
        item.status !== first.status,
    )
    if (conflict) return { state: 'CONFLICT', reason: 'providers returned conflicting receipts', receipts }
  }
  if (receipts.length > 0) {
    const receipt = receipts[0]
    const head = BigInt(receipt.head)
    const blockNumber = BigInt(receipt.blockNumber)
    const confirmations = head >= blockNumber ? Number(head - blockNumber + 1n) : 0
    const prefix = receipt.status === 'success' ? 'SUCCESS' : 'REVERTED'
    return {
      state: confirmations >= minConfirmations ? `CONFIRMED_${prefix}` : `PROVISIONAL_${prefix}`,
      receipt,
      confirmations,
    }
  }
  if (usable.some((item) => item.transaction))
    return { state: 'PENDING', reason: 'transaction is visible without a receipt' }
  if (usable.some((item) => Number(item.latestNonce) > nonce)) {
    return { state: 'NONCE_CONFLICT', reason: 'wallet nonce advanced without the planned receipt' }
  }
  if (
    new Set(usable.map((item) => item.source)).size >= 2 &&
    usable.every((item) => Number(item.latestNonce) <= nonce && Number(item.pendingNonce) <= nonce)
  ) {
    return { state: 'NOT_OBSERVED', reason: 'two independent readers see neither transaction nor consumed nonce' }
  }
  return { state: 'UNKNOWN', reason: 'insufficient independent evidence' }
}

/**
 * @param {{maxConfirmedExecutions: number, maxAttempts: number, maxFailedGasWei: string | bigint, expiresAt: string}} arm
 * @param {{confirmedExecutions: number, attempts: number, failedGasWei: string | bigint, now?: number}} usage
 */
export function evaluateArmBudget(arm, usage) {
  const now = usage.now ?? Date.now()
  if (!Number.isFinite(Date.parse(arm.expiresAt)) || now >= Date.parse(arm.expiresAt))
    return { allowed: false, reason: 'expired' }
  if (usage.confirmedExecutions >= arm.maxConfirmedExecutions)
    return { allowed: false, reason: 'confirmed-execution-limit' }
  if (usage.attempts >= arm.maxAttempts) return { allowed: false, reason: 'attempt-limit' }
  if (BigInt(usage.failedGasWei) >= BigInt(arm.maxFailedGasWei)) return { allowed: false, reason: 'failed-gas-limit' }
  return { allowed: true, reason: null }
}

export class EventRevisionQueue {
  constructor(maxRemembered = 10_000) {
    this.maxRemembered = maxRemembered
    this.seen = new Set()
    this.seenOrder = []
    this.pending = null
    this.waiters = []
  }

  /** @param {{blockNumber: bigint, transactionHash?: string | null, logIndex?: number | null, source: string}} event */
  offer(event) {
    const id = `${event.transactionHash || 'block'}:${event.logIndex ?? -1}:${event.source}`
    if (this.seen.has(id)) return false
    this.seen.add(id)
    this.seenOrder.push(id)
    while (this.seenOrder.length > this.maxRemembered) this.seen.delete(this.seenOrder.shift())

    if (!this.pending) {
      this.pending = { minBlock: event.blockNumber, maxBlock: event.blockNumber, count: 1, sources: [event.source] }
    } else {
      this.pending.minBlock = event.blockNumber < this.pending.minBlock ? event.blockNumber : this.pending.minBlock
      this.pending.maxBlock = event.blockNumber > this.pending.maxBlock ? event.blockNumber : this.pending.maxBlock
      this.pending.count += 1
      if (!this.pending.sources.includes(event.source)) this.pending.sources.push(event.source)
    }
    this.flushWaiters()
    return true
  }

  take() {
    const value = this.pending
    this.pending = null
    return value
  }

  /** @param {number} timeoutMs */
  async wait(timeoutMs) {
    const current = this.take()
    if (current) return current
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        const index = this.waiters.findIndex((item) => item.resolve === resolve)
        if (index >= 0) this.waiters.splice(index, 1)
        resolve(null)
      }, timeoutMs)
      this.waiters.push({ resolve, timer })
    })
  }

  flushWaiters() {
    if (!this.pending || this.waiters.length === 0) return
    const waiter = this.waiters.shift()
    clearTimeout(waiter.timer)
    waiter.resolve(this.take())
  }
}
