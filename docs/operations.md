# Operations and cutover runbook

## Pre-deployment gate

1. Check out the exact release commit and run `npm ci --no-audit --no-fund` followed by `npm run check`. CI must execute `systemd-analyze verify` on the supplied service units; local macOS checks explicitly report that this Linux-only gate was skipped.
2. Confirm the release source hash matches `deployments/robinhood-mainnet.json`.
3. Normally provision a strategy-owned managed HTTP endpoint and WSS endpoint. The documented explicit public fallback
   is degraded outage operation, not equivalent provider quality. Do not reuse another strategy's configuration file.
4. Configure an independent HTTP reader when available. The two URLs must not alias one another.
5. Create the signer as a host-bound encrypted systemd credential. Stream the key over the encrypted administration channel into `systemd-creds`; never place it in argv, an environment variable or an intermediate plaintext file:

   ```bash
   sudo systemd-creds encrypt --name=manga-private-key - /etc/credstore.encrypted/manga-private-key
   sudo chown root:root /etc/credstore.encrypted/manga-private-key
   sudo chmod 0600 /etc/credstore.encrypted/manga-private-key
   ```

6. Transfer `state.json` and `audit.jsonl` through a private channel. They are runtime evidence, not release assets.
7. Install `deploy/sshd/60-manga-chan-arbitrage-hardening.conf` as an SSH server drop-in, validate with `sshd -t`, reload SSH, and prove a second key-only session before closing the recovery session.

## Single-writer cutover

Before a cloud arm is created:

1. stop and unload the macOS watcher;
2. disarm its authorization;
3. verify that its process and wallet lock are absent;
4. run `npm run reconcile` until the result is `CLEAN`;
5. verify `latest nonce == pending nonce` and compare it with the runtime ledger;
6. run `npm run runtime:verify` on the cloud host;
7. create a new cloud-local arm; never copy an old arm file;
8. start the service and read back systemd state, WSS/HTTP heads, source/runtime hashes, nonce, balance and authorization ID.

If any step is `UNKNOWN`, stop. Local and cloud signers must never overlap.

## UNKNOWN recovery

Run:

```bash
npm run reconcile
```

Possible outcomes:

- `RECONCILE_PENDING` or `RECONCILE_PROVISIONAL_*`: wait and run the same command again;
- `RECONCILED_SUCCESS` / `RECONCILED_REVERTED`: terminal evidence was written;
- `RECONCILE_NOT_OBSERVED`: two readers did not observe the transaction or nonce consumption;
- `RECONCILE_NONCE_CONFLICT` / `RECONCILE_CONFLICT`: keep the lane halted and investigate;
- `RECONCILE_UNKNOWN`: evidence is insufficient.

Only after `NOT_OBSERVED` may an operator explicitly run:

```bash
npm run reconcile -- --rebroadcast-same-raw
```

This sends the previously persisted bytes. It does not replace or reprice the transaction.

For a generic execution whose protected on-chain deadline has already expired, do not rebroadcast. Close it only after
the reconciler proves absence and expiry independently at both readers:

```bash
npm run generic:reconcile -- --abandon-expired
```

This appends `EXPIRED_NOT_OBSERVED` as a distinct terminal fact; it does not claim a receipt, consume a nonce or submit
a transaction. Deployment and withdrawal transactions have no comparable deadline and cannot use this path.

## Runtime verification

`npm run runtime:verify` checks:

- managed HTTP and WSS chain IDs and head distance;
- all canonical contract/token/pool targets;
- manifest, local source, runtime ledger and on-chain runtime hash;
- operator, executor balance and wallet latest/pending nonce;
- unresolved mutation state and current arm metadata.

The command is read-only. `RUNTIME_VERIFIED_READY_FOR_ARM` is not a trade or profit receipt.

## Unified Earn standing keeper

The dual arm and watcher units pin the Earn policy at their systemd command boundary. Do not start a separate
EarnOnHood service. A valid arm commits the reviewed route book, public event/recovery cadence, dynamic sizing policy,
positive net-output floor and initial receipt-proven Gas surplus.

Use the ordinary single-writer cutover. After the new arm starts, `npm run dual:watch:status` must show one live PID,
the current authorization policy, `fixedPrincipalCap: null`, a positive `earnLifetimeGasSurplusEth`, a public event
cursor and no unresolved mutation. For v4 it must also report `BALANCE_SCALED_BRACKET_REFINEMENT_V1`, the committed
`8 + 6` probe counts, public/managed quote ceilings `56/9`, and a one-second public event interval.
`EARN_NO_NET_OPPORTUNITY` is a healthy no-trade decision; it proves no signature or broadcast, not that every Earn pool
or future block lacks an opportunity.

If an Earn broadcast becomes UNKNOWN, the watcher enters `RECONCILING_UNKNOWN` itself. It freezes only the shared
wallet/nonce signer, continues the board, Earn event and Sequencer Feed read paths, and retries the typed reconciler
every five seconds. Do not stop it merely to run a manual reconciliation. If the supervisor itself is no longer alive,
or an explicit investigation requires a read-only snapshot, run:

```bash
npm run dual:reconcile
```

The dual reconciler delegates only the `earnonhood-execute` mutation to the Earn receipt verifier. It verifies the
persisted raw transaction, receipt finality, the exact committed Swap sequence, canonical Gas and exact-block wallet
delta. It never rebuilds, reprices or replaces the signed transaction.

Earn, Global, USDG and WETH are adapter names inside one supervisor and one wallet/nonce safety domain, not independent
strategy daemons. New PAIR, LONG or other protocol integrations add typed discovery/quote/execution/reconciliation
adapters to the same graph and supervisor; they do not receive a separate signer or private route budget merely because
their front-end brand differs.

The shared ordered Sequencer Feed also routes frames by adapter. An exact Earn pool match, or canonical Earn protocol
plus a non-settlement Earn asset, queues the Earn local-cycle adapter first; the same frame remains queued for Global
when it is also relevant to a cross-protocol route. All matched Earn pools are focus inputs. The event hot path reuses
the protected canonical static catalog and refreshes only fixed-block dynamic pool state; the managed signing path still
revalidates the exact selected pools and core contracts. A canonical revert quarantines only its exact route until a
newer event touches one of its pools or that route later succeeds. This quarantine does not hide failed Gas or pause
unrelated routes.

## Universal cross-protocol promotion

