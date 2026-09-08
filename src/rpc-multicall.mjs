/**
 * Execute bounded Multicall groups and verify every failed subcall through the
 * original direct read. A direct transient failure stops further fallbacks so
 * one provider outage cannot fan out into a request storm.
 *
 * @param {{
 *   contracts: Record<string, any>[],
 *   maxCalls: number,
 *   readBatch: (contracts: Record<string, any>[]) => Promise<Record<string, any>[]>,
 *   readDirect: (contract: Record<string, any>) => Promise<any>,
 *   isTransient: (error: unknown) => boolean,
 * }} options
 */
export async function readWithBoundedMulticall(options) {
  const { contracts, maxCalls, readBatch, readDirect, isTransient } = options
  if (!Number.isSafeInteger(maxCalls) || maxCalls < 1) throw new Error('multicall maxCalls must be a positive integer')

  const results = []
  const stats = {
    batchRequests: 0,
    batchedSubcalls: 0,
    failedSubcalls: 0,
    aggregateFailures: 0,
    directFallbacks: 0,
    directRecoveries: 0,
    transientStops: 0,
  }

  for (let offset = 0; offset < contracts.length; offset += maxCalls) {
    const chunk = contracts.slice(offset, offset + maxCalls)
    stats.batchRequests += 1
    stats.batchedSubcalls += chunk.length

    let batchResults
    try {
      batchResults = await readBatch(chunk)
    } catch (error) {
      batchResults = chunk.map(() => ({ status: 'failure', error }))
    }
    if (!Array.isArray(batchResults) || batchResults.length !== chunk.length) {
      throw new Error('multicall result count mismatch')
    }

    const failures = batchResults.filter((item) => item?.status !== 'success')
    stats.failedSubcalls += failures.length
    const firstError = failures[0]?.error
    if (failures.length === chunk.length && chunk.length > 1 && failures.every((item) => item.error === firstError)) {
      stats.aggregateFailures += 1
    }

    for (let index = 0; index < chunk.length; index += 1) {
      const item = batchResults[index]
      if (item?.status === 'success') {
        results.push(item)
        continue
      }

      stats.directFallbacks += 1
      try {
        const result = await readDirect(chunk[index])
        results.push({ status: 'success', result })
        stats.directRecoveries += 1
      } catch (error) {
        results.push({ status: 'failure', error })
        if (!isTransient(error)) continue

        stats.transientStops += 1
        for (let remainder = index + 1; remainder < chunk.length; remainder += 1) {
          results.push(
            batchResults[remainder]?.status === 'success' ? batchResults[remainder] : { status: 'failure', error },
          )
        }
        for (let remainder = offset + chunk.length; remainder < contracts.length; remainder += 1) {
          results.push({ status: 'failure', error })
        }
        return { results, stats }
      }
    }
  }

  return { results, stats }
}
