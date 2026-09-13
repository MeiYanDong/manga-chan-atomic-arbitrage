# Opportunity console production promotion — 2026-09-13

## Outcome

Release `e0358eca4f4070d97f13353535fac5f0bd192d86` is the active dashboard release on the US West production host. It adds
one independent Chinese-first opportunity page at `/#/opportunities` while retaining the existing overview, activity,
portfolio and strategy pages.

This promotion did not change a signing key, wallet, contract balance, execution threshold or transaction authority.
The existing Robinhood and Base live services remained on their original processes throughout the dashboard-only
promotion. The new Earn competitor census is signer-free and read-only.

## Source and build receipts

- Feature pull request: <https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/pull/142>
- Merged release commit: `e0358eca4f4070d97f13353535fac5f0bd192d86`
- Ubuntu quality receipt:
  <https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/actions/runs/34751189364/job/103707897220>
- Release archive SHA-256: `ff1046a2c6a03ec632ae16743a843226c559049a1873c864d461961f9554b9d6`
- The production installer rebuilt the UI, typechecked the source, compiled the three Cancun contracts and passed the
  release secret scan before switching the immutable `current` symlink.

## Runtime continuity

Control-plane readback at approximately `2026-09-13 18:33 Asia/Shanghai` returned:

| Unit                               |   PID | Restarts | State          | Executable working tree            |
| ---------------------------------- | ----: | -------: | -------------- | ---------------------------------- |
| `manga-dual-watcher.service`       | 30618 |        0 | active/running | prior immutable release `13193e8…` |
| `atomic-cycle-live.service`        | 31489 |        0 | active/running | atomic engine release `8b67df7…`   |
| `manga-opportunity-board.service`  | 36050 |        0 | active/running | release `e0358ec…`                 |
| `atomic-cycle-shadow.service`      | 36052 |        0 | active/running | atomic engine release `8b67df7…`   |
| `manga-opportunity-census.service` | 36585 |        0 | active/running | release `e0358ec…`                 |
| `nginx.service`                    |   863 |        0 | active/running | system service                     |

The two live signer PIDs are unchanged from the pre-promotion readback. They were not restarted or re-armed. The
business report timer and path units are active/waiting. The deployed and release-copy Nginx configurations have the
same SHA-256, `80a0057c5c065e4b99ddd9b04e3542d0a2f10fb2fd402dc60051b4288fda5964`.

## Production API and browser readback

The public catch-all virtual host returned the same console for an arbitrary `Host` header. `POST` to the opportunity
API was rejected with HTTP `403`; all public data paths remain read-only.

At the production readback:

- `/healthz` returned `HEALTHY`, SQLite persistence `HEALTHY` and parity `true`.
- `/api/v1/opportunity-ledger/summary` returned 4,188 admitted candidates: 0 `NOW`, 0 `NEAR`, 11 `FILTERED` and
  4,177 `UNKNOWN`.
- Unknown is explicit: 3,170 stale quotes and 1,007 candidates not yet quoted were not converted into false zeroes.
- The BNB read-only lane observed a gross-positive route during one readback, but its estimated result was negative
  after Gas and reserve. It was not executable and no broadcast was attempted.
- A real Chromium session opened `/#/opportunities`, displayed the five-page navigation, loaded the opportunity
  funnel and successfully switched both the “已过滤” and “错过与未知” tabs.
- The public page exposed user-facing route, principal, gross result, cost, estimated net and conclusion columns. It
  did not expose signing data or dump raw internal objects into the main table.

The receipt-gated business projection reported three confirmed Earn executions for `2026-09-13`, with verified net
`0.000091338675933711 ETH`, zero failed transactions and zero failed Gas. This is separate from the opportunity
ledger's current `NOW=0`: current quotes and already confirmed historical executions are different evidence periods.

## Competition evidence boundary

The new `/api/v1/competitors/earn` snapshot is `READ_ONLY_RECEIPT_CENSUS`. At `2026-09-13T10:33:02.140Z` it was still
`BACKFILLING` the exact seven-day range:

- start block: `55905563`;
- scanned through: `56925562`;
- safe head at that readback: `61888658`;
- transactions reviewed in the completed prefix: 542;
- confirmed lost races: unknown, not zero.

The service runs continuously and publishes a partial-coverage note until the full range is complete. Counts observed
during backfill must not be used to claim that the market has no competitors.

## Host maintenance and remaining issue

Before promotion the host had accumulated 76 immutable release directories and reached approximately 85% disk and
92% inode use. After proving which releases were not used by any running process, 73 obsolete release copies were
removed. They remain recoverable from Git/GitHub; runtime state, credentials, ledgers and evidence files were not
deleted. Final readback was 25% disk and 20% inode use.

The application and Alibaba Cloud Assistant were healthy, but new SSH connections from the deployment client began
timing out before the server banner. `ssh.service` was healthy, had no stale sessions, and a listener restart did not
change the network-path symptom. This did not interrupt any live or read-only application unit. Cloud Assistant remains
the verified recovery path; the SSH path still requires a separate network-edge investigation.

## Local post-evidence gate

`npm run check` passed after this evidence file entered the working tree. It covered Prettier, JavaScript/Solidity/shell
lint, checked-JavaScript type analysis, the production UI build, all three Cancun contract compilations, 296 Node tests,
all three deterministic contract suites and a 338-file secret/privacy scan. Local macOS skipped Linux-only
`systemd-analyze`; the linked Ubuntu CI receipt passed that Linux gate.
