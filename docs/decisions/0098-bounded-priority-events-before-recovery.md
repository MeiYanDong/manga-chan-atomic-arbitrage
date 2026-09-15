# ADR 0098: Admit priority market events before recovery under a hard deadline

Status: accepted

## Context

The unified supervisor serializes every signing decision, which is necessary for one wallet nonce domain. Its previous
scheduler always claimed every overdue periodic recovery before any market event. On v0.17.14 startup, an accepted
filtered event waited 43.79 seconds while startup recovery work ran. Earlier production evidence showed waits near 80
and 120 seconds. A stale market edge can disappear during that queue even when discovery itself is functioning.

Giving all events unconditional priority would create the opposite defect: a busy market could starve full recovery
coverage forever. Running multiple signer decisions concurrently would also weaken nonce and unresolved-transaction
isolation.

## Decision

1. The signer lane remains strictly serial.
2. Events with priority at least 80 may precede the oldest overdue recovery job only while that job is less than 30
   seconds late.
3. At 30 seconds of lateness, periodic recovery wins unconditionally.
4. Event work never advances or resets a periodic deadline.
5. The runtime snapshot and audit record actual deferrals and the lateness observed when they occur.
6. Lower-confidence public recovery events retain normal priority and cannot displace overdue coverage.

## Consequences

- Managed WSS events, filtered sequencer events and receipt-ready positive Global search results avoid an additional
  overdue recovery tranche when the bounded budget is still available.
- Periodic whole-graph coverage retains a deterministic hard admission deadline.
- Work already executing cannot be preempted. Separating Earn read-only search from the signer process remains a later
  architecture step if measured in-flight duration still dominates end-to-end latency.
