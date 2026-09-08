# Implementation stories

## S1 — Standalone safety boundary

Acceptance:

- only MANGA strategy files and exact required dependencies are present;
- the original LP project hashes remain unchanged;
- runtime, raw transaction and credential paths are ignored;
- secret/privacy scan passes before every public push.

## S2 — Durable mutation and UNKNOWN recovery

Acceptance:

- deploy, execute and withdraw persist one exact raw before broadcast;
- unresolved mutation blocks every new signer action;
- two-reader reconciliation detects pending, provisional, confirmed, absent, nonce-conflict and receipt-conflict states;
- the only permitted replay uses the identical raw transaction.

## S3 — Test and merge gate

Acceptance:

- formatting, JS/Solidity lint, checked-JS types, compile, unit, deterministic contract and secret scan commands pass;
- contract tests assert exact USDG output/profit, zero residuals and intended custom errors;
- GitHub Actions runs the same `npm run check` command;
- branch protection is read back before it is described as a required merge gate.

## S4 — Specifications and operations

Acceptance:

- mechanism, Race Thesis, Shot Policy, evidence boundaries and UNKNOWN semantics are documented;
- standalone repository, provider choice and signing-host promotion have ADRs;
- cutover, verification, alert and rollback procedures are executable.

## S5 — WSS and cloud delivery

Acceptance:

- exact V3 addresses and V4 pool IDs drive WSS triggers;
- duplicate/out-of-order events are tested;
- HTTP block readiness is bounded and classified separately from invariants;
- selected host/provider latency and quota are measured;
- old local lane is stopped before a fresh cloud arm;
- post-deploy readback includes release SHA, code hashes, nonce, balance, WSS/HTTP head and authorization.

## S6 — Read-only discovery

Acceptance:

- the full PAIR catalog and newest page refresh independently of the signing watcher;
- hidden, flagged, non-canonical, inactive and shallow pools cannot enter the quote set;
- stock, AI and meme quote assets use the same route model;
- catalog completeness and quote coverage are explicit fields.

## S7 — Fixed-block quote screen

Acceptance:

- all four route legs and the native mark use the same fixed block;
- V3 anchor fees are discovered on-chain rather than inferred from symbols;
- quote failure remains `UNQUOTABLE` and stale evidence becomes `STALE`;
- gas is labeled as a proxy and no row is called executable without an executor estimate.

## S8 — Durable live board

Acceptance:

- snapshot publication is atomic and event history is append-only;
- the interface refreshes without external JavaScript or font dependencies;
- search and evidence-status filtering work on desktop and mobile;
- initial census produces one baseline event; only additions and material economic changes produce later events.

## S9 — Isolated deployment

Acceptance:

- `manga-board` cannot read the signing strategy's config or credential;
- the board uses a dedicated read RPC, runtime directory and bounded systemd resources;
- HTTP binds to loopback and `/healthz` verifies runtime freshness;
- deployment readback proves both the board and the unchanged signing watcher are healthy.

## S10 — Bounded generic route and optimal amount

Acceptance:

- one executor accepts stock, AI, meme and other PAIR quote assets through the same typed route model;
- PoolManager, V3 factory/router, PAIR hook, V4 shape, V3 fees, WETH intermediary, hop count and 100 USDG cap are enforced
  on-chain;
- adaptive probes, full-grid refresh and midpoint refinement choose maximum absolute screened net profit rather than ROI
  or input size;
- deterministic tests assert exact direct and bridged execution, zero intermediate residuals, zero router allowances and
  every reviewed negative boundary;
- a selected real route passes a historical mainnet-fork execution with exact USDG delta and no mainnet broadcast.

Status: implemented and locally tested; mainnet deployment is not part of this story.

## S11 — Generic signing-lane promotion

Acceptance:

- the board publishes complete typed payloads for profitable amount variants while remaining signer-free;
- the signing lane exact-preflights a bounded candidate set and selects the greatest exact net USDG result;
- intent, plan, raw transaction, receipt, balance effect and UNKNOWN recovery share the wallet-wide durable ledger;
- deployment and withdrawal have the same raw-before-broadcast and canonical post-state checks;
- one current mainnet deployment is read back by source/code/operator/economic constants before the first live execution;
- a canonical receipt, event, balance delta and gas mark distinguish realized gross, marked net and UNKNOWN net.

Status: accepted for deployment and execution. The current mainnet executor identity was read back and the first
autonomous transaction has canonical receipt, event, balance-delta and marked-net evidence. The withdrawal path remains
implemented and tested but has not been invoked on this executor.

## S12 — Server-autonomous generic execution

Acceptance:

- idle monitoring reads only the loopback signer-free board and consumes no strategy RPC request;
- one new eligible opportunity escalates to one targeted exact-preflight path, with no retry of the same opportunity
  identity;
- an explicit arm binds executor/source/runtime identity, principal, screened and exact net floors, Gas reserve,
  lifetime, exact-preflight count, signed attempts, confirmed executions and failed Gas;
- authorization and stop state are rechecked at the final signing boundary;
- fixed and generic systemd services plus in-process locks enforce one signing generation and one wallet nonce lane;
- UNKNOWN receipt, nonce conflict, post-state mismatch, under-floor marked net, exhausted budget and invariant failure all
  stop the watcher;
- Linux CI validates the hardened deployment, arm and watcher units before merge;
- live promotion requires a commit-addressed release, deployment receipt, runtime verification, arm readback and active
  service readback.

