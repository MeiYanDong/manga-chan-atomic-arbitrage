# Story: broad public catalog reads stay complete without request storms

## Outcome

As the live operator, I need the complete Earn-to-hub V2/V3 topology to refresh on the official public RPC without
turning omitted batch responses into hundreds of throttled HTTP requests.

## Acceptance criteria

- every V2 pair, V3 pair-fee, discovered V2 reserve and discovered V3 liquidity read remains at one fixed block;
- the canonical Multicall3 runtime code hash is verified before its results are trusted;
- one aggregate contains at most 12 subcalls and aggregates execute sequentially;
- the catalog path uses the non-batched official public client and cannot receive a managed endpoint or signer;
- aggregate failures and failed subcalls preserve exact pair/fee identity for bounded topology retention;
- schema v4 records and validates the Multicall policy, code hash, RPC request count and logical subcall count;
- persisted failures contain only a typed class, never an endpoint, request body, calldata or raw provider message;
- malformed identity, result ordering or impossible count evidence fails closed;
- current execution still rechecks quote, Gas, balance, nonce, simulation and authorization before signing;
- local tests, a live read-only probe, GitHub CI, immutable release verification and production readback are required;
- the live signer can resume only after complete-enough topology, clean reconciliation and bounded preflight all agree.

## Non-goals

- no paid-RPC capacity increase;
- no capital, Gas, principal or profit-floor change;
- no claim that a complete catalog contains a profitable opportunity;
- no transaction or signing authority in the catalog service.
