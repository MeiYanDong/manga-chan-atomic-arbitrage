# Business dashboard and Feishu reporting production promotion

- Date: 2026-09-08 (Asia/Shanghai)
- Final runtime release: `803caaaaae11a5c8cbef00bcab4aaa23ac2eb919`
- Final archive SHA-256: `e1d90b656f45c28852a2518d59739a2d110fc544bf770a9c63dc257d0b883f86`
- Chain mutation caused by this promotion: none
- Trading watcher restart caused by this promotion: none

## Reviewed changes and gates

The production path was reviewed and merged in four bounded pull requests:

- PR #67 added the sanitized business projection, private dashboard and isolated one-shot reporter. PR CI
  `34218081196` and protected-branch CI `34218235481` passed.
- PR #68 replaced the nested npm reporter entrypoint with direct Node. PR CI `34219596569` and protected-branch CI
  `34219945371` passed.
- PR #69 accepted only systemd's isolated immutable `0440 root:root` runtime credential in the exact declared
  credential directory while continuing to reject ordinary group-readable files. PR CI `34220710197` and
  protected-branch CI `34220871218` passed.
- PR #70 constrained the dashboard's implicit grid column so a wide evidence table scrolls inside its own container
  instead of stretching business cards in a narrow browser. PR CI `34222745730` and protected-branch CI
  `34222935685` passed.

The final release installer reran the complete Linux gate before changing the `current` symlink. Formatting,
JavaScript/Solidity/shell lint, checked-JavaScript types, Vite build, Solidity compilation, 190 Node tests, all three
deterministic Cancun contract suites and the 184-file release secret scan passed. `systemd-analyze verify` accepted the
project units; its warnings referred to the host's unrelated `cloudmonitor.service`.

The same final source also passed `npm run check` locally: 190 Node tests, three deterministic contract suites and a
202-file repository secret scan. The macOS run accurately skipped Linux-only systemd semantic verification.

## Rejected starts and root causes

No delivery was claimed from either rejected start, and no success receipt existed at those boundaries.

1. Release `df5f98307d154406e56f2035e8b9908bbb0744cf` timed out after 45 seconds because `npm run` added a nested npm process
   under `TasksMax=16`. A transient unit with the same sandbox reproduced that timeout, while direct Node completed in
   under three seconds. PR #68 changed only the entrypoint; it did not raise task, memory or filesystem limits.
2. Release `0af9cbc25a265ff645e98aeb7ec9e0f8ed495682` reached the credential gate and failed closed. Runtime metadata proved
   that systemd decrypted the host-bound credential as immutable `0440 root:root` inside the unit-specific
   `/run/credentials/...` directory. PR #69 reused the repository's existing exact-directory predicate instead of
   weakening the ordinary-file permission rule.

The encrypted credential remains outside Git and environment files in the root-owned host credential store. Its value
was never printed during verification. The reporting unit loads no wallet credential, RPC credential, wallet client or
broadcast path.

## Feishu delivery and dedupe evidence

The corrected one-shot completed with:

```text
status=DAILY_REPORT_DELIVERED
periodKey=2026-09-07
sentAt=2026-09-08T11:34:51.437Z
```

The fsynced receipt recorded `status=DELIVERED`, Feishu `responseCode=0`, `responseMessage=success` and report hash
`3f1adac8e9997c7da54ee7ecd1a3051b562f6b7bc8ce2b8c91ebad4a2976f9fd`. Its completed Beijing day contained two
canonically confirmed USDG executions, `+1.209256 USDG` receipt-marked net and zero failed transactions/Gas.

The receipt, convenience delivery state and sanitized snapshot use modes `0600`, `0600` and `0640` respectively. A
second manual start returned `DAILY_REPORT_ALREADY_DELIVERED`; the receipt line count remained exactly one. This proves
period-key dedupe after a durable success receipt. It does not claim exactly-once delivery across the narrow crash
window after remote acceptance but before the local receipt is durable.

`manga-business-report.timer` is enabled, active and waiting. It refreshes the sanitized snapshot every five minutes,
retries only an undelivered completed day, and enforces the 09:05 Beijing cutoff in the reporter. Reporting failure is
isolated from both the board and trading watcher.

## Browser and business readback

The private SSH-forwarded view and `/api/v1/business` agreed on:

- strategy `RUNNING`, `UNTIL_REVOKED`;
- current authorization: zero exact preflights, zero signed attempts, zero confirmed executions and zero realized net;
- Beijing day `2026-09-08`: four historical generic USDG receipts and `+7.396727 USDG` verified execution net;
- all historical generic receipts: ten executions and `+9.463562 USDG` verified execution net;
- spendable balances: `35.344393 USDG` and `0.0032 WETH`;
- Feishu status `CONNECTED`, last period `2026-09-07`, next business cutoff 09:05 Beijing;
- ten recent receipt rows with fixed Robinhood Chain Blockscout links.

Browser DOM inspection found no `authorizationId`, `reportSha256`, `runtimeCodeHash` or `evidenceId` on the execution
page. At a real 389-pixel Codex browser viewport, `body.scrollWidth` was 389 pixels, the business grid was 361 pixels,
and the wide 1,040-pixel evidence table remained inside a 359-pixel horizontal-scroll container. The dashboard therefore
keeps primary business information readable without removing the intentionally wide evidence table.

## Runtime and isolation readback

Only `manga-opportunity-board.service` was deliberately restarted to load each dashboard build. The trading service PID
`196724` and watcher runtime PID `196745` stayed unchanged across both board restarts; its systemd restart count remained
zero. Processed board generations advanced from 49 to 60, while authorization usage remained zero, failed Gas remained
zero and `unresolvedMutation` remained null.

After the final board restart, `/healthz` returned `HEALTHY`, 863 candidate tokens, complete chain/source catalogs,
SQLite persistence `HEALTHY` and projection parity `true`. One transient proxy-positive row was visible at the final
health snapshot, but the watcher had not accepted a fresh execution candidate: its decision remained
`NO_SCREENED_OPPORTUNITY` with zero exact preflights. That proxy observation is not reported as a trade or profit.

Final signer-free `dual:runtime-verify` on release `803caaaaae11a5c8cbef00bcab4aaa23ac2eb919` returned
`RUNTIME_VERIFIED_READY_FOR_DUAL_ARM`: chain ID 4663, wallet nonce latest/pending `15/15`, wallet Gas balance
`0.00262778655474 ETH`, canonical USDG/WETH executor code hashes and balances, no unresolved mutation, and authorization
`ARMED / UNTIL_REVOKED`. The board readback explicitly reported `signerLoaded=false` and
`executionAuthorized=false`.

The first full release verifier attempt was throttled by the configured public RPC during the historical generic
executor read. No fallback to paid ChainStack was introduced. A later dual-only, signer-free retry succeeded. This is
read-path evidence and did not sign or broadcast a transaction.

## Remaining limits

- The dashboard is private loopback content reached through an SSH local forward; opening it still depends on that
  forward being present on the operator's computer.
- Feishu custom-bot delivery cannot provide an end-to-end idempotency key, so the documented remote-accept/local-crash
  duplicate window remains.
- Receipt-marked execution net is not full treasury accounting. External transfers, inventory basis and unmarked costs
  remain outside this projection unless separately reconciled.
- A healthy scanner, an observed proxy-positive row and a delivered report do not prove a new arbitrage execution.
