# Universal live memory hotfix local validation

Date: 2026-09-14

## Production rejection that triggered the hotfix

The first v7 live start completed identity checks and printed `DUAL_WATCH_RUNNING`, then its global startup child hit
the unchanged 512 MiB service cgroup twice. Kernel evidence identified
`/system.slice/manga-dual-watcher.service`, with the second attempt peaking at exactly 512 MiB. Systemd restarted the
service as configured; the operator then stopped the loop before the third attempt could repeat it.

The shared reconciler subsequently reported `CLEAN`, `signedAttempts=0`, failed Gas `=0` and
`unresolvedMutation=null`. No transaction or economic result is attributed to either killed process.

## Root cause and scope

`scripts/global-arb.mjs` statically imported the compiler module. Every filtered Sequencer and periodic wake therefore
loaded Solc and recompiled the unchanged executor before building and quoting the unified graph. The main watcher and
child share one cgroup, so the compiler stayed on the critical path and consumed the signer's memory budget.

The hotfix moves immutable materialization and artifact validation into a lightweight runtime module. The mandatory
release build writes a deterministic artifact; live, reconciliation and fork paths load it and independently recompute
the source, creation-bytecode and runtime-template hashes. Contract source, bytecode, authorization and economic
thresholds are unchanged.

## Local evidence

On the same macOS validation host, `/usr/bin/time -l` measured:

- lightweight `global-arb.mjs status`: 81,608,704-byte maximum RSS; and
- importing the Solc compiler module alone: 231,424,000-byte maximum RSS.

This is an import-boundary comparison, not a production capacity claim. The release must still prove a completed live
global wake below the unchanged 512 MiB Linux cgroup before promotion is considered complete.

`npm run check` passed:

- format, ESLint, Solhint, shell syntax, TypeScript and UI build: passed;
- Node tests: 328 passed, 0 failed;
- all four deterministic contract suites: passed;
- compiler output and generated artifact hashes: passed; and
- secret scan: 373 files passed.

The regression suite also proves that global live and fork scripts load the artifact rather than statically importing
the compiler module, and that a tampered artifact fails its recomputed hash gate.
