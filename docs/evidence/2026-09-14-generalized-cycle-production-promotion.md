# Generalized atomic-cycle production promotion

Date: 2026-09-14

## Outcome

Release `2a884519c3ef29723091b84c374083bf1218d935` (`v0.16.0`) is installed in production. The dual watcher is
enabled and `active/running` with zero restarts under authorization
`0x2ee4eb795ce54cd575b16e9dc19ffcea544748e8fabde2ae8ccf30fd56de762b`. The authorization is `UNTIL_REVOKED`,
has no execution, attempt or preflight count limit, and uses policy `dual-base-loopback-escalation-v11`.

This promotion proves that the live route search is no longer restricted to cross-platform USDG/WETH loops:

- same-venue and cross-venue atomic cycles share one typed graph;
- USDG and WETH are priority seeds rather than a settlement-asset allowlist;
- an event or recovery wake can admit other settlement assets only after fixed-block funding and executable USDG
  valuation checks; and
- the existing universal executor can execute the resulting multi-protocol plan atomically. No executor contract was
  redeployed for this release.

The first live v11 observation initially completed exact preflights without signing. It then found and automatically
executed one all-cost-positive Earn route. Canonical receipt and exact-block native-balance reconciliation report
`0.000029406726552562 ETH` realized net profit and zero failed Gas. This single receipt proves live execution; it does
not prove that future opportunities will exist or remain profitable.

## Release and cutover evidence

