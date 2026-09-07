# ADR 0008: event-driven shadow and evidence-bearing chain catalog

- Status: Accepted and promoted to signer-free production observation
- Date: 2026-09-07

## Context

Periodic full-board quoting wastes public-RPC capacity and reacts slowly to the causal state change. The previous event
ledger also counted a stale or temporarily unquotable observation as the end of an opportunity, so one continuous edge
could later be counted as a new opportunity. PAIR Launch V2 now accepts one to five stock or custom ERC-20 quote assets;
the current API also contains null depth fields, disabled historical quote assets and a hook not listed in the public
contract table. API `canonical: true` is therefore useful discovery metadata, but is not sufficient live authority.

## Decision

Keep the service signer-free and split it into three evidence layers:

1. **Catalog:** merge the complete PAIR API pagination with bounded, durable PoolManager `Initialize`-log backfill.
   Multi-pool launch transactions infer the common target address by set intersection. Single-pool launches are
   attributed only when exactly one currency is a known quote asset; every other case remains an explicit ambiguity.
2. **Wake:** incrementally poll PoolManager `Swap`/`Initialize` and previously quoted V3 anchor-pool `Swap` logs over
   public HTTP. Persist a canonical cursor, require confirmations, detect an anchor-hash mismatch and rewind a bounded
   lookback. Events select affected candidates but never calculate profit or authorize execution.
3. **Quote:** re-run the complete fixed-block route quote only for affected candidates. Retain a slow periodic
   reconciliation sweep because event dependencies cover previously quoted V3 routes, not every route that could become
   optimal in the future.

Pool admission is independent on every boundary:

- malformed metadata, a PoolKey hash mismatch, an unknown hook or known shallow depth is quarantined;
- disabled quote assets, unknown depth and the API-observed but undocumented Launch V2 hook are shadow-only;
- the current executor may consume a schema-v3 route only when both selected pools use its supported documented hook,
  have adequate known depth and carry a successful V4 Quoter attestation at the exact quote block and block hash.

The economic event ledger starts a new epoch. `STALE`, `UNQUOTABLE` and discovery gaps mean continuity is unknown; they
cannot close an open opportunity. Only a fresh non-positive quote closes it. Block hash and route revision remain quote
evidence and are not part of the economic episode identity.

## Provider decision

Use bounded HTTP `eth_getLogs` by default. Robinhood's public RPC is HTTP-only and rate-limited; its public sequencer
feed is not treated as an Ethereum log subscription. A managed standard WebSocket provider remains an optional later
latency upgrade, not a prerequisite for the shadow service. Rate limits trigger exponential polling backoff without
advancing the cursor.

The HTTP transport uses a bounded JSON-RPC batch. This preserves one independent `eth_call` result per path, including
its per-call gas estimate, while reducing connection bursts. Same-block, same-direction, same-amount V3 anchor requests
share one in-flight/result promise; the cache is cleared at every block boundary and failed entries are evicted. Neither
HTTP POST count nor cache-hit count is labeled as provider compute-unit savings.

If viem observes an incomplete batch envelope, the service classifies it as transport evidence, retries the affected
read through a bounded independent-request client and keeps that safer mode until restart. EVM reverts are identified
before this fallback test and never trigger the transport downgrade.

Periodic selection does not reserve empty capacity for nonexistent positive rows: it rotates a bounded subset of
priority rows, adds the actual positive set up to its cap and then one coverage batch. Incomplete V3 factory evidence is
retained for that fixed block and trips a cycle-level RPC circuit, so one provider failure cannot expand into repeated
path discovery calls. The next cycle uses a new fixed block and may recover normally.

Read-only calls receive a small bounded retry only for transport, throttling or temporary state-readiness classes. EVM
quote reverts are economic/path results and are never retried. Exhausting the bounded attempts trips the same cycle-level
circuit.

Historical Initialize-log backfill runs only after the current opportunity quote batch succeeds. Backfill remains
durable and bounded, but it cannot consume the public provider budget ahead of the latency-sensitive shadow decision.
The event wait is capped by a mandatory periodic deadline, so a continuously busy event stream can delay that slower
reconciliation by at most the one event cycle that was already dequeued before the deadline; it cannot starve it.

Within one fixed block, the first amount for each V3 direction evaluates the complete allowed route set and retains the
top three successful paths. Later amounts are quoted exactly against that shortlist. This bounds amount-grid expansion
without pretending that every fee combination was re-ranked at every size; the shortlist is discarded on the next
block.

## Consequences

- The board can react within its configured HTTP poll interval while using far fewer Quoter calls than a full sweep.
- Quoter-call totals, event wakes and observed-log-to-quote latency are runtime measurements; the target reduction is
  not claimed until production metrics exist.
- Chain-catalog completeness is only `COMPLETE_FROM_CONFIGURED_START`. Blocks before that start remain unknown, and the
  API plus chain merge is not described as a whole-chain census.
- Chain-only targets can be listed by address and pool count without inventing a symbol, depth, launch status or live
  eligibility.
- This release does not alter the executor bytecode, arm a watcher, load a signer or broadcast a transaction.
