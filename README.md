# Bounded Generic PAIR Atomic Arbitrage + Opportunity Board

> The `live/spx-aapl-nvda-canary` branch is the protected production line for the
> isolated fixed-route canary and the separately bounded generic-v2 lane. The two
> generations retain separate contracts and state; only one may own the wallet's
> signing lane at a time.

The repository now has two deliberately separate execution generations:

- the deployed fixed-route canaries, including `USDG -> AAPL -> SPX -> NVDA -> USDG`; and
- generic-v2, a typed bounded executor for any admitted PAIR token with two quote pools, whether the quote assets are stocks, AI tokens or memes.

The generic economic unit is:

```text
USDG -> quote A (V3 direct or one WETH bridge) -> target (PAIR V4)
     -> quote B (PAIR V4) -> USDG (V3 direct or one WETH bridge)
```

The edge is stale relative pricing across the two MANGA quote pools and their USDG conversion pools. It does not depend on MSFT or NVDA being stock tokens; the same mechanism can exist when the quote assets are AI or meme tokens.

This repository also contains a separate read-only opportunity board. It continuously discovers PAIR multi-pool tokens,
quotes the best observed `USDG -> quote A -> token -> quote B -> USDG` loop at one fixed block, subtracts a gas proxy and
adds material changes to an append-only event ledger. The board has no wallet, signer or broadcast path.

## Honest status

- Fixed-route contracts remain deployed and funded with small canary floats, but their autonomous signing service is
  disabled while generic-v2 owns the wallet lane. Their public evidence is under [`deployments`](deployments).
- Generic-v2 is deployed on Robinhood Chain mainnet at
  `0x3f3A60A2da9E8D9811F41c6093280D7a90685aDD` from release
  `a21b782c9a2fec3522f7a7a8f73a10c7df236e43`. The deployment receipt and identity are recorded in
  [`deployments/generic-v2-mainnet.json`](deployments/generic-v2-mainnet.json).
- The bounded server watcher is active. Its first autonomous execution, `AAPL -> ASS -> SPCX`, was canonically
  confirmed with `0.176846 USDG` marked net execution profit after Gas. This is one observation, not evidence of an
  opportunity frequency or win probability.
- The one-time deployment Gas was marked at `2.322841 USDG`; deployment plus the first execution therefore remains
  `-2.145995 USDG`, excluding seed conversion impact. The execution was profitable, but the live lifecycle has not yet
  recovered deployment cost.
- Historical fixed-route receipt evidence is documented separately. A test, screen, running process or fork transaction is never presented as a new mainnet profit.
- The old macOS polling watcher and the fixed-route cloud signer are stopped. Generic-v2 is explicitly armed on the
  server and consumes the loopback board while idle.
- No private key, provider credential, signed raw transaction, runtime state, or log belongs in Git.

See [`docs/evidence/2026-09-05-generic-v2-live-promotion.md`](docs/evidence/2026-09-05-generic-v2-live-promotion.md)
for the receipt, post-state, bounded authorization, service and economic evidence.

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
- Automated execution requires an explicit deployment-bound arm. The arm expires and separately caps principal, exact preflights, signed attempts, confirmed executions and failed Gas.
- While idle, the generic watcher reads only the local signer-free board. A strategy-owned RPC is touched only after one new candidate clears the board gate; that exact candidate is then simulated twice before signing.
- No wallet token approvals, Universal Router, or Permit2.
- Every mutation follows `intent -> immutable plan -> exact raw persisted -> broadcast -> receipt/effect`.
- A receipt or nonce ambiguity becomes `UNKNOWN`; no new nonce is permitted until `reconcile` converges.
- Direct one-hop V3 legs bypass the router to reduce gas; two-hop anchors retain the canonical router.

The fixed executors retain their original 15 USDG policy. Generic-v2 does not silently change or replace a deployed contract.

See [`docs/spec.md`](docs/spec.md) for the Race Thesis, Shot Policy, state model and acceptance boundaries.

## Local quality gate

Node.js 22 or newer is required.

```bash
npm ci --no-audit --no-fund
npm run check
```

`npm run check` executes formatting, JavaScript/Solidity lint, checked-JS type analysis, Solidity compilation, unit tests, deterministic Cancun EVM contract tests, and a repository secret/privacy scan.

The deterministic contract test asserts the exact business result, intermediate-token residuals, operator boundary, amount cap, profit floor, expiry and callback authorization. It does not require a live RPC or signer.

## Runtime configuration

Copy `.env.example` to a protected strategy-owned configuration outside this repository. Live commands refuse to sign through the public fallback RPC. The signer can be either:

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
npm run generic:watch:arm  # explicit expiring, deployment-bound authorization
npm run generic:watch      # autonomous loopback-board watcher
npm run generic:watch:status
npm run generic:watch:disarm
```

No command automatically deploys and trades in one step. Deployment remains a separate one-shot mutation. The generic watcher can sign only while an explicit arm is active and inside all arm and exact-net boundaries; stopping, expiry, budget exhaustion, UNKNOWN receipt, nonce conflict or an invariant failure closes the lane.

## Live opportunity board

The board's evidence ladder is intentionally narrower than the executor's:

```text
PAIR metadata -> fixed-block four-leg Quoter screen -> gas proxy
              -> bounded typed candidate set
              -> new-generation and arm gate (no chain RPC while idle)
              -> targeted generic preflight: exact eth_call + estimateGas
              -> authorization recheck -> signature -> canonical receipt/effect
```

Rows can be `DISCOVERED_UNQUOTED`, `UNQUOTABLE`, `NO_EDGE`, `GROSS_POSITIVE_NET_NEGATIVE`,
`SCREENED_NET_POSITIVE` or `STALE`. A screened-positive row is still a research candidate, not a risk-free or executable
trade. Only the exact generic preflight can promote a bounded candidate to `GENERIC_READY_TO_EXECUTE`, and even that is
not a receipt or guaranteed inclusion. Manual execution and the autonomous watcher share the same exact preflight,
immutable plan, raw-before-broadcast journal and UNKNOWN barrier. The first adapter covers PAIR's first-party multi-pool
catalog; arbitrary external V4 pools are not claimed as a complete census.

Use a dedicated protected configuration based on [`deploy/opportunity-board.env.example`](deploy/opportunity-board.env.example).
The supported service binds to `127.0.0.1:8788`; open it privately with:

```bash
ssh -N -L 18788:127.0.0.1:8788 root@YOUR_SERVER
```

Then visit `http://127.0.0.1:18788/`. See [ADR 0004](docs/decisions/0004-isolated-read-only-opportunity-board.md)
for the isolation boundary.

## Deployment

The supported production shape is a small Linux host. The signer-free board may use the official public HTTP RPC. The
fixed-route watcher still needs a managed HTTP/WSS pair; the generic watcher needs only a strategy-owned HTTP execution
RPC because it consumes the local board while idle. A full node is intentionally out of scope. The release workflow
creates a commit-addressed artifact; deployment and arm promotion to a signing host remain explicit operations using
the systemd materials in [`deploy/systemd`](deploy/systemd).

Follow [`docs/operations.md`](docs/operations.md). In particular, never run the macOS and cloud signer lanes at the same time.

## License and disclosure

MIT. Publishing the exact route lowers the work required for competitors to copy it; the contract and addresses are already observable on-chain, but this repository makes the operating method easier to reproduce.
