# ADR 0020: evidence-linked source-catalog restart projection

- Status: Accepted; production verification pending
- Date: 2026-09-08

## Context

The dual-base production cutover restarted the signer-free board after the source backfill had continued from about
40 MB to 82,341,726 bytes. `JSON.parse` exhausted the cgroup-aware default V8 heap before the board could publish a
schema-v5 execution feed. Systemd made five bounded restart attempts and then stopped. The generic authorization had
already been durably revoked, both signing services stayed stopped, and no WETH deployment, signature or broadcast was
attempted.

The file retained 21,116 LONG launch facts, 21,358 detailed Doppler launch facts, a complete 39,679-target Doppler
index and 59,532 target-bound PoolManager facts. Receipt-log evidence had already been committed to the append-only
JSONL/SQLite store before each fact entered the restart projection. The projection nevertheless duplicated constant
adapter labels, transaction and block hashes, managers, attribution labels and other fields across tens of thousands
of objects. Detailed Doppler rows also duplicated facts derivable from the complete target index and retained pools.

Raising V8 and cgroup limits alone would postpone the same unbounded failure on a 1.6 GiB host. Deleting pools or launch
targets would make discovery incomplete and could hide a later second-pool opportunity.

## Decision

1. Source-catalog schema v5 is an evidence-linked restart projection. It retains every LONG target, every Doppler target
   and every already-admitted PoolKey, but each row contains only fields required to rebuild target identity, route
   identity, ordering and its immutable `evidenceId` link.
2. Full receipt payloads, transaction hashes, block hashes, contracts and attribution inputs stay in the existing
   append-only JSONL and SQLite evidence store. This migration does not delete, vacuum or rewrite those stores.
3. Detailed Doppler launch rows are no longer persisted. The dashboard derives the same visible set from the complete
   Doppler target index, retained pools, LONG facts, PAIR listings and the persisted PoolManager cursor. Platform and
   protocol labels remain semantic outputs, not repeated constants in every restart row.
4. A one-shot offline compactor performs an in-memory field deletion, not a second full object-graph copy. Before any
   backup or replacement it proves every referenced fact against a hash-valid immutable receipt payload in SQLite. It
   refuses non-regular files and requires an exclusive backup path. The backup must hash exactly to the preimage before
   an atomic canonical writer can replace the source projection.
5. Migration validation requires unchanged source-target membership, unchanged LONG and pool counts, exact PoolKey
   route fields, valid evidence links, schema/projection identity and an idempotent second run.
6. The board remains signer-free. It does not deploy, sign or broadcast until the compact catalog starts, publishes a
   fresh dual-base execution feed and survives a production observation window under the existing 448/512 MiB cgroup.

## Consequences

- The production-size local canary reduced the restart file from 82,341,726 to 39,512,656 bytes while retaining 21,116
  LONG facts, 39,679 Doppler targets, 59,532 pools and 42,032 independently discovered target addresses.
- A complete evidence record now requires the evidence ledger/SQLite row referenced by `evidenceId`; the restart JSON
  is intentionally not a second full audit copy.
- Existing source-catalog consumers must accept schema v5 and derive Doppler visibility. Dashboard API schema remains
  unchanged and continues to return semantic platform, protocol and venue fields.
- The pre-migration source file remains as rollback material. Removing that backup is a separate destructive decision.
- Profitability, ordering advantage and a confirmed WETH execution remain unproven until canonical receipts exist.