The universal executor is a fourth execution generation inside the existing dual watcher and single wallet nonce lane.
It admits only typed Earn and Uniswap v2/v3/v4 actions. Deployment creates code but grants no continuing authority;
current v13 arming separately binds its identity, settlement-seed and dynamic-admission policy, funding/graph/route
policy, Sequencer Feed, quote-work bounds and the managed discovery fallback's daily logical-call ceiling. Seeds receive
priority but are not an allowlist. A non-seed can settle only after fixed-block graph, decimals, funding and executable
WETH/USDG valuation checks all pass.

Before deployment:

1. merge an immutable release only after GitHub `quality` passes, then stop and durably disarm the existing dual watcher;
2. run `npm run dual:reconcile` and require no unresolved mutation plus equal latest/pending wallet nonce;
3. refresh `global-catalog.json` from public chain state and run `npm run global:fork-test` with the configured managed
   reader. The smoke must deploy the exact bytecode on a local mainnet fork and quote real Morpho, Earn and Uniswap
   state; a public-RPC timeout is not a pass;
4. run Linux `systemd-analyze verify`, `npm run global:deploy-preflight`, and inspect wallet reserve, Gas envelope and
   all three compile hashes; and
5. start the dedicated credential-bearing one-shot unit. Never copy the private key into an interactive shell.

```bash
cd /opt/manga-chan-arbitrage/current
sudo -u manga-chan-arb env \
  MANGA_CONFIG_FILE=/etc/manga-chan-arbitrage/live.env \
  MANGA_RUN_DIR=/var/lib/manga-chan-arbitrage \
  npm run global:catalog:refresh
sudo -u manga-chan-arb env \
  MANGA_CONFIG_FILE=/etc/manga-chan-arbitrage/live.env \
  MANGA_RUN_DIR=/var/lib/manga-chan-arbitrage \
  npm run global:fork-test
sudo -u manga-chan-arb env \
  MANGA_CONFIG_FILE=/etc/manga-chan-arbitrage/live.env \
  MANGA_RUN_DIR=/var/lib/manga-chan-arbitrage \
  npm run global:deploy-preflight
sudo systemctl start manga-global-deploy.service
sudo systemctl --no-pager --full status manga-global-deploy.service
```

Require `UNIVERSAL_DEPLOYMENT_CONFIRMED`, a successful canonical receipt, exact runtime hash, operator and Morpho
readback, and equal latest/pending nonce. Then run `npm run global:preflight` without a signer. A positive quote is still
not profit and a negative result must not be turned into a Gas-spending probe. Start `manga-dual-arm.service` only after
`global:status` and `dual:runtime-verify` agree on the deployed executor and no unresolved mutation. The v13 watcher may
then execute a route only after current exact simulation; accepted effects require receipt, `Executed` event and balance
delta.

Before arming, also require the board to have committed a current
`/run/manga-opportunity-board-feed/global-universe.json`. It must be a regular file, no larger than 2 MiB, readable by
the shared `manga-board` group, and not writable by group or world. Both `manga-dual-watcher.service` and
`manga-dual-arm.service` must receive the same `MANGA_GLOBAL_UNIVERSE_PATH`; otherwise the arm-time policy commitment
and runtime search universe can diverge. Missing, stale, malformed, over-bound, permission-unsafe or hash-invalid
projections fail closed to the reviewed bootstrap/base catalog and never grant execution authority.

The six-hour base catalog and the rotating projection have different lifetimes. The base catalog contains canonical
Earn topology, Earn-asset-to-USDG/WETH V2/V3 reads and only the reviewed V4 bootstrap. The current board projection is
merged in memory for that search round; never persist its assets or pools back into `global-catalog.json`. Otherwise an
old rotation can consume the next rotation's bounded capacity and can amplify V2/V3 discovery into an unbounded
long-tail RPC fanout. Every base refresh records requested-call and transport-failure counts. A malformed evidence
record is not a valid cache. Both resident discovery and the live signer child are strictly cache-only; broad factory
reads never enter their 60-second deadline. `manga-global-catalog.timer` runs the sole writer every 15 minutes as a
credential-free one-shot against the official public RPC. It receives neither `live.env`, the managed endpoint, WSS,
the private key nor a live arm. A transport-partial snapshot remains readable until replaced, but its negative results
stay evidence-partial and must not be reported as proven no-profit. A missing, malformed or six-hour-stale snapshot
degrades only Global until maintenance publishes a valid atomic replacement; it must not stop Earn or cause a search
child to refresh inline.

The catalog service has a six-minute process deadline, an exclusive `global-catalog.lock`, a 384 MiB cgroup ceiling and
shared-host CPU de-prioritization. The release installer copies only `GLOBAL_EXTRA_SETTLEMENT_ASSETS` into the separate
`catalog.env`; it never gives the service authenticated transport or signing settings. Enable and verify it alongside
the live watcher:

```bash
sudo systemctl enable --now manga-global-catalog.timer
sudo systemctl start manga-global-catalog.service
sudo systemctl --no-pager --full status manga-global-catalog.service manga-global-catalog.timer
sudo journalctl -u manga-global-catalog.service -n 30 --no-pager
```

The global route set includes both same-venue and cross-venue simple cycles. A route still must close in the same
settlement asset, use two to four distinct pools, avoid repeated intermediate assets, fit the per-wake route budget and
remain all-cost positive. Event wakes fund-check only seeds and event-touched assets; startup and five-minute recovery
rotate through up to 64 structurally eligible assets and admit at most 16. These are coverage/RPC bounds, not principal
caps. Changing them or the admission policy invalidates the current authorization and requires a clean disarm,
reconcile and re-arm.

Read `searchableRoutes` as market topology and `fundedRoutes` as the subset the universal executor can currently quote
and simulate with admitted principal. `NO_EXECUTABLE_FUNDING` means routes exist but no approved funding source was
available at that block. It does not prove that there was no price discrepancy, and it does not authorize moving
inventory from a fixed executor or another wallet. Funding changes require an explicit custody/capital decision.

Broad graph discovery uses the official public RPC first and batches at most eight concurrent reads per HTTP request,
which is the verified live `eth_call` ceiling. A transport failure, public HTTP 403/429 or
viem-proven missing batch-response item may retry only the failed logical call on the managed endpoint while the
restart-durable UTC-day budget has capacity. The default ceiling is
`GLOBAL_MANAGED_FALLBACK_DAILY_LOGICAL_CALL_CAP=20000`; changing it requires a fresh authorization. A deterministic EVM
revert or malformed request never triggers provider fallback. Budget exhaustion is a signer-free coverage degradation,
not permission to lower the profit floor or broadcast a probe.

