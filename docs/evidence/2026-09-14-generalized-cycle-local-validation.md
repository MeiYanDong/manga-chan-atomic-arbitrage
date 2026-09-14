# Generalized atomic-cycle local validation

- Status: locally validated; production promotion pending
- Date: 2026-09-14 CST
- Candidate version: `v0.16.0`
- Contract change: none

## Defect reproduction

The checked-in historical fixture records the competitor's address-only all-Earn route:

```text
PLTR --OMNI--> EARN --GLDN--> SPCX --WEAPONS--> PLTR
```

The prior unified graph contained all three pools but required at least two distinct venues in both discovery and plan
construction. That offchain filter rejected the route even though it was a closed, contiguous, distinct-pool atomic
cycle. It was a product-policy defect, not evidence that the historical route was profitable at the current block.

The regression test removes every token label and discovers the route from addresses and directed pool edges alone. An
offline replay of the retained current catalog produced 88 assets and 520 PLTR-settled cycles at the three-hop bound,
including the exact OMNI/GLDN/WEAPONS route. The replay is discovery evidence only; it is not a current quote or profit.

## Implemented boundary

- Same-venue and cross-venue two-to-four-hop simple cycles use one atomic route definition.
- Discovery and plan construction independently reject discontinuity, repeated pools, repeated intermediate assets and
  failure to return to the settlement asset.
- USDG, WETH and configured extras are priority seeds rather than a complete settlement allowlist.
- Non-seed assets require fixed-block graph structure, matching token decimals, Morpho liquidity or protected executor
  inventory, plus graph-attested executable V3 paths for WETH Gas and USDG normalization.
- Event wakes fund-check only seeds and event-touched assets. Recovery wakes deterministically rotate across at most 64
  candidates and admit at most 16 before the existing shared route budgets apply.
- Pre-sign valuation quotes use only fee tiers already present in the fixed-block graph, avoiding blind fee-tier probes
  on the latency-critical path.
- Authorization v11 commits the graph, route, admission, seed and work-bound policies. v10, v9 and v8 fail closed.
- The existing Universal Executor already supports the required typed Earn plan; no new contract was deployed locally.

## Local gates

`npm run check` passed with:

- Prettier, ESLint, Solhint and shell syntax checks;
- TypeScript checking and a production UI build;
- deterministic compilation of all four executor generations;
- 361 unit tests;
- all four deterministic contract suites, including universal inventory, Morpho flash, Uniswap v2/v3/v4 and Earn
  execution outcomes; and
- secret scanning across 395 files.

The focused dynamic-cycle, admission, authorization, isolation and business-read-model set passed 69 tests. The macOS
host does not provide `systemd-analyze`, so the Linux-only unit verification reported an explicit local skip; it remains
a production gate.

## Production acceptance still required

1. GitHub `quality` passes for the immutable commit.
2. Read back the current signer, authorization, nonce and unresolved-mutation state before any change.
3. Revoke and stop v10, reconcile to a clean wallet lane, and install the exact reviewed commit.
4. Pass Linux systemd and runtime identity checks without deploying another Universal Executor.
5. Issue one v11 until-revoked authorization, start exactly one watcher and confirm Feed plus periodic recovery.
6. Record the first v11 snapshot's admission scope, checked/admitted assets, selected routes, RPC budget and no unresolved
   mutation.
7. Count a new result only if a successful mainnet receipt, `Executed` event, settlement balance delta and canonical Gas
   all agree. `NO_EXACT_NET_OPPORTUNITY` remains a correct zero-signature decision.
