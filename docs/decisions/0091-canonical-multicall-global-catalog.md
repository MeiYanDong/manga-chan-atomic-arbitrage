# ADR 0091: Compress the Global catalog through canonical Multicall3

## Status

Accepted for implementation on 2026-09-15.

## Context

v0.17.7 correctly recovered individual responses omitted from malformed official-public JSON-RPC batches and restored
the canonical Earn graph from 16 to 32 pools. Production still published only five V2 pools and zero V3 pools. The
stored typed classifications showed public throttling: recovering omitted logical responses as individual HTTP calls
turned a bounded graph of 179 V2 pairs and 716 V3 pair-fee queries into a burst of hundreds of requests. The endpoint
then throttled the remaining V2 reads and the complete V3 stage.

This was a transport-shape defect, not evidence that the chain had no V3 liquidity. Retrying harder would increase
load, and sending the signer-free maintenance workload to the paid endpoint would violate the public-first cost
boundary.

The same production readback also showed that sanitized provider errors still retained request-body and calldata
fragments. These fields were not public API output, but they were unnecessary durable data and contradicted the
purpose-only evidence model.

## Decision

- Read V2 `getPair`, V3 `getPool`, V2 reserves and V3 liquidity through canonical Multicall3 at one fixed block.
- Reuse the exact Multicall3 runtime code hash verified by the immediately preceding canonical Earn read. A missing or
  mismatched identity aborts the generation and preserves the preceding atomic snapshot.
- Bound each aggregate to 12 subcalls and issue aggregates sequentially. Do not use JSON-RPC batching inside this
  catalog path.
- Keep factory discovery and pool-state phases separate so a failed aggregate can remain typed partial evidence and
  exact prior-topology retention can still reconcile by pair or pair-plus-fee.
- Publish schema v4 with the Multicall policy, code hash, aggregate RPC count and logical subcall count. Readers validate
  the identity and feasible count bounds before accepting the snapshot.
- Store only `PUBLIC_RPC_NETWORK`, `PUBLIC_RPC_THROTTLED`, `PUBLIC_RPC_STATE_NOT_READY` or
  `PUBLIC_RPC_INVARIANT` for provider/subcall failures. Never persist endpoints, request bodies, calldata or raw provider
  diagnostics in the catalog.
- Preserve every existing current-state quote, Gas, balance, nonce, simulation, signing, submission and canonical
  receipt gate. Multicall changes discovery evidence only.

## Consequences

The public slow lane exchanges hundreds of bursty HTTP requests for a bounded sequence of larger read-only `eth_call`
requests. A live local probe of the official endpoint at block 63,606,133 completed all 895 factory queries and 223
pool-state reads in 95 aggregate requests over 47,239 ms. It found 32 current Earn pools, 29 V2 pools and 119 active V3
pools with complete query evidence. This probe proves read-path feasibility, not executable profit.

Larger Multicall payloads increase the blast radius of one transport failure, so each aggregate remains small, every
subcall retains ordered evidence and the existing six-hour exact-query topology retention remains active. The path is
still bounded by the six-minute maintenance service deadline and never runs inside the signer deadline.

## Rollback

Stop the live watcher, reconcile the shared nonce lane and restore the preceding immutable release. Schema-v3 readers
remain compatible with the v0.17.7 snapshot. Rebuild the catalog through the restored signer-free maintenance unit;
never hand-edit or downgrade a schema-v4 snapshot.
