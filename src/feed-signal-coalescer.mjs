const MAXIMUM_SIGNAL_VALUES = 1_024
const MAXIMUM_CLASSIFICATION_REASONS = 16
const MAXIMUM_CLASSIFICATION_REASON_CHARACTERS = 128

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
  const eventPools = unionValues(left.eventPools, [left.eventPool], right.eventPools, [right.eventPool])
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
    classificationReasons,
    classificationReason:
      classificationReasons.length <= 1 ? classificationReasons[0] || null : classificationReasons.join('+'),
    duplicateMessages: Number(left.duplicateMessages || 0) + Number(right.duplicateMessages || 0),
    overlappingFrame: Boolean(left.overlappingFrame || right.overlappingFrame),
    outOfOrderFrame: Boolean(left.outOfOrderFrame || right.outOfOrderFrame),
    sequenceGap: Boolean(left.sequenceGap || right.sequenceGap),
    coalescedWakeCount: Number(options.coalescedWakeCount ?? right.coalescedWakeCount ?? 0),
  }
}
