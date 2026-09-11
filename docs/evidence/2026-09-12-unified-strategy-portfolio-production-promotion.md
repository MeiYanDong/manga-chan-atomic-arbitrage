# Unified strategy portfolio production promotion

- Date: 2026-09-12 CST
- Functional release: `0214adca10ab18bb8e304c78a744ca3c0ac067db`
- UI/portfolio PR: #107
- Public-RPC correction PR: #108
- Scope: signer-free board, business reporter, private tunnel and sanitized portfolio projection

## Outcome

The Chinese-first portfolio dashboard is live on the production host. A natural five-minute timer tick produced a
schema-v2 business snapshot at `2026-09-11T17:25:16.937Z`. The snapshot was `VERIFIED`, contained seven monitored
objects (`5 active`, `2 parked`), and reported both the Robinhood Chain and Base services as `RUNNING`.

No signing, broadcast, withdrawal or wallet transfer was performed by this release. The Robinhood signer service kept
MainPID `809` and `NRestarts=0` throughout the successful promotion. The Base watcher kept MainPID `2409` and remained
active. The signer-free board loaded the new release as MainPID `4507` with `NRestarts=0`; the business timer remained
active.

## Economic readback

The first natural production snapshot reported:

| Scope            | Verified balances                                       |
| ---------------- | ------------------------------------------------------- |
| Robinhood active | `0.00262778655474 ETH`, `35.344393 USDG`, `0.0032 WETH` |
| Robinhood parked | `15.676618 USDG`                                        |
| Base active      | `0.006987074636027231 ETH`, `0.003 WETH`                |

Both operator wallets had zero pending transactions. The active Robinhood strategy had `0` confirmed executions,
`0 USDG` verified execution net and `0 ETH` failed Gas. The Base sanitized heartbeat had `0` broadcasts, `0` confirmed
profit transactions, `0 ETH` verified net and `0 ETH` failed Gas. These are zero realized results, not estimates.

## Provider boundary and rejected attempts

The first promotion correctly rolled back because the official `https://mainnet.base.org` endpoint returned HTTP 429
and JSON-RPC `-32016` for the bounded contract calls. That left the Base WETH and operator fields unknown, so the
portfolio stayed `PARTIAL`. A paced retry still returned `-32016`. LlamaRPC returned a Cloudflare 403 challenge from
the release host. The low-frequency business projection was therefore pinned to the public PublicNode Base endpoint,
which completed the exact fixed-block seven-object snapshot as `VERIFIED`. This override does not affect any execution
RPC, quote path, signer or nonce source and does not consume ChainStack quota.

A later promotion also rolled back because the old board's Node child did not leave within systemd's 20-second graceful
stop window. The release procedure was corrected to stop and, only if required, kill the board service's own cgroup
before a separate start. It never uses a process-name match and never targets the signer service. The accepted promotion
ran from `2026-09-11T17:17:45Z` to `17:20:44Z`; the journal identified
`manga-chan-atomic-arbitrage@0.10.0`, the process working directory resolved to the exact release, and the first complete
cycle restored `HEALTHY/RUNNING` with SQLite persistence parity.

## Quality and runtime gates

- Local `npm run check`: formatting, JavaScript/Solidity/shell lint, typecheck, UI build, three contract compilations,
  `243/243` Node tests, all three deterministic contract suites and a `266`-file secret scan passed.
- PR #107 CI run `34620308472`: passed.
- PR #108 CI run `34626250916`: passed.
- Release host: `npm ci`, typecheck, UI build, 26 targeted portfolio/UI/isolation tests, Linux systemd verification and
  a `251`-file source-archive secret scan passed before the symlink changed.
- The mode-0640 business snapshot remained owned by `manga-chan-arb:manga-board`. The Base private state stayed outside
  the reporter; only the allowlisted mode-0640 runtime heartbeat was readable through supplementary group membership.
- Production Playwright readback returned HTTP 200 with title `双链套利经营台`, zero console errors, zero failed
  requests and no raw runtime-mode string in the primary UI.

## Private access and notification

The board remains bound to `127.0.0.1:8788`. The host exposes a second key-only SSH listener on 2222 through Ubuntu's
socket activation; its SWAS firewall rule is restricted to the operator's current `/32`. SSH forwarding remains local
only and is allowlisted solely to `127.0.0.1:8788`. Port 8788 is not public. The client tunnel serves the dashboard at
`http://127.0.0.1:18788/#/portfolio`.

Feishu delivery remained `CONNECTED`. The last durable success receipt was for Beijing period `2026-09-10`, and the
next scheduled report remained 09:05 Beijing time. Installing the portfolio/tunnel release did not send an extra report.
