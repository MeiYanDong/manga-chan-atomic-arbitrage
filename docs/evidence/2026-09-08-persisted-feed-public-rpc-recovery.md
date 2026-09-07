# Persisted execution-feed and public-RPC recovery

- Date: 2026-09-08 (Asia/Shanghai)
- Production host: `manga-chan-arb-us-west`
- Pull requests: [#55](https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/pull/55) and
  [#56](https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/pull/56)
- Runtime release: `a34afd1cde38ec05eb722d44491a4159b8de227d`
- Runtime verdict: recovered and running under the existing explicit until-revoked authorization
- Economic verdict at readback: no ninth receipt, new execution or new realized profit

## Scope and evidence boundary

This recovery removes the signer's dependency on the board's HTTP event loop and restores execution-RPC availability
after the configured paid provider rejected requests. It does not prove that an opportunity exists, that a future
transaction will win ordering, or that public RPC is suitable for long-term production use.

Repository gates, service liveness, authorization, screened opportunities, signatures, broadcasts, receipts and
economic accounting remain separate evidence levels. The only profit evidence remains the canonical receipt ledger and
reconciled post-state.

## Failure sequence and fail-closed behavior

The until-revoked watcher survived the old ten-timeout terminal boundary, but later accumulated as many as 50
consecutive five-second board HTTP timeouts while the board's single Node event loop performed large reconciliation
cycles. Those failures occurred before targeted execution RPC, exact preflight or signing. This was an availability and
latency defect, not a transaction or fund-loss event.

Pull request #55 introduced an atomically replaced compact execution snapshot and a signer-side file reader. Its first
production start failed closed because `BoardStore` intentionally owns its private state directory with mode `0700`.
Granting group access to that directory would have weakened the board's private-store boundary, so the feed was moved
instead of relaxing that boundary.

During the first #55 installation attempt, running board and watcher processes competed with the full release gate and
host load rose to approximately 24. The installer was interrupted before the `current` symlink changed. No reboot was
performed. The incomplete directory was moved recoverably to:

```text
/opt/manga-chan-arbitrage/quarantine/d9e71a0246b9d237139949cdddb7a4afffb39455-interrupted-20260908T0230CST
```

The services were then stopped before running the gate again. Pull request #55 installed successfully, but watcher
startup next stopped safely at `eth_chainId`: the configured ChainStack endpoint reported that account services were
paused because of unpaid invoices. No signature, broadcast, nonce consumption or Gas expenditure occurred.

## Final transport and permission model

Pull request #56 moved the compact feed to a dedicated systemd runtime directory:

```text
/run/manga-opportunity-board-feed/execution-snapshot.json
```

The runtime directory is mode `0750`; the atomically replaced snapshot is mode `0640` and owned by `manga-board`. The
signer service receives read-only group membership. Production checks proved that the signer can read but cannot write
the feed, the board cannot read signer authorization/state, and the board's private persistent directory remains mode
`0700`.

The execution process rejects a public provider by default. Release #56 adds an explicit
`MANGA_ALLOW_PUBLIC_EXECUTION_RPC=1` emergency opt-in, and production uses that opt-in with Robinhood's official public
endpoint because the paid provider is currently unavailable. The previous provider configuration was backed up at:

```text
/etc/manga-chan-arbitrage/live.env.pre-public-fallback-20260908T0300CST
```

Both configuration files remain mode `0640`; no provider credential, private key or signed transaction was printed or
committed. Robinhood's [connection documentation](https://docs.robinhood.com/chain/connecting/) says that its public
endpoint is rate-limited and not recommended for production. Its
[public-RPC terms](https://docs.robinhood.com/chain/terms-of-service/) also disclaim uptime, latency and
data-completeness guarantees. Therefore this is a degraded recovery path, not a declaration of provider parity.

## Merge, artifact and gates

Pull-request #55 CI run
[`34151488542`](https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/actions/runs/34151488542) and protected-branch run
[`34151588522`](https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/actions/runs/34151588522) passed. Its exact
archive digest was:

```text
d9bcc4d4df7ac000a2124524a4b0f7c987466105b4da8f37f8ece4d2fa1f72fe
```

Pull-request #56 CI run
[`34153589080`](https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/actions/runs/34153589080) and protected-branch run
[`34153680017`](https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/actions/runs/34153680017) passed. The final
commit-addressed archive matched locally and on the production host:

```text
1da2a480d5d6d1d939612157f4b13a1a241bb9280f29db94db4ecb3c8311afa3
```

The final local gate passed formatting, JavaScript/Solidity/shell lint, checked-JavaScript types, the Vite production
build, both compiler paths, 140 Node tests, both deterministic Cancun contract suites and a 156-file secret scan. The
production installer independently passed 140 Node tests, both contract suites, a 138-file release-artifact secret scan
and Linux `systemd-analyze`. Repository units passed; the only systemd warnings named the provider's unrelated
`cloudmonitor.service`.

The `sniper-engineering` specification validator passed. Its offline audit still lacks signal-causality, send-to-wire,
sequencing-position and race-loss telemetry, so static coverage is not presented as competitive-execution proof.

## Authorization and chain state

The existing authorization was not replaced:

```text
authorizationId=0x7e580b5ff19c2db13f25439c4b9b751a7db29e48e2d050f05e179462a0de0b21
authorizationLifetime=UNTIL_REVOKED
expiresAt=null
principalPolicy=REALIZED_EXECUTOR_BALANCE_UP_TO_HARD_CAP
currentSpendablePrincipalUsdg=33.021814
principalHardCapUsdg=100
maxConfirmedExecutions=UNLIMITED
maxSignedAttempts=UNLIMITED
maxExactPreflights=UNLIMITED
maxFailedGasWei=1000000000000000
minimumExactNetUsdg=0.1
```

At `2026-09-07T19:06:10Z`, canonical readback was:

```text
chainId=4663
wallet=0x77f771E83f118C32547A1291dda438a757B4b91B
walletEth=0.006783953354208
nonceLatest=12
noncePending=12
executor=0x3f3A60A2da9E8D9811F41c6093280D7a90685aDD
executorUsdg=33.021814
confirmedExecutions=8
newArmExactPreflights=0
newArmSignedAttempts=0
newArmConfirmedExecutions=0
newArmFailedGasWei=0
unresolvedMutation=null
```

The contract source and runtime identities remained unchanged:

```text
sourceHash=0x5b03b1f117600d2e241f67eaa5026adc80082172daaa28b7cf84dfc3f26da78e
runtimeCodeHash=0x066ba301d3cda99b19801675673cb4e82c168ff9c51f8429e3cedf5bef66d706
```

## Runtime and isolation readback

At `2026-09-07T19:06:10Z`:

```text
watcher=active/running
watcherMainPid=170261
watcherRestarts=0
watcherStatus=RUNNING
lastDecision=NO_ELIGIBLE_SCREEN
processedBoardGenerations=5
consecutiveBoardErrors=0
consecutiveExecutionRpcErrors=0
currentSpendablePrincipalUsdg=33.021814
board=active/running
boardMainPid=170113
boardRestarts=0
boardSignerLoaded=false
boardExecutionAuthorized=false
```

Four samples at 30-second intervals crossed the old failure threshold without a restart. The watcher stayed
`active/running`, both error counters stayed zero, historical board-timeout audit count stayed exactly 86, and mutation
count stayed zero. Meanwhile the feed inode changed from `26390` to `26412`, its size changed from `12178` to `12891`
bytes, and the watcher advanced from two to four processed generations.

The board's HTTP health endpoint later returned `503/unready` during work, while the watcher remained `RUNNING` and
consumed another persisted generation. This directly proves transport isolation across the observed HTTP-stall class.
It does not prove indefinite uptime or future profitability.

Both services are enabled for host boot. The watcher uses `Restart=on-abnormal`; deliberate safety exits remain stopped
for review instead of being blindly restarted. Thus `UNTIL_REVOKED` means no time or count expiry, not unconditional
process immortality.

## Economic readback and remaining gaps

Economic state was unchanged:

```text
grossProfitUsdg=10.980908
gasSpentUsdg=2.985869
markedNetExecutionProfitUsdg=7.995039
oneTimeDeploymentGasUsdg=2.322841
combinedMarkedResultUsdg=+5.672198
executorUsdg=33.021814
```

There was no ninth receipt. Profit compounding is implemented, tested and authorized, but its first live transition
after a new confirmed receipt remains unobserved.

Open evidence and operational gaps remain:

- The public RPC may rate-limit, lag or become unavailable, and no independent receipt reader is configured for an
  ambiguous broadcast. An unresolved mutation therefore remains `UNKNOWN` and blocks the next nonce.
- No live transaction has yet been broadcast through the public execution fallback.
- The persisted feed protects watcher liveness but does not eliminate discovery latency inside the board.
- Direct signal-causality, wire timing, sequencer position and race-loss telemetry remain unknown.
- USDG profit can increase eligible principal only up to `100 USDG`; it cannot replenish the finite ETH Gas reserve.
- Manual revocation, balance, nonce, identity, exact-net, failed-Gas, ETH-reserve, unresolved-mutation and invariant
  breakers still stop execution when necessary.
