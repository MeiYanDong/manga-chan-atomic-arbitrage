# ADR 0093: Normalize embedded Multicall transport failures

## Status

Accepted for implementation on 2026-09-15.

## Context

v0.17.9 added pacing and transient aggregate retries, but its first production refresh completed with 48 V3 transport
errors, zero retries and zero transient failures. The rejected identities formed exactly three 12-query V3 factory
batches and one 12-query V3 pool-state batch. Every item was classified `THROTTLED`.

Viem's `multicall({ allowFailure: true })` can resolve a failed aggregate request as one failure result per ordered
subcall instead of throwing the transport error. The retry layer therefore saw a successful JavaScript return and did
not apply ADR 0092. Retrying arbitrary failed subcalls would be unsafe because genuine EVM reverts are also represented
as failure results.

## Decision

- Inspect one returned chunk only after its array shape and result count are validated.
- Promote it to one aggregate failure only when every result failed and every error class is `NETWORK`, `THROTTLED` or
  `STATE_NOT_READY`.
- Preserve the strongest typed class (`THROTTLED`, then `STATE_NOT_READY`, then `NETWORK`) without retaining raw error
  bodies.
- Feed that normalized error through the existing fixed three-attempt paced retry policy.
- Never promote a mixed success/failure array or an all-invariant failure array.
- Record `embeddedTransientBatches` and require it to be a non-negative subset of total transient failures before a
  schema-v4 cache is accepted.

## Consequences

One public-RPC 429 represented as 12 failed items now costs one bounded aggregate retry, not 12 direct calls. Genuine
per-subcall reverts keep their exact identities and do not fan out. The catalog remains fixed-block, public-only,
signer-free and outside the execution deadline.

This fixes availability evidence only. It creates no opportunity, transaction, receipt or profit claim.

## Rollback

Stop the live watcher, reconcile the wallet lane and restore the prior immutable release. Rebuild the catalog using the
restored policy; never relabel v0.17.9's partial snapshot as complete.
