# ADR 0092: Pace and retry transient public Multicall aggregates

## Status

Accepted for implementation on 2026-09-15.

## Context

ADR 0091 reduced 1,118 logical V2/V3 reads to roughly 95 sequential Multicall requests. A local official-public probe
completed with no failures, but production shares the public egress and endpoint with the board and competitor census.
The first v0.17.8 production generation found 29 V2 and 84 V3 pools while 132 V3 queries failed. A second ordinary
generation preserved the prior topology and reached 94 V3 pools, but classified 179 V2 and 233 V3 queries as transient
failures. The cache behaved honestly, yet deterministic request bursts could not converge reliably.

This is an availability defect, not proof of missing pools, missed profit or insufficient capital. Moving broad reads
to ChainStack would violate the accepted public-first budget. Retrying every logical subcall would recreate the request
storm removed by ADR 0091.

## Decision

- Keep canonical Multicall3, fixed-block reads, 12-subcall aggregates and one-request concurrency.
- Enforce at least 250 ms between aggregate request starts across each phase.
- Retry only a thrown aggregate classified as `NETWORK`, `THROTTLED` or `STATE_NOT_READY`.
- Allow three total attempts, sleeping 750 ms and then 1,500 ms. Never retry invariant/result-shape failures.
- Count every transport attempt, scheduled retry and transient failure. Schema-v4 readers require the exact fixed
  policy and reject impossible relationships between base requests, retries, attempts and logical subcalls.
- Keep failed subcall identity and six-hour exact-query retention. Do not persist provider messages, endpoints,
  request bodies or calldata.
- Keep all signing, latest-state quote, Gas, balance, nonce, simulation, authorization, broadcast and receipt gates
  unchanged.

## Consequences

The slow catalog may take tens of seconds longer and can make up to three aggregate attempts under transient failure.
Its six-minute systemd deadline still bounds the process. Successful requests are paced instead of burst, while one
429 retries one aggregate rather than up to 12 independent calls. A final transient failure remains typed partial
evidence and may retain only the exact previously verified topology.

The maintenance process remains credential-free and uses only Robinhood Chain's official public RPC. This adds no paid
RPC usage, signer authority, transaction attempt or profit claim.

## Rollback

Stop the watcher, reconcile the shared wallet lane and restore the preceding immutable release. Rebuild a compatible
catalog with that release's maintenance service. Never hand-edit retry evidence or relabel a partial generation as
complete.

## Production follow-up

v0.17.9 showed that viem may resolve one throttled aggregate as an all-failure subcall array when `allowFailure` is
enabled, bypassing the thrown-error retry branch. [ADR 0093](0093-normalize-embedded-multicall-transport-failures.md)
defines the narrowly bounded normalization used to honor this ADR's retry policy.
