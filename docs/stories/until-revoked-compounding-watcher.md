# Until-revoked compounding watcher stories

## Story 1: explicit no-expiry authority

As the operator, I can create an authorization that remains active until durable disarm, without a seven-day lease or
renewal scheduler.

Acceptance:

- `MANGA_GENERIC_WATCH_UNTIL_REVOKED=1` and auto-renew are mutually exclusive;
- the arm commits `UNTIL_REVOKED`, has no `expiresAt`, and keeps one authorization ID;
- fixed and rolling arms remain backward compatible; and
- durable disarm, deployment identity, nonce, UNKNOWN mutation, failed Gas, ETH reserve and exact-profit checks remain
  blocking.

## Story 2: confirmed-profit compounding

As the operator, I want retained USDG profit to increase the capital eligible for later opportunities without authorizing
an unlimited order.

Acceptance:

- current eligible principal starts from the canonical executor balance at arm time;
- each confirmed execution advances it from `executorUsdgAfterWei`;
- it never exceeds the deployed contract's 100 USDG amount cap;
- external top-ups do not silently change it; and
- the watcher rejects a board candidate above both this ledger-derived amount and the current on-chain balance.

## Story 3: recoverable board isolation

As the operator, I want a temporary signer-free board stall to pause discovery rather than permanently stop the live
service.

Acceptance:

- the board atomically writes only fresh screened-positive rows to a group-readable, non-writable execution projection;
- the Linux watcher reads that projection without access to board writes or signer-state access from the board;
- the full dashboard snapshot remains unchanged for users;
- board-only transport failures report `DEGRADED_BOARD` and retry with capped backoff regardless of count; and
- execution-RPC errors retain their finite halt threshold.

## Story 4: production promotion

As the operator, I want the new risk epoch promoted without an unjournaled transaction or ambiguous runtime state.

Acceptance:

- pull-request and protected-branch CI pass, and the exact commit-addressed artifact passes Linux gates;
- the old watcher stops cleanly with no unresolved mutation and the old arm is durably revoked;
- no deployment or trade is submitted during the cutover;
- the new readback shows `RUNNING`, `UNTIL_REVOKED`, no expiry, 100 USDG hard cap, current realized principal, clean
  nonce and zero new-arm failed Gas; and
- the compact loopback endpoint is measurably smaller and responds successfully after the board restart.

## Story 5: explicit provider-outage fallback

As the operator, I can keep the already-authorized lane available when the managed RPC is suspended, without silently
weakening transport policy.

Acceptance:

- the official public RPC remains rejected unless `MANGA_ALLOW_PUBLIC_EXECUTION_RPC=1` is explicit;
- the public endpoint passes chain, code, token, nonce, balance and exact-simulation checks before signing;
- idle discovery consumes only the local persisted feed; and
- missing independent receipt evidence remains `UNKNOWN` and blocks the next nonce.
