import { RpcErrorClass, classifyRpcError, errorText } from './policy.mjs'

export const EvaluationOutcome = Object.freeze({
  PROFITABLE: 'PROFITABLE',
  VALID_NON_PROFITABLE: 'VALID_NON_PROFITABLE',
  RPC_ERROR: 'RPC_ERROR',
  STATE_UNAVAILABLE: 'STATE_UNAVAILABLE',
  UNSUPPORTED: 'UNSUPPORTED',
  POLICY_FILTERED: 'POLICY_FILTERED',
})

export const EvaluationCoverage = Object.freeze({
  COMPLETE: 'COMPLETE',
  PARTIAL: 'PARTIAL',
  UNAVAILABLE: 'UNAVAILABLE',
  EMPTY: 'EMPTY',
})

/** @type {Set<string>} */
const OUTCOME_VALUES = new Set(Object.values(EvaluationOutcome))
/** @type {Set<string>} */
const AVAILABILITY_OUTCOMES = new Set([EvaluationOutcome.RPC_ERROR, EvaluationOutcome.STATE_UNAVAILABLE])

function boundedReason(value) {
  const reason = String(value || '').trim()
  return reason ? reason.slice(0, 240) : null
}

/** @param {unknown} error */
export function classifyEvaluationFailure(error) {
  const explicitOutcome =
    error && typeof error === 'object' ? String(/** @type {Record<string, any>} */ (error).evaluationOutcome || '') : ''
  if (OUTCOME_VALUES.has(explicitOutcome)) return explicitOutcome
  const rpcClass = classifyRpcError(error)
  if (rpcClass === RpcErrorClass.STATE_NOT_READY) return EvaluationOutcome.STATE_UNAVAILABLE
  if (rpcClass === RpcErrorClass.NETWORK || rpcClass === RpcErrorClass.THROTTLED) {
    return EvaluationOutcome.RPC_ERROR
  }

  const message = errorText(error)
  if (
    /minimum profit|net floor|does not fund|gas limit|risk (?:floor|margin)|policy|slippage|deadline|expired|authorization|budget exhausted|no .*liquidity|no .*inventory|funding (?:unavailable|missing)/i.test(
      message,
    )
  ) {
    return EvaluationOutcome.POLICY_FILTERED
  }
  if (
    /unsupported|not supported|no (?:graph-verified|canonical|executable).*(?:path|route)|invalid (?:plan|route|pool|token)|unknown (?:venue|adapter)|execution reverted|contract function .*reverted/i.test(
      message,
    )
  ) {
    return EvaluationOutcome.UNSUPPORTED
  }

  // An unparsed invariant or contract revert is not evidence of a valid
  // non-profitable quote. Keep it outside the economic result set until the
  // adapter explicitly understands it.
  return EvaluationOutcome.UNSUPPORTED
}

/**
 * Convert one quote call into an economic or availability outcome. A parsed
 * signed result is valid evidence even when it is zero or negative. Any error
 * remains a non-economic outcome and can never be counted as "no profit".
 *
 * @param {{result?: bigint | number | string | null, error?: unknown}} input
 */
export function classifyQuoteOutcome({ result = null, error = null }) {
  if (result !== null && result !== undefined) {
    const value = BigInt(result)
    return {
      outcome: value > 0n ? EvaluationOutcome.PROFITABLE : EvaluationOutcome.VALID_NON_PROFITABLE,
      result: value,
      rpcClass: null,
      reason: null,
    }
  }
  const failure = error || new Error('quote result is unavailable')
  return {
    outcome: classifyEvaluationFailure(failure),
    result: null,
    rpcClass: classifyRpcError(failure),
    reason: boundedReason(errorText(failure)),
  }
}

function normalizedOutcome(record) {
  const candidate = String(record?.outcome || record?.classification || record?.status || '')
  if (OUTCOME_VALUES.has(candidate)) return candidate
  if (candidate === 'GROSS_POSITIVE' || candidate === 'EXACT_NET_POSITIVE') return EvaluationOutcome.PROFITABLE
  if (candidate === 'NO_GROSS_PROFIT' || candidate === 'NO_EXACT_NET_OPPORTUNITY') {
    return EvaluationOutcome.VALID_NON_PROFITABLE
  }
  if (candidate === 'PLAN_REJECTED') return EvaluationOutcome.UNSUPPORTED
  return null
}

/**
 * Produce a bounded, dashboard-safe evidence summary. Availability failures
 * make coverage partial/unavailable, even when another candidate produced a
 * valid non-profitable quote.
 *
 * @param {Array<Record<string, any>>} records
 * @param {{fallbackOutcome?: string, maximumSamples?: number}} [options]
 */
export function summarizeEvaluationOutcomes(records, options = {}) {
  const maximumSamples = Number.isSafeInteger(options.maximumSamples) ? Math.max(0, options.maximumSamples) : 8
  const fallbackOutcome = OUTCOME_VALUES.has(options.fallbackOutcome)
    ? options.fallbackOutcome
    : EvaluationOutcome.STATE_UNAVAILABLE
  const counts = Object.fromEntries(Object.values(EvaluationOutcome).map((outcome) => [outcome, 0]))
  const samples = []
  let classified = 0

  for (const record of Array.isArray(records) ? records : []) {
    const outcome = normalizedOutcome(record)
    if (!outcome) continue
    counts[outcome] += 1
    classified += 1
    if (
      samples.length < maximumSamples &&
      outcome !== EvaluationOutcome.PROFITABLE &&
      outcome !== EvaluationOutcome.VALID_NON_PROFITABLE
    ) {
      samples.push({
        outcome,
        stage: record.stage || null,
        templateId: record.templateId || null,
        fundingMode: record.fundingMode || null,
        rpcClass: record.rpcClass || null,
        reason: boundedReason(record.reason),
      })
    }
  }

  const valid = counts.PROFITABLE + counts.VALID_NON_PROFITABLE
  const unavailable = [...AVAILABILITY_OUTCOMES].reduce((total, outcome) => total + counts[outcome], 0)
  let decisionClassification = fallbackOutcome
  if (counts.PROFITABLE > 0) decisionClassification = EvaluationOutcome.PROFITABLE
  else if (counts.VALID_NON_PROFITABLE > 0) decisionClassification = EvaluationOutcome.VALID_NON_PROFITABLE
  else if (counts.POLICY_FILTERED > 0) decisionClassification = EvaluationOutcome.POLICY_FILTERED
  else if (counts.UNSUPPORTED > 0) decisionClassification = EvaluationOutcome.UNSUPPORTED
  else if (counts.STATE_UNAVAILABLE > 0) decisionClassification = EvaluationOutcome.STATE_UNAVAILABLE
  else if (counts.RPC_ERROR > 0) decisionClassification = EvaluationOutcome.RPC_ERROR

  const coverage =
    classified === 0
      ? EvaluationCoverage.EMPTY
      : unavailable === 0
        ? EvaluationCoverage.COMPLETE
        : valid + counts.POLICY_FILTERED + counts.UNSUPPORTED > 0
          ? EvaluationCoverage.PARTIAL
          : EvaluationCoverage.UNAVAILABLE

  return {
    decisionClassification,
    coverage,
    total: classified,
    valid,
    unavailable,
    counts,
    samples,
  }
}
