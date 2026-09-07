# Board restart resilience production promotion

- Date: 2026-09-08 (Asia/Shanghai)
- Production host: `manga-chan-arb-us-west`
- Pull request: [#58](https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/pull/58)
- Release commit: `b8ab13509be6f9c033d51054759162eaff5f34a1`
- Runtime verdict: accepted after a controlled board restart and a post-restart soak beyond the prior failure window
- Economic verdict at cutover: no ninth receipt, exact preflight, signature, broadcast or new realized profit

## Scope and evidence boundary

This release repairs two availability defects exposed by the first sustained persisted-feed run: whole-document source
catalog serialization exhausted the read-only board's V8 heap, and the signer treated the feed's transient absence
during the resulting board restart as a terminal invariant.

The correction does not change contract bytecode, authorization scope, amount selection, profit floors, failed-Gas
budget, ETH reserve, nonce policy or unresolved-mutation policy. Process liveness and feed movement remain operational
evidence only. Canonical receipts and reconciled post-state remain the only realized-profit evidence.

## Production incident

At `2026-09-07T19:18:30Z`, the board emitted `FATAL ERROR: CALL_AND_RETRY_LAST Allocation failed - JavaScript heap out
of memory`. The process exited with status 134 at `19:18:38Z`; its cgroup peak was about 448.5 MiB under the unchanged
`MemoryHigh=448M` and `MemoryMax=512M` boundaries. Systemd restarted the board ten seconds later.

During the runtime-directory recreation, the watcher observed:

```text
ENOENT: no such file or directory, lstat '/run/manga-opportunity-board-feed/execution-snapshot.json'
```

It recorded `generic_watch_halted_invariant` and exited at `19:18:39Z`. A second board heap failure and automatic restart
followed before the board was stopped to contain the loop. No automatic watcher restart was attempted because
`Restart=on-abnormal` intentionally leaves deliberate safety exits stopped for review.

Canonical readback after the incident was unchanged:

```text
walletEth=0.006783953354208
nonceLatest=12
noncePending=12
executorUsdg=33.021814
confirmedExecutions=8
newArmExactPreflights=0
newArmSignedAttempts=0
newArmConfirmedExecutions=0
newArmFailedGasWei=0
unresolvedMutation=null
```

This was a liveness failure with zero transaction or Gas effect.

## Root cause and correction

The private source catalog had grown to `45,455,395` bytes as pretty JSON and contained 33,536 retained target-bound
pools, 5,734 Long launches, 5,902 detailed Doppler launches and a 22,282-address Doppler target index. A standalone
bounded measurement showed that parsing and compactly serializing it consumed about 211 MiB of JavaScript heap and 271
MiB RSS before the rest of the board state and SQLite bindings were included.

Release `b8ab135`:

- writes recursively key-sorted source JSON through a bounded 64 KiB buffer and hashes the exact emitted bytes;
- keeps the exact current source catalog in its private atomic file and references that SHA-256 from economic SQLite
  checkpoints rather than copying the complete catalog into every snapshot transaction;
- streams the source-catalog HTTP response from an already-open file descriptor instead of parsing and reserializing
  it;
- sets `RuntimeDirectoryPreserve=restart`, retaining the last complete signer feed across automatic board restarts; and
- classifies only `ENOENT` and `ESTALE` feed reads as indefinitely retryable board availability failures. Permission,
  symlink, file-type, size and JSON-integrity failures remain terminal invariants.

The board cgroup limits were not raised. The existing 361 MB SQLite database and 174 MB append-only evidence ledger
were retained; no deletion, VACUUM, compaction or history rewrite occurred.

## Merge, artifact and gates

Pull-request CI run
[`34157083639`](https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/actions/runs/34157083639) and protected-branch CI
run [`34157182985`](https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/actions/runs/34157182985) passed. The exact
release archive matched locally and on the production host:

```text
7c16aee25a009a5e2ee1e272f6d20f70b933167b6b8ca1024910926f59c1bb5d
```

The complete local gate passed formatting, JavaScript/Solidity/shell lint, checked-JavaScript types, the Vite production
build, both compiler paths, 143 Node tests, both deterministic Cancun contract suites and a 159-file secret scan. The
production installer independently passed 143 Node tests, both contract suites, a 141-file artifact secret scan and
Linux `systemd-analyze`. Repository units passed; the only systemd warnings named the provider's unrelated
`cloudmonitor.service`.

The `sniper-engineering` specification validator passed. Its race-timing and sequencing evidence remain `UNKNOWN`; this
availability correction is not represented as a profitability or ordering improvement.

A production-size writer check ran the pre-cutover 45,455,395-byte catalog under a 176 MiB V8 heap. Heap use was 57 MiB
both immediately before and after the streaming write; the canonical output was 38,600,609 bytes and preserved the
pool, Long and Doppler collection counts. This is bounded-writer evidence, not full service-liveness evidence.

## Controlled cutover and restart test

The installer ran while both affected services were stopped and changed the `current` symlink only after all Linux
gates passed. The board started from the exact release at `2026-09-07T19:55:27Z`; its first source projection shrank to
about 38.6 MB and its mode remained `0640`. The dedicated runtime directory remained mode `0750`, and the compact feed
remained mode `0640`, both owned by `manga-board`.

Before the signer started, canonical runtime verification returned
`RUNTIME_VERIFIED_READY_FOR_GENERIC_ARM`, chain ID 4663, nonce `12 / 12`, executor balance `33.021814 USDG`, unchanged
contract source/runtime hashes, eight confirmed executions, no unresolved mutation, and a signer-free board identity.

The watcher entered `RUNNING` at `2026-09-07T19:56:51.636Z` under the unchanged authorization
`0x7e580b5ff19c2db13f25439c4b9b751a7db29e48e2d050f05e179462a0de0b21`. It retained:

```text
authorizationLifetime=UNTIL_REVOKED
expiresAt=null
principalPolicy=REALIZED_EXECUTOR_BALANCE_UP_TO_HARD_CAP
currentSpendablePrincipalUsdg=33.021814
principalHardCapUsdg=100
maxConfirmedExecutions=UNLIMITED
maxSignedAttempts=UNLIMITED
maxExactPreflights=UNLIMITED
maxFailedGasWei=1000000000000000
```

A controlled board-only restart then exercised the exact failure path. The execution-feed inode was `27107` both
immediately before and immediately after the restart command, proving the old complete file survived the process gap.
The new board later replaced it atomically with inode `27139`. The watcher retained PID `173431`, stayed `RUNNING`,
recorded zero restarts, zero board errors, zero execution-RPC errors and no new authorization event other than its
initial start. Usage and unresolved-mutation state remained zero/null.

## Production soak readback

The post-restart monitor sampled both units 38 times at 30-second intervals from `2026-09-07T19:58:58Z` through
`20:17:30Z`. This exceeded the previous approximately 15-minute heap-failure window. Every sample reported both units
active. The watcher and board each recorded zero post-cutover restarts, while feed generations advanced from 4 through
19 and the feed inode and modification time changed repeatedly. A subsequent status readback recorded generation 20.

The watcher remained `RUNNING` with zero board errors, zero execution-RPC errors, zero exact preflights, zero signed
attempts, zero confirmed executions and no unresolved mutation. Its cgroup current/peak memory was about 273/280 MiB.
The board's sampled memory ranged from about 365 MiB to 439 MiB, its service peak was about 470 MiB during startup, and
the final readback was about 371 MiB. Cgroup counters reported `max=0`, `oom=0` and `oom_kill=0`; the configured
`MemoryHigh=448M` and `MemoryMax=512M` limits were unchanged.

A complete source-catalog HTTP stream returned status 200 and 40,085,553 bytes in 4.158 seconds. The board's cgroup
memory changed from about 405 MiB to 417 MiB during that read, and both services remained active. This validates the
streaming read path without treating process health as transaction or profit evidence.

At `2026-09-07T20:26:02Z`, both units were enabled and active with zero post-cutover restarts. The authorization
remained `UNTIL_REVOKED`, the runtime had processed 31 board generations, and the watcher retained zero post-arm usage,
zero consecutive board or execution-RPC errors and no unresolved mutation. A canonical no-signature/no-broadcast
verification succeeded with chain ID 4663, wallet ETH `0.006783953354208`, nonce `12 / 12`, executor balance
`33.021814 USDG`, unchanged source/runtime code hashes and eight confirmed executions. No ninth receipt or new realized
profit was observed during this availability repair.

An earlier verification attempt at about `20:18Z` received HTTP 429 from the official public endpoint at
`eth_getCode`. One bounded retry after cooldown produced the successful canonical readback above. This is direct
evidence of the admitted public-RPC availability risk; it neither changed chain state nor interrupted the idle watcher.

## Remaining evidence

- The public execution RPC remains an explicitly admitted emergency fallback with rate-limit, latency, availability
  and ambiguous-broadcast risks.
- No live transaction has yet used that public execution fallback, and no independent receipt reader is configured.
- The first post-change confirmed execution and resulting compoundable-principal transition remain unobserved.
- Source-catalog backfill and board discovery latency remain separate from signer-feed availability.
- Direct signal causality, send-to-wire timing, sequencer position and race-loss telemetry remain unknown.
