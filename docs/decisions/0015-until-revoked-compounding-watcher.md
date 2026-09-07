# ADR 0015: until-revoked compounding watcher

- Status: Accepted
- Date: 2026-09-08

## Context

The rolling generic watcher can operate continuously, but its authorization is still represented as a sequence of
seven-day leases and its principal ceiling is frozen at the executor balance observed when the arm is created. Retained
USDG profit therefore remains idle above that frozen ceiling. Production also showed that ten consecutive timeouts while
reading a 5.7 MB loopback snapshot stopped the signer even though the board later recovered, the nonce remained clean and
no transaction was pending.

The operator explicitly authorized no wall-clock expiry and automatic reuse of realized USDG profit. This does not
authorize removal of economic or state safety boundaries.

## Decision

Add opt-in schema-v3 authorization selected by `MANGA_GENERIC_WATCH_UNTIL_REVOKED=1`. It is mutually exclusive with
rolling renewal and commits:

1. `authorizationLifetime=UNTIL_REVOKED`, with no `expiresAt`;
2. `principalPolicy=REALIZED_EXECUTOR_BALANCE_UP_TO_HARD_CAP`;
3. the existing on-chain hard cap of 100 USDG;
4. deployment/code identity, nonce baseline, profit floors, ETH reserve, count policy and cumulative failed-Gas budget;
   and
5. the initial canonical executor USDG balance.

The current eligible principal is derived without an idle signer-RPC request. Before the first execution it is the
balance captured by the arm; afterward it is the most recent canonically confirmed `executorUsdgAfterWei`, capped at
100 USDG. External top-ups are not adopted during the same risk epoch. Immediately before signing, the watcher still
checks the actual on-chain executor balance and revalidates the authorization. Each transaction retains a fresh
45-second deadline and atomic profit floor.

The board keeps its complete dashboard snapshot but serves the watcher a query-selected view containing only fresh
screened-positive rows. The watcher retries board-only transport failures indefinitely with a capped backoff and reports
`DEGRADED_BOARD`; because this phase has no signer RPC, signature or broadcast, it is safe to wait for recovery. The
existing finite consecutive-error halt remains for execution-RPC failures. Durable disarm, UNKNOWN mutation, nonce,
deployment, invariant, exact-net, failed-Gas and ETH-reserve stops are unchanged.

Production later showed that the smaller HTTP response did not prevent scanner work from blocking the shared event
loop. [ADR 0016](0016-persisted-execution-feed.md) supersedes only this transport detail.

## Consequences

- The Linux watcher is the only continuous loop; no seven-day task, timer or Codex heartbeat is required.
- “Until revoked” means unlimited time authority, not unconditional trading. Any safety breaker can still halt and require
  operator review.
- Retained USDG increases the eligible ceiling automatically, but order sizing remains opportunity-driven over the
  bounded amount grid and never exceeds 100 USDG.
- Gas is paid in ETH, so USDG compounding does not replenish the operator wallet's ETH reserve.
- Changing deployment identity, hard cap, economics or adopting an external top-up requires disarm and a fresh arm.
- Runtime liveness and board screens are not economic proof; only canonical receipts and reconciled post-state are.
