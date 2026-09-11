# Changelog

## Unreleased

- Add one Chinese-first `资金` page for two operator wallets, three active executors and two stopped-but-funded
  executors across Base and Robinhood Chain. Read balances at one fixed block per chain, verify executor identity,
  preserve partial/unknown states, and consume only a field-allowlisted Base runtime heartbeat. Isolate its low-frequency
  Base reads on a production-verified public endpoint after the official endpoint rate-limited bounded contract calls;
  neither execution RPC nor signer service is changed or restarted.

- Decouple loopback health from the last full-board projection. A successful event cycle now restores live health
  immediately even when its non-material economic snapshot is intentionally deferred; error publications, partial
  catalogs, stale cycles and unhealthy SQLite parity remain fail-closed.
- Coalesce routine event-cycle board publications into the next mandatory periodic snapshot. New positive screens and
  removal of a previously signer-visible positive or reconciliation of an open economic episode still publish
  immediately; non-material negative refreshes persist only their small runtime cursor until the next periodic
  projection. Remove the redundant periodic pre-quote
  `SCANNING` snapshot and expose full-publication phase timing and deferral counters.
- Coalesce the four possible large source-catalog writes in one protected periodic cycle into one atomic projection.
  Freeze the last projected source cursors until that file and the general runtime checkpoint commit in order, so a
  crash can cause safe re-observation but cannot skip an unprojected block range. Expose projection count, duration and
  total periodic-maintenance timing without changing sources, admission, signing or RPC budgets.
- Cache the validated source-target index across hot polls, use its branded fast retention path, skip empty Initialize
  ingestion and avoid unchanged PAIR/ambiguity merges. Split decode, coalescing, Initialize ingestion and route/queue
  timing while retaining the aggregate metric.
- Add an opt-in managed RPC lane only for `EXECUTOR_COMPATIBLE` and `EXECUTOR_SHAPE` event quotes while retaining
  public-RPC log polling, discovery, backfill and periodic coverage. Persist strict UTC-day ceilings of 200 event
  candidates and 4,000 logical JSON-RPC calls, degrade to the public reader on cap/transient failure, and expose
  provider-role, fallback and latency telemetry without adding signer capability or changing any economic gate.

- Prioritize event wakes by live execution evidence, then the deployed executor's exact PoolKey shape, before
  shadow-only candidates; preserve freshest-first ordering inside each tier and keep broad shadow coverage in the
  protected periodic lane. Expose selected-tier counters without changing RPC endpoints, signing authority or economic
  gates.
- Keep source-only singleton targets in the durable source catalog without allocating temporary strategy-token rows;
  only targets with a plausible multi-pool route are materialized in the live strategy graph.
- Bound the protected periodic coverage tranche to one V4 pair, one amount and one V3 route per direction after the
  first v0.8.0 production cycle required 165 Quoter calls for a single candidate. Keep sampled negatives explicitly
  non-exhaustive and leave receipt-gated execution unchanged.
- Join PAIR, LONG and Doppler target facts to the retained PoolManager catalog in a bounded multi-source strategy graph.
  Admit arbitrary chain-attested hooks only to signer-free shadow quoting, retain the current executor's exact PoolKey
  boundary for live candidates, and cap source pools per target without displacing existing PAIR rows.
- Replace event-preemptible broad scans with a one-candidate protected periodic tranche while keeping the independent
  event poller and its fast route/amount bounds. Surface completed-periodic age, fresh coverage and the full
  pool-to-preflight funnel instead of presenting process liveness as market coverage.
- Add a Chinese-first opportunity funnel to the private dashboard. It explains how many pools form multi-pool targets,
  how many enter the strategy graph, how many have fresh results and how many pass each economic gate; unsupported pool
  types remain observation-only and technical fields stay outside the primary reading path.

- Turn event wakes into a bounded hot path: discard candidate backlog older than 20 seconds, prioritize the freshest
  candidate, quote one touched/previous V4 pool pair and at most two sizes per base, and let a new accepted event
  cooperatively preempt a warm periodic reconciliation before its next RPC read. Treat a provider-wrapped preemption as
  an intentional yield instead of a network fault. Re-quote only the strongest previously proven V3 route during an
  event wake and use one fast retry there, while periodic reconciliation retains its broader topology discovery and
  three-attempt read policy. Every event probe remains a fresh fixed-block Quoter screen; full topology and sizing
  coverage stays in periodic reconciliation, and signing gates are unchanged.
