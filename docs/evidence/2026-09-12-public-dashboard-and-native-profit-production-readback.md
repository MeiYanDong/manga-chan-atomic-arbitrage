# Public dashboard and native-profit production readback

- Date: 2026-09-12
- Production host: `47.251.185.146`
- Application release: `2cb9daf35b47a8714741f21b2cecaeae79639f75`
- Public dashboard: `http://47.251.185.146/`

## Scope

This readback verifies two independent outcomes:

1. the dashboard is reachable from the public internet without a source-address or `Host` allowlist; and
2. native-ETH strategy profit shown by the dashboard is backed by successful Robinhood Chain receipts and wallet
   balance deltas.

It does not authorize a new trade, change an execution threshold, re-arm a watcher, disclose a signing secret or claim
that the project's historical setup costs have been recovered.

## Public read-path result

Pull request [#123](https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/pull/123) separated the static site from
the scanning process and added a short-lived stale-on-error cache for the read-only APIs. The deployed Nginx server is
the IPv4 and IPv6 default server with `server_name _`; port 80 is allowed by the SWAS firewall from `0.0.0.0/0`.
Port 8788 remains loopback-only because it is the internal board interface, not a second public dashboard address.

Before this release, one external root request returned no bytes before a 12-second timeout. The historical Nginx
status census contained 2,722 client-aborted `499` responses, 211 `502` responses and 49 `504` responses because both
static files and API projections waited on the same busy Node process.

After promotion, a twelve-round external readback requested `/`, `/api/v1/overview` and `/api/v1/business` on every
round. All 36 requests returned HTTP `200`; there were no connection errors or timeouts. Static root time to first byte
was approximately 0.41-0.50 seconds from the validation client. Overview was approximately 0.41-0.45 seconds. Business
responses were approximately 0.59-1.26 seconds and were served through the dashboard cache.

The release cold start exceeded the original 60-second orchestration health window. Its first board process later hit
the explicit 256 MiB V8 heap boundary and exited with status 134. Systemd restarted only the signer-free board. The
second process crossed the prior failure interval, published healthy generations and remained active. Final readback:

- `manga-opportunity-board.service`: active/running, one automatic restart, healthy SQLite parity, 3,945 candidates;
- `manga-dual-watcher.service`: active/running, unchanged PID `28147`, zero restarts;
- `nginx.service`: active/running;
- business-report timer and path: active/waiting; and
- deployed UI asset: `index-BMu1MZ6w.js`.

The board restart did not stop, restart or re-arm the independent live watcher. The retained authorization remained
`0x840860ba36fc8c50b9025ca969085deb5660eeef1d7ca18b2c7654e1121b2bd5` with status `ARMED`.

## Receipt-backed native profit

The current authorization has two successful, net-positive EarnOnHood triangle executions. Both receipts returned
`status=0x1` from Robinhood Chain's official public RPC, and the latest and pending wallet nonce both read `20` after
the second receipt.

| Receipt                                                                                                                        | Route                     |                Principal |             Gross result |                   Gas |                   Net result | Wallet balance delta                             |
| ------------------------------------------------------------------------------------------------------------------------------ | ------------------------- | -----------------------: | -----------------------: | --------------------: | ---------------------------: | ------------------------------------------------ |
| [`0x36b9...b26`](https://robinhoodchain.blockscout.com/tx/0x36b94186f99ad9e1d5659391fc33a35362445fd32150b52ba186951cd2b76b26)  | WETH -> AI -> MOO -> WETH | 0.001337743178846546 ETH | 0.000065637008807918 ETH | 0.000040904682936 ETH | **0.000024732325871918 ETH** | 0.002748210095727194 -> 0.002772942421599112 ETH |
| [`0xde47...133c`](https://robinhoodchain.blockscout.com/tx/0xde477053093ebf2afdd2d03b25428eb04028db0b43e20beb950c8cd532fe133c) | WETH -> AI -> MOO -> WETH | 0.001506010788536943 ETH | 0.000077956039915136 ETH | 0.000039930341268 ETH | **0.000038025698647136 ETH** | 0.002772942421599112 -> 0.002810968120246248 ETH |

The current authorization therefore has receipt-backed net profit of `0.000062758024519054 ETH`, with zero failed
transactions and zero failed-transaction Gas. The wallet's official-RPC balance readback was
`0.002810968120246248 ETH`.

Pull request [#124](https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/pull/124) corrects the business snapshot so
these native-ETH receipts are included instead of being omitted by the previous USDG/WETH-only aggregation. The
production API reports:

- current authorization: 2 Earn ETH receipts, `+0.000062758024519054 ETH`;
- Earn lifetime: 3 receipts, `+0.000194626251610248 ETH`;
- generic-v2 lifetime: 10 receipts, `+9.463562 USDG`; and
- project ledger: `-0.003752915361646521 ETH` net and `+13.303487 USDG` net with `PARTIAL` coverage.

The strategy's realized trades are positive after Gas. The whole project's ETH ledger is still negative because it
also includes prior deployment, authorization and setup costs. Those are different accounting questions and remain
separate on the dashboard.

## Validation gates

- Pull request #123 quality workflow: run `34693559201`, passed.
- Pull request #124 quality workflow: run `34694105166`, passed.
- Local release checks before promotion: formatting, lint, type checks, 263 Node tests, all three deterministic contract
  suites and secret scanning passed.
- Production readback used the SWAS control plane, loopback service health, the public IP, sanitized runtime ledgers and
  Robinhood Chain's official public RPC. A cached dashboard number alone was not treated as execution evidence.
