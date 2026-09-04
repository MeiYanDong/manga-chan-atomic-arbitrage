# ADR 0005: bounded generic executor and dynamic sizing

- Status: Accepted for implementation; mainnet promotion pending
- Date: 2026-09-05

## Decision

Replace per-symbol contract development with one typed executor for the bounded PAIR route family:

```text
USDG -> quote A -> target -> quote B -> USDG
```

Quote-asset labels do not affect admission. A stock, AI token, meme or other ERC-20 follows the same path when both
PAIR pools and USDG anchors satisfy the same address-level invariants.

The operator supplies a typed `Route`, not arbitrary calldata. The contract fixes PoolManager, V3 factory/router, PAIR
hook, V4 fee and tick spacing. V3 paths may be empty for USDG, direct for one pool, or two hops with WETH as the only
intermediary and an allowlisted fee on each hop. One-hop swaps call the canonical pool directly; two-hop paths use the
canonical router. Every cycle must finish with a protected positive USDG balance delta or the entire transaction
reverts.

Sizing uses bounded adaptive search up to 100 USDG. The board probes cheaply, expands candidates with observed edge,
periodically covers the complete grid and adds midpoint refinement. A newly actionable candidate receives an immediate
full-grid pass, while a persistent candidate is probe-checked every cycle and receives at most one full-grid refresh per
configured interval. The signing lane exact-preflights the strongest typed route/amount candidates and maximizes
absolute net USDG profit after estimated execution gas. The 100 USDG value is a ceiling, not a target and not evidence
that the executor has 100 USDG principal.

## Rationale

The edge comes from stale relative state, not from whether a quote token represents a stock. A symbol-specific contract
would repeat the same mechanism and leave new pools waiting for a code release. Conversely, a generic multicall would
make the operator key an arbitrary external-call capability. The typed middle ground covers the economic family while
keeping the externally reachable action shape narrow and reviewable.

Maximizing percentage return would often select a small trade even when a larger bounded trade produces more dollars
after the same fixed gas. Always sending 100 USDG would fail in shallow pools. Bounded net-profit optimization captures
the relevant objective without unbounded RPC search.

## Consequences

- The existing fixed contracts and their receipts remain unchanged; migration is a separate wallet mutation.
- The read-only board remains signer-free. A board-positive row cannot authorize a transaction.
- Generic preflight adds exact contract simulation, exact gas estimation, route residual/allowance checks, nonce and ETH
  reserve checks, then rechecks the route immediately before signing.
- The fixed and generic signing generations share one wallet lock, mutation ledger and UNKNOWN barrier.
- Direct V3 anchors are cheaper than router-based one-hop anchors; fork evidence is required before changing the gas
  proxy again.
- Mainnet deployment, capital migration, continuous auto-execution and opportunity frequency remain unproven until
  their own canonical evidence exists.
