# ADR 0062: Load the universal contract artifact instead of Solc in the live lane

## Status

Accepted on 2026-09-14.

## Context

The universal live child imported Solc and recompiled `UniversalAtomicExecutor` on every startup, periodic recovery and
filtered Sequencer wake. On the 1.6 GiB production host, the watcher parent, compiler and unified graph reached the
watcher's 512 MiB cgroup limit. Systemd killed two startup attempts before either could sign; reconciliation proved
`signedAttempts=0`, failed Gas `=0` and no unresolved mutation.

Raising the memory ceiling would compete with the read-only board and unrelated colocated services while retaining
avoidable compiler latency in the execution path.

## Decision

`npm run compile`, which is already mandatory in CI and production installation, writes a deterministic
`artifacts/universal-atomic-executor.json`. The artifact contains the ABI, creation bytecode, runtime template,
immutable references, compiler policy and independent source/bytecode hashes.

Live deployment, quote, reconciliation and fork processes load the root-owned artifact without importing Solc. The
loader recomputes and requires:

1. the source hash from the release's Solidity source;
2. creation and runtime-template hashes from the stored bytecode;
3. exact byte lengths, compiler version, Cancun/via-IR/optimizer policy and contract identity; and
4. the concrete operator-immutable runtime check from ADR 0061.

A missing, malformed, stale or tampered artifact fails before any signer action. Solc remains in the build and
deterministic contract-test lanes only.

## Consequences

- Live opportunities do not pay compiler startup time or memory.
- The 512 MiB watcher cgroup remains unchanged instead of taking memory from the rest of the host.
- Production installation must complete `release:build`; a source-only checkout must run `npm run compile` before a
  global runtime command.
