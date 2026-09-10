# Executable event-wake priority production promotion — 2026-09-10

## Outcome

Release `90f15741b2814e28c3be58417fd97d3926754f28` is active on the production signer-free board. Event quote capacity now
selects candidates already supported by current execution evidence, then candidates with the deployed executor's exact
PoolKey shape, before unsupported shadow-only candidates. Freshest-first ordering remains inside each tier and protected
periodic reconciliation still covers the broad source graph.

This was a board-only scheduling promotion. The RPC endpoint, public-first cost boundary, request concurrency, signer
authorization, principal caps, exact net-profit floor, nonce ownership, ETH reserve, failed-Gas breaker, broadcast and
receipt reconciliation were not changed. No transaction was created by the deployment.

## Reviewed release and reproducible gates

- PR: [#93](https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/pull/93)
- merged release commit: `90f15741b2814e28c3be58417fd97d3926754f28`
- protected-branch quality job:
  [34451588988 / 102788323117](https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/actions/runs/34451588988/job/102788323117)
- exact GitHub source archive SHA-256: `df8e1e224fcf712310c5802cad0a06cf375d5a12a96140e42bc34a85cae7e094`

The local `npm run check` gate passed formatting, JavaScript/Solidity/shell lint, checked-JS type analysis, dashboard
build, all three Solidity compilations, 224 Node tests, three deterministic contract suites and a 231-file secret scan.
GitHub CI passed the same repository quality gate.

The server downloaded the merged-commit archive independently and matched its SHA-256 before stopping the board. The
release installer then passed 224 Node tests, all three deterministic contract suites and a 214-file artifact secret
scan before moving the `current` symlink. It explicitly reported that it did not arm or start a service.

## Controlled board-only cutover

Immediately before the cutover, local signer state reported:

- existing authorization
  `0x7039d0e14a6ccecb19f0ee4c75740362ab2a98b1e2eef43259a896bd3035cd62`, still `ARMED / UNTIL_REVOKED`;
- current reinvestable principal `35.344393 USDG` and `0.0032 WETH`, with unchanged hard caps of `100 USDG` and
  `1 WETH`;
- two exact preflights, zero signed attempts, zero confirmed executions, zero failed Gas and no unresolved mutation;
- a healthy board whose latest event-to-quote sample was 28,074 ms. This single predecessor sample is context, not a
  latency baseline distribution.

The business-report timer and board were stopped while the installer ran. The signer stayed active on the accepted
v0.8.4 release and rejected absent or stale feed evidence by its existing fail-closed policy. The new v0.8.5 board
started at `15:54:26 CST`, exposed its loopback HTTP boundary at `15:55:25`, and completed its first protected periodic
cycle at `15:57:36`. The timer was restored only after `/healthz` returned `HEALTHY`.

The board main process resolved to the exact v0.8.5 release. Board and signer were both active with zero restarts. The
board reported approximately 395 MB current memory and 470 MB peak; the signer reported approximately 289 MB current
and 302 MB peak. Both cgroups had `max=0`, `oom=0` and `oom_kill=0`. The board had crossed its configured memory-high
throttle, but never its hard limit. Root-disk utilization was 63%.

## Live scheduler evidence

The first post-restart readback selected three `EXECUTOR_SHAPE` candidates and zero `SHADOW_ONLY` candidates. After
fixed-block quotes promoted current pool evidence, a three-minute sample recorded:

| Counter at final sample               | Value |
| ------------------------------------- | ----: |
| already execution-compatible selected |     6 |
| exact executor-shape selected         |     3 |
| unsupported shadow-only selected      |     0 |
| event-triggered candidates quoted     |     9 |
| pending candidates                    |   288 |
| cumulative stale drops since restart  | 1,746 |
| current head lag                      |    60 |
| consecutive event-poller errors       |     0 |

Four distinct completed event-to-quote values were observed: 34,415 ms, 34,925 ms, 40,441 ms and 40,877 ms. Every
sample retained `lastError=null`. The deterministic queue test proves the ordering rule under contention; these live
counters prove the new tier logic is being exercised by production events. They do not prove an enduring latency
improvement because the predecessor had no comparable distribution and the public endpoint remains variable.

## Canonical post-cutover readback

A no-signature/no-broadcast runtime verification against the active release returned chain ID `4663`, wallet nonce
`15/15`, wallet Gas balance `0.00262778655474 ETH`, executor balances of `35.344393 USDG` and `0.0032 WETH`, exact
deployment identity and `unresolvedMutation=null`. The board identified itself as
`READ_ONLY_NO_SIGNING_NO_BROADCAST`, schema v5, `RUNNING`, signer-free and execution-unauthorized.

The original signer process remained alive under the same authorization. Its economic counters stayed at two exact
preflights, zero signed attempts, zero confirmed executions and zero failed Gas. The current board had no positive
execution-feed candidate, so there was no transaction and no new realized profit.

## Honest remaining boundary

This release improves allocation of scarce quote capacity; it does not add capacity. In the short production window,
the queue still accumulated hundreds of pending candidates and 1,746 freshness expirations. Public-RPC event and quote
latency remained approximately 34-41 seconds in completed samples and can still exceed the signer's freshness window.
A production-grade event/quote provider or indexed stream remains a separate recurring-cost decision. The managed
execution RPC continues to be reserved for exact preflight, signing, broadcast and receipt reconciliation.

The ordinary SSH tunnel was also unavailable during this promotion. Packet capture on the server observed no packets
from the current client path even though the client reported a TCP connection followed by a pre-key-exchange close;
sshd was active, below `MaxStartups`, with no Fail2ban, nftables, iptables or host-rule block. Cloud Assistant therefore
provided the auditable deployment channel. Restoring the private dashboard tunnel may require changing the local
VPN/network path or explicitly adding a separately restricted SSH port; no new public port was opened here.
