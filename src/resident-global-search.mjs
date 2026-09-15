import { spawn } from 'node:child_process'

import { retryReadOnly } from './event-driven-shadow.mjs'
import { EARN_PARTIAL_CATALOG_RETENTION_POLICY } from './earnonhood-onchain-catalog.mjs'
import { mergePendingMarketSignals } from './feed-signal-coalescer.mjs'
import { isTransientRpcError, redactSensitiveText } from './policy.mjs'
import {
  ROBINHOOD_CATALOG_MULTICALL_POLICY,
  ROBINHOOD_PARTIAL_CATALOG_RETENTION_POLICY,
} from './robinhood-uniswap-catalog.mjs'

export const GLOBAL_SEARCH_WORKER_POLICY = 'RESIDENT_SIGNER_FREE_EVENT_SEARCH_V1'
export const GLOBAL_SEARCH_PROTOCOL_VERSION = 1
export const GLOBAL_SEARCH_NEGATIVE_MAX_AGE_MS = 15_000
export const GLOBAL_SEARCH_POSITIVE_MAX_AGE_MS = 60_000
export const GLOBAL_CATALOG_MAX_AGE_MS = 6 * 60 * 60 * 1_000
export const GLOBAL_CATALOG_REFRESH_INTERVAL_MS = 15 * 60 * 1_000
export const GLOBAL_CATALOG_CRITICAL_READ_POLICY = Object.freeze({
  version: 'DIRECT_PUBLIC_CRITICAL_READ_RETRY_V1',
  attempts: 3,
  delayMs: 1_000,
  transport: 'OFFICIAL_PUBLIC_NON_BATCHED',
})
export const GLOBAL_CATALOG_BULK_READ_POLICY = Object.freeze({
  version: ROBINHOOD_CATALOG_MULTICALL_POLICY.version,
  transport: 'OFFICIAL_PUBLIC_NON_BATCHED',
  maximumSubcallsPerRequest: ROBINHOOD_CATALOG_MULTICALL_POLICY.maximumSubcallsPerRequest,
  concurrency: ROBINHOOD_CATALOG_MULTICALL_POLICY.concurrency,
  maximumAttempts: ROBINHOOD_CATALOG_MULTICALL_POLICY.maximumAttempts,
  minimumRequestIntervalMs: ROBINHOOD_CATALOG_MULTICALL_POLICY.minimumRequestIntervalMs,
  retryBaseDelayMs: ROBINHOOD_CATALOG_MULTICALL_POLICY.retryBaseDelayMs,
  runtimeCodeHash: ROBINHOOD_CATALOG_MULTICALL_POLICY.runtimeCodeHash,
})
export const GLOBAL_CATALOG_MAINTENANCE_POLICY = Object.freeze({
  version: 'SIGNER_FREE_PUBLIC_CATALOG_MAINTENANCE_V7',
  refreshIntervalMs: GLOBAL_CATALOG_REFRESH_INTERVAL_MS,
  maximumAgeMs: GLOBAL_CATALOG_MAX_AGE_MS,
  writer: 'DEDICATED_SYSTEMD_ONESHOT',
  readPath: 'ATOMIC_CACHE_ONLY',
  rpc: 'OFFICIAL_PUBLIC_ONLY',
  partialRefresh: ROBINHOOD_PARTIAL_CATALOG_RETENTION_POLICY.version,
  earnPartialRefresh: EARN_PARTIAL_CATALOG_RETENTION_POLICY.version,
  criticalRead: GLOBAL_CATALOG_CRITICAL_READ_POLICY.version,
  bulkRead: GLOBAL_CATALOG_BULK_READ_POLICY.version,
})

/**
 * @param {() => Promise<any>} operation
 * @param {{onRetry?: (error: unknown, attempt: number) => void}} [options]
 */
export async function readGlobalCatalogCritical(operation, { onRetry } = {}) {
  let retries = 0
  const value = await retryReadOnly(operation, {
    attempts: GLOBAL_CATALOG_CRITICAL_READ_POLICY.attempts,
    delayMs: GLOBAL_CATALOG_CRITICAL_READ_POLICY.delayMs,
    shouldRetry: isTransientRpcError,
    onRetry: (error, attempt) => {
      retries += 1
      onRetry?.(error, attempt)
    },
  })
  return { value, retries }
}

