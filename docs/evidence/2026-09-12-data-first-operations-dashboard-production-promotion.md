# Data-first operations dashboard production promotion

- Date: 2026-09-12 (Asia/Shanghai)
- Public URL: `http://47.251.185.146/`
- Final production release: `381285f42b1534fde3ded8af397f8626327a9598`
- Scope: signer-free board UI, sanitized business reporter and its timer/path triggers

## Outcome

The production dashboard is now a restrained, Chinese-first, data-first operations surface with four primary pages:
概览, 交易, 资金 and 策略. It presents verified strategy results, project economics, current fund distribution and the
execution/source state before technical evidence. Capital transfers, deployments, authorizations, arbitrage receipts,
collections and failed transactions share one chronological ledger. The original Base funding is an ordinary transaction
record instead of a special funds-page story.

The first public browser pass caught and rejected two misleading presentation details. PR #118 replaced an underlying
USDG contract address in collection titles with the reviewed MANGA/SPX identities. PR #119 separated the live execution
badge from market-data coverage, so an incomplete market projection does not falsely claim that the signer stopped.
Addresses, full hashes, blocks and explorer links remain behind explicit evidence disclosures.

## Reviewed releases and gates

- PR #117, GitHub Actions run/job `34679291336 / 103514764671`: passed before merge.
- PR #118, GitHub Actions run/job `34680190316 / 103517331290`: passed before merge.
- PR #119, GitHub Actions run/job `34680914694 / 103519267343`: passed before merge.
- Final GitHub source archive SHA-256:
  `2300ee6eea0175c93842ecc3c1008fa5da18094f7b4508ecb072bb06e60391a3`.
- Feature-branch local `npm run check`: formatting, JavaScript/Solidity/shell lint, checked-JavaScript types, UI build,
  all three compilers, `256/256` Node tests, three deterministic contract suites and a `289`-file secret scan passed.
- The final Ubuntu installer repeated the complete gate with Linux systemd verification, `257/257` Node tests, all
  three deterministic contract suites and a `278`-file source-archive secret scan.

The first Cloud Assistant attempt used a Bash-only `pipefail` option under the host's default `/bin/sh` and exited on
line one. No download, service stop or file mutation occurred. The corrected POSIX orchestration performed checksum
verification, retained the previous snapshot/release for rollback and promoted only after the full server gate passed.

## Runtime isolation and reporting

The signer remained active throughout the three board-only promotions:

- systemd MainPID `21398`, Node PID `21412`, `NRestarts=0`;
- authorization `0x395bb0c6fa5e1c333acc6ead6f0fc9c13eee4c36b96bd93f0ca2b73bd7740502` remained
  `ARMED / UNTIL_REVOKED`;
- arm, USDG ledger and WETH ledger hashes remained byte-identical;
- current-authorization usage remained zero exact preflights, zero signed attempts, zero confirmed executions and zero
  failed Gas.

The final signer-free board ran as PID `25807`; its parent and Node child working directories both resolved to the exact
release. Board health was `HEALTHY/RUNNING`, SQLite parity was true and both catalogs were complete from their configured
start. The report timer and path watcher were active/waiting. A natural 15:40 CST timer run completed successfully and
wrote schema v3 at `2026-09-12T07:40:05.753Z`. Feishu delivery remained connected; the last durable delivered period was
2026-09-11 and the next scheduled delivery remained 09:05 CST.

No signer restart, re-arm, signature, broadcast, contract call or fund movement occurred during this dashboard release.

## Production economic readback

At the natural timer snapshot:

| View                              | Verified value                                                                        |
| --------------------------------- | ------------------------------------------------------------------------------------- |
| Today, current live strategy      | `0` executions, `0 USDG` net, `0 ETH` failed Gas                                      |
| Historical marked strategy result | `10` executions, `+9.463562 USDG` net                                                 |
| Partial native USDG ledger        | `+13.303487 USDG` positive effect, `0 USDG` recorded cost                             |
| Partial native ETH ledger         | `+0.000131868227091194 ETH` positive effect, `0.003947541613256769 ETH` recorded cost |
| Spendable strategy principal      | `35.344393 USDG` and `0.0032 WETH`                                                    |
| Robinhood Chain tracked funds     | `51.021011 USDG`, `0.0032 WETH`, `0.002748210095727194 ETH`                           |
| Base tracked funds                | `0.003 WETH`, `0.006987074636027231 ETH`                                              |

The marked USDG strategy net and the partial native-asset project ledger are intentionally separate accounting views.
They must not be added together: the former includes the strategy's USDG Gas mark, while the latter preserves observed
token effects and native ETH costs without inventing a cross-asset conversion. Project-ledger coverage remains
`PARTIAL`; unknown historical activity is not treated as zero.

The same snapshot observed 3,916 candidate tokens, nine fresh quotes, zero screened-positive routes and zero exact-ready
routes. These values are time-bound evidence, not a claim that the whole discovered market had been freshly quoted.

## Browser verification and remaining boundary

Production desktop and 390 px mobile browser checks covered the overview, transaction ledger and labelled funds rows.
The header reported 实盘运行中, collection rows reported SPX/MANGA, and browser warning/error logs were empty. The funds
page required no horizontal scrolling for its primary data records.

The public endpoint remains direct-IP HTTP, not HTTPS. The underlying board can still pause read responses during heavy
single-process market maintenance; the client now bounds each request, retains the last successful values and labels
partial data instead of blocking the entire page. This improves usability but does not remove the server-side latency
boundary.
