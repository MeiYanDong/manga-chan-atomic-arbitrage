# Story: keep complete Global topology evidence inside the live deadline

## Outcome

As the live operator, I need broad recovery to preserve four-hop market coverage without spending nearly the whole
signer window constructing routes that cannot all be quoted in that wake.

## Acceptance criteria

- recovery traverses and counts the same bounded cycle universe as the reference full enumerator;
- simple-token and simple-pool invariants, four-hop coverage and the per-root cycle overflow guard remain unchanged;
- each settlement retains at most the configured route budget before the shared cross-settlement budget;
- a fixed block and graph produce the same selected route IDs, while another block rotates a nontrivial long tail;
- total, retained, materialized and visited-edge counts remain distinguishable in runtime evidence;
- event wakes retain dependency-count, shortest-route and opportunity-kind priority;
- no route sample is labeled complete quote coverage and partial catalog evidence remains partial;
- release installation verifies the archive checksum and runs the candidate installer rather than the old symlink;
- focused tests, full repository checks, GitHub CI, immutable release verification and production latency readback pass;
- signer recovery additionally requires clean nonce, funding, deployment, arm and process-isolation evidence;
- no signature, transaction or profit is claimed without the existing canonical receipt.

## Non-goals

- no new server, RPC subscription, capital transfer or contract deployment;
- no increase to route, quote, managed-RPC, Gas or risk budgets;
- no removal of the 60-second deadline;
- no claim that one recovery sample exhausts every economically possible amount or route.
