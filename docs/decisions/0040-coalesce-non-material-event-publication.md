# ADR 0040: coalesce non-material event publications

- Status: Production-observed on release `f0bd3f8c124b611277238278d986f17d5933ce27`
- Date: 2026-09-10

## Context

Release `3db3cc5a7b8096ce10a2516f7fe63b76f51aacc0` reduced each successful protected cycle to one 45 MB source-catalog
write, but production probes still found event-loop stalls. The current compatibility snapshot is 23,753,213 bytes and
the SQLite read model is 515,616,768 bytes. Every event cycle quotes at most one candidate, yet its final `publish`
rebuilds, sorts, hashes and writes all 3,500-plus candidate rows to both JSON and SQLite.

During the first v0.9.0 observation window, 35 two-second loopback probes returned 22 responses and timed out 13 times.
Successful responses clustered either below 1 ms or around 1–1.9 seconds. Thirty-six one-candidate event cycles had a
501.3 ms latest candidate-quote phase, while queue delay was 5,137 ms and end-to-end observed-to-quote time was
6,223 ms. The process remained healthy with zero restarts, so this is synchronous publication pressure rather than a
service crash.

Not every quote refresh has the same durability value. A new screened-positive result is an execution handoff. A fresh
negative or unknown result for a candidate previously present in the compact execution feed must clear that feed and
advance its economic episode. A routine negative refresh with no such history changes neither authority nor economic
state and will be superseded by the next mandatory periodic reconciliation.

## Decision

- Keep every fixed-block quote and in-memory observation exactly as today.
- Immediately publish a full snapshot when an event creates screened-positive evidence.
- Reuse that positive checkpoint as the event's final publication instead of writing the same full snapshot twice.
- Immediately publish when the selected candidate was present in the last compact execution feed, even if the new
  observation is negative or unknown. This clears signer-visible data and durably reconciles the open episode.
- Immediately publish when the prior durable snapshot carries an open economic episode, even if quote aging already
  removed that candidate from the compact execution feed. A fresh non-positive result must not defer the episode-close
  receipt merely because signing freshness expired first.
- For all other event results, persist only the small runtime/hot-cursor checkpoint and coalesce the complete board and
  SQLite projection into the next mandatory periodic cycle.
- Remove the periodic pre-quote full `SCANNING` publication; the same protected cycle still performs one final durable
  publication after quote and catalog maintenance.
- Track full-publication count and phase timings, deferred-event count, positive-checkpoint reuse, feed-clear writes,
  open-episode reconciliation writes and deferred periodic `SCANNING` writes through the loopback metrics API.

The mandatory periodic deadline remains enforced, so non-material dashboard state is delayed by at most one completed
reconciliation interval during normal operation. RPC routing, quote breadth, source coverage, economic thresholds,
signing and transaction logic are unchanged.

## Safety and data boundary

- The compact execution feed remains atomically derived from a reconciled full snapshot.
- A positive entry is never deferred.
- A candidate already visible to the signer is never silently left there after a new non-positive observation.
- An open economic episode is never deferred after a new observation; its close or unknown-continuity state is durable
  immediately.
- The signer independently rejects aged quotes and still performs current-block exact simulation, Gas, principal,
  nonce, authorization and final-simulation checks.
- A crash before the next periodic cycle may lose only the latest non-material negative/unknown refresh. Its hot cursor
  remains durable, and no receipt, positive episode or signing authority is lost or invented.
- Dashboard freshness for ordinary negatives can lag one reconciliation interval. This is an explicit product/data
  tradeoff in favor of event throughput, not a claim that those rows updated immediately.

## Consequences and limits

- Busy negative event traffic no longer performs work proportional to the entire admitted catalog per candidate.
- A protected periodic cycle still performs one full 23 MB JSON/SQLite publication. Its remaining cost must be measured
  separately before considering an incremental read-model schema.
- Faster observation does not create opportunities or guarantee transaction inclusion or profit.

## Rollback

Restart only the signer-free board on release `3db3cc5a7b8096ce10a2516f7fe63b76f51aacc0`. Do not restart or re-arm the
dual signer, and retain source evidence, cursor state, managed-RPC budget and all economic ledgers.

## Production follow-up

The first stable observation recorded 214 ordinary event deferrals, zero event-triggered full publications and seven
periodic full publications. Event post-quote bookkeeping was 18.02 ms p50, while the same 35-request/two-second health
probe improved from `22 success / 13 timeout` on `0.9.0` to `31 success / 4 timeout` on `0.9.1` across periodic work.

The latest full publication still took 6,504.51 ms, of which the SQLite projection consumed 5,613.50 ms. This confirms
the coalescing boundary and isolates the next bottleneck; it does not prove a long-run SLO. The signer PID, release,
authorization and usage were unchanged, the feed remained empty, and no transaction or profit occurred. Full artifact,
cutover, provider and economic evidence is in
[the production promotion record](../evidence/2026-09-10-coalesced-event-snapshot-production-promotion.md).

Extended observation found one correctness issue outside the economic snapshot policy: after an event error published
`DEGRADED`, a successful deferred event did not replace that snapshot, so `/healthz` continued reporting the persisted
error status until the next periodic full publication even though the live APIs had recovered. ADR 0041 separates
live-cycle health from intentionally lagged persisted projection health without changing this coalescing decision.