export function assertGlobalCatalogMaintenanceBoundary(environment = process.env) {
  if (environment.GLOBAL_CATALOG_REFRESH_ALLOWED !== '1') {
    throw new Error('global catalog refresh requires the explicit maintenance command boundary')
  }
}

const MAXIMUM_LINE_BYTES = 1_000_000
const RESTART_DELAY_MS = 1_000
const MAXIMUM_CATALOG_CLOCK_SKEW_MS = 60_000
const ADDRESS = /^0x[0-9a-f]{40}$/i
const HASH = /^0x[0-9a-f]{64}$/i
const SAFE_ROUTE_ID = /^[A-Za-z0-9_-]{1,160}$/
const SAFE_OPPORTUNITY_KIND = /^[A-Z0-9_]{1,120}$/
const SAFE_ENVIRONMENT_KEYS = new Set([
  'PATH',
  'LANG',
  'LC_ALL',
  'TZ',
  'MANGA_RUN_DIR',
  'MANGA_GLOBAL_UNIVERSE_PATH',
  'MANGA_GENERIC_MIN_NET_USDG',
  'GLOBAL_EXTRA_SETTLEMENT_ASSETS',
  'GLOBAL_MAX_ROUTES_PER_WAKE',
  'GLOBAL_QUOTE_CONCURRENCY',
])

function safeError(error) {
  return redactSensitiveText(error instanceof Error ? error.message : String(error)).slice(0, 240)
}

function validRequestId(value) {
  return /^[A-Za-z0-9:_-]{1,160}$/.test(String(value || ''))
}

function validPoolObservation(pool, observations, maximumAgeMs, now) {
  const verifiedAt = Date.parse(String(pool?.lastVerifiedAt || ''))
  const age = now - verifiedAt
  return (
    observations.includes(pool?.catalogObservation) &&
    Number.isFinite(verifiedAt) &&
    age >= -MAXIMUM_CATALOG_CLOCK_SKEW_MS &&
    age <= maximumAgeMs
  )
}

function validEarnCatalogReadEvidence(catalog, now) {
  const pools = catalog?.earn?.pools
  const retention = catalog?.earn?.readEvidence?.topologyRetention
  if (!Array.isArray(pools)) return false
  const counts = [retention?.freshPools, retention?.retainedPools, retention?.expiredPools].map(Number)
  const observedFresh = pools.filter((pool) => pool.catalogObservation === 'CURRENT_FIXED_BLOCK_POOL_READ').length
  const observedRetained = pools.length - observedFresh
  return (
    retention?.policy === EARN_PARTIAL_CATALOG_RETENTION_POLICY.version &&
    counts.every((value) => Number.isSafeInteger(value) && value >= 0) &&
    counts[0] === observedFresh &&
    counts[1] === observedRetained &&
    pools.every((pool) =>
      validPoolObservation(
        pool,
        ['CURRENT_FIXED_BLOCK_POOL_READ', 'RETAINED_AFTER_CURRENT_TRANSIENT_POOL_READ_FAILURE'],
        EARN_PARTIAL_CATALOG_RETENTION_POLICY.maximumAgeMs,
        now,
      ),
    )
  )
}

function validCatalogBulkReadEvidence(catalog, requestedPairs, requestedV3FeeQueries) {
  const evidence = catalog?.uniswap?.readEvidence?.bulkRead
  const rpcRequests = Number(evidence?.rpcRequests)
  const retries = Number(evidence?.retries)
  const transientFailures = Number(evidence?.transientFailures)
  const embeddedTransientBatches = Number(evidence?.embeddedTransientBatches)
  const subcalls = Number(evidence?.subcalls)
  const maximum = ROBINHOOD_CATALOG_MULTICALL_POLICY.maximumSubcallsPerRequest
  const minimumRequests = Math.ceil(requestedPairs / maximum) + Math.ceil(requestedV3FeeQueries / maximum)
  const baseRequests = rpcRequests - retries
  const maximumBaseRequests = minimumRequests * 2
  const maximumRequests = maximumBaseRequests * ROBINHOOD_CATALOG_MULTICALL_POLICY.maximumAttempts
  const minimumSubcalls = requestedPairs + requestedV3FeeQueries
  const maximumSubcalls = minimumSubcalls * 2
  return (
    evidence?.policy === ROBINHOOD_CATALOG_MULTICALL_POLICY.version &&
    evidence?.multicallCodeHash === ROBINHOOD_CATALOG_MULTICALL_POLICY.runtimeCodeHash &&
    evidence?.maximumAttempts === ROBINHOOD_CATALOG_MULTICALL_POLICY.maximumAttempts &&
    evidence?.minimumRequestIntervalMs === ROBINHOOD_CATALOG_MULTICALL_POLICY.minimumRequestIntervalMs &&
    evidence?.retryBaseDelayMs === ROBINHOOD_CATALOG_MULTICALL_POLICY.retryBaseDelayMs &&
    Number.isSafeInteger(rpcRequests) &&
    rpcRequests >= minimumRequests &&
    rpcRequests <= maximumRequests &&
    Number.isSafeInteger(retries) &&
    retries >= 0 &&
    baseRequests >= minimumRequests &&
    baseRequests <= maximumBaseRequests &&
    retries <= baseRequests * (ROBINHOOD_CATALOG_MULTICALL_POLICY.maximumAttempts - 1) &&
    Number.isSafeInteger(transientFailures) &&
    transientFailures >= retries &&
    transientFailures <= rpcRequests &&
    Number.isSafeInteger(embeddedTransientBatches) &&
    embeddedTransientBatches >= 0 &&
    embeddedTransientBatches <= transientFailures &&
    Number.isSafeInteger(subcalls) &&
    subcalls >= minimumSubcalls &&
    subcalls <= maximumSubcalls
  )
}

