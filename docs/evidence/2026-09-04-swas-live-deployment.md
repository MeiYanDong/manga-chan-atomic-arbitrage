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

- A dedicated Chainstack project contains separate Robinhood mainnet execution and read nodes. The execution node supplies HTTP and WSS; the second node is an independent reconciliation reader.
- From the SWAS host, 40 HTTP and 40 WSS block-number samples completed with zero failures. HTTP p50/p95 were 17.97/22.39 ms; WSS p50/p95 were 13.18/13.85 ms. The final observed head distance was two blocks.
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

One WSS event briefly arrived three blocks ahead of the HTTP reader. The watcher classified it as state-readiness lag, did not sign, and recovered to a later `NO_SHOT` heartbeat with zero consecutive errors.

At `2026-09-04T08:06:05Z`, the watcher was live and armed, but no profitable route had passed the net-profit and gas gates. Therefore:

- deployment and live monitoring: **verified**;
- confirmed arbitrage transactions: **0**;
- realized profit or loss: **not established**.

## Residual operational gaps

- The arm is intentionally bounded to 24 hours; continued live operation requires a fresh verified authorization after expiry.
- The public `OnFailure` unit writes an explicit journal event, but no external pager destination is configured or delivery-tested.
- `systemd-creds` is host-bound and the encrypted credential is root-only. The SWAS host reported that its credential host key is not stored on encrypted media, so full-disk-at-rest protection remains unverified.
