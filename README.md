# Bounded Generic PAIR Atomic Arbitrage + Opportunity Board

> The `live/spx-aapl-nvda-canary` branch is the protected production line for the
> isolated fixed-route canary and the separately bounded generic-v2 lane. The two
> generations retain separate contracts and state; only one may own the wallet's
> signing lane at a time.

The repository has two deployed execution generations and one production-pending successor:

- the deployed fixed-route canaries, including `USDG -> AAPL -> SPX -> NVDA -> USDG`; and
- generic-v2, a typed bounded USDG executor for any admitted PAIR token with two quote pools, whether the quote assets
  are stocks, AI tokens or memes; and
- dual-v3, which retains generic-v2 and adds a separately bounded WETH-principal executor behind one shared signer and
  nonce lane. Dual-v3 is implemented locally but is not described as deployed or live until production evidence exists.

The generic economic unit is:

```text
USDG -> quote A (V3 direct or one WETH bridge) -> target (PAIR V4)
     -> quote B (PAIR V4) -> USDG (V3 direct or one WETH bridge)
```

The edge is stale relative pricing across the two MANGA quote pools and their USDG conversion pools. It does not depend on MSFT or NVDA being stock tokens; the same mechanism can exist when the quote assets are AI or meme tokens.

Dual-v3 also evaluates the symmetric WETH economic unit:

```text
WETH -> quote A (V3 direct or one USDG bridge) -> target (PAIR V4)
     -> quote B (PAIR V4) -> WETH (V3 direct or one USDG bridge)
```

Both lanes are screened at one fixed block and exact-simulated at one current block. WETH net profit is converted to a
conservative USDG comparison value only to choose a winner; the transaction and retained profit remain in WETH.

This repository also contains a separate read-only opportunity board. It combines independent PAIR-listing,
LongLauncher, Doppler, PoolManager and Robinhood-asset adapters, quotes the best observed
`USDG -> quote A -> token -> quote B -> USDG` loop at one fixed block, subtracts a gas proxy and records continuous
economic opportunity episodes. Pool events wake affected candidates between slower coverage sweeps. The board has no
wallet, signer or broadcast path.

`PAIR API` in that sentence is a discovery boundary, not an issuer label. The accepted multi-platform dashboard design
keeps discovery, listing, platform route, launch protocol, liquidity venue, asset class, quote and execution provenance
independent. See [ADR 0009](docs/decisions/0009-orthogonal-source-provenance.md) and the
[source-aware dashboard architecture](docs/frontend/source-aware-dashboard.md). NINECAT's corrected chain attribution
is [documented separately](docs/evidence/2026-09-07-ninecat-source-attribution-correction.md) and is not PAIR.

## Honest status

- Dual-v3/WETH is currently code and deterministic-test evidence only in this checkout. No WETH executor address,
  deployment receipt, production arm, systemd runtime, live transaction, or WETH profit is claimed yet. The existing
  generic-v2 service remains the production signer until an explicit evidence-gated cutover. The exact local and
  signer-free public-RPC results are recorded in
  [`docs/evidence/2026-09-08-dual-base-local-validation.md`](docs/evidence/2026-09-08-dual-base-local-validation.md).

- Fixed-route contracts remain deployed and funded with small canary floats, but their autonomous signing service is
  disabled while generic-v2 owns the wallet lane. Their public evidence is under [`deployments`](deployments).
- Generic-v2 is deployed on Robinhood Chain mainnet at
  `0x3f3A60A2da9E8D9811F41c6093280D7a90685aDD` from release
  `a21b782c9a2fec3522f7a7a8f73a10c7df236e43`. The deployment receipt and identity are recorded in
  [`deployments/generic-v2-mainnet.json`](deployments/generic-v2-mainnet.json).
- Eight canonically confirmed autonomous executions have produced `10.980908 USDG` gross profit, `2.985869 USDG`
  marked Gas and `7.995039 USDG` marked net execution profit. After the separately marked `2.322841 USDG` one-time
  deployment Gas, the combined marked result is `+5.672198 USDG`, excluding seed-conversion impact. This small sample
  does not establish an opportunity frequency or race-win probability.
