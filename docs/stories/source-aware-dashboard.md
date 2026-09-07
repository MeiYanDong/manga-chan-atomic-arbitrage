# Source-aware dashboard stories

- Plan status: accepted
- Implementation status: SD1–SD6 complete locally in v0.6.0; SD7 production readback pending
- Deployment status: not deployed

Each story is independently reviewable and must preserve the signer-free boundary.

## SD1 — Provenance vocabulary and registry

Acceptance:

- discovery, listing, platform route, creator front-end, launch protocol, liquidity venue, asset class, quote,
  calculation and execution are separate typed fields;
- supported platform contracts live in a versioned registry with chain ID, validity interval and evidence link;
- shared Airlock/factory evidence cannot identify a front-end;
- `UNKNOWN` and `CONFLICTED` are first-class values and fail closed;
- unit tests reject listing-to-platform and symbol-to-stock inference.

## SD2 — NINECAT regression fixture

Acceptance:

- creation transaction `0xd9bd…1a69` resolves to `LONG_ROUTE`, `CHAIN_ATTESTED`;
- the same fixture resolves `launchProtocol = DOPPLER` and `liquidityVenue = UNISWAP_V4`;
- NINECAT/AI is displayed as a custom-token pair, not a stock pair;
- `launchFrontend` remains `UNKNOWN`;
- no PAIR attribution appears even if a future discovery adapter lists the address;
- the reference sale route retains NINECAT/AI and AI/ETH pool evidence without pretending it is a current quote.

## SD3 — Adapter registry and bounded coverage

Acceptance:

- PAIR catalog, LongLauncher, Doppler, PoolManager and Robinhood asset adapters run independently;
- every adapter reports last attempt, last success, lag, configured start, safe head and sanitized error;
- coverage is never promoted across adapters;
- chain backfill says `COMPLETE_FROM_CONFIGURED_START` only after the cursor reaches the safe head;
- unrecognized launch contracts remain `UNATTRIBUTED_CHAIN` and visible.

## SD4 — Query model and evidence ledger

Acceptance:

- SQLite materializes current query state while JSONL retains append-only evidence;
- ingestion is idempotent by chain/event or response identity;
- a restart reconstructs the same projection from evidence;
- migration runs dual-read parity checks against the current atomic JSON snapshot;
- rollback does not delete the new ledger or alter signer state.

## SD5 — Radar workspace

Acceptance:

- Overview and Radar distinguish screened proxy, exact-ready, confirmed and realized-net counts;
- every row shows platform route, proof state, protocol, venue and pair class;
- the detail drawer exposes claim-level evidence and timestamps;
- users can filter `UNKNOWN` and `CONFLICTED` values;
- the NINECAT fixture visually reads LONG route / Doppler / Uniswap v4 / NINECAT-AI, never PAIR;
- desktop, mobile, keyboard and reduced-motion checks pass.

## SD6 — Read-only Ops workspace

Acceptance:

- Ops shows release, service, cursors, public-RPC mode, latency, backoff, quota signals and ledger health;
- execution history separates intent, exact plan, signature, broadcast, receipt, balance effect and gas mark;
- no control can deploy, arm, sign, execute, withdraw or proxy arbitrary RPC;
- sensitive provider URLs, credentials, raw signed transactions and private paths never reach the BFF or browser.

## SD7 — Quality and private canary

Acceptance:

- format, lint, checked-JS types, unit, contract and secret-scan gates remain green;
- provenance invariants and NINECAT are deterministic regression tests;
- CI runs the repository's existing `npm run check` gate before merge;
- the BFF and UI deploy as signer-free services with loopback-only access;
- post-deploy readback records release SHA, schema version, adapter coverage, endpoint health and unchanged signer state;
- public projection remains disabled and paid RPC remains unconfigured.

## Delivery order

`SD1 → SD2 → SD3 → SD4 → SD5 → SD6 → SD7`

SD1 and SD2 establish the semantics before any screen is built. SD3 and SD4 create the evidence-bearing read model.
The two workspaces can then be implemented without embedding attribution logic in presentation components.

## Verification map

| Story | Primary implementation                                     | Deterministic evidence                                                 |
| ----- | ---------------------------------------------------------- | ---------------------------------------------------------------------- |
| SD1–2 | `src/source-provenance.mjs`                                | `test/source-provenance.test.mjs`, `test/fixtures/ninecat-source.json` |
| SD3   | `src/source-adapters.mjs`, `scripts/opportunity-board.mjs` | `test/source-adapters.test.mjs`                                        |
| SD4   | `src/board-store.mjs`                                      | `test/board-store.test.mjs`                                            |
| SD5   | `src/dashboard-projection.mjs`, `ui/`                      | dashboard projection/view-model/static tests and local browser QA      |
| SD6   | read-only BFF routes and System/Execution pages            | isolation tests plus method-rejection tests                            |
| SD7   | CI and private Linux canary                                | pending until GitHub and host readback exist                           |
