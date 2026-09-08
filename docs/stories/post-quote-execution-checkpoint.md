# Story: publish a positive quote before maintenance can age it out

## Outcome

As the live operator, I want a newly quoted proxy-positive route to reach the signer-free execution feed before slower
catalog maintenance can age it past the dual watcher's 30-second freshness boundary.

## Acceptance criteria

- After a quote batch completes, the board detects proxy-positive USDG or WETH observations across only that batch.
- If the batch contains a positive observation, the board atomically publishes the compact signer feed before launch,
  source-pool or chain-catalog maintenance begins.
- The checkpoint contains the same fixed-block route, arithmetic, PoolKey attestations and read-only identity as the
  normal board snapshot.
- The watcher still rejects a quote older than 30 seconds and independently rejects screened net below the authorized
  `0.05 USDG` preflight trigger; signing retains its separate `0.1 USDG` exact-net floor.
- A batch without a positive observation creates no extra checkpoint write.
- Checkpoint count, timestamp and candidate count are visible as signer-free event-engine telemetry.

## Non-goals

- No relaxation of exact preflight, profit, principal, nonce, Gas, receipt, authorization or pool-admission gates.
- No claim that a proxy-positive checkpoint is executable, won ordering or produced profit.
- No new RPC provider, signer access, broadcast path or scheduled task.
