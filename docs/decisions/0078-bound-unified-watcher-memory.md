# ADR-0078: Bound the unified watcher before process-level decomposition

Status: accepted

Date: 2026-09-15

## Context

The production unified watcher and each exact Earn or Global evaluator run in the same systemd cgroup. A Global
evaluator on release `v0.16.6` reached roughly 500 MiB of anonymous memory. The shared cgroup crossed its 512 MiB
ceiling, was OOM-killed repeatedly, and entered systemd start limiting. A temporary 640 MiB canary kept the watcher
alive for one minute but let the cgroup approach 628 MiB and made the 2 GiB-class shared host unresponsive. Raising
the hard limit is therefore not a safe fix.

## Decision

- Keep the existing 512 MiB hard cgroup boundary.
- Set `NODE_OPTIONS=--max-old-space-size=320` on the watcher so both the supervisor and its bounded exact children
  collect before host-derived V8 defaults can consume the cgroup.
- Add a 448 MiB `MemoryHigh` throttle as an early pressure signal.
- Execute the watcher and opportunity board with Node directly, removing one resident npm wrapper from each cgroup.
- Preserve the current serial signer, bounded child deadlines and all on-chain safety gates.

## Consequences

This contains the immediate production failure without increasing host cost or execution authority. A child that
cannot operate inside the heap cap fails through the existing typed, signer-safe degradation path; it cannot be
reported as a no-opportunity result. The longer-term architecture still moves state ingestion, graph maintenance and
exact evaluation into reusable resident workers, but that decomposition must ship behind equivalence evidence rather
than during an incident.