- Bound previously unseen V3 directions to eight deterministic low-fee bootstrap paths unless a periodic cycle has one
  of its two full-discovery slots available. Reuse the three strongest V4 entry/exit pool pairs for later amounts only
  inside the same fixed block, deduplicating identical V4 calls there. Every reused pair and path still receives a fresh
  canonical quote, and a wholly failing V4 shortlist falls back to the full current-block pool set.
- Cap priority, positive and coverage work at four total candidates per cycle. Reuse up to three structurally validated
  V3 routes across blocks and restarts, re-quote every cached path at the current fixed block, invalidate observed
  route pools on `Swap`, and spend at most two full topology rediscoveries per periodic cycle. Event cycles never spend
  topology-refresh budget; exact execution preflight and signing gates are unchanged.
- Run hot-log polling independently of slow quote cycles, coalesce each range to the latest swap per pool and rebuild
  dependencies before the cycle fixed block, while keeping events as non-executable wake evidence.
- Replace unsupported public JSON-RPC batches with code-hash-pinned, four-call Multicall3 groups for V3 Factory and
  Quoter reads. Re-read every failed subcall directly at the same block, and stop fallback fan-out on the first direct
  transport failure. Keep V4 hook calls direct and the paid execution RPC isolated behind the exact-preflight threshold.
- Split the latency-sensitive event cursor from historical completeness: cap public-RPC hot log ranges, detect stale
  cursor lag, record every skipped interval, and resume near the confirmed head with a reorg lookback instead of
  replaying day-old swaps as if they were current.
- Separate the `0.05 USDG` signer-free screen trigger from the unchanged `0.10 USDG` exact signed-net floor. Near-edge
  rows now receive a same-block exact call and gas estimate; only an independently profitable exact result can sign.
- Surface exact-preflight activity and plain-language real-time event health in the Chinese operations console.
- Apply release-owned threshold and hot-range values at the process command boundary, so a retained production
  `EnvironmentFile` cannot silently restore the previous values.
- Rebuilt the private dashboard as a Chinese-first four-page operations console. It now separates current-strategy
  results from account history, groups opportunities by actionability, presents transactions as a readable ledger and
  hides exact values, addresses and provenance evidence behind deliberate disclosures.
- Simplified the Feishu daily report around verified net profit, executions, failed Gas, reinvestable capital and
  actionable opportunity counts.
- Close opportunity evidence automatically when navigation changes so technical detail cannot remain over another
  product page.

- Add a private business-first dashboard with Beijing-day receipt economics, authorized USDG/WETH reinvestment,
  seven-day results, source separation and Blockscout-linked transactions. Publish it through a validated sanitized
  snapshot that expires after 15 minutes and retains the board's no-signer, no-mutation boundary.
- Add an independent 09:05 Beijing Feishu daily report backed by an encrypted systemd credential, a five-minute retry
  timer, period-keyed fsynced delivery receipts and crash recovery. Reporting can read canonical ledgers but cannot load
  the trading key, write trading state or affect trading-service success.
- Start the constrained one-shot reporter with one direct Node process so its 16-task systemd limit cannot be exhausted
  by nested npm and report runtimes before the script begins.
- Accept systemd's immutable `0440 root:root` runtime credential only inside the unit-specific credentials directory,
  while continuing to reject ordinary group-readable webhook files.
- Retry transient dual-watcher startup chain readback five times with bounded exponential backoff, persist degraded
  retry telemetry, and load the private credential only after chain identity, deployments, balances and nonce converge.
  Wrong-chain, authorization, ledger and state mismatches still fail immediately.
- Publish a compact execution-feed checkpoint immediately after any newly quoted proxy-positive candidate and before
  slower source-catalog maintenance. This preserves the signer's 30-second freshness gate without relaxing its exact
  net-profit floor, route validation or fail-closed behavior.
- Count every distinct signer-free feed generation in dual-watcher liveness telemetry, including generations with zero
  screened-positive rows. Report screened-positive generations separately so an idle-but-observing watcher cannot be
  mistaken for a stopped watcher; signing and exact-preflight behavior are unchanged.
- Separate dashboard control-plane, admitted-opportunity summary and one-ID evidence projections after the production
  `/api/v1/system` path expanded 41,652 source discoveries and exhausted V8 old space. Keep the complete source census
  in evidence storage and coverage metrics, drop duplicate in-memory Doppler detail objects, and retain the existing
  board cgroup and signer boundary.
