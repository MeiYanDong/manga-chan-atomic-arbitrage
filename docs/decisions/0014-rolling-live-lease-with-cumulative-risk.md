# ADR 0014: rolling live lease with cumulative risk

- Status: Accepted
- Date: 2026-09-08

## Context

The generic watcher already runs continuously on Linux, but every authorization has one fixed expiry. Replacing the arm
each week would reset its authorization ID and make cumulative failed-Gas accounting appear fresh even though the same
operator, executor and strategy remained live. A local scheduler or Codex heartbeat would add another control plane and
would not belong in the signing hot path.

The requirement is continuous 7×24 execution without removing the time boundary, economic gates or explicit revocation
path.

## Decision

Add an opt-in schema-v2 rolling lease to the existing deterministic watcher loop. `MANGA_GENERIC_WATCH_AUTO_RENEW=1`
authorizes the watcher to advance its bounded liveness lease during the configured renewal window. The current
production profile uses a 168-hour lease with a 24-hour renewal window.

One immutable authorization ID represents the entire risk epoch. Its commitment includes the initial expiry, lease
duration and renewal window, plus the existing deployment, principal, profit, reserve, nonce and failed-Gas policy. It
does not include the mutable `expiresAt`, `lastRenewedAt` or `leaseRevision` fields. Consequently, audit-ledger usage and
failed Gas continue to accumulate across every lease revision.

A renewal is permitted only before the current lease expires and only after the watcher proves:

1. no unresolved signed mutation exists;
2. the canonical chain, executor bytecode, operator and deployment identity still match;
3. wallet latest and pending nonce equal the authorization baseline plus its confirmed executions;
4. the executor still holds USDG principal and the wallet remains above the committed ETH reserve; and
5. the existing authorization and economic budgets remain valid.

The watcher writes the new lease atomically and asserts that the authorization ID did not change. Disarm first writes a
durable authorization-specific revocation marker, so a concurrent stale renewal write cannot restore authority. A
transient RPC failure inside the renewal window schedules another attempt after five minutes while the old lease remains
valid. Expiry is a hard stop: an expired lease cannot renew or revive itself. Nonce, deployment, authorization or other
invariant failures halt immediately. Disarm remains an immediate explicit revocation path.

Schema v1 and auto-renew-disabled configurations retain manual renewal behavior. Enabling auto-renew against a legacy
arm fails closed until an operator performs a clean, controlled re-arm as schema v2.

## Consequences

- The Linux watcher remains the only scheduler; no systemd timer or Codex task is introduced.
- Count limits may independently be finite or `unlimited`, but the failed-Gas budget, ETH reserve, exact-profit floors,
  principal cap, nonce discipline and unresolved-mutation barrier never become unlimited implicitly.
- The principal cap remains fixed for the full risk epoch. Accrued profit does not silently widen the order-size authority;
  raising that cap requires disarm and a new explicit arm.
- Replacing an arm begins a new risk epoch and is an operator action, not an automatic recovery mechanism.
- Runtime and receipt readback, not service liveness alone, remain the evidence for safe operation and realized profit.
