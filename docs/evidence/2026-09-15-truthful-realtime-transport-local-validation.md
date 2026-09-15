# v0.17.12 truthful real-time transport local validation

Date: 2026-09-15

## Scope

This candidate changes only low-latency transport truth, managed Earn initial-handshake retry pacing and the sanitized
business read model. It does not change contracts, transaction authority, principal, Gas ceilings, profit floors,
nonce handling, submission or receipt accounting.

## Local quality gate

Command:

```bash
npm run check
```

Result: passed after one type-contract correction.

- The first complete gate stopped at `tsc --noEmit` because the exported retry helper lacked an explicit JSDoc type for
  a custom policy. No later stage was represented as passed.
- After adding the parameter contract, the complete gate passed from formatting through secret scanning.
- Node tests: 476 passed, 0 failed.
- Deterministic contract suites: fixed-route, generic USDG, WETH and universal executor all passed.
- UI production build: passed.
- Secret scan: 519 files scanned, passed.
- Local Linux `systemd-analyze` was unavailable and was truthfully skipped by the existing gate; Linux verification
  remains a production-promotion requirement.

Focused assertions cover:

- managed-WSS retry delays of 30, 60, 120 seconds and a 900-second ceiling;
- both fast paths down becoming non-paging `LOW_LATENCY_INPUTS_UNAVAILABLE` degradation;
- one restored fast path retaining healthy trading coverage;
- a public `FALLBACK_ONLY` model containing only connected-path count, recovery bounds and retry time;
- exclusion of provider errors, WSS URLs and status codes from the public projection;
- source integration using the bounded retry state rather than the old fixed 30-second loop.

## Pre-promotion production diagnosis

Cloud Assistant invocation `t-usw6x59g34eesxs` ran a read-only, secret-safe endpoint-shape probe against the current
immutable v0.17.11 release. It printed no endpoint or credential. The currently verified HTTPS credential, with only
its protocol changed to WSS, returned chain ID 4663 and completed a live subscription. The separately configured WSS
credential path did not match that working credential.

Invocation `t-usw6x59km1nhpfk` then confirmed the current watcher itself had not recovered: the service was `RUNNING`,
managed Earn WSS was `DEGRADED` and inactive, the official Feed remained rejected, there was no unresolved mutation,
and the current watcher had one confirmed execution in its ledger. This is configuration/readback evidence, not a new
profit receipt and not evidence that v0.17.12 is deployed.

## Remaining promotion gates

1. CI must pass on an immutable public commit.
2. Release automation must publish that exact commit.
3. Production must disarm, stop, reconcile cleanly and verify the release before re-arming.
4. The WSS value may be updated without disclosure only after the same chain-ID and subscription probe passes during
   the maintenance window.
5. The restarted watcher must publish its own connected managed-WSS state; the standalone probe is insufficient.
6. Public business readback must show `PARTIAL_REALTIME` if Earn WSS is connected and the official Feed remains down.
7. Canonical profit remains receipt-gated; this change alone creates no profit claim.