- Bound the restart source projection after the live catalog reached 82 MB: retain every discovered target and PoolKey,
  move reconstructable log fields exclusively to the append-only evidence store, derive visible Doppler facts from its
  complete target index, and require an exclusive hash-verified backup for the one-shot schema-v5 migration.
- Add a separate bounded WETH-principal executor and a single dual-v3 signing lane. The signer-free board can quote
  USDG and WETH cycles at one fixed block; exact candidates are re-simulated at one current block and only the largest
  conservatively normalized net profit is signed. Retained profit compounds independently, while both bases share one
  nonce, UNKNOWN barrier, durable revocation, ETH reserve and failed-Gas breaker. Production deployment and the
  receipt-separated runtime evidence are recorded without claiming an unobserved dual-era profit.
- Stream the growing source catalog through a bounded canonical atomic writer, reference its hash from SQLite economic
  checkpoints instead of copying the full document, preserve the signer feed across board restarts and retry transient
  `ENOENT`/`ESTALE` feed loss without weakening permission, integrity or signing gates.
- Add an explicit until-revoked generic watcher authorization. It has no wall-clock expiry, compounds only from
  confirmed executor USDG post-balances up to the immutable 100 USDG contract cap, and retains failed-Gas, ETH-reserve,
  exact-profit, nonce, unresolved-mutation and manual-revocation breakers.
- Serve the signer bridge a compact fresh-positive board view and retry board-only transport failures indefinitely with
  bounded backoff. Dashboard clients keep the complete snapshot, and execution-RPC failures retain their finite halt.
- Persist the compact signer projection atomically and let the Linux watcher read it through a read-only Unix group,
  decoupling candidate consumption from the board scanner's single HTTP event loop without sharing signer state.
- Keep that signer projection in a dedicated mode-0750 runtime directory so the board's private SQLite directory can
  remain mode 0700. Add an explicit, default-off public execution-RPC exception for reviewed provider outages.
- Add opt-in rolling leases for the autonomous generic watcher. Renewal runs inside the existing Linux process, keeps
  one authorization ID so failed Gas and all usage remain cumulative, revalidates deployment/balance/nonce/reserve
  invariants, retries transient provider failures and cannot revive an expired lease.
- Accept the deployed signer-free board's additive schema-v4 snapshot through one shared generic execution/runtime
  identity gate while retaining the existing service identity, read-only mode, authorization flag and same-block
  pool-attestation checks.
- Raise only the signer-free board's cgroup headroom to `MemoryHigh=448M` and `MemoryMax=512M` after sustained live
  scanning at the prior pressure threshold starved its loopback snapshot API; signer limits and execution authority are
  unchanged.
- Allow the generic watcher authorization to declare confirmed executions, signed attempts and exact preflights as
  `unlimited`, while retaining expiry, failed-Gas, ETH-reserve, exact-profit, principal, nonce and unresolved-mutation
  circuit breakers. Fixed-route watcher limits remain unchanged.

## 0.6.2 — 2026-09-07

- Advance one bounded hot-log range before consuming an existing candidate backlog, so quote work cannot starve the
  PoolManager/V3 event cursor.
- Preserve the four-candidate quote cap: a successful poll may coalesce newer revisions into the queue, while a failed
  public-RPC poll records the error but still permits already-observed candidates to progress.
- Resolve the active wake queue only after polling, so a canonical reorg rewind cannot leak stale pre-reorg wakes.
- Keep the release signer-free: executor bytecode, watcher authorization, wallet state and broadcast paths are unchanged.

## 0.6.1 — 2026-09-07

- Reject the v0.6.0 production canary after its first source projection reached the 256 MiB cgroup ceiling; roll back
  without starting either signer or changing the wallet nonce.
- Retain PoolManager facts only when a currency is an independently discovered PAIR, LONG or Doppler target, and give
  the generic pool scan its own cursor instead of inheriting PAIR chain-catalog coverage.
- Keep a compact Doppler target index so later pools remain discoverable, while exposing only PAIR-, LONG-, multi-pool-
  or pending-scan rows and persisting full immutable log evidence before compaction.
- Replace repeated full-snapshot/source-catalog ledger records with bounded singleton SQLite current projections plus
  append-only source evidence, economic events, material positive observations and compact integrity checkpoints.
- Add crash-safe JSONL byte offsets and streaming legacy replay; preserve the v0.6.0 database and ledger without
  deleting or rewriting historical evidence.
- Set the board-only memory pressure boundary to 320 MiB and its hard cgroup ceiling to 384 MiB after a migration test;
  signer services remain disabled and isolated.
