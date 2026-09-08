# Story: distinguish an idle watcher from an inactive watcher

## Outcome

As the live operator, I want dual-watcher status to prove that it is consuming current signer-free board generations
even when none contains a screened-positive candidate, without presenting observation as execution or profit.

## Acceptance criteria

- A valid schema-v5 execution feed with zero candidates is a successful local read, not an availability error.
- `processedBoardGenerations` advances once for every distinct observed feed generation.
- `screenedPositiveBoardGenerations` advances only when that new generation contains at least one typed proxy-positive
  candidate.
- Status exposes the last observed generation and candidate count.
- An empty generation records `NO_SCREENED_OPPORTUNITY` and performs no execution RPC, exact preflight, signature or
  broadcast.
- Invalid identity, unsafe permissions, malformed JSON and stale or malformed candidate data remain fail-closed.

## Non-goals

- No change to opportunity screening, exact comparison, principal, profit floors, Gas reserve or authorization.
- No inference that an observed generation was profitable or that a candidate would have won ordering.