function validCatalogReadEvidence(catalog, now) {
  const evidence = catalog?.uniswap?.readEvidence
  const requestedPairs = Number(evidence?.requestedPairs)
  const requestedV3FeeQueries = Number(evidence?.requestedV3FeeQueries)
  const v2TransportErrors = Number(evidence?.v2TransportErrors)
  const v3TransportErrors = Number(evidence?.v3TransportErrors)
  if (
    ![requestedPairs, requestedV3FeeQueries, v2TransportErrors, v3TransportErrors].every(
      (value) => Number.isSafeInteger(value) && value >= 0,
    ) ||
    v2TransportErrors > requestedPairs ||
    v3TransportErrors > requestedV3FeeQueries
  ) {
    return false
  }
  const complete = v2TransportErrors + v3TransportErrors === 0
  if (evidence?.complete !== complete || evidence?.status !== (complete ? 'COMPLETE' : 'PARTIAL')) return false
  if (catalog?.schemaVersion === 1) return true
  if (![2, 3, 4].includes(catalog?.schemaVersion)) return false
  const retention = evidence.topologyRetention
  const counts = [
    retention?.freshV2Pools,
    retention?.freshV3Pools,
    retention?.retainedV2Pools,
    retention?.retainedV3Pools,
    retention?.expiredV2Pools,
    retention?.expiredV3Pools,
  ].map(Number)
  const v2Pools = catalog.uniswap.v2Pools
  const v3Pools = catalog.uniswap.v3Pools
  const observedPools = [...v2Pools, ...v3Pools]
  const validPoolEvidence = observedPools.every((pool) =>
    validPoolObservation(
      pool,
      ['CURRENT_FIXED_BLOCK_READ', 'RETAINED_AFTER_CURRENT_TRANSIENT_QUERY_FAILURE'],
      ROBINHOOD_PARTIAL_CATALOG_RETENTION_POLICY.maximumAgeMs,
      now,
    ),
  )
  const observedFreshV2 = v2Pools.filter((pool) => pool.catalogObservation === 'CURRENT_FIXED_BLOCK_READ').length
  const observedFreshV3 = v3Pools.filter((pool) => pool.catalogObservation === 'CURRENT_FIXED_BLOCK_READ').length
  const observedRetainedV2 = v2Pools.length - observedFreshV2
  const observedRetainedV3 = v3Pools.length - observedFreshV3
  const validUniswapEvidence =
    retention?.policy === ROBINHOOD_PARTIAL_CATALOG_RETENTION_POLICY.version &&
    counts.every((value) => Number.isSafeInteger(value) && value >= 0) &&
    counts[0] === observedFreshV2 &&
    counts[1] === observedFreshV3 &&
    counts[2] === observedRetainedV2 &&
    counts[3] === observedRetainedV3 &&
    validPoolEvidence
  const validEarnEvidence = catalog.schemaVersion === 2 || validEarnCatalogReadEvidence(catalog, now)
  const validBulkEvidence =
    catalog.schemaVersion !== 4 || validCatalogBulkReadEvidence(catalog, requestedPairs, requestedV3FeeQueries)
  return validUniswapEvidence && validEarnEvidence && validBulkEvidence
}