- Promote the commit-addressed artifact after Linux migration, bounded-growth, public-RPC, desktop/mobile UI and
  signer-non-mutation gates; backfill NINECAT as LONG route / Doppler / Uniswap v4 without PAIR attribution.

## 0.6.0 — 2026-09-07

- Add independent PAIR-listing, LONG-route, Doppler-protocol, Uniswap-v4 and Robinhood-asset adapters with bounded
  coverage and claim-level immutable evidence; unknown or conflicting claims fail closed.
- Correct the NINECAT projection to `LONG_ROUTE / DOPPLER / UNISWAP_V4 / NINECAT-AI` and keep both assets custom unless
  the canonical Robinhood registry proves otherwise.
- Materialize current board state in SQLite while retaining an append-only JSONL evidence ledger, replay, parity checks
  and a non-destructive legacy read-model rollback.
- Add a signer-free React/Vite private console with Overview, paginated Radar, source coverage, episodes, read-only
  execution and system-pressure views; full evidence loads only when a row is opened.
- Keep the dashboard loopback-only and same-origin, reject mutating API methods, omit signer material and preserve the
  public-RPC observation profile.
- Override `solc`'s legacy temporary-file helper with compatible `tmp@0.2.7`, closing the current npm audit findings
  without changing the Solidity compiler.

## 0.5.4 — 2026-09-07

- Normalize the obsolete executor-deployment estimate when recovering persisted board state, so stale rows cannot retain
  the inaccurate v0.5.2 label after an upgrade.

## 0.5.3 — 2026-09-07

- Describe board-only screens as requiring an exact executor preflight instead of incorrectly claiming that the already
  deployed generic executor does not exist.

## 0.5.2 — 2026-09-07

- Put a hard deadline around event waiting so a continuously busy pool-event stream cannot starve periodic catalog
  coverage, stale-state reconciliation or durable `Initialize`-log backfill.
- Publish the last and next mandatory reconciliation timestamps with the event metrics.

## 0.5.1 — 2026-09-07

- Treat an identity-only viem `UnknownRpcError` as incomplete transport evidence after EVM-revert identity has been
  excluded, so a missing batch item cannot collapse into a false no-route business result.
- Retry all bounded chain reads consistently and fail over once from batched JSON-RPC to independent requests when the
  provider returns a malformed or incomplete batch response; expose the active mode and fallback evidence in metrics.

## 0.5.0 — 2026-09-07

- Replace repeated hot full-board scans with bounded public-HTTP PoolManager/V3 event wakeups plus a slower coverage
  reconciliation; persist canonical cursors, deduplicate logs and rewind on a block-hash mismatch.
- Merge stable 1,000-row PAIR API pagination with incremental PoolManager `Initialize` backfill, while reporting chain
  completeness only from the configured start block.
- Recompute every API PoolKey and separate shadow admission from live admission. Disabled quotes, unknown depth and the
  API-observed undocumented Launch V2 hook cannot enter a schema-v3 execution plan.
- Require both selected pools to carry same-block V4 Quoter attestation before the current generic executor accepts a
  schema-v3 board candidate.
- Count economic opportunity episodes rather than quote refreshes, and append a migration epoch so stale or unquotable
  gaps do not inflate frequency.
- Publish event-engine metrics and chain-catalog evidence through loopback-only endpoints and the dashboard.
- Deduplicate identical V3 anchor quotes within one fixed block and transport independent JSON-RPC calls in bounded HTTP
  batches, while reporting HTTP POSTs separately from contract-call and provider-billing claims.
- Bound periodic work to priority rows, actual positive rows and one configured coverage batch; retain failed V3 factory
  evidence for the fixed block and trip a cycle-level RPC circuit instead of amplifying a provider outage.
- Rotate two historical priority rows per cycle and make full-grid expansion evidence-driven instead of spending public
  RPC capacity on every no-edge priority row.
- Separate candidate concurrency from within-candidate leg concurrency so independent fixed-block calls can share a
  bounded HTTP batch without expanding multiple candidate grids at once.
- Re-rank the complete allowed V3 path set on the first amount of every fixed block, then quote only its top-three
  shortlist for larger amounts; reduce the coarse amount grid to 5/10/25/50/100 USDG before bounded refinement.

- Treat the exact latest unresolved signed generic execution as the already-reserved current attempt at the final
  broadcast boundary, so the last authorized attempt can be sent without permitting an additional attempt.
- Fail closed when the signed-attempt identity, authorization, ordering, ledger count or unresolved state differs from
  the current immutable plan.
