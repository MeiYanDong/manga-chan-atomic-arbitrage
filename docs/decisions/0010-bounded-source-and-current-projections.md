# ADR 0010: bound source retention and separate current projection from audit evidence

- Status: Accepted for v0.6.1; production promotion pending
- Date: 2026-09-07

## Context

The first v0.6.0 production canary correctly preserved source provenance, but its storage shape was not sustainable. A
single 50,000-block PoolManager batch retained 1,984 generic pools although only 58 touched a PAIR, LONG or Doppler
target. Five complete source-catalog projections consumed about 16.4 MB in SQLite. Twelve board revisions also retained
9,639 full opportunity projections and full snapshots, taking the board database to about 162 MB and the JSONL ledger
to about 83 MB in minutes. The board reached its 256 MiB cgroup ceiling without an OOM kill and was rolled back.

The immutable source logs and economic transitions are audit evidence. A repeated copy of every current negative row is
a cache/checkpoint, not new evidence. Treating both forms identically creates unbounded memory, database and disk growth.

## Decision

1. PoolManager source retention is target-driven. A pool is retained only when either currency is independently known
   from the PAIR catalog, LongLauncher or Doppler target index. A quote currency never recursively expands that set.
2. The PoolManager source adapter has its own persisted cursor. It cannot scan beyond the lesser of the LONG and Doppler
   launch cursors, so a launch and its same-block pool cannot be permanently missed. The PAIR chain catalog keeps a
   separate adapter identity and coverage claim.
3. Full decoded receipt-log evidence is committed to the append-only ledger before an in-memory fact is compacted.
   Doppler keeps a compact address/evidence index for every discovered target. The dashboard retains detailed Doppler
   rows only for PAIR-listed targets, LONG targets, targets with at least two retained pools, or launches whose pool
   range has not yet been scanned.
4. SQLite schema v2 stores the current snapshot, opportunities and source catalog in singleton/upsert projections.
   JSONL appends source evidence, economic events, material screened-positive observations and a compact hash checkpoint;
   it does not append every repeated negative opportunity or full source catalog.
5. A committed JSONL byte offset is updated in the same SQLite transaction as evidence insertion. A crash replays only
   the uncommitted tail. Pre-offset databases adopt a tail only when its final content-addressed record already exists in
   SQLite; otherwise replay is streaming and fail-closed.
6. Existing v0.6.0 rows and JSONL bytes remain untouched for rollback and audit. No automatic deletion, VACUUM or
   compaction is authorized by this change.
7. The board-only cgroup uses `MemoryHigh=320M` and `MemoryMax=384M`. This is headroom for the measured legacy migration,
   not a substitute for the bounded data model. The board still has no signer, credential or broadcast capability.

## Consequences

- Current API reads remain exact SQLite projections, while historical audit growth follows material evidence rather
  than `candidate count × scan count`.
- A single-pool Doppler launch is still counted in adapter coverage and retained in the compact target index, but is not
  presented as a multi-pool arbitrage row unless another independent reason makes it visible.
- Source coverage remains explicitly partial until all three source-chain cursors reach the safe head.
- Deleting the legacy database or ledger is a separate destructive maintenance decision and is not part of v0.6.1.
