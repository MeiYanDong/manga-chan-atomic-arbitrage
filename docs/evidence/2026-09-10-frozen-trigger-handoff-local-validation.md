# Frozen-trigger handoff local validation — 2026-09-10

## Outcome

Release candidate `0.8.6` fixes a live-watcher handoff race without expanding execution scope. The watcher now freezes
the exact typed candidate revision that caused escalation and sends that revision to exact preflight. A concurrent
board refresh can no longer replace it or make its candidate hash disappear.

This document is local implementation and test evidence only. It is not a production deployment, signature,
broadcast, receipt or profit claim.

## Production diagnosis that motivated the change

The current authorization's audit ledger contained two exact-preflight starts on `2026-09-09`. Neither signed or spent
Gas. The following rejection reasons were observed after escalation:

- `triggered dual-base candidate left the fresh board set`;
- `snapshot has no fresh typed dual-base screened-positive candidate`.

The watcher selected a candidate from one board generation, but `execute()` selected from the board again and then
required the selected hash to remain present after exact work. Because the candidate hash commits to the quote block, a
normal board refresh can supersede that hash. This is a mutable-projection race, not evidence that exact executor
simulation was negative.

## Implemented boundary

- `freezeDualExecutionTrigger()` records the board generation, capture time, candidate hash and typed candidate.
- `selectionFromFrozenDualTrigger()` rejects malformed or expired handoffs without rereading the board.
- The candidate's quoted block hash is still checked against the canonical chain.
- The watcher passes the frozen trigger into exact preflight and no longer performs the post-preflight board-membership
  reread.
- Current-block exact executor simulation, Gas estimate, principal, reserve, nonce, route boundary, authorization,
  final protected simulation, raw durability, broadcast and receipt gates remain unchanged.
- Manual preflight and execute commands still read the current board when there is no watcher trigger.

## Verification

The focused test set passed `12/12`, including:

- a board that advances to an empty projection after the trigger is frozen;
- a frozen trigger that ages beyond its configured boundary; and
- a structural guard that prevents the removed post-preflight mutable-board reread from returning.

The final full local `npm run check` gate passed with:

- Prettier, JavaScript/Solidity/shell lint and TypeScript checks;
- UI build and all three contract compilations;
- `226/226` Node tests;
- all three deterministic contract suites; and
- secret scan over `236` files.

Production acceptance additionally requires CI, artifact hash verification, an empty signer feed, no unresolved
mutation, canonical runtime verification, a controlled signer restart and post-restart readback.
