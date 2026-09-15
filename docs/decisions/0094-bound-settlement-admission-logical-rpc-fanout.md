# ADR 0094: Bound settlement admission by logical RPC fanout

## Status

Accepted for implementation on 2026-09-15.

## Context

The first v0.17.10 production Global preflight consumed a complete catalog and built a graph with 247 assets, 1,583
swap edges, 38 Earn hyperedges and 473 V4 pools. It selected 16 graph-valid settlement candidates for fixed-block
funding checks. Morpho independently held both USDG and WETH, and the universal executor also held WETH, but admission
reported one funded candidate and zero admitted assets with incomplete funding evidence.

The implementation limited the outer worker pool to eight candidates, but each worker issued three concurrent calls:
`decimals`, Morpho `balanceOf` and executor `balanceOf`. The real peak was therefore 24 logical calls. A valuation path
then used an unbounded `Promise.all`; a direct-plus-WETH graph can contain up to 20 V3 quote paths. Both contradicted
the documented eight-call public-RPC boundary.

## Decision

- Define one versioned settlement-read policy with an eight-logical-call ceiling.
- Run at most two funding candidates concurrently because every candidate owns three calls; the resulting peak is six.
- Evaluate at most eight V3 valuation paths concurrently, including exact Gas and normalization reads.
- Retry a whole fixed-block funding group or valuation leg once only when the error is explicitly classified
  `NETWORK`, `THROTTLED` or `STATE_NOT_READY`.
- Keep deterministic token metadata mismatches, missing funding, contract reverts and unsupported paths non-retryable.
- Publish only the policy, bounds and retry counts. Never publish endpoint URLs, calldata, request bodies or raw errors.
- Advance the settlement-admission policy commitment to V3 so a prior live authorization cannot silently adopt the
  changed discovery semantics.

## Consequences

The admission path stays below the measured public-RPC concurrency boundary and may recover one transient fixed-block
read without multiplying calls per failed subcall. A partially unavailable asset remains locally rejected; it cannot
be treated as funded, profitable or safe to sign. Other funded routes may continue through exact evaluation.

This is an evidence-availability change. It does not relax the protected net-profit floor, Gas reserve, failed-Gas
breaker, nonce equality, contract identity, latest-state simulation, single-signer ownership or canonical-receipt gate.

## Rollback

Revoke the active authorization, stop the watcher, reconcile the wallet lane and restore the prior immutable release.
Do not reuse a V3 settlement-policy authorization with a binary that implements V2 semantics.