- Redact credentialized HTTP and WebSocket URLs before provider errors enter runtime state, audit logs or CLI stack
  output.
- Add an explicit two-reader `--abandon-expired` reconciliation terminal for unbroadcast generic executions and reject
  attempts to replay a raw transaction after its on-chain deadline.
- Project canonical audit-ledger usage over stale watcher snapshots and refresh persisted counters on every terminal or
  degraded watcher path, so operational readback cannot under-report signed attempts.

## 0.4.0 — 2026-09-05

- Add an expiring, bounded generic-v2 authorization and autonomous Linux watcher.
- Keep idle discovery on the signer-free loopback board; use the strategy RPC only for one newly triggered candidate's exact preflight, signing and receipt convergence.
- Independently cap exact preflights, signed attempts, confirmed executions, failed gas, per-transaction principal and authorization lifetime.
- Revalidate the authorization immediately before and immediately after signing, and refuse a public RPC in the live mutation lane.
- Mutually exclude fixed and generic watcher generations in code and systemd while retaining the shared wallet lock and UNKNOWN barrier.
- Require receipt, event, executor balance, wallet Gas delta and contemporaneous native mark before a generic execution becomes a terminal economic effect.
- Add hardened one-shot deployment and arm units plus a persistent generic watcher unit.
- Give the deployment one-shot a 180-second start timeout so its 120-second canonical receipt wait cannot be killed by
  systemd's default start timeout.
- Clear a recovered board-transport error from watcher readback as soon as the loopback board succeeds again.

## 0.3.0 — 2026-09-05

- Add a typed generic PAIR executor for stock, AI, meme and other quote assets without arbitrary call targets.
- Enforce the 100 USDG cap, canonical PAIR pool shape, V3 fee allowlist and direct-or-one-WETH-bridge anchors on-chain.
- Add adaptive amount search through 100 USDG, bounded midpoint refinement and maximum absolute net-profit selection.
- Pace full-grid refreshes for persistent candidates and ship a conservative official-public-RPC board profile.
- Enforce a post-cycle public-RPC cooldown even when a long scan exceeds its nominal interval.
- Publish complete typed route payloads for positive amount variants and exact-preflight the strongest candidates.
- Add generic deploy, one-shot execute, UNKNOWN reconcile and withdrawal commands with raw-before-broadcast persistence.
- Add deterministic direct/bridged contract coverage, historical mainnet-fork verification and a validated sniper spec.

## 0.2.2 — 2026-09-04

- Reconcile the newest-token page before deciding whether a moving PAIR pagination pass covered its advertised total.
- Keep up to 32 currently positive screens on the priority refresh path by default.

## 0.2.1 — 2026-09-04

- Permit only a client-local SSH forward to the loopback opportunity board while keeping arbitrary forwarding,
  GatewayPorts, tunnels and password authentication disabled.

## 0.2.0 — 2026-09-04

- Add a continuously refreshed PAIR multi-pool opportunity census with fixed-block four-leg quotes.
- Rank gross and gas-proxy net results without claiming generic execution or receipt evidence.
- Add an auto-refreshing loopback dashboard and append-only material-change ledger.
- Isolate the scanner under a signer-free Unix identity, read RPC, systemd unit and runtime directory.
- Add exact tests for discovery gates, gas math, stale fail-closed behavior, events and atomic publication.

## 0.1.3 — 2026-09-04

- Accept systemd's immutable `0440 root:root` credential files only inside the unit-specific credentials directory.
- Keep ordinary signer files restricted to owner-only permissions and reject symlinks.

## 0.1.2 — 2026-09-04

- Bind the Linux signer to an encrypted systemd credential and remove the plaintext credential source path.
- Add bounded runtime resource controls and restart only after abnormal process termination.
- Resolve npm through the controlled service path during deployment verification.
- Add a key-only SSH hardening drop-in for the dedicated signing host.

## 0.1.1 — 2026-09-04

- Verify systemd service units on Linux CI and keep runtime startup read-only under the hardened filesystem sandbox.

## 0.1.0 — 2026-09-04

- Extract the MANGA CHAN route from the mixed LP workspace without changing deployed Solidity source.
- Add durable intent/plan/raw/effect mutation records and UNKNOWN reconciliation.
- Classify provider state-readiness failures separately from invariants.
- Replace five-second primary polling with targeted WSS swap triggers and a recovery poll.
- Add independent unit and deterministic Cancun EVM contract tests.
- Add automated style, type, compile, test, secret and CI gates.
- Add release, systemd, ADR and operations documentation.
