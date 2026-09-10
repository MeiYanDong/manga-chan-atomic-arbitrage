# S20 — Frozen trigger handoff to exact preflight

## User outcome

When the live watcher sees a valid screened-positive revision, a concurrent board refresh must not make that exact
revision disappear before current-state validation begins.

## Acceptance criteria

- A watcher-selected candidate is captured with its candidate hash, source board generation and capture time.
- Advancing or emptying the mutable board after capture does not replace or invalidate the frozen candidate.
- A frozen candidate older than the configured execution freshness limit is rejected before exact RPC work.
- The quote block hash is still checked against the canonical chain before exact evaluation.
- Exact simulation, Gas, nonce, principal, reserve, authorization, final simulation, raw durability, broadcast and
  receipt gates are unchanged.
- Manual `dual:preflight` and `dual:execute` continue to select from the current board when no watcher trigger exists.
- Tests verify both the successful board-advance case and the expiry rejection, and a structural guard prevents the
  removed post-preflight mutable-board reread from returning.

## Out of scope

- admitting additional hook or PoolKey families;
- changing the public/paid RPC split;
- changing principal or profit floors;
- claiming an execution or profit without a canonical receipt and post-state.
