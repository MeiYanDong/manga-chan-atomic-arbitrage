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

## Rollback

1. disarm and stop the watcher;
2. reconcile the current wallet lane;
3. repoint `/opt/manga-chan-arbitrage/current` to the prior commit-addressed release;
4. restore the matching runtime schema/config permissions, not just source code;
5. run the prior release's compile and runtime verification;
6. issue a fresh arm only after all evidence is clean.

Never roll code backward while retaining an incompatible runtime ledger or active authorization.

## Alerts

The supplied service exits non-zero on a halted state and invokes an `OnFailure` unit, producing an explicit journal event. A real paging destination is not configured in the public repository; operators must connect that unit to their private notification system and verify delivery before calling alerting complete.

The release installer compiles and verifies the code before atomically moving the `current` symlink. The hardened runtime service only reads that release and writes under `/var/lib/manga-chan-arbitrage`; it does not attempt to compile inside the read-only `/opt` tree at service start.

## Opportunity board deployment

The opportunity board is not part of the signer lane. Provision `/etc/manga-opportunity-board/live.env` from
`deploy/opportunity-board.env.example` with mode `0640 root:manga-board`. Its RPC endpoint must be read-only and distinct
from the watcher's hot HTTP/WSS path. Never copy `MANGA_PRIVATE_KEY_FILE`, a key value or the signing strategy's complete
environment into this file.

After installing the release:

```bash
sudo systemctl enable --now manga-opportunity-board.service
sudo systemctl show manga-opportunity-board.service --property=ActiveState,SubState,MainPID,MemoryCurrent,NRestarts
curl --fail --silent --show-error http://127.0.0.1:8788/healthz
sudo -u manga-board env MANGA_BOARD_RUN_DIR=/var/lib/manga-opportunity-board npm run board:status
```

The HTTP service deliberately listens only on loopback. View it through an SSH tunnel instead of opening a public
firewall port. The supplied SSH drop-in permits only client-local forwarding to `127.0.0.1:8788`; validate it with
`sshd -t`, reload SSH, and prove a fresh key-only session before relying on the tunnel. Runtime evidence is stored in
`/var/lib/manga-opportunity-board/snapshot.json`, `events.jsonl`, `state.json`, `chain-catalog.json`,
`source-catalog.json`, `board.sqlite`, `evidence.jsonl` and `pool-mirror.json`; none belongs in Git. Chain/source catalogs
are complete only from their recorded configured start blocks. The mirror contains event state, not a quote or
execution instruction. Keep the directory when rolling between SQLite and the legacy reader; the rollback flag never
deletes the append-only ledger.

The exact current source catalog is the private atomically replaced `source-catalog.json` projection. It is written as
canonical JSON through a bounded buffer and linked from economic checkpoints by SHA-256; routine snapshot commits do
not copy the growing catalog into SQLite. Existing SQLite source-catalog rows remain historical rollback material and
are not current-source evidence. The SQLite economic snapshot and opportunity projection retain their independent
parity check.

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

Do not copy signer runtime files into the board user merely to populate the Execution page. It remains `NONE` until a
separately reviewed, sanitized execution-evidence export exists.

On the first v0.5 start, preserve the existing `events.jsonl`. The service appends one
`EVENT_LEDGER_EPOCH_STARTED` record and stores its timestamp in `state.json`; older event counts remain legacy evidence.
Do not truncate or rewrite the historical file during deployment.

Stopping or rolling back the board must not stop, restart, disarm or change `manga-chan-watcher.service`. Conversely,
board health never proves the signing watcher is armed or trading.

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
