# Earn sizing hot-path v4 production promotion

- Date: 2026-09-12 (Asia/Shanghai)
- Production release: `868caba680d5a8f867c77f7bff59881a6ff82ec4`
- Pull request: #129
- Authorization: `0x85d40d06d2f7c639b6d2c311bd3ec9cb2751128a6f86465100ef71418c411989`
- Public dashboard: `http://47.251.185.146/`

## Outcome

The production Earn keeper now uses authorization-bound
`BALANCE_SCALED_BRACKET_REFINEMENT_V1` sizing. Every public wake quotes eight full-range inputs plus at most six local
refinements for each of the same four reviewed routes. This lowers the public exact-quote ceiling from 96 to 56. A
public-positive result freezes one committed route and its immediate amount bracket; the managed execution provider
then makes at most nine current-block quotes instead of repeating the complete four-route scan.

The event poll is one second. The v4 authorization commits the algorithm, both probe counts, both quote ceilings and
the polling cadence. No contract, route identity, Gas ceiling, lifetime Gas-solvency rule, wallet reserve, nonce gate,
protected output, final call, signed-raw persistence, receipt decoder or reconciliation rule was removed.

## Immutable source and gates

- PR #129 passed GitHub CI before merge; the protected `main` run `34700769947` independently passed after merge.
- The GitHub source archive SHA-256 was
  `bcb3f28c248e2f6d5f09434520d6666360cd712d2b3aa0a7d6252d7243ee1a47` both locally and on the server.
- Local `npm run check` passed formatting, JavaScript/Solidity/shell lint, checked-JavaScript types, the production UI
  build, all three Solidity compilations, `270/270` Node tests, all three deterministic contract suites and a
  `306`-file working-tree secret scan. macOS explicitly skipped Linux-only systemd verification.
- The Ubuntu installer repeated the complete gate, including `systemd-analyze verify`, `270/270` Node tests, all three
  deterministic contract suites and a `294`-file source-archive secret scan. The only systemd warnings concerned the
  host image's unrelated `cloudmonitor.service`.
- Contract source hashes remained unchanged: fixed `0x0a085f1e…c8755`, generic USDG `0x5b03b1f1…a78e` and WETH
  `0xcebb5a99…15c7`.

## Controlled cutover

The prior authorization `0xc34fef94660b1fc24cd73dc00e77a9c33575d1195cb6217aa506b54b57ccfaac` was durably
revoked before its watcher stopped. Reconciliation returned `CLEAN` with no unresolved mutation. Its mode-0600 lock
file named PID `37489`; the process was independently confirmed dead, and the new lock acquisition handled that stale
file under the checked-in atomic lock policy.

The installer moved `current` only after its Linux gate passed and explicitly left the signer stopped. The board was
then restarted from the exact release. Both the systemd MainPID and Node child working directories resolved to the
commit-addressed release. The first dual runtime verification refused to continue until a new execution snapshot
existed. After the board completed its cold start, runtime verification proved chain ID 4663, canonical executor code,
equal latest/pending nonce 22, current balances, signer-free schema-v5 board evidence and no unresolved mutation.

The board's first periodic maintenance briefly made `/healthz` return 503 or time out. The measured maintenance cycle
was about 69.4 seconds, including about 9.6 seconds of SQLite projection. No authorization existed during this window.
After health returned to `RUNNING`, persistence parity was true and consecutive errors were zero, the one-shot arm
created the v4 authorization. SSH banner reads were temporarily delayed under host load, so the already verified SWAS
instance was read back and the single watcher unit was started through Alibaba Cloud Assistant. The instance was not
rebooted and no firewall rule changed.

## Live readback

The post-start readback at `2026-09-12T15:23:44Z` reported:

```text
releaseSha=868caba680d5a8f867c77f7bff59881a6ff82ec4
watcher=active/running, NRestarts=0
authorization=ARMED / UNTIL_REVOKED
algorithm=BALANCE_SCALED_BRACKET_REFINEMENT_V1
coarseProbePoints=8
refinementPoints=6
publicMaximumExactQuotesPerWake=56
managedMaximumExactQuotesPerWake=9
eventPollMs=1000
USDG principal=35.344393
WETH principal=0.0032
Earn dynamicMaximumPrincipalEth=0.002563744570407984
unresolvedMutation=null
```

The first startup Earn wake received one official-public-RPC `429 Too Many Requests`. It failed closed before signing,
broadcast or Gas and scheduled normal event/recovery processing. The next reviewed-pool event completed successfully,
reset the consecutive Earn error count to zero and returned `NO_SHOT_NO_SIGNATURE_NO_BROADCAST`. Its best quote after
the complete Gas cap was `-0.000067300829994783 ETH`, so no managed exact preflight, signature or transaction was
created.

At the later business readback, the new authorization still had zero exact preflights, signed attempts, confirmed
executions, failed Gas and realized net. Historical evidence remained separate: one manual validation plus four
continuous receipts totaled five Earn executions and `0.000317402701771984 ETH` realized net, with zero failed Gas.

The business reporter completed successfully, its timer and path returned to active/waiting, and its public sanitized
snapshot reported Feishu delivery connected. The board later showed 4,049 admitted candidates, nine fresh quotes, one
gross-positive/net-negative candidate and zero screened-net-positive candidates.

## Remaining boundaries

- This release proves production activation and one recovered natural event wake. It does not prove a new profitable
  opportunity, a race win, opportunity frequency, continuous capacity or a sequencer advantage.
- The public UI's real endpoints returned HTTP 200 through the Nginx stale-on-failure cache. The opportunity summary is
  still roughly 6 MB and can exceed the browser's eight-second cross-region deadline. Reducing or paginating that read
  model is a separate presentation-reliability improvement; it does not affect the compact signer feed.
- The one-second public poll lowers event-detection delay but increases exposure to public-provider throttling. Managed
  RPC remains reserved for a public-positive candidate; this release does not silently spend paid quota on ordinary
  discovery or negative screens.
- Cross-protocol live execution, arbitrary-hook promotion, longer routes and flash liquidity remain outside this v4
  authorization. They require separate adapter identity, executable-path, Gas and receipt evidence.
