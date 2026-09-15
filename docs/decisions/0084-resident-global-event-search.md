# ADR 0084: Start Global event search in a bounded resident read-only worker

## Status

Accepted on 2026-09-15.

## Context

The shared watcher previously queued every Global event behind the serial Earn/Global execution scheduler and then
started a fresh `global-arb.mjs` process. One production lifecycle waited about 216 seconds before Global preflight
started. When many dynamic settlement assets were admitted, route construction added about 42 seconds because every
settlement materialized its whole bounded cycle universe even though an event could quote only eight affected routes.

The production host has 2 GiB provisioned memory, about 1.6 GiB visible guest memory, no swap and several co-resident
services. Retaining every route for every possible settlement asset would trade latency for an unsafe resident-memory
increase. The single wallet/nonce owner and the existing final live gates must remain unchanged.

## Decision

- Start one resident Global event-search child with the unified watcher. It receives bounded JSON-line requests and
  begins read-only preflight directly from the Sequencer Feed callback, independently of the serial strategy scheduler.
- Remove every signing credential, authorization reference and live-arm variable from the child environment, force an
  empty config-file fallback, remove managed HTTP/WSS endpoints, and cap its V8 heap at 128 MiB. The worker has no
  mutation command and invokes preflight with persistence disabled. It uses the official public reader only, so it
  cannot race the signer's durable paid-RPC budget file.
- Keep one request in flight. Events arriving while it is busy are merged by pool, asset, sequence and source time;
  the latest dependency union is dispatched next.
- Cache only the canonical catalog-derived graph by catalog identity. Dynamic funding, quote and simulation evidence
  remains fixed-block and is reacquired for each request. The worker treats a missing or six-hour-stale catalog as
  unavailable instead of refreshing it itself; the legacy Global child remains the only catalog writer, and the
  affected wake falls back to that child.
- During an event traversal, count the same complete bounded cycle universe but materialize only the eight best cycles
  touched by the event dependencies. Periodic recovery retains the existing full rotating workset.
- A complete-evidence negative worker result may replace the duplicate queued preflight only when no uncovered legacy
  signal was merged. RPC/state-unavailable results return to the prior managed-capable path.
  A positive result is never executable authority: it returns to the existing Global execution child, which repeats
  deployment, current state, exact quote, Gas, balance, nonce, simulation, authorization, signing and receipt checks.
- A malformed response, crash, timeout or output-bound violation degrades only the worker request. The supervisor
  restarts it and sends that signal through the previous bounded Global child path.

## Consequences

Market search can overlap a slow Earn call while signing remains serial. Event-route memory is bounded by the selected
workset instead of every matching cycle, and the local representative catalog shows roughly a 4.3x traversal speedup
for both USDG and WETH event roots.

This is not yet a complete canonical pool-state service. V3 ticks, V4 hook state and all Earn dynamic state are still
read on demand, periodic recovery still uses a one-shot child, and the worker remains a child of the credential-bearing
service even though its environment and entrypoint expose no signing path. A separate least-privilege service and
replayable state journal remain later hardening work.
