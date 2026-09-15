import { mergePendingMarketSignals } from './feed-signal-coalescer.mjs'
import { redactSensitiveText } from './policy.mjs'
import { ResidentGlobalSearchClient } from './resident-global-search.mjs'

export const EARN_SEARCH_WORKER_POLICY = 'RESIDENT_SIGNER_FREE_EARN_SEARCH_V1'
export const EARN_SEARCH_PROTOCOL_VERSION = 1
export const EARN_SEARCH_NEGATIVE_MAX_AGE_MS = 15_000

const MAXIMUM_LINE_BYTES = 1_000_000
const MAXIMUM_QUARANTINED_ROUTES = 128
const ADDRESS = /^0x[0-9a-f]{40}$/i
const HASH = /^0x[0-9a-f]{64}$/i
const ROUTE_ID = /^EARN_DYNAMIC_[0-9A-F]{16}$/
const SAFE_ENVIRONMENT_KEYS = new Set([
  'PATH',
  'LANG',
  'LC_ALL',
  'TZ',
  'MANGA_RUN_DIR',
  'EARN_LIVE_MIN_NET_WETH',
  'EARN_LIVE_MIN_HEADROOM_WETH',
  'EARN_LIVE_MAX_FAILED_GAS_WETH',
  'EARN_LIVE_WALLET_RESERVE_WETH',
  'EARN_LIVE_COARSE_PROBE_POINTS',
  'EARN_LIVE_REFINEMENT_POINTS',
])

function validRequestId(value) {
  return /^[A-Za-z0-9:_-]{1,160}$/.test(String(value || ''))
}

function decimalString(value, label, { nullable = false } = {}) {
  if (nullable && (value === null || value === undefined || value === '')) return null
  const normalized = typeof value === 'bigint' ? value.toString() : String(value ?? '')
  if (!/^\d+$/.test(normalized)) throw new Error(`${label} must be a non-negative decimal integer`)
  return normalized
}

function normalizedAddresses(values) {
  const unique = new Set((values || []).map((value) => String(value || '').toLowerCase()).filter(Boolean))
  if ([...unique].some((value) => !ADDRESS.test(value))) throw new Error('Earn search wake contains an invalid pool')
  if (unique.size > 128) throw new Error('Earn search wake exceeds its pool bound')
  return [...unique].sort()
}

function sanitizeSearchContext(context) {
  const excludedRouteIds = [...new Set((context?.excludedRouteIds || []).map(String))].sort()
  if (
    excludedRouteIds.length > MAXIMUM_QUARANTINED_ROUTES ||
    excludedRouteIds.some((routeId) => !ROUTE_ID.test(routeId))
  ) {
    throw new Error('Earn search quarantine context is invalid')
  }
  return {
    earnGasSurplusWei: decimalString(context?.earnGasSurplusWei, 'Earn search gas surplus'),
    excludedRouteIds,
  }
}

export function sanitizeEarnSearchSignal(signal) {
  const merged = mergePendingMarketSignals(null, signal || {})
  const eventPools = normalizedAddresses([...(merged.eventPools || []), merged.eventPool].filter(Boolean))
  const eventTransactionHash = merged.eventTransactionHash ? String(merged.eventTransactionHash).toLowerCase() : null
  if (eventTransactionHash && !HASH.test(eventTransactionHash)) {
    throw new Error('Earn search wake transaction hash is invalid')
  }
  return {
    sourceReceivedAt: merged.sourceReceivedAt,
    receivedAt: merged.receivedAt,
    latestReceivedAt: merged.latestReceivedAt,
    firstSequenceNumber: merged.firstSequenceNumber,
    lastSequenceNumber: merged.lastSequenceNumber,
    messageCount: merged.messageCount,
    matchedAddresses: normalizedAddresses(merged.matchedAddresses),
    routeAddresses: normalizedAddresses(merged.routeAddresses),
    classificationReasons: merged.classificationReasons,
    classificationReason: merged.classificationReason,
    wakeSources: merged.wakeSources,
    wakeSource: merged.wakeSource,
    duplicateMessages: merged.duplicateMessages,
    overlappingFrame: merged.overlappingFrame,
    outOfOrderFrame: merged.outOfOrderFrame,
    sequenceGap: merged.sequenceGap,
    coalescedWakeCount: merged.coalescedWakeCount,
    eventBlockNumber: decimalString(merged.eventBlockNumber, 'Earn search event block', { nullable: true }),
    eventTransactionHash,
    eventLogIndex: decimalString(merged.eventLogIndex, 'Earn search event log index', { nullable: true }),
    eventPools,
    eventPool: eventPools[0] || null,
    searchContext: sanitizeSearchContext(merged.searchContext),
  }
}

export function buildEarnSearchWorkerEnvironment(environment = process.env) {
  const output = {}
  for (const [key, value] of Object.entries(environment || {})) {
    if (SAFE_ENVIRONMENT_KEYS.has(key) && value !== undefined) output[key] = value
  }
  output.MANGA_CONFIG_FILE = '/dev/null'
  output.GLOBAL_LIVE_ARM = '0'
  output.EARN_LIVE_ARM = '0'
  output.EARN_SEARCH_READ_ONLY = '1'
  output.NODE_OPTIONS = '--max-old-space-size=128 --max-semi-space-size=8'
  return output
}

export function encodeEarnSearchRequest(requestId, signal) {
  if (!validRequestId(requestId)) throw new Error('Earn search request id is invalid')
  const value = JSON.stringify({
    schemaVersion: EARN_SEARCH_PROTOCOL_VERSION,
    type: 'EARN_SEARCH',
    requestId,
    signal: sanitizeEarnSearchSignal(signal),
  })
  if (Buffer.byteLength(value) > MAXIMUM_LINE_BYTES) throw new Error('Earn search request exceeds its bound')
  return value
}

