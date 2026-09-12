# Story: run the reviewed Earn triangle continuously inside the one signer

## Outcome

As the operator, I want the receipt-proven Earn route to remain continuously eligible and use whatever principal is
currently safe and profitable, so that fixed input limits and a second signer do not suppress valid opportunities.

## Acceptance criteria

- The active authorization commits the exact Vault, BatchRouter, route book and route commitment.
- Only one persistent process owns the wallet nonce; a shared Earn child must prove its parent PID and authorization.
- Public Vault events wake reviewed pools and a bounded five-minute recovery tick remains active.
- Public screening touches no managed endpoint unless a candidate is net-positive after buffered Gas.
- The largest probe equals live wallet balance minus Gas allowance and reserve, with no fixed principal maximum.
- A positive-gross but negative-net quote returns `NO_SHOT` without signature, broadcast or an impossible final estimate.
- Worst-case attempt Gas must leave receipt-proven lifetime Earn net strictly positive.
- The final signed `minAmountOut` protects a positive net result at the exact signed Gas ceiling.
- A receipt is accepted only when route logs, canonical Gas and exact-block wallet balance delta agree.
- UNKNOWN recovery supports the Earn mutation kind and never reprices or replaces persisted signed bytes.

## Verification

- Unit tests cover dynamic maximum sizing, Gas-solvency accounting, event allowlisting, authorization/nonce usage and
  exact receipt-route decoding.
- The historical mainnet receipt is decoded into exactly three committed swaps and independently reproduces
  `0.000131868227091194 ETH` net after Gas.
- `npm run check` remains the merge gate; production runtime, authorization and any new receipt require separate
  post-deployment readback.