export function classifyGlobalCatalogAccess(catalog, { now = Date.now() } = {}) {
  const generatedAt = Date.parse(catalog?.generatedAt)
  const age = now - generatedAt
  const current =
    [1, 2, 3, 4].includes(catalog?.schemaVersion) &&
    Array.isArray(catalog?.earn?.pools) &&
    Array.isArray(catalog?.uniswap?.v2Pools) &&
    Array.isArray(catalog?.uniswap?.v3Pools) &&
    Array.isArray(catalog?.uniswap?.v4Pools) &&
    validCatalogReadEvidence(catalog, now) &&
    Number.isFinite(now) &&
    Number.isFinite(generatedAt) &&
    age >= -MAXIMUM_CATALOG_CLOCK_SKEW_MS &&
    age <= GLOBAL_CATALOG_MAX_AGE_MS
  return current ? 'CACHE' : 'UNAVAILABLE'
}

function sanitizeSignal(signal) {
  const merged = mergePendingMarketSignals(null, signal || {})
  return {
    sourceReceivedAt: merged.sourceReceivedAt,
    receivedAt: merged.receivedAt,
    latestReceivedAt: merged.latestReceivedAt,
    firstSequenceNumber: merged.firstSequenceNumber,
    lastSequenceNumber: merged.lastSequenceNumber,
    messageCount: merged.messageCount,
    matchedAddresses: merged.matchedAddresses,
    routeAddresses: merged.routeAddresses,
    classificationReasons: merged.classificationReasons,
    classificationReason: merged.classificationReason,
    wakeSources: merged.wakeSources,
    wakeSource: merged.wakeSource,
    duplicateMessages: merged.duplicateMessages,
    overlappingFrame: merged.overlappingFrame,
    outOfOrderFrame: merged.outOfOrderFrame,
    sequenceGap: merged.sequenceGap,
    coalescedWakeCount: merged.coalescedWakeCount,
  }
}

export function buildGlobalSearchWorkerEnvironment(environment = process.env) {
  const output = {}
  for (const [key, value] of Object.entries(environment || {})) {
    if (SAFE_ENVIRONMENT_KEYS.has(key) && value !== undefined) output[key] = value
  }
  // Keep this worker on the official public reader. Paid/exact transport and
  // its durable budget stay inside the existing signer child.
  delete output.MANGA_RPC_URL
  delete output.MANGA_READ_RPC_URL
  delete output.MANGA_WS_URL
  output.GLOBAL_LIVE_ARM = '0'
  output.EARN_LIVE_ARM = '0'
  output.GLOBAL_SEARCH_READONLY_CATALOG = '1'
  output.MANGA_CONFIG_FILE = '/dev/null'
  output.NODE_OPTIONS = '--max-old-space-size=128 --max-semi-space-size=8'
  return output
}

export function encodeGlobalSearchRequest(requestId, signal) {
  if (!validRequestId(requestId)) throw new Error('global search request id is invalid')
  return JSON.stringify({
    schemaVersion: GLOBAL_SEARCH_PROTOCOL_VERSION,
    type: 'SEARCH',
    requestId,
    signal: sanitizeSignal(signal),
  })
}

export function parseGlobalSearchRequest(line) {
  if (Buffer.byteLength(String(line)) > MAXIMUM_LINE_BYTES) throw new Error('global search request exceeds its bound')
  const parsed = JSON.parse(String(line))
  if (
    parsed?.schemaVersion !== GLOBAL_SEARCH_PROTOCOL_VERSION ||
    parsed?.type !== 'SEARCH' ||
    !validRequestId(parsed?.requestId)
  ) {
    throw new Error('global search request envelope is invalid')
  }
  return {
    schemaVersion: GLOBAL_SEARCH_PROTOCOL_VERSION,
    type: 'SEARCH',
    requestId: parsed.requestId,
    signal: sanitizeSignal(parsed.signal),
  }
}

export function encodeGlobalSearchResult(requestId, result) {
  if (!validRequestId(requestId)) throw new Error('global search result id is invalid')
  const value = JSON.stringify(
    {
      schemaVersion: GLOBAL_SEARCH_PROTOCOL_VERSION,
      type: 'SEARCH_RESULT',
      requestId,
      completedAt: new Date().toISOString(),
      result,
    },
    (_key, item) => (typeof item === 'bigint' ? item.toString() : item),
  )
  if (Buffer.byteLength(value) > MAXIMUM_LINE_BYTES) throw new Error('global search result exceeds its bound')
  return value
}

