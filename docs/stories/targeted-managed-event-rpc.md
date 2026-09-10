# Story S22: targeted managed event-quote RPC

## User outcome

As the live operator, I want the most execution-relevant pool events quoted through a measured, cost-bounded managed
RPC so short-lived edges are less likely to expire, while broad discovery remains inexpensive and every signing gate
stays unchanged.

## Acceptance criteria

- Only event wakes ranked `EXECUTOR_COMPATIBLE` or `EXECUTOR_SHAPE` may select the managed quote client.
- Shadow-only event wakes, log polling, source/PoolManager backfill and every periodic reconciliation use the public
  client.
- Managed operation requires an explicit enable flag and a distinct non-public HTTP(S) endpoint.
- The initial UTC-day caps are 200 event candidates and 4,000 logical JSON-RPC calls, persisted before provider use and
  retained across restart.
- Exhausted caps and transient managed-provider failures fall back to public read-only quoting with an explicit reason;
  EVM/business reverts do not cause provider switching.
- Managed quote requests allow at most four concurrent HTTP operations and disable hidden transport retries.
- Runtime output exposes provider role, budget remaining, request/logical counts, fallback counts and latency
  percentiles without exposing an endpoint.
- The board still contains no signer, wallet client, private key, nonce ownership or broadcast method.
- Exact preflight, final simulation, Gas/net floor, principal cap, authorization, UNKNOWN and receipt/post-state gates
  are unchanged.
- Unit tests prove priority selection, persistent UTC-day caps, non-overspend, logical batch accounting, latency
  percentiles and signer isolation.

## Expansion acceptance

A higher paid-RPC tier is a later operations decision. It requires current-strategy canonical receipts and a completed
net-profit review including Gas and provider cost. A screen, simulation, historical profit or running service is not an
expansion signal.

## Out of scope

- Moving the full catalog, backfill or periodic coverage onto ChainStack.
- Automatic paid-tier expansion, cross-provider request racing or a second signer.
- Changing the contract, supported hook/fee/tick shape, capital, profit floor, Gas budget or transaction count policy.
