# ADR 0019: dual USDG/WETH principal execution

- Status: Accepted and production-verified
- Date: 2026-09-08

## Context

Generic-v2 always begins and ends in USDG. That makes accounting simple, but it forces routes whose most natural
settlement asset is WETH through an additional USDG conversion and prevents WETH profit from compounding directly.
Running an independent WETH bot would create two processes competing for one wallet nonce and could sign both sides of
the same opportunity.

The operator approved a WETH-principal path while retaining the existing USDG deployment. Count and time limits may be
removed for confirmed-positive operation, but atomicity does not remove failed Gas, stale-state, provider, nonce,
implementation, or key-custody risk.

## Decision

Add a second typed contract, `WethAtomicArb`, and one dual-v3 off-chain signing lane.

1. `WethAtomicArb` accepts native ETH only in its payable constructor and immediately wraps it 1:1. Runtime execution
   starts and ends in WETH; native ETH remains in the operator wallet for Gas.
2. The USDG contract source and deployment remain unchanged. Each executor has its own deployment ledger, immutable
   amount cap, immutable gross-profit floor, principal balance, and post-state reconciliation.
3. The signer-free board quotes USDG and WETH cycles at the same fixed block. WETH amounts are derived from the existing
   USDG risk grid using that block's WETH/USDG mark; screens remain non-authoritative.
4. After a board trigger, one process exact-simulates all admitted candidates at one current block. USDG gas is marked
   upward into USDG; WETH gas is already denominated in wei. WETH net is normalized downward into USDG only for ranking.
5. The process signs exactly one candidate: the greatest conservative normalized net profit. Its on-chain `minProfit`
   remains denominated in the selected executor's base asset and covers worst-case Gas plus the common USDG net floor.
6. Both lanes share one wallet lock, nonce baseline, raw-before-broadcast journal, UNKNOWN barrier, and durable
   until-revoked authorization. Legacy fixed and generic watcher services conflict with dual-v3 at both systemd and
   runtime boundaries.
7. Spendable principal starts at the arm-time balance and adds only each receipt-reconciled execution's gross base-asset
   profit, up to the immutable cap. The current contract balance is checked for sufficiency but never grants authority,
   so an external top-up is not adopted until a new authorization is created.
8. Confirmed execution, attempt, and exact-preflight counts are unlimited only when explicitly configured as
   `unlimited`. The cumulative failed-Gas breaker, ETH reserve, exact net floor, deadline, bytecode identity, nonce,
   revocation, and receipt reconciliation remain finite fail-closed gates.

## Consequences

- WETH-native opportunities no longer pay an unnecessary terminal USDG conversion solely for accounting.
- Direct comparison is conservative and causal because every exact candidate shares one block and one price mark.
- There is still one signing process, not two bots or an external scheduler. The Linux service loops continuously until
  durable disarm or a breaker stops it.
- Two contracts and two ledgers increase verification work. A successful test or board quote is not deployment,
  runtime, trade, or profit evidence.
- WETH deployment seed and Gas both consume wallet ETH. Production promotion therefore requires a fresh balance, gas,
  nonce, current-board, and constructor preflight before any broadcast.

Production verification, including the WETH deployment receipt, active authorization and zero-usage readback, is
recorded in
[the dual-v3 bounded-dashboard promotion evidence](../evidence/2026-09-08-dual-v3-bounded-dashboard-production-promotion.md).