export function parseEarnSearchRequest(line) {
  if (Buffer.byteLength(String(line)) > MAXIMUM_LINE_BYTES) throw new Error('Earn search request exceeds its bound')
  const parsed = JSON.parse(String(line))
  if (
    parsed?.schemaVersion !== EARN_SEARCH_PROTOCOL_VERSION ||
    parsed?.type !== 'EARN_SEARCH' ||
    !validRequestId(parsed?.requestId)
  ) {
    throw new Error('Earn search request envelope is invalid')
  }
  return {
    schemaVersion: EARN_SEARCH_PROTOCOL_VERSION,
    type: 'EARN_SEARCH',
    requestId: parsed.requestId,
    signal: sanitizeEarnSearchSignal(parsed.signal),
  }
}

export function encodeEarnSearchResult(requestId, result) {
  if (!validRequestId(requestId)) throw new Error('Earn search result id is invalid')
  const value = JSON.stringify(
    {
      schemaVersion: EARN_SEARCH_PROTOCOL_VERSION,
      type: 'EARN_SEARCH_RESULT',
      requestId,
      completedAt: new Date().toISOString(),
      result,
    },
    (_key, item) => (typeof item === 'bigint' ? item.toString() : item),
  )
  if (Buffer.byteLength(value) > MAXIMUM_LINE_BYTES) throw new Error('Earn search result exceeds its bound')
  return value
}

export function parseEarnSearchResult(line) {
  if (Buffer.byteLength(String(line)) > MAXIMUM_LINE_BYTES) throw new Error('Earn search result exceeds its bound')
  const parsed = JSON.parse(String(line))
  if (
    parsed?.schemaVersion !== EARN_SEARCH_PROTOCOL_VERSION ||
    parsed?.type !== 'EARN_SEARCH_RESULT' ||
    !validRequestId(parsed?.requestId) ||
    !Number.isFinite(Date.parse(String(parsed?.completedAt || ''))) ||
    !parsed?.result ||
    typeof parsed.result !== 'object'
  ) {
    throw new Error('Earn search result envelope is invalid')
  }
  return parsed
}

export function classifyEarnSearchHandoff(
  result,
  { now = Date.now(), maximumNegativeAgeMs = EARN_SEARCH_NEGATIVE_MAX_AGE_MS, requiresLegacySearch = false } = {},
) {
  const report = result?.report
  const completedAt = Date.parse(String(result?.completedAt || ''))
  const ageMs = now - completedAt
  if (requiresLegacySearch || !report || typeof report !== 'object' || !Number.isFinite(completedAt) || ageMs < 0) {
    return { mode: 'LEGACY_PREFLIGHT', report: null, candidateHint: null, ageMs: null }
  }
  if (result.status === 'SHOT_READY' && report.status === 'SHOT_READY' && result.candidateHint) {
    return { mode: 'LIVE_REVALIDATION', report, candidateHint: result.candidateHint, ageMs }
  }
  if (
    result.status === 'NO_SHOT' &&
    report.status === 'NO_SHOT' &&
    result.evidenceCoverage === 'COMPLETE' &&
    ageMs <= maximumNegativeAgeMs
  ) {
    return { mode: 'REUSE_READ_ONLY_RESULT', report, candidateHint: null, ageMs }
  }
  return { mode: 'LEGACY_PREFLIGHT', report, candidateHint: null, ageMs }
}

export function encodeEarnLiveRevalidationInput(result) {
  const handoff = classifyEarnSearchHandoff(result)
  if (handoff.mode !== 'LIVE_REVALIDATION') throw new Error('Earn live revalidation requires a positive search hint')
  const value = JSON.stringify(
    {
      schemaVersion: EARN_SEARCH_PROTOCOL_VERSION,
      type: 'EARN_LIVE_REVALIDATION',
      completedAt: result.completedAt,
      publicScreenReport: handoff.report,
      candidateHint: handoff.candidateHint,
    },
    (_key, item) => (typeof item === 'bigint' ? item.toString() : item),
  )
  if (Buffer.byteLength(value) > MAXIMUM_LINE_BYTES) throw new Error('Earn live revalidation input exceeds its bound')
  return value
}

export function parseEarnLiveRevalidationInput(value) {
  if (Buffer.byteLength(String(value)) > MAXIMUM_LINE_BYTES) {
    throw new Error('Earn live revalidation input exceeds its bound')
  }
  const parsed = JSON.parse(String(value))
  if (
    parsed?.schemaVersion !== EARN_SEARCH_PROTOCOL_VERSION ||
    parsed?.type !== 'EARN_LIVE_REVALIDATION' ||
    !Number.isFinite(Date.parse(String(parsed?.completedAt || ''))) ||
    parsed?.publicScreenReport?.status !== 'SHOT_READY' ||
    !parsed?.candidateHint ||
    typeof parsed.candidateHint !== 'object'
  ) {
    throw new Error('Earn live revalidation envelope is invalid')
  }
  return parsed
}

export class ResidentEarnSearchClient extends ResidentGlobalSearchClient {
  constructor(options) {
    super({
      ...options,
      environmentBuilder: buildEarnSearchWorkerEnvironment,
      signalSanitizer: sanitizeEarnSearchSignal,
      requestEncoder: encodeEarnSearchRequest,
      resultParser: parseEarnSearchResult,
      workerPolicy: EARN_SEARCH_WORKER_POLICY,
      requestPrefix: 'earn-search',
      workerLabel: 'Earn search worker',
    })
  }
}

export function earnSearchWorkerFailure(error) {
  return redactSensitiveText(error instanceof Error ? error.message : String(error)).slice(0, 240)
}
