# Until-revoked compounding watcher production promotion

- Date: 2026-09-08 (Asia/Shanghai)
- Production host: `manga-chan-arb-us-west`
- Pull request: [#53](https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/pull/53)
- Release commit: `dc8b392abc17f9472ec1458284d9c6fc6fa80019`
- Runtime verdict: accepted for the explicitly authorized generic-v2 live lane
- New-arm transaction verdict at readback: no exact preflight, signature, broadcast, receipt or realized profit

## Scope and evidence boundary

This promotion removes the wall-clock expiry and permits confirmed retained USDG to increase later eligible principal.
It does not claim that a new opportunity has executed, that profit will continue, or that the current eight-execution
sample establishes an opportunity frequency. Repository tests, process liveness, board output, chain receipts and
economic accounting remain separate evidence levels.

`UNTIL_REVOKED` means that time and count do not end the authorization. It does not bypass explicit disarm, deployment
identity, nonce, unresolved-mutation, exact-net-profit, failed-Gas, ETH-reserve, balance, route or invariant gates. Each
transaction still has an independent 45-second on-chain deadline and must settle atomically.

## Pre-promotion incident

The schema-v2 rolling watcher was not continuously running when this work began. It first stopped at approximately
2026-09-08 01:13:58 Asia/Shanghai after ten consecutive five-second loopback-board timeouts. A manual restart reached
the same terminal state again at approximately 01:20:13. The board's full snapshot was about 5.76 MB, and the signer
requested that full projection once per second. `Restart=on-abnormal` does not restart a deliberate non-zero process
exit, so systemd retained the failed state.

Both failures occurred before targeted execution RPC, exact preflight or signature. Canonical readback showed nonce
`12 / 12`, executor balance `33.021814 USDG`, no unresolved mutation and no new authorization usage or failed Gas. The
incident is therefore an availability defect, not a transaction or fund-loss event.

The correction makes the board expose a small execution projection, separates board-only failures from execution-RPC
failures, and retries the signer-free board phase indefinitely with capped backoff. Execution-RPC failure retains its
finite halt policy.

## Merge, artifact and gates

Pull-request CI run
[`34148872328`](https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/actions/runs/34148872328) passed before merge.
Protected production-branch CI run
[`34148955938`](https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/actions/runs/34148955938) then passed against the
exact squash commit. The commit-addressed archive matched locally and on the production host:

```text
20b93a77268327a406c99e7e9bb458ea4f809fdede5a7898a3a939dd539f74bf
```

The full local quality gate passed formatting, JavaScript/Solidity/shell lint, checked-JS types, the Vite production
build, both compiler paths, 138 Node tests, both deterministic Cancun contract suites and a 153-file secret scan. The
local macOS run explicitly skipped Linux-only systemd verification. The production installer independently passed 138
tests, both contract suites, a 135-file release-artifact secret scan and Linux `systemd-analyze`. The only systemd
warnings named the provider's unrelated `cloudmonitor.service`; repository units passed.

The `sniper-engineering` specification validator passed. Its offline audit found the documented action shape and broad
static coverage, but no direct signal-causality or wire-timing telemetry. The audit also emitted heuristic warnings for
JSON keys found in generated artifacts. Those warnings and telemetry gaps are retained as race-performance evidence
gaps; neither the audit nor its keyword coverage proves profitability or competitive sequencing.

## Authorization and compounding policy

The schema-v3 arm commits:

```text
authorizationLifetime=UNTIL_REVOKED
expiresAt=null
principalPolicy=REALIZED_EXECUTOR_BALANCE_UP_TO_HARD_CAP
principalHardCapUsdg=100
maxConfirmedExecutions=UNLIMITED
maxSignedAttempts=UNLIMITED
maxExactPreflights=UNLIMITED
maxFailedGasWei=1000000000000000
minimumExactNetUsdg=0.1
minimumScreenedNetUsdg=0.1
```

Before the first new execution, eligible principal is the canonical executor balance captured at arm time. After a
confirmed receipt, the watcher derives it from the most recent reconciled `executorUsdgAfterWei`, capped at `100 USDG`.
An external top-up is deliberately not adopted inside the same authorization epoch. Immediately before signing, the
watcher rechecks the actual executor balance and authorization. Opportunity sizing still chooses the greatest absolute
screened-net candidate from the bounded amount grid; it does not blindly submit the full available balance.

Gas remains paid from the operator wallet in ETH. Retaining and compounding USDG does not replenish that reserve.

## Controlled production cutover

The release archive installed into an immutable commit-addressed directory, and `/opt/manga-chan-arbitrage/current`
resolved to the exact release commit. The signer-free board was restarted first. Before restart, both the full and
execution-query snapshot were `5,766,404` bytes because the old process ignored the query. After restart, the full
snapshot was `5,764,435` bytes and the execution projection was `9,749` bytes, approximately 591 times smaller. The
board remained loopback-only and reported `signerLoaded=false` and `executionAuthorized=false`.

The old authorization `0x63df6ad407c48eb7f82b5a64be05eb7111e732a7b13cd9eff6579db2de31a554` was durably
disarmed at `2026-09-07T17:51:41.245Z`. The watcher lock was absent, and no unresolved mutation existed. The mode-0640
strategy configuration was backed up as
`/etc/manga-chan-arbitrage/live.env.pre-until-revoked-20260908T015000CST`. No endpoint or credential value was printed or
committed.

The post-stop canonical readback was:

```text
chainId=4663
wallet=0x77f771E83f118C32547A1291dda438a757B4b91B
walletEth=0.006783953354208
nonceLatest=12
noncePending=12
executor=0x3f3A60A2da9E8D9811F41c6093280D7a90685aDD
executorUsdg=33.021814
confirmedExecutions=8
unresolvedMutation=null
```

The new one-shot arm created authorization
`0x7e580b5ff19c2db13f25439c4b9b751a7db29e48e2d050f05e179462a0de0b21` at
`2026-09-07T17:52:21.265Z`. Its readback had no `expiresAt`, a `100 USDG` immutable hard cap, a current eligible
principal of `33.021814 USDG`, all three count limits set to `UNLIMITED`, zero usage, zero failed Gas and no unresolved
mutation. No deployment or trade transaction was submitted during installation, disarm or re-arm.

## Runtime readback

At `2026-09-07T18:04:25Z`, more than eleven minutes after startup and beyond both prior failure windows:

```text
watcher=active/running
watcherMainPid=164947
watcherRestarts=0
runtime=RUNNING
lastDecision=NO_ELIGIBLE_SCREEN
processedBoardGenerations=6
consecutiveBoardErrors=0
consecutiveExecutionRpcErrors=0
board=active/running
boardMainPid=164534
boardRestarts=0
currentSpendablePrincipalUsdg=33.021814
newArmExactPreflights=0
newArmSignedAttempts=0
newArmConfirmedExecutions=0
newArmFailedGasWei=0
unresolvedMutation=null
```

During this interval, the board's single Node event loop still produced temporary five-second response stalls while a
large reconciliation cycle was in progress. The new-arm audit contained 27 board-only timeout records, with a maximum
run of 16, then recovered to `RUNNING` and processed newer generations without a restart. Those retries loaded no
signer RPC and created no mutation. This proves the repaired watcher no longer terminates at the old ten-error boundary;
it does not prove low-latency discovery while the board is busy.

## Economic readback

The deployment ledger still contains the same eight canonical successful executions:

```text
grossProfitUsdg=10.980908
gasSpentUsdg=2.985869
markedNetExecutionProfitUsdg=7.995039
oneTimeDeploymentGasUsdg=2.322841
combinedMarkedResultUsdg=+5.672198
executorUsdg=33.021814
```

There was no ninth receipt at promotion readback. Automatic principal growth is implemented, tested and authorized, but
its first production transition from one confirmed `executorUsdgAfterWei` to the next eligible amount remains
unobserved. It must not be described as realized compounding until that receipt and post-state exist.

## Remaining open evidence

- The board still blocks its own HTTP handler during some reconciliation work. Indefinite board retry prevents another
  signer shutdown, but a separately served persisted execution projection would be required to remove the degraded
  intervals and measure their opportunity cost.
- Direct signal-causality, send-to-wire timing, sequencing position and race-loss telemetry remain unknown.
- The failed-Gas ceiling remains `0.001 ETH`; cumulative failed Gas is never netted away by a successful trade.
- The current ETH reserve is finite. USDG compounding cannot make execution literally perpetual if Gas reserve or any
  other safety gate fails.
- `UNTIL_REVOKED` is continuing authority, not a future-profit guarantee. Only canonical receipts and reconciled
  post-state can advance the realized ledger and eligible principal.
