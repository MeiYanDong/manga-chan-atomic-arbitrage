# SWAS live deployment evidence — 2026-09-04

This record separates release verification, runtime activation and economic results. It intentionally omits the host IP, node endpoints and all credential material.

## Release and host

- Release: `v0.1.3`
- Commit: `0128c876157b588d0e4d0749c025c3524a1154ee`
- Release archive SHA-256: `13e10217712f2d98813b685bc7da3f4f8952417c53706110ac0791f32869800c`
- CI: [main quality gate](https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/actions/runs/33851485098)
- Release build: [commit-addressed artifact gate](https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/actions/runs/33851496232)
- Published artifact: [GitHub release v0.1.3](https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/releases/tag/v0.1.3)
- Host class: Alibaba Cloud SWAS, `us-west-1`, Ubuntu 24.04, 2 vCPU, 2 GiB RAM, 40 GiB disk, 200 Mbps peak bandwidth.
- Host purchase: CNY 56 for one month, auto-renew disabled. Purchase alone was not treated as deployment evidence.
- Network ingress at readback: TCP 22 and ICMP only. SSH was verified key-only after the hardening drop-in was loaded.

The server independently ran `npm run check`: 13 unit tests passed, the deterministic Cancun contract test passed all seven negative checks, and the secret scan passed 46 files. The Solidity source hash remained `0x6bc70266e7e4763466fcdb1f2e49762b08d6c17acf67376fc78a3d6ef136080c`.

## Provider and canonical runtime gate

- The live RPC topology is role-separated: `MANGA_RPC_URL` and `MANGA_WS_URL` use the dedicated Chainstack execution node for quotes, event triggers, signing preflight and normal live broadcast; `MANGA_READ_RPC_URL` uses the official Robinhood public HTTP RPC as the independent observer during normal reconciliation. The manual `reconcile --rebroadcast-same-raw` recovery command remains an explicit exception: it fans the already-persisted raw transaction to both configured HTTP clients without signing a replacement.
- The second Chainstack read node is retained, but it is no longer referenced by the runtime environment. A root-only copy of the pre-cutover configuration is retained for rollback. No provider endpoint or credential is stored in this repository.
- From the SWAS host, 40 HTTP and 40 WSS block-number samples completed with zero failures. HTTP p50/p95 were 17.97/22.39 ms; WSS p50/p95 were 13.18/13.85 ms. The final observed head distance was two blocks.
- A paired post-cutover benchmark from the same SWAS host completed 40/40 samples on each HTTP provider with zero failures. Chainstack execution HTTP measured p50/p95/p99/max of 15.21/41.20/91.87/91.87 ms. Robinhood public HTTP measured 78.27/83.41/108.90/108.90 ms and lagged the Chainstack head by 3–9 blocks in those samples. The public endpoint is therefore excluded from the latency-sensitive quote and trigger path.
- Reconciliation returned `CLEAN` with no unresolved mutation.
- Runtime verification returned `RUNTIME_VERIFIED_READY_FOR_ARM` at HTTP/WSS block `54108669` with zero head distance.
- Wallet latest/pending nonce was `1/1`.
- Executor: `0x725B7B29679dF1de5A89B2A48CA7CED178bfa506`.
- On-chain runtime hash: `0x29c853078b2559e33b32eeee1bb5c74dfb597276d540243d1c079aef2330ba9e`.
- Executor principal at the gate: `10.045402 USDG`.

The prior macOS watcher was disarmed and unloaded before the cloud authorization was created. No local watcher process or wallet lock remained during cutover.

## Live activation readback

- Authorization: `0x314b595669c8dded9822c0e3a5e6444ca2ec7a741a397f505a72512270467537`.
- Issued: `2026-09-04T08:04:46.364Z`.
- Expires: `2026-09-05T08:04:46.364Z`.
- Limits: five confirmed executions, five signed attempts, and `0.001 ETH` cumulative failed-gas budget.
- Wallet gas balance at arm: `0.005623091786592 ETH`.
- systemd readback: enabled, active/running, zero restarts, approximately 261 MiB memory, and exposure score `3.9 OK`.
- Watcher readback: `WSS_TARGETED_SWAP_WITH_RECOVERY_POLL`, 30-second recovery poll, zero consecutive errors, zero unresolved mutations.

One WSS event briefly arrived three blocks ahead of Chainstack execution HTTP. The watcher classified it as state-readiness lag, did not sign, and recovered to a later `NO_SHOT` heartbeat with zero consecutive errors.

At `2026-09-04T08:06:05Z`, the watcher was live and armed, but no profitable route had passed the net-profit and gas gates. Therefore:

- deployment and live monitoring: **verified**;
- confirmed arbitrage transactions: **0**;
- realized profit or loss: **not established**.

At `2026-09-04T08:20:03Z`, the service entered a controlled reader cutover. It stopped cleanly, reconciliation returned `CLEAN`, the reader configuration was replaced atomically, and the official public endpoint returned chain ID `4663` plus a current block. Runtime verification then passed at HTTP/WSS block `54117881` with zero head distance, post-cutover reconciliation returned `CLEAN`, and systemd restarted the watcher as enabled/active with zero restarts. A transient `DEGRADED_RPC` protection state caused by the Chainstack WSS feed reaching a block before Chainstack HTTP recovered automatically to `RUNNING` with zero consecutive errors. The wallet nonce remained `1/1`, executor principal remained `10.045402 USDG`, and no transaction was signed or confirmed during the cutover.

## Residual operational gaps

- The arm is intentionally bounded to 24 hours; continued live operation requires a fresh verified authorization after expiry.
- Robinhood documents its public RPC as rate-limited and not recommended as a production endpoint. This deployment confines it to low-volume independent observation; if that reader is unavailable or too far behind during reconciliation, the safe result can remain `UNKNOWN` until the retained Chainstack reader is restored or another independent provider is configured. See [Robinhood Chain connection guidance](https://docs.robinhood.com/chain/connecting/).
- The public `OnFailure` unit writes an explicit journal event, but no external pager destination is configured or delivery-tested.
- `systemd-creds` is host-bound and the encrypted credential is root-only. The SWAS host reported that its credential host key is not stored on encrypted media, so full-disk-at-rest protection remains unverified.
