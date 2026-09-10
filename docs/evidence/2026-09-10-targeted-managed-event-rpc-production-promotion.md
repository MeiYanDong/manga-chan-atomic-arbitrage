# Targeted managed event-RPC production promotion — 2026-09-10

## Outcome

Release `6f3418340f91d2da62ef5d97ec50a38be2642e09` is active on the production signer-free board. Broad discovery,
PoolManager/V3 log polling, catalog backfill, shadow-only events and protected periodic reconciliation remain on
Robinhood's official public RPC. Only event quotes for `EXECUTOR_COMPATIBLE` or `EXECUTOR_SHAPE` candidates can select
the managed ChainStack HTTP reader.

This was a board-only read-path promotion. It did not add wallet access, signing authority, principal, routes, hooks,
profit thresholds or broadcast behavior. The dual watcher remained on release
`2f3007ddd9293863a56c0665cde30d6705b9f7a7` with the same process and authorization throughout the accepted cutover.

## Reviewed release and reproducible gates

- PR: [#97](https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/pull/97)
- merged release commit: `6f3418340f91d2da62ef5d97ec50a38be2642e09`
- protected-branch quality job:
  [34466516949 / 102836262582](https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/actions/runs/34466516949/job/102836262582)
- exact GitHub source archive SHA-256: `e1300b7fd3bb032ed51ace96d9b521ebda515d141bcb6566267e2774da627428`

The final local `npm run check` passed formatting, JavaScript/Solidity/shell lint, checked-JS type analysis, dashboard
build, all three Solidity compilations, 232 Node tests, all three deterministic Cancun contract suites and a 243-file
secret scan. GitHub CI passed the same repository quality gate.

The server independently downloaded the merged-commit archive and matched its SHA-256. The release installer then
passed the Linux systemd gate, 232 Node tests, all three deterministic contract suites and a 225-file artifact secret
scan before moving the `current` symlink. The installer explicitly reported that it did not arm or start a service.

## Same-block provider canary

Before enabling the board, a signer-free canary compared Robinhood's public reader and the managed reader against one
common fixed block and the same DOGE V4 PoolKey. Both readers returned chain ID `4663`, the fixed block hashes matched,
and all five Quoter calls per reader succeeded with internally consistent and identical output.

| Fixed-block V4 Quoter read | Success |      p50 | p95 / max |
| -------------------------- | ------: | -------: | --------: |
| official public RPC        |     5/5 | 84.28 ms | 148.14 ms |
| managed event reader       |     5/5 | 17.42 ms |  20.64 ms |

The two heads were five blocks apart before the script selected their common prior block. The canary made 16 logical
reads in total, eight per provider. Those bounded validation reads occurred outside the board process and therefore do
not appear in its durable daily budget counters. They prove same-block read consistency and point latency from this
host, not profitable ordering or inclusion.

## Rejected first health window and rollback

The first promotion attempt installed the reviewed release and passed the provider canary, but its 60-second startup
health window ended before the large persisted catalog completed restoration and served a healthy response. The gate
rejected the attempt and atomically restored the prior board environment, systemd unit, `current` symlink and release
marker. The report timer was restored, the old board restarted, and the signer process remained unchanged. No orphaned
board process remained.

Journal evidence showed no application exception. The new board had been started at `18:42:24 CST` and was stopped at
`18:43:24 CST`; the restored old board itself required roughly 59 seconds merely to expose HTTP and sometimes another
several seconds to answer while its first cycle was CPU-bound. The cause was therefore an unrealistically short
promotion observation window, not a passed health check being ignored or a managed-provider result mismatch.

After the restored board returned `HEALTHY`, the same verified release was promoted again with a longer bounded health
window. The accepted board started at `18:48:31 CST`, exposed loopback HTTP at `18:49:27 CST`, and returned healthy
persistent-state parity after its initial cycle. The report timer was restored only after that response. Rollback copies
of the prior private configuration and board unit remain on the host; neither contains new wallet or signing material.

## Natural production event evidence

The final soak sample recorded eight naturally triggered event quote cycles, all routed through the managed lane:

| Runtime counter                        |                  Value |
| -------------------------------------- | ---------------------: |
| admitted managed event candidates      |                      8 |
| managed logical JSON-RPC calls         |                    138 |
| managed HTTP failures                  |                      0 |
| public fallback calls                  |                      0 |
| budget/transient fallback cycles       |                      0 |
| remaining daily event-candidate budget |                    192 |
| remaining daily logical-call budget    |                  3,862 |
| managed request p50 / p95              |       16.06 / 64.41 ms |
| managed request p99 / max              | 5,157.18 / 5,418.40 ms |

The last completed event-to-quote measurement was still 26,855 ms. Earlier in the same run it was 30,535 ms. These
end-to-end figures remain orders of magnitude above ordinary provider-call latency because candidate work, multiple
dependent Quoter reads, queueing and local computation still contribute. The managed provider removes one observed
latency source; this short sample does not prove a durable opportunity-capture improvement.

At the final sample, the board was `HEALTHY`, both configured-start catalogs were complete, SQLite evidence parity was
true, 3,526 candidates were admitted, zero screened net-positive candidates existed and the compact execution feed was
empty. There was no endpoint value in API output or the new service journal. Private board configuration remained
`0640 root:manga-board`.

## Signer and economic readback

The board-only promotion left the original dual watcher main process at PID `265531`, its Node lock-holder at PID
`265553`, its working directory on release `2f3007ddd9293863a56c0665cde30d6705b9f7a7`, and its automatic restart count
at zero. A post-promotion, no-signature/no-broadcast canonical validation returned:

- chain ID `4663` and wallet nonce `15/15`;
- `35.344393 USDG` and `0.0032 WETH` in the two executors;
- `0.00262778655474 ETH` in the wallet for Gas;
- exact deployed runtime/source hashes and `unresolvedMutation=null`; and
- authorization `0x7039d0e14a6ccecb19f0ee4c75740362ab2a98b1e2eef43259a896bd3035cd62`, still
  `ARMED / UNTIL_REVOKED` with unchanged economic breakers.

The active authorization remained at two exact preflights, zero signed attempts, zero confirmed executions, zero
failed Gas and exactly `0 USDG` realized net. Historical generic-v2 receipt net remains `9.463562 USDG`, but it is not
attributed to this active strategy or used to justify more paid RPC capacity.

## Resource and expansion boundary

At the final readback, the board used approximately 404.0 MiB with a 448.7 MiB peak; the signer used 274.2 MiB with a
285.2 MiB peak. The board crossed its soft memory-high throttle during catalog work, but both cgroups had zero `max`,
`oom` and `oom_kill` events. Root disk utilization was 65%, and the Feishu business-report timer was active.

No ChainStack tier expansion is justified yet. The next stage is to reduce the remaining 26-31 second end-to-end quote
path and then observe canonical active-strategy receipts. Higher paid usage requires a completed window whose verified
receipt net remains positive after execution Gas and attributable provider cost, with no unresolved state and
acceptable failed-Gas behavior. Candidate volume, fast RPC samples, screens and historical profit are not substitutes.
