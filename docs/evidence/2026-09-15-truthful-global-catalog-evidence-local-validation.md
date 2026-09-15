# Truthful Global catalog evidence local validation — 2026-09-15

Evidence state: implementation and complete repository gate validated locally; immutable release CI and production
promotion pending.

## Production incident evidence

- The v0.17.1 production graph observed 128 selected targets and 846 selected pools but reported only 14 admitted
  targets and 93 admitted pools while retaining 916 V4 pools.
- The same round found 7,198 routes, admitted no atomic funding and reported zero evaluated routes as
  `NO_EXACT_NET_OPPORTUNITY / COMPLETE`.
- Inspection showed the rotating projection had been persisted into the base catalog and its long-tail assets had been
  added to V2/V3 factory discovery. The catalog did not persist transport completeness.
- These observations prove a catalog/evidence defect. They do not prove a missed profitable transaction.

## Implemented boundary

- The base refresh is limited to Earn assets, settlement hubs and the reviewed V4 bootstrap; the board-derived V4
  projection is merged only into the current in-memory graph.
- Duplicate projected PoolKeys already present in a legacy catalog remain one graph edge group and count as admitted.
- Catalog transport evidence is validated, sanitized and propagated through readiness and the public business model.
- A partial writer cache becomes refreshable after five minutes; the signer-free worker can only read it.
- Absence of approved atomic funding has a typed policy outcome.

## Verification

Command:

```bash
node --test --test-reporter=spec \
  test/business-operations.test.mjs \
  test/global-universe-projection.test.mjs \
  test/global-settlement-assets.test.mjs \
  test/global-liquidity-graph.test.mjs \
  test/resident-global-search.test.mjs \
  test/opportunity-board-isolation.test.mjs
npm run typecheck
npm run lint
```

Observed focused result: 60 Node tests passed; TypeScript, ESLint, Solhint and shell syntax passed.

Complete command:

```bash
npm run check
```

Observed complete result: Prettier, ESLint, Solhint, shell syntax, TypeScript and the production UI build passed; 457
Node tests and all four deterministic contract suites passed; secret scan passed across 484 files. Linux systemd static
verification was skipped locally because `systemd-analyze` is unavailable on macOS and remains a production install
gate. GitHub branch/main CI, release artifact verification and production readback remain mandatory before this
evidence can be promoted from local to production.

No transaction, realized profit or production correction is claimed by this document.
