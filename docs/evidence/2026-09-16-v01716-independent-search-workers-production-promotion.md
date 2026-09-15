# v0.17.16 independent search workers production promotion — 2026-09-16

Evidence state: immutable release, controlled single-writer cutover, live authorization, two new canonical Earn
receipts and post-start worker recovery are verified. Future profitability remains unknown.

## Release identity and gates

- Pull request: <https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/pull/205>
- Merge commit: `1c1345da4fc219442af07c791bb4b9fae5f5b53b`
- Main quality run: <https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/actions/runs/35003652160>
- Release workflow: <https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/actions/runs/35004002655>
- Release: <https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/releases/tag/v0.17.16>
- Artifact SHA-256: `68a6cd73b91ebfdffec27966cfbe6b2e8f37619cc46968450437958dc33eea07`

The exact merged commit passed the full local gate before merge: 485 Node tests, four deterministic contract suites,
formatting, lint, type checking, UI build, four contract compilers and a 533-file secret scan. GitHub quality and release
workflows both completed successfully. Production downloaded the immutable release asset, matched its SHA-256, rebuilt
the runtime artifacts, passed the 518-file release secret scan and passed Linux `systemd-analyze verify`. The only unit
warnings belonged to Alibaba Cloud's preinstalled `cloudmonitor.service`.

## Controlled cutover

The exact target tuple was `default / us-west-1 / swas.us-west-1.aliyuncs.com /
cbe793c9cb9241ce97752334f65cab48 / manga-chan-arb-us-west / 47.251.185.146`. The SWAS control plane and Cloud Assistant
were available.

1. Invocation `t-usw6x5wt08vcxz4` read the old `v0.17.15` release, live services and current authorization. The watcher
   had no unresolved mutation; the unrelated Atomic Cycle service was PID `781` in release
   `8b67df7e9bc97acc9ddb95c63e21957bda61b2a5`.
2. Invocation `t-usw6x5wzkkwiha8` downloaded and verified the v0.17.16 artifact. The preceding download wrapper
   invocation failed while parsing `sha256sum`; it changed no application or authorization state.
3. Invocation `t-usw6x5x2z5k53b4` durably disarmed authorization `0x267305…f4fb8`, stopped the old watcher, returned
   `dual:reconcile=CLEAN`, proved wallet nonce `76/76`, and then stopped the memory-heavy read services. Atomic Cycle
   remained at the same PID and release.
4. Invocation `t-usw6x5x73lleo00` installed the exact release. `current`, package version `0.17.16`, release marker and
   immutable directory all agreed on the merged commit; no group/world-writable release entry remained.
5. The first post-install start gate intentionally rejected a 45-second board health window. There was no application
   exception: the board started at `18:10:12Z`, exposed HTTP at `18:11:38Z`, and completed a healthy first cycle at
   `18:13:56Z`. No signer had been armed while the board was not ready.
6. Invocation `t-usw6x5xq4bjeiv4` reran `dual:reconcile=CLEAN`, verified the three executor identities, source/runtime
   hashes, balances, read-only board and nonce `76/76`, then created authorization `0x513858…0cda` and started the
   v0.17.16 watcher.
7. Invocation `t-usw6x5xzdvx9pts` restored the catalog, business-report and minimum-necessary critical-health timers.
   Manual critical health returned `TRADING_HEALTHY / notification=NONE`.

## New live receipts

The new authorization naturally discovered, revalidated, signed, broadcast and reconciled two profitable Earn cycles
within its first three minutes:

| Confirmed at (UTC)  | Route                           | Transaction                                                          | Circulated ETH         | Receipt-verified net ETH | Gas ETH             |
| ------------------- | ------------------------------- | -------------------------------------------------------------------- | ---------------------- | ------------------------ | ------------------- |
| 2026-09-15 18:15:16 | `WETH -> ORBIO -> WETH`         | `0xd34adc21a01c0d9e556804d85555b07a7fadea984ad734a6f5d158a31500e115` | `0.000907174780205773` | `0.000110446889625402`   | `0.000022329171152` |
| 2026-09-15 18:17:15 | `WETH -> ORBIO -> PONS -> WETH` | `0x2cde7cddb3e8504144186b88df488987d1c08d125e89beec310e513c262fc8b3` | `0.001002260652849871` | `0.000155391972415503`   | `0.000029962293106` |

The authorization therefore had two signed attempts, two confirmed executions, two consumed nonces, zero reverts,
zero failed Gas and `0.000265838862040905 ETH` current net profit. Gas is already included in each reported net result
and must not be deducted twice. At the business-report readback, the in-progress Beijing day contained nine successful
receipt-gated Earn trades and `0.000849178677991497 ETH` net trading profit across releases, with zero failed
transactions that day.

These receipts prove that the new Earn worker can hand a positive candidate to the single signer and complete a live
trade. They do not prove that every future candidate is profitable.

## Independent worker and runtime evidence

After start, Earn worker PID `54211` and Global worker PID `54212` each accepted work independently. The first stable
sample showed Earn completed six searches and Global completed four, both with zero failure or restart. Global's first
material event search evaluated 93 coarse quotes, observed 20 gross-positive results, narrowed them to two exact
candidates and rejected both because neither funded worst-case Gas plus the protected net floor. It emitted no signature
or transaction.

Later, one Earn request and one Global request each exceeded the existing 60-second per-request deadline. The supervisor
killed and restarted only the affected read-only worker; each recovered and completed later requests. The signer service
remained PID `54197`, `systemd NRestarts=0`, unresolved mutation stayed `null`, and the two live receipts remained fully
reconciled. This is direct production evidence that a slow read lane no longer halts the other lane or the wallet signer.
It also leaves per-request cooperative cancellation as a follow-up improvement; a bounded worker recycle is recovery,
not successful search coverage.

The read-only board remained PID `53969`, the competitor census PID `53971`, and both had zero systemd restarts. Public
`/`, `/api/v1/business` and `/api/v1/profit/daily` returned HTTP 200; a POST to the business API returned HTTP 403.
`/healthz` returned `HEALTHY`, runtime and persisted state `RUNNING`, SQLite persistence `HEALTHY` and parity `true` after
each completed projection. The endpoint can still time out while the same Node process performs a CPU-bound projection,
although the static operating APIs remain available. Separating the projector from the HTTP reader remains a production
availability improvement.

The direct Sequencer Feed handshake was rejected with HTTP 403 in this start sample. Managed Earn WSS was subscribed,
public event recovery and five-minute Global recovery remained active, so the system stayed live with degraded latency.
Feed access or adaptive reconnect remains an external/runtime follow-up; this release does not claim direct-feed
availability.

## Remaining architecture gaps

1. Worker environment allowlisting prevents signer/RPC credential inheritance, but the children still share the signer
   service's Unix identity and cgroup. Dedicated service users plus a bounded Unix-socket handoff would provide stronger
   hostile-code and resource isolation.
2. Search requests still use a 60-second kill-and-restart deadline. Stage budgets, cooperative cancellation and
   checkpointed incremental state should replace whole-process recycling without accepting stale candidates.
3. Board projection and HTTP serving still share one event loop. A separate read-only API process should serve the last
   signed snapshot while projection continues.
4. Global search still rebuilds and rereads substantial fixed-block state. An event-fed canonical state mirror and
   incremental graph deltas are required to reduce the observed roughly 102-second source-to-decision sample.
5. Unsupported hooks, incomplete direct Sequencer access and incomplete confirmed-lost-race attribution limit coverage.
   More providers or paid RPC capacity should be added only after receipt economics show that the marginal coverage pays
   for the recurring cost.
