# ADR 0021: bounded dashboard runtime projection

- Status: Accepted and production-verified
- Date: 2026-09-08

## Context

Source-catalog schema v5 reduced the production restart file from 82,341,726 to 39,512,656 bytes and allowed the
signer-free board to complete a fresh scan. The first post-cutover dashboard read then exposed a different allocation
boundary. Every `/api/v1/*` route called one common model builder. That builder expanded all source-only LONG, Doppler
and multi-pool discoveries into 41,652 full opportunity objects before returning even the small `/api/v1/system`
payload. Each row retained pool references, attribution arrays and an evidence timeline, while the browser requested
six projections concurrently every 30 seconds.

The production process reached the cgroup-aware V8 heap boundary at about 251 MiB and exited with status 134. Systemd
restarted the board once. The Linux cgroup reported zero kernel OOM kills; the dual watcher stayed active and did not
start an exact preflight, signature or broadcast. Raising `MemoryMax` would leave endpoint cost proportional to total
historical discovery and would not correct the model semantics: a source fact is not yet an admitted, quoted
opportunity.

## Decision

1. Dashboard control-plane routes (`overview`, `sources`, `episodes`, `executions` and `system`) build only their small
   read model. They never materialize opportunity rows.
2. The runtime opportunity list contains only candidates admitted to the board snapshot. Independent source-only facts
   remain visible as adapter coverage counts and in the streamed source catalog, but are not mislabeled as tradable
   opportunities.
3. The list projection omits pools, raw listing facts, evidence IDs and evidence timelines. It returns semantic summary
   fields only. Opening one row builds claim-level detail for that one opportunity ID.
4. Schema-v5 Doppler visibility remains derivable from the complete target index, but the board retains only the
   visibility count instead of rebuilding tens of thousands of duplicate in-memory launch objects.
5. The source catalog, append-only JSONL and SQLite evidence are unchanged. No fact, PoolKey, receipt link or rollback
   artifact is deleted or rewritten by this change.
6. The board keeps its 448/512 MiB cgroup limits. Production acceptance requires a cold start, a complete board
   generation, repeated reads of every dashboard endpoint, zero additional restarts or OOM events, and a dual watcher
   readback that consumes the new generation without signing in the absence of a positive candidate.

## Consequences

- Dashboard work is proportional to the current admitted candidate set, not all historical source discoveries.
- Source discovery and execution readiness are presented as separate product concepts. The Sources page is the source
  census; Radar is the quote/execution candidate set.
- The HTTP API remains read-only and same-origin. No signer, command bus or arbitrary RPC proxy is added.
- A detail request for an unknown ID returns `404`; malformed encoded IDs return `400` before building a projection.
- Public-RPC throttling can still make a scan `DEGRADED`. It is transport evidence and remains separate from process
  memory stability or profitable execution evidence.

The production cold start, repeated concurrent API reads, exact source-stream hash, cgroup counters and watcher
readback are recorded in
[the dual-v3 bounded-dashboard promotion evidence](../evidence/2026-09-08-dual-v3-bounded-dashboard-production-promotion.md).
