# MANGA CHAN Atomic Arbitrage + Opportunity Board

A bounded, single-route atomic arbitrage executor for Robinhood Chain:

```text
USDG -> MSFT (Uniswap V3) -> MANGA (Uniswap V4)
     -> NVDA (Uniswap V4) -> USDG (Uniswap V3)
```

The edge is stale relative pricing across the two MANGA quote pools and their USDG conversion pools. It does not depend on MSFT or NVDA being stock tokens; the same mechanism can exist when the quote assets are AI or meme tokens.

This repository also contains a separate read-only opportunity board. It continuously discovers PAIR multi-pool tokens,
quotes the best observed `USDG -> quote A -> token -> quote B -> USDG` loop at one fixed block, subtracts a gas proxy and
adds material changes to an append-only event ledger. The board has no wallet, signer or broadcast path.

## Honest status

- The contract is deployed and funded with a small canary float. Public deployment evidence is in [`deployments/robinhood-mainnet.json`](deployments/robinhood-mainnet.json).
- The current deployment has **zero confirmed arbitrage executions**. A successful test or running process is not presented as live profit.
- The old macOS polling watcher is stopped. This repository's watcher uses targeted WSS swap events plus a recovery poll and must be explicitly armed.
- No private key, provider credential, signed raw transaction, runtime state, or log belongs in Git.

Atomic settlement removes intermediate-token inventory exposure if the transaction reverts. It does **not** remove failed gas, latency, sequencer ordering, provider, nonce, implementation, or key-custody risk.

## Safety model

- Fixed route, targets and pool keys in bytecode.
- Only the immutable operator can execute or withdraw.
- Maximum principal per transaction: `15 USDG`.
- On-chain gross-profit floor: `0.05 USDG`.
- Off-chain net-profit floor after gas: `0.02 USDG`.
- No wallet token approvals, Universal Router, or Permit2.
- Every mutation follows `intent -> immutable plan -> exact raw persisted -> broadcast -> receipt/effect`.
- A receipt or nonce ambiguity becomes `UNKNOWN`; no new nonce is permitted until `reconcile` converges.
- An arm separately limits time, confirmed executions, signed attempts, and failed-gas expenditure.

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
```

No command automatically deploys and trades in one step.

## Live opportunity board

The board's evidence ladder is intentionally narrower than the executor's:

```text
PAIR metadata -> fixed-block four-leg Quoter screen -> gas proxy
              -> no generic execution estimate -> no receipt
```

Rows can be `DISCOVERED_UNQUOTED`, `UNQUOTABLE`, `NO_EDGE`, `GROSS_POSITIVE_NET_NEGATIVE`,
`SCREENED_NET_POSITIVE` or `STALE`. A screened-positive row is a research candidate, not a risk-free or executable
trade. The first adapter covers PAIR's first-party multi-pool catalog; arbitrary external V4 pools are not claimed as a
complete census.

Use a dedicated protected configuration based on [`deploy/opportunity-board.env.example`](deploy/opportunity-board.env.example).
The supported service binds to `127.0.0.1:8788`; open it privately with:

```bash
ssh -N -L 18788:127.0.0.1:8788 root@YOUR_SERVER
```

Then visit `http://127.0.0.1:18788/`. See [ADR 0004](docs/decisions/0004-isolated-read-only-opportunity-board.md)
for the isolation boundary.

## Deployment

The supported production shape is a small Linux host using a managed HTTP RPC and WSS endpoint. A full node is intentionally out of scope. The release workflow creates a commit-addressed artifact; promotion to a signing host is manual and uses the systemd materials in [`deploy/systemd`](deploy/systemd).

Follow [`docs/operations.md`](docs/operations.md). In particular, never run the macOS and cloud signer lanes at the same time.

## License and disclosure

MIT. Publishing the exact route lowers the work required for competitors to copy it; the contract and addresses are already observable on-chain, but this repository makes the operating method easier to reproduce.
