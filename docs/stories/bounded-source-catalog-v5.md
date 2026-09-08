# Story: restart from a growing source catalog without weakening discovery

## Outcome

As the live operator, I want the signer-free opportunity board to restart from its complete discovered-target state
without duplicating immutable chain evidence into every runtime row, so continuous execution availability does not
depend on continually raising heap limits.

## Acceptance criteria

- Every pre-migration LONG target, Doppler target and retained PoolKey remains present after migration.
- Pool ID, currencies, fee, tick spacing and hook are byte-for-byte equivalent before and after migration.
- Every compact fact keeps its immutable evidence ID; full chain evidence remains in the append-only stores.
- Every referenced fact matches a hash-valid immutable SQLite receipt payload before any backup or replacement occurs.
- Detailed Doppler rows are derived from the target index and produce the same dashboard protocol attribution.
- The migration requires a new backup file and verifies its SHA-256 against the exact source preimage.
- The compact output is canonical, atomically replaced, mode `0640`, independently parseable and idempotent.
- Unit tests cover migration invariants, dashboard derivation and the executable CLI path.
- The actual 82 MB production preimage is tested locally before promotion.
- Production acceptance requires a fresh signer-free board feed, zero cgroup OOM events and no signing attempt during
  migration.

## Non-goals

- No pruning of discovered targets or potential routes.
- No deletion or compaction of the append-only evidence ledger or SQLite database.
- No change to contract bytecode, principal caps, profit floors, reserve, nonce or failed-Gas breakers.
- No claim of realized profit without a canonical successful receipt and reconciled post-state.
