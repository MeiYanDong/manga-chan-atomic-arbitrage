# ADR 0027: independent hot-poll scheduler

- Status: Accepted; production verification pending
- Date: 2026-09-09

## Context

The v0.7.0 board recovered its stale real-time cursor and correctly read the release-owned 200-block range and
500-block maximum lag. Production readback then exposed a second scheduling failure: the first eight-candidate periodic
reconciliation made 1,218 Quoter calls and took about three minutes. Because log polling occurred only after the quote
cycle returned, the hot cursor accumulated another 4,774-block gap and fast-forwarded again. Smaller log ranges repair
provider response limits but cannot make a serial scheduler real-time while a different task owns the loop.

## Decision

1. The board starts one dedicated asynchronous hot-poll task before the first quote cycle.
2. Only that task calls `pollHotEvents`, so cursor advancement, reorg handling and log ingestion remain serial.
3. The poller never consumes candidate wakes. It coalesces them into the bounded queue; the existing main scheduler is
   the only consumer and retains the four-candidate quote cap and mandatory periodic-reconciliation deadline.
4. The existing shared RPC concurrency gate still bounds public-provider pressure. Successful polls target the configured
   cadence; transient errors use the existing capped exponential backoff.
5. A newly populated queue releases the main scheduler's wait immediately. Event state remains wake evidence only; each
   candidate still needs a fresh canonical fixed-block quote and the separate signer exact preflight.
6. Each quote cycle rebuilds the dependency index from the current catalog and persisted observations before selecting
   its fixed block. Events that arrive during a slow quote therefore retain candidate routing even on the first cycle.
7. Graceful shutdown stops and joins the poll task before closing the durable store.

## Consequences

- Slow quotes no longer stop cursor discovery or force routine coverage gaps.
- Poll and quote requests may interleave, but their combined HTTP concurrency remains bounded by the same gate.
- A reorg can replace a queue after a wake was already consumed. That wake cannot authorize a transaction; at worst it
  causes an unnecessary canonical re-quote, which is safe.
- Production acceptance requires observing at least one complete slow reconciliation with increasing poll count,
  current `lastPollAt`, head lag at or below 500 blocks and no additional fast-forward.
