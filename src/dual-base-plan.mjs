import { GENERIC_USDG } from './generic-plan.mjs'
import { buildGenericExecutionCandidates } from './generic-plan.mjs'
import { buildWethExecutionCandidates } from './weth-plan.mjs'

const CANDIDATE_HASH = /^0x[0-9a-f]{64}$/i

function triggerTiming(candidate, options = {}) {
  const nowMs = options.nowMs ?? Date.now()
  const maxAgeMs = options.maxAgeMs ?? 30_000
  if (!Number.isFinite(nowMs)) throw new Error('trigger time must be finite')
  if (!Number.isSafeInteger(maxAgeMs) || maxAgeMs <= 0) throw new Error('trigger max age must be positive')
  const quotedAtMs = Date.parse(candidate?.quotedAt || '')
  if (!Number.isFinite(quotedAtMs)) throw new Error('trigger candidate has no valid quote timestamp')
  if (nowMs - quotedAtMs > maxAgeMs) throw new Error('trigger candidate aged out before exact preflight')
  return { nowMs, maxAgeMs }
}

/**
 * Capture the exact typed candidate revision which caused the live watcher to
 * escalate. The board may publish a newer projection while exact simulation
 * is running; that newer projection must not silently replace this candidate.
 *
 * @param {Record<string, any>} snapshot
 * @param {Record<string, any>} candidate
 * @param {{nowMs?: number, maxAgeMs?: number}} [options]
 */
export function freezeDualExecutionTrigger(snapshot, candidate, options = {}) {
  const boardGeneratedAt = String(snapshot?.generatedAt || '')
  if (!Number.isFinite(Date.parse(boardGeneratedAt))) throw new Error('trigger board has no valid generation timestamp')
  if (!candidate || !CANDIDATE_HASH.test(String(candidate.candidateHash || ''))) {
    throw new Error('trigger candidate has no valid candidate hash')
  }
  const { nowMs } = triggerTiming(candidate, options)
  return Object.freeze({
    schemaVersion: 1,
    handoff: 'FROZEN_WATCH_TRIGGER',
    boardGeneratedAt,
    capturedAt: new Date(nowMs).toISOString(),
    candidateHash: candidate.candidateHash,
    candidate: Object.freeze({ ...candidate }),
  })
}

/**
 * Revalidate a frozen trigger immediately before exact work without consulting
 * a mutable board projection. Canonical quote-block, current-state simulation,
 * nonce, balance, Gas and authorization checks remain separate live gates.
 *
 * @param {Record<string, any>} trigger
 * @param {{nowMs?: number, maxAgeMs?: number}} [options]
 */
export function selectionFromFrozenDualTrigger(trigger, options = {}) {
  if (
    trigger?.schemaVersion !== 1 ||
    trigger?.handoff !== 'FROZEN_WATCH_TRIGGER' ||
    !CANDIDATE_HASH.test(String(trigger?.candidateHash || '')) ||
    trigger?.candidate?.candidateHash !== trigger.candidateHash ||
    !Number.isFinite(Date.parse(trigger?.boardGeneratedAt || ''))
  ) {
    throw new Error('invalid frozen dual execution trigger')
  }
  triggerTiming(trigger.candidate, options)
  return {
    snapshot: {
      generatedAt: trigger.boardGeneratedAt,
      executionHandoff: trigger.handoff,
    },
    candidates: [trigger.candidate],
  }
}

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
