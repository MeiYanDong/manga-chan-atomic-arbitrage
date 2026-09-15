import { GLOBAL_SETTLEMENT_READ_POLICY } from './global-settlement-assets.mjs'

async function mapWithConcurrency(items, concurrency, task) {
  if (!Array.isArray(items)) throw new Error('bounded RPC workset must be an array')
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
    throw new Error('bounded RPC concurrency must be a positive safe integer')
  }
  if (typeof task !== 'function') throw new Error('bounded RPC task must be a function')
  const output = new Array(items.length)
  let cursor = 0
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      for (;;) {
        const index = cursor++
        if (index >= items.length) return
        output[index] = await task(items[index], index)
      }
    }),
  )
  return output
}

export async function settleConcurrentReads(promises) {
  if (!Array.isArray(promises) || promises.length === 0) {
    throw new Error('concurrent RPC read group must be a non-empty array')
  }
  const settled = await Promise.allSettled(promises)
  const failure = settled.find((result) => result.status === 'rejected')
  if (failure) throw failure.reason
  return settled.map((result) => {
    if (result.status !== 'fulfilled') throw result.reason
    return result.value
  })
}

export function mapSettlementFundingCandidates(candidates, task) {
  return mapWithConcurrency(candidates, GLOBAL_SETTLEMENT_READ_POLICY.fundingCandidateConcurrency, task)
}

export function mapSettlementValuationPaths(paths, task) {
  return mapWithConcurrency(paths, GLOBAL_SETTLEMENT_READ_POLICY.maximumLogicalConcurrency, task)
}
