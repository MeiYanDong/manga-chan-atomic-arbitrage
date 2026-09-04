# Opportunity board live-deployment evidence — 2026-09-04

This document records one production readback. Counts and economics are time-sensitive; the server snapshot remains the
source of truth after the observation time.

## Release and merge gates

- Feature PR: [#16](https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/pull/16), merged after required `quality` passed.
- Private-tunnel PR: [#17](https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/pull/17), merged after required `quality` passed.
- Moving-catalog correction PR: [#19](https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/pull/19), merged after required `quality` passed.
- Deployed tag: `v0.2.2`.
- Deployed commit: `20f22075b38fa9b0a71d884431a0d3caadc356c1`.
- Deployed-commit CI: [run 33861692974](https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/actions/runs/33861692974), success.
- Commit-addressed artifact: [run 33861708070](https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/actions/runs/33861708070), success; downloaded archive passed its published SHA-256 check before installation.
- The installer reran `npm run check` on the Linux host: formatting, JS/Solidity/shell lint, `systemd-analyze verify`,
  checked-JS types, compile, 22 unit tests, deterministic contract test and secret scan passed. The only
  `systemd-analyze` messages concerned the pre-existing Alibaba `cloudmonitor.service`, not a repository unit.

## Runtime isolation readback

Observed at `2026-09-04T18:11+08:00`:

- `manga-opportunity-board.service`: `active/running`, zero restarts and about `71 MiB` current memory against `256
MiB` `MemoryMax`.
- Process identity: dedicated `manga-board:manga-board`.
- Config: `/etc/manga-opportunity-board/live.env`, `0640 root:manga-board`.
- Runtime: `/var/lib/manga-opportunity-board`, `0750 manga-board:manga-board`; snapshot and event files are `0640`.
- The board process environment contained only `MANGA_BOARD_*` names. Signer, keychain, hot HTTP/WSS and reconciliation
  reader names were absent.
- `manga-board` could read its own config and could not read `/etc/manga-chan-arbitrage/live.env`.
- HTTP listened only on `127.0.0.1:8788`; `/healthz` returned `HEALTHY`.
- SSH remained key-only and allowed only client-local forwarding to `127.0.0.1:8788`. Password login, arbitrary
  forwarding, GatewayPorts and SSH tunnel devices remained disabled.
- `manga-chan-watcher.service` remained `active/running`, with PID `13509`, zero restarts and its original
  `2026-09-04T16:20:10+08:00` start time. It was not restarted for the board deployment.

## Live census snapshot

Snapshot time: `2026-09-04T10:10:36.205Z`, fixed-quote cycle `55`.

- PAIR tokens observed: `1,732`; full catalog expected at that read: `1,732`. The `v0.2.2` completeness decision was
  made after reconciling the newest-token page with the moving full-pagination pass.
- Eligible multi-pool candidates: `494`.
- Ever quoted: `494` (`100%`); fresh at the snapshot: `67`. Stale rows remain visible and fail closed while the rolling
  sweep refreshes them; all nine positive rows below were fresh.
- Fresh `SCREENED_NET_POSITIVE`: `9`.
- The persisted event ledger contained both positive entries and exits, including repeated short-lived boundary
  crossings by `ASS`.

Top fresh fixed-block screens for `10 USDG` at block `54183373`:

| Token     | Address                                      | Route                   | Gross USDG | Gas proxy USDG | Screened net USDG |
| --------- | -------------------------------------------- | ----------------------- | ---------: | -------------: | ----------------: |
| SIGMA     | `0x7aAd9Faa5Ee27bDEeb17D5A8c1870278824C4C59` | GOOGL → SIGMA → MU      |   0.545883 |       0.295735 |          0.250148 |
| SPX       | `0x3363Cd5019Aa1F3E50c73086d5f5dCab3D90f558` | AAPL → SPX → NVDA       |   0.571057 |       0.395942 |          0.175115 |
| FUND      | `0x2FAa763726C4a1D0D9E6a768899D147aC4c42183` | AMZN → FUND → SPCX      |   0.462433 |       0.296590 |          0.165843 |
| PC        | `0xaCc78003fecb10e41896903DCE9BD08e49E9de0B` | MU → PC → NVDA          |   0.549884 |       0.396093 |          0.153791 |
| Elon      | `0xC71D692fF5323d818b425a9536301C5147ed3A6b` | SPCX → Elon → TSLA      |   0.526196 |       0.395964 |          0.130232 |
| CHIP      | `0x2a4eF4747640eba831f6EbA0d96185192DC01b3b` | AAPL → CHIP → AMD       |   0.410485 |       0.293745 |          0.116740 |
| Grok      | `0xB36758EA446a1dFa5d90255D529c16ac75b0e124` | NVDA → Grok → SPCX      |   0.393811 |       0.304178 |          0.089633 |
| MEMESTOCK | `0x4A0781369eCEa2d44294fF082f1a1Ba436f12f54` | MSFT → MEMESTOCK → NVDA |   0.345412 |       0.296765 |          0.048647 |
| BASIC     | `0xb64bCfEC889a2cB5e2D634B6C512dB34428E8baF` | AAPL → BASIC → SPCX     |   0.320624 |       0.295206 |          0.025418 |

MANGA's best observed route in the same snapshot was `AMZN → MANGA → AAPL`: `0.146461 USDG` gross and
`-0.149972 USDG` after the gas proxy. It therefore remained `GROSS_POSITIVE_NET_NEGATIVE`.

The event ledger also captured MANGOS entering with a large screened value and leaving on the next cycle about fifteen
seconds later. That is evidence that quotes can be transient, not evidence of a fillable risk-free trade.

## Evidence boundary and remaining gaps

- Every listed economic result is `FIXED_BLOCK_QUOTER_SCREEN`. The four swap quotes and native mark share one fixed
  block, but the gas value is still a proxy.
- No generic route executor exists. Exact executor `eth_call`, calldata, callback safety, transaction gas, signing,
  ordering, inclusion and receipt evidence are absent.
- The automatic catalog currently covers PAIR's first-party multi-pool API. It does not claim complete coverage of
  arbitrary external PoolManager pools such as every AI/meme market; another discovery adapter is required for that.
- The existing fixed MANGA executor still has zero confirmed arbitrage executions. Board health and positive screens do
  not change that fact.
