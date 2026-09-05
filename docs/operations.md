# Operations and cutover runbook

## Pre-deployment gate

1. Check out the exact release commit and run `npm ci --no-audit --no-fund` followed by `npm run check`. CI must execute `systemd-analyze verify` on the supplied service units; local macOS checks explicitly report that this Linux-only gate was skipped.
2. Confirm the release source hash matches `deployments/robinhood-mainnet.json`.
3. Provision a strategy-owned managed HTTP endpoint and WSS endpoint. Do not reuse another strategy's configuration file.
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
`/var/lib/manga-opportunity-board/snapshot.json`, `events.jsonl` and `state.json`; none belongs in Git.

Stopping or rolling back the board must not stop, restart, disarm or change `manga-chan-watcher.service`. Conversely,
board health never proves the signing watcher is armed or trading.

## Generic-v2 staged promotion

Generic-v2 may share the same Linux host as the loopback opportunity board, but not the board's Unix identity, config,
RPC role or runtime directory. The signing command reads `http://127.0.0.1:8788/api/snapshot`; `manga-board` still has
no signer access. Generic-v2 must use the same `MANGA_RUN_DIR` as the fixed signer lane so both generations share
`wallet.lock`, `audit.jsonl` and the unresolved-mutation barrier.

The board may use the official public RPC. `/etc/manga-chan-arbitrage/live.env` must instead contain a strategy-owned
execution HTTP RPC; live commands reject the official public endpoint. The generic watcher has no idle WSS or HTTP chain
poll. It touches the execution RPC only after a new local-board candidate clears the arm's pre-RPC gate.

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

An arm binds the exact executor and build, current principal cap, screened and exact net floors, Gas reserve, expiry,
maximum exact preflights, signed attempts, confirmed executions and failed Gas. Starting the service without a valid arm
stops cleanly and never signs. Read local state without a chain call using:

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
