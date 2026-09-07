# ADR 0009: orthogonal source provenance for the multi-platform dashboard

- Status: Accepted and implemented in v0.6.0; production promotion is pending
- Date: 2026-09-07

## Context

The current opportunity board was built around PAIR discovery. Its catalog uses `catalogSources: ['PAIR_API']`, its
runtime exposes one aggregated `source.discovery` string, and the UI renders that aggregate in a footer. Those fields
answer where the scanner learned about a row. They do not prove who launched the token, which protocol created it,
where its liquidity trades, or where a price was calculated.

That distinction was lost when NINECAT was described as a PAIR token. The chain evidence says otherwise: NINECAT was
created through the verified `LongLauncher`, using Doppler and a Uniswap v4 NINECAT/AI pool. Even that evidence proves a
LONG launch route, not which website or client the creator clicked. The correction is recorded in
[`2026-09-07-ninecat-source-attribution-correction.md`](../evidence/2026-09-07-ninecat-source-attribution-correction.md).

An overloaded `source` label is therefore a data-integrity defect, not only a wording issue. It can make a discovery
feed look like an issuer, a shared factory look like a front-end, and a quote provider look like an execution receipt.

## Decision

### Keep every provenance dimension independent

The normalized model must carry these claims separately. No field may be inferred from another field.

| Dimension             | Question answered                                       | Example for NINECAT                        |
| --------------------- | ------------------------------------------------------- | ------------------------------------------ |
| `discovery`           | How did this system first learn about the item?         | user reference transaction + chain replay  |
| `listing`             | Which catalog or API currently lists it?                | independently observed; never launch proof |
| `platformAttribution` | Which platform-specific on-chain route was used?        | `LONG_ROUTE`, chain-attested               |
| `launchFrontend`      | Which website, bot or client did the creator operate?   | `UNKNOWN`                                  |
| `launchProtocol`      | Which shared creation protocol/factory was used?        | Doppler Airlock                            |
| `liquidityVenue`      | Which AMM and pool hold the relevant liquidity?         | Uniswap v4, NINECAT/AI                     |
| `assetClassification` | Is each leg a stock token, stablecoin or custom token?  | NINECAT and AI are not canonical RH stocks |
| `quoteEvidence`       | Who returned each amount and at which block?            | V4/V3 Quoter via a named RPC transport     |
| `calculationEvidence` | Which code/config produced the opportunity result?      | local engine release and route revision    |
| `executionEvidence`   | Was anything signed, included and economically settled? | independent receipt/effect fields          |

### Apply an evidence ladder to platform attribution

`platformAttribution.status` is one of:

- `CHAIN_ATTESTED`: a transaction used a registry-approved platform-specific entry contract or uniquely identifying
  event;
- `FIRST_PARTY_ATTESTED`: a first-party, address-bound platform response was observed, but no unique chain route is
  available;
- `CORROBORATED`: both chain and first-party evidence agree;
- `UNKNOWN`: no allowed proof exists;
- `CONFLICTED`: credible evidence disagrees.

A discovery API, token symbol, URL slug, shared implementation, shared Airlock, shared pool manager, or UI badge alone
cannot set `platformAttribution`. A shared factory may establish `launchProtocol` while leaving the platform `UNKNOWN`.
The creator's exact browser, bot or third-party client remains `launchFrontend: UNKNOWN` unless independently attested.

### Treat PAIR as one adapter, not the system namespace

The ingestion boundary will be adapter-based:

1. `PAIRCatalogAdapter` supplies PAIR listing and metadata observations.
2. `LongLauncherAdapter` recognizes the LONG entry contract and its launch events.
3. `DopplerAdapter` identifies shared protocol/factory evidence without inventing a front-end.
4. `PoolManagerAdapter` supplies generic Uniswap v4 pool and swap facts.
5. `RobinhoodAssetRegistryAdapter` is the only authority for canonical Robinhood stock-token classification.
6. `QuoteAdapter` and `ExecutionLedgerAdapter` supply quote and execution evidence on separate planes.
7. Later Bankr, Pons, Flap and other platforms receive independent adapters and contract registries. Until then they
   appear as `UNATTRIBUTED_CHAIN`, not as PAIR.

Each adapter emits evidence envelopes. The attribution service applies deterministic rules; adapters never overwrite
one another's claim dimensions.

### Adopt the accepted dashboard direction

- Use separate **Radar** and **Ops** workspaces. Ops remains read-only in the first implementation.
- Build a private full-evidence console first. A future public projection must be separately sanitized and is disabled
  by default.
- Use React + Vite for the client and retain a Node read-only BFF boundary. The implementation is present in v0.6.0;
  production deployment remains a separately evidenced state.
- Materialize current query state in SQLite and retain an append-only JSONL evidence ledger. Migration from the current
  atomic JSON snapshot must be staged and reversible.
- Keep provider interfaces replaceable, but run the observation plane on the public Robinhood RPC until a separate
  managed-RPC budget and credential decision is approved. Public RPC is not permitted to sign or prove production-grade
  availability.
- Do not add deploy, sign, execute, arm or withdraw controls to dashboard phase 1.

The page architecture, field contract and story-level acceptance criteria are specified in
[`source-aware-dashboard.md`](../frontend/source-aware-dashboard.md),
[`source-provenance-contract.md`](../frontend/source-provenance-contract.md), and
[`source-aware-dashboard.md`](../stories/source-aware-dashboard.md).

## Consequences

- A row may say `listed by PAIR` and `launch route UNKNOWN`; it may never silently become `PAIR-issued`.
- NINECAT displays `LONG route`, `Doppler`, `Uniswap v4` and `NINECAT/AI` as distinct facts.
- Cross-platform coverage is measurable per adapter and time range. A PAIR-complete catalog is not described as a
  chain-complete catalog.
- Existing `catalogSources`, `apiCanonicalClaim` and footer-only source copy remain legacy discovery semantics. The
  schema-v4 projection is additive; removing those fields requires a later breaking release.
- This ADR changes no signer, service, RPC credential, production database, contract or wallet state.
