# ADR 0087: Separate the Global base catalog from the rotating universe

## Status

Accepted for implementation on 2026-09-15.

## Context

The first production readback after the versioned-universe promotion showed 128 selected targets and 846 projected
pools but only 14 admitted targets and 93 admitted pools. The graph still reported 916 V4 pools and 7,198 routes, while
the round reported zero evaluated routes and `NO_EXACT_NET_OPPORTUNITY / COMPLETE`.

This was not evidence that the market had no opportunity. The catalog refresh copied the current rotating projection
into the durable base catalog and also added every projected asset to V2/V3 hub discovery. On the next rotation,
already-present PoolKeys did not count as admitted, the old rotation occupied bounded graph capacity, and thousands of
public factory reads could yield a partial catalog without any persisted completeness marker. Funding failures without
Morpho liquidity or universal-executor inventory also entered the generic error taxonomy.

## Decision

- Persist only canonical Earn topology, Earn-asset-to-settlement-hub V2/V3 discovery and the reviewed V4 bootstrap in
  `global-catalog.json`.
- Treat `global-universe.json` exclusively as a current, bounded, in-memory V4 overlay. An identical group already in a
  legacy base catalog counts as admitted exactly once and is not duplicated.
- Record a validated `COMPLETE` or `PARTIAL` read-evidence object with requested V2/V3 work and transport-failure
  counts. Do not retain provider URLs or credentialized errors.
- A read-only resident worker may consume a current partial cache but cannot refresh it or call a negative complete.
  The sole writer retries a partial catalog after five minutes rather than retaining a transient failure for six hours.
- Feed catalog completeness into Global readiness. Incomplete negative evidence cannot become a complete
  `NO_EXACT_NET_OPPORTUNITY` result.
- Type absence of Morpho liquidity and protected universal-executor inventory as `NO_ATOMIC_FUNDING`, then map it to a
  policy-filtered funding result rather than an RPC/state failure.
- Publish only compact catalog completeness and failure counts in the sanitized business API.

## Consequences

Every rotation receives the intended capacity, V2/V3 discovery remains bounded by protocol topology instead of market
catalog size, and operators can distinguish a complete negative from missing transport evidence. Exact positive routes
still pass current-block quote, funding, Gas, nonce, simulation, authorization, broadcast and receipt checks. The
change neither moves capital nor relaxes a signer or profit gate.

This does not create funding for the universal executor, guarantee Sequencer Feed coverage, or prove an opportunity
exists. It only makes the system's negative and coverage claims match the evidence it actually obtained.

## Rollback

Revoke the current authorization, stop and reconcile the shared wallet lane, restore the prior immutable release and
re-arm only after its matching catalog schema and runtime checks pass. Do not preserve projection-derived V4 pools in a
replacement base catalog.