Earn uses a separate authorization-bound fallback ledger at
`/var/lib/manga-chan-arbitrage/earn-rpc-fallback-budget.json`. The default ceiling is 40,000 logical calls per UTC day,
with 128 calls for one event wake and 192 for one recovery wake. Canonical Vault swaps are subscribed through
`MANGA_WS_URL`; reconnect replays are deduplicated by block, transaction and log index. The official public HTTP event
reader runs only every 60 seconds as a recovery backstop and never consumes managed capacity itself.

Feed filtering and route work are also authorization-bound. An exact reviewed pool/hook match may wake the event lane.
A shared protocol root is only context: it also needs a non-settlement asset, while an asset-only frame needs at least
two graph assets and one must not be a settlement hub. WETH, USDG and shared routers are removed before route scoring,
so they cannot make every route look relevant. An accepted event wake quotes at most eight dependent routes and may
consume at most 32 managed fallback calls. Startup and five-minute recovery retain broad rotating coverage but may
consume at most eight managed fallback calls per process. These per-wake limits are non-persistent because each global
child is exactly one wake; the daily counter remains persistent and is never debited when the per-wake check refuses a
request.

If deployment or execution becomes UNKNOWN, leave the watcher stopped and run `npm run global:reconcile` (or the parent
`dual:reconcile`). Reconciliation may replay only the exact persisted raw transaction. Never deploy a second universal
executor while the first deployment mutation is unresolved.

The Global event lane starts one credential-stripped resident search child before the serial signer scheduler. Its
environment has no signing authorization, managed endpoint or live arm; it uses only the official public reader and
keeps at most one request in flight. A complete negative result can suppress an identical queued read, but a positive
result is only a hint and always returns through the existing latest-block signer gates. Neither the worker nor its
bounded live fallback child writes or refreshes `global-catalog.json`; both consume the same atomic snapshot. Missing,
malformed or stale catalog evidence degrades that Global request while the dedicated maintenance timer repairs the
slow lane. A partial cache remains usable but cannot upgrade its negative result to complete evidence. Worker crash,
timeout or protocol failure degrades that request only.
The worker accepts exact dependency wakes from the shared Sequencer Feed, the already-running canonical Earn Vault WSS
subscription and the existing public Earn-log backstop. Earn events are projected as changed pool addresses and can
therefore wake same-Earn or cross-protocol routes in the unified graph. This fan-out performs no extra source request and
does not consume the managed read budget. If Sequencer Feed is unavailable, Uniswap-only changes still wait for periodic
Global recovery; do not report Earn-trigger coverage as full-chain event coverage.

## Rollback

1. disarm and stop the watcher;
2. reconcile the current wallet lane;
3. repoint `/opt/manga-chan-arbitrage/current` to the prior commit-addressed release;
4. restore the matching runtime schema/config permissions, not just source code;
5. run the prior release's compile and runtime verification;
6. issue a fresh arm only after all evidence is clean.

Never roll code backward while retaining an incompatible runtime ledger or active authorization.

## Alerts

The dual watcher separates temporary process failure from safety-terminal exits. `HALTED_RPC` uses a restartable exit;
`HALTED_UNKNOWN`, `HALTED_INVARIANT`, `HALTED_STARTUP` and `HALTED_NONCE_CONFLICT` use exit statuses listed in
`RestartPreventExitStatus` and remain fail closed.

The minimum-necessary Feishu health check runs once per minute. It pages only when an armed signer process is down,
the runtime is terminal or stale, shared execution RPC has failed three times, every discovery adapter is simultaneously
beyond its sustained-failure threshold, or asynchronous transaction reconciliation has stalled. One Earn, Global or
board adapter may enter a visible `DEGRADED` state while the others continue; that condition, a canonical route revert,
no-shot, candidate filtering and isolated RPC/child timeout stay silent. After a delivered incident it sends one recovery
when full or partial viable coverage returns. Provision its dedicated webhook independently from the business-report
webhook:

```bash
sudo systemd-creds encrypt --name=manga-critical-alert-webhook - /etc/credstore.encrypted/manga-critical-alert-webhook
sudo chown root:root /etc/credstore.encrypted/manga-critical-alert-webhook
sudo chmod 0600 /etc/credstore.encrypted/manga-critical-alert-webhook
sudo systemctl start manga-critical-health.service
sudo systemctl enable --now manga-critical-health.timer
```

Enter the webhook through encrypted standard input only. Never put it in argv, an environment file, the release or a
remote-command payload. A response code `0` from `node scripts/critical-alert.mjs test` proves delivery transport only;
the timer state and an actual health transition remain separate evidence.

For a planned production promotion, prevent a maintenance switch from becoming a user incident:

1. stop `manga-critical-health.timer` while the operator is actively supervising the cutover;
2. stop the watcher and require its runtime state to become `STOPPED_BY_SIGNAL`;
3. install and verify the immutable release, then start the watcher;
4. require the new PID, exact release cwd, current authorization and `RUNNING`/`EXECUTING` runtime state;
5. run one manual health check and require `TRADING_HEALTHY`, then start the critical timer before ending the cutover.

From v0.16.3 onward SIGTERM/SIGINT writes the maintenance state immediately, even while a bounded adapter child is
finishing. The explicit timer sequence remains the preferred production procedure because it also covers upgrades from
older releases that lack that behavior.

When Cloud Assistant performs the promotion, never rely on its 60-second default command timeout. Release installation
includes `npm ci`, the release build and an atomic symlink switch, while the first board projection can itself take more
than one minute. Set an explicit bounded timeout that covers the build, and split installation from post-start
acceptance so the latter can be polled independently. A timed-out invocation is `UNKNOWN`, not a rollback receipt:
first read the current symlink, service state and process working directories before choosing recovery or rollback.

Keep `manga-critical-health.timer` stopped across those invocation boundaries. Start the watcher, require its runtime
PID to be alive and its state to be fresh, run one manual health check, require `TRADING_HEALTHY`, and only then restore
the timer. Do not start the timer from a generic failure trap before the watcher has published its new runtime PID. The
systemd `MainPID` is currently the `npm` wrapper while `dual-watch-state.json.pid` is the Node child, so equality between
those two values is not an acceptance gate. Instead require both processes in the same service cgroup, the Node child
alive, the process working directory at the exact release and zero unexpected restarts.

The release installer compiles and verifies the code before atomically moving the `current` symlink. The hardened runtime service only reads that release and writes under `/var/lib/manga-chan-arbitrage`; it does not attempt to compile inside the read-only `/opt` tree at service start.

## Opportunity board deployment

