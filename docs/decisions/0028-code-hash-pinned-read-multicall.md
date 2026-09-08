# ADR 0028: code-hash-pinned read Multicall for the public RPC

- Status: Revised after rejected v0.7.3 canary; production verification pending
- Date: 2026-09-09

## Context

Robinhood documents its public RPC as rate-limited and unsuitable for production-grade high-throughput or
latency-sensitive applications. The board nevertheless keeps broad signer-free discovery on that endpoint to avoid
spending the paid execution RPC while idle. Production showed the limit of the prior transport: JSON-RPC batches
returned incomplete envelopes and fell back to individual requests; one four-candidate event cycle then issued hundreds
of V3 logical calls, took minutes and eventually failed closed on throttling.

Robinhood Chain has code at the canonical Multicall3 address. A current-block readback identified runtime code hash
`0xd5c15df687b16f2ff992fc8d767b4216323184a2bbc6ee2f9c398c318e770891`. A live read-only parity probe at one fixed
block compared four USDG/WETH V3 paths and returned identical `amountOut` and Quoter Gas estimates through Multicall3
and direct calls.

The first v0.7.3 production canary disproved the assumption that every bounded route set could share one aggregate. At
one fixed block, 18 direct V3 calls returned route-level success or contract-revert evidence, while one 18-call
`aggregate3` request was rejected by the public RPC with `-32000`. Four-call groups restored most results, but one route
with a roughly 32.5 million Quoter Gas estimate failed in the group and succeeded directly. Aggregate failure is
therefore ambiguous evidence on this endpoint and cannot be cached as route absence.

## Decision

1. Pin both the canonical Multicall3 address and its Robinhood Chain runtime code hash. The first fixed-block cycle must
   verify non-empty bytecode and the exact hash before using aggregated reads.
2. Limit each `aggregate3` request to four subcalls at the selected fixed block. This covers one complete V3 Factory fee
   lookup while bounding Quoter execution pressure.
3. Repeat every failed aggregate subcall through its original direct read at the same block. A direct success recovers
   an aggregate false negative; a direct contract revert remains a route-level failure. The first direct transient
   failure stops all remaining fallbacks and fails the cycle closed so an outage cannot create a request storm.
4. Keep V4 Quoter calls direct. Their hook/caller context is part of the evidence boundary and is not changed merely to
   reduce transport requests.
5. Disable provider JSON-RPC batching in the production process. Multicall is the explicit logical aggregation layer;
   actual HTTP posts, grouped calls and subcalls are exposed as separate metrics.
6. Increase the bounded public-RPC retry base from 200 ms to 1,000 ms. Execution RPC retries, exact-profit admission,
   wallet authority and transaction behavior do not change.

## Consequences

- V3 path search should require fewer public HTTP requests without dropping heavy routes or route-level revert evidence.
- A missing or changed Multicall deployment fails the board closed instead of silently falling back to a high-volume
  individual-call storm.
- Multicall reduces request count, not EVM work, provider billing units or economic uncertainty. Runtime metrics expose
  aggregate requests, subcall failures, direct fallbacks, direct recoveries and transport-stop events separately.
  Production acceptance requires complete quote cycles with no throttling, current event-cursor evidence and measured
  HTTP-post reduction.
- The paid RPC remains isolated to same-block exact preflight, Gas estimation, signing/broadcast readback and receipt
  convergence after a signer-free proxy passes the configured threshold.
