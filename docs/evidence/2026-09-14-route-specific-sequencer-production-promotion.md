# Route-specific Sequencer production promotion

Date: 2026-09-14

## Outcome

Release `ee8724ec867121cd836dcefea82189f41ea8e0f2` (`v0.15.3`) is the active production release. The dual watcher is
enabled, `active/running`, has not restarted, and remains armed until explicit revocation under authorization
`0xd417d040e41c30060158c0ada0fe8be00184f4770837aa597f132e51dcb1698a`.

The production readback proves both parts of this promotion:

- a specific event now has one global budget of eight exact route quotes, shared fairly as four USDG-settled and four
  WETH-settled routes when both settlement lanes have candidates; and
- the live system produced three canonical, net-positive Earn receipts after the new authorization was armed.

These receipts prove live execution and realized profit. They do not prove that the global cross-protocol lane won a
race: all three new receipts came from the Earn lane, and the active authorization's global receipt count remained
zero at the acceptance snapshot.

## Release identity and controlled cutover

The installed release is `/opt/manga-chan-arbitrage/releases/ee8724ec867121cd836dcefea82189f41ea8e0f2`, and the
`current` symlink and `/etc/manga-chan-arbitrage/release.env` resolve to the same commit. The uploaded archive SHA-256
is `83849c118fcf335deea9a2b72a020d5350bcf2011a90ff1f10413bf93239b45c` on both the build host and server.

The Linux systemd gate passed before activation. The only messages were pre-existing Alibaba Cloud Monitor warnings
about its own `KillMode` and `PIDFile` configuration. The strategy units passed their checks.

The first two arm commands stopped before writing an authorization because the public RPC returned `header not found`
while reading a fixed-block token balance. Neither attempt signed or broadcast a transaction. A fresh third preflight
passed every chain, deployment, board, nonce, reserve and unresolved-mutation gate and created the authorization above.

At acceptance:

- `manga-dual-watcher.service` was `active/running`, with `NRestarts=0`;
- the feed policy was `SPECIFIC_POOL_OR_NON_HUB_ASSET_PATH_V3`;
- the route workset policy was `SPECIFIC_EVENT_GLOBAL_BUDGET_THEN_PERIODIC_ROTATION_V3`;
- count limits remained `UNLIMITED`, while the net-profit floors, ETH reserve, failed-Gas breaker, nonce checks and
  revocation marker remained active; and
- no unresolved mutation existed.

## Why two production corrections were necessary

The v0.15.1 cutover separated protocol roots, specific pools/hooks, non-hub assets and settlement hubs. Its first live
authorization produced one confirmed Earn execution with `0.00002827361040568 ETH` realized net and zero failed Gas.

Production then exposed two implementation defects that static configuration review had not made obvious:

1. Every Uniswap v4 catalog edge used the shared PoolManager as its `address`. It therefore appeared in both the
   protocol-root and specific-pool sets, which caused PoolManager traffic to wake nearly the entire route graph. v0.15.2
   removes protocol-root overlap from the specific-pool set.
2. The documented eight-route event ceiling was applied once per settlement asset, allowing sixteen routes per event.
   v0.15.3 applies one fair global budget after the settlement lanes build their candidate sets.

The v0.15.2 watcher observed 6,943 feed frames, accepted 3,329 wakes and filtered 3,614 frames without feed errors or
reconnects. It produced no new receipt and spent no failed Gas before its authorization was explicitly revoked for the
v0.15.3 cutover.

## Global workset acceptance

One completed production event reported:

| Field                      |                Observed value |
| -------------------------- | ----------------------------: |
| Wake classification        | `SPECIFIC_POOL_OR_HOOK_MATCH` |
| Total graph routes         |                        12,091 |
| Event-touched routes       |                           854 |
| Pre-budget candidates      |                            16 |
| USDG allocation / selected |                         4 / 4 |
| WETH allocation / selected |                         4 / 4 |
| Global selected routes     |                         **8** |
| Source to preflight start  |                      1,133 ms |
| Exact preflight duration   |                      7,703 ms |
| Source to decision         |                      8,836 ms |

