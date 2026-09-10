# ADR 0036: targeted managed RPC for executor-shaped event quotes

- Status: Accepted for implementation; production promotion pending
- Date: 2026-09-10

## Context

The signer-free board had 67,138 retained pools, 4,355 multi-pool targets and 3,524 admitted candidates at the
decision readback. Only two quotes were fresh. Event cycles on Robinhood's official public RPC took roughly 29-49
seconds, while 782 current candidates had at least two pools matching the deployed executor's PoolKey shape. Only one
candidate had two pools already carrying complete live-compatible evidence.

More discovery does not repair this bottleneck. A PoolManager or known V3 `Swap` event is only a wake signal; the
opportunity still requires a same-block V3/V4 Quoter screen before the separate executor preflight can decide whether
to sign. The public endpoint remains useful for broad, cheap coverage but is not timely enough for this event-bound
read path.

The race thesis remains deliberately narrow:

- reward source: temporary relative-price disagreement across two V4 pools and their V3 base anchors;
- allocation: shared public arbitrage until competing flow removes the edge;
- sequencing rule: `UNKNOWN`; faster quote evidence is a controllable latency improvement, not proof of winning;
- earliest public signal: a canonical V4/V3 pool-state change observed by the public log poller;
- earliest safe action: a frozen, fixed-block screen followed by the existing exact current-block executor simulation;
- invalidating evidence: stale block/quote, non-positive exact net, unsupported route, nonce conflict, insufficient
  balance or Gas reserve, exhausted authorization, unresolved mutation or canonical receipt disagreement.

## Decision

Keep discovery, hot-log polling, catalog backfill and protected periodic reconciliation on the official public RPC.
Add one optional managed HTTP endpoint exclusively for event-triggered fixed-block quotes when the selected candidate
is either `EXECUTOR_COMPATIBLE` or `EXECUTOR_SHAPE`. Shadow-only candidates remain public-RPC work.

The managed lane is disabled unless both an explicit enable flag and a private endpoint are present. It cannot be the
official public endpoint or alias the configured public reader. The board still has no signer, wallet, nonce or
broadcast capability.

Initial production limits are release-owned and durable across process restarts:

- 200 admitted high-priority event candidates per UTC day;
- 4,000 logical JSON-RPC operations per UTC day; and
- four concurrent managed HTTP requests.

Each logical-call debit is persisted before the request. Reaching either cap routes further event quotes to the public
reader. A transient managed-provider failure degrades the remainder of that event cycle to the public reader and uses
the existing bounded event retry. Business/EVM reverts do not trigger provider failover. Periodic work never consumes
the managed budget.

The runtime publishes provider roles, both remaining budgets, HTTP/logical counts, fallback reasons and p50/p95/p99/max
transport latency. Logical calls are not asserted to equal provider request units or billing cost.

Capacity expansion is manual. It requires a completed observation window with canonical execution receipts, positive
active-strategy net after Gas and provider cost, no unresolved mutation and acceptable failed-Gas behavior. Candidate
counts, screens, simulations and historical generic-v2 profit cannot unlock a higher paid-RPC tier.

## Gate classification

- Public event/log discovery: adaptive source-availability gate; retained on the public reader.
- Managed event quote: adaptive latency route with bounded paid usage and public degradation.
- Fixed block/hash, typed PoolKey, exact executor simulation, profit floor, principal, nonce, authorization and
  receipt convergence: unchanged correctness/economic gates.
- Provider label and latency telemetry: asynchronous operational evidence; never signing authority.

## Consequences

- Paid usage is proportional to relevant event candidates rather than the 67k-pool catalog.
- Successful fixed-block V4 quotes may promote executor-shaped pools using the existing attestation logic; no universal
  arbitrary-call executor or contract deployment is added.
- Public fallback preserves observation liveness after quota exhaustion but can again be too slow; that state is
  explicit rather than presented as full hot coverage.
- One provider remains a correlated availability boundary. Cross-provider racing is not enabled by this decision.
- A faster screen can increase exact-preflight frequency, but only canonical receipts and post-state can prove profit.

## Rollback

Set `MANGA_BOARD_HOT_RPC_ENABLED=0` and restart only the signer-free board. Keep the durable budget file and runtime
evidence. Do not restart, re-arm or mutate the dual watcher during a board-only rollback.
