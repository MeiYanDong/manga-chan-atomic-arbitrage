import { mergePendingMarketSignals } from './feed-signal-coalescer.mjs'

function finiteTimestamp(value, label) {
  const timestamp = Number(value)
  if (!Number.isFinite(timestamp) || timestamp < 0) throw new Error(`${label} must be a non-negative timestamp`)
  return timestamp
}

function positiveDuration(value, label, { allowZero = false } = {}) {
  const duration = Number(value)
  if (!Number.isFinite(duration) || duration < 0 || (!allowZero && duration === 0)) {
    throw new Error(`${label} must be ${allowZero ? 'a non-negative' : 'a positive'} duration`)
  }
  return duration
}

function requiredLane(lanes, laneId) {
  const lane = lanes.get(String(laneId))
  if (!lane) throw new Error(`unknown strategy lane: ${laneId}`)
  return lane
}

function sourceTimestamp(signal, fallback) {
  for (const candidate of [signal?.sourceReceivedAt, signal?.receivedAt, signal?.latestReceivedAt]) {
    const timestamp = Date.parse(String(candidate || ''))
    if (Number.isFinite(timestamp)) return timestamp
  }
  return fallback
}

/**
 * One scheduler protects recovery coverage while keeping the signing lane serial.
 * Event dispatches never move a periodic deadline. A claimed periodic job moves
 * only its own deadline, so a busy market cannot postpone another strategy.
 */
export class ProtectedStrategyScheduler {
  constructor({ lanes, startedAt = Date.now() }) {
    if (!Array.isArray(lanes) || lanes.length === 0) throw new Error('at least one strategy lane is required')
    const initialTimestamp = finiteTimestamp(startedAt, 'startedAt')
    this.lanes = new Map()
    lanes.forEach((definition, order) => {
      const id = String(definition?.id || '')
      if (!id) throw new Error('strategy lane id is required')
      if (this.lanes.has(id)) throw new Error(`duplicate strategy lane: ${id}`)
      const periodMs = positiveDuration(definition.periodMs, `${id}.periodMs`)
      this.lanes.set(id, {
        id,
        order,
        periodMs,
        minimumIntervalMs: positiveDuration(definition.minimumIntervalMs ?? 0, `${id}.minimumIntervalMs`, {
          allowZero: true,
        }),
        nextPeriodicAt: finiteTimestamp(definition.firstPeriodicAt ?? initialTimestamp, `${id}.firstPeriodicAt`),
        lastStartedAt: null,
        pendingEvent: null,
        periodicRuns: 0,
        eventRuns: 0,
        coalescedEvents: 0,
        maximumPeriodicLatenessMs: 0,
      })
    })
    this.lastClaim = null
  }

  enqueueEvent(laneId, { reason, signal = {}, priority = 0, enqueuedAt = Date.now() }) {
    const lane = requiredLane(this.lanes, laneId)
    const timestamp = finiteTimestamp(enqueuedAt, 'enqueuedAt')
    const normalizedPriority = Number(priority)
    if (!Number.isFinite(normalizedPriority)) throw new Error('event priority must be finite')
    if (!reason) throw new Error('event reason is required')

    if (!lane.pendingEvent) {
      lane.pendingEvent = {
        reason: String(reason),
        priority: normalizedPriority,
        enqueuedAt: sourceTimestamp(signal, timestamp),
        latestEnqueuedAt: timestamp,
        signal: mergePendingMarketSignals(null, signal, { coalescedWakeCount: 0 }),
      }
      return this.laneSnapshot(lane.id)
    }

    lane.coalescedEvents += 1
    const pending = lane.pendingEvent
    const replaceReason = normalizedPriority > pending.priority
    lane.pendingEvent = {
      reason: replaceReason ? String(reason) : pending.reason,
      priority: Math.max(pending.priority, normalizedPriority),
      enqueuedAt: Math.min(pending.enqueuedAt, sourceTimestamp(signal, timestamp)),
      latestEnqueuedAt: Math.max(pending.latestEnqueuedAt, timestamp),
      signal: mergePendingMarketSignals(pending.signal, signal, {
        coalescedWakeCount: Number(pending.signal?.coalescedWakeCount || 0) + 1,
      }),
    }
    return this.laneSnapshot(lane.id)
  }

