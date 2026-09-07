export const RpcErrorClass = Object.freeze({
  STATE_NOT_READY: 'STATE_NOT_READY',
  THROTTLED: 'THROTTLED',
  NETWORK: 'NETWORK',
  INVARIANT: 'INVARIANT',
})

/** @param {string} value */
export function redactSensitiveText(value) {
  return value.replace(/\b(?:https?|wss?):\/\/[^\s"'<>|]+/gi, '<RPC_URL_REDACTED>')
}

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
  return redactSensitiveText([...new Set(parts)].join(' | ')) || 'UNKNOWN'
}

/** @param {unknown} error */
export function diagnosticErrorText(error) {
  const object = error && typeof error === 'object' ? /** @type {Record<string, any>} */ (error) : null
  return redactSensitiveText(typeof object?.stack === 'string' ? object.stack : errorText(error))
}

/** @param {unknown} error */
function errorIdentity(error) {
  const parts = []
  const visited = new Set()
  let current = error
  for (let depth = 0; current && depth < 8 && !visited.has(current); depth += 1) {
    visited.add(current)
    if (typeof current !== 'object') break
    const object = /** @type {Record<string, any>} */ (current)
    if (typeof object.name === 'string') parts.push(object.name)
    if (typeof object.constructor?.name === 'string') parts.push(object.constructor.name)
    if (object.code !== undefined) parts.push(String(object.code))
    current = object.cause
  }
  return parts.join(' ')
}

/** @param {unknown} error */
export function classifyRpcError(error) {
  const explicitClass = error && typeof error === 'object' ? /** @type {Record<string, any>} */ (error).rpcClass : null
  if (Object.values(RpcErrorClass).includes(explicitClass)) return explicitClass
  const message = errorText(error)
  const identity = errorIdentity(error)
  if (
    /header not found|unknown block|block not found|missing trie node|state .*not available|requested block .*not found/i.test(
      message,
    )
  ) {
    return RpcErrorClass.STATE_NOT_READY
  }
  if (/\b429\b|too many requests|rate.?limit|quota exceeded/i.test(`${message} ${identity}`)) {
    return RpcErrorClass.THROTTLED
  }
  if (/ContractFunctionRevertedError|ExecutionRevertedError/i.test(identity)) return RpcErrorClass.INVARIANT
  if (/RpcRequestError|HttpRequestError|TimeoutError|UnknownRpcError|SocketError/i.test(identity)) {
    return RpcErrorClass.NETWORK
  }
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

/**
 * Detect the viem error shape produced when a JSON-RPC batch response omits
 * an entry. This is transport evidence, not an EVM revert, and is safe to
 * retry through an independent request transport.
 *
 * @param {unknown} error
 */
export function isMalformedRpcBatchResponse(error) {
  if (classifyRpcError(error) !== RpcErrorClass.NETWORK) return false
  return /cannot read properties of undefined \(reading ['"]error['"]\)|malformed (?:json-?rpc )?batch response|missing (?:json-?rpc )?batch response/i.test(
    errorText(error),
  )
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
  'mutation_abandoned',
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
 * Closing an unbroadcast transaction is safe only when its on-chain deadline
 * has expired and two readers independently prove that neither the hash nor
 * its nonce was observed.
 *
 * @param {{kind?: string, deadline?: string | number | bigint, nonce?: string | number}} plan
 * @param {Array<{source: string, receipt?: any, transaction?: any, latestNonce?: number, pendingNonce?: number, head?: bigint, headTimestamp?: string | number | bigint, error?: unknown}>} observations
 */
export function evaluateExpiredMutationAbandonment(plan, observations) {
  if (plan.kind !== 'generic-execute') return { allowed: false, reason: 'unsupported-mutation-kind' }
  if (plan.nonce === undefined || !Number.isSafeInteger(Number(plan.nonce))) {
    return { allowed: false, reason: 'invalid-mutation-nonce' }
  }
  let deadline
  try {
    deadline = BigInt(plan.deadline)
  } catch {
    return { allowed: false, reason: 'invalid-mutation-deadline' }
  }
  if (deadline <= 0n) return { allowed: false, reason: 'invalid-mutation-deadline' }
  const reconciliation = classifyReconciliation(observations, Number(plan.nonce))
  if (reconciliation.state !== 'NOT_OBSERVED') {
    return { allowed: false, reason: `reconciliation-${reconciliation.state.toLowerCase()}` }
  }
  const usable = observations.filter((item) => !item.error)
  try {
    if (usable.some((item) => item.headTimestamp === undefined || BigInt(item.headTimestamp) <= deadline)) {
      return { allowed: false, reason: 'deadline-not-expired-on-every-reader' }
    }
  } catch {
    return { allowed: false, reason: 'invalid-reader-timestamp' }
  }
  return { allowed: true, reason: null }
}

/**
 * Generic execution replay is permitted only while every independent reader's
 * current chain timestamp is still within the signed deadline.
 *
 * @param {{kind?: string, deadline?: string | number | bigint}} plan
 * @param {Array<{source: string, headTimestamp?: string | number | bigint, error?: unknown}>} observations
 */
export function evaluateRawReplayDeadline(plan, observations) {
  if (plan.kind !== 'generic-execute') return { allowed: true, reason: null }
  let deadline
  try {
    deadline = BigInt(plan.deadline)
  } catch {
    return { allowed: false, reason: 'invalid-mutation-deadline' }
  }
  if (deadline <= 0n) return { allowed: false, reason: 'invalid-mutation-deadline' }
  const usable = observations.filter((item) => !item.error)
  if (new Set(usable.map((item) => item.source)).size < 2) {
    return { allowed: false, reason: 'insufficient-reader-timestamps' }
  }
  try {
    if (usable.some((item) => item.headTimestamp === undefined)) {
      return { allowed: false, reason: 'invalid-reader-timestamp' }
    }
    if (usable.some((item) => BigInt(item.headTimestamp) > deadline)) {
      return { allowed: false, reason: 'mutation-deadline-expired' }
    }
  } catch {
    return { allowed: false, reason: 'invalid-reader-timestamp' }
  }
  return { allowed: true, reason: null }
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

/**
 * Paid exact preflights are a separately bounded resource from signed attempts.
 * @param {{maxConfirmedExecutions: number, maxAttempts: number, maxFailedGasWei: string | bigint, maxExactPreflights: number, expiresAt: string}} arm
 * @param {{confirmedExecutions: number, attempts: number, failedGasWei: string | bigint, exactPreflights: number, now?: number}} usage
 */
export function evaluateGenericArmBudget(arm, usage) {
  const transactionBudget = evaluateArmBudget(arm, usage)
  if (!transactionBudget.allowed) return transactionBudget
  if (!Number.isSafeInteger(arm.maxExactPreflights) || arm.maxExactPreflights <= 0) {
    return { allowed: false, reason: 'invalid-exact-preflight-limit' }
  }
  if (usage.exactPreflights >= arm.maxExactPreflights) {
    return { allowed: false, reason: 'exact-preflight-limit' }
  }
  return { allowed: true, reason: null }
}

/**
 * A just-persisted signed attempt already consumes one attempt slot. At the
 * final broadcast boundary, treat only that exact latest unresolved mutation
 * as the attempt currently in flight instead of rejecting it as a new sixth
 * attempt. All other arm budgets remain unchanged.
 *
 * @param {{authorizationId?: string, maxConfirmedExecutions: number, maxAttempts: number, maxFailedGasWei: string | bigint, maxExactPreflights: number, expiresAt: string}} arm
 * @param {{confirmedExecutions: number, attempts: number, failedGasWei: string | bigint, exactPreflights: number, now?: number}} usage
 * @param {Array<Record<string, any>>} records
 * @param {{authorizationId: string, kind: string, intentId: string, planHash: string, hash: string, nonce: number | string}} currentSignedAttempt
 */
export function evaluateGenericArmBudgetAtBroadcast(arm, usage, records, currentSignedAttempt) {
  const mismatch = () => ({ allowed: false, reason: 'signed-attempt-reservation-mismatch' })
  if (
    !currentSignedAttempt ||
    currentSignedAttempt.authorizationId !== arm.authorizationId ||
    currentSignedAttempt.kind !== 'generic-execute' ||
    !Number.isSafeInteger(usage.attempts) ||
    usage.attempts <= 0
  ) {
    return mismatch()
  }

  const matchesAttempt = (record) =>
    record.event === 'mutation_signed' &&
    record.authorizationId === currentSignedAttempt.authorizationId &&
    record.kind === currentSignedAttempt.kind &&
    record.intentId === currentSignedAttempt.intentId &&
    record.planHash === currentSignedAttempt.planHash &&
    record.hash === currentSignedAttempt.hash &&
    String(record.nonce) === String(currentSignedAttempt.nonce)

  const authorizedAttempts = records.filter(
    (record) =>
      record.event === 'mutation_signed' &&
      record.authorizationId === arm.authorizationId &&
      record.kind === 'generic-execute',
  )
  const matchingAttempts = authorizedAttempts.filter(matchesAttempt)
  const unresolved = latestUnresolvedMutation(records)
  if (
    usage.attempts !== authorizedAttempts.length ||
    matchingAttempts.length !== 1 ||
    authorizedAttempts.at(-1) !== matchingAttempts[0] ||
    !unresolved ||
    !matchesAttempt(unresolved)
  ) {
    return mismatch()
  }

  return evaluateGenericArmBudget(arm, { ...usage, attempts: usage.attempts - 1 })
}

/**
 * Select from an already validated, board-ranked candidate set without making
 * an RPC call. Exact simulation remains mandatory before signing.
 * @param {Array<Record<string, any>>} candidates
 * @param {{minimumScreenedNetProfit: bigint, maxPrincipal: bigint, attemptedOpportunityIds?: Iterable<string>}} policy
 */
export function selectGenericWatchCandidate(candidates, policy) {
  const attempted = new Set(policy.attemptedOpportunityIds || [])
  for (const candidate of candidates) {
    if (attempted.has(candidate.opportunityId)) continue
    if (BigInt(candidate.amountIn) > policy.maxPrincipal) continue
    if (BigInt(candidate.screenedNetProfit) < policy.minimumScreenedNetProfit) continue
    return candidate
  }
  return null
}

/** @param {unknown} error */
export function isGenericOpportunityMiss(error) {
  const message = errorText(error)
  return /snapshot has no fresh|quote is stale|no screened candidate passed exact executor preflight|selected route and amount left|triggered candidate left|principal below candidate amount|exact simulation does not meet the net floor|gross profit cannot fund|protected max fee is below|worst-case gas cost breaks|wallet cannot fund worst-case gas|wallet ETH reserve failed immediately before signing/i.test(
    message,
  )
}

/**
 * Enforce one nonce-writing lane per wallet. Corrupt active-arm or lock state
 * is a conflict, not an invitation to guess that the other signer is idle.
 *
 * @param {{arm?: Record<string, any> | null, lockExists: boolean, lockPid?: number | null, nowMs?: number, processIsAlive: (pid: number) => boolean}} input
 */
function signerLaneConflict(input, lane) {
  const nowMs = input.nowMs ?? Date.now()
  if (input.arm?.status === 'ARMED') {
    const expiresAt = Date.parse(input.arm.expiresAt)
    if (!Number.isFinite(expiresAt)) return `the ${lane} signing arm has an invalid expiry`
    if (nowMs < expiresAt) return `the ${lane} signing arm is still active`
  }
  if (!input.lockExists) return null
  if (!Number.isSafeInteger(input.lockPid) || input.lockPid <= 0) return `the ${lane} watcher lock is malformed`
  if (input.processIsAlive(input.lockPid)) return `the ${lane} watcher is still running as PID ${input.lockPid}`
  return null
}

export function fixedSignerLaneConflict(input) {
  return signerLaneConflict(input, 'fixed-route')
}

export function genericSignerLaneConflict(input) {
  return signerLaneConflict(input, 'generic-v2')
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
