# Unified EarnOnHood keeper production promotion

- Date: 2026-09-12 (Asia/Shanghai)
- Production release: `9faee7cd453d3486ac34150a8ca1d32a41e25475`
- Pull request: #121
- Public dashboard: `http://47.251.185.146/`

## Outcome

The two reviewed `WETH/MOO/AI/WETH` directions now run inside the one production nonce owner. Earn principal has no
fixed amount cap: each wake rebuilds 24 balance-scaled probes whose maximum is the current native wallet balance minus
the complete failed-Gas allowance and a retained submission reserve. The generic USDG and WETH executor contracts keep
their separate immutable contract caps; this promotion does not silently redeploy or weaken them.

The active Earn policy requires the signed output floor to cover the input, the full buffered Gas envelope and one wei
of positive net. A possible failed transaction may be attempted only when charging its entire Gas ceiling would leave
receipt-proven lifetime Earn net strictly positive. At the production readback, that historical Gas-solvency balance
was `0.000131868227091194 ETH`, the per-attempt ceiling was `0.00012 ETH`, and the fixed principal cap was `null`.

## Reviewed artifact and gates

- PR CI run/job `34685785556 / 103532421904` passed before merge.
- The exact GitHub source archive SHA-256 was
  `3975519c33ce24b8ebd9ae41bde9967b464ba889e198b897f82bb8043aaf6307` locally and on the server.
- Local `npm run check` passed formatting, JavaScript/Solidity/shell lint, checked-JavaScript types, the production UI
  build, all three contract compilers, `262/262` Node tests, three deterministic contract suites and a `296`-file
  working-tree secret scan. macOS correctly skipped Linux-only systemd verification.
- The Ubuntu installer repeated the complete gate, including `systemd-analyze verify`, `262/262` Node tests, all three
  deterministic contract suites and a `284`-file source-archive secret scan.

## Controlled signer cutover

Before installation, the old authorization
`0x395bb0c6fa5e1c333acc6ead6f0fc9c13eee4c36b96bd93f0ca2b73bd7740502` was durably revoked. The old watcher and board
were stopped, reconciliation returned `CLEAN`, and no unresolved mutation or wallet lock existed. Its watch lock
remained as a mode-0600 file after the process exited; PID `21412` was independently confirmed dead and the file was
moved to a timestamped stale-lock evidence name instead of being deleted.

The installer promoted only after the hash and Linux gates passed. It did not arm or start trading. The board then
reached `HEALTHY/RUNNING` with SQLite parity true and both catalogs complete from their configured starts. Only after
that readback did the one-shot arm create authorization
`0x840860ba36fc8c50b9025ca969085deb5660eeef1d7ca18b2c7654e1121b2bd5` and start the watcher.

## Chain, process and execution readback

The canonical post-start readback reported:

```text
chainId=4663
walletEth=0.002748210095727194
nonceLatest=18
noncePending=18
USDG executor balance=35.344393
WETH executor balance=0.0032
unresolvedMutation=null
authorization=ARMED / UNTIL_REVOKED
Earn fixedPrincipalCap=null
Earn dynamicMaximumPrincipalEth=0.002378210095727194
Earn lifetimeGasSurplusEth=0.000131868227091194
```

The watcher Node PID was `28163`, and both its working directory and `MANGA_RELEASE_SHA` resolved to the exact release.
The systemd watcher MainPID was `28147`; the watcher and board were active/running with `NRestarts=0`. The business
report timer and path units were active/waiting. The public root and business API both returned HTTP 200 after the
report snapshot refreshed.

Between `2026-09-12T09:39:01Z` and `09:44:31Z`, reviewed-pool Swap events caused four completed public-RPC Earn wakes.
The event cursor advanced without skipped blocks or an event-RPC error. Every screen returned
`NO_SHOT_NO_SIGNATURE_NO_BROADCAST` because neither direction had a positive gross quote. The active authorization
therefore remained at zero managed exact preflights, zero signed attempts, zero confirmed executions and zero failed
Gas. No post-integration profit or transaction is claimed.

## Remaining boundaries

- The historical profitable receipt proves feasibility, not continuing capacity, race wins or future returns.
- Event wakes are live, but the independent five-minute recovery reason was not naturally observed in this short
  window because reviewed-pool events kept refreshing the last-scan deadline.
- One later 15-second loopback business-API read timed out while the single board process was busy. The earlier public
  and loopback reads succeeded, and services remained active; this is the existing read-latency boundary, not a closed
  server-isolation issue.
- No principal ceiling removes a sizing policy limit; it does not remove liquidity, price impact, Gas, nonce, contract,
  provider, token, governance, MEV or key-custody risk.
