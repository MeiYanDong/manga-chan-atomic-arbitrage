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
