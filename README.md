# Bounded Generic PAIR Atomic Arbitrage + Opportunity Board

> The `live/spx-aapl-nvda-canary` branch is the protected production line for the retained fixed-route canaries,
> generic-v2 USDG executor and active dual-v3 USDG/WETH lane. The generations retain separate contracts and state;
> only dual-v3 currently owns the wallet's signing lane.

The repository retains three deployed execution generations:

- the deployed fixed-route canaries, including `USDG -> AAPL -> SPX -> NVDA -> USDG`; and
- generic-v2, a typed bounded USDG executor for any admitted PAIR token with two quote pools, whether the quote assets
  are stocks, AI tokens or memes; and
- dual-v3, which retains generic-v2 and adds a separately bounded WETH-principal executor behind one shared signer and
  nonce lane. Dual-v3 is the active production signer under an explicit until-revoked authorization.

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

The same loopback service hosts a private business dashboard. Its primary view reports Beijing-day receipt-verified
execution net, failed Gas, authorized USDG/WETH reinvestment, seven-day history, source separation and recent
Blockscout-linked transactions. A separate one-shot reporter can send the previous completed Beijing day to a Feishu
custom bot at 09:05, retrying every five minutes until one durable success receipt exists. Neither path can sign or
broadcast a transaction, and neither turns a quote or process heartbeat into profit evidence. See
[ADR 0024](docs/decisions/0024-sanitized-business-dashboard-and-feishu-reporting.md).

`PAIR API` in that sentence is a discovery boundary, not an issuer label. The accepted multi-platform dashboard design
keeps discovery, listing, platform route, launch protocol, liquidity venue, asset class, quote and execution provenance
independent. See [ADR 0009](docs/decisions/0009-orthogonal-source-provenance.md) and the
[source-aware dashboard architecture](docs/frontend/source-aware-dashboard.md). NINECAT's corrected chain attribution
is [documented separately](docs/evidence/2026-09-07-ninecat-source-attribution-correction.md) and is not PAIR.

## Honest status

