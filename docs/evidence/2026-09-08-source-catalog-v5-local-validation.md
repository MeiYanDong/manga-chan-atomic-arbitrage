# Source-catalog schema-v5 local validation

- Date: 2026-09-08 (Asia/Shanghai)
- Input: read-only copy of the production `source-catalog.json`
- Production mutation: none during this validation
- Execution mutation: none; signer and wallet paths were not loaded

## Incident boundary

The production source projection was 82,341,726 bytes. The board exited with status 134 during cold JSON parsing and
reached the systemd start limit after five attempts. This happened before a dual-base execution feed or any signing
service was started. The WETH executor was not deployed.

## Production-size migration canary

The compactor ran against a temporary copy with an explicit 448 MiB old-space allowance. It created an exclusive
backup, verified the backup against the preimage hash, compacted in place and atomically wrote canonical JSON.

```text
before bytes: 82,341,726
after bytes:  39,512,656
before SHA-256: d5dfe809e6d18281a8cf7d90bba962ef52cebeb8b14f29c457ead136e15894a9
after SHA-256:  505c406fb621e35e06113910a145a2138ad83265d87eb85b11c1457c38518d2e
LONG facts: 21,116
Doppler targets: 39,679
retained pools: 59,532
source targets: 42,032
duplicate detailed Doppler rows removed: 21,358
duplicate object fields removed: 712,348
maximum resident set during one-shot migration: 641,679,360 bytes
```

The backup hash exactly matched the input hash. A separate 320 MiB-old-space verifier parsed and validated the compact
file with a maximum RSS of 429,064,192 bytes. A repeated compaction returned `SOURCE_CATALOG_ALREADY_CURRENT` and did
not create another backup.

Before promotion, a read-only production query checked all 141,685 fact references against `board.sqlite`. It found
120,327 unique receipt-log evidence rows; every row was `OBSERVED`, every payload hash recomputed exactly, and every
retained target/PoolKey field matched its immutable payload. This query did not modify the source file or database.

## Board cold-start canary

The compact production-size file was copied into an isolated temporary board runtime. With a deliberately unreachable
read-only RPC and no signer configuration, the board constructed its SQLite/runtime state and emitted
`BOARD_HTTP_READY`. Its first cycle degraded only because the test RPC was unreachable. The process exited cleanly on
SIGINT; no execution RPC, key, signature or broadcast path was present.

## Local gates at this checkpoint

- Full repository gate: passed.
- Node tests: 176 passed, including evidence-missing fail-closed coverage.
- All three deterministic contract suites: passed.
- Formatting, JavaScript/Solidity/shell lint, checked-JavaScript types, Vite build and 182-file secret scan: passed.
- Linux/systemd production verification: pending the promotion workflow.

This evidence proves restart-projection preservation and bounded file size. It does not prove production liveness,
profitability, transaction ordering or realized profit.
