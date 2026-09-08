# Bounded dashboard runtime local validation

Follow-up: this allocation boundary was later promoted and production-verified in
[the dual-v3 bounded-dashboard production promotion](2026-09-08-dual-v3-bounded-dashboard-production-promotion.md).
The evidence below remains the historical local checkpoint.

- Date: 2026-09-08 (Asia/Shanghai)
- Input: read-only copy of the production schema-v5 source catalog and board snapshot
- Production mutation during this validation: the unstable board was stopped; the dual watcher stayed active
- Chain mutation: none

## Production failure reproduced

The production board had already completed a fresh schema-v5 cycle. A dashboard control-plane request then caused the
shared model builder to expand 41,652 historical source discoveries into full opportunity objects. The V8 log reported
`Ineffective mark-compacts near heap limit` at about `251.6 / 259.0 MB`; the process exited with status 134 and systemd
recorded one restart. Cgroup `memory.events` still reported `max=0`, `oom=0` and `oom_kill=0`, proving this was the V8
heap boundary rather than a kernel OOM kill. The dual watcher had zero restarts and no exact preflight, signature or
broadcast.

A standalone reproduction with the 39,512,656-byte catalog and a 256 MiB V8 old-space limit built the previous full
model successfully but left `236,027,000` heap bytes in use and reached `537,067,520` maximum RSS. That left no safe
headroom inside the production service.

## Corrected projection measurements

The corrected control plane built no opportunities and reached `351,305,728` maximum RSS. The runtime summary path
projected 860 admitted candidates instead of 41,652 discovery rows. After avoiding address normalization for unrelated
facts, its maximum RSS was `424,296,448`; the model serialized to 2,001,113 bytes. A one-ID detail projection returned
one claim-level row.

An alternating stress process used the same production-size files and `--max-old-space-size=256`. Twenty rounds each
built and serialized the system, admitted-summary and one-ID detail projections. It completed all 60 projections,
serialized 26,283,720 bytes and reached `484,950,016` maximum RSS without exiting or growing monotonically. Reported
heap usage returned from about 180 MiB at round 5 to about 90 MiB at rounds 10 and 15 before later allocation, showing
that prior projections were collectible.

## Signer-free board canary

An isolated board copied the same catalog, snapshot, SQLite projection and state into a temporary directory. Under the
256 MiB old-space limit it emitted `BOARD_HTTP_READY`. Ten consecutive reads of each control/list endpoint all returned
HTTP 200. The process kept the same PID, reported healthy SQLite parity and used about 360,624 KiB RSS while serving
requests. The opportunity response contained 861 admitted semantic summaries rather than the historical source census.

One canary scan degraded because the official public endpoint returned HTTP 429. The process remained alive, later
used about 154-166 MiB RSS, recovered without a restart and published a `RUNNING` event cycle with one fresh candidate
and zero screened-positive candidates. This is valid memory and fail-closed transport evidence; it is not production
liveness, an opportunity-frequency estimate or an execution claim.

## Local gates at this checkpoint

- Full `npm run check`: passed.
- Node tests: 179 passed after adding control/list/detail and Doppler-count regressions.
- Formatting, JavaScript/Solidity/shell lint, checked-JavaScript types, Vite build and all three deterministic contract
  suites: passed.
- Secret scan: passed across 185 repository files.
- Repeated production-size projection and signer-free HTTP canaries: passed.
- Linux systemd semantic verification was skipped on macOS; GitHub/Linux CI and production promotion remain pending at
  this checkpoint.

This record proves the local allocation boundary and semantic separation. It does not prove production continuity,
opportunity frequency, a live transaction or profit.
