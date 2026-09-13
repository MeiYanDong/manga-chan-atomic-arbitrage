import { fallback, http } from 'viem'

const DEFAULT_BATCH_SIZE = 32
const DEFAULT_BATCH_WAIT_MS = 10
const DEFAULT_TIMEOUT_MS = 30_000
const RETRYABLE_HTTP_STATUSES = new Set([408, 425, 429])
const RATE_LIMIT_RPC_CODES = new Set([429, -32_005])
const RATE_LIMIT_MESSAGE = /rate[ -]?limit|too many requests|request limit|quota (?:exceeded|reached)/i
const MISSING_BATCH_ITEM_MESSAGE = /Cannot read properties of undefined \(reading ['"]error['"]\)/
const VIEM_HTTP_TRANSPORT_FRAME = /[/\\]viem[/\\].*[/\\]clients[/\\]transports[/\\]http\.(?:js|ts):/

/** @param {unknown} value @param {string} label */
function rpcEndpoint(value, label) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} RPC endpoint is required`)
  const endpoint = new URL(value)
  if (!['http:', 'https:'].includes(endpoint.protocol)) throw new Error(`${label} RPC endpoint must use HTTP or HTTPS`)
  return endpoint.href
}

/** @param {any} error */
export function shouldFallbackToManagedRpc(error) {
  const seen = new Set()
  let current = error
  for (let depth = 0; depth < 6 && current && typeof current === 'object' && !seen.has(current); depth += 1) {
    seen.add(current)
    if (current.name === 'TimeoutError' || current.name === 'SocketClosedError') return true
    if (current.name === 'ResponseBodyTooLargeError') return true
    if (
      current.name === 'TypeError' &&
      MISSING_BATCH_ITEM_MESSAGE.test(String(current.message || '')) &&
      VIEM_HTTP_TRANSPORT_FRAME.test(String(current.stack || ''))
    ) {
      return true
    }
    if (current.name === 'HttpRequestError') {
      const status = Number(current.status)
      if (!Number.isFinite(status) || RETRYABLE_HTTP_STATUSES.has(status) || status >= 500) return true
    }
    const code = Number(current.code)
    if (Number.isFinite(code) && RATE_LIMIT_RPC_CODES.has(code)) return true
    if (
      current.name === 'RpcRequestError' &&
      RATE_LIMIT_MESSAGE.test(String(current.details || current.message || ''))
    ) {
      return true
    }
    current = current.cause
  }
  return false
}

/**
 * Keep broad discovery on the public endpoint while retaining a bounded
 * managed fallback for transport and rate-limit failures. Deterministic EVM
 * reverts are not retried by viem's fallback transport.
 *
 * Both lanes batch concurrent JSON-RPC calls. This reduces HTTP request fanout
 * without changing the logical call count or the fixed-block evidence model.
 *
 * @param {string} publicRpcUrl
 * @param {string | null | undefined} managedRpcUrl
 * @param {{batchSize?: number, batchWaitMs?: number, timeoutMs?: number,
 * managedFetchFn?: typeof globalThis.fetch}} [options]
 */
export function publicFirstRpcTransport(publicRpcUrl, managedRpcUrl, options = {}) {
  const primaryUrl = rpcEndpoint(publicRpcUrl, 'public')
  const secondaryUrl = managedRpcUrl ? rpcEndpoint(managedRpcUrl, 'managed fallback') : null
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE
  const batchWaitMs = options.batchWaitMs ?? DEFAULT_BATCH_WAIT_MS
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 1_000) {
    throw new RangeError('RPC batch size must be an integer from 1 to 1000')
  }
  if (!Number.isSafeInteger(batchWaitMs) || batchWaitMs < 0 || batchWaitMs > 1_000) {
    throw new RangeError('RPC batch wait must be an integer from 0 to 1000 milliseconds')
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) {
    throw new RangeError('RPC timeout must be an integer from 1 to 120000 milliseconds')
  }
  const transportConfig = {
    batch: { batchSize, wait: batchWaitMs },
    timeout: timeoutMs,
    retryCount: 0,
  }
  const primary = http(primaryUrl, {
    ...transportConfig,
    key: 'public-rpc-primary',
    name: 'Public RPC primary',
  })
  if (!secondaryUrl || secondaryUrl === primaryUrl) return primary
  const secondary = http(secondaryUrl, {
    ...transportConfig,
    ...(options.managedFetchFn ? { fetchFn: options.managedFetchFn } : {}),
    key: 'managed-rpc-fallback',
    name: 'Managed RPC fallback',
  })
  return fallback([primary, secondary], {
    key: 'public-first-rpc',
    name: 'Public-first RPC with managed fallback',
    rank: false,
    retryCount: 0,
    shouldThrow: (error) => !shouldFallbackToManagedRpc(error),
  })
}
