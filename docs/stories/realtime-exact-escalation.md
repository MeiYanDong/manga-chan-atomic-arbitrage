# Story: turn current near-edge quotes into safe exact execution decisions

## Outcome

As the live operator, I want current pool changes to reach the strategy quickly and near-threshold quotes to receive an
exact executor check, without lowering the profit required for a signed trade.

## Acceptance criteria

- The hot event cursor stays within 500 blocks of the confirmed head during healthy operation.
- A stale cursor records its skipped range and resumes near the head instead of repeatedly querying the rejected range.
- Public-RPC hot queries use no more than 200 blocks per request.
- A fresh candidate at or above `0.05 USDG` proxy net can trigger one deduplicated same-block exact preflight.
- A result below `0.10 USDG` exact normalized net produces no signature, broadcast or Gas spend.
- A result at or above `0.10 USDG` can enter the existing single-writer signing path only after all prior invariants pass.
- The operations console shows whether event listening follows the head and how many exact preflights the current
  authorization has attempted.

## Non-goals

- No new arbitrary router, token approval, hook, platform identity or cross-version executor is admitted.
- No proxy quote, simulation or running service is counted as realized profit.
- Historical catalog completeness is not inferred from the real-time cursor.
