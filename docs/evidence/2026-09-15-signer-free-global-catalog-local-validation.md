# Signer-free Global catalog slow-lane local validation — 2026-09-15

Evidence state: implementation and complete repository gate validated locally; immutable release CI and production
promotion pending.

## Production trigger

- The corrected v0.17.2 catalog admitted all 128 selected targets and 809 selected V4 pools.
- Its official-public-first base refresh required about 130 seconds, exceeding the live Global child's 60-second
  deadline.
- The refresh recorded 179 requested V2 pairs, 716 V3 fee queries, 159 V2 transport failures and 512 V3 transport
  failures. Its `PARTIAL` result is valid coverage evidence, not a complete no-opportunity conclusion.
- No transaction was signed or broadcast during this diagnosis.

## Implemented boundary

- Global search and execution consume only a current atomic catalog snapshot; `loadGlobalGraph()` has no refresh call.
- `manga-global-catalog.service` is the sole writer, requires an explicit maintenance boundary and serializes writers
  with `global-catalog.lock`.
- The maintenance service has no private-key credential, live arm, managed RPC or WSS. It uses the official public RPC,
  an allowlisted optional-settlement config, a six-minute deadline, 384 MiB memory ceiling and low CPU weight.
- A persistent timer runs 15 minutes after the preceding refresh finishes. Failed maintenance preserves the prior
  atomic snapshot, and a snapshot older than six hours degrades Global without blocking Earn.
- The dual watcher explicitly passes `GLOBAL_SEARCH_READONLY_CATALOG=1` in addition to the cache-only code boundary.

## Verification

Focused command:

```bash
node --test test/resident-global-search.test.mjs test/opportunity-board-isolation.test.mjs
npm run lint
npm run typecheck
```

Observed focused result: 19 Node tests passed; ESLint, Solhint, shell syntax and TypeScript passed.

Complete command:

```bash
npm run check
```

Observed complete result: Prettier, ESLint, Solhint, shell syntax, TypeScript and the production UI build passed; 458
Node tests and all four deterministic contract suites passed; secret scan passed across 488 files. Linux systemd static
verification was skipped locally because `systemd-analyze` is unavailable on macOS and remains a production install
gate.

No transaction, realized profit or production promotion is claimed by this document.
