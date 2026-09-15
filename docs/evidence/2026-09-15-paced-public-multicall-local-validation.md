# Paced public Multicall local validation — 2026-09-15

Evidence state: implementation, repository gate and live read-only official-public probe passed; GitHub CI, immutable
release and production shared-host readback pending.

## Production trigger

v0.17.8 materially improved topology discovery but did not converge on the shared production host. Its first schema-v4
generation found 29 V2 and 84 V3 pools with 132 V3 transport failures. A second normal generation retained all 29 V2
pools and reached 94 V3 pools, while the current read classified 179 V2 and 233 V3 queries as transient failures.

## Implemented boundary

- canonical Multicall3 aggregates remain fixed-block, sequential and limited to 12 subcalls;
- all four V2/V3 factory and state phases share a 250 ms minimum request-start interval;
- only `NETWORK`, `THROTTLED` and `STATE_NOT_READY` aggregate failures retry;
- three total attempts use 750 ms and 1,500 ms exponential delays; invariants never retry;
- schema-v4 evidence records and validates the exact timing/attempt policy, requests, retries, transient failures and
  logical subcalls;
- the catalog remains signer-free, official-public-only and outside the 60-second execution deadline.

## Focused verification

```bash
npm run typecheck
npm run lint:js
node --test --test-reporter=spec \
  test/global-liquidity-graph.test.mjs \
  test/resident-global-search.test.mjs \
  test/opportunity-board-isolation.test.mjs
```

Observed: 41 tests passed. Coverage includes recovered 429, exhausted transient failure, non-retried invariant failure,
fixed policy/count validation and persisted-error redaction.

## Live read-only probe

The signer-free command used Robinhood Chain's official public endpoint and a disposable runtime directory. At block
`63,625,289` it observed:

- 32 Earn pools, 29 V2 pools, 119 V3 pools and five reviewed V4 pools;
- 179 V2 pair queries and 716 V3 pair-fee queries;
- 1,118 logical factory/state subcalls in 95 aggregate requests;
- zero retries, zero transient failures and zero final V2/V3 transport errors;
- `COMPLETE` read evidence with the reviewed canonical Multicall3 runtime hash.

No wallet, private key, authenticated endpoint, signature, simulation, transaction or broadcast was used. Complete
topology is not evidence of executable net profit.

## Complete repository verification

```bash
npm run check
```

Observed: formatting, ESLint, Solhint, shell syntax, TypeScript, production UI build and all compilation steps passed;
469 Node tests and all four deterministic contract suites passed; the secret scan passed across 506 files. Linux-only
`systemd-analyze` was unavailable on macOS and remains a production installation gate.
