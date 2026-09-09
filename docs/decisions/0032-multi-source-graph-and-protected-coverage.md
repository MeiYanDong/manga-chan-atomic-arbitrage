# ADR 0032: multi-source strategy graph and protected coverage

- Status: Accepted and production-verified on v0.8.4; public-RPC coverage remains limited
- Date: 2026-09-09

## Context

The source census already retained PAIR listings, 22,000+ LONG launches, 41,000+ Doppler targets and 61,000+ relevant
PoolManager pools, but the quote catalog was still built only from PAIR API rows plus PAIR-hook inference. The dashboard
therefore displayed a large discovery census while only 861 targets could enter quote scheduling. Source collection and
strategy admission were disconnected.

The event scheduler had also recorded hundreds of periodic preemptions and no completed periodic reconciliation after
restart. Fast event wakes remained useful, but a continuously active stream could prevent the coverage cursor from
making progress. A running process therefore did not prove useful broad-market coverage.

## Decision

1. Join PAIR, LONG and Doppler target facts to PoolManager Initialize facts in a new bounded strategy graph. Preserve
   source attribution as independent facts; joining an asset into the graph does not relabel it as PAIR.
2. Admit only targets with at least two canonical V4 PoolKeys after normalization. Rank declared launch numeraires,
   the current executor PoolKey shape, known quote metadata and recent chain evidence, then retain at most eight pools
   per target. Existing PAIR API pools are never displaced by this bound.
3. Permit chain-attested arbitrary-hook pools to enter signer-free shadow quoting. Unknown hooks remain
   `SHADOW_ONLY_UNSUPPORTED_HOOK`; a successful quote never grants them execution authority.
4. Allow a chain-attested pool with the current executor's exact hook, fee and tick spacing to replace missing API depth
   with a successful requested-size V4 quote at the fixed observation block. The separate signer still requires both
   route pools to have same-block attestations, current-block exact simulation, exact Gas, minimum net profit and every
   existing authorization breaker.
5. Reserve one periodic candidate as a non-preemptible coverage tranche. Event polling continues independently and
   event quotes remain bounded, but new events can no longer abort the protected tranche. This supersedes ADR 0031's
   periodic-preemption decision; its event freshness, route and amount bounds remain in force.
6. Report service liveness and quote coverage separately. The dashboard exposes a Chinese decision funnel from source
   pools through multi-pool targets, admitted candidates, fresh results, proxy-positive screens and exact readiness.
   Partial fresh coverage is labelled limited, never healthy by implication.

## Consequences

- The current production census yields roughly 4,200 structurally quotable targets instead of the PAIR-only subset;
  the exact count remains runtime evidence and may change with the chain.
- Source-only singleton targets remain queryable in the durable source catalog but are not materialized as temporary
  strategy-token objects. They cannot form a two-pool route and allocating them increased cold-start memory pressure.
- A protected periodic cycle may delay an event wake by one bounded candidate. Production showed that a full topology
  for even one candidate could still require 165 Quoter calls, so the protected step samples one pair, one size and one
  bounded V3 route per direction. It cannot be interrupted into permanent starvation, and a sampled negative is not
  promoted into a claim of exhaustive route coverage.
- Most non-PAIR hook shapes remain observation-only. A universal executor would be a separate contract, audit and
  authorization decision; this ADR does not authorize it.
- A large source catalog is still not proof of an economic edge. Only a fresh proxy-positive quote can request exact
  preflight, and only a canonical receipt plus reconciled post-state can prove realized profit.
