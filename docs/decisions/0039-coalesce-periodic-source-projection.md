# ADR 0039: coalesce periodic source projection commits

- Status: Accepted for implementation; production observation pending
- Date: 2026-09-10

## Context

Release `55df95ed9d152bd66bfe273cbee578caccb456b8` removed work proportional to the full source universe from ordinary
hot-log ingestion. Production then showed sub-second recent polls, but the protected periodic lane retained another
blocking cost: one cycle could call `writeSourceCatalog` after metadata refresh, Long/Doppler advancement, retained-pool
advancement and PAIR chain-catalog advancement.

The current source projection is 45,294,139 bytes. Each call synchronously canonicalizes and atomically replaces that
document. Repeating it does not create additional coverage because all four calls belong to the same fixed-block
periodic cycle. It can delay the loopback API and raises allocation pressure inside the board's 512 MiB cgroup.

Simply postponing every write creates a crash-consistency hazard. The independent hot poll also persists `state.json`.
If it recorded an advanced source adapter cursor before the corresponding source projection existed, a restart could
skip facts that were never represented by the durable catalog.

## Decision

- At the start of each protected periodic cycle, snapshot the source-adapter and PAIR chain-catalog cursors represented
  by the last durable source projection.
- Let metadata and all three source-advancement stages update only in-memory source facts and cursors during that cycle.
- Continue writing the smaller independent PAIR chain-catalog projection at its existing boundary.
- After all stages have run against the same fixed block, write one combined source catalog atomically, then persist the
  advanced runtime cursors.
- While the combined projection is deferred, every unrelated `persistState` call writes the pre-scan cursor snapshot.
- If the source projection succeeds but the runtime checkpoint fails, restore the in-memory deferral checkpoint. A
  restart or retry may re-observe the range idempotently, but cannot skip it.
- Publish cumulative write count, last write duration, completed coalesced-cycle count and total periodic-maintenance
  duration for production verification.

No source, pool, strategy route or candidate changes classification through this decision. Public/managed RPC routing,
quote limits, profit floors, capital limits, authorization, signing and transaction broadcasting are unchanged.

## Consequences and limits

- A successful protected periodic cycle performs one large source projection instead of as many as four.
- A crash can leave a newer projection beside an older cursor checkpoint. That is intentionally safe: restart repeats
  already ingested immutable evidence and rewrites the same canonical projection.
- An intermediate `SCANNING` publication may reference the preceding durable source-catalog hash until the final
  periodic commit. It cannot authorize execution; the signer still consumes only the compact positive feed and applies
  independent freshness, exact-simulation and economic gates.
- The remaining single 45 MB serialization is synchronous. Production telemetry must show whether one write is short
  enough; moving projection generation to a worker or changing its storage format is out of scope.
- Fewer writes do not create more opportunities or prove profit.

## Rollback

Restart only the signer-free board on release `55df95ed9d152bd66bfe273cbee578caccb456b8`. Do not restart or re-arm the
dual signer, and retain source evidence, cursors, quote-budget state and all economic ledgers.
