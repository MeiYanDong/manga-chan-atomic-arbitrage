# ADR 0002: managed HTTP and WSS before Sequencer Feed

- Status: Accepted
- Date: 2026-09-04

## Decision

Use targeted WSS Swap subscriptions as the primary trigger and managed HTTP RPC for exact-block reads, quote calls, simulation, nonce and receipts. Keep a periodic recovery poll. Evaluate raw Sequencer Feed only after this baseline has measured opportunity coverage and latency.

## Rationale

The Feed reports sequencer-ordered transactions; it is not a pre-sequencer public mempool and does not replace executable state. The current canary does not justify the hardware and operations cost of a full node. External stock/AI prices may be predictors but are not execution gates.

Primary references: [Robinhood Chain connecting](https://docs.robinhood.com/chain/connecting/), [sequencing model](https://docs.robinhood.com/chain/?lang=en), [full-node requirements](https://docs.robinhood.com/chain/run-a-full-node/) and the [Arbitrum Nitro whitepaper](https://docs.arbitrum.io/nitro-whitepaper.pdf).

## Consequences

- A managed provider is a production dependency.
- `header not found` is treated as state-readiness lag and preserves the opportunity revision for retry.
- Provider plan, quota, WSS behavior and regional latency must be measured rather than assumed.
