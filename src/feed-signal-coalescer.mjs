const MAXIMUM_SIGNAL_VALUES = 1_024
const MAXIMUM_CLASSIFICATION_REASONS = 16
const MAXIMUM_CLASSIFICATION_REASON_CHARACTERS = 128
const MAXIMUM_WAKE_SOURCES = 8
const SAFE_WAKE_SOURCE = /^[A-Z][A-Z0-9_]{1,63}$/
const GLOBAL_EARN_WAKE_SOURCES = new Set(['MANAGED_WSS_EARN_SWAP', 'PUBLIC_EARN_LOG_BACKSTOP'])

function values(collection) {
  return (collection || []).filter((value) => typeof value === 'string' && value.length > 0)
}

function unionValues(...collections) {
  const unique = new Map()
  for (const collection of collections) {
    for (const value of values(collection)) {
      const key = /^0x[0-9a-f]+$/i.test(value) ? value.toLowerCase() : value
      if (!unique.has(key)) unique.set(key, value)
      if (unique.size > MAXIMUM_SIGNAL_VALUES) throw new Error('coalesced market signal exceeds its value bound')
    }
  }
  return [...unique.values()].sort((left, right) => left.toLowerCase().localeCompare(right.toLowerCase()))
}

function atomicClassificationReasons(signal) {
  const explicit = values(signal?.classificationReasons)
  const source = explicit.length > 0 ? explicit : values([signal?.classificationReason])
  if (source.some((reason) => reason.length > MAXIMUM_CLASSIFICATION_REASON_CHARACTERS)) {
    throw new Error('market classification reason exceeds its character bound')
  }
  const unique = unionValues(source)
  if (unique.length > MAXIMUM_CLASSIFICATION_REASONS) {
    throw new Error('coalesced market signal exceeds its classification-reason bound')
  }
  return unique
}

function atomicWakeSources(signal) {
  const explicit = values(signal?.wakeSources)
  const source = explicit.length > 0 ? explicit : values([signal?.wakeSource])
  if (source.some((item) => !SAFE_WAKE_SOURCE.test(item))) {
    throw new Error('market wake source is invalid')
  }
  const unique = unionValues(source)
  if (unique.length > MAXIMUM_WAKE_SOURCES) throw new Error('coalesced market signal exceeds its wake-source bound')
  return unique
}

function parsedSequence(value) {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'bigint' && value >= 0n) return value
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return BigInt(value)
  if (typeof value === 'string' && /^\d+$/.test(value)) return BigInt(value)
  return null
}

function publicSequence(value) {
  if (value === null) return null
  return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value.toString()
}

function minSequence(...candidates) {
  const parsed = candidates.map(parsedSequence).filter((value) => value !== null)
  return publicSequence(parsed.length > 0 ? parsed.reduce((a, b) => (a < b ? a : b)) : null)
}

function maxSequence(...candidates) {
  const parsed = candidates.map(parsedSequence).filter((value) => value !== null)
  return publicSequence(parsed.length > 0 ? parsed.reduce((a, b) => (a > b ? a : b)) : null)
}

function validTime(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null
}

function earliestTime(...candidates) {
  const valid = candidates.map(validTime).filter(Boolean)
  return valid.length > 0 ? valid.reduce((a, b) => (Date.parse(a) <= Date.parse(b) ? a : b)) : null
}

function latestTime(...candidates) {
  const valid = candidates.map(validTime).filter(Boolean)
  return valid.length > 0 ? valid.reduce((a, b) => (Date.parse(a) >= Date.parse(b) ? a : b)) : null
}

/**
 * Translate one already-observed canonical Earn Vault swap into an exact
 * dependency wake for the protocol-agnostic Global graph. This adds no read,
 * signature or execution authority.
 * @param {Record<string, any>} signal
 * @param {{wakeSource?: string}} [options]
 */
