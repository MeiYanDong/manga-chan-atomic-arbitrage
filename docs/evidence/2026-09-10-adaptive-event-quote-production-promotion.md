# Adaptive event-quote production promotion — 2026-09-10

## Outcome

Release `a9f5f99e4187f0996e0f4cf7bb8e6988d9705fa8` (`0.8.8`) is production-loaded on the signer-free opportunity
board. The continuously running dual signer remains on release `2f3007ddd9293863a56c0665cde30d6705b9f7a7`; it was
not restarted or re-armed.

The release materially reduced ordinary managed event call fan-out and removed the old pre-quote publication work. It
did not produce an executable opportunity, transaction receipt or profit. Public catch-up ingestion and large periodic
maintenance remain visible latency bottlenecks, so paid capacity was not expanded.

## Reviewed artifact

- Pull request: `#99`, `perf: shorten adaptive event quote path`
- Required GitHub Actions run/job: `34481572718 / 102885388938`, passed before merge
- Merge/release commit: `a9f5f99e4187f0996e0f4cf7bb8e6988d9705fa8`
- GitHub archive SHA-256: `80440ec6a42ba88968f9a1171d4619c6fcab5c6fe23bbfeb468c5ec1403c0a75`

The server installer independently passed formatting, JavaScript/Solidity/shell lint, checked-JavaScript types, the
dashboard build, all three compilations, 235 Node tests, all three deterministic Cancun contract suites, a 229-file
artifact secret scan and Linux systemd verification. The systemd verifier printed unrelated retained cloud-monitor
warnings; the MANGA units passed.

## Promotion and rollback boundary

The first Cloud Assistant deployment command was rejected by the remote `/bin/sh` before any service stop because an
unescaped `awk` positional field expanded under `set -u` (`line 26: 1: parameter not set`). The board, signer and timer
were untouched. The corrected command used `cut`, re-ran all artifact gates and then performed the board-only cutover.

- Board release/PID after promotion:
  `a9f5f99e4187f0996e0f4cf7bb8e6988d9705fa8 / 270120` (previous PID `267598`)
- Dual signer systemd/Node PIDs remained `265531 / 265553`
- Dual signer release remained `2f3007ddd9293863a56c0665cde30d6705b9f7a7`
- Both services reported `NRestarts=0`
- The business-report timer remained active
- Board rollback copies were retained under `/etc/manga-opportunity-board/` and `/etc/systemd/system/`, suffixed with
  `.before-a9f5f99e4187f0996e0f4cf7bb8e6988d9705fa8`; the retained signer release environment was also copied before
  promotion.

Loopback health returned `HEALTHY`, SQLite status `HEALTHY`, projection parity `true`, both chain/source catalogs
`COMPLETE_FROM_CONFIGURED_START`, and zero screened-positive candidates.

## Natural event evidence

The first three natural managed cycles after restart used 33 new-process managed logical calls: 11 per event. They
avoided six deferred amount quotes, ran all three USDG/WETH base cycles concurrently, used no adaptive expansion and
had no managed HTTP failure or public fallback. This is a 42% reduction from the pre-release aggregate of about 19.12
logical calls per managed event. Three events are activation evidence, not a durable rate guarantee.

At 17 natural cycles:

- `preFixedBlockMs` was 0.03 ms p50 and 0.14 ms maximum;
- ordinary candidate selection was 2.04 ms p50;
- 34 deferred amount quotes had been avoided;
- one transient managed failure had fallen back to the public reader without reaching the signer; and
- the managed operation median remained low, while one Multicall3 and one chain-id request each had a roughly 5.3–5.7
  second tail.

At the later `2026-09-10T13:55:34Z` readback, 18 managed cycles had made 188 new-process managed logical calls. Across
those and 27 subsequent public-fallback cycles, 90 deferred amount quotes were avoided. The durable daily candidate cap
had reached `200/200`. The logical-call cap still had 333 operations remaining, but candidate admission is an
independent hard boundary and was not increased.

## Remaining latency boundary

The board restarted behind the public hot cursor, so early 16–23 second poll-to-quote samples are catch-up evidence,
not steady state. A later 200-block public batch contained 1,349 decoded events and spent:

- 265.44 ms on V4 logs;
- 109.47 ms on V3 logs;
- 5,587.10 ms in combined decode/route work; and
- 5,016.27 ms on the final public anchor read.

The same readback still showed a 274-block head lag and 374 pending candidates. A separate periodic maintenance cycle
blocked a loopback API read for more than 20 seconds while the process stayed active. These observations show that the
next optimization belongs in public ingestion/source-index work, not in buying more managed quota. They led to
[ADR 0038](../decisions/0038-cache-validated-source-target-index.md).

## Signer and economic readback

After promotion the dual watcher remained `RUNNING / ARMED / UNTIL_REVOKED` with authorization
`0x7039d0e14a6ccecb19f0ee4c75740362ab2a98b1e2eef43259a896bd3035cd62` and no unresolved mutation. Spendable
principal remained `35.344393 USDG / 0.0032 WETH`, hard caps remained `100 USDG / 1 WETH`, and the screen/exact-net
floors remained `0.05 / 0.1 USDG`.

Current-authorization usage remained:

- confirmed executions: `0`;
- signed attempts: `0`;
- exact preflights: `2`; and
- failed Gas: `0 ETH`.

The execution feed was empty and the last signer decision was `NO_SCREENED_OPPORTUNITY`. Therefore realized net for
the active authorization remains `0`; historical executor receipts are not attributed to this release.
