# Story: keep the until-revoked watcher safe across board restarts

## Outcome

As the live operator, I want a read-only opportunity-board restart to preserve or temporarily withdraw its execution
feed without terminating the independent signing watcher, so no-expiry authority remains available while every signing
gate stays fail-closed.

## Acceptance criteria

- A missing or stale filesystem handle for the configured execution feed is classified as board-only degradation and
  schedules another board read without execution RPC, preflight, signing or Gas.
- Unsafe permissions, symlinks, non-regular files, malformed JSON and oversize input remain hard invariant failures.
- The board runtime directory and its last complete feed survive an automatic systemd restart.
- The source-catalog writer atomically persists canonical JSON with a digest equal to the existing provenance hash while
  keeping its output buffer bounded.
- Economic snapshot commits retain source-catalog hash linkage without serializing the full catalog into every SQLite
  transaction.
- The existing board database, source files and append-only evidence are retained without deletion or rewrite of
  history.
- Local formatting, lint, types, systemd checks, Node tests, contract tests and secret scanning pass.
- Production acceptance requires both services active and enabled, unchanged nonce/balance/receipt state at cutover,
  zero watcher restarts, advancing feed generations, and a board process that survives beyond the prior observed OOM
  interval under the existing 448/512 MiB limits.

## Non-goals

- No trade authorization, principal, profit floor, Gas budget or contract bytecode changes.
- No claim that a running board creates profitable opportunities or improves sequencer ordering.
- No destructive database compaction, evidence deletion or provider migration.
