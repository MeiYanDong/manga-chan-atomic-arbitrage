# Earn sizing refinement local and historical validation

- Date: 2026-09-12 (Asia/Shanghai)
- Scope: repository candidate `0.12.0`; no production deployment or chain mutation
- Algorithm: `BALANCE_SCALED_BRACKET_REFINEMENT_V1`
- Historical replay block: Robinhood Chain `61151311`
- Replayed route: `WETH_AI_WETH_LONG_STOCK`

## Deterministic gates

`npm run check` passed locally:

- Prettier formatting;
- JavaScript, Solidity and shell lint;
- checked-JavaScript type analysis;
- production dashboard build;
- all three Solidity compilations with unchanged source hashes;
- 270 Node tests;
- all three deterministic Cancun contract suites; and
- a 306-file repository secret scan.

The macOS host explicitly skipped Linux-only `systemd-analyze verify`; the immutable Ubuntu release gate remains a
production prerequisite.

New tests prove:

- eight coarse balance-scaled probes still reach the complete spendable principal;
- six refinements stay inside the successful neighbours of each route's coarse winner;
- a managed bracket is clipped when the current spendable balance falls;
- a targeted managed stage never exceeds nine exact quotes;
- v4 authorization rejects an unknown sizing algorithm, an out-of-range probe count or either mismatched quote ceiling;
  and
- both systemd units bind the one-second event interval and exact `8 + 6` sizing values.

## Fixed-block counterfactual

The official public RPC could not serve the historical `eth_call` state and returned a pruned-state/metadata error. A
bounded read-only replay therefore ran on the production host through its existing managed execution provider without
printing the endpoint. It made no signing, broadcast or state-changing call.

At block `61151311`, using the documented pre-trade spendable balance `0.002523909777810176 ETH`:

| Search                                        | Exact quotes for this route |                 Best input |          Best quoted gross |
| --------------------------------------------- | --------------------------: | -------------------------: | -------------------------: |
| Previous 24-point quadratic grid              |                          24 | `0.001581825398940058 ETH` | `0.000070187598841808 ETH` |
| New 8-point coarse + 6-point local refinement |                          14 | `0.001661949518870540 ETH` | `0.000070193505331686 ETH` |

The new bounded search used 41.7% fewer route quotes and found `0.000000005906489878 ETH` more gross output. The small
uplift shows that the previous successful input was already close to the route optimum; it does not justify claiming a
material historical missed profit. Gas was not recomputed because the route shape was unchanged and this replay's
purpose was sizing comparison. Production still performs exact Gas and protected-net checks.

Across the current four-route book, the public exact-quote ceiling falls from 96 to 56. If the public screen is
positive, the managed exact stage falls from another 96-route rescan to at most nine current-block quotes on the exact
committed winner and its immediate public bracket. The final latest-block quote, call and Gas estimate are unchanged.

## Evidence boundary

This result proves deterministic behavior and one historical fixed-block counterfactual. It is not current opportunity
evidence, production activation, a transaction receipt, realized profit, opportunity frequency or sequencer advantage.
Production installation, fresh v4 authorization, one-second event observation and natural positive-wake behavior remain
separate gates.
