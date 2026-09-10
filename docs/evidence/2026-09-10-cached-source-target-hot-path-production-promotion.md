# Cached source-target hot-path production promotion — 2026-09-10

## Outcome

Release `55df95ed9d152bd66bfe273cbee578caccb456b8` (`0.8.9`) is production-loaded on the signer-free opportunity board.
The continuously running dual signer remains on release `2f3007ddd9293863a56c0665cde30d6705b9f7a7`; it was not restarted or
re-armed. No screened-positive opportunity, signed transaction, confirmed execution or new profit resulted.

## Reviewed artifact and gates

- Pull request: `#100`, `perf: cache source targets on event hot path`
- Required GitHub Actions run/job: `34486564423 / 102902236853`, passed before merge
- Merge/release commit: `55df95ed9d152bd66bfe273cbee578caccb456b8`
- GitHub archive SHA-256: `fdc963dee4752880d4de022d98b8e654fd0d95803bf495518eefdbf83ad1daaa`

Local `npm run check` passed 236 Node tests, all three deterministic contract suites and a 251-file secret/privacy
scan in addition to formatting, lint, checked-JavaScript types, dashboard build and compilation. The server installer
repeated the full artifact gates, including Linux systemd verification and a 233-file artifact scan.

## Board-only promotion boundary

- Board PID/release after promotion: `271466 / 55df95ed9d152bd66bfe273cbee578caccb456b8`
- Dual signer PID/release remained: `265531 / 2f3007ddd9293863a56c0665cde30d6705b9f7a7`
- Both service restart counters remained zero
- The business-report timer remained active
- Loopback health became `HEALTHY`; SQLite status was `HEALTHY`, parity was `true`, both source catalogs were
  `COMPLETE_FROM_CONFIGURED_START`, and the board showed zero screened-positive rows

Rollback copies were retained under `/etc/manga-opportunity-board/`, `/etc/systemd/system/` and
`/etc/manga-chan-arbitrage/`, suffixed with `.before-55df95ed9d152bd66bfe273cbee578caccb456b8`.

## Production performance evidence

The first catch-up poll after restart scanned 200 blocks and decoded 1,177 events. It spent 237.07 ms decoding, 2.09 ms
coalescing, 1.21 ms ingesting Initialize events and 11.86 ms routing/queuing: 252.23 ms aggregate. Final anchor read was
85.04 ms and total poll time was 1,088.91 ms. Compared with the preceding same-range observation of 5,587.10 ms
aggregate decode/route and 11,309 ms total, this was a roughly 95.5% and 90.4% reduction respectively. It was a short
catch-up comparison, not a durable guarantee.

At `2026-09-10T14:29:20Z`, a later 79-block poll decoded 548 events, routed 20 relevant events to 506 candidate wakes,
spent 64.64 ms in aggregate decode/route and completed in 824.57 ms. Head lag was 79 blocks. The service was healthy
with 3,556 admitted candidates, complete configured-start catalogs and SQLite parity.

## Remaining bottleneck

The 45,294,139-byte source catalog could still be synchronously written up to four times inside one protected periodic
cycle. The board used 424,701,952 bytes at the readback and had peaked at 470,286,336 bytes within its 512 MiB limit.
Earlier loopback reads timed out during periodic maintenance even though the process stayed active. This remaining
write-amplification boundary led to [ADR 0039](../decisions/0039-coalesce-periodic-source-projection.md).

## Signer and economic boundary

The active dual authorization still had zero confirmed executions, zero signed attempts, two exact preflights and zero
failed Gas, with no unresolved mutation. The execution feed remained empty and the signer decision remained
`NO_SCREENED_OPPORTUNITY`. Managed-RPC caps were not increased: capacity expansion still requires canonical receipt net
after Gas and provider cost, which does not yet exist.
