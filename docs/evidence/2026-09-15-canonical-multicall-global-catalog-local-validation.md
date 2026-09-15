# Canonical Multicall Global catalog local validation — 2026-09-15

Evidence state: implementation, complete local repository gate and live read-only official-public probe passed; GitHub
CI, immutable release and production promotion pending.

## Production trigger

- v0.17.7 restored all 32 current Earn pools but published only five V2 pools and zero V3 pools.
- Typed production evidence classified 117 V2 failures and all 716 V3 query failures as public-RPC throttling.
- The signer remained inactive. These observations prove incomplete discovery, not absence of market liquidity or a
  missed profitable transaction.

## Implemented boundary

- V2/V3 factory and pool-state reads now use code-hash-verified canonical Multicall3 aggregates at one fixed block.
- Aggregates are sequential and contain at most 12 subcalls. Schema v4 validates their code identity and feasible
  request/subcall counts before the cache is usable.
- The signer-free catalog still uses only the official public endpoint. Retention remains exact-query, typed and capped
  at six hours.
- Catalog provider failures now persist only a typed label; URL, request body, calldata and raw diagnostics are absent.
- No execution, signing, capital, Gas, profit or receipt policy changed.

## Focused verification

```bash
npm run typecheck
npm run lint:js
node --test --test-reporter=spec \
  test/earnonhood-graph.test.mjs \
  test/global-liquidity-graph.test.mjs \
  test/public-first-rpc.test.mjs \
  test/resident-global-search.test.mjs \
  test/opportunity-board-isolation.test.mjs
```

Observed: 59 focused tests passed, together with TypeScript and ESLint. The cases cover successful V2/V3 discovery,
zero-liquidity quarantine, partial aggregate evidence, prior code-hash rejection, schema-v4 count validation and the
absence of endpoints, request bodies and calldata from persisted failures.

## Live read-only probe

A signer-free local probe used Robinhood Chain's official public endpoint at fixed block `63,606,133`:

- duration: 47,239 ms;
- Earn: 32 pools, zero rejected;
- Uniswap V2: 29 active pools;
- Uniswap V3: 119 active pools;
- factory queries: 179 V2 pairs and 716 V3 pair-fee combinations;
- pool-state plus factory work: 1,118 subcalls compressed into 95 sequential RPC requests;
- transport evidence: `COMPLETE`, with zero V2 or V3 query errors.

This proves current read-path feasibility and topology coverage from one observation. It does not prove executable net
profit, transaction inclusion or realized profit.

## Complete repository verification

```bash
npm run check
```

Observed: formatting, ESLint, Solhint, shell syntax, TypeScript, production UI build and all compilation steps passed;
467 Node tests and all four deterministic contract suites passed; the secret scan passed across 502 files. Linux-only
`systemd-analyze` was unavailable on macOS and remains a production installation gate.
