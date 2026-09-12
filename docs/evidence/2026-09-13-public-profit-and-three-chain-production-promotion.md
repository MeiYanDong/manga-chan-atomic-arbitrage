# Public profit API and three-chain production promotion

- Date: 2026-09-13 (Asia/Shanghai)
- Public dashboard: `http://47.251.185.146/`
- MANGA release: `d948ac56003554b2912d3f5cb5738a1ea358756f`
- Cross-venue shadow release: `f72e3b5727a7ae023b87fee6ccb18b4cb41bcee6`

## Outcome and boundary

The public operating dashboard now exposes a receipt-gated daily-profit API and a separate cross-venue opportunity API.
The latter reports fixed-block observations from independently deployed Uniswap and PancakeSwap venues on Robinhood
Chain and BNB Chain. These new networks are read-only shadow coverage: their snapshot explicitly reports
`signingEnabled=false` and `broadcastEnabled=false`.

The existing Robinhood dual-base watcher and Base live canary remained the only active execution lanes. This promotion
did not move funds, change an authorization, sign or broadcast a transaction, or expand a wallet's scope.

## Quality and release receipts

- Feature PR [#131](https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/pull/131), quality
  [run/job 34707422669/103589893028](https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/actions/runs/34707422669/job/103589893028): passed.
- Operator-focus PR [#132](https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/pull/132), quality
  [run/job 34710189204/103597429863](https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/actions/runs/34710189204/job/103597429863): passed.
- Release-headroom PR [#133](https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/pull/133), quality
  [run/job 34712327559/103603206196](https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/actions/runs/34712327559/job/103603206196): passed.
- Cross-venue engine PR [#2](https://github.com/MeiYanDong/atomic-cycle-engine/pull/2), quality
  [run/job 34707421351/103589889514](https://github.com/MeiYanDong/atomic-cycle-engine/actions/runs/34707421351/job/103589889514): passed.
- Final local `npm run check`: formatting, JavaScript/Solidity/shell lint, checked-JavaScript types, UI build, three
  compilers, `273/273` Node tests, all three deterministic contract suites and a `314`-file secret scan passed.
- Production `release:build`: checked-JavaScript types, UI build, three compilers and a `302`-file source-archive secret
  scan passed. The source archive SHA-256 was
  `74d0fab7fa56fd6f431995aa7bf7368c49ed42e2684e1bbae39fbabc7cc0c701`.

## Production readback

At `2026-09-12T19:00:10Z`, the immutable MANGA symlink resolved to the release above. The signer-free board reported
`HEALTHY/RUNNING`, full configured-start chain and source catalogs, healthy SQLite persistence and exact projection
parity. Its PID was `2892`, `NRestarts=0`, current memory was `398,405,632` bytes and observed peak memory was
`537,395,200` bytes inside the `603,979,776`-byte hard limit. No board errors were present after the final cold start.
At `2026-09-12T19:03:22Z`, a later soak readback still reported the same PID and zero restarts; both its kernel working
directory and `MANGA_RELEASE_SHA` resolved to the exact release. The business-report timer and path had settled to
`active/waiting`, with the preceding one-shot result successful.

Independent process readback preserved the pre-promotion identities:

| Runtime lane                       |    PID | State          | Restarts | Authority                       |
| ---------------------------------- | -----: | -------------- | -------: | ------------------------------- |
| Robinhood dual USDG/WETH watcher   |  `797` | active/running |        0 | existing live authorization     |
| Base bounded live canary           |  `779` | active/running |        0 | existing bounded authorization  |
| Robinhood + BNB cross-venue shadow |  `780` | active/running |        0 | read-only; no signer/broadcast  |
| Multi-pool operating board         | `2892` | active/running |        0 | read-only presentation boundary |

The public root, `/api/v1/profit/daily` and `/api/v1/opportunities/chains` each returned HTTP `200` from an external
client. The APIs returned `Cache-Control: no-store` and `Access-Control-Allow-Origin: *`; attempted `POST` requests were
rejected with HTTP `403` by the public proxy.

## Time-bound economic result

The daily-profit API was generated at `2026-09-12T18:58:36.681Z`. The in-progress Beijing day, `2026-09-13`, contained
zero successful trades, zero marked USDG/ETH trading net and zero failed transactions. The latest completed day,
`2026-09-12`, retained five receipt-gated Earn executions and `0.000317402701771984 ETH` marked trading net. Whole-project
business net remained `UNKNOWN` because operating-cost coverage is partial; marked strategy profit is not silently
treated as a complete business P&L.

The cross-venue snapshot was generated at `2026-09-12T18:58:27.265Z`:

| Network         | Fixed block | Attempted cycles | Fully quoted | Gross positive | Gas-adjusted positive | Provider failures |
| --------------- | ----------: | ---------------: | -----------: | -------------: | --------------------: | ----------------: |
| Robinhood Chain |  `61335579` |               36 |           14 |              0 |                     0 |                 0 |
| BNB Chain       | `121505858` |               36 |           26 |              0 |                     0 |                 0 |

No execution was missing from these two shadow lanes: neither network produced a gross-positive route, so none could
pass Gas and risk-reserve gates. The evidence proves healthy coverage for the configured graph at those blocks, not the
absence of every possible opportunity on either chain.

## Incident and remaining limits

An earlier promotion repeated the complete test and deterministic contract suites on the no-swap production host. The
2 GB class server became resource-starved and required a controlled restart. A later board cold start exhausted the old
256 MiB V8 heap while rebuilding the growing compact source index. The final release keeps the full suites in the
mandatory GitHub quality gate, limits production to runtime-artifact reconstruction and uses a measured 320 MiB V8 heap
inside 512/576 MiB cgroup thresholds. The final production install completed in 25 seconds; board health was gated
separately before reporting triggers were restored.

The server still has no swap and only about 525 MiB was available at final readback, so future board growth remains a
capacity constraint. Robinhood and BNB cross-venue coverage remains shadow-only until a separate executor, contract
compatibility, capital, allowance and loss-bound review is approved. Direct-IP public access is HTTP rather than TLS.
