# ADR 0035: Freeze the watcher trigger before exact preflight

## Status

Accepted and production-loaded in v0.8.6. The first post-release live positive trigger has not yet occurred, so the
new handoff branch is deployed and armed but not receipt- or attempt-verified in production.

## Context

The dual watcher first read a screened-positive candidate from the signer-free execution feed, then called the generic
`execute()` path. That path read the mutable board again for exact preflight and read it a third time after exact
simulation. A candidate hash commits to its fixed quote block, so a healthy board refresh creates a new revision even
when the route is unchanged.

Production evidence showed the failure mode twice under the current authorization: exact preflight started, but the
candidate was rejected after the board advanced to a newer projection. The rejection spent no Gas, but it converted an
eligible trigger into a false no-shot. A later board projection is not stronger execution evidence than a current-block
exact executor simulation.

## Decision

The watcher freezes the exact typed candidate revision and board generation that caused escalation. Exact preflight
consumes that frozen trigger directly instead of selecting from a newer board projection.

Before exact work, the signer still verifies:

- the frozen trigger schema, candidate hash, board timestamp and quote age;
- the canonical hash of the candidate's quoted block;
- deployment identity, authorization, unresolved-mutation state and wallet nonce;
- current executor principal, wallet Gas reserve and current Gas price;
- a current-block exact contract call and Gas estimate that meet the immutable net-profit floor; and
- immediately before signing, route boundary state plus another protected contract simulation.

The post-preflight mutable-board membership check is removed. A newer board may supersede the research projection, but
it cannot override current exact execution evidence. If the edge disappeared, exact simulation or the protected
minimum-profit calldata reverts before any economic loss other than bounded Gas.

## Consequences

- Board publication and exact execution no longer race on candidate-hash identity.
- The watcher executes the revision it logged rather than silently selecting a different candidate.
- The change does not add a pool, hook, asset, RPC endpoint, principal, signing authority or Gas budget.
- An expired trigger, non-canonical quote block, negative exact result, changed nonce, changed balance, high Gas,
  revoked authorization or dirty route boundary still fails closed.
- Receipt and canonical post-state remain the only proof of realized profit.
