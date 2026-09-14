# Route-specific Sequencer projection local validation

- Status: locally validated; production promotion pending
- Date: 2026-09-14 CST
- Candidate version: `v0.15.1`

## Production baseline that triggered the change

The live v0.15.0 watcher was active with PID 1893 and zero systemd restarts. Its Feed connection had no transport errors
or reconnects, but one event wake reported only a small address match while both settlement lanes still marked every
enumerated route as relevant:

| Settlement | Total routes | Routes marked relevant | Event quote limit |
| ---------- | ------------ | ---------------------- | ----------------- |
| USDG       | 5,764        | 5,764                  | 8                 |
| WETH       | 6,327        | 6,327                  | 8                 |

The active authorization had three Earn receipt-confirmed executions, zero global executions, zero failed Gas and no
unresolved mutation. This proves a route-selection defect; it does not prove that any omitted route was profitable or
that a competitor won a race.

## Implemented boundary

- Feed matching now separates shared protocol roots, exact pools/hooks, settlement hubs and non-hub assets.
- Shared protocol roots plus only WETH/USDG no longer trigger global quoting.
- The child process receives only exact pool/hook and non-hub asset dependencies, not every raw matched address.
- Event work remains capped at eight dependent routes; five-minute recovery retains bounded graph rotation.
- Authorization v10 commits the changed Feed and route-workset policy. Superseded v9 and v8 arms fail closed.
- Each preflight records route-workset size and source-to-decision latency. The public business snapshot exposes only a
  sanitized execution funnel and keeps confirmed lost races unknown.

## Local gates

`npm run check` passed with:

- Prettier, ESLint, Solhint and shell syntax checks;
- TypeScript checking and production UI build;
- deterministic compilation of all four executor generations;
- 349 unit tests;
- four deterministic contract suites, including universal inventory, Morpho flash, v2/v3, Earn and v4 outcomes; and
- secret scanning across 388 files.

The macOS host does not provide `systemd-analyze`, so the Linux unit gate reported an explicit local skip. It must pass
on the production Linux host before the signer is restarted.

## Production acceptance still required

1. GitHub `quality` must pass for the immutable commit.
2. Stop and revoke v9, verify no unresolved mutation and equal latest/pending nonce, then install the release.
3. Run Linux systemd verification and runtime identity checks.
4. Issue a fresh v10 authorization and start exactly one watcher.
5. On the first route-specific event wake, require `touchedRoutes < totalRoutes`; read back the public execution funnel,
   release identity, Feed connection, receipt counters, failed Gas and unresolved-mutation state.
