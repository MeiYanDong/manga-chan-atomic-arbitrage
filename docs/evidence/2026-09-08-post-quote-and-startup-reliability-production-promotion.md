# Post-quote and startup reliability production promotion

- Date: 2026-09-08 (Asia/Shanghai)
- Production host: `manga-chan-arb-us-west`
- Active runtime release: `d7f15d3f8c60aa77e8c560adfdda0c5970d23be7`
- Runtime verdict: accepted for continuous dual USDG/WETH observation and explicitly authorized execution
- Economic verdict at final readback: zero dual-era exact preflights, signatures, confirmed executions, failed Gas and
  realized profit

## Evidence boundary

This record promotes two narrow reliability changes: publishing a signer-free execution-feed checkpoint immediately
after a newly quoted proxy-positive batch, and retrying transient dual-watcher startup reads before loading the private
credential. It separates deterministic branch coverage, deployed runtime state, public-RPC recovery, chain readback and
economic receipts.

No real post-quote checkpoint has fired since deployment, and the final controlled restart did not encounter a transient
startup failure. Those two branches therefore remain test-verified but not live-exercised. A process, quote, screen,
authorization or deterministic transaction is not a profit receipt.

## Reviewed changes and gates

[PR #64](https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/pull/64) merged the post-quote checkpoint as
`55177b8a28807b8ef91dded6f5378d6963a66467`:

```text
pull-request CI=34208134952 passed
protected-branch CI=34208314886 passed
release archive SHA-256=f65feab8acd9c0ccf2a22385dc97507103a7d4d1d8388e99dc386b0ba559691e
Linux Node tests=181 passed / 0 failed
Linux deterministic contract suites=3 passed
Linux release-artifact secret scan=172 files passed
```

[PR #65](https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/pull/65) merged bounded startup RPC retry as the active
release `d7f15d3f8c60aa77e8c560adfdda0c5970d23be7`:

```text
pull-request CI=34210580893 passed
protected-branch CI=34210729792 passed
release archive SHA-256=88ef15eab48f247383a6eef9cf7e2d53e84a4172c16671acb526a3b90c4273a6
Linux Node tests=182 passed / 0 failed
Linux deterministic contract suites=3 passed
Linux release-artifact secret scan=175 files passed
```

Both Linux installs also ran the repository format, JavaScript/Solidity/shell lint, checked-JavaScript type, Vite build
and Solidity compilation gates. `systemd-analyze verify` passed for repository units. Its only warnings named the
provider-installed `cloudmonitor.service` and were unrelated to this project.

## Post-quote checkpoint

The triggering production observation was a `10 USDG` `GOOGL -> NIGGA -> GME` proxy screen quoted at
`2026-09-08T08:42:59.997Z` and published at `08:45:38.173Z`. Its proxy net was only `0.003539 USDG`. It was correctly
ineligible because the quote was 158.176 seconds old and independently below the authorization's `0.1 USDG`
screened-net floor. The watcher started no exact preflight, signature or broadcast and spent no Gas. A later observation
closed the screen at proxy net `-0.047708 USDG`.

The correction publishes the existing compact signer-free projection immediately after a just-quoted batch contains a
proxy-positive USDG or WETH lane, before slower source and chain catalog work. It adds no publication for an all-negative
batch and changes none of the 30-second freshness, PoolKey, route, authorization, exact-profit, nonce, Gas, receipt or
UNKNOWN gates. Tests accept an otherwise valid projection at 29.999 seconds, reject it at 30.001 seconds and count one
candidate with two positive base lanes only once.

After deployment, production telemetry remained:

```text
executionFeedCheckpoints=0
lastExecutionFeedCheckpointAt=null
lastExecutionFeedCheckpointCandidateCount=0
```

That is expected because the post-deploy batches observed at this readback were all non-positive. It proves the ordinary
path does not create extra writes; it does not yet measure live positive quote-to-feed latency.

## Startup throttle and correction

After `55177b8a` passed its Linux gate, a controlled watcher restart received `429 Too Many Requests` while reading
PoolManager bytecode from the configured official public RPC. The watcher failed closed at `HALTED_STARTUP` before it
loaded a candidate, exact-preflighted, signed or broadcast. Pausing the signer-free board for eight seconds and starting
the same authorization again recovered the process without changing nonce, balances or usage.

The correction retries the complete read-only startup evidence bundle up to five attempts, with 1, 2, 4 and 8-second
backoff. Only classified state-not-ready, throttle and network failures retry. Wrong chain, code/constants,
authorization, ledger, nonce and unresolved-mutation failures remain terminal on their first observation. Retry output
is redacted, and the private credential is loaded only after all chain evidence converges.

Deterministic tests prove that a `429` recovers on a later attempt, a wrong-chain invariant executes exactly once and
signer loading follows successful readback. The final production restart had `startupRpcRetries=0`; no failure was
induced merely to make the live counter nonzero.

## Final production readback

Release `d7f15d3` was installed from its hash-matched artifact. The board reached HTTP readiness after loading its
persisted state and completed a full healthy cycle at `2026-09-08T09:42:54.874Z`. The dual watcher was deliberately
restarted once, reached `RUNNING` at `09:39:42.992Z`, retained the same until-revoked authorization and consumed current
feed generations.

The official public RPC then returned a `429` during a board reconciliation. The board published `DEGRADED` at
`09:44:00.043Z`, while the idle watcher remained running and performed no mutation. Without operator intervention, the
board completed a new healthy cycle at `09:48:57.909Z`:

```text
board status=HEALTHY
candidate tokens=863
screened positive=0
persistence=HEALTHY / parity=true
chain catalog=COMPLETE_FROM_CONFIGURED_START
source catalog=COMPLETE_FROM_CONFIGURED_START
```

Five rounds across seven concurrent dashboard endpoints produced 35 HTTP 200 responses; the slowest was about 0.727
seconds. At the final service sample:

```text
manga-opportunity-board.service=enabled / active / running / NRestarts=0
manga-dual-watcher.service=enabled / active / running / NRestarts=0
manga-generic-watcher.service=inactive
manga-chan-watcher.service=inactive
board memory current=about 334 MiB / peak about 448.5 MiB
watcher memory current=about 274 MiB / peak about 290.9 MiB
board cgroup max=0 / oom=0 / oom_kill=0
watcher cgroup max=0 / oom=0 / oom_kill=0
```

The board's `memory.high` counter advanced during catalog work, but no cgroup maximum or OOM event occurred. The active
release symlink resolved exactly to `d7f15d3f8c60aa77e8c560adfdda0c5970d23be7`.

A final signer-free canonical runtime verification returned:

```text
chainId=4663
wallet=0x77f771E83f118C32547A1291dda438a757B4b91B
walletEth=0.00262778655474
nonceLatest=15
noncePending=15
executorUsdg=35.344393
executorWeth=0.0032
executor bytecode/source hashes=matched
authorization=ARMED / UNTIL_REVOKED
unresolvedMutation=null
board signerLoaded=false
board executionAuthorized=false
```

The watcher state independently reported zero startup retries on the accepted restart, zero board or execution-RPC
errors, zero exact preflights, zero signed attempts, zero confirmed executions and zero failed Gas. There was no receipt
or post-state delta to reconcile.

## Economic state and remaining limits

Dual-v3 has no confirmed execution, so its realized profit remains exactly zero. The generic executor's ten historical
receipts remain separate: `13.303487 USDG` gross, `3.839925 USDG` marked Gas and `9.463562 USDG` marked execution net;
after `2.322841 USDG` of separately marked one-time generic deployment Gas, the combined historical marked result is
`+7.140721 USDG`, excluding seed-conversion impact.

USDG executions retain and compound USDG in the USDG executor. WETH executions retain and compound WETH in the WETH
executor. Native ETH remains a finite Gas balance and is not replenished by either compounding lane.

The official public RPC remains an explicitly accepted degraded fallback because the paid provider is paused. The board
can still suffer throttling, latency, malformed batches and temporary individual-request fallback; there is no paid
independent receipt reader or ambiguous-broadcast redundancy. The Gas balance has only finite headroom above the
authorization's `0.002 ETH` reserve. Live positive-checkpoint latency, live startup-retry recovery, sequencer ordering,
race-win rate and future opportunity frequency remain unproven.
