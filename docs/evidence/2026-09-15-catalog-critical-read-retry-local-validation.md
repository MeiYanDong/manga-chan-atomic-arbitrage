# Catalog critical-read retry — local validation — 2026-09-15

Evidence state: implementation and complete local repository gate passed; GitHub and remote verification pending.

## Production trigger

Cloud Assistant invocation `t-usw6x4pajmqmebl` observed `manga-global-catalog.service` in `failed` state with exit code

1. Its bounded journal showed viem's missing-batch-item `TypeError` while using the official public RPC. The preceding
   atomic schema-v1 catalog remained readable, but no new maintenance generation was published. The MANGA watcher was
   inactive, shared-wallet reconciliation was `CLEAN`, and the independent `atomic-cycle-live.service` retained PID 781.

## Implemented boundary

- chain-head and canonical Earn catalog identity reads use a dedicated non-batched official-public client;
- each critical operation may retry only classified transient RPC failures, at most three attempts with bounded
  exponential delay;
- deterministic invariants are never retried;
- exhausted attempts leave the prior atomic catalog untouched;
- the published catalog records retry counts and policy identity without endpoint or error payloads;
- V2/V3 bulk discovery remains batched, query-isolated and covered by ADR 0090 retention;
- no signer, managed RPC, WSS, transaction, capital, Gas or profit authority is added.

## Local verification

```bash
npm run check
```

Prettier, ESLint, Solhint, shell syntax, TypeScript, production UI build and all four contract builds passed. All 462
Node tests and four deterministic contract suites passed; secret scan passed across 497 files. The new behavior test
proves two transient failures recover on the third attempt while a canonical invariant is attempted exactly once.
Linux systemd analysis was skipped locally because macOS does not provide `systemd-analyze`; GitHub Actions and the
production installer remain the independent Linux gates.

GitHub CI, immutable release identity, production catalog regeneration and live preflight evidence remain pending.