- The server generic watcher is active from release `b8ab13509be6f9c033d51054759162eaff5f34a1` under schema-v3
  authorization `0x7e580b5ff19c2db13f25439c4b9b751a7db29e48e2d050f05e179462a0de0b21`. Its lifetime is
  `UNTIL_REVOKED`, with no seven-day expiry or renewal task. Confirmed retained USDG automatically increases eligible
  principal up to the immutable `100 USDG` contract cap; at the 2026-09-08 recovery readback the eligible principal was
  `33.021814 USDG`, with zero new-arm attempts, zero failed Gas and no unresolved mutation. A
  compact execution projection is published atomically through a dedicated read-only runtime directory, so signer
  liveness no longer depends on the board's occasionally stalled HTTP event loop. A controlled board restart preserved
  the feed and signer process, and a subsequent 38-sample production soak crossed the prior heap-failure window with
  zero post-cutover service restarts or cgroup OOM events.
- The prior signed-attempt lifecycle defect was closed only after two independent readers proved the expired raw
  transaction absent and nonce-unconsumed. That recovery remains historical evidence; it is not counted as a receipt or
  execution.
- Historical fixed-route receipt evidence is documented separately. A test, screen, running process or fork transaction is never presented as a new mainnet profit.
- The old macOS polling watcher and fixed-route cloud signer remain stopped; generic-v2 exclusively owns the live wallet
  lane. The broad opportunity board remains a separate signer-free service.
- No private key, provider credential, signed raw transaction, runtime state, or log belongs in Git.
- The signer-free event board is running release `b8ab13509be6f9c033d51054759162eaff5f34a1`. Its exact source catalog
  is an atomically replaced, SHA-256-committed file written with bounded transient memory; SQLite economic checkpoints
  reference that commitment instead of duplicating the complete catalog on each publication. The board remains under
  its unchanged 448 MiB pressure threshold and 512 MiB hard limit. A quote backlog no longer freezes hot-log polling, although the
  persisted cursor is still catching up to the chain head. The board remains loopback-only and has no signer or
  broadcast path. The live signer is temporarily using Robinhood's official public RPC through an explicit emergency
  opt-in because the configured ChainStack account returned a service-paused billing error. This fallback is
  rate-limited and is not treated as a production-grade provider.
- The bounded source backfill now renders NINECAT as `LONG_ROUTE / DOPPLER / UNISWAP_V4 / NINECAT-AI`, with zero PAIR
  listings for that address. NINECAT is still `UNQUOTED` and `UNPROVEN`; source coverage remains partial and current
  proxy-positive rows are not executable-profit or receipt evidence.

See [`docs/evidence/2026-09-05-generic-v2-live-promotion.md`](docs/evidence/2026-09-05-generic-v2-live-promotion.md)
for the receipt, post-state, bounded authorization, service and economic evidence.
See [`docs/evidence/2026-09-06-signed-attempt-recovery.md`](docs/evidence/2026-09-06-signed-attempt-recovery.md)
for the lifecycle root cause, repaired release, two-reader terminal recovery and then-current restart blockers.
See
[`docs/evidence/2026-09-08-rolling-generic-watcher-production-promotion.md`](docs/evidence/2026-09-08-rolling-generic-watcher-production-promotion.md)
for the schema-v2 rolling-lease merge, Linux gates, controlled re-arm and current runtime/economic readback.
See
[`docs/evidence/2026-09-08-until-revoked-compounding-watcher-production-promotion.md`](docs/evidence/2026-09-08-until-revoked-compounding-watcher-production-promotion.md)
for the schema-v3 no-expiry authority, retained-profit principal policy, loopback-failure correction and production
readback.
See
[`docs/evidence/2026-09-08-persisted-feed-public-rpc-recovery.md`](docs/evidence/2026-09-08-persisted-feed-public-rpc-recovery.md)
for the persisted execution-feed isolation, fail-closed permission correction, explicit public-RPC fallback and final
production recovery readback.
See
[`docs/evidence/2026-09-08-board-restart-resilience-production-promotion.md`](docs/evidence/2026-09-08-board-restart-resilience-production-promotion.md)
for the source-catalog heap-failure root cause, bounded streaming correction, restart-preserved execution feed and
post-restart production soak.
See
[`docs/evidence/2026-09-07-event-shadow-local-validation.md`](docs/evidence/2026-09-07-event-shadow-local-validation.md)
for the signer-free public-RPC optimization trials and final local schema-v3 readback.
See
[`docs/evidence/2026-09-07-event-shadow-production-promotion.md`](docs/evidence/2026-09-07-event-shadow-production-promotion.md)
for the failed v0.5.0 promotion, rollback, public-RPC fallback and accepted v0.5.4 runtime readback.
See
[`docs/evidence/2026-09-07-source-aware-dashboard-local-validation.md`](docs/evidence/2026-09-07-source-aware-dashboard-local-validation.md)
for v0.6.0's deterministic, browser and temporary public-RPC validation; it is not production evidence.
See
[`docs/evidence/2026-09-07-source-aware-dashboard-v0.6.0-canary-rejection.md`](docs/evidence/2026-09-07-source-aware-dashboard-v0.6.0-canary-rejection.md)
for the rejected 256 MiB canary and signer-safe rollback, and
[`docs/evidence/2026-09-07-v0.6.1-production-promotion.md`](docs/evidence/2026-09-07-v0.6.1-production-promotion.md)
for the verified artifact, bounded migration and NINECAT backfill, and
[`docs/evidence/2026-09-07-v0.6.2-hot-cursor-production-promotion.md`](docs/evidence/2026-09-07-v0.6.2-hot-cursor-production-promotion.md)
for the backlog scheduler correction, bounded public-RPC canary and remaining current-head lag.

