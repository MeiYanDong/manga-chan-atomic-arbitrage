# Coalesced event-snapshot local validation — 2026-09-10

## Outcome

Version `0.9.1` keeps execution-relevant event transitions immediate while coalescing ordinary negative/unknown event
refreshes into the next mandatory periodic board projection. It also removes the redundant periodic pre-quote
`SCANNING` publication and adds publication phase telemetry.

This is local/repository evidence only. It does not prove production installation, natural-event throughput, loopback
responsiveness, an executable opportunity, a receipt or profit.

## Verified policy boundary

- A periodic cycle always selects `PERIODIC_FINAL`.
- An event that already produced a positive checkpoint selects `REUSE_POSITIVE_CHECKPOINT`.
- A non-positive/unknown event whose candidate was in the prior execution feed selects
  `EVENT_EXECUTION_FEED_CLEAR`.
- A candidate whose durable economic episode is still open selects `EVENT_EPISODE_RECONCILIATION`, even when its
  signer-feed quote already aged out.
- Every other event selects `DEFER_NON_MATERIAL_EVENT` and writes only the small runtime checkpoint.
- Top-level and WETH-only positive lanes both count as execution-feed membership; stale and non-positive rows do not.
- Startup membership is recovered from the actual persisted execution feed, and every later feed write updates the
  in-memory membership from the exact compact projection returned by that write.
- The periodic dependency index still refreshes before its fixed block, but there is no full `publish` in that
  pre-quote segment.
- Full publication remains atomic and retains its existing compatibility-snapshot-before-compact-feed order.

## Test evidence

Focused Prettier, ESLint, checked-JavaScript types and 59 scheduler, board and signer-isolation tests passed during
implementation. The complete local `npm run check` then passed formatting, all linters, checked-JavaScript types,
dashboard build, all three compiler paths, 238 Node tests, three deterministic contract suites and a 259-file
secret/privacy scan. Linux artifact verification, production promotion and the natural observation window remain
release gates and must not be inferred from this file.
