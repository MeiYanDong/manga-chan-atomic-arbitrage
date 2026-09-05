# Generic-v2 bounded live promotion — 2026-09-05

## Evidence boundary

This record distinguishes repository checks, deployment receipt, independent receipt readback, runtime state and
realized execution economics. It does not call the strategy risk-free, infer opportunity frequency from one transaction
or treat a process health check as profit. Provider URLs, credentials, private keys, signed raw transactions and private
runtime journals are intentionally excluded.

## Release and merge gate

- Production branch: `live/spx-aapl-nvda-canary`.
- Deployed release: `a21b782c9a2fec3522f7a7a8f73a10c7df236e43`.
- Release archive SHA-256: `430e77a54b7a1b0b58a46acc69e900d7e383fe422332fa50753cc81272199965`.
- [PR 24](https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/pull/24) added the bounded watcher;
  [its CI run](https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/actions/runs/33946127378) passed.
- [PR 25](https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/pull/25) bounded deployment service startup;
  [its CI run](https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/actions/runs/33946436341) passed.
- [PR 26](https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/pull/26) cleared recovered transport errors;
  [its CI run](https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/actions/runs/33946930242) passed.
- The protected production branch requires the strict `quality` check, pull-request history, linear history and resolved
  conversations; force pushes and deletions are disabled.
- `docs/sniper-spec.v2.json` passed the `sniper-engineering` validator with live competitive mode explicitly bounded as
  an expiring race experiment, four correctness invariants, one adaptive gate, one soft check, zero errors and zero
  warnings. Sequencer ordering remains `UNKNOWN` instead of being promoted from one success.
- The release host independently ran `npm run check`: format, JavaScript/Solidity/Shell lint, checked-JS types, compile,
  `45 / 45` unit tests, both deterministic contract suites, secret scan over `81` files and Linux systemd verification
  passed. The systemd verifier also reported unrelated pre-existing Alibaba Cloud Monitor warnings; this release does not
  claim to remediate that external unit.

## Provider and host boundary

- The signer-free board uses Robinhood's official public HTTP RPC.
- Idle generic monitoring reads only `127.0.0.1`; it consumes no strategy RPC request.
- Only a newly eligible board candidate escalates to the dedicated Chainstack execution endpoint for exact simulation,
  Gas estimation, signing-lane checks, broadcast and canonical readback.
- The dedicated Global Robinhood Mainnet node is isolated in the existing strategy project. Endpoint and credential
  values are not repository data.
- Both `manga-opportunity-board.service` and `manga-generic-watcher.service` were read back as enabled, active and
  running with zero restarts. The fixed-route signing service is disabled.

## Canonical deployment

- Operator: `0x77f771E83f118C32547A1291dda438a757B4b91B`.
- Executor: `0x3f3A60A2da9E8D9811F41c6093280D7a90685aDD`.
- Transaction: `0x6d81fc0ecd1fc57d4d90303e90635593aeac07b6fcea11b2f6e569a30e87ada1`.
- Block: `54861614`; receipt status: `1`.
- Gas: `2,329,273` at `407,204,000 wei`, totaling `0.000948489282692 ETH`.
- Seed: `0.009 ETH`; resulting executor float: `22.040906 USDG`; wallet balance after deployment:
  `0.002993206321624 ETH`.
- Runtime bytecode, immutable operator, chain, source hash, creation hash, runtime hash, `100 USDG` contract cap and
  `0.05 USDG` contract gross floor all matched the release manifest.
- An independent read through the official public RPC returned the same successful receipt, block, executor, Gas used
  and effective Gas price.

At the deployment block, an archive read marked `0.004 ETH` as `9.795957 USDG`, or `2448.98925 USDG/ETH`. On that
basis, the one-time deployment Gas was `2.322841 USDG`. This mark is reproducible accounting evidence, not a sale quote.

## Bounded authorization

Authorization `0xeacd1dc1ff3a2afe5be1e36326a377488db1574805f8e5fe00973c2d49181be1` binds the exact
chain, wallet, executor and code hashes and expires at `2026-09-12T05:13:52.489Z`:

- principal ceiling: `22.040906 USDG` for this arm (`100 USDG` remains only the contract ceiling);
- screened and exact marked-net floors: `0.1 USDG`;
- wallet reserve: `0.002 ETH`;
- maximums: `24` exact preflights, `5` signed attempts and `5` confirmed executions;
- cumulative failed-Gas stop: `0.001 ETH`;
- initial wallet nonce: `4`; initial confirmed generic executions: `0`.

Expiry, any budget exhaustion, an UNKNOWN receipt, nonce conflict, post-state mismatch or invariant failure closes the
lane. Continuing after expiry requires a new explicit deployment-bound authorization.

## First autonomous mainnet execution

The board published one eligible typed candidate at `2026-09-05T05:25:07.387Z`. Exact preflight began at
`05:25:07.433Z` and selected `AAPL -> ASS -> SPCX`:

- board input/screen: `10 USDG`, `0.143239 USDG` screened net;
- exact block: `54869049`;
- exact output/gross: `10.533082 / 0.533082 USDG`;
- exact Gas estimate: `357,274`; expected marked Gas: `0.355127 USDG`;
- expected marked net: `0.177955 USDG`;
- protected gross floor: `0.506427 USDG`; Gas limit: `398,002`.

The immutable plan was recorded at `05:25:11.763Z`, signed at `05:25:11.773Z`, accepted by the provider at
`05:25:12.080Z` and canonically observed at `05:25:16.323Z`:

- transaction: `0xbfb24e9cb990f39ae952e2214a62cf1c0c304118f2483923828028237cbe6caa`;
- block/hash: `54869057` / `0xf5d602e5c201aa2bb265a5142423ced5335c432e97f1bb06cd4920eed9349453`;
- receipt status: `1`; Gas used: `349,404`; effective Gas price: `416,280,000 wei`;
- Gas spent: `0.00014544989712 ETH`, marked as `0.356236 USDG`;
- realized gross: `0.533082 USDG`; realized marked net: **`0.176846 USDG`**;
- executor balance: `22.040906 -> 22.573988 USDG`;
- wallet nonce: `4 -> 5`; no unresolved mutation remained.

An independent official-public-RPC receipt returned the same successful transaction, block identity, Gas values and
logs. Exact-preflight start to canonical observation was about `8.890 s`; board publication to canonical observation was
about `8.936 s`. These are observer timings for one sample, not sequencer-arrival proof or a p95.

## Current economics and remaining unknowns

The first transaction itself is canonically net-positive after marked Gas. The live lifecycle is not yet profitable:

```text
0.176846 first execution marked net
- 2.322841 one-time deployment Gas mark
= -2.145995 USDG lifecycle net before seed conversion impact
```

After the first execution, authorization usage was `1 / 5` confirmations, `1 / 5` signatures, `1 / 24` exact
preflights and `0 / 0.001 ETH` failed Gas. A later healthy board snapshot covered a complete `1,906 / 1,906` PAIR
catalog, admitted `496` multi-pool candidates and had no current screened-positive row; only `23` candidates were fresh
in that bounded cycle, so it is not a simultaneous exact census.

Still open:

- one successful shot cannot estimate opportunities per minute/hour, race win probability or break-even time;
- canonical sequencer ordering and arrival position remain unknown;
- external paging is not configured; systemd failure handling remains local;
- the current adapter covers PAIR's first-party multi-pool catalog and reviewed V3 anchors, not every external DEX pool;
- old fixed-route executors still hold their separate floats; no capital migration is claimed;
- the withdrawal code is tested but has not been invoked for this executor.
