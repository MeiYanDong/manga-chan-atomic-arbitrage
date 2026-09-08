# Public-RPC event hot-path production promotion — 2026-09-09

## Outcome

Release `0bfa3ac2f32ae36714129c66e746f526b0c78884` is running on the production board and dual-base signer. The board
remains loopback-only, signer-free and bound to Robinhood Chain's official public RPC. The active signer reads only the
local execution feed while idle. After its startup identity readback, it returns to the separately configured managed
strategy RPC only when a candidate clears the proxy screen.

This promotion reduces the event quote topology to one candidate, at most two amounts per enabled base, one V4 pair and
the strongest previously proven V3 route. It gives event reads two logical attempts separated by 200 ms. Periodic
reconciliation keeps broader discovery and retry coverage. Exact execution simulation, the `0.1 USDG` post-Gas net
floor, immutable principal caps, nonce, wallet reserve, failed-Gas breaker, authorization and receipt reconciliation did
not change.

## Why three corrections were required

| Release | Production observation                                                                                                                                                                                 | Decision                                                                            |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| v0.7.6  | First healthy reconciliation fell from 999 to 516 logical Quoter calls, but still took almost eight minutes. The following four-candidate event cycle used 247 calls and took 610,315 ms.              | Keep the cross-cycle caches; split event latency from periodic completeness.        |
| v0.7.7  | Event cycles fell to 44 calls / 53,579 ms and 34 calls / 40,961 ms. A viem-wrapped cooperative preemption was incorrectly shown as `DEGRADED`, although the process did not restart and no signer ran. | Recognize the AsyncLocalStorage preemption flag and reduce the V4 event pair bound. |
| v0.7.8  | A cycle used 17 logical Quoter calls but 13 logical public-RPC retries and still took 54,807 ms; another completed in 45,135 ms and one correctly failed incomplete.                                   | Keep only the strongest proven V3 topology and give event reads one fast retry.     |

None of these rejected canaries signed, broadcast or spent Gas. One v0.7.6 proxy-positive `MU → PC → AMD` candidate
reached exact preflight, but exact evidence was negative. Across the predecessor authorization there were four exact
preflights, zero signatures, zero confirmed executions, zero failed Gas and no unresolved mutation.

## Review and reproducible gates

- PR: [#85](https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/pull/85)
- protected-branch quality job:
  [34282551943 / 102250515589](https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/actions/runs/34282551943/job/102250515589)
- merged release commit: `0bfa3ac2f32ae36714129c66e746f526b0c78884`
- exact `git archive` SHA-256: `f0d08261f91cdb54e76e0604778f0120bb35bca6050721e46153e741509c349c`
- local gate: format, JavaScript/Solidity/shell lint, typecheck, UI build, compilation, 212 unit tests, three
  deterministic contract suites and a 220-file secret scan passed;
- Linux install gate on the hash-matched artifact: `systemd-analyze`, typecheck, UI build, compilation, the same 212
  unit tests, all three contract suites and a 202-file artifact secret scan passed.

The Linux verifier repeated two warnings from Alibaba Cloud's preinstalled `cloudmonitor.service` (`KillMode=none` and a
legacy `/var/run` PID path). They are outside this repository and did not fail the strategy units.

## Board promotion evidence

The production installer changed the release symlink without starting or arming a service. Immediately before the
board restart, two signer readbacks five seconds apart both showed:

- current execution-feed candidate count `0`;
- predecessor authorization usage: four exact preflights, zero signed attempts, zero confirmed executions and zero
  failed Gas;
- `unresolvedMutation=null` and no board or execution-RPC error.

The signer-free board restarted at `2026-09-09 05:54:24 CST`, became loopback-ready at `05:54:47`, loaded the exact
release commit and retained healthy SQLite/evidence parity. Its first periodic quote cooperatively yielded after 20
logical Quoter calls. Subsequent v0.7.9 event snapshots included:

| Event-to-quote latency | Logical Quoter calls | Cumulative event V3 routes | Cumulative fast event retries | Result                                           |
| ---------------------: | -------------------: | -------------------------: | ----------------------------: | ------------------------------------------------ |
|              48,209 ms |                   17 |                          5 |                             0 | complete, outside target                         |
|              33,435 ms |                   17 |                         10 |                             1 | complete, inside 45-second acceptance window     |
|              44,293 ms |                   17 |                         15 |                             1 | complete, inside acceptance window               |
|              52,431 ms |                   17 |                         31 |                             2 | complete, public-endpoint latency outside target |

During the readbacks the board had zero service restarts, no last error, healthy persistence, no additional realtime
cursor fast-forward and head lag between 49 and 82 blocks, below the configured 500-block boundary. Memory remained
below its 512 MiB hard limit. The 33–52 second spread is evidence that the remaining latency is public-provider
variability, not a claim of deterministic execution speed. [Robinhood's connection guidance](https://docs.robinhood.com/chain/connecting/)
documents the public endpoint as rate-limited and recommends a provider for production-grade usage.

## Controlled signer cutover

The old authorization was revoked before stopping its watcher. A no-signature/no-broadcast runtime verification then
proved chain id `4663`, identical latest and pending nonce `15`, canonical executor bytecode, balances of `35.344393
USDG` and `0.0032 WETH`, wallet Gas balance `0.00262778655474 ETH`, a signer-free board and no unresolved mutation.

The new until-revoked authorization is
`0x7039d0e14a6ccecb19f0ee4c75740362ab2a98b1e2eef43259a896bd3035cd62`. Both npm and Node worker processes run from the
exact release directory. The service is enabled and active with zero restarts. Its immutable/current boundaries are:

- current spendable principal: `35.344393 USDG` and `0.0032 WETH`;
- hard caps: `100 USDG` and `1 WETH`;
- screen floor: `0.05 USDG`; independently signed exact-net floor: `0.1 USDG`;
- count limits: unlimited; lifetime: until explicit revocation;
- failed-Gas breaker: `0.001 ETH`; wallet reserve floor: `0.002 ETH`;
- idle RPC behavior: none; idle input is the local signer-free execution feed.

The first live readback showed three processed feed generations, zero screened-positive generations, zero exact
preflights, zero signatures, zero confirmed executions, zero failed Gas, no execution-RPC errors and no unresolved
mutation. The business snapshot refresh succeeded and its systemd timer remained active. This is verified continuous
execution authority, not profit evidence.

A later `06:09 CST` soak readback showed 35 processed feed generations with the same zero economic counters and no
board or execution-RPC errors. Both board and signer still had zero service restarts. The board's latest event cycle used
17 logical Quoter calls in 46,561 ms, head lag was 52 blocks, the realtime cursor fast-forward count remained at its
restart baseline of 12 and persistence remained healthy.

## Economic status and remaining boundary

The active authorization's realized net is `0`. Historical generic-v2 accounting remains separate: ten canonical
receipts produced `13.303487 USDG` gross, `3.839925 USDG` marked Gas and `9.463562 USDG` marked execution net; after
`2.322841 USDG` one-time deployment Gas, the combined marked historical result is `+7.140721 USDG`. Those receipts do
not predict future opportunity frequency.

The official public RPC can still make an otherwise bounded event quote exceed the latency target or return incomplete
fixed-block evidence. The fail-closed response is to skip that event revision and wait for the next event/periodic
reconciliation, not to infer a price, relax the exact-profit floor or spend Gas. Moving broad discovery to a paid RPC
would be a separate cost decision; this release deliberately keeps the user's public-first boundary and reserves the
managed provider for exact execution work.
