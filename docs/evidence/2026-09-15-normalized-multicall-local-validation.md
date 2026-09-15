# Normalized Multicall failure local validation — 2026-09-15

Evidence state: implementation, complete repository gate and official-public read-only probe passed; GitHub CI,
immutable release and shared-host production readback pending.

## Production trigger

The first v0.17.9 production refresh returned 48 V3 failures as four exact 12-item arrays: 36 factory and 12 pool-state
queries, all classified `THROTTLED`. Outer evidence reported zero retries and zero transient failures, proving that
viem's `allowFailure` result representation had bypassed the thrown-error retry branch.

## Implemented boundary

- result shape and exact count are checked before normalization;
- only an all-failure array whose every error is network, throttle or node-state transient is promoted;
- the normalized aggregate follows the fixed paced three-attempt policy;
- mixed arrays and invariant failures remain per-subcall evidence and never fan out;
- `embeddedTransientBatches` is recorded and validated as a subset of total transient failures;
- no raw error, endpoint, request body or calldata persists.

## Focused verification

```bash
npm run typecheck
node --test --test-reporter=spec \
  test/global-liquidity-graph.test.mjs \
  test/resident-global-search.test.mjs \
  test/opportunity-board-isolation.test.mjs
```

Observed: 43 focused tests passed. They include thrown transient recovery, embedded all-transient recovery, mixed-result
non-retry, all-invariant non-retry and schema evidence rejection.

## Live read-only probe

At Robinhood Chain block `63,640,000`, a signer-free disposable-runtime probe using only the official public endpoint
observed:

- 32 Earn pools, 29 V2 pools, 119 V3 pools and five reviewed V4 pools;
- 179 V2 pair queries and 716 V3 pair-fee queries;
- 1,118 logical subcalls in 95 aggregate requests;
- zero retry, transient-failure, embedded-batch or final transport errors;
- `COMPLETE` evidence under `CANONICAL_MULTICALL3_FIXED_BLOCK_NORMALIZED_RETRY_V3`.

No credential, signer, simulation, broadcast, Gas or capital mutation was used. Complete topology does not prove an
executable profitable route.

## Complete repository verification

```bash
npm run check
```

Observed: formatting, ESLint, Solhint, shell syntax, TypeScript, production UI build and all compilation steps passed;
471 Node tests and all four deterministic contract suites passed; the secret scan passed across 510 files. Linux-only
`systemd-analyze` was unavailable on macOS and remains a production installation gate.
