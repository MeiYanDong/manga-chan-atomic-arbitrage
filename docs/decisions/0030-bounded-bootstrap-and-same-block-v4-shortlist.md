# ADR 0030: bounded V3 bootstrap and same-block V4 route-pair reuse

- Status: Accepted; production verification pending
- Date: 2026-09-09

## Context

v0.7.5 bounded total candidate count and reused successful V3 route topology, but its first production reconciliation
still took about eight minutes and 999 logical Quoter calls. It hydrated 109 V3 directions and 149 paths, yet one new
coverage candidate introduced cache misses. Eighteen directions ran discovery, producing 683 V3 and 362 V4 Quoter
calls. Only two stale directions had consumed the configured deep-refresh budget; a missing direction incorrectly fell
through to an unbounded full route search. Multiple amounts also repeated the same complete V4 pool-pair competition at
one fixed block.

## Decision

1. A missing V3 direction may consume a periodic full-discovery slot. If none remains, enumerate the structurally
   allowed topology but quote no more than eight distinct candidates, ordered deterministically by aggregate fee, hop
   count and path. This ordering is a discovery heuristic, not a price result.
2. Retain successful bounded-bootstrap routes as stale. Every use is freshly quoted, and later periodic selection can
   replace them through a complete route competition. If none of the eight paths quotes, return incomplete
   `UNQUOTABLE` evidence without claiming that every allowed path failed.
3. For one candidate, base asset and fixed block, let the first amount run the complete existing V4 pool competition.
   Retain at most its three strongest distinct entry/exit pool pairs. Later amounts freshly quote those pairs rather
   than repeat every pool permutation. Identical pool, direction and amount calls share one fixed-block read result.
4. Never carry the V4 pair shortlist across blocks. If every retained pair fails for a later amount, run one complete
   V4 competition at that amount to preserve availability.
5. Publish explicit bootstrap and V4 shortlist discovery, hit, miss and rebuild metrics. Do not alter the four-candidate
   cycle cap, two-direction periodic deep-refresh budget or any signing/economic boundary.

## Consequences

- A new direction has bounded current-cycle Quoter cost even when the catalog continuously adds coverage rows.
- A viable V3 path outside the first eight may wait for a later periodic full-discovery slot. A V4 pair that is not top
  three at the first probe amount may be missed at a later amount in the same block unless every retained pair fails.
  Both are explicit discovery-completeness costs and cannot authorize execution.
- Every retained path and pair is re-priced by the canonical Quoter at the exact fixed block and amount. Exact executor
  simulation, Gas estimation, principal caps, net-profit floor, nonce, reserve, authorization and receipt convergence
  remain independent and unchanged.
- Production acceptance requires a complete healthy cycle with materially fewer than v0.7.5's 999 logical Quoter
  calls, no cursor-lag breach, and no signer usage or failed Gas absent an exact-positive candidate.
