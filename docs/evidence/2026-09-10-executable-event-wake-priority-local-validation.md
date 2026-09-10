# Executable event-wake priority: local validation

- Date: 2026-09-10
- Version: 0.8.5
- Scope: signer-free event scheduler only
- Result: local gates passed; production promotion pending

## Change under test

The event queue now ranks candidates by current execution evidence before event freshness:

1. at least two pools already marked `EXECUTOR_COMPATIBLE`;
2. at least two pools with the deployed executor's exact hook, fee and tick-spacing shape;
3. all remaining shadow-only candidates.

Freshest-first ordering remains the tie-break inside each tier. Periodic coverage, source discovery, RPC endpoints,
request concurrency, signer authorization and every economic breaker are unchanged.

## Commands and results

```text
npm run check
```

Result:

- Prettier: passed.
- ESLint, Solhint and shell syntax: passed.
- TypeScript check: passed.
- Dashboard production build: passed.
- Solidity compilation: passed for fixed, generic and WETH executors with unchanged source/code hashes.
- Node tests: 224 passed, 0 failed.
- Deterministic fixed-route contract test: passed.
- Deterministic generic contract test: passed, including every existing negative safety check.
- Deterministic WETH contract test: passed, including every existing negative safety check.
- Secret scan: passed across 231 files.
- Linux-only `systemd-analyze`: unavailable on the macOS validation host and explicitly skipped by the existing verifier.

## New business-result assertions

- An older executable candidate is selected ahead of a newer shadow-only candidate.
- Freshness ordering remains intact among candidates in the same execution tier.
- Exact PoolKey shape receives scheduling priority but does not become execution evidence.
- Missing candidate data remains shadow-only.
- The board source stays read-only and publishes selected-candidate counters for all three tiers.

## Evidence boundary

This validation proves deterministic scheduling and preserves contract safety checks. It does not prove lower live latency,
a current profitable route, a signed transaction or realized profit. Those require post-deployment runtime samples and,
for economics, exact preflight plus a canonical transaction receipt.