Status: accepted for live operation. The first arm exposed the signed-attempt lifecycle defect covered by S13; after
two-reader recovery and repair, later bounded arms resumed canonical execution. The current schema-v2 rolling arm passed
protected-branch CI, commit-addressed Linux installation, clean cutover and active-service readback.

## S13 — Signed-attempt lifecycle repair

Acceptance:

- the final authorized signed attempt can cross its own broadcast boundary without being mistaken for a new attempt;
- only the exact latest unresolved `authorizationId + kind + intentId + planHash + hash + nonce` reservation receives
  that treatment;
- a mismatched, duplicate, terminal or stale reservation fails closed, and a sixth attempt remains blocked before
  signing;
- expiry, confirmed-execution, failed-Gas and exact-preflight limits remain independently enforced after signing;
- credentialized HTTP and WebSocket URLs are redacted before provider errors enter state, logs or CLI output;
- an explicit recovery command can close the old raw only after two independent readers prove absence and both chain
  heads are past its deadline; the expired raw can never enter the replay path.

Status: implementation, regression tests, protected-branch CI, commit-addressed server promotion and two-reader stale
raw reconciliation are complete. A working strategy-owned execution RPC and fresh authorization later restored the
watcher; eight canonical executions are now recorded in the deployment ledger.

## S14 — Economic opportunity episodes

Acceptance:

- one fresh positive opens a stable episode identity independent of block hash and route revision;
- stale, unquotable and missing observations cannot close or duplicate that episode;
- only a fresh economic negative closes it;
- entry, material change and exit records preserve gross, Gas proxy, net, block and evidence fields;
- a durable epoch marker distinguishes legacy biased history.

Status: implemented, deterministically tested and promoted with a preserved production epoch/history readback.

## S15 — Pool identity and chain catalog

Acceptance:

- every API pool recomputes its PoolKey hash before shadow admission;
- disabled quote assets and null depth remain observable without becoming live-compatible;
- undocumented or unsupported hooks fail closed at the generic plan boundary;
- bounded PoolManager `Initialize` backfill persists a cursor and lists multi-pool, singleton and ambiguous groups;
- completeness is reported only from the configured start block.

Status: implemented and production-observed against the public RPC. The durable cursor advanced under event load;
historical backfill remains partial and no earlier-than-configured-start completeness is claimed.

## S16 — Event-driven shadow wake

Acceptance:

- PoolManager and previously quoted V3 swap events map to only affected candidates;
- logs are deduplicated, cursor advancement is durable, rate-limit failure does not advance it and a block-hash mismatch
  rewinds a bounded lookback;
- event state never substitutes for a fixed-block quote;
- a slow round-robin reconciliation remains enabled for dependency coverage;
- runtime exposes event wakes, exact candidate count, Quoter-call totals and observed-log-to-quote latency.
- same-block anchor requests are deduplicated; V3 Factory and Quoter reads use code-hash-pinned Multicall3 aggregation,
  while an incomplete result set trips one cycle-level circuit instead of being cached as pool absence;
- a mandatory periodic deadline prevents continuous event traffic from starving coverage rotation and chain backfill.

Status: implementation and deterministic tests are complete. The prior JSON-batch production path was rejected after
incomplete envelopes and public-RPC throttling; Multicall production latency and request reduction remain pending.

## S17 — Hot-cursor progress independent of quote latency

Acceptance:

- one serial hot-poll task remains active while periodic and event-driven quote cycles await RPC responses;
- the poller advances the cursor and coalesces the queue but never drains it; the main scheduler consumes at most the
  configured four candidates per quote cycle;
- successful polls retain a fixed cadence, while public-RPC failures remain visible and use bounded exponential backoff;
- each hot range retains the latest swap per pool before candidate fan-out while preserving every Initialize fact;
- a newly queued wake releases the main scheduler's wait without waiting for the next full polling interval;
- the current catalog and persisted observations rebuild the dependency index before the cycle's fixed block;
- shutdown wakes both scheduler sleeps, joins the poll task and closes durable storage only after polling has stopped;
- production readback across a complete slow reconciliation shows advancing poll counts, head lag within the configured
  bound and no new stale-cursor fast-forward.

Status: implemented and deterministically tested for v0.7.1; production acceptance is pending a complete slow-cycle
observation. The earlier v0.6.2 poll-before-drain scheduler was insufficient because a single periodic quote cycle could
still block log polling for several minutes.

## S18 — Rolling live lease without risk reset

Acceptance:

- rolling renewal is opt-in and legacy arms retain manual expiry behavior;
- every lease revision preserves one authorization ID, so failed Gas and all usage remain cumulative;
- renewal occurs only inside the valid window after canonical deployment, clean mutation, nonce, principal and ETH
  reserve checks pass;
- transient provider failures retry before expiry, while expiry, nonce mismatch and invariant failure stop authority;
- an authorization-specific durable revocation marker prevents a concurrent stale renewal from undoing disarm;
- the Linux watcher owns renewal without a systemd timer, local scheduled task or Codex heartbeat;
- production promotion requires protected-branch CI, a clean controlled re-arm and readback of the new schema, lease,
  process, nonce, balance and unresolved-mutation state.

Status: implemented, passed protected-branch and Linux installer gates, and promoted through a clean schema-v1 disarm to
schema-v2 re-arm. Production readback proved the exact release, active process, rolling policy, zero new-arm failed Gas
and no unresolved mutation. The first real lease renewal is not yet observed.
