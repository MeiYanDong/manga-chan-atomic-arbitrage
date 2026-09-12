import fs from 'node:fs'

export const BUSINESS_BOARD_SNAPSHOT_MODE = 'READ_ONLY_SANITIZED_BOARD_OPERATIONS'
export const BUSINESS_BOARD_SNAPSHOT_SCHEMA_VERSION = 1

const MAX_SNAPSHOT_BYTES = 64 * 1024
const HEALTH_STATUSES = new Set(['HEALTHY', 'NOT_READY'])

function count(value) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null
}

function assertKeys(value, expected, label) {
  const actual = Object.keys(value || {}).sort()
  const wanted = [...expected].sort()
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`invalid ${label} fields`)
  }
}

function assertCount(value, label) {
  if (value !== null && (!Number.isSafeInteger(value) || value < 0)) throw new Error(`invalid ${label}`)
}

/**
 * Build the smallest board projection needed by the operating report. The
 * allowlist prevents RPC/provider/configuration details from entering the
 * group-readable handoff file.
 * @param {{
 *   generatedAt: string,
 *   healthStatus: 'HEALTHY' | 'NOT_READY',
 *   overview?: Record<string, any> | null,
 *   sources?: Record<string, any> | null,
 * }} input
 */
export function buildBusinessBoardSnapshot({ generatedAt, healthStatus, overview = null, sources = null }) {
  const snapshot = {
    schemaVersion: BUSINESS_BOARD_SNAPSHOT_SCHEMA_VERSION,
    mode: BUSINESS_BOARD_SNAPSHOT_MODE,
    generatedAt,
    health: { status: healthStatus },
    overview: {
      serviceStatus: typeof overview?.serviceStatus === 'string' ? overview.serviceStatus : 'UNKNOWN',
      coverage: { candidateTokens: count(overview?.coverage?.candidateTokens) },
      freshCandidates: count(overview?.freshCandidates),
      screenedPositive: count(overview?.screenedPositive),
      exactReady: count(overview?.exactReady),
    },
    sources: {
      pairListings: count(sources?.pairListings),
      longLaunches: count(sources?.longLaunches),
      dopplerTargetsDiscovered: count(sources?.dopplerTargetsDiscovered),
      genericPools: count(sources?.genericPools),
    },
  }
  assertBusinessBoardSnapshot(snapshot)
  return snapshot
}

/** @param {unknown} value */
export function assertBusinessBoardSnapshot(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('invalid business board snapshot')
  }
  const snapshot = /** @type {Record<string, any>} */ (value)
  assertKeys(snapshot, ['schemaVersion', 'mode', 'generatedAt', 'health', 'overview', 'sources'], 'snapshot')
  if (
    snapshot.schemaVersion !== BUSINESS_BOARD_SNAPSHOT_SCHEMA_VERSION ||
    snapshot.mode !== BUSINESS_BOARD_SNAPSHOT_MODE
  ) {
    throw new Error('invalid business board snapshot identity')
  }
  if (!Number.isFinite(Date.parse(snapshot.generatedAt))) throw new Error('invalid business board snapshot time')
  assertKeys(snapshot.health, ['status'], 'health')
  if (!HEALTH_STATUSES.has(snapshot.health.status)) throw new Error('invalid business board health')
  assertKeys(
    snapshot.overview,
    ['serviceStatus', 'coverage', 'freshCandidates', 'screenedPositive', 'exactReady'],
    'overview',
  )
  if (typeof snapshot.overview.serviceStatus !== 'string' || snapshot.overview.serviceStatus.length > 64) {
    throw new Error('invalid business board service status')
  }
  assertKeys(snapshot.overview.coverage, ['candidateTokens'], 'coverage')
  assertCount(snapshot.overview.coverage.candidateTokens, 'candidate token count')
  assertCount(snapshot.overview.freshCandidates, 'fresh candidate count')
  assertCount(snapshot.overview.screenedPositive, 'screened-positive count')
  assertCount(snapshot.overview.exactReady, 'exact-ready count')
  assertKeys(snapshot.sources, ['pairListings', 'longLaunches', 'dopplerTargetsDiscovered', 'genericPools'], 'sources')
  for (const [key, item] of Object.entries(snapshot.sources)) assertCount(item, `${key} count`)
  return snapshot
}

/**
 * Read a fresh, regular, non-writable-by-group projection.
 * @param {string} file
 * @param {{now?: number, maxAgeMs?: number}} [options]
 */
export function readBusinessBoardSnapshot(file, { now = Date.now(), maxAgeMs = 180_000 } = {}) {
  const metadata = fs.lstatSync(file)
  if (!metadata.isFile() || metadata.size <= 0 || metadata.size > MAX_SNAPSHOT_BYTES) {
    throw new Error('business board snapshot file is invalid')
  }
  if ((metadata.mode & 0o022) !== 0) throw new Error('business board snapshot must not be group- or world-writable')
  const snapshot = assertBusinessBoardSnapshot(JSON.parse(fs.readFileSync(file, 'utf8')))
  if (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0) throw new Error('invalid business board freshness limit')
  const age = now - Date.parse(snapshot.generatedAt)
  if (!Number.isFinite(age) || age < -10_000 || age > maxAgeMs) {
    throw new Error('business board snapshot is stale')
  }
  return snapshot
}

/**
 * Prefer the independent persisted handoff and retain bounded HTTP only as a
 * migration/failure fallback.
 * @param {{
 *   readPersisted: () => any,
 *   boardServiceStatus: () => string,
 *   requestBoard: (pathname: string) => Promise<any>,
 * }} input
 */
export async function resolveBusinessBoardProjection({ readPersisted, boardServiceStatus, requestBoard }) {
  let persisted = null
  try {
    persisted = readPersisted()
  } catch {}
  if (persisted) {
    return {
      generatedAt: persisted.generatedAt,
      health: {
        status: boardServiceStatus() === 'RUNNING' && persisted.health.status === 'HEALTHY' ? 'HEALTHY' : 'NOT_READY',
      },
      overview: persisted.overview,
      sources: persisted.sources,
    }
  }
  const [health, overview, sources] = await Promise.all([
    requestBoard('/healthz'),
    requestBoard('/api/v1/overview'),
    requestBoard('/api/v1/sources'),
  ])
  return { generatedAt: overview?.generatedAt || null, health, overview, sources: sources?.summary || null }
}