export function parseGlobalSearchResult(line) {
  if (Buffer.byteLength(String(line)) > MAXIMUM_LINE_BYTES) throw new Error('global search result exceeds its bound')
  const parsed = JSON.parse(String(line))
  if (
    parsed?.schemaVersion !== GLOBAL_SEARCH_PROTOCOL_VERSION ||
    parsed?.type !== 'SEARCH_RESULT' ||
    !validRequestId(parsed?.requestId) ||
    !parsed?.result ||
    typeof parsed.result !== 'object'
  ) {
    throw new Error('global search result envelope is invalid')
  }
  return parsed
}

function decimalString(value, label) {
  const normalized = typeof value === 'bigint' ? value.toString() : String(value ?? '')
  if (!/^\d{1,80}$/.test(normalized)) throw new Error(`${label} must be a bounded non-negative decimal integer`)
  return normalized
}

function boundedEvidenceString(value, label, maximum = 240) {
  const normalized = String(value || '')
  if (!normalized || normalized.length > maximum || /[\r\n]|(?:https?|wss?):\/\//i.test(normalized)) {
    throw new Error(`${label} is invalid`)
  }
  return normalized
}

export function normalizeGlobalCandidateHint(value) {
  if (!value || typeof value !== 'object' || value.schemaVersion !== GLOBAL_SEARCH_PROTOCOL_VERSION) {
    throw new Error('global candidate hint schema is invalid')
  }
  const generatedAt = String(value.generatedAt || '')
  if (!Number.isFinite(Date.parse(generatedAt))) throw new Error('global candidate hint timestamp is invalid')
  const graphCommitment = String(value.graphCommitment || '').toLowerCase()
  const settlementToken = String(value.settlementToken || '').toLowerCase()
  const templateId = String(value.templateId || '')
  const opportunityKind = String(value.opportunityKind || '')
  const fundingMode = String(value.fundingMode || '')
  const routeType = String(value.routeType || '')
  const edgeIds = Array.isArray(value.edgeIds) ? value.edgeIds.map((item) => String(item).toLowerCase()) : null
  if (!HASH.test(graphCommitment)) throw new Error('global candidate graph commitment is invalid')
  if (!ADDRESS.test(settlementToken)) throw new Error('global candidate settlement token is invalid')
  if (!SAFE_ROUTE_ID.test(templateId)) throw new Error('global candidate route id is invalid')
  if (!SAFE_OPPORTUNITY_KIND.test(opportunityKind)) throw new Error('global candidate kind is invalid')
  if (!['BPT', 'CYCLE'].includes(routeType) || !edgeIds) throw new Error('global candidate route type is invalid')
  if (
    (routeType === 'BPT' && edgeIds.length !== 0) ||
    (routeType === 'CYCLE' && (edgeIds.length < 2 || edgeIds.length > 5)) ||
    edgeIds.some((item) => !HASH.test(item)) ||
    new Set(edgeIds).size !== edgeIds.length
  ) {
    throw new Error('global candidate edge evidence is invalid')
  }
  if (!['MORPHO_FLASH', 'EXECUTOR_INVENTORY'].includes(fundingMode)) {
    throw new Error('global candidate funding mode is invalid')
  }
  return {
    schemaVersion: GLOBAL_SEARCH_PROTOCOL_VERSION,
    generatedAt,
    graphCommitment,
    catalogVersion: boundedEvidenceString(value.catalogVersion, 'global candidate catalog version'),
    stateBlockNumber: decimalString(value.stateBlockNumber, 'global candidate state block'),
    templateId,
    opportunityKind,
    routeType,
    edgeIds,
    settlementToken,
    principal: decimalString(value.principal, 'global candidate principal'),
    fundingMode,
  }
}

export function buildGlobalCandidateHint(prepared) {
  const selected = prepared?.selected
  const snapshot = prepared?.snapshot
  if (!selected || snapshot?.status !== 'EXACT_NET_POSITIVE') return null
  return normalizeGlobalCandidateHint({
    schemaVersion: GLOBAL_SEARCH_PROTOCOL_VERSION,
    generatedAt: snapshot.generatedAt,
    graphCommitment: snapshot.graph?.commitment,
    catalogVersion: snapshot.lifecycle?.catalogVersion,
    stateBlockNumber: snapshot.lifecycle?.state?.blockNumber,
    templateId: selected.templateId,
    opportunityKind: selected.opportunityKind,
    routeType: selected.route?.type,
    edgeIds: selected.route?.type === 'CYCLE' ? selected.route.cycle?.edges?.map((edge) => edge.id) : [],
    settlementToken: selected.settlementToken,
    principal: selected.principal,
    fundingMode: selected.fundingMode,
  })
}

