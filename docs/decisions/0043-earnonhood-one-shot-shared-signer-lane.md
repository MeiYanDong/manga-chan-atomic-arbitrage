# ADR 0043: guarded EarnOnHood one-shot behind the shared signer lane

- Status: Accepted
- Date: 2026-09-12

## Context

EarnOnHood Omnipools expose Balancer-v3-style weighted-pool cycles that are outside the current PAIR V4/V3 executor
shape. One exact cycle became net-positive on Robinhood Chain mainnet, but the existing dual watcher already owns the
operator wallet's nonce and signing credential. Starting a second autonomous signer would create an unresolved
same-wallet race, while treating an API or approximate quote as executable would overstate both liquidity and profit.

## Decision

1. Add a signer-free all-pool research command that uses the Earn API only for discovery and approximate ranking, then
   validates pool identity and exact quotes against one fixed chain block.
2. Add one narrowly typed live command for the reviewed `WETH/AI/MOO` triangle. It accepts only two fixed directions,
   fixed pool identities and amounts no larger than `0.002 WETH`.
3. Keep execution one-shot and explicitly armed. It refuses to run while the dual watcher lock is active and takes the
   existing wallet lock before preflight, signing or broadcast.
4. Protect net profit in the transaction's `minAmountOut`: input plus buffered maximum Gas plus the configured minimum
   net. Also retain a separate quote-headroom floor, failed-Gas cap and wallet reserve.
5. Refresh block, deadline, exact quote, Gas, balance and latest/pending nonce immediately before loading the private
   credential. Persist the exact mutation plan and signed raw before broadcast, then accept success only from a
   canonical receipt and positive native-balance delta.
6. Use public RPC for broad discovery and the managed execution endpoint only for guarded preflight and broadcast.
   Never persist `EARN_LIVE_ARM`; it applies to one command invocation only.

## Consequences

- The live receipt proves one economic cycle without granting a second process concurrent control of the wallet.
- The supported live route is intentionally narrower than the research graph. A newly discovered token or pool cannot
  flow into signing without a reviewed code change.
- Manual watcher handoff is operationally slower than an integrated adapter, but it avoids expanding autonomous
  authority before opportunity frequency and failure cost are measured.
- Atomic settlement does not eliminate failed Gas, FCFS ordering, contract, token, governance, RPC or key-custody risk.

## Follow-up threshold

Integrate Earn into the continuous board and the single dual signer only after 7–14 days of event/quote opportunity
telemetry. Capital and paid-RPC budgets remain unchanged until canonical receipt net covers failed Gas and provider
cost across the observation window.
