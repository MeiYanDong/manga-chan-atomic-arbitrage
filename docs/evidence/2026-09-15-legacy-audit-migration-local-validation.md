# Legacy oversized audit migration: production blocker and local validation

Date: 2026-09-15

## Production observation

The immutable v0.16.10 release installed successfully, the prior v11 authorization was durably revoked and
`dual:reconcile` returned `CLEAN`. Before any new authorization existed, `dual:runtime-verify` failed closed while
reading the retained production ledger:

- ledger: `/var/lib/manga-chan-arbitrage/audit.jsonl`;
- oversized rows above 2 MiB: exactly one;
- row size: 6,947,193 bytes;
- controlled prefix event: `global_watch_wake`;
- signer state during the finding: inactive and disabled;
- signatures or broadcasts made by v0.16.10: zero.

The row came from the older scheduler diagnostic and is not consumed by mutation recovery, nonce reconciliation,
authorization accounting or receipt economics. The evidence file remains append-only and was not truncated, rotated
or rewritten.

## Narrow repair

The incremental reader may stream-discard only an oversized row whose controlled leading fields identify
`global_watch_wake`. While discarding, it retains only a bounded cross-chunk scan tail and rejects any accepted safety
event marker found later in the row. An oversized mutation, accepted safety event, unknown event, malformed prefix or
unterminated safety row still fails closed.

## Local verification

`npm run check` passed on the v0.16.11 candidate:

- formatting, JavaScript/Solidity/shell lint and TypeScript checks passed;
- the dashboard production build and four compiler-artifact builds passed;
- 424 Node tests passed, including a roughly 7 MiB legacy-wake fixture, cross-chunk hidden-safety detection and unknown
  oversized-event rejection;
- all four deterministic contract suites passed;
- the secret scan passed across 454 files.

This is local/repository evidence only. GitHub CI, release-artifact identity, production installation, fresh nonce and
balance readback, v12 authorization, managed-WSS subscription, steady-state memory and any natural receipt remain
separate deployment gates.
