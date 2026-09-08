# Story S21: fresh event hot path

## User outcome

As the live operator, I want a new pool-price change to reach the exact execution gate before it expires, without moving
the broad scanner back onto the paid RPC or weakening any signing control.

## Acceptance criteria

- A warm periodic quote yields after a newly accepted event and before issuing another periodic RPC request.
- Pending candidates older than 20 seconds are discarded with a visible counter; the freshest candidate is selected.
- One event cycle quotes at most one candidate, two amounts per enabled base and two V4 pairs per amount.
- Event probes use a current fixed block and fresh Quoter calls; cached data selects topology only.
- A failed event shortlist remains incomplete and never triggers full topology discovery in the hot cycle.
- Periodic reconciliation remains enabled for full route, sizing and catalog coverage.
- The board remains signer-free, loopback-only and public-RPC-only.
- Exact preflight, Gas estimate, net-profit floor, principal caps, nonce, ETH reserve, failed-Gas breaker and receipt
  convergence are unchanged.
- Unit tests cover event revision preemption, stale-backlog eviction, newest-first ordering, touched-route selection and
  bounded amount selection.
- Production evidence records event latency, logical Quoter calls, public-RPC health, service restarts and signer usage.

## Out of scope

- A claim that the two-pair/two-amount hot probe is route-complete.
- More wallet capital, a lower profit floor, private order flow, paid discovery RPC or autonomous fund transfers.
- Counting a screen, simulation or reverted transaction as realized profit.
