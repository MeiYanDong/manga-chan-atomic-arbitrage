# ADR 0031: preemptible event hot path

- Status: Accepted; v0.7.9 production acceptance pending
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
3. Quote one V4 pair and the strongest previously proven V3 topology per lane. Prefer a pair joining the touched V4
   pool to the previous winning route; otherwise use the previous pair or a deterministic two-pool fallback. Each
   selected path still receives fresh V3 and V4 Quoter calls at one canonical fixed block. A missing or failed event
   shortlist does not expand into full discovery.
4. When a warm periodic cycle is running, a pool event accepted after that cycle began causes its next RPC read to
   yield. Backlog that predates the cycle does not abort mandatory work, and a cold start without persisted observations
   remains non-preemptible. Completed observations remain valid; the interrupted candidate is not converted into a
   false transport failure.
5. Periodic reconciliation retains full route competition, adaptive sizing, catalog discovery and explicit incomplete
   states. Event probes cannot establish route completeness and cannot authorize signing by themselves.
6. Do not change the exact executor simulation, current-block route validation, immutable principal caps, minimum net
   profit, nonce, reserve, failed-Gas breaker, authorization or receipt reconciliation.
7. Give event quotes two logical read attempts separated by 200 ms. Keep the periodic reconciliation's three-attempt,
   one-second exponential policy so lowering event latency does not silently weaken coverage work.

## Consequences

- Fresh pool changes can reach the screen ahead of slow coverage work without adding paid-RPC use or a second signer.
- An event-only edge outside two amounts or the selected route pair can be missed until periodic reconciliation. This is an
  explicit latency-for-completeness trade, not evidence that no opportunity existed.
- Repeated active-pool events may interrupt broad reconciliation. The durable catalog and persisted observations remain
  intact, while quiet intervals continue coverage. Cold-start coverage cannot be skipped.
- Production acceptance requires a completed event cycle inside the 45-second freshness window, bounded hot-path
  metrics, no cursor-lag breach or restart, and no signed attempt unless independent exact preflight remains positive.

## v0.7.7 canary correction

The first production hot cycle completed in 53,579 ms with 44 logical Quoter calls; the second completed in 40,961 ms
with 34. Both were a major improvement over 610,315 ms and 247 calls, but the first missed the latency gate and the
second left too little margin. The canary also showed that viem wraps a fetch-level `PeriodicCyclePreempted` in its HTTP
error hierarchy. One later yield was therefore published as a transient `DEGRADED` state even though the service did
not restart and no signer or transaction was involved. v0.7.8 reduces the pair bound from two to one and recognizes the
AsyncLocalStorage preemption flag even when the thrown error is wrapped.

## v0.7.8 canary correction

The first bounded event cycle used only 17 logical Quoter calls, but the official public endpoint required 13 logical
retries and the cycle still took 54,807 ms. A later cycle completed in 45,135 ms, while another correctly published
`DEGRADED` when the same public endpoint could not provide complete fixed-block evidence. The board did not restart,
sign or spend Gas. v0.7.9 therefore retains only the strongest proven V3 topology in an event wake and gives that hot
path one fast retry. Periodic reconciliation remains the completeness path.
