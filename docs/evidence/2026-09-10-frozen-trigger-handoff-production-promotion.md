# Frozen-trigger handoff production promotion — 2026-09-10

## Outcome

Release `2f3007ddd9293863a56c0665cde30d6705b9f7a7` is running on both the production signer-free board and dual-base
signer. The signer reports
`LOOPBACK_FROZEN_TRIGGER_THEN_SAME_BLOCK_DUAL_EXACT_PREFLIGHT`, proving that the v0.8.6 watcher loaded the frozen
candidate handoff path.

The deployment did not add a pool, hook, token, RPC endpoint, principal, signing permission, Gas allowance or profit
threshold. No transaction was created by the release. A post-release screened-positive trigger has not yet occurred,
so production evidence proves code identity, runtime activation and preserved safety boundaries, not a successful live
exercise of the new branch.

## Reviewed release and reproducible gates

- PR: [#95](https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/pull/95)
- merged release commit: `2f3007ddd9293863a56c0665cde30d6705b9f7a7`
- protected-branch quality job:
  [34459708740 / 102814352159](https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/actions/runs/34459708740/job/102814352159)
- exact GitHub source archive SHA-256: `011d14b16f9e0305f87aef1a9e2084622f4586a44c7e32d7c8f94ff9d682594a`

The final local `npm run check` passed formatting, JavaScript/Solidity/shell lint, checked-JS type analysis, dashboard
build, all three Solidity compilations, 226 Node tests, all three deterministic contract suites and a 236-file secret
scan. GitHub CI passed the same quality gate.

The server downloaded the merged-commit archive independently and matched its SHA-256 before stopping any service.
The release installer then passed 226 Node tests, all three deterministic contract suites and a 218-file artifact
secret scan before moving the `current` symlink. The installer explicitly reported that it did not arm or start a
service.

## Controlled signer cutover

Immediately before stopping the old processes, production proved:

- an empty execution feed with `executionAuthorized=false` for both USDG and WETH selection;
- no unresolved mutation;
- wallet nonce `15/15`;
- canonical chain ID `4663` and matching deployed executor identities;
- balances of `35.344393 USDG`, `0.0032 WETH` and `0.00262778655474 ETH` for Gas;
- authorization `0x7039d0e14a6ccecb19f0ee4c75740362ab2a98b1e2eef43259a896bd3035cd62`, still
  `ARMED / UNTIL_REVOKED`; and
- two exact preflights, zero signed attempts, zero confirmed executions and zero failed Gas under that authorization.

The business-report timer, dual watcher and board were stopped in that order. After the install gate, the board started
first and had to pass loopback `/healthz` plus exact process-working-directory verification. The signer then restarted
under the existing authorization; it was not re-armed. The report service and timer were restored last.

## Post-release readback

The `current` symlink, board Node process and signer Node process all resolved to the exact merged release directory.
Both services were active with `NRestarts=0`; the report timer was active. Canonical runtime verification repeated chain
ID `4663`, nonce `15/15`, the same executor balances and identities, `unresolvedMutation=null`, a signer-free board and
the unchanged active authorization.

After nine new execution-feed generations, the signer remained `RUNNING` with:

- trigger mode `LOOPBACK_FROZEN_TRIGGER_THEN_SAME_BLOCK_DUAL_EXACT_PREFLIGHT`;
- zero board errors and zero execution-RPC errors;
- two cumulative exact preflights, zero signatures, zero receipts and zero failed Gas; and
- latest decision `NO_SCREENED_OPPORTUNITY`.

The board retained healthy SQLite/evidence parity and no last error. Its latest readback had 3,524 admitted candidates,
two fresh quotes, one gross-positive/net-negative row and zero screened-net-positive rows. The first two completed
event-to-quote observations after restart were 48,870 ms and 28,912 ms. These values show that the public RPC remains
variable; this release addresses candidate handoff correctness, not quote capacity.

Board memory was approximately 442 MB at the soak readback, below its 512 MiB hard limit but above the 448 MiB soft
threshold during parts of the run. The signer used approximately 282 MB. Both cgroups reported zero `max`, `oom` and
`oom_kill` events. Root disk utilization was 64%.

## Remaining boundary

The next genuine opportunity will be the first production exercise of the frozen trigger. Only the audit handoff
record, exact-preflight result and any later canonical receipt/post-state can prove its behavior and economics. Until
then, realized profit under the active dual authorization remains exactly zero.

The broader market bottleneck is independent: 3,524 admitted candidates currently collapse to one fully
execution-compatible candidate, and public-RPC event quotes still take tens of seconds. Expanding official-hook pool
admission or assigning a paid event-only RPC lane is a separate scope/cost decision and is not authorized by this
release.
