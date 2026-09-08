# ADR 0031: preemptible event hot path

- Status: Accepted; production verification pending
- Date: 2026-09-09

## Context

v0.7.6 reduced the first production reconciliation from 999 to 516 logical Quoter calls, but it still took almost eight
minutes. Its first event wake then quoted four candidates through the ordinary sizing and route-discovery path: 247
logical Quoter calls and 610,315 ms from the oldest queued event to completion. A 45-second execution-freshness gate
cannot consume that output. Independent log polling preserved evidence, but did not make the single quote scheduler
latency-sensitive.

The backlog also used oldest-first ordering. Once a slow reconciliation accumulated active-pool events, later event
cycles spent RPC capacity on revisions that could no longer reach exact preflight while fresh revisions waited behind
them.

## Decision

1. Retain only event candidates updated within 20 seconds at dispatch and choose the freshest candidate first. Record
   every stale candidate drop; never relabel an expired event as current.
2. Quote one event candidate per cycle. For each USDG/WETH lane, probe at most two amounts: the previous winning amount
   when still inside the configured risk grid, then the smallest configured probe.
3. Quote at most two V4 pairs per lane. Prefer pairs joining the touched V4 pool to the previous winning route; otherwise
   use the previous pair or a deterministic two-pool fallback. Each selected pair still receives fresh V3 and V4
   Quoter calls at one canonical fixed block. A failed event shortlist does not expand into full discovery.
4. When a warm periodic cycle is running, a pool event accepted after that cycle began causes its next RPC read to
   yield. Backlog that predates the cycle does not abort mandatory work, and a cold start without persisted observations
   remains non-preemptible. Completed observations remain valid; the interrupted candidate is not converted into a
   false transport failure.
5. Periodic reconciliation retains full route competition, adaptive sizing, catalog discovery and explicit incomplete
   states. Event probes cannot establish route completeness and cannot authorize signing by themselves.
6. Do not change the exact executor simulation, current-block route validation, immutable principal caps, minimum net
   profit, nonce, reserve, failed-Gas breaker, authorization or receipt reconciliation.

## Consequences

- Fresh pool changes can reach the screen ahead of slow coverage work without adding paid-RPC use or a second signer.
- An event-only edge outside two amounts or two route pairs can be missed until periodic reconciliation. This is an
  explicit latency-for-completeness trade, not evidence that no opportunity existed.
- Repeated active-pool events may interrupt broad reconciliation. The durable catalog and persisted observations remain
  intact, while quiet intervals continue coverage. Cold-start coverage cannot be skipped.
- Production acceptance requires a completed event cycle inside the 45-second freshness window, bounded hot-path
  metrics, no cursor-lag breach or restart, and no signed attempt unless independent exact preflight remains positive.