Atomic settlement removes intermediate-token inventory exposure if the transaction reverts. It does **not** remove failed gas, latency, sequencer ordering, provider, nonce, implementation, or key-custody risk.

## Generic-v2 safety model

- Typed routes only: no operator-supplied call target or arbitrary calldata.
- Canonical PoolManager, V3 factory/router, PAIR hook, V4 fee/tick spacing and V3 fee tiers are fixed in bytecode.
- V3 anchors are identity USDG, one direct pool, or exactly one WETH bridge; no arbitrary intermediary.
- Only the immutable operator can execute or withdraw.
- Maximum principal per transaction: `100 USDG`. This is a ceiling, not a default order size.
- Adaptive probes and a bounded amount grid choose the amount with the greatest absolute screened net profit; the signing preflight then re-ranks up to six typed candidates using exact executor simulation and gas.
- On-chain gross-profit floor: `0.05 USDG`.
- Default off-chain net-profit floor after exact gas: `0.10 USDG`, configurable upward.
- Automated execution requires an explicit deployment-bound arm. Fixed-expiry and rolling-lease modes remain the
  defaults. An opt-in `UNTIL_REVOKED` mode removes only the wall-clock stop and dynamically admits confirmed retained
  USDG up to the immutable 100 USDG contract cap; it does not remove failed-Gas, ETH-reserve, exact-profit, nonce,
  unresolved-mutation or manual-revocation breakers. Count limits may independently be finite or `unlimited`.
- While idle, the generic watcher reads only the local signer-free board. The explicitly configured execution RPC is
  touched only after one new candidate clears the board gate; that exact candidate is then simulated twice before
  signing. Managed RPC remains the default; the official public endpoint requires a separate default-off outage flag.
- No wallet token approvals, Universal Router, or Permit2.
- Every mutation follows `intent -> immutable plan -> exact raw persisted -> broadcast -> receipt/effect`.
- A receipt or nonce ambiguity becomes `UNKNOWN`; no new nonce is permitted until `reconcile` converges.
- Direct one-hop V3 legs bypass the router to reduce gas; two-hop anchors retain the canonical router.

The fixed executors retain their original 15 USDG policy. Generic-v2 does not silently change or replace a deployed contract.

## Dual-v3 additions

- Native ETH can enter the WETH executor only as a deployment seed and is wrapped immediately; runtime profit is WETH,
  while the wallet keeps native ETH for Gas.
- The board's WETH amount grid is derived from the USDG risk grid at the same block, rather than introducing an
  unrelated notional policy.
- One exact-preflight batch evaluates both bases at one block. USDG Gas conversion rounds cost up; WETH profit
  normalization rounds value down. Only the largest normalized exact net can reach signing.
