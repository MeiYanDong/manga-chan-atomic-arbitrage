# Partial catalog topology retention — local validation — 2026-09-15

Evidence state: implementation and complete local repository gate passed; immutable release and production promotion
pending.

## Production trigger

- v0.17.4 Global preflight completed in 8,677 ms with no signature, Gas or transaction;
- the catalog contained 32 Earn pools and 860 V4 pools but zero V2 and zero V3 pools;
- the preceding verified generation had 29 V2 and 59 V3 pools;
- valuation-eligible and funding-admitted route counts were both zero, so the preflight stopped as
  `NO_EXECUTABLE_FUNDING` rather than inventing no-profit evidence.

## Implemented boundary

- catalog schema v2 reconciles V2 by exact token pair and V3 by exact token pair plus fee;
- only `NETWORK`, `THROTTLED` and `STATE_NOT_READY` failures may retain prior pool-existence evidence;
- deterministic negatives, malformed identities and evidence older than six hours fail closed;
- readers validate observation class, verification time and retention counts before accepting the cache;
- execution still requires current quote, Gas, balance, nonce and simulation evidence.

## Focused verification

```bash
npm test -- --test-name-pattern='partial|retention|catalog'
npm run typecheck
npm run lint:js
git diff --check
```

Observed result: 461 Node tests passed with zero failures; TypeScript and ESLint passed. The new cases prove exact
transient retention, deterministic/stale rejection, fresh-result precedence, schema-count validation and read-time
expiry.

## Complete local gate

```bash
npm run check
```

Prettier, ESLint, Solhint, shell syntax, TypeScript, the production UI build and all four contract builds passed. All
461 Node tests and four deterministic contract suites passed; secret scan passed across 496 files. Linux systemd
analysis was skipped locally because macOS does not provide `systemd-analyze`; GitHub Actions and the production
installer remain the independent Linux gates. CI and production evidence must be appended before this document can
claim promotion.
