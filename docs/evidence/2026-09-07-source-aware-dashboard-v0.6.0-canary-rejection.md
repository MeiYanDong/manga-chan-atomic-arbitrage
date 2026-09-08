# v0.6.0 source-aware dashboard canary rejection

- Date: 2026-09-07
- Candidate commit: `4a4f30dc91e81429544ccd98cc7fe32013ebe718`
- Candidate tag: `v0.6.0`
- Release workflow: GitHub Actions run `34109305656` succeeded
- Artifact SHA-256: `0202eff65d8881270424c0c2cc496b19c86a75fd97b7cfa3f92a636b4bba49a9`
- Production host: `manga-chan-arb-us-west`
- Verdict: rejected and rolled back; this is not production-promotion evidence

## What passed

The GitHub artifact installed successfully and its Linux install-time gates passed: 113 Node tests, both deterministic
Cancun contract suites, systemd verification and a 122-file secret scan. The board started loopback-only, returned HTTP
200, reported SQLite schema v1 parity and exposed six read-only pages. `POST` returned 405. Neither signer service was
started or enabled.

## Why the canary was rejected

After the first source-aware dashboard projection, `MemoryPeak` reached the exact 256 MiB cgroup ceiling
(`268435456` bytes). `memory.events` showed `max=4296`, `oom=0` and `oom_kill=0`: the process had not yet been killed, but
there was no safe operating headroom.

The first 50,000-block source batch contained:

- 2,307 PAIR listings;
- 2 LongLauncher launches;
- 248 Doppler create facts;
- 1,984 PoolManager initialize facts;
- 2,555 discovered target addresses.

Only 58 of the 1,984 pools touched a discovered target. The persistence layout also repeated complete current
projections. At readback, the resulting files were approximately 83.4 MB for `evidence.jsonl`, 162.3 MB for
`board.sqlite`, 6.1 MB for `source-catalog.json` and 6.8 MB for `snapshot.json`.

## Rollback and non-mutation evidence

The board symlink and release environment were returned to commit
`ea1374841ce5a35757786c33f7e06d19b5b9905e` (`v0.5.4`), and only
`manga-opportunity-board.service` was restarted. It returned HTTP 200 on server-loopback port 8788 with `NRestarts=0`.
The fixed and generic signer services remained inactive.

The four signer-state file hashes matched the pre-canary snapshot exactly, and the public-chain wallet nonce remained
`latest=0x8`, `pending=0x8`. Therefore the rejected canary changed board read-model files but produced no signed attempt,
broadcast, receipt or wallet-state change. The v0.6.0 database and ledger were preserved for audit; they were not
deleted or rewritten.

## Required successor gate

v0.6.1 must demonstrate target-bound pool retention, bounded current projections, append-only material evidence,
successful legacy migration below the new cgroup boundary, healthy loopback/API readback, stable memory across multiple
cycles, unchanged signer-state hashes and unchanged wallet nonce before it can be called promoted.