export function buildGlobalWakeFromEarnEvent(signal, options = {}) {
  const wakeSource = options.wakeSource
  if (!GLOBAL_EARN_WAKE_SOURCES.has(wakeSource)) throw new Error('global Earn wake source is invalid')
  const eventPools = unionValues(signal?.eventPools, [signal?.eventPool])
  if (eventPools.length === 0) return null
  if (eventPools.some((pool) => !/^0x[0-9a-f]{40}$/i.test(pool))) {
    throw new Error('global Earn wake pool is invalid')
  }
  const sourceReceivedAt = earliestTime(signal?.sourceReceivedAt, signal?.receivedAt)
  return {
    ...signal,
    wakeSource,
    wakeSources: [wakeSource],
    sourceReceivedAt,
    receivedAt: sourceReceivedAt,
    eventPools,
    eventPool: eventPools[0],
    routeAddresses: eventPools,
    classificationReasons: ['EARN_POOL_SWAP_EVENT'],
    classificationReason: 'EARN_POOL_SWAP_EVENT',
  }
}

/**
 * Coalesce market wake evidence without losing an earlier pool or asset. The
 * result is still only a discovery hint; it grants no signing authority.
 */
export function mergePendingMarketSignals(current, next, options = {}) {
  const left = current && typeof current === 'object' ? current : {}
  const right = next && typeof next === 'object' ? next : {}
  // classificationReason is a presentation-only projection. Once the atomic
  // list exists, feeding that joined projection back into the next merge would
  // create A, B, A+B, A+B+A+B... and grow exponentially under a hot Feed.
  const classificationReasons = unionValues(atomicClassificationReasons(left), atomicClassificationReasons(right))
  if (classificationReasons.length > MAXIMUM_CLASSIFICATION_REASONS) {
    throw new Error('coalesced market signal exceeds its classification-reason bound')
  }
  const wakeSources = unionValues(atomicWakeSources(left), atomicWakeSources(right))
  if (wakeSources.length > MAXIMUM_WAKE_SOURCES) {
    throw new Error('coalesced market signal exceeds its wake-source bound')
  }
  const eventPools = unionValues(left.eventPools, [left.eventPool], right.eventPools, [right.eventPool])
  const searchResultIds = unionValues(left.searchResultIds, [left.searchResultId], right.searchResultIds, [
    right.searchResultId,
  ])
  const sourceReceivedAt = earliestTime(
    left.sourceReceivedAt,
    left.receivedAt,
    right.sourceReceivedAt,
    right.receivedAt,
  )
  const latestReceivedAt = latestTime(
    left.latestReceivedAt,
    left.receivedAt,
    left.sourceReceivedAt,
    right.latestReceivedAt,
    right.receivedAt,
    right.sourceReceivedAt,
  )
  const firstSequenceNumber = minSequence(
    left.firstSequenceNumber,
    left.lastSequenceNumber,
    right.firstSequenceNumber,
    right.lastSequenceNumber,
  )
  const lastSequenceNumber = maxSequence(
    left.firstSequenceNumber,
    left.lastSequenceNumber,
    right.firstSequenceNumber,
    right.lastSequenceNumber,
  )

  return {
    ...left,
    ...right,
    sourceReceivedAt,
    // Downstream latency uses receivedAt first, so retain the oldest queued
    // market event and publish the newest arrival separately.
    receivedAt: sourceReceivedAt,
    latestReceivedAt,
    firstSequenceNumber,
    lastSequenceNumber,
    messageCount: Number(left.messageCount || 0) + Number(right.messageCount || 0),
    matchedAddresses: unionValues(left.matchedAddresses, right.matchedAddresses),
    routeAddresses: unionValues(left.routeAddresses, right.routeAddresses),
    eventPools,
    eventPool: eventPools[0] || null,
    searchResultIds,
    searchResultId: searchResultIds.at(-1) || null,
    classificationReasons,
    classificationReason:
      classificationReasons.length <= 1 ? classificationReasons[0] || null : classificationReasons.join('+'),
    wakeSources,
    wakeSource: wakeSources.length <= 1 ? wakeSources[0] || null : 'MULTI_SOURCE_MARKET_EVENT',
    duplicateMessages: Number(left.duplicateMessages || 0) + Number(right.duplicateMessages || 0),
    overlappingFrame: Boolean(left.overlappingFrame || right.overlappingFrame),
    outOfOrderFrame: Boolean(left.outOfOrderFrame || right.outOfOrderFrame),
    sequenceGap: Boolean(left.sequenceGap || right.sequenceGap),
    requiresLegacyGlobalSearch: Boolean(left.requiresLegacyGlobalSearch || right.requiresLegacyGlobalSearch),
    coalescedWakeCount: Number(options.coalescedWakeCount ?? right.coalescedWakeCount ?? 0),
  }
}
