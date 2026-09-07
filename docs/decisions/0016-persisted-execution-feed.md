# ADR 0016: persisted execution feed

- Status: Accepted
- Date: 2026-09-08

## Context

ADR 0015 reduced the signer-facing HTTP response from about 5.76 MB to about 9.75 KB and made board-only failures
non-terminal. Production then showed up to 24 consecutive five-second request timeouts while the board performed a
large reconciliation cycle. Both services remained alive and no signer RPC or mutation occurred, but the watcher spent
those intervals in `DEGRADED_BOARD` because the scanner and HTTP server shared one Node event loop.

Increasing the request timeout would hide the symptom without isolating the dependency. Giving the board access to the
signer's runtime directory would invert the intended trust boundary. Reading the full multi-megabyte dashboard snapshot
once per second would avoid HTTP but waste parsing and cache bandwidth.

## Decision

The board atomically replaces a separate `execution-snapshot.json` after every published generation. The file contains
the same compact fresh-positive projection as the HTTP execution view and is mode `0640`, owned by `manga-board`.

On Linux, the signer account receives read-only membership in the board group and the board runtime directory is mode
`0750`. The board receives no group membership or write path into the signer runtime, configuration or credential
directories. The watcher unit selects the persisted file explicitly; loopback HTTP remains the development fallback.

The reader rejects non-regular files, symlinks, group/world-writable files and inputs larger than 16 MiB. It caches an
unchanged inode generation and continues to apply board identity, quote freshness, typed-route, arithmetic, exact
simulation, gas, balance, authorization and nonce gates before any signature.

## Consequences

- Long board computations no longer prevent the watcher from reading the most recent complete generation.
- A stale file cannot authorize a trade because candidate quote age still fails closed.
- Atomic rename exposes either the previous complete JSON or the next complete JSON, never a partial write.
- The signer can read public board artifacts in `/var/lib/manga-opportunity-board`; it cannot modify them.
- The board still owns discovery latency. This change isolates transport availability but does not make a slow scan
  faster or prove a race advantage.
- A missing, malformed, over-sized or permission-unsafe file remains a board-only degradation and never reaches the
  signer RPC.
