# ADR 0086: Stream business evidence instead of loading the audit ledger

## Status

Accepted for implementation on 2026-09-15.

## Context

The production business-report one-shot crossed its 128 MiB cgroup after the main append-only audit ledger reached
about 23 MB and the Earn ledger reached about 3.7 MB. The reporter used `readFileSync`, split the whole file into
strings, parsed every diagnostic record and retained all resulting objects. systemd recorded `oom-kill`; the signer,
opportunity board and critical-health service remained independent and healthy, but the public operating snapshot could
not refresh.

Increasing the cgroup limit would postpone the same failure as immutable diagnostic history grows. Deleting or rotating
unreconciled history would weaken receipt and failure accounting. The report actually consumes only a small semantic
subset of those ledgers.

## Decision

- Keep every source JSONL ledger append-only and unchanged.
- Reuse the bounded incremental JSONL scanner to read fixed-size chunks and parse only selected event kinds.
- Project selected records immediately to the minimum fields consumed by business accounting. Drop arbitrary route,
  graph, provider and error payloads before retaining an object.
- Retain all failed-transaction Gas evidence, confirmed Earn effects and completed legacy collections. Retain only the
  latest runtime wallet verification and only Global funnel records matching the current authorization.
- Preserve fail-closed behavior for malformed or oversized selected/safety records. The one explicitly reviewed legacy
  signer-free `global_watch_wake` row may still be streamed past under the existing containment rule.
- Keep the report service signer-free, one-shot and capped at 128 MiB. Report failure cannot stop or authorize trading.
- Require a production one-shot readback under the actual cgroup before restoring its timer and path trigger.

## Consequences

Report heap use is determined by business evidence rather than by unrelated audit payloads. Historical ledgers remain
available for forensic review, while the public read model continues to show only sanitized receipt-gated results. The
active-authorization Global funnel no longer parses or retains prior authorizations' full graph snapshots.

Confirmed executions and failed transactions can still grow over a long operating lifetime. A future durable accounting
index may aggregate closed periods, but it must be reconciled from canonical receipts and cannot replace them merely to
reduce storage.

## Rollback

Restore the preceding immutable release. Do not truncate any ledger. If the earlier reporter again exceeds its cgroup,
leave only the reporting timer/path disabled; do not change the signer or its authorization as a reporting workaround.
