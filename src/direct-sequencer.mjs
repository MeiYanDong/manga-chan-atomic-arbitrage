import { keccak256 } from 'viem'

export const ROBINHOOD_DIRECT_SEQUENCER_URL = 'https://sequencer.mainnet.chain.robinhood.com'

function safeError(value) {
  return String(value instanceof Error ? value.message : value)
    .replace(/https?:\/\/[^\s]+/gi, '[endpoint]')
    .slice(0, 300)
}

/** @param {(input: any, init: any) => Promise<any>} fetchImpl */
async function submit(fetchImpl, endpoint, serializedTransaction, expectedHash, timeoutMs) {
  const controller = new globalThis.AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_sendRawTransaction',
        params: [serializedTransaction],
      }),
      signal: controller.signal,
    })
    const body = await response.json()
    if (typeof body?.result === 'string') {
      if (body.result.toLowerCase() !== expectedHash.toLowerCase()) {
        throw new Error('broadcast endpoint returned a different transaction hash')
      }
      return { status: 'ACCEPTED', hash: body.result }
    }
    const message = safeError(body?.error?.message || `HTTP ${response.status}`)
    if (/already known|known transaction|nonce too low/i.test(message)) {
      return { status: 'MAY_ALREADY_BE_KNOWN', hash: expectedHash, error: message }
    }
    return { status: 'REJECTED', hash: expectedHash, error: message }
  } catch (error) {
    return { status: 'TRANSPORT_UNKNOWN', hash: expectedHash, error: safeError(error) }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Submit one already-persisted signed raw transaction directly to the
 * sequencer. A managed fallback is allowed only with the identical bytes.
 */
/**
 * @param {{serializedTransaction: string, managedRpcUrl?: string | null, sequencerUrl?: string,
 * fetchImpl?: (input: any, init: any) => Promise<any>, timeoutMs?: number}} options
 */
export async function broadcastSameRawToSequencer({
  serializedTransaction,
  managedRpcUrl,
  sequencerUrl = ROBINHOOD_DIRECT_SEQUENCER_URL,
  fetchImpl = globalThis.fetch,
  timeoutMs = 5_000,
}) {
  if (!/^0x[0-9a-f]+$/i.test(serializedTransaction) || serializedTransaction.length % 2 !== 0) {
    throw new Error('serialized transaction is invalid')
  }
  const raw = /** @type {`0x${string}`} */ (serializedTransaction)
  const hash = keccak256(raw)
  const direct = await submit(fetchImpl, sequencerUrl, serializedTransaction, hash, timeoutMs)
  if (direct.status === 'ACCEPTED') return { hash, direct, fallback: null }
  if (!managedRpcUrl) return { hash, direct, fallback: null }
  const fallback = await submit(fetchImpl, managedRpcUrl, serializedTransaction, hash, timeoutMs)
  return { hash, direct, fallback }
}
