import { GENERIC_USDG } from './generic-plan.mjs'
import { buildGenericExecutionCandidates } from './generic-plan.mjs'
import { buildWethExecutionCandidates } from './weth-plan.mjs'

/**
 * Merge independently validated USDG and WETH candidates, then rank them in a
 * common conservative USDG unit. A missing lane is non-fatal; malformed rows
 * never enter the returned set.
 *
 * @param {Record<string, any>} snapshot
 * @param {{nowMs?: number, maxAgeMs?: number, limit?: number}} [options]
 */
export function buildDualBaseExecutionCandidates(snapshot, options = {}) {
  const limit = options.limit ?? 6
  if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 32) throw new Error('candidate limit must be in 1..32')
  const laneLimit = Math.min(32, Math.max(limit, 6))
  const usdg = optionalLane(() =>
    buildGenericExecutionCandidates(snapshot, { ...options, limit: laneLimit }).map((candidate) => ({
      ...candidate,
      baseAsset: 'USDG',
      baseToken: GENERIC_USDG,
      baseDecimals: 6,
      normalizedScreenedNetUsdg: candidate.screenedNetProfit,
    })),
  )
  const weth = optionalLane(() => buildWethExecutionCandidates(snapshot, { ...options, limit: laneLimit }))
  const candidates = [...usdg, ...weth]
  candidates.sort((left, right) => {
    if (left.normalizedScreenedNetUsdg !== right.normalizedScreenedNetUsdg) {
      return left.normalizedScreenedNetUsdg > right.normalizedScreenedNetUsdg ? -1 : 1
    }
    if (left.expectedGrossProfit !== right.expectedGrossProfit) {
      return left.expectedGrossProfit > right.expectedGrossProfit ? -1 : 1
    }
    if (left.baseAsset !== right.baseAsset) return left.baseAsset === 'WETH' ? -1 : 1
    return left.amountIn < right.amountIn ? -1 : left.amountIn > right.amountIn ? 1 : 0
  })
  if (candidates.length === 0) throw new Error('snapshot has no fresh typed dual-base screened-positive candidate')
  return candidates.slice(0, limit)
}

/** @param {() => Record<string, any>[]} operation */
function optionalLane(operation) {
  try {
    return operation()
  } catch (error) {
    if (/no fresh|no reviewed WETH base schema/.test(String(error?.message || error))) return []
    throw error
  }
}