export function classifyGlobalSearchHandoff(
  result,
  {
    requiresLegacySearch = false,
    now = Date.now(),
    maximumNegativeAgeMs = GLOBAL_SEARCH_NEGATIVE_MAX_AGE_MS,
    maximumPositiveAgeMs = GLOBAL_SEARCH_POSITIVE_MAX_AGE_MS,
  } = {},
) {
  const snapshot = result?.snapshot
  const completedAt = Date.parse(String(result?.completedAt || ''))
  const ageMs = now - completedAt
  if (
    requiresLegacySearch ||
    !snapshot ||
    typeof snapshot !== 'object' ||
    typeof snapshot.status !== 'string' ||
    !Number.isFinite(completedAt) ||
    ageMs < 0
  ) {
    return { mode: 'LEGACY_PREFLIGHT', snapshot: null, ageMs: null }
  }
  if (
    snapshot.status === 'EXACT_NET_POSITIVE' &&
    snapshot.evidenceCoverage === 'COMPLETE' &&
    ageMs <= maximumPositiveAgeMs
  ) {
    try {
      const candidateHint = normalizeGlobalCandidateHint(result.candidateHint)
      if (
        candidateHint.generatedAt !== snapshot.generatedAt ||
        candidateHint.graphCommitment !== String(snapshot.graph?.commitment || '').toLowerCase() ||
        candidateHint.catalogVersion !== snapshot.lifecycle?.catalogVersion ||
        candidateHint.stateBlockNumber !== String(snapshot.lifecycle?.state?.blockNumber || '')
      ) {
        throw new Error('global candidate hint does not match its search snapshot')
      }
      return { mode: 'LIVE_REVALIDATION', snapshot, candidateHint, ageMs }
    } catch {
      return { mode: 'LEGACY_PREFLIGHT', snapshot, candidateHint: null, ageMs }
    }
  }
  if (
    snapshot.status === 'NO_EXACT_NET_OPPORTUNITY' &&
    snapshot.evidenceCoverage === 'COMPLETE' &&
    ageMs <= maximumNegativeAgeMs
  ) {
    return { mode: 'REUSE_READ_ONLY_RESULT', snapshot, ageMs }
  }
  return { mode: 'LEGACY_PREFLIGHT', snapshot, ageMs }
}

export function encodeGlobalLiveRevalidationInput(result) {
  const handoff = classifyGlobalSearchHandoff(result)
  if (handoff.mode !== 'LIVE_REVALIDATION') throw new Error('global live revalidation requires a fresh positive hint')
  const value = JSON.stringify({
    schemaVersion: GLOBAL_SEARCH_PROTOCOL_VERSION,
    type: 'GLOBAL_LIVE_REVALIDATION',
    completedAt: result.completedAt,
    snapshot: handoff.snapshot,
    candidateHint: handoff.candidateHint,
  })
  if (Buffer.byteLength(value) > MAXIMUM_LINE_BYTES) throw new Error('global live revalidation input exceeds its bound')
  return value
}

export function parseGlobalLiveRevalidationInput(value, { now = Date.now() } = {}) {
  if (Buffer.byteLength(String(value)) > MAXIMUM_LINE_BYTES) {
    throw new Error('global live revalidation input exceeds its bound')
  }
  const parsed = JSON.parse(String(value))
  if (parsed?.schemaVersion !== GLOBAL_SEARCH_PROTOCOL_VERSION || parsed?.type !== 'GLOBAL_LIVE_REVALIDATION') {
    throw new Error('global live revalidation envelope is invalid')
  }
  const handoff = classifyGlobalSearchHandoff(
    {
      completedAt: parsed.completedAt,
      snapshot: parsed.snapshot,
      candidateHint: parsed.candidateHint,
    },
    { now },
  )
  if (handoff.mode !== 'LIVE_REVALIDATION') throw new Error('global live revalidation evidence is stale or invalid')
  return {
    schemaVersion: GLOBAL_SEARCH_PROTOCOL_VERSION,
    type: 'GLOBAL_LIVE_REVALIDATION',
    completedAt: parsed.completedAt,
    snapshot: handoff.snapshot,
    candidateHint: handoff.candidateHint,
  }
}

