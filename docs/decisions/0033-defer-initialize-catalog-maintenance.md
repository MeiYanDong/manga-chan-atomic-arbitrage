# ADR 0033: defer Initialize catalog maintenance off the event quote path

- Status: Accepted and production-verified on v0.8.4
- Date: 2026-09-09

## Context

The v0.8 multi-source graph admits thousands of targets from more than sixty thousand retained PoolManager pools. A
hot-poll batch can observe a new pool whose currency belongs to that source registry. The board correctly retained the
fact, but then synchronously rewrote the approximately 42 MB source projection and requested a full metadata/graph
refresh before the next event quote. Production showed repeated loopback API pauses and one event-to-quote interval of
94 seconds even though quote work itself was bounded.

The hot cursor and the historical source/chain backfill cursors are independent. Advancing only the hot cursor does not
erase the historical recovery path: if the process exits before the next catalog checkpoint, source backfill reads the
same Initialize range again and content-addressed ingestion remains idempotent.

## Decision

1. The hot poller decodes and ingests every Initialize fact exactly as before, advances its durable hot cursor and marks
   a catalog refresh only when the fact adds a PAIR-attributed or retained source-target pool.
2. It does not synchronously write the full source or chain catalog and does not rebuild metadata in the hot poll
   function. Those projections remain owned by the protected periodic maintenance lane.
3. An event-triggered cycle never performs catalog network reads, graph rebuilds or large projection writes before its
   fixed-block quote. A pending refresh remains set until a periodic cycle successfully consumes it.
4. The board reports how many relevant Initialize refreshes were deferred and when the latest one occurred.
5. The signer feed, exact execution preflight, profit floors, principal caps, nonce ownership, reserve, failed-Gas
   breaker, authorization and receipt reconciliation are unchanged.

## Consequences

- An already admitted candidate can react to a pool event without waiting for a large catalog checkpoint.
- A brand-new pool cannot enter quote scheduling until the next protected periodic refresh. This bounded discovery lag
  is explicit; it is preferable to delaying every already-known event and cannot create signing authority.
- A crash before periodic persistence may temporarily remove the new pool from the current projection, but the
  unchanged historical cursor re-observes it. No source cursor is advanced by hot ingestion.
- Public RPC latency and throttling can still make a bounded quote miss the 45-second execution-freshness window. This
  change removes local catalog amplification; it does not relabel a public endpoint as production-grade.
