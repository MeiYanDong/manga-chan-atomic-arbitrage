# Story: keep source persistence out of the event quote path

## Outcome

As the live operator, I want an active-pool event to reach a fixed-block quote without first rewriting the complete
source census, while preserving restart-safe discovery evidence.

## Acceptance criteria

- An unrelated PoolManager Initialize event does not request a strategy graph refresh.
- A newly retained PAIR or source-target pool requests a refresh and increments explicit deferred-maintenance metrics.
- `pollHotEvents` performs no source-catalog write, chain-catalog write or metadata refresh.
- Every event-triggered cycle skips catalog maintenance even when a forced or pending refresh exists.
- The next periodic cycle retains the pending refresh and remains responsible for graph/source persistence.
- The execution feed stays signer-free and no contract, authorization or economic breaker changes.
- Production acceptance requires zero board/signer restarts, zero OOM events, responsive loopback reads between quote
  checkpoints, advancing feed generations and unchanged execution counters absent a fresh exact-positive candidate.

## Non-goals

- No promise that public-RPC latency will always fit the execution freshness window.
- No universal arbitrary-hook executor and no expansion of current signing-compatible PoolKey shapes.
- No deletion, compaction or rewriting of existing SQLite or append-only evidence.
