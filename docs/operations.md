# Operations and cutover runbook

## Pre-deployment gate

1. Check out the exact release commit and run `npm ci --no-audit --no-fund` followed by `npm run check`.
2. Confirm the release source hash matches `deployments/robinhood-mainnet.json`.
3. Provision a strategy-owned managed HTTP endpoint and WSS endpoint. Do not reuse another strategy's configuration file.
4. Configure an independent HTTP reader when available. The two URLs must not alias one another.
5. Install the signer as a systemd credential or a root-provisioned `0600` file. Never print it during transfer.
6. Transfer `state.json` and `audit.jsonl` through a private channel. They are runtime evidence, not release assets.

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
