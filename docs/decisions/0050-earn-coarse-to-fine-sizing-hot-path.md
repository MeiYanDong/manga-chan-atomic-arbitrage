# ADR 0050: authorization-bound Earn sizing refinement and targeted exact handoff

- Status: Accepted for implementation; production promotion requires separate receipt-backed evidence
- Date: 2026-09-12
- Extends: ADR 0046 and ADR 0049

## Context

The reviewed EarnOnHood keeper currently quotes 24 balance-scaled inputs for each of four routes. Every public wake
therefore makes 96 exact BatchRouter quotes. A public net-positive result causes the managed endpoint to repeat the
same complete route and amount search before the final execution checks.

The first receipt after the two-pool AI route promotion used input `0.001581825398940058 ETH`, exactly the nineteenth
point of the 24-point quadratic grid for the then-spendable balance. It proved that the bounded grid can capture an
opportunity, but not that the chosen input maximized the route's pre-state net profit or that repeating all 96 quotes on
the managed endpoint improved safety.

The reward is a shared, decaying pool-price discrepancy. Inclusion order determines the state received. The earliest
safe action remains a committed route with current-block exact quote, Gas, protected output and final call evidence.
The controllable edge in this change is preparation and decision latency, not an unproven claim about sequencer order.

## Decision

1. Use sizing algorithm `BALANCE_SCALED_BRACKET_REFINEMENT_V1`.
2. Quote eight quadratic balance-scaled points over the complete spendable principal range for every committed route.
3. For every route, select its best successful gross quote, take the adjacent successful quote amounts as a bracket,
   and quote six evenly spaced interior amounts. This bounds the public screen at `4 * (8 + 6) = 56` exact quotes.
4. Preserve one best gross Gas candidate for every represented positive route. The public stage evaluates at most four
   candidates; the managed exact stage evaluates only the best current candidate in the selected route.
5. Hand the public winner's committed route, selected amount and immediate quote-neighbour bracket to the managed
   endpoint. Re-quote both clipped bracket boundaries, the public anchor and six interior points at the managed
   endpoint's current block, for at most nine exact quotes. A changed balance can only shrink the range.
6. Keep all existing execution gates: canonical protocol and pool identity, nonce convergence, current-block exact
   quote, two protected Gas estimates, final call, final latest-block quote/call/Gas check, wallet reserve, per-attempt
   Gas ceiling, lifetime-positive Gas solvency, immutable plan/raw persistence and canonical receipt reconciliation.
7. Reduce the public reviewed-pool event poll interval from four seconds to one second. Record event receive time,
   block, transaction hash and log index before spawning the execution child. These fields are public evidence and do
   not enter signing authority.
8. Bump the shared authorization policy to v4. Its commitment includes the sizing algorithm, coarse/refinement counts,
   public/managed maximum quote counts and event interval. An existing v3 authorization cannot operate the v4 signer.

## Alternatives rejected

- Increasing the flat grid beyond 24 points improves resolution but increases latency and public RPC load.
- An analytic closed-form optimum would depend on exact weighted-pool state and rounding semantics. It remains a
  useful future seed, but exact BatchRouter quotes stay authoritative in this version.
- Reusing the public quote directly on the managed endpoint is faster but would not re-establish current-block truth.
- Dynamically switching to another route during the managed stage would recreate the full duplicate search. The next
  event can open a new Opportunity revision; the current handoff stays scoped to one public-screen winner.

## Acceptance criteria

- Pure tests prove the coarse grid reaches the complete spendable balance, refinement stays inside adjacent successful
  quote bounds, current capital clips managed candidates, and both quote counts remain bounded.
- Authorization tests reject an unknown algorithm or any mismatched sizing/quote ceiling.
- Systemd tests bind both arm and watcher units to the one-second interval and the exact `8 + 6` sizing policy.
- The full repository quality gate passes locally, on the protected GitHub branch and on the immutable Linux release
  artifact before cutover.
- Production cutover must revoke the old authorization, stop the old signer, reconcile to `CLEAN`, install the exact
  release without starting a signer, pass runtime verification, create one new v4 authorization and then start one
  signer owner.
- A process heartbeat or preflight is not profit evidence. Only a canonical receipt plus exact asset/Gas effects may
  update realized PnL.

## Consequences and remaining limits

The public quote ceiling falls from 96 to 56 per wake, and a positive screen's managed quote ceiling falls from 96 to
nine. The local bracket is materially finer than the prior flat grid around the public winner, but it remains a bounded
exact-search approximation rather than a mathematical proof of the continuous optimum. Cross-protocol route discovery,
multi-path execution and flash liquidity remain outside this authorization and require separate adapter, contract and
economic evidence.
