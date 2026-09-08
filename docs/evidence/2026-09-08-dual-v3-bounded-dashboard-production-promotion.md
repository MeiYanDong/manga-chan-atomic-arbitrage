# Dual-v3 and bounded-dashboard production promotion

- Date: 2026-09-08 (Asia/Shanghai)
- Production host: `manga-chan-arb-us-west`
- Active runtime release: `4c1a53f80dca0afd4d1cc44b1961d89d6a458981`
- Runtime verdict: accepted for continuous dual USDG/WETH observation and explicitly authorized execution
- Dual-era economic verdict at final readback: zero exact preflights, signatures, broadcasts, receipts, failed Gas and
  realized profit

## Evidence boundary

This record covers the WETH deployment receipt, dual authorization, source-catalog migration, dashboard OOM incident,
bounded correction, release-host gates and production readback. It does not infer profit from a quote, process, arm,
counter or deterministic test. A new dual-era profit exists only after a canonical receipt and reconciled base-asset and
Gas deltas.

The board is signer-free. The dual watcher is the sole active signing service, but it reads only the local persisted
execution feed while idle. Missing or empty feed data cannot authorize a strategy-RPC call, exact preflight, signature
or broadcast.

## Reviewed changes and gates

The production sequence was split into independently reviewed changes:

