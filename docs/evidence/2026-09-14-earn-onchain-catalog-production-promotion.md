# Earn onchain catalog production promotion

- Date: 2026-09-14 (Asia/Shanghai)
- Release: `v0.13.1`
- Immutable commit: `b5975fba6dca578d391a31e61196e08b47c0df37`
- Active authorization: `0xd704841d7e8b214d4d738623c203fb5ca067abe9e580b0cdf845de85dda78152`

## Reviewed release gates

- Pull request: [#145](https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/pull/145)
- Ubuntu quality receipt:
  [run 34771476859](https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/actions/runs/34771476859/job/103761746823)
- Tagged artifact receipt:
  [run 34771600015](https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/actions/runs/34771600015)
- Immutable release: [v0.13.1](https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/releases/tag/v0.13.1)

The local and Ubuntu gates passed formatting, JavaScript/Solidity/Shell lint, checked-JavaScript type analysis, the UI
build, all three contract compilers, 303 Node tests, three deterministic contract suites and the source secret scan.
The production archive checksum and `RELEASE_COMMIT` matched the immutable merge SHA before installation. The Ubuntu
release build passed again and scanned 332 archived source files; the local checkout scan covered 347 files.

## Controlled cutover

The v0.13.0 watcher had failed closed because the Earn website catalog returned Cloudflare HTTP 403. It had made no
signed attempt, paid no Gas and left no unresolved mutation. Its v5 authorization
`0xea05759b24f032cd1715d69b705c3739471b3d7cbca599311339475b714c0958` was durably revoked before the service was
disabled. `dual:reconcile` returned `CLEAN`.

The board, census and report triggers were stopped while the 2 GiB host installed the release. The current symlink and
release environment then resolved to the immutable `b5975fb…` directory. `dual:runtime-verify` proved chain ID 4663,
wallet nonce `26/26`, both deployed executors, the signer-free schema-v5 board, and `unresolvedMutation=null` before a
new authorization was created.

Authorization v6 commits the canonical onchain Factory source, the current-Factory-plus-reviewed-legacy scope, WETH
settlement, two-to-four-hop graph, balance-scaled sizing, 120 public exact quotes and nine managed exact quotes per
wake. Count limits are unlimited, but the failed-Gas breaker, wallet reserve, fixed executor caps, final quote/call,
nonce and receipt gates remain enforced.

## First natural live result

The first confirmed v6 mutation was
[`0x2b904fdd635f6f9d46440b491b694d6ea0e739b516aed84cdde3b4fd8af91675`](https://robinhoodchain.blockscout.com/tx/0x2b904fdd635f6f9d46440b491b694d6ea0e739b516aed84cdde3b4fd8af91675)
at block `62140390`:

| Receipt fact          |                      Value |
| --------------------- | -------------------------: |
| Route                 |     `WETH -> PONS -> WETH` |
| Input                 | `0.000689660482469597 ETH` |
| Receipt-derived gross | `0.000047946587752902 ETH` |
| Canonical Gas         |    `0.000028601800332 ETH` |
| Wallet-balance net    | `0.000019344787420902 ETH` |
| Evidence              |     receipt + native delta |

This is a non-AI/MOO production receipt. It proves that the dynamic catalog can discover, quote, sign and reconcile a
previously unlisted token path; it does not establish future frequency or scalable capacity. After the receipt, the
authorization reported one confirmed Earn execution, zero failed Gas, no unresolved mutation and lifetime Earn net
after Gas of `0.000446396334142951 ETH`.

## Production readback

- Earn catalog: canonical Factory and fixed-block pool state, 30 Factory pools plus one reviewed legacy pool;
- graph: 7,586 structural WETH cycles (134 two-hop, 1,070 three-hop, 6,382 four-hop);
- board: `HEALTHY/RUNNING`, complete configured-start catalogs, SQLite integrity/parity healthy, signer absent;
- watcher: `active/running`, release `b5975fb…`, runtime PID `3062`, zero automatic restarts;
- public daily-profit API: current Beijing day contains one receipt-gated trade, net
  `+0.000019344787420902 ETH`, zero failed transaction Gas;
- public dashboard and static profit API returned HTTP 200 after the cold-start maintenance window;
- competitor census resumed in `BACKFILLING`; its partial counts cannot be read as full-market totals.

One early public preflight encountered HTTP 429 on a subset of optional identity checks but failed closed without a
signature. The next wake recovered and the confirmed PONS transaction used the protected final path. One manual
business-report refresh timed out during cold-start contention; a subsequent path-triggered refresh completed and
published the receipt, while both the timer and path remain enabled. Public-RPC rate limits and the board's periodic
maintenance latency therefore remain operational gaps, not hidden success claims.
