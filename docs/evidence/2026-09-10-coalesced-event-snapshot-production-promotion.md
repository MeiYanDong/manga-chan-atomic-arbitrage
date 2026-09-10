# Coalesced event-snapshot production promotion — 2026-09-10

## Outcome

Release `f0bd3f8c124b611277238278d986f17d5933ce27` (`0.9.1`) was promoted to the signer-free production opportunity
board. In the first observed window, 214 ordinary event cycles completed without a full board/SQLite publication;
periodic cycles remained the only full-publication path. The same 35-request, two-second loopback probe improved from
22 successes and 13 timeouts on `0.9.0` to 31 successes and 4 timeouts on `0.9.1` while crossing two periodic full
publications.

Extended observation also found a health-reporting regression: an `EVENT_ERROR` correctly published a durable
`DEGRADED` snapshot, but the next successful non-material event deferred its full projection and therefore left
`/healthz` reading the stale persisted status until the next periodic publication. During that interval the metrics
and overview APIs remained responsive. This did not weaken signing or economic gates, but `0.9.1` was not accepted as
the final health behavior and led to [ADR 0041](../decisions/0041-live-health-after-deferred-event-recovery.md).

This is an availability and queue-pressure improvement. It did not create a screened-positive opportunity, exact
preflight, signature, transaction receipt or profit. The positive, signer-feed-clear and open-economic-episode paths
remain covered by deterministic policy tests but were not naturally exercised because production observed no positive
candidate.

## Reviewed release and reproducible gates

