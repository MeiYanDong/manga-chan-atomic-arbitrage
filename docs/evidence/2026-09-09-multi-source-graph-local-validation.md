# Multi-source graph and coverage funnel local validation

- Date: 2026-09-09
- Scope: local source, production read-only catalog snapshot and generated dashboard assets
- Economic claim: none; no signature or transaction was produced

## Baseline

- Pre-change test suite: 212/212 passing.
- Production read-only source summary before promotion: 2,426 PAIR listings, 22,337 LONG launches, 41,713 Doppler
  targets and approximately 62,000 retained V4 pools.
- The then-active board admitted 861 candidates, had no completed periodic cycle since restart and had accumulated 398
  periodic preemptions at the sampled readback.

## Local result

The production source projection was streamed through the new pure graph builder without writing production state. At
that snapshot it produced:

- 44,139 independently discovered source targets;
- 4,223 targets with at least two retained V4 pools;
- 12,021 bounded candidate-pool orientations;
- 1,584 multi-pool targets matching the current executor PoolKey shape; and
- 7,933 admitted pools with unsupported hooks that remain shadow-only.

Graph construction took about 4.7 seconds and candidate normalization about 2.1 seconds on the local machine. Building
a 4,223-row board snapshot took about 12 ms and the summary dashboard projection about 115 ms. These measurements are
local capacity evidence, not production latency or opportunity evidence.

## Validation commands

```bash
npm run lint:js
npm run typecheck
npm test
npm run ui:build
```

The focused graph, scheduler, catalog, dashboard and isolation tests passed. The full v0.8.0 gate also passed locally,
on GitHub Linux and on the production artifact. Its first signer-disabled production cycle then showed that a complete
single-candidate topology still required 165 Quoter calls. v0.8.1 therefore bounds the protected coverage sample to one
V4 pair, one amount and one V3 route per direction; its final production measurements belong in a separate promotion
record. This canary produced no signature or broadcast.
