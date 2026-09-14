# ADR-0080: Bound audit reads and use managed Earn event intake

Status: accepted

Date: 2026-09-15

## Context

The v0.16.9 production canary removed Solidity compilation from the signer but still exhausted a 320 MiB V8 heap
within seconds. The execution handoff was only about 22 KiB. The actual hot path repeatedly loaded, split and parsed
the complete shared audit ledger (about 16 MiB and 12,867 lines) through authorization, unresolved-mutation, usage and
route-quarantine checks. Provider failures also wrote long Cloudflare HTTP 403 bodies into ordinary diagnostic rows,
amplifying each parse. Separately, the official public Robinhood RPC denies the production server, so public-only Earn
discovery could not reach the exact-profit gates even though the managed execution RPC remained healthy.

## Decision

- Keep the append-only audit ledger intact, but scan it in 64 KiB chunks and cache only the versioned events required
  for authorization, nonce reconciliation, receipt economics and route-local quarantine.
- Read only newly appended bytes after the first scan; reset on rotation or truncation. A malformed or overlarge
  safety event remains fail-closed.
- Redact provider URLs and cap normal error text at 4,096 characters and diagnostic stacks at 8,192 characters before
  they enter persistent state or logs.
- Use the official public HTTP endpoint first for Earn discovery. HTTP 403, transport, timeout and rate-limit failures
  may fall back to the managed endpoint under both a persisted 40,000 logical-call UTC-day cap and an independent
  128-call event / 192-call recovery cap. Deterministic EVM reverts never trigger provider fallback.
- Subscribe to canonical Earn Vault `Swap` logs over the configured managed WSS endpoint. Canonical
  block/transaction/log identities suppress reconnect replay under a bounded 4,096-key cache. The public HTTP event
  reader remains a 60-second recovery backstop rather than a one-second paid polling substitute.
- Bind the event-source and RPC-cost policies to authorization v12. A v11 arm cannot run this release.

## Consequences

Authorization and reconciliation no longer create heap usage proportional to the complete diagnostic history on every
loop, while the immutable evidence ledger remains available for audit and rebuild. Managed RPC usage is observable and
hard-bounded; exhaustion yields signer-free degraded coverage rather than a trade. WSS improves event latency but does
not authorize execution: every candidate still requires current exact quote, call simulation, Gas, balance, nonce,
profit, signed-raw and receipt checks in the single signer lane.
