# ADR 0088: Move Global catalog discovery out of the signing hot path

## Status

Accepted for implementation on 2026-09-15.

## Context

The first corrected production catalog refresh queried 179 V2 pairs and 716 V3 fee combinations through the official
public Robinhood Chain RPC. It required about 130 seconds and produced truthful partial evidence after 159 V2 and 512
V3 transport failures. The live Global child has a deliberate 60-second deadline.

The prior design let the legacy live child become the sole writer when a partial catalog was older than five minutes.
That means the evidence fix could make every later Global wake start a broad refresh that cannot fit its deadline.
Earn remains independently runnable, but Global would cycle through avoidable child timeouts and consume public and
managed RPC work without reaching exact route evaluation.

## Decision

- Make every Global search and execution process cache-only. Missing, malformed or six-hour-stale catalog state is a
  typed state-readiness failure for that lane; it never triggers broad discovery inline.
- Run the sole catalog writer as `manga-global-catalog.service`, activated by a persistent 15-minute systemd timer.
- Give the maintenance process no private-key credential, live authorization, managed RPC or WSS setting. It uses only
  the official public RPC and an allowlisted optional-settlement config.
- Serialize manual and scheduled writers with `global-catalog.lock`; continue publishing with temporary-file rename so
  readers observe either the prior valid generation or the next complete JSON document.
- Bound the slow lane with a six-minute timeout, 384 MiB memory ceiling and low CPU weight. A failed refresh preserves
  the preceding valid snapshot and cannot stop or restart the signer.
- Keep partial transport evidence explicit. The timer retries naturally, but a partial negative never becomes proof
  that no profitable route existed.

## Consequences

The 60-second live deadline now contains route selection, exact current-state validation and possible execution rather
than topology maintenance. Catalog load cannot delay Earn, and public RPC degradation is isolated to one recoverable
read model. New base topology may take up to one maintenance interval to appear; the separately rotating board V4
overlay continues on its existing cadence.

This change does not create atomic funding, improve Sequencer Feed coverage or prove profit. It changes no capital,
profit, Gas, nonce, simulation, submission or receipt boundary.

## Rollback

Stop and disable the catalog timer, revoke and stop the live watcher, reconcile the shared nonce lane, then restore the
preceding immutable release. Do not re-enable inline catalog writes as a production workaround; refresh a valid catalog
explicitly before re-arming the previous version.
