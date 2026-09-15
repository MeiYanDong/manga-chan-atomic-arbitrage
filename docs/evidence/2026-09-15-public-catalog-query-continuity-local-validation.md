# Public catalog query continuity local validation — 2026-09-15

Evidence state: implementation and complete local repository gate validated; immutable release and production
promotion pending.

## Production trigger

- v0.17.6 recovered the signer-free catalog writer after critical chain-head and canonical Earn reads had crashed on a
  malformed batch response.
- The completed schema-v2 generation still contained only 16 Earn pools, zero V2 pools and zero V3 pools. Its broad
  V2/V3 query evidence remained partial because the official public endpoint omitted batched logical responses.
- The critical-read evidence recorded one recovered chain-head retry and two recovered Earn-catalog retries. This proves
  that the v0.17.6 critical recovery ran; it does not prove that the broad graph was complete or profitable.
- The signer watcher remained inactive and no transaction or profit is claimed from these diagnostics.

## Implemented boundary

- Normal broad reads remain batched. Only viem's exact missing-batch-item failure may retry that logical call as one
  non-batched request to the same official public endpoint.
- HTTP access denial, throttling, ordinary network errors, deterministic RPC errors and EVM reverts do not trigger the
  direct retry lane. The signer-free catalog service still receives no managed endpoint or signing material.
- Schema v3 extends six-hour, exact-failure topology continuity to canonical Earn pools. Only a current fixed-block
  `POOL_STATE` failure classified `NETWORK`, `THROTTLED` or `STATE_NOT_READY` can retain the matching prior pool.
- Fresh state replaces retained state, deterministic rejection removes it, and every reader verifies timestamps,
  observation classes and fresh/retained counts before using the atomic snapshot.
- Retained topology is discovery evidence only. Exact quotes, Gas, balances, nonce, simulation, submission and canonical
  receipt accounting continue to require current state.

## Focused verification

```bash
npm run typecheck
npm run lint:js
node --test --test-reporter=spec \
  test/public-first-rpc.test.mjs \
  test/earnonhood-graph.test.mjs \
  test/resident-global-search.test.mjs \
  test/opportunity-board-isolation.test.mjs
```

Observed: TypeScript and ESLint passed; all 40 focused Node tests passed. Fixtures cover exact omitted-item recovery,
same-endpoint isolation, deterministic-error exclusion, Earn transient retention, expiry, fresh-state precedence,
schema-v3 count validation and signer-free systemd boundaries.

## Complete repository verification

```bash
npm run check
```

Observed: formatting, ESLint, Solhint, shell syntax, TypeScript, production UI build and all compilation steps passed;
465 Node tests and all four deterministic contract suites passed; the secret scan passed across 498 files. Linux-only
`systemd-analyze` was unavailable on macOS and remains a production installation gate.

GitHub CI, release checksums and production readback remain required. No transaction, realized profit or production
correction is claimed by this local evidence.
