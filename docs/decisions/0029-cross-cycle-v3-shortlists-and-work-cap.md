# ADR 0029: cross-cycle V3 shortlists and a total quote-work cap

- Status: Accepted; production verification pending
- Date: 2026-09-09

## Context

The bounded Multicall fallback in v0.7.4 recovered route-level false negatives, but did not make the signer-free board
operationally timely on the official public RPC. A production periodic cycle issued 1,493 logical Quoter calls and took
about 10 minutes 38 seconds. A later event cycle issued 1,114 logical Quoter calls and took roughly eight minutes. The
hot cursor continued independently, but 156 candidate wakes accumulated and the process had made 16,403 HTTP posts
without finding a screened-positive row. The remaining amplification came from two sources: priority and positive rows
were added on top of the nominal coverage batch, and every new fixed block rediscovered every allowed V3 fee topology.

Cached amount outputs would be unsafe because reserves and Gas change. Route topology is different: it is a bounded
search hint that can be re-priced against the canonical Quoter at a new fixed block. The exact execution lane already
uses a separate current-block executor simulation and cannot treat board cache state as signing evidence.

## Decision

1. Apply one hard four-candidate cap to the union of priority, currently positive and rotating coverage rows. Reserve at
   least one slot for coverage when the catalog is non-empty.
2. Retain at most the three strongest structurally valid V3 paths for each token-in, token-out and approved-bridge
   direction. Hydrate only path evidence from previously successful fixed-block observations; never hydrate an amount
   output, Gas result or profitability result, and mark every startup seed stale.
3. Re-run the canonical V3 Quoter for every retained path at every cycle's current fixed block. Re-rank those fresh
   results for the requested amount.
4. Mark a direction stale when a `Swap` is observed in one of its retained pools and after five minutes. Event-triggered
   cycles use the stale topology with a fresh current-block quote but spend no full-discovery budget. Periodic cycles
   may fully rediscover at most two stale directions. A missing shortlist or one whose retained paths all fail is rebuilt.
5. Expose persistent shortlist hits, stale uses, refreshes, rebuilds, invalidations, seeded routes and current cache size
   separately from logical Quoter calls, Multicall groups and HTTP posts.
6. Do not change the execution RPC, screen floor, exact net-profit floor, principal caps, nonce discipline, reserve,
   failed-Gas breaker, signer authorization or receipt convergence rules.

## Consequences

- Normal event work scales with selected candidates and retained paths instead of the complete fee-route Cartesian
  product. Periodic alternative-route discovery remains bounded instead of disappearing.
- A newly created or newly superior V3 route outside the retained top three may be missed until a periodic refresh. This
  is an explicit discovery-completeness and availability cost, not evidence of loss or execution safety.
- A retained route can become economically obsolete between refreshes, but its output is always recalculated at the
  current fixed block. It cannot promote a transaction without the independent exact executor call, Gas estimate and
  all live signing gates.
- Production acceptance requires materially shorter completed cycles, lower logical Quoter-call counts, bounded cursor
  lag, a healthy signer-feed handoff and no increase in signer or failed-Gas usage absent a genuinely exact-positive
  candidate.
