# ADR 0090: Retain verified topology across a partial catalog refresh

## Status

Accepted for implementation on 2026-09-15.

## Context

The first v0.17.4 production preflight completed in 8,677 ms instead of 59,709 ms, proving that streaming route
selection removed the immediate live deadline bottleneck. It also exposed a different failure: the current public-RPC
catalog generation contained 32 Earn pools and 860 V4 pools, but zero V2 and zero V3 pools. The preceding verified
generation had 29 V2 and 59 V3 pools. A truthful partial refresh atomically replaced the whole prior snapshot, so the
unified graph retained thousands of structural cycles but no valuation or atomic-funding admission.

An atomic file rename protects readers from a torn JSON document; it does not make a partial provider response a
complete replacement for prior knowledge. Treating the zero counts as a deterministic market change would silently
erase valid discovery. Treating every old pool as current forever would be worse: a removed or drained pool could
remain in the search graph indefinitely.

## Decision

- Publish catalog schema v2. Each V2/V3 pool carries a last-verification timestamp and an observation class.
- A current successful fixed-block read replaces prior evidence immediately.
- Retain a prior pool only when the current generation's exact V2 pair query or exact V3 pair-and-fee query failed with
  `NETWORK`, `THROTTLED` or `STATE_NOT_READY` classification.
- Do not retain across a deterministic no-pool result, zero reserve, zero active liquidity, invariant failure,
  malformed identity or unrelated query failure.
- Bound retained evidence to six hours, equal to the catalog access lifetime. Reject malformed, future-dated or stale
  pool evidence when any search process reads the snapshot.
- Persist fresh, retained and expired counts and validate them against the actual pool arrays before using the cache.
- Keep partial read evidence partial even when topology is retained. Retention restores discovery continuity, not proof
  of current liquidity, price, funding or profit.
- Preserve the existing execution boundary: exact current-state quote, Gas, balance, nonce, simulation, signed-raw,
  submission and canonical receipt checks remain mandatory.

## Consequences

A temporary public-RPC failure can no longer turn one incomplete refresh into a full six-hour blind spot for previously
verified V2/V3 pools. Successful reads converge the catalog back to current evidence, and deterministic negatives or
expiry remove old topology. The first release after an already-destructive refresh cannot reconstruct pools that no
longer exist in the local snapshot; maintenance must rediscover them through later successful public reads.

This does not solve partial Earn Vault discovery, add liquidity or flash funding, make the public RPC production-grade,
or prove an executable opportunity. It adds no signer, transaction, capital, managed-RPC or profit authority.

## Rollback

Revoke and stop the live watcher, reconcile the shared nonce lane, then restore the previous immutable release. The
schema-v1 reader remains compatible for rollback, but a schema-v2 catalog must not be rewritten by hand. Rebuild a
fresh catalog through the signer-free maintenance service before re-arming.
