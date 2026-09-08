# Story: keep the live radar bounded as discovery history grows

## Outcome

As the live operator, I want the dashboard and autonomous watcher to remain available when source history grows, while
keeping source discovery, quoted candidates and executed profit as distinct evidence levels.

## Acceptance criteria

- `/api/v1/system`, `/overview`, `/sources`, `/episodes` and `/executions` do not build an opportunity projection.
- `/api/v1/opportunities` contains only candidates admitted to the current board snapshot.
- Opportunity list rows contain semantic summaries and omit raw source facts, pools and evidence timelines.
- `/api/v1/opportunities/:id` builds full evidence for only the requested admitted candidate.
- Doppler visibility count is equivalent to the existing predicate without retaining a duplicate launch-object array.
- The production-size 39,512,656-byte catalog survives repeated control, list and detail requests with a 256 MiB V8
  old-space limit.
- Local tests assert the control/list/detail boundaries and the source-only exclusion used by production.
- Production proves a complete board generation, repeated API reads, zero additional service restarts, zero OOM events
  and a live watcher post-state.

## Non-goals

- No change to route math, amount selection, exact preflight, contract bytecode or authorization.
- No deletion, vacuum or compaction of SQLite, JSONL evidence or the schema-v4 rollback file.
- No claim that a public-RPC scan, dashboard row or healthy process is a realized profit.