- Dual-v3 is active on the production host. Its WETH executor is
  `0xeC6BB0511Eb7a348ad1879535F66320a51a3eDfc`, deployed and seeded with `0.0032 WETH` by
  [`0xee0c…f880`](https://robinhoodchain.blockscout.com/tx/0xee0cee4e11b383ff869be571db44f5fbebbe88c1793daf011f4fcb03ae78f880).
  USDG cycles retain and compound USDG; WETH cycles retain and compound WETH. Native ETH remains in the operator
  wallet for Gas.
- The active authorization is `0x3922c6c44af592bf21a59839c59cdc3f3650d679320f26512130d12fb12fb696`. It is
  `UNTIL_REVOKED`, has unlimited count limits, uses `35.344393 USDG` and `0.0032 WETH` arm-time principal, and caps
  authorized principal at `100 USDG` and `1 WETH`. The common minimum screened and exact net is `0.1 USDG`; the
  cumulative failed-Gas breaker is `0.001 ETH` and the wallet reserve floor is `0.002 ETH`.
- At the latest production readback, dual-v3 had observed current empty signer-free feeds but had zero exact preflights,
  zero signed attempts, zero confirmed executions and zero failed Gas. Therefore dual-era realized profit is `0`, not
  unknown positive profit. Automatic WETH compounding is deployed and armed but remains unexercised until a canonical
  WETH execution receipt exists.

- Fixed-route contracts remain deployed and funded with small canary floats, but their autonomous signing service is
  disabled. Their public evidence is under [`deployments`](deployments).
- Generic-v2 is deployed on Robinhood Chain mainnet at
  `0x3f3A60A2da9E8D9811F41c6093280D7a90685aDD` from release
  `a21b782c9a2fec3522f7a7a8f73a10c7df236e43`. The deployment receipt and identity are recorded in
  [`deployments/generic-v2-mainnet.json`](deployments/generic-v2-mainnet.json).
- Ten canonically confirmed historical generic-v2 executions produced `13.303487 USDG` gross profit, `3.839925 USDG`
  marked Gas and `9.463562 USDG` marked net execution profit. After the separately marked `2.322841 USDG` one-time
  deployment Gas, the combined marked result is `+7.140721 USDG`, excluding seed-conversion impact. Those ten receipts
  predate the dual-v3 authorization baseline and do not establish future opportunity frequency or race-win probability.
- The prior signed-attempt lifecycle defect was closed only after two independent readers proved the expired raw
  transaction absent and nonce-unconsumed. That recovery remains historical evidence; it is not counted as a receipt or
  execution.
- Historical fixed-route receipt evidence is documented separately. A test, screen, running process or fork transaction is never presented as a new mainnet profit.
- The old macOS polling watcher, fixed-route cloud signer and standalone generic-v2 watcher remain stopped; dual-v3
  exclusively owns the live wallet lane. The broad opportunity board remains a separate signer-free service.
- No private key, provider credential, signed raw transaction, runtime state, or log belongs in Git.
- The signer-free board and dual watcher are running release `803caaaaae11a5c8cbef00bcab4aaa23ac2eb919`. The source
  census remains in its streamed catalog and evidence stores, while dashboard control routes build no opportunity
  objects and Radar lists only the current board-admitted set. The board survived repeated production API reads and
  complete catalog streaming under the unchanged 448 MiB pressure threshold and 512 MiB hard limit with zero restarts
  and zero OOM events. It remains loopback-only and has no signer or broadcast path.
- The private business dashboard and isolated Feishu reporter are production-promoted. The reporter delivered the
  completed Beijing day `2026-09-07` with Feishu response code `0`, persisted one success receipt, rejected a duplicate
  same-day send, and is enabled as a five-minute refresh/retry timer with a 09:05 Beijing reporting cutoff. The latest
  browser view keeps historical receipt economics separate from the active dual authorization, whose realized net is
  still `0`.
- A proxy-positive quote now checkpoints the compact execution feed before slower catalog maintenance, preserving the
  30-second signer horizon without weakening the `0.1 USDG` screened/exact floor. Dual startup reads retry transient
  RPC failures five times before loading the private credential. The production restart and subsequent public-RPC
  throttle recovery are verified; the live positive-checkpoint path and live startup-retry branch remain unexercised.
- The board and explicitly opted-in execution fallback currently use Robinhood's official public RPC because the
  configured ChainStack service was paused for billing. Public RPC throttling, latency and ambiguous-broadcast risk
  remain admitted limitations; idle dual-v3 reads only the local feed and touches execution RPC only after a screened
  candidate.
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
[`docs/evidence/2026-09-08-dual-v3-bounded-dashboard-production-promotion.md`](docs/evidence/2026-09-08-dual-v3-bounded-dashboard-production-promotion.md)
for the WETH deployment receipt, dual authorization, dashboard OOM correction, production gates and current
receipt-separated runtime readback.
See
[`docs/evidence/2026-09-08-post-quote-checkpoint-local-validation.md`](docs/evidence/2026-09-08-post-quote-checkpoint-local-validation.md)
for the quote-to-feed latency diagnosis, bounded correction and pre-production test boundary.
See
[`docs/evidence/2026-09-08-dual-startup-rpc-retry-local-validation.md`](docs/evidence/2026-09-08-dual-startup-rpc-retry-local-validation.md)
for the public-RPC startup throttle, safe recovery and bounded retry design.
See
[`docs/evidence/2026-09-08-post-quote-and-startup-reliability-production-promotion.md`](docs/evidence/2026-09-08-post-quote-and-startup-reliability-production-promotion.md)
for both reviewed promotions, Linux gates, controlled production restart, throttle recovery and final chain/runtime
readback.
See
[`docs/evidence/2026-09-08-business-dashboard-feishu-production-promotion.md`](docs/evidence/2026-09-08-business-dashboard-feishu-production-promotion.md)
for the encrypted webhook boundary, response-code-0 delivery, idempotency check, narrow-browser correction and final
production runtime readback.
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
- A newly quoted proxy-positive batch is checkpointed to the compact execution feed before slower catalog maintenance.
  This preserves the strict 30-second signer freshness boundary; it does not bypass the independent `0.1 USDG`
  screened/exact floor or any typed route and receipt gate.
- The dual watcher retries only transient startup-chain reads with bounded backoff and does not load the private
  credential until identity, deployments, balances, nonce and authorization evidence converge.

See [ADR 0019](docs/decisions/0019-dual-usdg-weth-principal-execution.md) and the
[dual-base stories](docs/stories/dual-base-execution.md). The quote-to-feed ordering decision is recorded in
[ADR 0022](docs/decisions/0022-post-quote-execution-feed-checkpoint.md).
Startup transport recovery is recorded in
[ADR 0023](docs/decisions/0023-bounded-dual-startup-rpc-retry.md).

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
npm run business:report:preview  # render the prior Beijing-day report without sending
npm run business:report:status   # read the sanitized business snapshot
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

The private source-aware console and read-only API are served on the same loopback listener. Control-plane endpoints do
not construct an opportunity table. Radar contains only candidates admitted to the current quote board, uses a
semantic summary projection, and loads full claim evidence for one ID only when a row is opened. Historical source-only
discoveries remain in source coverage and the streamed source catalog rather than being mislabeled as opportunities:

```text
GET /api/v1/overview
GET /api/v1/opportunities
GET /api/v1/opportunities/:id
GET /api/v1/sources
GET /api/v1/episodes
GET /api/v1/executions
GET /api/v1/system
GET /api/v1/business
```

The dashboard remains private. Forward the host's loopback port and then open `http://127.0.0.1:18788/`:

```bash
ssh -N -L 18788:127.0.0.1:8788 <production-host>
```

On Linux, enter the Feishu webhook through standard input so it never becomes a shell argument, then enable the timer:

```bash
sudo systemd-creds encrypt --name=manga-feishu-webhook - /etc/credstore.encrypted/manga-feishu-webhook
sudo systemctl enable --now manga-business-report.timer
```

The reporter accepts only the exact `https://open.feishu.cn/open-apis/bot/v2/hook/...` boundary. The encrypted
credential, delivery state and business snapshot stay outside Git.

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
