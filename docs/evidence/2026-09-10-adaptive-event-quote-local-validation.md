# Adaptive event-quote local validation — 2026-09-10

## Outcome

Version `0.8.8` shortens the read-only event critical path without changing transaction authority. It omits the stale
pre-quote full-board publication, stages the second amount behind gross/incomplete evidence, runs USDG and WETH event
lanes concurrently at one fixed block, and exposes phase plus operation-class latency.

This is repository/local evidence. It does not prove the release is installed in production, that a natural event is
faster, that an exact preflight succeeds or that any transaction earns profit.

## Baseline evidence

The pre-change production board was healthy on release `6f3418340f91d2da62ef5d97ec50a38be2642e09`. At the
`2026-09-10T12:55Z` readback it had admitted 151 managed event candidates and consumed 2,872 logical calls, with zero
HTTP failures or public fallbacks. The latest end-to-end result was 22,899 ms, the managed transport was 17.05 ms p50
and 5,542.27 ms p95, and 288 candidates remained queued. The active strategy still had no confirmed execution and zero
realized net; this performance work therefore does not authorize a quota increase.

## Test evidence

The final local `npm run check` passed Prettier, ESLint, Solhint, shell syntax, checked-JS type analysis, the production
dashboard build, all three Solidity compilations, all 235 Node tests, all three deterministic Cancun contract suites
and a 247-file secret/privacy scan. Linux-only `systemd-analyze` was unavailable locally and remains a server gate.
New assertions prove:

- a complete zero/negative gross probe suppresses the deferred amount;
- positive gross or incomplete evidence expands it;
- a prior actionable amount remains in the immediate bounded set;
- required and optional lanes start concurrently;
- optional failure is returned as data while required failure remains terminal; and
- operation classification omits calldata and emits only method/contract-class labels.

Linux artifact gates, production board-only promotion and natural-event readback remain pending at this point and must
not be inferred from this file.
