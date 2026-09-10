# Coalesced periodic source-projection production promotion — 2026-09-10

## Outcome

Release `3db3cc5a7b8096ce10a2516f7fe63b76f51aacc0` (`0.9.0`) is production-loaded on the signer-free opportunity board.
Three completed protected cycles each wrote the large source catalog exactly once. The dual signer remained on its
accepted release with the same PID and authorization and was not restarted or re-armed.

This release removed the targeted write amplification. It did not create a screened-positive opportunity, exact
preflight, signed transaction, receipt or profit. Production observation exposed the next independent bottleneck in
full snapshot publication.

## Reviewed artifact and gates

- Pull request: `#101`, `perf: coalesce periodic source projection`
- Required GitHub Actions run/job: `34490382348 / 102915268249`, passed in 1 minute 22 seconds before merge
- Merge/release commit: `3db3cc5a7b8096ce10a2516f7fe63b76f51aacc0`
- GitHub archive SHA-256: `ed1e4c8ac4d15cb9a1697580f45241e1526671d86f8f3cf99492d514c4bf6bda`

Local `npm run check` passed 237 Node tests, all three deterministic contract suites and a 255-file secret/privacy scan
alongside formatting, lint, checked-JavaScript types, dashboard build and compilation. The server independently matched
the archive hash and repeated 237 Node tests, all contract suites, a 237-file archive scan and Linux systemd
verification. Linux emitted only pre-existing warnings for the unrelated Alibaba Cloud monitor unit.

## Board-only promotion boundary

- Previous board PID/release: `271466 / 55df95ed9d152bd66bfe273cbee578caccb456b8`
- Promoted board PID/release: `272655 / 3db3cc5a7b8096ce10a2516f7fe63b76f51aacc0`
- Dual signer systemd/Node PIDs remained `265531 / 265553`
- Dual signer release remained `2f3007ddd9293863a56c0665cde30d6705b9f7a7`
- Both services retained `NRestarts=0`; the business-report timer remained active
- Rollback copies were retained with suffix `.before-3db3cc5a7b8096ce10a2516f7fe63b76f51aacc0`

Health succeeded on the 31st three-second attempt. It reported `HEALTHY`, SQLite `HEALTHY` with parity `true`, complete
configured-start chain/source catalogs and zero screened-positive rows.

## Source-projection activation evidence

- First cycle: cumulative writes `1`, last write `1,123.37 ms`, coalesced cycles `1`, total maintenance `59,329.61 ms`
- Second cycle: cumulative writes `2`, last write `898.11 ms`, coalesced cycles `2`, total maintenance `33,561.69 ms`
- Third observed cycle: cumulative writes `3`, last write `983.21 ms`, total maintenance `31,899.22 ms`

A 200-block hot poll after startup decoded 1,403 events, spent 222.11 ms in aggregate decode/route and completed in
692.06 ms. A later observation reached zero head lag. These are activation samples, not durable percentiles.

## Residual full-publication evidence

Across 35 sequential loopback probes with a two-second deadline, 22 returned HTTP 200 and 13 timed out. The current
compatibility snapshot measured 23,753,213 bytes, the SQLite read model 515,616,768 bytes and the source catalog
45,315,099 bytes. The board remained active with zero restarts; memory was 423,432,192 bytes and retained its earlier
470,286,336-byte peak.

At the same readback, 36 one-candidate event cycles had a latest candidate quote of 501.3 ms, a 5,137 ms queue delay and
6,223 ms observed-to-quote duration. Full-catalog publication still followed every routine event. This evidence led to
[ADR 0040](../decisions/0040-coalesce-non-material-event-publication.md); it does not invalidate the one-source-write
result.

## Signer and economic readback

The signer remained `RUNNING / ARMED / UNTIL_REVOKED` under authorization
`0x7039d0e14a6ccecb19f0ee4c75740362ab2a98b1e2eef43259a896bd3035cd62`. Spendable principal remained
`35.344393 USDG / 0.0032 WETH`, hard caps `100 USDG / 1 WETH`, and screen/exact-net floors `0.05 / 0.1 USDG`.

Current-authorization usage remained zero confirmed executions, zero signed attempts, two exact preflights and zero
failed Gas, with no unresolved mutation. The compact board feed contained zero candidates and the last decision was
`NO_SCREENED_OPPORTUNITY`. Managed-RPC caps therefore remain unchanged.
