# Story: quote executable event wakes before observational backlog

## Outcome

As the live operator, I want scarce event-quote capacity to reach candidates the deployed contract can consume before
it is spent on unsupported observational pools, without losing the broader market census.

## Acceptance criteria

- An older `EXECUTOR_COMPATIBLE` candidate is selected before a newer `SHADOW_ONLY` candidate.
- An `EXECUTOR_SHAPE` candidate is selected before `SHADOW_ONLY`, but remains non-executable until fixed-block quote
  evidence promotes at least two pools.
- Candidates inside the same tier retain freshest-first ordering.
- Missing or malformed catalog candidates fail closed to `SHADOW_ONLY` priority.
- Metrics distinguish compatible, structural and shadow-only event selections.
- Broad source discovery and protected periodic shadow coverage remain enabled.
- No RPC endpoint, request concurrency, signer permission, profit floor, capital cap or transaction path changes.

## Production acceptance

- Board and signer restart cleanly with zero unexpected restarts and no unresolved mutation.
- The event metrics endpoint exposes all three selection counters and the most recently selected tier.
- A bounded observation window shows advancing event/feed telemetry; economic execution remains receipt-gated.
- Any claim of lower event-to-quote latency must be based on post-deployment samples, not this deterministic unit test.
