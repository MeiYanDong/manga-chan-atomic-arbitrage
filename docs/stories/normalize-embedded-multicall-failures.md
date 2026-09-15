# Story: embedded transport failures reach the aggregate retry gate

## Outcome

As the live operator, I need a public-RPC throttle represented by viem as an all-failure Multicall array to follow the
same bounded retry policy as a thrown throttle, without retrying business reverts.

## Acceptance criteria

- result count and order are validated before classification;
- only an all-failure, all-transient array is normalized;
- a mixed array is preserved and not aggregate-retried;
- an all-invariant array is preserved and not aggregate-retried;
- one normalized batch increments requests, retries, transient failures and embedded-batch evidence consistently;
- schema-v4 rejects impossible embedded-batch counts;
- raw errors, URLs, request bodies and calldata do not enter persisted catalog evidence;
- local tests, official-public read-only probe, CI, release and shared-host production readback pass;
- no signing process starts before clean reconciliation and preflight.

## Non-goals

- no direct per-subcall retry;
- no paid-provider fallback;
- no capital, Gas, route, submission or profit-policy change.
