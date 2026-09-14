import { AsyncLocalStorage } from 'node:async_hooks'

const context = new AsyncLocalStorage()
const SAFE_LABEL = /^[A-Z][A-Z0-9_]{1,63}$/
const SAFE_METHOD = /^[a-zA-Z][a-zA-Z0-9_]{0,79}$/

export class RpcEvidence {
  constructor() {
    this.total = 0
    this.counts = new Map()
  }

  /** @param {string} client @param {string} purpose @param {string} method */
  record(client, purpose, method) {
    const safeClient = SAFE_LABEL.test(client) ? client : 'UNKNOWN_CLIENT'
    const safePurpose = SAFE_LABEL.test(purpose) ? purpose : 'UNKNOWN_PURPOSE'
    const safeMethod = SAFE_METHOD.test(method) ? method : 'UNKNOWN_METHOD'
    const key = `${safePurpose}|${safeClient}|${safeMethod}`
    this.total += 1
    this.counts.set(key, (this.counts.get(key) || 0) + 1)
  }

  snapshot() {
    const byPurpose = {}
    for (const [key, count] of [...this.counts.entries()].sort(([left], [right]) => left.localeCompare(right))) {
      const [purpose, client, method] = key.split('|')
      byPurpose[purpose] ||= { total: 0, clients: {} }
      byPurpose[purpose].total += count
      byPurpose[purpose].clients[client] ||= {}
      byPurpose[purpose].clients[client][method] = count
    }
    return { total: this.total, byPurpose }
  }
}

/**
 * Attach purpose-only telemetry outside the actual transport. Request params,
 * calldata and endpoint metadata are deliberately never retained.
 *
 * @param {any} transport
 * @param {string} client
 */
export function instrumentRpcTransport(transport, client) {
  if (!SAFE_LABEL.test(client)) throw new Error('RPC evidence client label is invalid')
  return (config) => {
    const instance = transport(config)
    return {
      ...instance,
      request: async (args) => {
        const current = context.getStore()
        if (current?.evidence instanceof RpcEvidence) {
          current.evidence.record(client, current.purpose, String(args?.method || 'UNKNOWN_METHOD'))
        }
        return instance.request(args)
      },
    }
  }
}

/** @param {RpcEvidence} evidence @param {string} purpose @param {() => any} task */
export function withRpcEvidence(evidence, purpose, task) {
  if (!(evidence instanceof RpcEvidence)) throw new Error('RPC evidence instance is required')
  if (!SAFE_LABEL.test(purpose)) throw new Error('RPC evidence purpose is invalid')
  if (typeof task !== 'function') throw new Error('RPC evidence task is required')
  return context.run({ evidence, purpose }, task)
}
