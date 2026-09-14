# ADR-0079: Keep Solidity compilation out of the live signer process

Status: accepted

Date: 2026-09-15

## Context

The v0.16.8 containment canary proved that the unified watcher remained close to its 512 MiB cgroup limit even after
removing npm wrappers and bounding V8. Process-level evidence showed the single supervisor at roughly 495 MiB RSS
after its first exact child timed out. The supervisor statically imported the Generic, WETH and Universal Solidity
compiler modules and recompiled all three contracts during deployment verification. That made `solc` part of the
permanent live signing process even though contract source and bytecode are immutable within a release.

## Decision

- Compile the Generic, WETH and Universal executors only in the CI/release build.
- Persist release-local artifacts containing ABI, bytecode, compiler policy, byte lengths and source/code hashes.
- At runtime, reload the small artifacts and independently recompute source, bundle and bytecode hashes before using
  them for deployment identity, simulation, event decoding or signing.
- Keep dynamic compiler imports only behind the explicit `compile` CLI command; the watcher import graph contains no
  Solidity compiler.
- Continue verifying deployed runtime code, operator/protocol identity, ledger commitments and every existing live
  safety gate on chain.

## Consequences

The live signer no longer recompiles immutable code or retains the compiler heap. Artifact corruption and a
source/artifact mismatch fail closed before a signer is loaded. The release build remains the only place that pays the
compiler cost, and CI preserves deterministic contract tests. This completes the immediate signer-slimming portion of
the architecture plan; resident canonical state and graph workers remain a later performance phase.