  claimNext(now = Date.now()) {
    const timestamp = finiteTimestamp(now, 'now')
    const periodic = [...this.lanes.values()]
      .filter((lane) => timestamp >= lane.nextPeriodicAt)
      .sort((left, right) => left.nextPeriodicAt - right.nextPeriodicAt || left.order - right.order)[0]

    if (periodic) {
      const scheduledAt = periodic.nextPeriodicAt
      const latenessMs = Math.max(0, timestamp - scheduledAt)
      periodic.lastStartedAt = timestamp
      periodic.nextPeriodicAt = timestamp + periodic.periodMs
      periodic.periodicRuns += 1
      periodic.maximumPeriodicLatenessMs = Math.max(periodic.maximumPeriodicLatenessMs, latenessMs)
      return this.recordClaim({
        laneId: periodic.id,
        kind: 'PERIODIC',
        reason: 'PERIODIC_RECOVERY',
        signal: { sourceReceivedAt: new Date(timestamp).toISOString() },
        claimedAt: timestamp,
        scheduledAt,
        latenessMs,
        nextPeriodicAt: periodic.nextPeriodicAt,
      })
    }

    const eventLane = [...this.lanes.values()]
      .filter(
        (lane) =>
          lane.pendingEvent &&
          (lane.lastStartedAt === null || timestamp - lane.lastStartedAt >= lane.minimumIntervalMs),
      )
      .sort(
        (left, right) =>
          right.pendingEvent.priority - left.pendingEvent.priority ||
          left.pendingEvent.enqueuedAt - right.pendingEvent.enqueuedAt ||
          left.order - right.order,
      )[0]
    if (!eventLane) return null

    const pending = eventLane.pendingEvent
    eventLane.pendingEvent = null
    eventLane.lastStartedAt = timestamp
    eventLane.eventRuns += 1
    return this.recordClaim({
      laneId: eventLane.id,
      kind: 'EVENT',
      reason: pending.reason,
      signal: pending.signal,
      claimedAt: timestamp,
      scheduledAt: pending.enqueuedAt,
      waitMs: Math.max(0, timestamp - pending.enqueuedAt),
      nextPeriodicAt: eventLane.nextPeriodicAt,
    })
  }

  recordClaim(claim) {
    this.lastClaim = { ...claim, signal: undefined }
    return claim
  }

  laneSnapshot(laneId) {
    const lane = requiredLane(this.lanes, laneId)
    return {
      id: lane.id,
      nextPeriodicAt: lane.nextPeriodicAt,
      lastStartedAt: lane.lastStartedAt,
      pendingEvent: lane.pendingEvent
        ? {
            reason: lane.pendingEvent.reason,
            priority: lane.pendingEvent.priority,
            enqueuedAt: lane.pendingEvent.enqueuedAt,
            latestEnqueuedAt: lane.pendingEvent.latestEnqueuedAt,
            coalescedWakeCount: Number(lane.pendingEvent.signal?.coalescedWakeCount || 0),
          }
        : null,
      periodicRuns: lane.periodicRuns,
      eventRuns: lane.eventRuns,
      coalescedEvents: lane.coalescedEvents,
      maximumPeriodicLatenessMs: lane.maximumPeriodicLatenessMs,
    }
  }

  snapshot() {
    return {
      policy: 'OVERDUE_PERIODIC_THEN_PRIORITY_EVENT_SINGLE_SIGNER_LANE',
      lanes: [...this.lanes.keys()].map((laneId) => this.laneSnapshot(laneId)),
      lastClaim: this.lastClaim,
    }
  }
}
