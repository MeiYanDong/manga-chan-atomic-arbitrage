# Story: capture reviewed two-pool AI price disagreement

## Outcome

As the operator, I want the standing EarnOnHood keeper to evaluate the direct AI loop in both directions so that a
lower-Gas net-positive opportunity is not excluded merely because the original route book contained only triangles.

## Acceptance criteria

- The route commitment contains exactly two direct AI loops and the two existing AI/MOO triangles.
- Every route starts and ends in WETH, uses distinct reviewed pools, and has two or three hops.
- Pool identity validation covers every directed token edge without duplicating on-chain pool-state reads.
- A bounded Gas shortlist represents every profitable route before global fill.
- Exact quote, protected final call, Gas buffers, positive output floor, wallet reserve, nonce ownership, Gas-solvency
  fuse and receipt reconciliation are unchanged.
- The old authorization cannot execute the new release; a fresh arm is required.
- Unit, integration, contract, type, lint, formatting, UI build, secret scan and Linux systemd gates pass before
  production promotion.

## Evidence boundary

The block `61125779` quote is a screened historical sample, not realized profit. Only a canonical receipt plus exact
wallet balance and Gas reconciliation may be reported as a live gain.
