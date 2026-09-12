# Public funds dashboard production promotion

- Date: 2026-09-12 CST
- Public URL: `http://47.251.185.146/`
- Functional board release: `9baccca5d3125fe2b7ca70ad72f35833025d081f`
- Public-dashboard PRs: #112, #113 and follow-up hardening PR #114
- Scope: signer-free board UI, Nginx read-only boundary and SWAS TCP 80 rule

## Outcome

The Chinese-first funds dashboard is publicly reachable on TCP 80. It shows the current distribution of this arbitrage
project's funds across seven monitored wallets/contracts on Base and Robinhood Chain, followed by address-level evidence
and a receipt-linked explanation of the original `0.01 Base ETH` bootstrap. It does not claim to cover personal assets
outside this project.

Nginx is the only public dashboard listener. The Node board remains on `127.0.0.1:8788`; the SWAS firewall has no 8788
rule. An external HTTP request to 8788 timed out with zero response bytes; the same environment produced synthetic TCP
connects on several arbitrary unopened ports, so TCP connect alone was not accepted as application exposure evidence.
Public requests can read the UI, `/healthz` and `/api/v1/*`. A production request to
`/api/event-metrics` returned 404 and a POST to `/api/v1/business` returned 403. The response included restrictive CSP,
frame, referrer, permissions, MIME and crawler headers. The surface has no wallet connection, signing, broadcast,
withdrawal, private key, RPC credential or Feishu webhook.

## Reviewed release and gates

- PR #112 GitHub Actions run/job `34672656338 / 103496842850`: passed before merge.
- PR #113 GitHub Actions run/job `34672831688 / 103497331330`: passed before merge.
- Exact GitHub source archive SHA-256:
  `ce3a7a28dd7c8ef7062a3d63a43bf072721c246880bf0fff1edd266476027b7a`.
- Local `npm run check`: formatting, JavaScript/Solidity/shell lint, checked-JavaScript types, UI build, all three
  compiler paths, `248/248` Node tests, three deterministic contract suites and a final `278`-file secret scan passed.
- The Ubuntu release installer independently repeated the full gate, including Linux systemd verification, `248/248`
  Node tests, all three deterministic contract suites and a `265`-file archive secret scan.
- Public desktop and 390 px mobile screenshots rendered the current funds map and bootstrap receipt successfully.

## Current verified fund distribution

The natural business snapshot at `2026-09-12T04:35:03.225Z` reported both network projections as `VERIFIED`:

| Network / role            | Current amount                                              |
| ------------------------- | ----------------------------------------------------------- |
| Base Gas wallet           | `0.006987074636027231 ETH`                                  |
| Base WETH executor        | `0.003 WETH`                                                |
| Robinhood Gas wallet      | `0.002759654781831194 ETH`                                  |
| Robinhood active strategy | `35.344393 USDG` and `0.0032 WETH`                          |
| Robinhood parked recovery | `15.676618 USDG`                                            |
| Robinhood all contracts   | `51.021011 USDG`, `0.0032 WETH`, `0.002759654781831194 ETH` |

The Base bootstrap panel is historical evidence, not a current-balance equation: after the initial funding receipt,
`0.006987074636027231 ETH` remained in the wallet, `0.003 WETH` entered the executor, and
`0.000012925363972769 ETH` paid deployment/initialization Gas. Those three amounts equal exactly `0.01 ETH`.

## Runtime isolation and economic readback

After promotion:

- board MainPID/release: `19095 / 9baccca5d3125fe2b7ca70ad72f35833025d081f`;
- continuously running signer MainPID/release stayed
  `14379 / c387ba4351c5f08d27bf0891e67c960ae4847c5c` with `NRestarts=0`;
- Nginx MainPID `18140` and the business-report timer were active;
- board health was `HEALTHY/RUNNING`, SQLite persistence parity was true, both configured-start catalogs were complete,
  3,895 candidates were retained and zero rows were screened positive;
- both strategy services were `RUNNING`, with zero confirmed executions, zero verified execution net and zero failed
  Gas in the current business projection.

No signer restart, re-arm, transaction signature, broadcast or fund movement occurred during this promotion.

## Deployment observations

The first remote release command passed every artifact gate and started the verified board, but invoked the Nginx
installer outside the release directory. Its relative default config path therefore failed closed before the firewall
was opened. The rollback restored the previous symlink; the already-running verified board remained on the new release.
The operator then converged the symlink and release environment, supplied the Nginx config by absolute path, and
validated the virtual host before opening TCP 80.

The first post-reload curl raced an old Nginx worker and returned 404; the same reviewed virtual host returned 200 on
immediate diagnostic readback. A follow-up installer change retries this bounded readiness window and restores the prior
configuration if it never becomes healthy.

Alibaba Cloud's Aegis systemd unit remained failed because of a pre-existing leftover updater process first recorded at
`2026-09-12 06:45 CST`, hours before this deployment. Cloud Assistant itself remained healthy and all strategy,
dashboard, reporting and Nginx services were active. This unrelated host-agent issue is not presented as closed.

## Remaining boundary

This is direct-IP HTTP, not HTTPS. It is suitable only for the intentionally public, read-only, non-secret surface. A
domain and TLS certificate are required before adding authentication, wallet controls or any other sensitive feature.
The prepaid SWAS instance currently expires on `2026-10-04T16:00:00Z` unless renewed.
