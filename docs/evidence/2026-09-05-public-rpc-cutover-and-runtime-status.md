# Public RPC cutover and runtime status — 2026-09-05

## Evidence boundary

This record separates the live read-only opportunity board from every signing or execution claim. The board is live on
the SWAS host and uses the official Robinhood Chain public HTTP RPC. The fixed-route watcher is disarmed and disabled.
The generic-v2 executor is not deployed, so there is no generic-v2 signature, broadcast, canonical receipt or realized
profit.

No wallet funds moved during this cutover.

## Deployed revision and quality gate

- Generic-v2 was merged by [PR 21](https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/pull/21) and released as
  `v0.3.0`.
- Public-RPC cycle pacing was merged by
  [PR 22](https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/pull/22) at commit
  `e0d30b05f03982507d791f375833ac8c970837af`.
- The live release symlink resolves to the immutable release for that exact commit.
- The repository and the Linux release both passed `npm run check`: formatting, JavaScript/Solidity/shell lint,
  systemd verification, type checking, compilation, `37/37` unit tests, both deterministic contract suites and the
  secret scan. The merge CI run is
  [33930589611](https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/actions/runs/33930589611).

## Active runtime configuration

The opportunity board runtime readback showed:

- RPC host: `rpc.mainnet.chain.robinhood.com`;
- provider label: `robinhood-official-public`;
- start-to-start scan interval: `120000 ms`;
- minimum pause after a completed cycle: `60000 ms`;
- quote, catalog and amount-grid concurrency: `1`, `2` and `1`;
- cheap probes: `5,10 USDG`;
- bounded full grid: `5,7.5,10,12.5,15,25,50,75,100 USDG`;
- full-grid refresh: `300000 ms`.

At `2026-09-04T23:54:02.727Z` (`2026-09-05 07:54:02` Asia/Shanghai), the live snapshot reported:

- health `RUNNING`, cycle `1676`, zero consecutive errors and no loaded signer;
- complete catalog observation: `1889/1889` tokens;
- `496` multi-pool candidates in the retained catalog;
- `22` fresh quotes at that instant: `15` unquotable, `7` gross-positive but net-negative and `0` screened-net-positive;
- selection `NO_SCREENED_NET_POSITIVE`, with execution explicitly unauthorized.

The best fresh candidate in that snapshot was `MSFT -> CHIP -> MU` at `10 USDG`: quoted gross profit
`0.473344 USDG`, gas proxy `0.690845 USDG`, screened net `-0.217501 USDG`. It was therefore rejected.

The public endpoint is rate-limited. Only `22/496` retained candidates were fresh at this instant, so this snapshot is
not evidence that all 496 routes were checked simultaneously. A separate read-only generic deployment preflight at
`2026-09-04T23:55Z` was rejected by the endpoint with HTTP `429 Too Many Requests`. Public-only operation reduces paid
RPC use but also reduces freshness and cannot currently support observation plus exact preflight concurrently with
production-grade reliability.

## Capital and amount ceiling

The generic contract enforces a hard maximum of `100 USDG` per transaction. `25 USDG` is one search-grid point, not a
protocol or strategy ceiling. The actual selected amount is the amount with the greatest positive absolute net USDG
after route fees, price impact and gas; shallow liquidity can make the optimum much smaller than the contract maximum.

A public-RPC balance read at `2026-09-04T23:55:16.957Z`, block `54672703`, showed:

- operator wallet: `0.012941695604316 ETH`, `0 USDG`, nonce `3/3`;
- fixed MANGA executor: `10.045402 USDG`;
- fixed SPX executor: `5.631216 USDG`;
- combined capital isolated in the two fixed executors: `15.676618 USDG`.

The operator wallet therefore does not contain only `0.001 ETH`. However, deployment gas and the protected `0.002 ETH`
reserve must be subtracted before converting a seed into USDG. Earlier successful read-only preflights demonstrated the
dynamic range:

- with low gas, a `0.0095 ETH` seed quoted `23.313906 USDG` with a `23.080766 USDG` minimum;
- with gas at `1.335594 gwei`, a `0.006 ETH` seed quoted `14.732920 USDG` with a `14.585590 USDG` minimum, while a
  `0.007 ETH` seed failed the wallet gas-and-reserve check.

Because the latest exact preflight hit the public RPC rate limit, the current deployable seed is `UNKNOWN`, not inferred
from a stale gas observation. More than 25 USDG can be made available only by adding capital or explicitly withdrawing
and transferring the `15.676618 USDG` held by the old executors; either path requires separate reviewed on-chain
transactions and gas.

## Service state

- `manga-opportunity-board.service`: active and enabled; read-only, no signer, public RPC.
- `manga-chan-watcher.service`: inactive and disabled.
- Fixed watcher authorization: `DISARMED` at `2026-09-04T23:50:52.403Z`.
- Generic-v2 deployment: absent.
- Generic-v2 live executions: zero.

The fixed SPX executor has one historical canonical execution, documented separately. Its execution-only net was
positive, but its deployment-plus-trade lifecycle remained negative. It is not evidence that the current generic system
is earning.

## Commands used for verification

```bash
npm run check
systemctl is-active manga-opportunity-board.service
systemctl is-enabled manga-opportunity-board.service
systemctl is-active manga-chan-watcher.service
systemctl is-enabled manga-chan-watcher.service
curl http://127.0.0.1:8788/healthz
curl http://127.0.0.1:8788/api/snapshot
```

## Open items

1. Public RPC freshness and `429` behavior remain an execution-readiness blocker.
2. Generic-v2 still needs a reviewed mainnet deployment, canonical receipt and post-state verification.
3. Moving USDG from either fixed executor requires a separate capital-migration decision; it was not part of this
   cutover.
4. No transaction should be sent while the board has zero screened-net-positive candidates.
