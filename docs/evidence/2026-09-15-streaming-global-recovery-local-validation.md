# Streaming Global recovery local validation — 2026-09-15

Evidence state: implementation and complete local repository gate passed; immutable release CI and production
promotion pending.

## Production trigger

- The v0.17.3 cache-only production preflight completed in 59,709 ms against a 60-second child deadline.
- Catalog graph readiness completed at +800 ms and settlement admission at +3,343 ms.
- Route selection completed at +47,468 ms after counting 43,104 cycles across eight settlement roots.
- The remaining 12,241 ms evaluated 272 coarse quotes; none had positive gross output in that observed partial-evidence
  wake. No signature, Gas spend, transaction or realized profit occurred.

## Implemented boundary

- Recovery uses one allocation-light traversal and a block-seeded deterministic reservoir instead of materializing and
  sorting the complete route set.
- The full bounded topology count, hop limit, pool/token uniqueness and overflow behavior remain independently tested.
- Runtime evidence separates complete topology traversal from retained/materialized route counts and quote coverage.
- Event selection reuses the mutable traversal while retaining its dependency-aware ordering.
- A checksum-pinned bootstrap runs the candidate release's installer so newly added systemd units are not skipped.

## Focused verification

```bash
npm test -- --test-name-pattern='recovery traversal|dependency-aware event traversal|release installer'
```

Observed result: 459 Node tests passed, including the new deterministic recovery equivalence test.

Synthetic 11,132-cycle comparison on the same graph and process:

```text
full materialization: 197 ms
streamed selection:    45 ms
retained:              32
materialized:          219
visited edges:         256,588
```

The observed local speedup was 4.4x. It is a development benchmark, not yet production latency evidence. Full checks,
GitHub receipts and exact production readback will be appended before promotion is called complete.

## Complete local gate

```bash
npm run check
```

Observed result: Prettier, ESLint, Solhint, shell syntax, TypeScript, production UI build and all four contract builds
passed; 459 Node tests and all four deterministic contract suites passed; secret scan passed across 493 files. Linux
systemd static verification was skipped locally because `systemd-analyze` is unavailable on macOS and remains a
production install gate.
