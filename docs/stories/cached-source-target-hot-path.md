# Story S24: cached source-target hot path

## User outcome

As the live operator, I want a relevant pool event to reach quoting without repeatedly reprocessing the complete source
catalog, while source attribution and every execution gate remain unchanged.

## Acceptance criteria

- The board creates its source-target index from the validated restart projection.
- PAIR, Long and Doppler source changes explicitly refresh the index.
- A hot poll reuses that index and does not call the general target-normalization path.
- Existing retained pools plus newly index-filtered facts preserve the source-target-only invariant.
- A poll with no Initialize logs performs no source-pool or ambiguity merge.
- The strategy graph accepts the same validated index without changing candidate output.
- Poll telemetry separately reports raw decode, coalescing, Initialize ingestion and route/queue time and keeps the old
  aggregate timing for consumers.
- Unit tests verify normalized-index retention, unbranded-index rejection, graph equivalence and signer isolation.
- All repository and Linux release gates pass before a board-only production restart.

## Production acceptance

- The exact reviewed archive hash matches locally and on the server.
- Only `manga-opportunity-board.service` restarts; `manga-dual-watcher.service`, its release, authorization and usage do
  not change.
- Loopback health, SQLite parity, both configured-start catalog states and both service restart counters remain healthy.
- At least one natural poll reports the split timing fields. Catch-up and steady-state samples remain separately
  labelled.
- ChainStack caps remain unchanged until canonical receipt net after Gas and provider cost establishes positive live
  economics.

## Out of scope

- Source removal policy, new source attribution, pool admission or executor support.
- Profit floors, capital limits, signer authorization, contracts or transaction broadcasting.
- Paid-RPC quota expansion or migration of broad public discovery to ChainStack.
- Claiming profit or durable latency improvement from local or short production samples.