- [PR #60](https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/pull/60), merge commit
  `1d5739c7f7715a1af9958812f00ed6a89ae6d6ee`, added the WETH executor and one dual signing lane. Pull-request CI run
  [`34190180185`](https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/actions/runs/34190180185) and protected-branch
  run [`34190313652`](https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/actions/runs/34190313652) passed.
- [PR #61](https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/pull/61), merge commit
  `1c35726cf5d03ced51e2499917e37942b45f995e`, migrated the restart catalog to evidence-linked schema v5. Pull-request
  CI run [`34195055102`](https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/actions/runs/34195055102) and
  protected-branch run
  [`34195195560`](https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/actions/runs/34195195560) passed.
- [PR #62](https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/pull/62), merge commit
  `64b04f6eae14c78fdc12a9a7da5992037be9cce6`, bounded dashboard allocation after the production OOM. Pull-request CI
  run [`34200000868`](https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/actions/runs/34200000868) and
  protected-branch run
  [`34200174849`](https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/actions/runs/34200174849) passed.
- [PR #63](https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/pull/63), merge commit
  `4c1a53f80dca0afd4d1cc44b1961d89d6a458981`, separated observed empty generations from screened-positive generations.
  Pull-request CI run
  [`34202886424`](https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/actions/runs/34202886424) and protected-branch
  run [`34203067898`](https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/actions/runs/34203067898) passed.

The final commit-addressed archive matched locally and on the production host:

```text
7a6e1e116720ee42ef86cfb291274c791bf31f51b9fe225b299e28434fc831fc
```

The local and Linux release gates passed formatting, JavaScript/Solidity/shell lint, checked-JavaScript types, the Vite
production build, 179 Node tests and all three deterministic Cancun contract suites. Contract source hashes remained:

```text
GenericAtomicArb 0x5b03b1f117600d2e241f67eaa5026adc80082172daaa28b7cf84dfc3f26da78e
WethAtomicArb    0xcebb5a9911bcb49ef198e4bd105b3ed817f476c51c45434b5ff31f97e94715c7
```

The final local working-tree secret scan covered 187 files; the exact release-host artifact scan covered 168 files. Linux
`systemd-analyze verify` passed for repository units. Its two warnings named only the provider-installed
`cloudmonitor.service` and were not attributed to this project.

## WETH deployment and dual authorization

The WETH executor was deployed at block `57,489,230` by
[`0xee0cee4e11b383ff869be571db44f5fbebbe88c1793daf011f4fcb03ae78f880`](https://robinhoodchain.blockscout.com/tx/0xee0cee4e11b383ff869be571db44f5fbebbe88c1793daf011f4fcb03ae78f880).
The canonical receipt and post-state recorded:

```text
executor=0xeC6BB0511Eb7a348ad1879535F66320a51a3eDfc
gasUsed=2286076
effectiveGasPriceWei=268364000
gasSpentWei=613500499664000
seededWethWei=3200000000000000
strandedNativeWei=0
walletEthAfterWei=2627786554740000
```

Runtime verification later reproduced the WETH balance, bytecode hash
`0xf30f631cf1d4345a6cddd98db1b2b7bd9ae05872ec2a021df4bb28f2a3889408`, immutable amount cap and profit floor.
Deployment spent native ETH once to create and seed the executor. Thereafter WETH routes start and settle in WETH;
native ETH stays in the wallet for Gas.

Authorization `0x3922c6c44af592bf21a59839c59cdc3f3650d679320f26512130d12fb12fb696` was issued at
`2026-09-08T06:54:46.892Z` with nonce baseline `15` and execution baselines `10 USDG / 0 WETH`. It commits:

```text
authorizationLifetime=UNTIL_REVOKED
principalPolicy=ARM_PRINCIPAL_PLUS_CONFIRMED_GROSS_PROFIT_UP_TO_IMMUTABLE_CAP
principalAtArm=35.344393 USDG / 0.0032 WETH
hardCaps=100 USDG / 1 WETH
minimumScreenedNet=0.1 USDG
minimumExactNet=0.1 USDG
countLimits=UNLIMITED
failedGasBreaker=0.001 ETH
walletEthReserve=0.002 ETH
idleRpcBehavior=LOOPBACK_BOARD_ONLY
```

Count and time limits are intentionally absent, but every finite economic and mutation breaker remains. Confirmed
gross profit increases only the corresponding USDG or WETH authorized principal, up to that base's hard cap. An
external transfer does not silently expand the same authorization.

## Production dashboard incident

The schema-v5 restart file successfully shrank the earlier 82,341,726-byte catalog to about 39.5 MB and allowed the
board to complete scanning. The first dashboard control request exposed a separate eager-projection defect: every
`/api/v1/*` route expanded 41,652 historical source discoveries into full opportunity objects, including pools and
evidence timelines, even for `/api/v1/system`. Six concurrent browser requests repeated that allocation.

At `2026-09-08T15:01:41+08:00`, V8 reported two mark-compact cycles at about `251.4-251.6 / 259.0 MB` followed by
`Ineffective mark-compacts near heap limit`. The board exited with status 134 and systemd restarted it once. The cgroup
recorded no kernel OOM kill. The dual watcher stayed active and recorded no exact preflight, signature, broadcast,
receipt or failed Gas. The board was then deliberately stopped at `15:10:08` to contain another allocation loop while
the correction was reviewed.

The correction makes control routes build no opportunity projection, limits Radar to the current board-admitted set,
omits raw pools/evidence from list rows, and builds full evidence only for one requested ID. It also retains only a
derived Doppler visibility count and skips large no-op source merges. Immutable JSONL, SQLite, PoolKey and source
evidence remained intact; the 448/512 MiB cgroup boundaries were not raised.

## Production promotion and runtime readback

Release `64b04f6` first proved the bounded dashboard path across five complete `RUNNING` cycles from
`2026-09-08T07:45:23Z` through `08:04:44Z`. Release `4c1a53f` then added truthful empty-generation telemetry and was
installed after its own Linux gate. Both installs stopped the signer-free board during the memory-intensive release
test while leaving the watcher in its fail-closed local-feed retry path. Neither installer armed or started a signer.

The final board started at `2026-09-08T16:16:06+08:00` and completed full `RUNNING` cycles at `08:20:32Z`, `08:26:30Z`,
`08:32:52Z` and `08:40:08Z`. Each reported 862 admitted candidates, 5-8 fresh quotes and zero screened-positive rows.
The process retained one PID and zero restarts.

Five rounds of seven concurrent API requests exercised overview, sources, episodes, executions, system, the 862-row
opportunity summary and one-ID detail. All 35 responses returned HTTP 200; the slowest was under 0.36 seconds. Summary
rows omitted pools and evidence timelines, while the one-ID route returned its scoped claim evidence.

The complete final source catalog streamed through HTTP with exactly the same bytes and SHA-256 as the private atomic
file:

```text
bytes=39647889
sha256=ac9ecbfaee500dea38bef93b2292a2e7ce4ed8a64c6fe473c1b362f9776bb6fd
```

At the `08:41:59Z` service sample, board memory was about 339 MiB and watcher memory about 283 MiB. The board peak was
about 448.5 MiB under the 512 MiB hard limit. Its soft-pressure counter advanced, but `max=0`, `oom=0` and
`oom_kill=0`; the process returned to a lower working set and did not restart. The watcher likewise reported zero
cgroup pressure or OOM events.

The final no-signature runtime verification returned:

```text
chainId=4663
release=4c1a53f80dca0afd4d1cc44b1961d89d6a458981
wallet=0x77f771E83f118C32547A1291dda438a757B4b91B
walletEth=0.00262778655474
nonceLatest=15
noncePending=15
executorUsdg=35.344393
executorWeth=0.0032
unresolvedMutation=null
boardMode=READ_ONLY_NO_SIGNING_NO_BROADCAST
boardSignerLoaded=false
boardExecutionAuthorized=false
```

The dual watcher was then restarted once to load the final release, without replacing its authorization. Its first
readback and later generation reported:

```text
status=RUNNING
authorization=ARMED / UNTIL_REVOKED
processedBoardGenerations=2
screenedPositiveBoardGenerations=0
lastBoardCandidateCount=0
lastDecision=NO_SCREENED_OPPORTUNITY
consecutiveBoardErrors=0
consecutiveExecutionRpcErrors=0
exactPreflights=0
signedAttempts=0
confirmedExecutions=0
failedGasEth=0
unresolvedMutation=null
```

Standalone generic and fixed-route watcher services were inactive. The board and dual watcher were enabled, active and
at zero service restarts. The local port-forward used to view the loopback dashboard was restored separately; its
presence is not required for server execution.

## Late quote observation and follow-up boundary

After the final readback, the production board recorded one periodic proxy-positive episode for NIGGA:

```text
board publication=2026-09-08T08:45:38.173Z
quote timestamp=2026-09-08T08:42:59.997Z
age at publication=158.176 seconds
route=GOOGL -> NIGGA -> GME
base=USDG
amount=10 USDG
screened proxy net=0.003539 USDG
```

The watcher produced zero typed candidates for that generation. This was correct for two independent reasons: the
quote was already outside its strict 30-second execution horizon, and `0.003539 USDG` was below the authorization's
`0.1 USDG` screened-net floor. It therefore started no exact preflight, signature or broadcast and spent no Gas. A
later periodic observation closed the episode at proxy net `-0.047708 USDG`. This row is screening evidence, not a
missed executable profit claim.

The observation did reveal an ordering defect between otherwise separate workloads: selected quotes completed before
slower launch/source/chain catalog maintenance, but the signer projection was published only after that maintenance.
[ADR 0022](../decisions/0022-post-quote-execution-feed-checkpoint.md) accepts an immediate post-quote checkpoint while
retaining the 30-second gate. That follow-up is source/test evidence in the change that adds this paragraph; it is not
included in active runtime release `4c1a53f` and requires its own production promotion before being described as live.

## Economic state and remaining limits

The generic USDG executor has ten historical canonical receipts totaling `13.303487 USDG` gross profit,
`3.839925 USDG` marked Gas and `9.463562 USDG` marked net execution profit. After the separately marked
`2.322841 USDG` one-time generic deployment Gas, the combined historical marked result is `+7.140721 USDG`, excluding
seed-conversion impact. Those receipts predate the dual authorization baseline; they are not dual-v3 executions.

No dual-era receipt exists at this readback, so dual-era realized profit is exactly zero. Process continuity proves the
system is observing and ready; it does not establish opportunity frequency, ordering advantage or future profitability.

The official public RPC remains an explicit degraded fallback. It can rate-limit scans and has no independent receipt
reader or ambiguous-broadcast redundancy. The available Gas headroom above the committed `0.002 ETH` reserve is finite;
neither USDG nor WETH compounding replenishes native Gas. Direct signal causality, send-to-wire latency, sequencer
position and race-loss telemetry also remain unproven.
