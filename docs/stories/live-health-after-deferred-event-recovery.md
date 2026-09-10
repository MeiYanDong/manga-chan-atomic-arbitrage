# Story S27: live health after deferred event recovery

## User outcome

As the live operator, I want the service health signal to recover as soon as the board completes a successful event
cycle, without restoring expensive full-snapshot writes for routine events.

## Acceptance criteria

- Startup remains not ready until at least one cycle completes.
- `RUNNING` and intentional `SCANNING` runtime outcomes are health-ready.
- `DEGRADED` and partial-catalog outcomes are not ready.
- A successful deferred event updates live health only after its runtime checkpoint persists.
- The persisted full snapshot remains unchanged until an existing material or periodic publication boundary.
- Stale-cycle and unhealthy/mismatched SQLite conditions continue to force HTTP 503.
- The loopback health response identifies live and persisted statuses; the user-facing dashboard gains no raw fields.
- Unit and static tests cover the status policy, deferred transition and endpoint wiring.
- The complete repository gate and independent Linux artifact gate pass before a board-only production restart.

## Production acceptance

- Exact merged archive hashes match locally and on the server.
- Only the signer-free board restarts; signer PID, release, authorization usage and economic limits do not change.
- Health, metrics and overview remain responsive across natural event and periodic work.
- If a natural event error occurs during the bounded observation window, `/healthz` returns 503 for that error and
  returns 200 after the next successful deferred event without requiring another periodic full publication.
- Absence of a natural error is reported as an unexercised production branch, not simulated or inferred.

## Out of scope

- Inducing a production RPC error.
- Changing the economic snapshot, signer feed or event-ledger durability policy.
- Incremental SQLite, worker threads, provider-budget expansion or any trading-policy change.