export class ResidentGlobalSearchClient {
  /**
   * @param {{scriptPath: string, cwd: string, environment?: NodeJS.ProcessEnv,
   * timeoutMs: number, onResult: (value: any) => void, onFailure: (value: any) => void,
   * spawnProcess?: (...args: any[]) => any, environmentBuilder?: (environment: NodeJS.ProcessEnv) => NodeJS.ProcessEnv,
   * signalSanitizer?: (signal: any) => any, requestEncoder?: (requestId: string, signal: any) => string,
   * resultParser?: (line: string) => any, workerPolicy?: string, requestPrefix?: string, workerLabel?: string}} options
   */
  constructor({
    scriptPath,
    cwd,
    environment,
    timeoutMs,
    onResult,
    onFailure,
    spawnProcess = spawn,
    environmentBuilder = buildGlobalSearchWorkerEnvironment,
    signalSanitizer = sanitizeSignal,
    requestEncoder = encodeGlobalSearchRequest,
    resultParser = parseGlobalSearchResult,
    workerPolicy = GLOBAL_SEARCH_WORKER_POLICY,
    requestPrefix = 'global-search',
    workerLabel = 'global search worker',
  }) {
    if (!scriptPath || !cwd) throw new Error('global search worker paths are required')
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 180_000) {
      throw new Error('global search worker timeout is invalid')
    }
    if (typeof onResult !== 'function' || typeof onFailure !== 'function') {
      throw new Error('global search worker callbacks are required')
    }
    this.scriptPath = scriptPath
    this.cwd = cwd
    if (
      typeof environmentBuilder !== 'function' ||
      typeof signalSanitizer !== 'function' ||
      typeof requestEncoder !== 'function' ||
      typeof resultParser !== 'function'
    ) {
      throw new Error('resident search worker protocol functions are required')
    }
    if (!validRequestId(`${requestPrefix}-1`) || typeof workerPolicy !== 'string' || !workerPolicy) {
      throw new Error('resident search worker identity is invalid')
    }
    this.environment = environmentBuilder(environment)
    this.timeoutMs = timeoutMs
    this.onResult = onResult
    this.onFailure = onFailure
    this.spawnProcess = spawnProcess
    this.signalSanitizer = signalSanitizer
    this.requestEncoder = requestEncoder
    this.resultParser = resultParser
    this.workerPolicy = workerPolicy
    this.requestPrefix = requestPrefix
    this.workerLabel = workerLabel
    this.child = null
    this.inFlight = null
    this.pendingSignal = null
    this.lineBuffer = ''
    this.deadline = null
    this.restartTimer = null
    this.stopped = false
    this.sequence = 0
    this.generation = 0
    this.state = 'STOPPED'
    this.lastError = null
    this.startedAt = null
    this.completed = 0
    this.failures = 0
    this.restarts = 0
    this.coalesced = 0
  }

  start() {
    if (this.stopped) return false
    if (this.child) return true
    this.state = 'STARTING'
    this.generation += 1
    const generation = this.generation
    let child
    try {
      child = this.spawnProcess(process.execPath, [this.scriptPath], {
        cwd: this.cwd,
        env: this.environment,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    } catch (error) {
      this.#degrade(error)
      return false
    }
    this.child = child
    this.lineBuffer = ''
    this.state = 'RUNNING'
    this.startedAt ||= new Date().toISOString()
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => this.#consume(String(chunk), generation))
    child.stderr.on('data', (chunk) => {
      const diagnostic = safeError(String(chunk).trim())
      if (diagnostic) this.lastError = diagnostic
    })
    child.once('error', (error) => this.#workerFailed(error, generation))
    child.once('close', (code, signal) => {
      if (this.stopped || generation !== this.generation) return
      this.#workerFailed(new Error(`${this.workerLabel} exited (${code ?? signal ?? 'unknown'})`), generation)
    })
    if (this.pendingSignal && !this.inFlight) {
      const pending = this.pendingSignal
      this.pendingSignal = null
      this.#dispatch(pending)
    }
    return true
  }

  enqueue(signal) {
    if (this.stopped) return false
    let normalized
    try {
      normalized = this.signalSanitizer(signal)
    } catch (error) {
      this.lastError = safeError(error)
      return false
    }
    if (this.inFlight || !this.child) {
      if (this.pendingSignal) this.coalesced += 1
      this.pendingSignal = this.signalSanitizer(
        mergePendingMarketSignals(this.pendingSignal, normalized, {
          coalescedWakeCount: Number(this.pendingSignal?.coalescedWakeCount || 0) + (this.pendingSignal ? 1 : 0),
        }),
      )
      if (!this.child && !this.start()) return false
      return true
    }
    this.#dispatch(normalized)
    return true
  }

  stop() {
    this.stopped = true
    this.state = 'STOPPED'
    if (this.restartTimer) clearTimeout(this.restartTimer)
    if (this.deadline) clearTimeout(this.deadline)
    this.restartTimer = null
    this.deadline = null
    this.child?.kill('SIGTERM')
    this.child = null
  }

  snapshot() {
    return {
      policy: this.workerPolicy,
      status: this.state,
      pid: this.child?.pid || null,
      startedAt: this.startedAt,
      inFlight: Boolean(this.inFlight),
      pending: Boolean(this.pendingSignal),
      completed: this.completed,
      failures: this.failures,
      restarts: this.restarts,
      coalesced: this.coalesced,
      lastError: this.lastError,
    }
  }

  #dispatch(signal) {
    if (!this.child?.stdin?.writable || this.inFlight) throw new Error(`${this.workerLabel} is not writable`)
    const requestId = `${this.requestPrefix}-${Date.now()}-${++this.sequence}`
    const line = this.requestEncoder(requestId, signal)
    this.inFlight = { requestId, signal, startedAt: Date.now() }
    this.child.stdin.write(`${line}\n`)
    this.deadline = setTimeout(() => {
      if (this.inFlight?.requestId !== requestId) return
      this.#workerFailed(new Error(`${this.workerLabel} exceeded ${this.timeoutMs} ms`), this.generation)
    }, this.timeoutMs)
  }

  #consume(chunk, generation) {
    if (generation !== this.generation || this.stopped) return
    this.lineBuffer += chunk
    if (Buffer.byteLength(this.lineBuffer) > MAXIMUM_LINE_BYTES) {
      this.#workerFailed(new Error(`${this.workerLabel} output exceeds its bound`), generation)
      return
    }
    let newline
    while ((newline = this.lineBuffer.indexOf('\n')) >= 0) {
      const line = this.lineBuffer.slice(0, newline).trim()
      this.lineBuffer = this.lineBuffer.slice(newline + 1)
      if (!line) continue
      let response
      try {
        response = this.resultParser(line)
      } catch (error) {
        this.#workerFailed(error, generation)
        return
      }
      if (!this.inFlight || response.requestId !== this.inFlight.requestId) {
        this.#workerFailed(new Error(`${this.workerLabel} response does not match the in-flight request`), generation)
        return
      }
      if (this.deadline) clearTimeout(this.deadline)
      this.deadline = null
      const completed = this.inFlight
      this.inFlight = null
      this.completed += 1
      this.state = 'RUNNING'
      this.lastError = null
      const pending = this.pendingSignal
      this.pendingSignal = null
      try {
        this.onResult({
          requestId: completed.requestId,
          signal: completed.signal,
          result: response.result,
          completedAt: response.completedAt,
          durationMs: Date.now() - completed.startedAt,
          superseded: Boolean(pending),
        })
      } catch (error) {
        this.lastError = safeError(error)
      }
      if (pending) this.#dispatch(pending)
    }
  }

  #workerFailed(error, generation) {
    if (generation !== this.generation || this.stopped) return
    // Fence the current child before killing it so its later close event cannot
    // report the same failure twice or schedule a second restart.
    this.generation += 1
    const failed = this.inFlight
    this.inFlight = null
    if (this.deadline) clearTimeout(this.deadline)
    this.deadline = null
    this.child?.kill('SIGKILL')
    this.child = null
    this.lineBuffer = ''
    this.#degrade(error)
    if (failed) {
      try {
        this.onFailure({ signal: failed.signal, reason: this.lastError })
      } catch {}
    }
  }

  #degrade(error) {
    this.state = 'DEGRADED'
    this.lastError = safeError(error)
    this.failures += 1
    if (this.stopped || this.restartTimer) return
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null
      if (this.stopped) return
      this.restarts += 1
      this.start()
    }, RESTART_DELAY_MS)
  }
}
