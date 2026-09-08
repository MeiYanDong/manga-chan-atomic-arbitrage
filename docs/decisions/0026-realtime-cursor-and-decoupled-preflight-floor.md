# ADR 0026: real-time cursor recovery and decoupled preflight floor

- Status: Accepted
- Date: 2026-09-08

## Context

The PoolManager event cursor was more than one million Robinhood Chain blocks behind the head. Its configured
2,000-block query could exceed the provider's 10,000-log response limit, while retries against the old range could be
throttled. Historical source and pool catalogs had already reached the safe head, but the latency-sensitive cursor kept
replaying old swaps. A four-second poll therefore did not imply a four-second market view.

The live authorization also used `0.10 USDG` for both the cheap proxy screen and the exact execution requirement. Rows
between `0.05` and `0.10 USDG` never received the current-block executor simulation that could prove whether the proxy
was conservative, even though a failed exact call spends no transaction Gas.

## Decision

1. Historical catalog cursors and the latency-sensitive event cursor remain independent evidence surfaces.
2. The hot cursor uses at most 200 blocks per log request. If it falls more than 500 blocks behind the confirmed head,
   it records the exact skipped interval and resumes with the configured reorg lookback. The gap is never represented as
   complete event coverage.
3. The authorization commits two distinct floors. A proxy net of at least `0.05 USDG` may trigger current-block exact
   simulation and gas estimation. Signing still requires at least `0.10 USDG` exact normalized net after protected Gas.
4. The single signer, nonce lock, principal caps, failed-Gas breaker, wallet reserve, typed route checks, deadline,
   receipt reconciliation and manual revocation remain unchanged.
5. The dashboard exposes the result as real-time position and exact-preflight count in user language; block ranges and
   machine fields remain in the technical disclosure and API evidence.
6. Release-owned safety overrides are applied at `ExecStart`, because systemd `EnvironmentFile` values can otherwise
   retain and override an older deployment's value. Production readback must verify the value seen by the process, not
   merely the unit's declared `Environment=` list.

## Consequences

- Old event backlog no longer prevents current swaps from waking affected candidates.
- Every real-time gap is durable and visible, so improved latency is not misreported as historical completeness.
- More near-threshold candidates may consume read-only RPC calls. They cannot spend Gas unless the independent exact
  floor and every existing live invariant pass.
- Changing either floor changes the authorization commitment and therefore requires a clean disarm and fresh arm.

## Verification

- Unit tests cover stale-cursor recovery, cumulative skipped-block accounting and the no-gap current-cursor path.
- Policy tests cover `screen <= exact`, reject zero or stricter screen floors and accept both the prior and current
  policy version for safe rolling readback.
- Production promotion requires a new release identity, a hot cursor near the safe head, successful event log reads,
  clean wallet nonces, no unresolved mutation and a fresh authorization showing `0.05 / 0.10 USDG` floors.
