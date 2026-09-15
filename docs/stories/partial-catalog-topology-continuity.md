# Story: partial public reads do not erase the known market graph

## Outcome

As the live operator, I need a temporary public-RPC failure to remain visible without making every previously verified
V2/V3 or Earn pool disappear from Global discovery.

## Acceptance criteria

- each exact V2 pair and V3 pair-fee query is reconciled independently;
- public chain-head and canonical Earn identity reads avoid JSON-RPC batches and retry only transient failures;
- a logical response omitted from a broad public batch retries only that call directly on the same public endpoint;
- HTTP denial, throttling, ordinary errors and deterministic failures never trigger direct-call fanout;
- only transiently failed queries may reuse prior topology;
- only an exact transient Earn pool-state failure may reuse the matching prior canonical Earn pool;
- deterministic absence, zero liquidity and invariant failures never retain a prior pool;
- retained evidence expires after six hours and cannot be future-dated beyond the clock-skew bound;
- V2/V3 and Earn fresh, retained and expired counts match the pools actually published;
- a current successful query wins over a retained copy and cannot produce duplicates;
- an incomplete generation remains labeled partial and cannot prove no-profit;
- the catalog writer merges before the atomic file publication boundary;
- signer-free maintenance has no private key, managed RPC or transaction authority;
- exact current-state execution gates and canonical receipt accounting remain unchanged;
- local checks, GitHub CI, immutable release verification and production readback are required before live recovery.

## Non-goals

- no indefinite stale-pool cache;
- no inference that a retained pool still has liquidity or a profitable price;
- no new capital, Gas, provider budget, signer, contract deployment or transaction;
- no claim that the already-erased production generation can be reconstructed without new successful reads.
