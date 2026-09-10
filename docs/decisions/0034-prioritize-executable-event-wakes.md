# ADR 0034: prioritize executable event wakes before shadow-only work

- Status: Accepted; production verification pending
- Date: 2026-09-10

## Context

The multi-source graph intentionally retains thousands of multi-pool targets, including arbitrary chain-attested V4
hooks that the current executor cannot call. The independent event poller correctly routes all affected targets into one
freshness-bounded queue. That queue previously selected only by observation time. A busy shadow-only pool could
therefore displace an older candidate whose pools match the deployed executor, even though both would expire after the
same 20-second freshness window.

Production before this change had observed 151,111 stale candidate drops and a latest event-to-quote interval of about
38 seconds. These counters do not prove missed profit, but they do prove that the undifferentiated queue was spending a
scarce freshness budget without regard to executability.

## Decision

1. Assign each pending candidate one of three deterministic wake priorities from the current in-memory catalog:
   `EXECUTOR_COMPATIBLE`, `EXECUTOR_SHAPE`, or `SHADOW_ONLY`.
2. Select higher execution priority first. Within one tier, retain the existing freshest-event-first order and stable ID
   tie-break.
3. Treat PoolKey shape as structural routing priority only. It does not upgrade chain attestation, create an execution
   candidate or authorize signing.
4. Keep shadow-only targets in event scheduling when no higher tier is pending and in the protected periodic coverage
   lane. Discovery and source evidence remain complete.
5. Export counters for selected candidates by tier. Do not add another RPC endpoint, increase concurrency or consume
   the paid execution provider for broad discovery.

## Consequences

- A current-executor candidate is no longer displaced by a fresher unsupported-hook candidate in the same queue.
- Sustained executor-compatible traffic can defer shadow-only event quotes; periodic reconciliation remains their
  bounded fairness mechanism.
- RPC request volume is not increased by this scheduler change. It cannot create an economic edge where no price gap
  exists and does not prove a profitable opportunity.
- Exact preflight, minimum net profit, principal caps, nonce ownership, reserve, failed-Gas breaker, authorization,
  broadcast and receipt reconciliation are unchanged.
