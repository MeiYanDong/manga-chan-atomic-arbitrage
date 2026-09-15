# Story: public Multicall discovery converges under shared-host throttling

## Outcome

As the live operator, I need the credential-free Global catalog to converge under ordinary shared-host public-RPC load
without switching broad discovery to the paid provider or recreating per-call fan-out.

## Acceptance criteria

- aggregates remain fixed-block, code-hash verified, sequential and bounded to 12 subcalls;
- request starts are paced by the fixed reviewed interval;
- only network, throttle and node-state-transient aggregate failures retry;
- invariant failures make exactly one attempt;
- retries use the fixed maximum attempt count and exponential delays;
- evidence records and validates policy, request, retry, transient-failure and subcall counts;
- raw endpoint, request body, calldata and provider diagnostics never persist;
- tests cover recovered transient failure, exhausted transient failure and non-retried invariant failure;
- the repository gate, GitHub CI, immutable release and production refresh all pass;
- the live watcher remains stopped until reconciliation, current authorization and bounded preflight pass.

## Non-goals

- no ChainStack quota increase;
- no capital, Gas, principal, route-count or profit-floor change;
- no inline catalog refresh inside the 60-second signer deadline;
- no inference that complete topology means a profitable opportunity.
