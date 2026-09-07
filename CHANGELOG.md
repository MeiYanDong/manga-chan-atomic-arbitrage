# Changelog

## Unreleased

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