The opportunity board is not part of the signer lane. Provision `/etc/manga-opportunity-board/live.env` from
`deploy/opportunity-board.env.example` with mode `0640 root:manga-board`. Its primary RPC remains the official/public
read-only provider. An optional `MANGA_BOARD_HOT_RPC_URL` may reuse the strategy's managed HTTP endpoint only as a
separately copied URL value for high-priority event quotes; never copy the signing strategy's complete environment.
The managed URL must remain private, distinct from the public reader and enabled explicitly. Never copy
`MANGA_PRIVATE_KEY_FILE`, a key value, WSS signing configuration or wallet material into this file.

The release fixes the initial paid-read ceilings at 200 event candidates and 4,000 logical JSON-RPC calls per UTC day.
`/api/event-metrics` reports the durable budget, provider role, public fallback and latency percentiles without exposing
the endpoint. Do not increase the private environment values alone: the systemd command boundary retains the reviewed
caps. A higher tier requires a reviewed release plus canonical active-strategy receipt net that covers Gas and provider
cost; a screen or simulation is not sufficient.

After installing the release:

```bash
sudo systemctl enable --now manga-opportunity-board.service
sudo systemctl show manga-opportunity-board.service --property=ActiveState,SubState,MainPID,MemoryCurrent,NRestarts
curl --fail --silent --show-error http://127.0.0.1:8788/healthz
sudo -u manga-board env MANGA_BOARD_RUN_DIR=/var/lib/manga-opportunity-board npm run board:status
```

For a board-only rolling promotion on a host where `manga-business-report.timer` or
`manga-business-report.path` is already enabled, stop both triggers before intentionally stopping the board. The report
unit declares `Wants=manga-opportunity-board.service`; a trigger during the install gate can otherwise start the old
symlink target, making a later `systemctl start` a no-op. After the
installer moves `current`, use an explicit board restart, verify both the process working directory and
`MANGA_RELEASE_SHA`, wait for `/healthz` to become healthy, refresh the sanitized snapshot, and only then restore the
timer:

`install-release.sh` only accepts an immutable 40-character commit identity and rebuilds type, UI, contract artifacts
and the secret scan. The full unit and deterministic contract suites belong to the required GitHub `quality` gate;
record its successful run URL before production. Do not deploy a commit whose CI receipt is missing, pending or failed.
Repeating those memory-heavy suites on the 2 GB production host can starve Nginx and the board without adding a new
merge gate.

```bash
sudo systemctl stop manga-business-report.timer
sudo systemctl stop manga-business-report.path
sudo systemctl stop manga-opportunity-board.service
sudo ./deploy/install-release.sh /path/to/release.tar.gz <40-char-commit-sha>
sudo systemctl restart manga-opportunity-board.service
# Verify /proc/<board-node-pid>/cwd and MANGA_RELEASE_SHA against the intended release.
curl --fail --silent --show-error http://127.0.0.1:8788/healthz
sudo systemctl start manga-business-report.service
sudo systemctl start manga-business-report.timer
sudo systemctl start manga-business-report.path
```

Keep the timer disabled if the release identity or health readback disagrees. A board-only promotion must not restart,
re-arm or otherwise mutate the trading watcher.

The Earn competitor census is a separate signer-free reader. It uses Robinhood's official public RPC by default,
finds the seven-day start block by timestamp, scans only the three reviewed Vault pools and publishes exact route
receipts after a five-minute delay. Start it after the immutable release is installed and before installing the Nginx
surface that aliases its public snapshot:

```bash
sudo systemctl enable --now manga-opportunity-census.service
sudo systemctl show manga-opportunity-census.service --property=ActiveState,SubState,MainPID,MemoryCurrent,NRestarts
jq '{status,summary,coverage}' /var/lib/manga-opportunity-census/public.json
```

`BACKFILLING` is a healthy partial-coverage state. It must converge to `CURRENT` at the safe head; until then, all
counts apply only to `startBlock..scannedThroughBlock`. The service has no EnvironmentFile or credential directory and
must never be added to the signer group. Stop it independently during a board build if the shared-host resource gate
requires headroom; stopping it cannot stop or authorize the live watcher.

The Node HTTP service deliberately listens only on loopback. Public presentation access terminates at the reviewed
Nginx port-80 proxy; never bind the Node process itself to a public address and never open port 8788 in the cloud
firewall. The supplied SSH drop-in continues to permit client-local forwarding to `127.0.0.1:8788`; validate it with
`sshd -t`, reload SSH, and prove a fresh key-only session before relying on the tunnel. Runtime evidence is stored in
`/var/lib/manga-opportunity-board/snapshot.json`, `events.jsonl`, `state.json`, `chain-catalog.json`,
`source-catalog.json`, `board.sqlite`, `evidence.jsonl` and `pool-mirror.json`; none belongs in Git. Chain/source catalogs
are complete only from their recorded configured start blocks. The mirror contains event state, not a quote or
execution instruction. Keep the directory when rolling between SQLite and the legacy reader; the rollback flag never
deletes the append-only ledger.

On Ubuntu hosts where `ssh.socket` owns port 22, install both reviewed port files. Port 2222 is an SSH transport, never
the dashboard listener, and its cloud firewall rule must be limited to the operator's current `/32` CIDR:

```bash
sudo install -o root -g root -m 0644 \
  deploy/sshd/61-dashboard-tunnel-port.conf \
  /etc/ssh/sshd_config.d/61-dashboard-tunnel-port.conf
sudo install -d -o root -g root -m 0755 /etc/systemd/system/ssh.socket.d
sudo install -o root -g root -m 0644 \
  deploy/systemd/ssh.socket.d/61-dashboard-tunnel-port.conf \
  /etc/systemd/system/ssh.socket.d/61-dashboard-tunnel-port.conf
sudo sshd -t
sudo systemctl daemon-reload
sudo systemctl stop ssh.service
sudo systemctl restart ssh.socket
sudo systemctl start ssh.service
```

Keep the cloud recovery channel available while changing the listener. Verify key-only authentication on 2222 before
starting `ssh -N -L 127.0.0.1:18788:127.0.0.1:8788 -p 2222 <production-host>`. Never open 8788 in the cloud firewall.

For the public, read-only presentation surface, install Nginx and the reviewed server block from the exact release:

```bash
sudo apt-get update
sudo apt-get install -y nginx
sudo ./deploy/install-public-dashboard.sh deploy/nginx/manga-public-dashboard.conf
curl --fail --silent --show-error http://127.0.0.1/healthz
curl --fail --silent --show-error http://127.0.0.1/api/v1/agent/daily-profit
```