Pull request [#163](https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/pull/163) merged the implementation into
`main`. Required GitHub Actions run
[`34820487749`](https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/actions/runs/34820487749) passed. The complete
local `npm run check` gate passed with formatting, lint, shell syntax, TypeScript, UI build, four contract compilers,
361 Node tests, four deterministic contract suites and a 395-file secret scan.

Before installation, authorization `0xd417d040e41c30060158c0ada0fe8be00184f4770837aa597f132e51dcb1698a` was revoked, the old watcher was stopped and
`dual:reconcile` returned `CLEAN` with no unresolved mutation. The release installer then built the exact merged SHA
and passed the Linux systemd verification gate. Its server-side release scan covered 380 source files. The only
systemd diagnostics were pre-existing Alibaba Cloud Monitor warnings unrelated to the strategy units.

At production verification:

- `/opt/manga-chan-arbitrage/current` resolved to the immutable `2a884519...` release directory;
- chain ID was `4663` and wallet latest/pending nonce was `39 / 39` before arming;
- the USDG executor held `35.344393 USDG` and its source/runtime hashes matched the deployment ledger;
- the WETH executor held `0.0032 WETH` and its source/runtime hashes matched the deployment ledger;
- the universal executor remained `0xC167e650e8E3279a61d0650d963F65F768B031dA`, with two historical confirmed
  executions in its deployment ledger; and
- no unresolved transaction or deployment mutation existed.

## Dynamic settlement admission readback

One completed live event wake at block `62661006` reported:

| Field                                         | Observed value |
| --------------------------------------------- | -------------: |
| Graph assets                                  |             88 |
| Structurally eligible settlement assets       |             47 |
| Selected for fixed-block funding checks       |              4 |
| Funded and valuation-admitted                 |          **2** |
| Deferred by the bounded event workset         |             43 |
| Maximum admitted per wake                     |             16 |
| Total candidate routes across admitted assets |         15,454 |
| Event-touched routes                          |          8,411 |
| Exact-selected routes                         |              8 |
| Exact preflight duration                      |       4,706 ms |
| Source-to-decision latency                    |       5,911 ms |

The admitted settlement assets were WETH and `0x322F0929c4625eD5bAd873c95208D54E1c003b2d`. The second address was not one of
the configured USDG/WETH priority seeds. Its admission therefore directly proves that the production search uses the
rules-based policy rather than a two-token allowlist. The event was still bounded: the other structurally eligible
assets remain discoverable through later event or recovery rotation instead of expanding every hot wake into an
unbounded RPC fan-out.

The same graph contained 31 Earn pools, 29 Uniswap v2 pools, 113 Uniswap v3 pools, five attested Uniswap v4 pools and
46 hyperedges. Its route policy was
`BPT_HYPEREDGES_PLUS_ROTATING_SAME_OR_CROSS_VENUE_ATOMIC_CYCLES_UP_TO_4_HOPS`.

## Live execution and transport boundary

The Sequencer Feed connected with HTTP 101, 235 watched addresses, zero transport errors, zero rejections and zero
reconnects at acceptance. The watcher coalesced repeated relevant frames before preflight. Global discovery remained
public-first, with managed RPC admitted only through the bounded fallback budget. The daily managed logical-call
counter was `10,448 / 20,000`; that total includes work before the v11 cutover and must not be attributed entirely to
this authorization.

The dedicated Earn public-event reader briefly reported a 60-second public-RPC rate limit. It failed closed, made no
signature, and recovered to `WATCHING` with `eventError=null`. The Sequencer-fed global graph remained connected during
that interval. This is operational degradation evidence, not a failed or lost transaction receipt.

The watcher subsequently submitted and reconciled this canonical receipt:

| Transaction                                                                                                                    | Route                           |                Principal |                   Gas |           Inferred gross |                 Realized net |
| ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------- | -----------------------: | --------------------: | -----------------------: | ---------------------------: |
| [`0xc5a6...efa1`](https://robinhoodchain.blockscout.com/tx/0xc5a6e5c2e016286a739dc39031ad8e74e5826f297bc586ab7b5c1c3febe0efa1) | WETH -> USDG -> CASHCAT -> WETH | 0.001570796012888662 ETH | 0.000029501371026 ETH | 0.000058908097578562 ETH | **0.000029406726552562 ETH** |

The receipt was confirmed in block `62663447`. The exact-block wallet balance increased from
`0.003032711511577755 ETH` to `0.003062118238130317 ETH`, exactly matching the receipt-derived net after Gas. The
dynamic maximum principal at decision time was `0.002662711511577755 ETH`; the optimizer selected a smaller amount
because that amount produced the best protected result, not because of a fixed principal cap.

At the final runtime snapshot:

- `manga-dual-watcher.service` was `active/running`, `NRestarts=0`, with a 470 MiB observed memory peak;
- `manga-opportunity-board.service` was `active/running`, `NRestarts=0`, with a 559 MiB observed memory peak;
- `manga-opportunity-census.service`, `manga-business-report.timer` and `manga-business-report.path` were restored;
- all watcher error counters were zero;
- the current authorization had one confirmed execution, one signed attempt and zero failed Gas; and
- no unresolved mutation existed.

## Public business readback

The public dashboard, `/api/v1/business`, `/api/v1/system`, `/api/v1/profit/daily` and `/healthz` all returned HTTP
200 after the first full board publication. The board reported `HEALTHY`, 4,497 candidate tokens and complete retained
source counts. The initial post-restart health request timed out while the single-process board rebuilt its first
snapshot; the persisted schema-v5 snapshot completed before arming, and subsequent health readback returned 200.

The receipt-gated daily account after the transaction contained 13 confirmed executions: 11 Earn and two global. It
reported `1.664992 USDG + 0.000425481888080268 ETH` marked trading net and zero failed transactions or failed Gas. The
active-strategy section separately reported one Earn execution and `0.000029406726552562 ETH` net, so the new receipt
is not confused with the 12 earlier receipts from the same calendar day.

## Remaining boundary

The universal lane has no arbitrary operational principal ceiling: each candidate is sized from the fixed-block
flash-liquidity or protected-inventory evidence available to that settlement asset. The older dedicated USDG and WETH
executors retain their immutable contract caps (`100 USDG` and `1 WETH`); removing those caps would require a separate
contract migration and is not implied by this graph-search release.

One current exact-net-positive receipt exists for v11, so this deployment proves live coverage, safe execution gating
and one realized outcome, not stable future profit. The next optimization target is to reduce source-to-decision
latency and public-RPC pressure without weakening the fixed-block exact simulation, Gas floor, nonce convergence,
revocation or receipt-gated accounting boundaries.
