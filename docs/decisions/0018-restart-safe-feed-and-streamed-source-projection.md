# ADR 0018: restart-safe feed and streamed source projection

- Status: Accepted from production failure evidence; production soak pending
- Date: 2026-09-08

## Context

The persisted execution feed removed the signer's dependency on the board HTTP event loop, but the first sustained
production run exposed two coupled availability defects.

At `2026-09-07T19:18:30Z`, the signer-free board aborted with a V8 heap allocation failure. Its cgroup peak was about
448.5 MiB, below `MemoryMax=512M`, while the V8 old-space log was about 172 MiB. The current source catalog was about
45.5 MB as pretty JSON and 38.6 MB as compact JSON. A bounded standalone measurement showed that parsing and then
serializing that catalog raised JavaScript heap use to about 211 MiB. The board serialized the complete source catalog
both to an atomic JSON file and again inside every SQLite snapshot publication.

Systemd correctly restarted the read-only board, but removed and recreated its runtime directory during the restart.
The signer observed one `ENOENT` for `execution-snapshot.json`. Although ADR 0016 defines a missing feed as a board-only
degradation, the implementation classified that filesystem error as a hard invariant and deliberately exited. The
wallet nonce remained `12 / 12`, executor balance remained `33.021814 USDG`, and no exact preflight, signature,
broadcast, unresolved mutation or Gas expenditure occurred.

Increasing memory limits alone would preserve the duplicate serialization and allow source growth to consume more of
the 1.6 GiB host. Blindly restarting every watcher exit would also weaken the deliberate invariant and unknown-mutation
halts.

## Decision

1. The exact current source catalog remains an atomically replaced private JSON projection. Its writer recursively
   emits canonical JSON through a bounded 64 KiB buffer and calculates the SHA-256 commitment from the same bytes. It
   never constructs one source-catalog-sized output string.
2. SQLite remains the exact current economic snapshot and append-only material-evidence index. Routine snapshot commits
   reference the independently persisted source-catalog hash instead of copying the entire source catalog into SQLite
   again. Existing SQLite rows and JSONL evidence remain untouched for audit and rollback.
3. Dashboard projection reads the board's current in-memory source catalog. The source-catalog API streams the atomic
   file without reparsing and reserializing it. Runtime health identifies this boundary as `ATOMIC_HASHED_FILE`; it does
   not claim that the legacy SQLite source-catalog row advances with every source cursor.
4. The board unit sets `RuntimeDirectoryPreserve=restart`, retaining the last complete mode-`0640` feed across an
   automatic board restart. Atomic rename and quote-age gates still prevent a partial or stale candidate from reaching
   execution.
5. The watcher classifies only `ENOENT` and `ESTALE` while reading the configured feed as board availability failures.
   The board phase retries those failures indefinitely without loading the execution RPC or signer. `EACCES`, unsafe
   permissions, symlinks, non-regular files, oversized files and malformed JSON remain hard invariants.
6. Keep `MemoryHigh=448M` and `MemoryMax=512M`. A production soak must cross the observed failure window before this ADR
   is marked production-verified.

## Consequences

- A read-only board crash or restart no longer terminates an otherwise safe until-revoked authorization.
- Large source-catalog writes use bounded transient JavaScript memory, and routine economic commits no longer duplicate
  the catalog's serialized bytes.
- A preserved feed can be stale while the board restarts; existing freshness checks reject its candidates before exact
  preflight or signing.
- An indefinitely missing feed leaves the watcher alive in `DEGRADED_BOARD`. It does not create a trade or consume Gas,
  but it requires monitoring because opportunity discovery is unavailable.
- The board database and append-only ledger are not deleted, compacted or vacuumed by this change.
- Continuous authority still does not bypass nonce, identity, unresolved-mutation, profit, balance, reserve, failed-Gas
  or invariant breakers.
