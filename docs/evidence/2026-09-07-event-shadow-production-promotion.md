# Event-driven shadow production promotion — 2026-09-07

## Scope and evidence boundary

This record covers the signer-free opportunity board only. The board loaded no signer, signed no transaction and
broadcast nothing. Fixed-block Quoter results are screens, not executable simulations, receipts or realized profit.
The fixed and generic signing watchers remained inactive and disabled throughout the promotion.

## Reviewed source and releases

- [PR 32](https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/pull/32) introduced the event-driven board and merged
  as `a6c75006842a676818e1b242155084f468d04479`; its CI and tagged release workflow passed.
- [Release v0.5.0](https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/releases/tag/v0.5.0) was promoted briefly,
  exposed a public-RPC batch defect and was rolled back rather than accepted as healthy.
- [PR 33](https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/pull/33) added the bounded independent-request
  fallback and merged as `0b3c5911a4503a1be31fa94f739fa5ff3ead1113`.
- [PR 34](https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/pull/34) made periodic reconciliation
  non-starvable and merged as `1a49b15ec5cbddd74536b913eaecfb7bf46619ea`.
- [Release v0.5.2](https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/releases/tag/v0.5.2) is the accepted
  production release. Its commit-addressed archive and `SHA256SUMS` were downloaded from GitHub Actions and verified
  before transfer.

Every PR CI and tagged release workflow ran `npm run check`. The final Linux install repeated formatting, JavaScript and
Solidity lint, shell syntax, `systemd-analyze verify`, checked-JS types, both Solidity compiles, `77/77` unit tests, both
deterministic contract suites and the secret scan over 91 files. Fixed and generic Solidity source hashes remained
`0x0a085f1ecd1af15b6007b5c9450cc73dc3a2e84a738094e5789d80a7c0fc8755` and
`0x5b03b1f117600d2e241f67eaa5026adc80082172daaa28b7cf84dfc3f26da78e`. Linux emitted only the pre-existing Alibaba
Cloud Monitor unit warnings; no repository unit failed verification.

## Failed v0.5.0 promotion and rollback

The first v0.5.0 periodic cycle completed at `2026-09-07T04:49:34.275Z` with 941 candidates and no net-positive screen.
Later event cycles received a malformed/incomplete JSON-RPC batch response. viem surfaced an `UnknownRpcError` with a
missing result entry; the board incorrectly collapsed the incomplete transport evidence into a no-route invariant and
published `DEGRADED` at `2026-09-07T04:49:41.687Z`.

The service was immediately returned to release `24c1d869ff82e912dc3ab85c147476f039247a93` and its previous public-only
configuration. The rollback readback reached HTTP 200 `HEALTHY` at `2026-09-07T04:54:27.141Z`. No event history was
truncated and neither signing watcher was started. This failed promotion is retained as evidence; v0.5.0 is not described
as a successful production version.

## Accepted v0.5.2 runtime readback

The final service started at `2026-09-07T05:11:49.954Z`. The public endpoint again omitted a batch item at
`2026-09-07T05:11:58.637Z`, which exercised the repaired path in production:

- transport mode changed exactly once from `BATCH` to `INDIVIDUAL_FALLBACK`;
- the affected read was retried through the bounded independent client;
- `rpcBatchFallbacks` remained 1;
- `lastError` and event-poll `lastError` returned to null;
- loopback `/healthz` returned HTTP 200 and systemd reported active/running with zero restarts;
- final observed memory was approximately 113 MB under the 256 MB unit limit.

The first final-release periodic cycle completed at `2026-09-07T05:13:57.253Z`. Despite a continuously non-empty event
queue, the next mandatory periodic cycle completed at `2026-09-07T05:16:53.239Z`. During that second cycle the durable
chain-catalog cursor advanced from block `45,100,000` through `45,149,999`, leaving `nextBlock=45,150,000`. This is direct
evidence that event traffic no longer starves coverage/backfill. It is not evidence that historical backfill is complete.

At that readback the process had made 3,235 HTTP POSTs, 2,163 V3 Quoter calls, 853 V4 Quoter calls and 17 logical retries,
with one active HTTP request at a time. These are cumulative startup/catch-up counters and not provider billing units.
The observed catch-up event-to-quote delay reached roughly 95 seconds after fallback; steady-state latency and race-win
probability remain unknown. Robinhood's public RPC is therefore adequate for this fail-closed shadow deployment, not
evidence of a competitive execution transport.

The final restart preserved all 2,314 existing `events.jsonl` records. The prior board configurations remain available as
root-owned rollback backups. Runtime state continues under `/var/lib/manga-opportunity-board`; it is not copied into Git.
The ledger contains two explicit V2 epoch markers: the failed v0.5.0 activation at `2026-09-07T04:49:23.198Z` and the
accepted reactivation at `2026-09-07T05:02:56.100Z`, separated by the deliberate v0.4 rollback interval. Current
`state.json` points to the latter marker, so legacy observations emitted during rollback are not silently mixed into the
accepted economic-episode epoch.

## Economic readback

At `2026-09-07T05:16:58.267Z`:

- the API snapshot reported 2,186 discovered tokens and a complete API pagination pass;
- the merged strategy catalog contained 941 multi-pool candidates;
- 512 candidates had at least one retained observation and 15 were fresh at that instant;
- five fresh rows were gross-positive but net-negative after the Gas proxy;
- zero rows were `SCREENED_NET_POSITIVE` and `executionAuthorized` was false.

Examples include ASS at 10 USDG (`+0.289527` gross, `0.412066` Gas proxy, `-0.122539` screened net) and MANGA at 7.5
USDG (`+0.165428` gross, `0.414322` Gas proxy, `-0.248894` screened net). The closest retained SIGMA row was already stale
and also net-negative. No live candidate, signature, broadcast, receipt or realized profit resulted from this promotion.

## Still open

- Chain-catalog backfill is only partial from configured block 45,000,000; no claim is made for earlier blocks or
  unscanned later ranges.
- Public-RPC startup/catch-up latency is too high for a competitive transaction race. A managed execution provider would
  need a separate benchmark and explicit configuration change.
- Signal causality, wire timing, competitor ordering, race outcome and steady-state opportunity frequency remain
  unproven until a longer observation window records them.
- The generic watcher remains stopped and its prior arm remains exhausted. This release creates no new trading
  authorization.
