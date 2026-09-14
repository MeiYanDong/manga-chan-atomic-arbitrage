# ADR 0063: Bound the public-first global discovery fallback

## Status

Accepted on 2026-09-14.

## Context

The global asset graph reads substantially more state than one fixed route. The official public RPC remains the right
default for broad discovery, but Feed-driven bursts produced HTTP 429 responses after the universal lane was promoted.
Those failures created no signature, Gas loss or unresolved mutation, yet they delayed exact opportunity checks. Moving
all discovery to the managed endpoint would hide the failure at an unbounded recurring RPC cost.

## Decision

Global discovery uses one public-first transport with these boundaries:

1. concurrent JSON-RPC calls are batched on both providers, with at most 32 logical calls per HTTP request;
2. the official public endpoint is always attempted first;
3. only transport, rate-limit or a viem-proven missing batch-response item may fall back to the managed endpoint;
   deterministic EVM reverts and malformed requests remain final;
4. every managed fallback is debited by logical call count before the request and persisted by UTC day;
5. the default daily managed allowance is 20,000 logical calls, and exhaustion fails closed without signing; and
6. authorization policy v8 commits that allowance together with the executor, graph and submission policy.

Exact simulation and mutation safeguards are unchanged. The managed fallback receives the same read request, while a
signed transaction still follows the persisted-raw direct-Sequencer path and may fall back only with the identical raw.
Endpoint values and request payloads never enter the public business projection.

## Consequences

- A temporary public 429 no longer makes an otherwise valid Feed wake unusable.
- HTTP request fanout falls without pretending that batched work is fewer billable logical calls.
- Paid discovery usage has a restart-durable upper bound and a user-facing daily counter.
- Exhausting the allowance can reduce coverage for the rest of that UTC day; it cannot weaken the profit floor, spend
  Gas or create a second signer lane.
- The budget is conservative: a failed managed request still consumes its reserved logical-call allowance.
