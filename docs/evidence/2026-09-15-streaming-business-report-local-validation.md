# Streaming business-report local validation — 2026-09-15

Evidence state: implementation validated locally; production cgroup readback pending immutable release deployment.

## Incident boundary

- Production `manga-business-report.service` recorded `Result=oom-kill` at its unchanged 128 MiB `MemoryMax`.
- The canonical input sizes observed before this change were about 23 MB for `audit.jsonl` and 3.7 MB for
  `earnonhood-audit.jsonl`.
- The live watcher and signer-free market services were independently healthy; this evidence does not classify a
  report failure as a trading failure.

## Implemented boundary

- `src/business-report-input.mjs` scans append-only JSONL through `IncrementalJsonlEventReader` and projects selected
  records before retention.
- The projection keeps failed Gas, the latest runtime wallet readback, current-authorization Global funnel counters,
  confirmed Earn effects and completed collections. It discards unrelated diagnostics and unused nested payloads.
- Source ledgers are never rewritten, truncated or deleted.
- A selected malformed record remains fail-closed. The known legacy oversized signer-free wake is streamed past under
  the existing reviewed migration rule.

## Local verification

Command:

```bash
npm run check
```

Observed result:

- Prettier, ESLint, Solhint, shell syntax, TypeScript and UI production build passed;
- systemd static verification was skipped locally because `systemd-analyze` is unavailable on macOS and remains a
  mandatory production install check;
- 455 Node tests passed, including a production-sized oversized-wake regression and compact-field projection tests;
- all four deterministic contract suites passed;
- secret scan passed across 480 files.

No production success, new transaction or new profit is claimed by this local evidence. Production acceptance still
requires the actual one-shot to finish under the 128 MiB cgroup, publish a newer sanitized snapshot, and restore the
timer/path only after that readback.
