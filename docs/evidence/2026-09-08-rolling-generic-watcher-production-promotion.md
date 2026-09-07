# Rolling generic watcher production promotion

- Date: 2026-09-08 (Asia/Shanghai)
- Production host: `manga-chan-arb-us-west`
- Pull request: `#50`
- Release commit: `8cf94600d663ed3d6a637cc96e2f89ffebaf1ef2`
- Runtime verdict: accepted for the explicitly authorized generic-v2 live lane
- First real renewal verdict: not yet observed; the initial renewal window opens on 2026-09-14 00:40:17 Asia/Shanghai

## Merge, artifact and gates

Pull-request CI run `34143799770` passed before merge. Protected production-branch CI run `34143903059` then passed
against the exact squash commit. The commit-addressed archive matched locally and on the production host:

```text
ac51180dc3111b0e5603f417611ce6e167edf7c636e7d6a171b09000e665d936
```

Local `npm run check` passed formatting, JavaScript/Solidity/shell lint, checked-JS types, the Vite build, both compiler
paths, 133 Node tests, both deterministic Cancun contract suites and a 150-file secret scan. The local macOS host
explicitly skipped Linux-only systemd verification. The production installer independently passed the same gate with
133 tests, both contract suites, a 132-file release-artifact secret scan and Linux `systemd-analyze`. Its only systemd
warnings named the provider's unrelated `cloudmonitor.service`; the repository units passed. Installation changed the
`current` symlink but did not start, stop, arm or sign.

The sniper-engineering offline audit also ran. It found static evidence for the documented race thesis, identity gates,
quote/simulation path, decision gates and raw-broadcast boundary. It reported no direct signal-causality or wire-timing
telemetry. Those are opportunity-quality and race-performance evidence gaps; heuristic keyword coverage is neither a
safety proof nor a profitability claim.

## Authorization design

Schema v2 keeps one immutable authorization ID for the whole risk epoch. A lease revision can change only
`expiresAt`, `lastRenewedAt` and `leaseRevision`; the commitment retains the initial expiry, duration, renewal window,
deployment identity, nonce baseline, principal, profit floors, ETH reserve and failed-Gas limit. Audit-ledger usage is
selected by authorization ID, so failed Gas, exact preflights, signed attempts and confirmed executions remain
cumulative across renewals.

Renewal occurs inside the already-running Linux watcher, not a systemd timer or Codex task. It is allowed only before
expiry after canonical deployment, clean mutation, exact nonce, positive executor principal and wallet reserve checks.
Transient provider failures retry after five minutes while the old lease is valid. An expired lease cannot revive
itself. Disarm writes an authorization-specific durable revocation marker before signalling the watcher, so a concurrent
stale renewal cannot restore authority.

## Controlled cutover

Immediately before cutover, the old process still resolved to release
`e48192f29ebc13c461a20bb629ae9e0223d584b0`. Its schema-v1 authorization had two confirmed executions, two signed
attempts, three exact preflights, zero failed Gas and no unresolved mutation. The service stopped cleanly as
`STOPPED_BY_SIGNAL` with nonce-writing process and lock absent. Authorization
`0xbc562e4510b6dec7f288d085a48953f117800787d7cdd5afdaa37ce62f3cd806` was then disarmed and durably revoked.

The post-stop canonical runtime verification returned:

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

That direct command intentionally supplied the strategy configuration but not the optional release environment file,
so its `releaseSha` field was `UNKNOWN`. Release identity was proved separately by the installed symlink, the running
process working directory and `MANGA_RELEASE_SHA` in that process; all three resolved to the exact commit above.

The previous mode-0640 strategy configuration was copied to
`/etc/manga-chan-arbitrage/live.env.pre-rolling-20260907T163829Z`. Only the two reviewed rolling-policy keys were added;
the 168-hour arm duration, `unlimited` count settings and existing economic/risk values were retained. No endpoint or
credential value was printed or committed.

The new one-shot arm succeeded with:

```text
authorizationId=0x63df6ad407c48eb7f82b5a64be05eb7111e732a7b13cd9eff6579db2de31a554
issuedAt=2026-09-07T16:40:17.457Z
expiresAt=2026-09-14T16:40:17.457Z
renewWindowStartsAt=2026-09-13T16:40:17.457Z
autoRenewLease=true
leaseRevision=0
maxPrincipalUsdg=33.021814
minimumExactNetUsdg=0.1
minimumScreenedNetUsdg=0.1
maxConfirmedExecutions=UNLIMITED
maxSignedAttempts=UNLIMITED
maxExactPreflights=UNLIMITED
maxFailedGasWei=1000000000000000
```

The watcher then became `active/running` from the exact release with `NRestarts=0`, `leaseAllowed=true`, zero renewal
errors, zero new-arm attempts, zero new-arm failed Gas and no unresolved mutation. A later readback remained
`RUNNING / NO_ELIGIBLE_SCREEN`; service memory was approximately 295 MB against its 512 MB hard limit. The signer-free
board was deliberately not restarted: it remained active from release `c979ec5e11b115a63ea4660194d1de533d440ed8`
with zero restarts, healthy SQLite persistence parity, a 448 MiB pressure threshold and a 512 MiB hard limit. No on-chain
transaction was submitted by the installation or authorization cutover.

## Current economic ledger

The deployment ledger contains eight canonical successful executions from 2026-09-05T05:25:16.322Z through
2026-09-07T16:01:37.592Z:

```text
grossProfitUsdg=10.980908
gasSpentUsdg=2.985869
markedNetProfitUsdg=7.995039
gasSpentEth=0.001209252967416000
executorUsdgAfter=33.021814
```

The last two receipts before this promotion were:

- [`0xbd70e8ea90086fde4424a575cbf707c11add30b668526a4b56cb2ad9dab1f9ad`](https://robinhoodchain.blockscout.com/tx/0xbd70e8ea90086fde4424a575cbf707c11add30b668526a4b56cb2ad9dab1f9ad)
- [`0x1a783205df5d01af6372cc71a98262e681bd8bb938e010aa77a05d844064939c`](https://robinhoodchain.blockscout.com/tx/0x1a783205df5d01af6372cc71a98262e681bd8bb938e010aa77a05d844064939c)

The USDG Gas figure is a contemporaneous native-asset mark, not a USDG fee transfer. The eight-execution sample remains
too small and temporally clustered to infer hourly opportunity frequency or future race-win probability.

## Remaining open evidence

- No production lease revision has occurred yet. Unit tests prove boundary behavior; the first real renewal and its
  persisted audit event require later readback.
- During the first 14 minutes after startup, the audit ledger recorded eight isolated five-second loopback-board request
  timeouts. Every incident remained at one consecutive error and recovered without a restart, signature or unresolved
  mutation; the current counter returned to zero. This does not threaten nonce safety, but it can delay candidate
  observation and remains an open board-responsiveness issue.
- Rolling authorization is continuous operating authority within the fixed risk epoch. Failed-Gas exhaustion, ETH
  reserve failure, nonce conflict, UNKNOWN mutation, invariant failure and explicit disarm still stop it.
- The principal cap is fixed at `33.021814 USDG`. Later retained profit cannot silently increase order size; a higher cap
  requires a clean disarm and fresh authorization.
- Count limits are explicitly unlimited, not all risk. The failed-Gas ceiling remains `0.001 ETH`, and every transaction
  must independently pass exact positive-net and atomic settlement gates.
- Public-board screens, process liveness and this promotion are not future-profit evidence. Only canonical receipts and
  post-state update the realized ledger.
