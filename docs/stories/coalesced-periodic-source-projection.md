# Story S25: coalesced periodic source projection

## User outcome

As the live operator, I want broad source maintenance to stop freezing the private board with repeated writes of the
same large catalog, without trading away restart completeness or changing live execution authority.

## Acceptance criteria

- A protected periodic cycle captures the last durably projected source cursors before any deferred maintenance.
- Metadata refresh plus Long, Doppler, retained PoolManager and PAIR chain-catalog advancement produce one combined
  source-catalog write per successfully completed cycle.
- Hot-poll and intermediate board checkpoints retain the old source cursors until that combined projection succeeds.
- A failed runtime checkpoint restores the deferral boundary so later persistence cannot skip an unprojected range.
- An interrupted cycle can safely repeat immutable source evidence after restart.
- Unit tests assert old-cursor durability during deferral and current-cursor durability after commit.
- Static isolation tests prove every periodic source stage is deferred to one explicit commit and the board remains
  signer-free.
- Timing and write-count telemetry is available through the existing loopback read API.
- Repository and Linux release gates pass before a board-only production restart.

## Production acceptance

- The exact GitHub archive hash matches locally and on the server.
- Only `manga-opportunity-board.service` restarts. The dual signer PID, loaded release, authorization and usage remain
  unchanged, and both restart counters remain zero.
- The first completed protected periodic cycle reports one source-catalog write and one coalesced commit.
- Loopback health remains responsive after the cycle; SQLite parity and both configured-start catalog states remain
  healthy.
- Observed timings are labelled as short activation evidence, not a steady-state SLO or profit result.

## Out of scope

- Replacing the canonical JSON catalog format or moving serialization into a worker.
- Adding or removing sources, pools, strategy candidates or executor-compatible shapes.
- Changing quote breadth, economic thresholds, capital, signing authority or transaction logic.
- Increasing ChainStack caps without receipt-proven net profit after Gas and provider cost.
