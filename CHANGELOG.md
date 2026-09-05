# Changelog

## 0.4.0 — 2026-09-05

- Add an expiring, bounded generic-v2 authorization and autonomous Linux watcher.
- Keep idle discovery on the signer-free loopback board; use the strategy RPC only for one newly triggered candidate's exact preflight, signing and receipt convergence.
- Independently cap exact preflights, signed attempts, confirmed executions, failed gas, per-transaction principal and authorization lifetime.
- Revalidate the authorization immediately before and immediately after signing, and refuse a public RPC in the live mutation lane.
- Mutually exclude fixed and generic watcher generations in code and systemd while retaining the shared wallet lock and UNKNOWN barrier.
- Require receipt, event, executor balance, wallet Gas delta and contemporaneous native mark before a generic execution becomes a terminal economic effect.
- Add hardened one-shot deployment and arm units plus a persistent generic watcher unit.
- Give the deployment one-shot a 180-second start timeout so its 120-second canonical receipt wait cannot be killed by
  systemd's default start timeout.

## 0.3.0 — 2026-09-05

- Add a typed generic PAIR executor for stock, AI, meme and other quote assets without arbitrary call targets.
- Enforce the 100 USDG cap, canonical PAIR pool shape, V3 fee allowlist and direct-or-one-WETH-bridge anchors on-chain.
- Add adaptive amount search through 100 USDG, bounded midpoint refinement and maximum absolute net-profit selection.
- Pace full-grid refreshes for persistent candidates and ship a conservative official-public-RPC board profile.
- Enforce a post-cycle public-RPC cooldown even when a long scan exceeds its nominal interval.
- Publish complete typed route payloads for positive amount variants and exact-preflight the strongest candidates.
- Add generic deploy, one-shot execute, UNKNOWN reconcile and withdrawal commands with raw-before-broadcast persistence.
- Add deterministic direct/bridged contract coverage, historical mainnet-fork verification and a validated sniper spec.

## 0.2.2 — 2026-09-04

- Reconcile the newest-token page before deciding whether a moving PAIR pagination pass covered its advertised total.
- Keep up to 32 currently positive screens on the priority refresh path by default.

## 0.2.1 — 2026-09-04

- Permit only a client-local SSH forward to the loopback opportunity board while keeping arbitrary forwarding,
  GatewayPorts, tunnels and password authentication disabled.

## 0.2.0 — 2026-09-04

- Add a continuously refreshed PAIR multi-pool opportunity census with fixed-block four-leg quotes.
- Rank gross and gas-proxy net results without claiming generic execution or receipt evidence.
- Add an auto-refreshing loopback dashboard and append-only material-change ledger.
- Isolate the scanner under a signer-free Unix identity, read RPC, systemd unit and runtime directory.
- Add exact tests for discovery gates, gas math, stale fail-closed behavior, events and atomic publication.

## 0.1.3 — 2026-09-04

- Accept systemd's immutable `0440 root:root` credential files only inside the unit-specific credentials directory.
- Keep ordinary signer files restricted to owner-only permissions and reject symlinks.

## 0.1.2 — 2026-09-04

- Bind the Linux signer to an encrypted systemd credential and remove the plaintext credential source path.
- Add bounded runtime resource controls and restart only after abnormal process termination.
- Resolve npm through the controlled service path during deployment verification.
- Add a key-only SSH hardening drop-in for the dedicated signing host.

## 0.1.1 — 2026-09-04

- Verify systemd service units on Linux CI and keep runtime startup read-only under the hardened filesystem sandbox.

## 0.1.0 — 2026-09-04

- Extract the MANGA CHAN route from the mixed LP workspace without changing deployed Solidity source.
- Add durable intent/plan/raw/effect mutation records and UNKNOWN reconciliation.
- Classify provider state-readiness failures separately from invariants.
- Replace five-second primary polling with targeted WSS swap triggers and a recovery poll.
- Add independent unit and deterministic Cancun EVM contract tests.
- Add automated style, type, compile, test, secret and CI gates.
- Add release, systemd, ADR and operations documentation.
