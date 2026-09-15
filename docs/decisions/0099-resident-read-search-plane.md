# ADR 0099: Keep market search outside the serial signer lane

Status: accepted

## Context

The protected scheduler can reorder queued work but cannot preempt a child that is already running. Production
v0.17.15 therefore still observed a Global periodic job 46.759 seconds late while an Earn child performed read-only
discovery. That delay consumed most of a short-lived market edge before the signer began its exact checks.

Earn also accepted only schema-v1 catalog snapshots even though the current atomic catalog is schema v4. The rejected
cache silently forced repeated direct discovery. Global already had a resident event reader, but periodic recovery still
entered the serial scheduler first and a positive worker result caused the signer child to repeat full discovery.

## Decision

1. Earn and Global each own one coalescing resident read-search worker. Both event wakes and periodic recovery enter
   those workers before the protected signer scheduler.
2. Worker environments use explicit allowlists, force every live arm off, load no strategy config file, receive no
   managed RPC/WSS value and use only the official public reader plus immutable runtime paths and bounded tuning.
3. A negative result suppresses duplicate signer work only when its evidence is complete and no older than 15 seconds.
   Partial, unavailable, malformed or stale evidence never proves no opportunity.
4. An Earn positive hands a bounded route hint to its existing latest-state execution gate. A Global positive hands
   only graph commitment, catalog version, original state block, route ID, opportunity kind, settlement token,
   principal and funding mode.
5. The Global signer never executes a worker-supplied plan. It reloads the current atomic catalog, requires the same
   graph and catalog commitments, deterministically locates the route, rebuilds the typed plan and then checks current
   funding, latest quote, worst-case Gas, net floor, simulation, balance baseline, nonce and authorization before the
   private key can be loaded.
6. A Global positive hint expires after 60 seconds. Worker crash, timeout or protocol failure falls back only that
   adapter to the prior bounded child. Earn and Global periodic startup are staggered by 15 seconds.
7. The one wallet lock, nonce domain, unresolved-mutation quarantine, signing process and same-raw Sequencer submission
   remain unchanged.

## Consequences

- A slow public search no longer occupies the signer scheduler. Independent Earn and Global reads may overlap while
  every mutation remains serial.
- Fresh complete negatives avoid an immediate duplicate search; positives pay only bounded plan reconstruction and
  current execution truth in the signer lane.
- Schema-v1 through schema-v4 Earn catalog evidence can be reused only after its topology-retention counters and pool
  observations validate.
- The workers are credential-stripped child processes, not yet separate operating-system identities. The next security
  hardening step is a dedicated service identity and bounded Unix-socket protocol; this release does not claim that
  stronger isolation.
- A positive can still disappear during exact revalidation, and no local test or live preflight is profit evidence.
  Only a canonical successful receipt plus the accounting read model can establish realized profit.
