# Earn onchain catalog hotfix local validation

- Date: 2026-09-14 (Asia/Shanghai)
- Candidate: `0.13.1`
- Mutation boundary: no signature or broadcast occurred during this validation

## Production incident reproduced

The v0.13.0 signer started under its fresh v5 authorization, then exited fail closed before any attempt with
`EarnOnHood pool catalog returned HTTP 403`. Direct production-host inspection showed `cf-mitigated: challenge`; disk
had 28 GiB free, the wallet nonce was converged and the mutation ledger had no unresolved transaction. The failure was
therefore the website discovery dependency, not an economic rejection or chain mutation.

## Replacement source

At Robinhood Chain block `62123358`, the canonical Factory read returned 30 pools. Adding the one explicitly reviewed
pre-factory pool produced exactly the same 31-address set as the then-current official application catalog. Fixed-block
onchain reads produced:

| Evidence                | Count |
| ----------------------- | ----: |
| Factory pools           |    30 |
| Reviewed legacy pools   |     1 |
| Eligible weighted pools |    31 |
| Rejected pools          |     0 |
| Two-hop WETH cycles     |   134 |
| Three-hop WETH cycles   | 1,070 |
| Four-hop WETH cycles    | 6,382 |
| Total structural cycles | 7,586 |

The catalog source was `CANONICAL_FACTORY_AND_POOL_STATE_ONCHAIN`. A deterministic fixture with no AI or MOO still
found a WETH/PONS/WETH cycle. Paused pools and inconsistent weight sums were quarantined. After replacing sequential
pool calls with bounded, code-hash-pinned Multicall3 reads, a live fixed-block catalog load on the official public RPC
completed in 6.429 seconds.

## Quality gate

`npm run check` passed through formatting, JavaScript/Solidity/shell lint, checked-JavaScript type analysis, UI build,
three unchanged contract compilations, 303 Node tests, and all three deterministic contract suites. macOS explicitly
skipped Linux-only `systemd-analyze`; GitHub CI and production Ubuntu must run that check. A repeated contract gate and
the secret scan passed, with 347 files scanned.

## Remaining production gate

This record does not claim deployment, a running v6 watcher, a current positive quote or profit. Production requires
CI success, immutable release installation, v5 revocation/reconcile, v6 arm, service/cwd/release readback, and a natural
receipt before any new profit claim.