Open only TCP port 80 in the SWAS firewall with source `0.0.0.0/0`. The Nginx server is the catch-all virtual host: it
serves the built UI directly, allows GET/HEAD for uncached `/healthz` and the short-lived cached `/api/v1/*`
presentation surface, returns 404 for raw `/api/*` endpoints and rejects mutation methods. The installer disables only
the stock enabled-site symlink, warms every UI API dependency and proves a cache hit; it restores the previous site and
configuration if validation fails. Verify the public IP from a separate client, including a sub-second static root,
security headers, a current business snapshot, a rejected POST and an inaccessible `/api/event-metrics`. A stale cache
fallback preserves the last timestamped read model during a board event-loop delay; it is availability evidence, not a
new chain observation.

The Agent endpoint is written atomically to `/var/lib/manga-business-report/agent-daily-profit.json` by the existing
oneshot reporter. Verify `accounting.failedTransactionGasDeducted=true`,
`accounting.projectResultByAssetIncluded=false`, current `valuation.observedAt`, and a rejected public `POST`. A
`PARTIAL` valuation is a valid native-profit response, not permission to assume USDG parity or replace missing prices.

The exact current source catalog is the private atomically replaced `source-catalog.json` projection. It is written as
canonical JSON through a bounded buffer and linked from economic checkpoints by SHA-256; routine snapshot commits do
not copy the growing catalog into SQLite. Existing SQLite source-catalog rows remain historical rollback material and
are not current-source evidence. The SQLite economic snapshot and opportunity projection retain their independent
parity check.

Schema-v4 catalogs must be migrated while the board and every signer are stopped. Keep the full preimage as rollback
material; do not delete or overwrite it. Run the compactor as `manga-board` with an explicit heap only for this one-shot
migration, then verify the smaller file in a fresh process:

```bash
sudo -u manga-board env NODE_OPTIONS=--max-old-space-size=448 npm run board:catalog:compact -- \
  --file /var/lib/manga-opportunity-board/source-catalog.json \
  --backup /var/lib/manga-opportunity-board/source-catalog.schema4.pre-v5.json \
  --sqlite /var/lib/manga-opportunity-board/board.sqlite
sudo -u manga-board env NODE_OPTIONS=--max-old-space-size=320 npm run board:catalog:verify -- \
  --file /var/lib/manga-opportunity-board/source-catalog.json \
  --sqlite /var/lib/manga-opportunity-board/board.sqlite
```

The compact command refuses to proceed without an exclusive backup path or without proving every fact against a
hash-valid immutable receipt payload in SQLite. Require unchanged collection counts and source-target count in its
receipt before starting the signer-free board. The schema-v5 runtime file keeps evidence links and exact route fields;
full receipt-log payloads remain in `evidence.jsonl` and `board.sqlite`.

Dashboard projections have three separate allocation boundaries. Control-plane endpoints never build opportunity
rows; the list builds semantic summaries only for candidates admitted to the current board snapshot; and a detail
request builds claim-level evidence only for its requested ID. Do not reintroduce source-only facts into the Radar list
or use one shared eager model for every `/api/v1/*` route. The complete discovery census remains available through
source summaries and the streamed `/api/source-catalog` file.

Read the evidence surfaces separately:

```bash
curl --fail --silent --show-error http://127.0.0.1:8788/api/snapshot | jq '{health,source,coverage,selection}'
curl --fail --silent --show-error http://127.0.0.1:8788/api/event-metrics | jq .
curl --fail --silent --show-error http://127.0.0.1:8788/api/chain-catalog | jq '{coverage,summary,lastBatch}'
curl --fail --silent --show-error http://127.0.0.1:8788/api/v1/system | jq '{release,persistence,sourceSummary}'
curl --fail --silent --show-error 'http://127.0.0.1:8788/api/v1/opportunities?platform=LONG_ROUTE' \
  | jq '{generatedAt,count,ninecat:[.items[] | select(.target.symbol == "NINECAT")]}'
```

Before calling a source-aware canary healthy, require all of the following:

1. `/healthz` returns HTTP 200 with `readModel=sqlite`, `persistenceStatus=HEALTHY` and `persistenceParity=true`;
2. `/api/v1/system` reports the exact installed release SHA, public RPC transport metrics and no signer capability;
3. every source adapter exposes its own bounded coverage state; `BACKFILL_PARTIAL` is not upgraded to complete;
4. the static root returns the v0.6 console with same-origin CSP, and mutating API methods return `405`;
5. the signer service state, wallet nonce and audit-ledger head are unchanged across the board-only promotion.

Do not copy signer runtime files into the board user to populate the Execution page. The business reporter reads the
canonical ledgers through a read-only filesystem boundary and exports only the reviewed mode-0640 sanitized snapshot;
the board user receives no direct access to strategy state.

## Business dashboard and Feishu reporting

The business reporter is a one-shot projection and notification service, not part of the signing lane. It streams the
append-only strategy ledgers and retains only the business fields it consumes; do not replace that boundary with a
whole-file `readFile` or increase `MemoryMax` to hide ledger growth. The source ledgers remain untouched and are still
the audit source of truth. A malformed or oversized safety-relevant record must fail the report closed without stopping
the signer.

Enter the
custom-bot webhook through encrypted standard input; never put its value in argv, an environment file, a release archive
or a shell history entry:

```bash
sudo systemd-creds encrypt --name=manga-feishu-webhook - /etc/credstore.encrypted/manga-feishu-webhook
sudo chown root:root /etc/credstore.encrypted/manga-feishu-webhook
sudo chmod 0600 /etc/credstore.encrypted/manga-feishu-webhook
```

Run one controlled delivery before enabling the timer:

```bash
sudo systemctl start manga-business-report.service
sudo systemctl show manga-business-report.service --property=Result,ExecMainStatus
sudo systemctl enable --now manga-business-report.timer
sudo systemctl enable --now manga-business-report.path
sudo systemctl list-timers manga-business-report.timer
curl --fail --silent --show-error http://127.0.0.1:8788/api/v1/business | jq \
  '{generatedAt,accountingScope,strategy,capital,economics,market,portfolio,delivery}'
```

When the Base canary runs on the same host, install the reviewed optional drop-in before refreshing the snapshot:

```bash
sudo install -d -o root -g root -m 0755 /etc/systemd/system/manga-business-report.service.d
sudo install -o root -g root -m 0644 \
  deploy/systemd/manga-business-report-base-portfolio.conf \
  /etc/systemd/system/manga-business-report.service.d/20-base-portfolio.conf
sudo systemctl daemon-reload
sudo systemctl start manga-business-report.service
```

