# ADR 0023: bounded dual startup RPC retry before signer load

- Status: Accepted; production verification pending
- Date: 2026-09-08

## Context

After release `55177b8a28807b8ef91dded6f5378d6963a66467` passed Linux installation gates, the dual watcher was deliberately
restarted to load the release. Its first public-chain identity read received `429 Too Many Requests` from the configured
official public RPC. The process wrote `HALTED_STARTUP`, exited before loading a candidate or signing, and systemd
correctly did not reinterpret the failure as success. Stopping the signer-free board for eight seconds and manually
starting the same watcher allowed all canonical reads to pass; the original authorization, nonce and balances were
unchanged.

A single transport failure is neither evidence of an invariant violation nor a reason to weaken validation. Depending
on an operator to notice and restart the service, however, violates the requested continuous-runtime behavior.

## Decision

1. Wrap only the dual watcher's read-only startup evidence bundle in the existing classified retry helper.
2. Permit five total attempts with exponential delays of 1, 2, 4 and 8 seconds. A fifth transient failure remains a
   terminal `HALTED_STARTUP` and triggers the existing systemd failure path.
3. Retry only errors classified as state-not-ready, throttled or network transport. Business and identity invariants
   fail on their first observation.
4. Persist redacted retry state and append-only audit evidence for every delay.
5. Move private-credential loading after the chain identity, both deployment identities, both principal balances,
   wallet balance/nonce and authorization usage have converged.
6. Do not change runtime exact-preflight retry limits, authorization, provider, signing, broadcast or Gas policy.

## Consequences

- A brief official-RPC throttle can self-recover without an operator restart and without exposing the signer during the
  degraded period.
- Sustained public-RPC failure still halts after bounded attempts. This preserves a visible failure instead of hiding a
  provider outage in an unbounded loop.
- Startup can take up to 15 seconds of deliberate backoff plus RPC timeouts before becoming terminal.
- Production acceptance requires a controlled restart with the board active, one current generation consumed, canonical
  runtime readback and unchanged nonce/balances/usage.
