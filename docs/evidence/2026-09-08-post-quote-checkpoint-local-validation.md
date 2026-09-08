# Post-quote execution-feed checkpoint local validation

- Date: 2026-09-08 (Asia/Shanghai)
- Production mutation during this validation: none
- Active production release during diagnosis: `4c1a53f80dca0afd4d1cc44b1961d89d6a458981`
- Local verdict: accepted for reviewed promotion; production verification pending

## Observed production input

The signer-free production event ledger recorded a NIGGA USDG screen with quote timestamp
`2026-09-08T08:42:59.997Z` and publication timestamp `08:45:38.173Z`. Its proxy net was `0.003539 USDG` on a
`10 USDG` `GOOGL -> NIGGA -> GME` route. The 158.176-second quote age exceeded the dual watcher's 30-second horizon,
and the proxy net independently remained below the `0.1 USDG` authorization floor. Watcher usage and wallet nonce did
not change. This is a latency observation, not evidence of missed executable profit.

## Change boundary

- `src/opportunity-board.mjs` counts each just-quoted candidate once when either base lane is proxy-positive.
- `scripts/opportunity-board.mjs` publishes the existing compact, signer-free projection immediately after such a
  batch and before launch/source/chain catalog maintenance.
- Batches without a positive observation perform no extra checkpoint write.
- Telemetry reports checkpoint count, timestamp and just-quoted positive-candidate count.
- Watcher freshness, typed candidate parsing, `0.1 USDG` screened and exact floors, PoolKey/attestation requirements,
  authorization, nonce, Gas, receipt and UNKNOWN gates are unchanged.

## Verification

`npm run check` passed locally:

```text
format=passed
eslint/solhint/bash syntax=passed
checked JavaScript types=passed
Vite production build=passed
Solidity compilation=passed
Node tests=181 passed / 0 failed
fixed-route deterministic Cancun suite=passed
generic USDG deterministic Cancun suite=passed
WETH deterministic Cancun suite=passed
secret/privacy scan=189 files passed
```

The business assertions prove that a valid dual-base projection remains admissible at `29.999` seconds and fails at
`30.001` seconds, and that one candidate with both positive lanes still creates only one checkpoint decision. Local
macOS cannot run `systemd-analyze`; Linux unit verification, release-host gates, live checkpoint timing and watcher
readback remain required before the change is called production-verified.

## Related design

- [Story: publish a positive quote before maintenance can age it out](../stories/post-quote-execution-checkpoint.md)
- [ADR 0022: post-quote execution-feed checkpoint](../decisions/0022-post-quote-execution-feed-checkpoint.md)
