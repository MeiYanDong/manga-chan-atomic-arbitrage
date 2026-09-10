# Story S26: coalesced event snapshot publication

## User outcome

As the live operator, I want one-candidate negative events to stop blocking later events with complete-board writes,
while every potentially executable entry and every signer-feed removal remains immediate and durable.

## Acceptance criteria

- Periodic cycles always end with one full durable board publication.
- A non-material event with no selected candidate in the prior execution feed and no open economic episode performs no
  full JSON or SQLite publication and records a deferral counter.
- A new screened-positive event publishes immediately and reuses that checkpoint as its final result.
- A non-positive or unknown refresh for a previously signer-visible candidate immediately publishes and clears the
  compact execution feed.
- A candidate with an open economic episode immediately publishes its new episode state even when quote aging already
  removed it from the compact signer feed.
- The periodic pre-quote `SCANNING` state performs no full publication.
- Deferred event cycles still persist hot/source cursor safety state and update live event metrics.
- Full publication reports build, episode reconciliation, compatibility JSON, compact feed, event ledger, SQLite and
  runtime-state phase durations.
- Unit tests cover all mutually exclusive publication decisions, including open-episode reconciliation, and both
  top-level and WETH-only execution-feed membership.
- Static tests prove the signer-free board uses the policy, omits pre-quote publication and keeps the execution feed
  atomic.
- Repository and Linux release gates pass before a board-only production restart.

## Production acceptance

- The GitHub archive hash matches locally and on the server.
- Only `manga-opportunity-board.service` restarts; signer PID/release/authorization/usage and both restart counters do
  not change.
- Natural non-material event cycles increase the deferral counter without increasing the full-publication counter.
- A mandatory periodic cycle advances the full-publication counter and exposes phase timing.
- Loopback responsiveness, event queue delay and poll head lag are observed across at least one periodic deadline.
- No latency sample is presented as profit or as a long-run SLO.

## Out of scope

- An incremental SQLite schema, worker-thread serialization or a separate dashboard process.
- Changing the 60-second protected reconciliation behavior or source coverage.
- Changing provider caps, quote amounts, profit floors, capital, authorization or broadcast behavior.
