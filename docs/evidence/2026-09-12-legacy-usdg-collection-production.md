# Legacy USDG collection production evidence

- Date: 2026-09-12 CST
- Release: `87ca9105c2dc41e155c45096ee22eeb15dc940d1`
- Pull request: #115
- GitHub Actions run/job: `34675242719 / 103503820503`
- Network: Robinhood Chain, chain ID `4663`
- Destination: operator wallet `0x77f771E83f118C32547A1291dda438a757B4b91B`

## Outcome

The two allowlisted legacy executor balances were collected into the existing operator wallet without requiring an
external top-up. The operation moved exactly `15.676618 USDG`; both legacy executor balances are now zero. The active
USDG and WETH executor principals were not withdrawn or otherwise changed by the collection.

| Source                  | Amount           | Transaction                                                          |
| ----------------------- | ---------------- | -------------------------------------------------------------------- |
| legacy MANGA executor   | `10.045402 USDG` | `0x4fef5ae18e853dc770af6af3e9b8743f32149e4a9e02eee252eacc4dfe4be341` |
| legacy SPX executor     | `5.631216 USDG`  | `0xeaecd2795fe1ac72b518d697fdeb8cf0756aa0549057cb97156572a2a3a1b661` |
| operator wallet receipt | `15.676618 USDG` | exact post-state balance delta                                       |

The MANGA receipt was included in block `60855935` and used `66,264` gas at `99,334,000 wei`, for
`0.000006582268176 ETH`. The SPX receipt was included in block `60855983` and used `49,164` gas at `98,902,000 wei`,
for `0.000004862417928 ETH`. Total realized collection gas was `0.000011444686104 ETH`.

Both receipts reached three confirmations. Each receipt had status success, the exact allowlisted executor address,
the exact USDG token, an exact `Withdrawn` event amount, a zero executor post-balance and a matching operator-wallet
USDG balance increase. The operator nonce converged from `16` to `18` with no pending transaction.

## Preflight and safety boundary

Immediately before signing, the frozen block snapshot reported:

- operator ETH: `0.002759654781831194 ETH`;
- operator USDG: `0`;
- pending/latest nonce: `16 / 16`;
- simulated MANGA and SPX withdrawals: success;
- aggregate worst-case gas envelope: `0.0000215614840896 ETH`;
- projected minimum ETH after the envelope: `0.002738093297741594 ETH`;
- retained ETH floor: `0.0025 ETH`.

The collector also revalidated chain ID, deployment receipts, manifest identity, runtime bytecode hashes, each
executor's on-chain `operator()`, all strategy ledgers and the shared signing lock. The old dual watcher authorization
was disarmed before the nonce-changing withdrawals. A stale lock whose recorded PID no longer existed was moved to the
protected maintenance archive after systemd, process, nonce and ledger checks; it was not deleted.

The collector used the existing encrypted systemd credential. No private key, signed raw transaction, RPC credential
or webhook value was printed, copied into the release, committed or exposed to the dashboard.

## Post-state and resumed runtime

The canonical post-state was:

- operator wallet: `15.676618 USDG` and `0.002748210095727194 ETH`;
- legacy MANGA executor: `0 USDG`;
- legacy SPX executor: `0 USDG`;
- active USDG executor: `35.344393 USDG`;
- active WETH executor: `0.0032 WETH`;
- pending/latest nonce: `18 / 18`;
- collector unresolved mutation: none;
- dual-strategy unresolved mutation: none.

The dual live strategy was re-armed from nonce `18` with authorization
`0x395bb0c6fa5e1c333acc6ead6f0fc9c13eee4c36b96bd93f0ca2b73bd7740502`. Its service returned `active/running`,
`NRestarts=0`, mode `UNTIL_REVOKED`, a `0.002 ETH` wallet reserve and unchanged active principals. The first fresh
status was `RUNNING`; the current decision was `NO_SCREENED_OPPORTUNITY`, not an execution failure.

## Public dashboard readback

A controlled business-report refresh completed with `Result=success` and `ExecMainStatus=0`. The externally reachable
read-only API then returned a snapshot generated at `2026-09-12T05:30:32.578Z`:

- strategy: `RUNNING`;
- market scanner: `HEALTHY`;
- portfolio: `VERIFIED`;
- Robinhood active totals: `51.021011 USDG`, `0.0032 WETH`, `0.002748210095727194 ETH`;
- Robinhood parked totals: `0 USDG`, `0 WETH`, `0 ETH`.

The `51.021011 USDG` total is the sum of `35.344393 USDG` still in the active executor and `15.676618 USDG` now in
the operator wallet. The funds have been consolidated for visibility but have not been automatically added to strategy
principal; that would be a separate capital-allocation action.

## Quality and release verification

- Local `npm run check`: formatter, lint, checked-JavaScript types, UI build, `253/253` Node tests, three deterministic
  contract suites and secret scan passed.
- PR #115 GitHub Actions run/job `34675242719 / 103503820503`: passed before merge.
- Exact source archive SHA-256:
  `eed141a7028894bd385adfe6bca537a44276d308f86dc67435107cfdd10c3f44`.
- Release host installation repeated the Linux quality gate: `253/253` Node tests, all deterministic contract suites
  and a `270`-file secret scan passed before installation.
- Installed release path:
  `/opt/manga-chan-arbitrage/releases/87ca9105c2dc41e155c45096ee22eeb15dc940d1`.