The drop-in grants the reporter only supplementary membership in `atomic-cycle`; the private state directory and signer
remain owner-only. It also pins only this low-frequency business projection to the reviewed public Base reader; it does
not change the Base execution service, signer RPC or nonce owner. The default official Base endpoint is intentionally
not used by this production projection because the release-host verification returned JSON-RPC `-32016` on the bounded
contract reads, while the configured public reader completed the same fixed-block seven-account snapshot. Validate that
`/run/atomic-cycle-portfolio/heartbeat.json` is `0640`, the Base executor identity matches the registry, and the business
snapshot reports `8` monitored objects. Do not grant access to `/var/lib/atomic-cycle-engine` and do not restart either
trading service merely to install this reporter drop-in.

Acceptance requires Feishu response code `0`, one fsynced `DELIVERED` receipt for the previous Beijing day, a mode-0644
sanitized snapshot and an enabled next timer trigger. Inspect metadata and selected non-secret fields; never print or
decrypt the webhook into logs. The board rejects the business snapshot after 15 minutes, so an old panel cannot silently
appear current.

After a report-runtime change, run the one-shot under its unchanged 128 MiB cgroup and require `Result=success`,
`ExecMainStatus=0`, a newer sanitized snapshot timestamp and bounded `MemoryPeak`. A successful local unit test is not a
production readback. Keep the timer and path unit disabled after an OOM until one manual one-shot succeeds; the live
watcher and critical-health timer remain independent.

The service retries every five minutes after 09:05 Beijing time until that period has a durable success receipt. A
failure exits non-zero and may alert, but it cannot stop, re-arm or mutate the watcher. The custom-bot API cannot provide
an end-to-end idempotency key: a host crash after remote acceptance but before the local receipt becomes durable may
produce one duplicate, and operations must not claim exactly-once delivery.

On the first v0.5 start, preserve the existing `events.jsonl`. The service appends one
`EVENT_LEDGER_EPOCH_STARTED` record and stores its timestamp in `state.json`; older event counts remain legacy evidence.
Do not truncate or rewrite the historical file during deployment.

Stopping or rolling back the board must not stop, restart, disarm or change `manga-chan-watcher.service`. Conversely,
board health never proves the signing watcher is armed or trading.

The dual watcher retries only its read-only startup chain evidence on a transport-classified failure: five total
attempts with 1/2/4/8-second backoff. During a retry it reports `DEGRADED_STARTUP_RPC`, keeps the error endpoint
redacted and has not loaded the private credential. An identity, bytecode, authorization, balance, nonce, ledger or
unresolved-mutation mismatch remains terminal on its first observation. A fifth transport failure is also terminal and
must be treated as an RPC outage, not an idle healthy signer.

## Generic-v2 staged promotion

Generic-v2 may share the same Linux host as the loopback opportunity board, but not the board's Unix identity, config,
RPC role or runtime directory. The signing command requests the compact execution view at
`http://127.0.0.1:8788/api/snapshot?view=execution`; `manga-board` still has no signer access. Generic-v2 must use the
same `MANGA_RUN_DIR` as the fixed signer lane so both generations share
`wallet.lock`, `audit.jsonl` and the unresolved-mutation barrier.

The board may use the official public RPC. `/etc/manga-chan-arbitrage/live.env` should normally contain a strategy-owned
execution HTTP RPC; live commands reject the official public endpoint by default. During a reviewed managed-provider
outage, `MANGA_ALLOW_PUBLIC_EXECUTION_RPC=1` explicitly admits Robinhood's official endpoint. Robinhood documents that
endpoint as rate-limited and not production-grade, so retain the outage decision and restore a verified managed provider
when available. The generic watcher has no idle WSS or HTTP chain poll. It touches the execution RPC only after a new
local-board candidate clears the arm's pre-RPC gate.

Before any generic deployment:

1. stop and disarm every fixed-route watcher that can use the wallet;
2. run the fixed and generic reconcile commands and require a clean shared ledger;
3. prove `latest nonce == pending nonce`, confirm the exact operator address and run `npm run check` at the release SHA;
4. run `npm run generic:plan`; treat its result as board evidence only;
5. configure `MANGA_GENERIC_SEED_ETH` explicitly and run `npm run generic:deploy-preflight`;
6. obtain a fresh human authorization for the executor, wallet, seed/value, maximum gas, liveness window and withdrawal
   path before invoking `npm run generic:deploy`;
7. read back the canonical deployment receipt, bytecode hash, operator, 100 USDG cap, 0.05 USDG contract floor and
   executor USDG balance;
8. run `npm run generic:runtime-verify`; require canonical code/operator/constants, a clean nonce and a signer-free
   loopback board.

The default deployment seed is zero. Roughly `0.01 ETH` did not capitalize 100 USDG in the recorded fork, so the cap
must not be confused with available principal. Increase seed only within the reviewed wallet budget, or transfer USDG
through a separately reviewed mutation path; do not improvise an unjournaled top-up.

Deployment and arming are always separate explicit operations. On the signing host, the hardened one-shot units make
the encrypted systemd credential available without copying it into an environment variable or plaintext file:

```bash
sudo systemctl start manga-generic-deploy.service
sudo systemctl --no-pager --full status manga-generic-deploy.service

cd /opt/manga-chan-arbitrage/current
sudo -u manga-chan-arb env \
  MANGA_CONFIG_FILE=/etc/manga-chan-arbitrage/live.env \
  MANGA_RUN_DIR=/var/lib/manga-chan-arbitrage \
  npm run generic:runtime-verify

sudo systemctl start manga-generic-arm.service
sudo systemctl enable --now manga-generic-watcher.service
sudo systemctl show manga-generic-watcher.service \
  --property=ActiveState,SubState,MainPID,NRestarts
```

An arm binds the exact executor and build, principal policy and hard cap, screened and exact net floors, Gas reserve,
authorization lifetime, maximum exact preflights, signed attempts, confirmed executions and failed Gas. Starting the
service without a valid arm stops cleanly and never signs.

For the generic watcher only, `MANGA_GENERIC_WATCH_MAX_EXECUTIONS`, `MANGA_GENERIC_WATCH_MAX_ATTEMPTS` and
`MANGA_GENERIC_WATCH_MAX_PREFLIGHTS` may be set to the explicit value `unlimited`. This removes terminal count stops
without changing the authorization lifetime, failed-Gas budget, ETH reserve, profit floors, principal cap, nonce checks or unknown
mutation barrier. Numeric values retain the finite policy; zero is invalid. The fixed-route watcher's
`MANGA_MAX_ATTEMPTS` remains finite unless its own policy is separately reviewed.

