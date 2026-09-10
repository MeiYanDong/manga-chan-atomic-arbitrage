# Targeted managed event-RPC local validation — 2026-09-10

## Outcome

Version `0.8.7` implements an opt-in, signer-free managed HTTP lane for fixed-block event quotes. It selects that lane
only for `EXECUTOR_COMPATIBLE` or `EXECUTOR_SHAPE` wakes. Public RPC remains the only route for event-log polling,
source and PoolManager backfill, shadow-only events and protected periodic coverage.

This document is local/repository evidence. It does not prove that production loaded the release, that a managed
Quoter call succeeded from the server, that an exact preflight ran or that a transaction produced profit.

## Cost and degradation boundary

- Daily budget state is durably stored outside Git before each managed request.
- Release-owned defaults cap 200 admitted event candidates and 4,000 logical JSON-RPC operations per UTC day.
- The managed transport has four-request concurrency and no hidden viem transport retry.
- A cap or transient transport failure changes the read-only event cycle to the public client. A contract/business
  revert remains route evidence and does not trigger provider switching.
- Runtime output separates HTTP posts, logical calls, fallback and p50/p95/p99/max latency. It explicitly does not
  equate logical calls to ChainStack request units or USD cost.
- Paid-tier expansion remains manual and requires current-strategy canonical receipt net after Gas and provider cost.

## Security and execution boundary

- The board still imports no wallet client, private-key loader, nonce owner or broadcast function.
- The private endpoint is accepted only with an explicit enable flag, HTTP(S), a non-public hostname and a value
  distinct from the public reader.
- No endpoint value is written to snapshots, logs, source, docs or tests.
- Exact executor simulation, final simulation, profit floors, principal, authorization, ETH reserve, failed-Gas,
  nonce, UNKNOWN and receipt/post-state gates are unchanged.

## Validation

`npm run check` passed on macOS with Node 22:

- Prettier, ESLint, Solhint and shell syntax;
- checked-JS type analysis;
- production dashboard build;
- three Solidity compilations;
- 232/232 Node tests;
- all three deterministic Cancun EVM contract suites; and
- repository secret/privacy scan.

New tests verify priority admission, persistent UTC-day rollover, both hard caps, no over-debit, JSON-RPC batch
accounting, latency percentiles and the board's signer isolation. Linux-only `systemd-analyze` remains a server-side
promotion gate because it is unavailable on macOS.

## Production prerequisites

Before enabling the lane, the server must prove the current board and dual watcher healthy, an empty execution feed,
no unresolved mutation and unchanged nonce/balances/authorization. The release artifact must pass Linux gates. Only
the managed HTTP URL value may be copied into the board's restricted environment; no signing environment or WSS/key
material may cross identities. A post-restart event quote must then prove the provider role and latency metrics before
the change is called production-observed.
