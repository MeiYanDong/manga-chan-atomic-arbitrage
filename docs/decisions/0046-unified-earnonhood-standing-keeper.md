# ADR 0046: unified EarnOnHood standing keeper with balance-scaled principal

- Status: Accepted
- Date: 2026-09-12
- Supersedes: ADR 0043 for continuous execution; its historical receipt evidence remains valid

## Context

The guarded one-shot proved that the reviewed `WETH/MOO/AI/WETH` cycle can settle atomically and increase the native
wallet balance after Gas. It did not remain eligible while the existing dual watcher owned the wallet lock, it sampled
only four fixed inputs up to `0.002 WETH`, and a gross-positive/net-negative quote could be passed to a protected Gas
estimate with an impossible `minAmountOut`. The operator has now explicitly authorized continuous live operation,
balance-scaled sizing without a fixed principal cap, and a long-term positive-Gas constraint.

The Flap keeper pattern contributes three reusable mechanisms: a standing route/opportunity book, event wakes plus a
slow recovery tick, and one nonce-owning signer with receipt/post-state evidence. Flap's protocol-specific inventory
limits and fixed principal cap are not copied into this strategy.

## Decision

1. The existing `manga-dual-watcher` remains the only persistent signer and nonce owner. It invokes the Earn adapter
   synchronously while holding the dual watcher lease; the child acquires the shared wallet lock and proves its parent
   PID, active authorization ID and latest unresolved reservation before broadcast.
2. The two reviewed directions and three reviewed pools form a persistent standing route book. A Vault `Swap` touching
   one of those pools wakes it through the official public RPC. A five-minute recovery tick covers missed/reorged or
   unavailable event observations.
3. Public RPC performs the balance-scaled quote and Gas screen. The managed strategy RPC is used only after that screen
   is net-positive, then repeats identity, exact quote, protected call, Gas, balance and nonce checks at a current block.
4. Earn principal has no fixed monetary or token cap. Twenty-four quadratic probes end exactly at the live spendable
   balance: wallet balance minus one attempt's Gas allowance and the retained transaction-submission reserve.
5. A signed transaction commits `minAmountOut = amountIn + buffered maximum Gas + positive net floor`. A
   gross-positive quote that cannot meet this floor becomes `NO_SHOT` before a protected Gas estimate is attempted.
6. Failed-Gas authority comes only from receipt-proven lifetime Earn net. Before signing, charging the complete
   buffered Gas limit must leave this lifetime balance strictly positive. The existing per-attempt Gas ceiling and
   wallet/nonce invariants remain; neither is a principal cap.
7. Mutation plan and signed raw are persisted before broadcast. Receipt status, the exact three Vault `Swap` logs,
   canonical Gas and exact-block native wallet balance delta must agree before profit is recorded.
8. Earn signed/effect/revert events are mirrored into the main append-only audit. They therefore advance the same
   expected wallet nonce and are visible to the unified authorization and UNKNOWN reconciler.

## Consequences

- A larger wallet balance automatically expands the evaluated principal without a code/config cap. Pool liquidity and
  price impact still determine the maximizing executable amount.
- No transaction is sent merely because gross output exceeds input. When no exact net-positive amount exists, the
  service remains live and spends no Gas.
- A full failed-Gas charge cannot consume all historically realized Earn net under the active policy. This does not
  make transaction inclusion, RPCs, contracts, tokens, governance or key custody risk-free.
- New Earn pools or tokens remain discovery/review work. They cannot enter signing by changing API data alone.