Rolling renewal is disabled by default. To authorize uninterrupted service while retaining a bounded liveness check,
set all three values before creating a fresh arm:

```text
MANGA_GENERIC_WATCH_ARM_HOURS=168
MANGA_GENERIC_WATCH_AUTO_RENEW=1
MANGA_GENERIC_WATCH_RENEW_BEFORE_HOURS=24
```

The already-running watcher attempts renewal during the final 24 hours; no systemd timer, local scheduled task or Codex
heartbeat is required. Renewal advances only `expiresAt`, `lastRenewedAt` and `leaseRevision` under the same
authorization ID. Therefore failed Gas and all usage are cumulative across renewals. It first revalidates the canonical
deployment, clean mutation state, exact nonce, positive executor principal and wallet ETH reserve. Transient provider
failure is retried every five minutes until expiry; an expired lease cannot self-renew. Any change to the principal cap,
profit floors, deployment, failed-Gas budget or other authorization scope requires disarm and a new arm.

`generic:watch:status` exposes `autoRenewLease`, `leaseRevision`, `expiresAt`, `renewWindowStartsAt` and any scheduled
renewal retry. Treat `RUNNING` plus a future expiry as liveness evidence only; receipts and post-state remain the evidence
for profit.

To authorize operation until an explicit disarm, create a fresh arm with the mutually exclusive mode:

```text
MANGA_GENERIC_WATCH_AUTO_RENEW=0
MANGA_GENERIC_WATCH_UNTIL_REVOKED=1
```

This schema-v3 arm has `authorizationLifetime=UNTIL_REVOKED` and no `expiresAt`. Its immutable hard principal cap is the
contract's `100 USDG`; its current spendable principal starts at the canonical executor balance and advances only from a
confirmed execution's `executorUsdgAfterWei`. Thus retained USDG profit compounds automatically while an unrelated
external top-up cannot silently expand the authorization. The board still chooses the greatest absolute screened-net
amount from its bounded grid; the strategy does not blindly spend the full balance. Each signed transaction retains its
independent 45-second on-chain deadline.

Board-only loopback transport failures enter `DEGRADED_BOARD` and retry indefinitely with a capped backoff because they
cannot sign or spend Gas. Execution-RPC failures retain the configured consecutive-error halt. A `RUNNING` process or
no-expiry arm is liveness/authority evidence, not profit evidence; only confirmed receipts and post-state update profit
and compoundable principal.

The supplied Linux units avoid the board's single HTTP event loop on this path. The board atomically replaces
`/run/manga-opportunity-board-feed/execution-snapshot.json` with mode `0640` inside a dedicated mode-`0750` runtime
directory; the signer account receives read-only membership in `manga-board`, while the board's SQLite directory stays
mode `0700` and the board receives no access to `/var/lib/manga-chan-arbitrage` or the signing credential. The watcher
caches an unchanged file generation, rejects symlinks and group/world-writable files, enforces a 16 MiB input limit,
then applies the same board identity, freshness, route and exact-preflight gates. Loopback HTTP remains the development
fallback when `MANGA_GENERIC_BOARD_SNAPSHOT` is unset.

Systemd preserves the last complete runtime feed across an automatic board restart. If the feed is briefly absent or a
reader observes `ESTALE`, the watcher enters board-only degradation and retries without execution RPC or signer work.
Permission, file-type, size and JSON-integrity failures remain terminal invariants. A stale preserved feed cannot
authorize execution because quote freshness is checked before exact preflight.

Disarm writes `generic-watch-revocation.json` before changing the arm or signalling the process. The marker is scoped to
that authorization ID and remains authoritative if a concurrent stale write temporarily restores `ARMED`; creating a
new arm produces a new authorization ID.

```bash
cd /opt/manga-chan-arbitrage/current
sudo -u manga-chan-arb env \
  MANGA_CONFIG_FILE=/etc/manga-chan-arbitrage/live.env \
  MANGA_RUN_DIR=/var/lib/manga-chan-arbitrage \
  npm run generic:watch:status
```

To stop authority, disarm first, then stop and disable the service. Disarm changes the authorization before signalling
the process, and the final signing boundary checks both the arm and stop state:

```bash
cd /opt/manga-chan-arbitrage/current
sudo -u manga-chan-arb env \
  MANGA_CONFIG_FILE=/etc/manga-chan-arbitrage/live.env \
  MANGA_RUN_DIR=/var/lib/manga-chan-arbitrage \
  npm run generic:watch:disarm
sudo systemctl disable --now manga-generic-watcher.service
```

`STOPPED_POLICY` is a clean expiry or budget stop. `HALTED_RPC`, `HALTED_UNKNOWN`, `HALTED_NONCE_CONFLICT`,
`HALTED_INVARIANT` and `HALTED_STARTUP` require investigation. Never restart a halted signer merely because the board
still shows a positive screen; reconcile and re-run deployment-specific verification first.

## Dual-v3 WETH promotion and continuous operation

Dual-v3 is a controlled successor to the generic watcher, not a second concurrent bot. It keeps the deployed USDG
executor and creates a separate WETH executor, but one process owns both bases, the wallet lock, and the nonce. Do not
enable `manga-dual-watcher.service` while any fixed-route or generic-v2 watcher is armed or running.

Before a WETH deployment or dual arm:

1. deploy a release whose complete `npm run check` passes and enable `MANGA_BOARD_ENABLE_WETH_BASE=1` only in the
   signer-free board configuration;
2. observe at least one complete schema-v5 board publication and retain its public-RPC health/readback evidence;
3. durably disarm and stop the current generic watcher, then require `dual:reconcile` (or the owning legacy reconciler)
   to report `CLEAN`, with latest and pending nonce equal;
4. set `MANGA_WETH_SEED_ETH`, `MANGA_WETH_MAX_AMOUNT_WETH`, and
   `MANGA_WETH_MIN_GROSS_PROFIT_WETH` explicitly. The seed is a real ETH value transfer; the maximum is an immutable
   per-transaction contract cap, not an instruction to trade that amount;
5. run `npm run dual:weth:deploy-preflight` and record the current wallet ETH, seed, maximum deployment Gas, retained
   ETH reserve, nonce, source hashes, and constructor bounds;
6. require a human check that `seed + maximum deployment Gas + retained operating reserve` fits the current wallet.
   Never infer this from a previous balance snapshot;
7. start `manga-dual-weth-deploy.service` once, then require the canonical receipt and post-state to prove the exact
   WETH seed, zero stranded native ETH, operator, immutable bounds, code hash, nonce, and wallet ETH delta; and
8. run `npm run dual:runtime-verify`. It must identify both executors and a schema-v5 dual-base loopback board before an
   arm can be created.

