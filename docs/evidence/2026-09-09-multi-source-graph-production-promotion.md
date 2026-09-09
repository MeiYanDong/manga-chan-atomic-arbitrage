# Multi-source graph production promotion — 2026-09-09

## Outcome

Release `ccf7dfb53dcc8b746929b704013eb25cc839529e` is active on the production signer-free board and dual USDG/WETH
watcher. It joins PAIR listings, LongLauncher, Doppler and PoolManager facts into one bounded strategy graph without
changing source attribution, then reserves a protected periodic quote and removes full catalog persistence from the
ordinary event quote path.

The deployment produced no transaction. At the final `2026-09-09 20:08 CST` readback, the active authorization had
zero signed attempts, zero confirmed executions, zero failed Gas and no unresolved mutation. Its two existing exact
preflights were unchanged across this cutover. The current graph had no screened-positive candidate, so the correct
live action was no broadcast.

## Reviewed release lineage

| PR                                                                       | Merge commit                               | CI quality job                                                                                                                    | Production finding                                                                                                                                           |
| ------------------------------------------------------------------------ | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [#87](https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/pull/87) | `af3bd5754bd31489a18b89a0237661adc1aea2f2` | [34338853695 / 102424599402](https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/actions/runs/34338853695/job/102424599402) | Connected the source census to the bounded graph; one complete candidate topology still required 165 Quoter calls.                                           |
| [#88](https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/pull/88) | `654d403970179f7aca68c60b5b44269acd182ddc` | [34341031006 / 102431596120](https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/actions/runs/34341031006/job/102431596120) | Bounded the protected probe to one pair, amount and V3 route per direction.                                                                                  |
| [#89](https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/pull/89) | `ce13c7a1069cdaebd581ca150b08211b0b8d5720` | [34342437869 / 102436115180](https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/actions/runs/34342437869/job/102436115180) | Stopped materializing tens of thousands of source-only singleton objects.                                                                                    |
| [#90](https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/pull/90) | `9242aca6cabb1269db939acb741f0dca0c7dcb72` | [34345338430 / 102445493349](https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/actions/runs/34345338430/job/102445493349) | Bounded heap use and streamed compatibility persistence; v0.8.3 stayed alive, but a relevant Initialize still amplified an event into a large catalog write. |
| [#91](https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/pull/91) | `ccf7dfb53dcc8b746929b704013eb25cc839529e` | [34347531745 / 102452580817](https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/actions/runs/34347531745/job/102452580817) | Deferred Initialize catalog maintenance to the protected periodic lane and became the accepted release.                                                      |

Every listed quality job completed successfully. The v0.8.0-v0.8.3 observations were canaries, not economic success
claims. In particular, v0.8.3 ordinary/event samples included 94,163 ms with 13 logical Quoter calls and 35,503 ms with
11 calls while synchronous source projection work could pause the loopback API. None of the rejected canaries signed or
broadcast a transaction.

## Reproducible gates

The accepted commit passed the local gate:

```bash
npm ci --no-audit --no-fund
npm run check
```

That gate covered formatting, JavaScript/Solidity/shell lint, checked-JS type analysis, Vite production build,
compilation, 221 Node tests, three deterministic contract suites and a 228-file repository secret scan. The exact Git
archive had SHA-256 `3b3a77fba197b8b9dc23555f86372e4ae0fe70179b71b5321408d32f3df2239f`.

The production installer reran the Linux-compatible gate on that hash-matched artifact before changing the `current`
symlink. It passed the same 221 Node tests and three contract suites plus a 210-file artifact secret scan. The only
`systemd-analyze` warnings came from Alibaba Cloud's preinstalled `cloudmonitor.service`; they are outside this
repository. The installer explicitly reported that it neither armed nor started a service.

## Controlled production cutover

Before replacement, the board, signer and report timer were stopped. The installed symlink resolved to the exact
accepted release. The board then started alone at `19:56:09 CST`, emitted `BOARD_HTTP_READY` at `19:57:07` and completed
its first protected periodic reconciliation at `19:59:06`. Before the signer was restored:

- `/healthz` returned `HEALTHY`, source and chain catalogs were complete from their configured start block, and SQLite
  persistence was `HEALTHY` with parity `true`;
- canonical runtime verification returned chain ID `4663`, wallet nonce `15/15`, `35.344393 USDG`, `0.0032 WETH`, wallet
  Gas `0.00262778655474 ETH`, exact deployment bytecode and `unresolvedMutation=null`;
- the board explicitly reported `READ_ONLY_NO_SIGNING_NO_BROADCAST`, and the fixed and standalone generic signer lanes
  were inactive; and
- the existing authorization `0x7039d0e14a6ccecb19f0ee4c75740362ab2a98b1e2eef43259a896bd3035cd62`
  remained `ARMED / UNTIL_REVOKED`; it was not recreated or widened.

The dual watcher was then enabled and started. Its worker became live at `20:01:28 CST`, processed advancing local feed
generations and repeatedly decided `NO_SCREENED_OPPORTUNITY`. The business reporter updated its mode-0640 sanitized
snapshot, recognized that the completed Beijing-day report already had a durable delivery receipt, and left its timer
active. No duplicate report was sent.

## Current discovery-to-execution funnel

The final board snapshot at `20:08:16 CST` recorded:

| Stage                                    |  Count | Meaning                                                                              |
| ---------------------------------------- | -----: | ------------------------------------------------------------------------------------ |
| independently attributed source targets  | 46,105 | union of current PAIR, LONG and Doppler target facts                                 |
| retained PoolManager pools               | 64,162 | pools touching the source-target set, not profit claims                              |
| targets with at least two retained pools |  4,280 | can form a structural cross-pool graph                                               |
| source-only multi-pool targets           |  2,528 | discovered outside the PAIR listing catalog                                          |
| current executor-shape targets           |  1,593 | at least two pools have the supported hook/fee/tick shape before live evidence gates |
| admitted bounded candidates              |  3,457 | signer-free rows after normalization and an eight-pool bound                         |
| ever quoted in the retained snapshot     |    883 | includes stale observations                                                          |
| fresh quoted candidates                  |      3 | only 0.09% of admitted candidates at that instant                                    |
| screened net positive                    |      0 | no reason to request a new exact preflight                                           |
| exact ready / current confirmed          |  0 / 0 | no current execution or receipt                                                      |

Counts are a point-in-time chain readback and will drift. The executor-compatible checkpoint count reached one only
after a successful fixed-block quote attested both live PoolKeys; it did not screen positive and never entered the
signer feed.

This funnel explains why adding pools did not produce the expected transaction frequency. A pool must share one target
with another pool, survive hook and PoolKey restrictions, have a current fixed-block quote for both V4 legs and its V3
anchors, exceed swap fees, slippage and Gas, then pass a separate exact current-block executor simulation. Most source
facts fail or remain unknown before the economic gate. A large catalog increases search breadth; it does not create a
price discrepancy.

## Event-path and service acceptance

During an ordinary-event observation window, the source-catalog mtime stayed exactly `1788955146` while event cycles
completed at `19:59:50` and `20:00:22`. Later samples completed in 29,776-38,426 ms with 9-13 logical Quoter calls. This
proves that ordinary event quotes no longer rewrite the approximately 42 MB source projection.

A retained-source Initialize was then observed at `20:09:22 CST`. The explicit deferred-maintenance counter advanced
from zero to one, the process continued without a restart, and the next protected periodic cycle consumed catalog work
before completing at `20:10:17`. This closes the live branch that deterministic tests had already covered: relevant
Initialize evidence is retained immediately, while graph/projection maintenance remains owned by the periodic lane.

The board and signer both remained active with zero restarts. Board peak memory was 470,286,336 bytes and signer peak
memory was 296,734,720 bytes. Both cgroups reported `max=0`, `oom=0` and `oom_kill=0`. The execution feed remained
mode `0640`, owned by `manga-board:manga-board`, and advanced independently of the business reporter.

Canonical post-cutover verification again returned nonce `15/15`, unchanged executor balances and
`unresolvedMutation=null`. The active authorization remained at two exact preflights, zero signed attempts, zero
confirmed executions and zero failed Gas.

## Honest remaining boundary

Public-first scanning is still the limiting component. The retained hot-cursor state showed 662 stale event candidates,
81 pending candidates, 46 cumulative cursor fast-forwards and 1,144,466 cumulatively skipped realtime blocks. The latest
v0.8.4 gap alone skipped 555 blocks when the cursor exceeded the configured 500-block lag boundary. Those cumulative
counters include retained state from earlier releases, but the latest gap is current-release evidence that a transient
opportunity can still be missed.

Loopback control reads were fast between quote checkpoints (roughly 0.07-0.43 seconds in one sample), but two reads
exceeded a 15-second deadline during periodic catalog maintenance. Therefore this promotion proves bounded, fail-closed
continuous operation; it does not prove exhaustive realtime coverage or a deterministic 45-second reaction time.

Two event cycles reported transient `DEGRADED` snapshots at `20:11:22` and `20:13:17`, then recovered on subsequent
cycles without a service restart or retained final error. The checkpoint ledger proves the degraded states occurred but
does not retain a specific transport cause, so this record does not invent one.

Historical economics remain separate. Ten pre-dual generic-v2 receipts produced `9.463562 USDG` marked execution net;
the current dual authorization has produced `0`. Improving coverage further requires a separate provider/cost decision:
use a production-grade RPC or indexed event stream for broad discovery while keeping the managed strategy RPC for
exact simulation, signing, broadcast and receipt reconciliation. This release deliberately preserves the user's
public-first cost boundary and never compensates by guessing a quote or relaxing a breaker.