- The selected contract independently enforces a base-local profit floor that covers worst-case Gas plus the common
  USDG minimum net value. A comparison mark never becomes an arbitrary on-chain price oracle.
- Unlimited time and count settings do not mean unconditional transactions: failed Gas, wallet ETH reserve, exact net,
  immutable principal cap, confirmed-balance compounding, nonce, deadline, revocation, code identity and UNKNOWN remain
  blockers.
- The USDG and WETH contracts keep separate principal and accounting ledgers but use exactly one signer process, wallet
  lock and nonce baseline.

See [ADR 0019](docs/decisions/0019-dual-usdg-weth-principal-execution.md) and the
[dual-base stories](docs/stories/dual-base-execution.md).

See [`docs/spec.md`](docs/spec.md) for the Race Thesis, Shot Policy, state model and acceptance boundaries.

## Local quality gate

Node.js 22 or newer is required.

```bash
npm ci --no-audit --no-fund
npm run check
```

`npm run check` executes formatting, JavaScript/Solidity/shell lint, Linux systemd verification where available,
checked-JS type analysis, the Vite production build, Solidity compilation, unit tests, deterministic Cancun EVM
contract tests, and a repository secret/privacy scan.

The deterministic contract test asserts the exact business result, intermediate-token residuals, operator boundary, amount cap, profit floor, expiry and callback authorization. It does not require a live RPC or signer.

## Runtime configuration

Copy `.env.example` to a protected strategy-owned configuration outside this repository. Live commands refuse to sign
through the public fallback RPC unless the explicit emergency flag is enabled. The signer can be either:

- macOS Keychain via `MANGA_KEYCHAIN_SERVICE`; or
- a host-bound encrypted systemd credential exposed through `MANGA_PRIVATE_KEY_FILE` on Linux.

Never put the private key value in an environment file, shell argument, GitHub secret used by CI, or this repository.

Important commands:

```bash
npm run status             # read-only; public fallback is allowed
npm run runtime:verify     # HTTP/WSS/code/nonce/manifest readback
npm run preflight          # read-only economic decision
npm run execute            # one guarded mutation
npm run reconcile          # read-only convergence of UNKNOWN
npm run reconcile -- --rebroadcast-same-raw  # reuses the exact persisted raw only
npm run watch:arm          # explicit bounded authorization
npm run watch              # targeted WSS watcher
npm run watch:status
npm run watch:disarm
npm run withdraw
npm run board:once         # one read-only catalog + quote batch
npm run board              # continuous scanner and loopback dashboard
npm run board:status       # persisted read-only snapshot
npm run generic:plan       # typed top candidate set; board evidence only
npm run generic:status     # local generic state and current board candidate
npm run generic:runtime-verify  # canonical deployment + loopback-board readback
npm run generic:deploy-preflight  # read-only deployment economics
npm run generic:preflight  # exact executor eth_call + estimateGas; read-only
npm run generic:deploy     # one guarded deployment mutation
npm run generic:execute    # one guarded, dynamically selected mutation
npm run generic:reconcile  # converge an UNKNOWN generic mutation
npm run generic:withdraw   # return all executor USDG to the operator
npm run generic:watch:arm  # explicit deployment-bound authorization
npm run generic:watch      # autonomous loopback-board watcher
npm run generic:watch:status
npm run generic:watch:disarm
npm run dual:status                # local dual ledgers + signer-free board; no chain read
npm run dual:plan                  # canonical quote-block validation; no executor simulation
npm run dual:weth:deploy-preflight # constructor call + gas estimate; no signature
npm run dual:weth:deploy           # separate guarded WETH deployment mutation
npm run dual:runtime-verify        # both deployments + schema-v5 board readback
npm run dual:preflight             # same-block exact USDG/WETH comparison; no signature
npm run dual:execute               # signs only the exact normalized-net winner
npm run dual:reconcile             # converges a dual-v3 UNKNOWN mutation
npm run dual:watch:arm             # explicit until-revoked, unlimited-count authorization
npm run dual:watch                 # one continuous server loop for both bases
npm run dual:watch:status
npm run dual:watch:disarm
npm run dual:weth:withdraw
```

