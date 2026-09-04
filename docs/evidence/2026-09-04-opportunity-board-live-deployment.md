# Opportunity board live-deployment evidence — 2026-09-04

This document records one production readback. Counts and economics are time-sensitive; the server snapshot remains the
source of truth after the observation time.

## Release and merge gates

- Feature PR: [#16](https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/pull/16), merged after required `quality` passed.
- Private-tunnel PR: [#17](https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/pull/17), merged after required `quality` passed.
- Deployed tag: `v0.2.1`.
- Deployed commit: `f0baed63b0cf2f3812956a37110411c765e6eac0`.
- Main CI: [run 33860178484](https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/actions/runs/33860178484), success.
- Commit-addressed artifact: [run 33860197577](https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/actions/runs/33860197577), success; downloaded archive passed its published SHA-256 check before installation.
- The installer reran `npm run check` on the Linux host: formatting, JS/Solidity/shell lint, `systemd-analyze
verify`, checked-JS types, compile, 21 unit tests, deterministic contract test and secret scan passed. The only
  `systemd-analyze` messages concerned the pre-existing Alibaba `cloudmonitor.service`, not a repository unit.

## Runtime isolation readback

Observed at `2026-09-04T17:52:26+08:00`:

- `manga-opportunity-board.service`: `active/running`, zero restarts, about `86 MiB` current and `88 MiB` peak memory
  against `256 MiB` `MemoryMax`.
- Process identity: dedicated `manga-board:manga-board`.
- Config: `/etc/manga-opportunity-board/live.env`, `0640 root:manga-board`.
- Runtime: `/var/lib/manga-opportunity-board`, `0750 manga-board:manga-board`; snapshot and event files are `0640`.
- The board process environment contained only `MANGA_BOARD_*` names. Signer, keychain, hot HTTP/WSS and reconciliation
  reader names were absent.
- `manga-board` could read its own config and could not read `/etc/manga-chan-arbitrage/live.env`.
- HTTP listened only on `127.0.0.1:8788`; `/healthz` returned `HEALTHY`.
- SSH remained key-only and allowed only client-local forwarding to `127.0.0.1:8788`. Password login, arbitrary
  forwarding, GatewayPorts and SSH tunnel devices remained disabled. `sshd -t`, a daemon reload and a fresh key-only
  connection all succeeded.
- `manga-chan-watcher.service` remained `active/running`, with zero restarts and its original start time. It was not
  restarted for the board deployment.

## Live census snapshot

Snapshot time: `2026-09-04T09:52:09.090Z`, fixed-quote cycle `18`.

- PAIR tokens observed: `1,718`; full catalog expected at that read: `1,717`. The extra item arrived through the newer
  newest-token page after the full pagination pass.
- Eligible multi-pool candidates: `494`.
- Ever quoted: `249` (`50.4%`); fresh at the snapshot: `104`; the remaining sweep continued after this readback.
- Fresh `SCREENED_NET_POSITIVE`: `9`.
- Event ledger since initial baseline: `11` positive entries and `2` positive exits.

Top fresh fixed-block screens for `10 USDG` at block `54172432`:

| Token | Address                                      | Route               | Gross USDG | Gas proxy USDG | Screened net USDG |
| ----- | -------------------------------------------- | ------------------- | ---------: | -------------: | ----------------: |
| SIGMA | `0x7aAd9Faa5Ee27bDEeb17D5A8c1870278824C4C59` | GOOGL → SIGMA → MU  |   0.537299 |       0.298333 |          0.238966 |
| FUND  | `0x2FAa763726C4a1D0D9E6a768899D147aC4c42183` | AMZN → FUND → SPCX  |   0.487484 |       0.298285 |          0.189199 |
| PC    | `0xaCc78003fecb10e41896903DCE9BD08e49E9de0B` | MU → PC → NVDA      |   0.548238 |       0.398440 |          0.149798 |
| SPX   | `0x3363Cd5019Aa1F3E50C73086d5F5dCab3D90f558` | AAPL → SPX → NVDA   |   0.540838 |       0.398550 |          0.142288 |
| Grok  | `0xB36758EA446a1dFa5d90255D529c16ac75b0e124` | NVDA → Grok → SPCX  |   0.423156 |       0.298625 |          0.124531 |
| Elon  | `0xC71D692fF5323d818b425a9536301C5147ed3A6b` | SPCX → Elon → TSLA  |   0.503361 |       0.398382 |          0.104979 |
| CHIP  | `0x2a4eF4747640eba831f6EbA0d96185192DC01b3b` | AAPL → CHIP → AMD   |   0.384913 |       0.295717 |          0.089196 |
| BASIC | `0xb64bCfEC889a2cB5e2D634B6C512dB34428E8baF` | AAPL → BASIC → SPCX |   0.322229 |       0.297217 |          0.025012 |
| ASS   | `0xdEc8Fb367BCC8f354e4a9E93E2816A9bd671F45c` | SPY → ASS → AAPL    |   0.305356 |       0.297444 |          0.007912 |

MANGA's best observed route in the same snapshot was `AMZN → MANGA → AAPL`: `0.169448 USDG` gross and
`-0.127923 USDG` after the gas proxy. It therefore remained `GROSS_POSITIVE_NET_NEGATIVE`.

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
