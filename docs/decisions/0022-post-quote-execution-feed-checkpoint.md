# ADR 0022: post-quote execution-feed checkpoint

- Status: Accepted; production verification pending
- Date: 2026-09-08

## Context

The signer-free board deliberately separates fast bounded quote batches from slower catalog reconciliation. A live
periodic cycle quoted one executable-shape USDG route at `2026-09-08T08:42:59.997Z`, then published the completed cycle
at `08:45:38.173Z` after catalog maintenance. The board correctly recorded a `0.003539 USDG` proxy-positive screen,
but the dual watcher correctly rejected the projection because its quote was already about 158 seconds old, beyond the
30-second signing horizon. The screen was also independently below the authorization's `0.1 USDG` screened-net floor,
so it was never an authorized exact-preflight candidate and no economic opportunity is claimed as missed.

Although that observed row was economically ineligible, the ordering exposed a general latency gap: a future route
above the profit floor could be quoted promptly yet reach the signer feed only after unrelated discovery work.
Increasing the watcher's freshness window would weaken the fixed-block safety boundary and would not fix the source of
the delay.

## Decision

1. Immediately after each selected quote batch, record the actual quote-completion time.
2. If at least one just-quoted candidate has a proxy-positive USDG or WETH lane, atomically publish the normal compact
   signer-free execution projection before launch, pool-source and chain-catalog maintenance.
3. Do not add an extra checkpoint for a batch containing no positive observation.
4. Retain the final post-maintenance board publication and the append-only economic episode semantics. Reconciliation
   against the checkpoint prevents duplicate episode-entry events.
5. Expose checkpoint count, timestamp and candidate count in read-only event-engine telemetry.
6. Keep the watcher freshness, typed route, pool attestation, authorization, screened-net, exact-net, principal, Gas,
   nonce, receipt and UNKNOWN gates unchanged.

## Consequences

- A newly quoted positive can be consumed while its evidence is still inside the strict signing horizon, even when
  catalog maintenance takes minutes.
- Positive batches add one bounded snapshot/SQLite checkpoint write. Ordinary non-positive cycles add none.
- A checkpoint remains screening evidence only. The exact same-block executor comparison must still pass before any
  signature or broadcast.
- Production acceptance requires observing a real checkpoint or a deterministic injected positive, confirming the
  watcher sees the generation, and proving no below-floor candidate reaches exact preflight.
