# User-first operations console production promotion

- Date: 2026-09-08 (Asia/Shanghai)
- Final runtime release: `e9681ec28f10b3fd39bd70078c48397ed239f7b7`
- Final archive SHA-256: `c7d7d4aa3f410beabb4dee08cae28b3f12cddef7463505520e7374b5e43f3a76`
- Chain mutation caused by this promotion: none
- Trading watcher restart caused by this promotion: none

## Reviewed changes and gates

PR #72 introduced the Chinese-first four-page operations console, progressive evidence disclosure, current-strategy
accounting separation, opportunity stages, readable transaction ledger and simplified Feishu daily copy. Its pull
request CI run `34232268498` and protected-branch CI run `34232531491` passed.

Production browser review of that release found that an open opportunity drawer could remain mounted when a route was
changed through browser history or a direct hash transition. No false acceptance was recorded. PR #73 added a route
change dismissal and regression test; its pull request CI run `34234349903` and protected-branch CI run `34234537281`
passed. The final production release is the exact squash commit from PR #73.

The complete local gate passed formatting, JavaScript/Solidity/shell lint, checked-JavaScript types, Vite production
build, 195 Node tests, all three deterministic Cancun contract suites and a 207-file repository secret scan. The exact
production artifact independently passed the same gate on Linux, including `systemd-analyze verify`, 195 Node tests,
all three contract suites and a 189-file artifact secret scan. The systemd warnings named only the provider-installed
`cloudmonitor.service`.

## Production release identity and restart isolation

The first `e9681ec` install exposed an operational race rather than a code failure. At 21:55 Beijing time, the existing
business-report timer activated its one-shot unit while the board was intentionally stopped for the release gate. Its
`Wants=manga-opportunity-board.service` dependency started the prior `aa858cb` symlink target. The install then moved
`current`, but the following `systemctl start` was a no-op because the old board process was already active. The
filesystem and API release identities therefore disagreed, and the promotion was not accepted.

The timer was stopped, the board was explicitly restarted, and the timer was restored only after health and identity
converged. Final readback proved that all four release surfaces were
`e9681ec28f10b3fd39bd70078c48397ed239f7b7`:

- `/opt/manga-chan-arbitrage/current`;
- the board Node process working directory;
- the board Node process `MANGA_RELEASE_SHA` environment value; and
- `/api/v1/system.release`.

The final board service PID was `210528`, its systemd restart count was zero, and its first cycle completed healthy.
The trading watcher PID remained `196724`, its start time remained 17:39:30 Beijing time, and its restart count remained
zero before, during and after both board promotions. No deployment, authorization, signature or transaction command ran.

The runbook now requires the reporting timer to remain stopped across a board-only install and requires process-level
release verification before the timer is restored.

## Runtime and economic readback

After the final cold-start cycle:

- `/healthz` returned `HEALTHY`, SQLite persistence `HEALTHY`, projection parity `true`, complete configured-start
  chain/source catalogs, 866 candidate tokens and zero screened-positive routes;
- the market projection contained four fresh candidates, zero screened-positive routes and zero exact-ready routes;
- the dual watcher remained `RUNNING / UNTIL_REVOKED`, with 123 processed generations, zero exact preflights, zero
  signed attempts, zero current-strategy confirmations and no unresolved mutation;
- the current strategy remained at `0 USDG` verified net; the Beijing account day retained four historical executions
  and `+7.396727 USDG`, while all ten historical executions retained `+9.463562 USDG`;
- reinvestable capital remained `35.344393 USDG` and `0.0032 WETH`; and
- the last verified wallet Gas balance remained `0.00262778655474 ETH` against a `0.002 ETH` reserve.

The board's official public RPC entered bounded individual-request fallback during the first cycle and recorded logical
retries, but the cycle completed with zero consecutive errors and healthy persistence. This is degraded transport
evidence, not an execution or profit result.

## Browser acceptance

The final build was reloaded from the production loopback service through the private SSH tunnel. The observed phone
viewport was 388-389 CSS pixels with no horizontal document overflow. Earlier local acceptance against the same live
read-only APIs also covered 768 and 1440 CSS pixels without horizontal overflow.

Production interaction checks proved:

- the first view showed `本策略暂未成交`, `0.00 USDG` for the current strategy and a separately labeled `+7.40 USDG`
  account-day result;
- primary navigation contained only 总览, 机会, 账单 and 更多;
- the opportunity page defaulted to 可以执行, showed zero executable routes and kept all 866 observations behind
  全部观察;
- an opportunity card explained the failed business condition before technical evidence, and no token address was
  visible until the technical disclosure was opened;
- the ledger showed ten receipt-backed rows without a visible transaction hash until one row's 明细 was opened;
- the source page kept PAIR, LONG, Doppler and generic on-chain pools separate and stated `NINECAT 不属于 PAIR 平台`;
  and
- after opening an opportunity drawer and navigating to 更多, the drawer was absent and its contract address was no
  longer present in visible text.

## Feishu delivery boundary

The reporter was manually run only to refresh the sanitized business snapshot after board health. Durable delivery
receipt lines remained exactly one before and after both checks, proving the completed `2026-09-07` report was not sent
again. The timer is enabled, active and waiting for the next 09:05 Beijing schedule.

The revised Chinese message was verified through the production `preview` path. It contains only yesterday's verified
net, execution count by principal, failed Gas, current-strategy result, reinvestable capital, actionable opportunity
counts and market status. The revised copy has not yet received a new Feishu delivery receipt; natural delivery for the
next completed day remains pending.

## Remaining limits

- Current strategy profit remains zero because it has not produced a canonically confirmed execution. Account history
  must not be attributed to it.
- A healthy scanner and 866 observed candidates do not prove an executable opportunity.
- Receipt-marked execution net remains narrower than full treasury accounting; external transfers and unmarked basis
  are outside this dashboard.
- The private dashboard still requires an operator-side SSH forward.
