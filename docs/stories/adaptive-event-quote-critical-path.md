# Story S23: adaptive event-quote critical path

## User outcome

As the live operator, I want relevant events screened quickly without paying for a second size when the first complete
quote has no gross edge, while USDG/WETH coverage and every execution safety gate remain intact.

## Acceptance criteria

- An event cycle does not rebuild the full dependency index or publish the full board before its fixed-block quote.
- A previously non-actionable lane quotes the smallest event amount first.
- A positive-gross or incomplete first result expands to the remaining bounded amount.
- A previously gross- or net-positive lane retains its prior winner and smallest probe.
- USDG and WETH event lanes start concurrently against the same fixed block.
- USDG remains required; WETH failure remains visible but cannot suppress a valid USDG result or weaken a USDG
  failure.
- Daily candidate/call caps, provider fallback, fixed-block evidence and every signer/executor gate are unchanged.
- Runtime evidence separates public poll, pre-fixed-block, fixed-block, candidate quote and post-quote durations.
- Managed operation telemetry identifies only safe operation classes and never persists endpoint URLs or calldata.
- Unit tests verify staged amount behavior, incomplete-evidence expansion, concurrent start, required-lane failure and
  optional-lane degradation.

## Production acceptance

- The reviewed artifact passes repository and Linux release gates.
- Only the signer-free board restarts; signer PID, release, restart count and authorization stay unchanged.
- At least three natural managed event cycles complete without HTTP failure, public fallback, persistence divergence or
  execution-feed corruption.
- Before/after reporting includes logical calls per event and phase/operation latency; a short sample is labelled as
  observation, not a durable performance guarantee.
- Paid-RPC capacity is not expanded without canonical positive active-strategy receipt net after Gas and provider cost.

## Out of scope

- Contract, signer, capital, route-shape, hook, profit-floor or authorization changes.
- Moving discovery/backfill/periodic coverage onto ChainStack.
- Unbounded concurrency, request racing or automatic paid-tier expansion.