Deployment commands are intentionally separate from arming:

```bash
cd /opt/manga-chan-arbitrage/current
sudo -u manga-chan-arb env \
  MANGA_CONFIG_FILE=/etc/manga-chan-arbitrage/live.env \
  MANGA_RUN_DIR=/var/lib/manga-chan-arbitrage \
  npm run dual:weth:deploy-preflight

sudo systemctl start manga-dual-weth-deploy.service
sudo systemctl --no-pager --full status manga-dual-weth-deploy.service

sudo -u manga-chan-arb env \
  MANGA_CONFIG_FILE=/etc/manga-chan-arbitrage/live.env \
  MANGA_RUN_DIR=/var/lib/manga-chan-arbitrage \
  MANGA_GENERIC_BOARD_SNAPSHOT=/run/manga-opportunity-board-feed/execution-snapshot.json \
  npm run dual:runtime-verify
```

Dual autonomous mode accepts only the explicit policy below:

```text
MANGA_GENERIC_WATCH_AUTO_RENEW=0
MANGA_GENERIC_WATCH_UNTIL_REVOKED=1
MANGA_GENERIC_WATCH_MAX_EXECUTIONS=unlimited
MANGA_GENERIC_WATCH_MAX_ATTEMPTS=unlimited
MANGA_GENERIC_WATCH_MAX_PREFLIGHTS=unlimited
```

This removes wall-clock and count stops only. `MANGA_MAX_FAILED_GAS_WEI`, the wallet ETH reserve, common USDG net floor,
screened-net floor, both immutable contract caps, 45-second deadline, deployment identity, nonce, durable revocation,
and UNKNOWN mutation barrier remain authoritative. The arm captures both current executor balances. Spendable principal
advances by summing only receipt-reconciled gross base-asset profit over those arm-time balances; the live contract
balance is a sufficiency check, not a source of authority. Unrelated external top-ups are therefore not adopted until a
new arm.

```bash
sudo systemctl start manga-dual-arm.service
sudo systemctl enable --now manga-dual-watcher.service
sudo systemctl show manga-dual-watcher.service \
  --property=ActiveState,SubState,MainPID,NRestarts

cd /opt/manga-chan-arbitrage/current
sudo -u manga-chan-arb env \
  MANGA_CONFIG_FILE=/etc/manga-chan-arbitrage/live.env \
  MANGA_RUN_DIR=/var/lib/manga-chan-arbitrage \
  MANGA_GENERIC_BOARD_SNAPSHOT=/run/manga-opportunity-board-feed/execution-snapshot.json \
  npm run dual:watch:status
```

While idle, the service reads only the atomically published local feed. A positive screen escalates to one strategy-RPC
batch: both base lanes are exact-called and gas-estimated at one current block, normalized conservatively, and only the
largest net candidate can be signed. The selected on-chain minimum profit stays in USDG or WETH and includes worst-case
Gas plus the common net floor. A board screen, exact call, running process, or arm is not profit evidence; only the
canonical receipt plus base-balance and Gas reconciliation is.

`processedBoardGenerations` counts every distinct valid execution-feed generation the dual watcher has observed,
including an empty generation. `screenedPositiveBoardGenerations` counts only generations that contained at least one
typed proxy-positive candidate. `lastBoardCandidateCount=0` together with `lastDecision=NO_SCREENED_OPPORTUNITY` means
the watcher is current and correctly idle; it does not mean the loop failed or that a profitable transaction was
missed. Neither counter is receipt or realized-profit evidence.

To stop it, revoke first and then disable the service:

```bash
cd /opt/manga-chan-arbitrage/current
sudo -u manga-chan-arb env \
  MANGA_CONFIG_FILE=/etc/manga-chan-arbitrage/live.env \
  MANGA_RUN_DIR=/var/lib/manga-chan-arbitrage \
  npm run dual:watch:disarm
sudo systemctl disable --now manga-dual-watcher.service
```

Use `npm run dual:reconcile` for a dual-v3 UNKNOWN. `--rebroadcast-same-raw` may reuse only the exact persisted raw;
`--abandon-expired` is available only for an expired execution after two independent readers prove the transaction and
nonce absent. Never create a replacement nonce while the result is `PENDING`, `PROVISIONAL`, `CONFLICT`, or `UNKNOWN`.

## One-shot legacy USDG collection

`legacy-funds-collector.mjs` is a maintenance-only exit for the exact historical MANGA and SPX executors checked into
the repository. It cannot accept an arbitrary executor, token, destination or reserve override. Before any signature it
requires both deployment receipts, manifest/state identity, runtime code hashes, `operator()`, full-balance withdrawal
simulations, a clean latest/pending nonce, clean mutation ledgers and inactive signer locks. The aggregate plan retains
at least `0.0025 ETH` after the maximum Gas envelope for both transactions.

The two withdrawals advance the shared operator nonce, so an existing dual authorization must be disarmed and replaced
after the canonical receipts settle. Do not restart the old authorization: its committed baseline nonce will no longer
match.

```bash
cd /opt/manga-chan-arbitrage/current
sudo -u manga-chan-arb env \
  MANGA_CONFIG_FILE=/etc/manga-chan-arbitrage/live.env \
  MANGA_RUN_DIR=/var/lib/manga-chan-arbitrage \
  MANGA_SPX_RUN_DIR=/var/lib/spx-arbitrage \
  npm run legacy:collect:preflight

sudo -u manga-chan-arb env \
  MANGA_CONFIG_FILE=/etc/manga-chan-arbitrage/live.env \
  MANGA_RUN_DIR=/var/lib/manga-chan-arbitrage \
  npm run dual:watch:disarm
sudo systemctl stop manga-dual-watcher.service
sudo systemctl start manga-legacy-collect.service
sudo systemctl --no-pager --full status manga-legacy-collect.service
```

Require `npm run legacy:collect:status` to report `COLLECTED`, both executor balances to be zero, both canonical
receipts to contain the exact `Withdrawn` event, the operator USDG delta to equal the collected total, Gas to reconcile
to the operator ETH delta and latest/pending nonce to converge. If the service reports an unknown receipt, leave every
signer stopped and run `npm run legacy:collect:reconcile`; never re-sign the withdrawal.

Only after collection or reconciliation is terminal may a new dual arm be issued and the watcher restarted:

```bash
sudo systemctl start manga-dual-arm.service
sudo systemctl enable --now manga-dual-watcher.service
sudo systemctl show manga-dual-watcher.service --property=ActiveState,SubState,MainPID,NRestarts
```
