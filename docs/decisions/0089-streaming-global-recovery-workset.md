# ADR 0089: Stream the Global recovery workset before exact quoting

## Status

Accepted for implementation on 2026-09-15.

## Context

The first v0.17.3 production gate proved that catalog discovery was no longer inside the Global live child, but the
cache-only recovery search still needed 59,709 ms. Route selection began after 3,343 ms and completed after 47,468 ms:
the process materialized, hashed and sorted 43,104 bounded cycles across eight settlement roots before retaining 32.
Only 12,241 ms remained for 272 coarse quotes. This barely fit the deliberate 60-second child deadline and left no
credible latency margin for a transient provider slowdown or a profitable event race.

Increasing the child deadline would keep the shared signer unavailable for longer and would not make a stale quote
more executable. Reducing the four-hop bound would hide valid topology. Calling 43,104 routes “searched” after quoting
only 32 would also overstate evidence.

The same release promotion exposed a separate bootstrap flaw: invoking the old release's installer cannot copy a new
systemd unit that exists only in the candidate archive.

## Decision

- Traverse the complete bounded simple-token/simple-pool cycle universe with mutable backtracking state. Continue
  counting every cycle and visited edge, and retain the existing 20,000-cycle-per-root fail-closed bound.
- On periodic recovery, maintain a deterministic reservoir seeded by the fixed block and settlement asset. Retain no
  more than the authorized per-wake route count per settlement before the existing cross-settlement fair budget.
- Materialize and hash only routes that enter or replace a reservoir slot. Report total, retained and materialized
  counts separately, plus the explicit `DETERMINISTIC_STREAMING_RESERVOIR_V1` selection policy.
- Preserve the dependency-ranked event selector and four-hop coverage; only its traversal allocation pattern changes.
- Do not call a retained sample complete quote coverage. `COMPLETE_BOUNDED_TOPOLOGY_TRAVERSAL` means the topology was
  counted completely; quote and funding coverage remain separate evidence fields.
- Promote a full release through `bootstrap-release.sh`, which verifies the archive SHA-256 and executes the candidate
  archive's own syntax-checked installer. The old `current` symlink is not a deployment source of truth.

## Consequences

The hot path avoids tens of thousands of cycle objects, Keccak operations and a full-route sort while retaining the
same topology and execution gates. A fixed block produces a reproducible sample; later recovery blocks rotate the
sample. Selection is bounded and probabilistic rather than a promise that every route is quoted on every wake.

This does not solve partial public-RPC catalog evidence, add atomic funding, mirror AMM state locally or prove any
profitable trade. Exact current-block quote, Gas, minimum net profit, balance, nonce, simulation, signed-raw,
submission and canonical receipt gates remain unchanged.

## Rollback

Revoke the live watcher, reconcile the shared nonce lane, stop the watcher, restore the preceding immutable release and
restart only after its complete runtime gate. The catalog timer and read-only board may remain running. Never work
around a failed candidate installer by copying selected files from an unverified archive.
