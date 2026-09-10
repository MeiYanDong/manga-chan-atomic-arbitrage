# Live-health recovery production promotion — 2026-09-11

## Outcome

Release `0d7e75a44b2db403596a0aadffcb7f7c0f7a0e57` (`0.9.2`) is active on the signer-free production opportunity
board. The first accepted response was `HEALTHY`, with separate live and persisted statuses both `RUNNING`, complete
configured-start catalogs, healthy SQLite parity, 3,567 admitted candidates and zero screened-positive rows.

This release corrects control-plane health after a deferred event recovery. It does not create an opportunity, change
trade authority, prove a signed transaction or establish profit.

## Reviewed release and reproducible gates

- Pull request: [#103](https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/pull/103)
- Required GitHub Actions run/job:
  [34500163597 / 102948641787](https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/actions/runs/34500163597/job/102948641787),
  passed in 1 minute 28 seconds before merge
- Merged release commit: `0d7e75a44b2db403596a0aadffcb7f7c0f7a0e57`
- Exact GitHub archive SHA-256: `79912ad5984899e64c0359ea5381d2b5b9bd4cad234a4320256757ff04f28cdf`

Local `npm run check` passed formatting, JavaScript/Solidity/shell lint, checked-JavaScript types, dashboard build, all
three compiler paths, 240 Node tests, three deterministic contract suites and a 263-file secret/privacy scan. The
server downloaded the merged archive independently, matched the same hash, repeated 240 Node tests and all three
contract suites, passed Linux systemd verification, and scanned the 245 files present in the GitHub source archive.

## Board-only promotion

- Previous board PID/release: `274072 / f0bd3f8c124b611277238278d986f17d5933ce27`
- Promoted board PID/release: `277003 / 0d7e75a44b2db403596a0aadffcb7f7c0f7a0e57`
- Dual signer systemd/Node PIDs remained `265531 / 265553`
- Dual signer release remained `2f3007ddd9293863a56c0665cde30d6705b9f7a7`
- Both services retained `NRestarts=0`; the business-report timer remained `active`
- Rollback copies remain under `/etc/`, suffixed with
  `.before-0d7e75a44b2db403596a0aadffcb7f7c0f7a0e57`

The old board needed systemd's configured stop timeout and its npm parent was killed. Systemd temporarily reported the
old Node child as remaining after stop. Final process readback contained only the new board PIDs `277003 / 277021` and
the unchanged signer PIDs; the new Node process successfully bound the same loopback port. No stale board process was
accepted as running.

The rollback-protected promotion required the new process CWD to resolve to the exact merged release, the health
response to contain `HEALTHY` plus a live `RUNNING` or `SCANNING` status, the signer PID/CWD to remain exact, and the
report timer to remain active. Those gates all passed before the release was accepted.

## Initial runtime readback

After 67 natural event deferrals, the board reported:

| Evidence                              | Value                     |
| ------------------------------------- | ------------------------- |
| health                                | `HEALTHY`                 |
| live runtime status                   | `RUNNING`                 |
| persisted full-snapshot status        | `RUNNING`                 |
| screened-positive rows                | `0`                       |
| event-triggered full publications     | `0`                       |
| periodic full publications            | `1`                       |
| latest periodic full publication time | `5,533.46 ms`             |
| SQLite projection within that time    | `4,546.15 ms`             |
| board current memory                  | about `387.7 MiB`         |
| board recorded peak memory            | about `448.5 MiB`         |
| root disk                             | `69%` used, `12 GiB` free |

The live status changed after successful deferred events without adding an event-triggered full publication.

## Natural error-recovery observation

A bounded observer ran from `2026-09-10T16:21:02Z` through `16:33:02Z` without injecting a failure. Production
naturally emitted one `DEGRADED` event result at `16:23:33.042Z`. That error coincided with the next periodic lane; the
periodic lane completed a full `RUNNING` publication before the next observed successful events. The observation
therefore did not contain the distinguishing state `runtimeStatus=RUNNING` beside
`persistedSnapshotStatus=DEGRADED`.

At the final readback, the process had completed 571 deferred event cycles, one event-triggered full error publication
and ten full publications overall. It reported `lastError=null`, `consecutiveErrors=0`, HTTP `HEALTHY`, both live and
persisted statuses `RUNNING`, 3,569 candidates and zero screened-positive rows. The latest periodic full publication
took 6,930.62 ms, including 6,075.93 ms for SQLite.

This proves that v0.9.2 stayed healthy through natural event and periodic work and recovered from the observed error.
It does not prove that recovery happened before a periodic full publication. That exact differential remains covered
by deterministic status and endpoint-wiring tests and is explicitly unobserved in production; no error was induced to
manufacture the missing evidence.

## Signer, provider and economic boundary

The signer remained `RUNNING / ARMED / UNTIL_REVOKED` under authorization
`0x7039d0e14a6ccecb19f0ee4c75740362ab2a98b1e2eef43259a896bd3035cd62`. Current spendable principal remained
`35.344393 USDG / 0.0032 WETH`, with hard caps of `100 USDG / 1 WETH` and proxy/exact net floors of `0.05 / 0.1 USDG`.
Current-authorization usage remained zero confirmed executions, zero signed attempts, two exact preflights and zero
failed Gas. There was no unresolved mutation, the signer feed had zero candidates, and its last decision was
`NO_SCREENED_OPPORTUNITY`.

The ChainStack cap was not increased. Broad discovery and post-cap event quoting remain on public RPC; any paid-RPC
expansion still requires canonical current-authorization receipt net after Gas and provider cost.

The deployment therefore proves the corrected version is installed and healthy through normal natural events plus one
event error. It does not prove the distinct pre-periodic recovery branch, transaction inclusion or new profit.
