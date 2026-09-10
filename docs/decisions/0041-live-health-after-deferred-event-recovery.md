# ADR 0041: live health after deferred event recovery

- Status: Production-observed; differential recovery window not naturally observed
- Date: 2026-09-11

## Context

ADR 0040 intentionally allows an ordinary successful event cycle to update quotes and the small runtime checkpoint
without replacing the complete JSON and SQLite projections. The health endpoint still read its status from the last
full snapshot. Production then observed three event errors that correctly published `DEGRADED`; subsequent successful
event cycles were deferred, so the process and APIs recovered while `/healthz` continued returning 503 until the next
periodic full publication.

This is a control-plane correctness problem, not evidence of an economic or signing failure. A false 503 can trigger
operator confusion or unnecessary service recovery, while treating every successful event as a full publication would
undo the latency improvement.

## Decision

- Track the status of the most recently completed runtime cycle independently from the last full persisted snapshot.
- A completed `RUNNING` or intentional `SCANNING` cycle is health-ready. `DEGRADED`, partial-catalog and startup states
  remain not ready.
- Set the live status after a full publication succeeds and after a deferred non-material event safely persists its
  runtime checkpoint.
- Keep health freshness, SQLite status and SQLite parity as independent fail-closed conditions.
- Return both live runtime status and persisted-snapshot status from the loopback health endpoint for operational
  diagnosis; neither field is added to the user-facing dashboard.
- Do not change event publication policy, source coverage, RPC routing, provider caps, quote breadth, profit floors,
  capital, authorization, signing or transaction broadcast.

## Consequences

- Health recovers on the first completed successful event cycle rather than waiting for a periodic full projection.
- A persisted economic snapshot may still show the prior error until its planned replacement. That lag is explicit and
  separately observable instead of silently controlling process health.
- A genuine runtime error, incomplete catalog, stale last cycle or unhealthy SQLite projection continues to return 503.
- This correction does not reduce the remaining synchronous cost of mandatory periodic SQLite publication.

## Rollback

Restart only the signer-free opportunity board on release
`f0bd3f8c124b611277238278d986f17d5933ce27`. Do not restart or re-arm the dual signer, change its authorization, expand
ChainStack caps or modify wallet state.

## Production follow-up

Release `0d7e75a44b2db403596a0aadffcb7f7c0f7a0e57` was promoted through the reviewed GitHub and independent Linux
archive gates. Its first completed periodic cycle returned `HEALTHY`, with both live and persisted statuses `RUNNING`,
complete catalogs, healthy SQLite parity and zero screened-positive rows. Only the board restarted; the signer PID,
release, authorization and current-authorization usage did not change.

Normal successful events exercised the deferred live-status assignment. A 12-minute natural window then observed one
`EVENT_ERROR` and 571 deferred events. The error coincided with the next periodic lane, whose full `RUNNING`
publication completed before the following observed successful events. Production therefore did not expose the exact
window in which live status is recovered while the persisted status remains `DEGRADED`; that differential branch
remains deterministic-test evidence, not a claimed natural observation. Full evidence is in
[the production promotion record](../evidence/2026-09-11-live-health-recovery-production-promotion.md).
