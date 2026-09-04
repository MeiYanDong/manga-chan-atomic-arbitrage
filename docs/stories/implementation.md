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
