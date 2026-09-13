# Earn dynamic Omnipool graph local validation

- Date: 2026-09-14 (Asia/Shanghai)
- Scope: repository candidate `0.13.0`; no production deployment or chain mutation in this record
- Policy: `EARN_OMNIPOOL_DYNAMIC_WETH_SIMPLE_CYCLES_V1`
- Superseded source boundary: ADR 0059 replaces the website catalog dependency with the canonical onchain Factory;
  the recorded route counts and v0.13.0 quality result remain historical evidence.

## Current discovery read

At `2026-09-14 00:09:03` Beijing time, the official pool catalog calculated one second earlier produced:

| Stage                       | Count |
| --------------------------- | ----: |
| Valid initialized Omnipools |    31 |
| Rejected catalog rows       |     0 |
| Two-swap WETH cycles        |   134 |
| Three-swap WETH cycles      | 1,070 |
| Four-swap WETH cycles       | 6,382 |
| Total structural cycles     | 7,586 |
| Exact-quote shortlist       |    24 |
| Initial exact quote inputs  |    72 |

The shortlist retained eight routes for each hop count. These are discovery and quote-work facts, not evidence that any
route was net profitable at that block.

## Quality gate

`npm run check` passed locally:

- Prettier, ESLint, Solhint and shell syntax;
- checked-JavaScript type analysis;
- production UI build;
- all three Solidity compilations with unchanged source hashes;
- 301 Node tests;
- all three deterministic Cancun contract suites; and
- a 342-file secret scan.

The macOS host explicitly skipped Linux-only `systemd-analyze verify`; the production Ubuntu install must run that gate.
Focused dynamic-route, authorization, receipt-census and signer-isolation tests also passed 44/44.

New deterministic tests prove that a catalog containing no AI or MOO still discovers two-pool and three-pool cycles,
malformed pools are isolated, simple-route continuity and uniqueness are enforced, the shortlist is bounded and
hop-diverse, policy v5 binds the dynamic scope, and the generic receipt census does not invent ETH profit for a
non-WETH cycle.

## Evidence boundary

This record proves local behavior and a current read-only catalog topology. It does not prove production activation,
current Gas-adjusted profit, a signature, a broadcast or realized profit. Those require a separate production cutover,
fresh v5 arm, live-cycle readback and canonical receipt if a natural positive opportunity appears.