- Pull request: [#102](https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/pull/102)
- Required GitHub Actions run/job:
  [34494645381 / 102929854307](https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/actions/runs/34494645381/job/102929854307),
  passed in 1 minute 27 seconds before merge
- Merged release commit: `f0bd3f8c124b611277238278d986f17d5933ce27`
- Exact GitHub archive SHA-256: `a8a5295b650719838cc4fee61d8a4bbfbc27a2d2b382b42662d94e41702cdc09`

Local `npm run check` passed formatting, JavaScript/Solidity/shell lint, checked-JavaScript types, dashboard build, all
three compiler paths, 238 Node tests, three deterministic contract suites and a 259-file secret/privacy scan. The
server downloaded the merged archive independently, matched the same hash, repeated 238 Node tests and all three
contract suites, passed Linux systemd verification, and scanned the 241 files present in the GitHub source archive.
The retained Alibaba Cloud monitor warnings were unrelated to the MANGA units.

## Controlled board-only promotion

- Previous board PID/release: `272655 / 3db3cc5a7b8096ce10a2516f7fe63b76f51aacc0`
- Promoted board PID/release: `274072 / f0bd3f8c124b611277238278d986f17d5933ce27`
- Dual signer systemd/Node PIDs remained `265531 / 265553`
- Dual signer release remained `2f3007ddd9293863a56c0665cde30d6705b9f7a7`
- Both services retained `NRestarts=0`; the business-report timer returned to `active`
- Rollback copies remain under `/etc/`, suffixed with
  `.before-f0bd3f8c124b611277238278d986f17d5933ce27`

The first deployment wrapper correctly downloaded, verified, gated and installed the release, and the new board
reached `HEALTHY`. Its shell health predicate, however, lost JSON quotes through command transport and searched for
`status:HEALTHY`, so it did not recognize the valid `{"status":"HEALTHY"}` response. The wrapper was terminated by
its exact verified PID. Its trap restored the old `current` symlink and timer but, because the new board was already
active, `systemctl start` was a no-op and did not replace that process. A corrected finalizer first proved the active
PID was already running the exact new release and healthy, then restored the new release marker and `current` symlink
atomically without another process restart. No signer, authorization or wallet state was touched by this recovery.

At the accepted readback, `current` and the board process both resolved to the exact merged release. Health was
`HEALTHY`, SQLite was `HEALTHY` with parity `true`, both catalogs were
`COMPLETE_FROM_CONFIGURED_START`, 3,563 candidates were admitted, and zero were screened positive. The board cgroup
reported about 399 MiB current and 448.5 MiB peak memory with `max=0`, `oom=0` and `oom_kill=0`; root-disk use was 68%.

## Natural event and publication evidence

The first stable metrics sample contained:

| Counter or timing                         |    Value |
| ----------------------------------------- | -------: |
| ordinary event cycles deferred            |      214 |
| event-triggered full publications         |        0 |
| periodic full publications                |        7 |
| deferred periodic `SCANNING` publications |        7 |
| event candidate quotes                    |      214 |
| latest event post-quote bookkeeping       | 18.41 ms |

Across 128 completed natural event cycles, post-quote bookkeeping was 18.02 ms p50, 21.08 ms p95 and 116.99 ms max.
Candidate quote time was 510.31 ms p50 and 1,852.09 ms p95; observed-log-to-quote completion was 4,040 ms p50 and
8,534 ms p95. These latter phases still include public-RPC and queue delay and therefore are not solely attributable to
this release.

The latest observed `PERIODIC_FINAL` publication took 6,504.51 ms:

| Full-publication phase |    Duration |
| ---------------------- | ----------: |
| build snapshot         |   158.04 ms |
| reconcile episodes     |    13.36 ms |
| compatibility JSON     |   717.57 ms |
| compact execution feed |     1.59 ms |
| event ledger           |     0.13 ms |
| SQLite projection      | 5,613.50 ms |
| runtime state          |     0.30 ms |

The compatibility snapshot was 23,966,895 bytes, source catalog 45,359,035 bytes and SQLite read model 516,612,096
bytes. The 35-probe sample averaged 290 ms including four two-second timeouts and had a 2,014 ms maximum. This is one
activation window, not a long-run availability SLO.

## Extended observation and health regression

The longer window reached 656 deferred ordinary event cycles and three event-triggered full publications. The three
full event publications were `DEGRADED` results at `2026-09-10T15:45:13.065Z`, `15:45:23.553Z` and
`15:51:17.288Z`; each was followed by successful `RUNNING` event cycles. No positive checkpoint, signer-feed clear or
open-episode reconciliation occurred.

In the stale-status interval, a 20-request endpoint-isolation probe returned a fast non-200 response from `/healthz`
on all 20 requests, averaging 6 ms and peaking at 9 ms. In the same process, `/api/event-metrics` and
`/api/v1/overview` each returned HTTP 200 on all 20 requests, averaging 7 ms. This rules out an event-loop timeout or
process outage for that sample. The next periodic publication restored `/healthz` to HTTP 200; at
`2026-09-10T15:54:15.228Z`, runtime metrics showed `lastError=null`, `consecutiveErrors=0`, 656 deferred events and a
healthy, parity-checked SQLite read model.

The cause was the health endpoint's dependency on `snapshot.health.status`: ordinary successful event cycles updated
live runtime state but intentionally did not replace that full persisted snapshot. Health must instead follow the
most recently completed runtime cycle while retaining independent freshness, catalog and persistence gates.

## Provider, signer and economic boundary

The ChainStack lane retained its reviewed daily hard caps: 200/200 event candidates and 3,667/4,000 logical calls had
already been consumed before this release. The new process therefore used the official public RPC for event quotes;
the cap was not increased. Expansion remains manual and still requires canonical current-authorization receipt net
after Gas and provider cost.

The signer remained `RUNNING / ARMED / UNTIL_REVOKED` under authorization
`0x7039d0e14a6ccecb19f0ee4c75740362ab2a98b1e2eef43259a896bd3035cd62`. Current spendable principal remained
`35.344393 USDG / 0.0032 WETH`, with hard caps of `100 USDG / 1 WETH` and proxy/exact net floors of `0.05 / 0.1 USDG`.
Current-authorization usage remained zero confirmed executions, zero signed attempts, two exact preflights and zero
failed Gas. There was no unresolved mutation, the compact execution feed had zero candidates, and the last decision
remained `NO_SCREENED_OPPORTUNITY`.

The deployment therefore proves faster handling of observed negative events, not a new profitable trade or realized
return.

## Remaining bottleneck

The immediate corrective item is the stale health-state coupling described above. Separately, periodic publication
still blocks the shared Node event loop for roughly six seconds in the observed sample, with the full SQLite
projection responsible for most of that time. A future incremental current-state schema or isolated publication worker
needs its own ADR, migration/rollback plan and tests; this release intentionally did not combine that higher-risk
storage change with the event coalescing change.