The eight-route ceiling is therefore proven in the production runtime. The approximately 8.8-second decision latency
is still an optimization target; this observation does not claim that every profitable state can be captured before a
competitor.

The same snapshot showed one connected Sequencer Feed session with 1,797 frames, 1,002 actionable wakes, 795 filtered
frames, zero transport errors, zero rejections and zero reconnects. Seven malformed frames were rejected and did not
enter the signer path.

## Canonical live results

All three transactions were accepted by the direct Sequencer submission path; managed fallback was not used. Each
result is derived from a successful canonical receipt and the wallet's native balance delta, after Gas.

| Transaction                                                                                                                    | Route                        |                Principal |                   Gas |                 Realized net |
| ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------- | -----------------------: | --------------------: | ---------------------------: |
| [`0xd332...cd56`](https://robinhoodchain.blockscout.com/tx/0xd3323402247b78d81fc3c61f0d60694a052978313c154dd357b0077f0a80cd56) | WETH -> EARN -> NVDA -> WETH | 0.000150108061135230 ETH | 0.000032006035456 ETH | **0.000162806794818358 ETH** |
| [`0x37c8...2431`](https://robinhoodchain.blockscout.com/tx/0x37c85e95a068a1efa8886db89ef765873be50fc05e5544e6c8abe6ba1b162431) | WETH -> EARN -> NVDA -> WETH | 0.000160283485811377 ETH | 0.000032447637504 ETH | **0.000039532153107708 ETH** |
| [`0x4339...07be`](https://robinhoodchain.blockscout.com/tx/0x4339b398e1993f928eca54c9be1f5212e27c810d141fde37319b297fa1eb07be) | WETH -> AMD -> NVDA -> WETH  | 0.000040688561345152 ETH | 0.000033769419378 ETH | **0.000023143279582744 ETH** |

Together they produced `0.000323705319846810 ETH` inferred gross profit, spent `0.000098223092338 ETH` in canonical
Gas and realized **`0.000225482227508810 ETH` net**. There were no reverted transactions and no failed Gas.

An independent official public-RPC read at block `62588627` showed:

- wallet ETH increased from `0.002771728978163681` to `0.002997211205672491`, exactly the aggregate realized net;
- wallet latest and pending nonce converged at `37 / 37`, after advancing from 34 through the three receipts;
- the USDG executor retained `35.344393 USDG`; and
- the WETH executor retained `0.0032 WETH`.

## Public business and competition readback

After the business-report timer and ledger-change path were restored, the public endpoints returned HTTP 200 with
`no-store` caching and no source-address restriction:

- `/healthz` reported `HEALTHY`, a running persisted snapshot, SQLite parity and a complete configured catalog;
- `/api/v1/business` reported 10 confirmed executions for 2026-09-14: eight Earn and two global, with
  `1.664992 USDG + 0.000360574855622442 ETH` verified net and zero failed transactions/Gas;
- the same endpoint reported 29 all-time confirmed executions, `11.128554 USDG + 0.000787626402344491 ETH` verified
  net, and the active authorization's three receipts and `0.00022548222750881 ETH` net separately; and
- `/api/v1/competitors/earn` was `CURRENT` through safe block `62587916`, with 138 external cycle receipts, 20
  external actors and `0.021684081794211734 ETH` estimated normalized external net in its seven-day retention window.

The competition census still reports `confirmedLostRaces=null`. External same-period activity is evidence of
competition, not proof that this strategy saw and lost the same executable state in the same block.

## Verification and remaining boundary

The complete local `npm run check` gate passed before promotion: formatting, ESLint, Solhint, shell syntax, TypeScript,
UI build, all contract compilers, 351 Node tests, four deterministic contract suites and a 391-file secret scan. The
GitHub required-quality workflow also passed before each implementation PR was merged. The production release build
secret scan covered 376 files.

The system is live and profitable at this snapshot, but future profit is not guaranteed. The next engineering target is
decision latency: retain the exact final simulation and receipt-only accounting while replacing broad per-event quote
work with incremental state updates and economically ranked route invalidation. Exact lost-race attribution remains
unknown until same-block counterfactual evidence is implemented.