No command automatically deploys and trades in one step. Deployment remains a separate one-shot mutation. The generic
watcher can sign only while an explicit arm is active and inside all arm and exact-net boundaries. A fixed arm expires;
a rolling arm can renew only while still valid; an until-revoked arm has no time stop but remains bound to durable
revocation and every economic/state breaker. Failed-Gas exhaustion, ETH-reserve failure, UNKNOWN receipt, nonce conflict
or an invariant failure closes the lane in every mode.

## Live opportunity board

The board's evidence ladder is intentionally narrower than the executor's:

```text
PAIR metadata + PoolKey check + bounded Initialize-log catalog
              -> fixed-block four-leg Quoter screen + same-block pool attestation -> gas proxy
              -> bounded typed candidate set
              -> new-generation and arm gate (no chain RPC while idle)
              -> targeted generic preflight: exact eth_call + estimateGas
              -> authorization recheck -> signature -> canonical receipt/effect
```

Rows can be `DISCOVERED_UNQUOTED`, `UNQUOTABLE`, `NO_EDGE`, `GROSS_POSITIVE_NET_NEGATIVE`,
`SCREENED_NET_POSITIVE` or `STALE`. A screened-positive row is still a research candidate, not a risk-free or executable
trade. Only the exact generic preflight can promote a bounded candidate to `GENERIC_READY_TO_EXECUTE`, and even that is
not a receipt or guaranteed inclusion. Manual execution and the autonomous watcher share the same exact preflight,
immutable plan, raw-before-broadcast journal and UNKNOWN barrier. Disabled quote assets, null API depth and unsupported
hooks remain shadow-only. Chain discovery reports completeness only from its configured start block; arbitrary earlier
V4 history is not claimed as covered.

The hot path uses bounded public-HTTP `eth_getLogs` ranges for PoolManager and previously quoted V3 pools. Every event
cycle advances at most one configured log range before it consumes the bounded quote backlog, preventing candidate work
from freezing the chain cursor without increasing the four-candidate quote cap. Events only choose what to requote;
they never substitute a local price calculation for the fixed-block Quoter result. Runtime evidence is available at
`/api/event-metrics` and `/api/chain-catalog` through the same loopback-only SSH tunnel.

The private source-aware console and read-only API are served on the same loopback listener. The Radar list uses a
lightweight summary projection and loads full claim evidence only when a row is opened:

```text
GET /api/v1/overview
GET /api/v1/opportunities
GET /api/v1/opportunities/:id
GET /api/v1/sources
GET /api/v1/episodes
GET /api/v1/executions
GET /api/v1/system
```

`POST`, wallet actions and arbitrary RPC proxying are not part of this surface. SQLite is the default bounded current
read model; JSONL retains append-only source facts, economic events, material positive observations and checkpoint
hashes rather than duplicating every negative scan. `MANGA_BOARD_READ_MODEL=legacy` is the non-destructive canary
rollback. NINECAT is rendered as LONG route / Doppler / Uniswap v4 / NINECAT-AI; that attribution is not a current
quote or execution claim.

Use a dedicated protected configuration based on [`deploy/opportunity-board.env.example`](deploy/opportunity-board.env.example).
The supported service binds to `127.0.0.1:8788`; open it privately with:

```bash
ssh -N -L 18788:127.0.0.1:8788 root@YOUR_SERVER
```

Then visit `http://127.0.0.1:18788/`. See [ADR 0004](docs/decisions/0004-isolated-read-only-opportunity-board.md)
for the isolation boundary.

## Deployment

The supported production shape is a small Linux host. The signer-free board may use the official public HTTP RPC. The
fixed-route watcher still needs a managed HTTP/WSS pair; the generic watcher needs one explicitly configured HTTP execution
RPC because it consumes the local board while idle. A full node is intentionally out of scope. The release workflow
creates a commit-addressed artifact; deployment and arm promotion to a signing host remain explicit operations using
the systemd materials in [`deploy/systemd`](deploy/systemd).

Follow [`docs/operations.md`](docs/operations.md). In particular, never run the macOS and cloud signer lanes at the same time.

## License and disclosure

MIT. Publishing the exact route lowers the work required for competitors to copy it; the contract and addresses are already observable on-chain, but this repository makes the operating method easier to reproduce.
