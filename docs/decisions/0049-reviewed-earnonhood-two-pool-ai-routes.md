# ADR 0049: admit the reviewed two-pool AI loops to the EarnOnHood keeper

- Status: Accepted
- Date: 2026-09-12
- Extends: ADR 0046

## Context

The standing EarnOnHood keeper had two three-hop `WETH/MOO/AI/WETH` directions. A fixed-block platform-wide read-only
scan at block `61125779` found a distinct `WETH -> AI -> WETH` loop using STOCK MEMES for entry and LONG ECO for exit.
At `0.0015 WETH`, its exact BatchRouter quote remained approximately `0.00000643 ETH` positive after applying the live
15% Gas-limit and 5% fee buffers. This was a screened opportunity, not a receipt: the route was outside the committed
signing book and its edge later disappeared.

At block `61128174`, the already-authorized three-hop keeper independently settled a canonical net-positive receipt.
That transaction and later public swaps changed the shared pool balances. By block `61131055`, the best of 24
balance-scaled probes on the two-pool direction was net-negative at the live Gas cap. This confirms that the opportunity
is state-scoped and short-lived; it does not justify bypassing final quote, Gas, call or output-floor checks.

## Race thesis

- Reward source: temporary relative-price disagreement between independently weighted EarnOnHood Omnipools.
- Allocation: the edge is shared until swaps reprice the pools, but the economically useful amount decays with every
  competing swap.
- Sequencing: Robinhood Chain inclusion order determines which state a transaction receives; a Vault Swap is a wake
  signal, not the executable truth.
- Earliest safe action: pre-registered pool/token edges followed by a current-block exact quote, Gas estimate and final
  protected call inside the existing single nonce owner.
- Controllable edge: cover the lower-Gas direct AI loop and ensure each authorized route reaches bounded Gas
  evaluation. No claim is made that this guarantees capture.
- Invalidating evidence: pool identity/fee drift, non-positive protected net, insufficient Gas solvency, nonce conflict,
  unresolved mutation or a final call failure.

## Decision

1. Add both directed `WETH -> AI -> WETH` loops across STOCK MEMES and LONG ECO to the committed route book. No API-
   discovered pool or token can enter signing dynamically.
2. Keep the two existing three-hop directions and the same three reviewed pool addresses.
3. Validate every directed pool/token edge while reading each pool's initialized, paused, recovery, token-set and
   static-fee boundary only once per preflight.
4. The bounded Gas shortlist must include the best gross amount from every profitable reviewed route before using
   remaining slots for the global gross ranking. Final selection remains maximum quoted net after conservative Gas.
5. Preserve all ADR 0046 execution controls: one signer, current-block quote, final call, `minAmountOut`, wallet reserve,
   per-attempt Gas ceiling, lifetime-positive Gas solvency, durable raw transaction and canonical reconciliation.
6. The changed route commitment requires revocation of the old authorization, a clean reconciliation, exact-release
   deployment and a newly generated arm before live operation resumes.

## Consequences

- The keeper can capture either direction of the observed lower-Gas two-pool AI discrepancy when it is truly net
  positive.
- Public screening work doubles from 48 to 96 exact quotes per wake at the default 24 probe points. Gas estimation stays
  bounded at eight candidates, and pool identity reads remain bounded to three pools.
- This is a reviewed four-route book, not permissionless all-pool signing. Platform-wide discovery remains read-only
  until a separate authorization design proves how arbitrary pool admission stays bounded.
