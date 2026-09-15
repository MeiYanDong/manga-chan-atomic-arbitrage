# Bounded settlement-read local validation — 2026-09-15

Evidence state: implementation and complete local repository gate passed; GitHub CI, immutable release and production
readback pending.

## Production trigger

The v0.17.10 signer-free production preflight built a complete 247-asset graph but returned one funded candidate and
zero admitted settlement assets. The old outer concurrency of eight expanded each candidate into three simultaneous
funding reads, allowing 24 logical calls. An independent fixed-block probe proved that Morpho held both USDG and WETH
and that all four discovered WETH/USDG V3 fee tiers returned positive quotes.

## Implemented boundary

- a versioned V3 settlement policy caps public logical concurrency at eight;
- two funding candidates times three reads produce a maximum planned peak of six;
- 12 or more valuation paths are scheduled in ordered batches with at most eight active calls;
- a failed funding group waits for every sibling call to settle before retrying, preventing old and new attempts from
  overlapping;
- only typed transient failures retry once at the same fixed block;
- the snapshot exposes policy and retry counts without endpoint URLs, request bodies, calldata or raw errors;
- the authorization commitment advances from settlement policy V2 to V3.

## Focused verification

```bash
npm run typecheck
npm run lint:js
node --test --test-reporter=spec \
  test/global-settlement-assets.test.mjs \
  test/global-settlement-probe-concurrency.test.mjs \
  test/opportunity-board-isolation.test.mjs \
  test/dual-live-policy.test.mjs
```

Observed: all 39 focused tests passed. The behavioral concurrency test injected one typed throttle, kept the funding
peak within six, kept a 12-path valuation peak within eight, recovered in order and completed with one bounded retry.

## Complete repository verification

```bash
npm run check
```

Observed: formatting, ESLint, Solhint, shell syntax, TypeScript, UI build and all compilation steps passed; 473 Node
tests and all four deterministic contract suites passed; the secret scan passed across 515 files. Linux-only
`systemd-analyze` was unavailable on macOS and remains a production installation gate.

After adding this evidence file, the formatting gate and a follow-up secret scan passed across 516 files.

No key was loaded, no transaction was signed or broadcast, and no Gas, receipt or profit is attributed to this local
validation.
