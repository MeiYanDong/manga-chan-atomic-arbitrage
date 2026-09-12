# Live continuity and persisted business-report production evidence

- Date: 2026-09-13 (Asia/Shanghai)
- Functional production release: `d094220d8e4d40b26a4d1180a73c52864908c2d8`
- Previous watcher-continuity release: `56fa16228e74bfba449873453dad17a8aa03837a`
- Public dashboard: `http://47.251.185.146/`
- Scope: candidate-decay continuity, read-only business reporting and production readback

## Outcome

The live Robinhood Earn lane produced three new receipt-confirmed, Gas-inclusive profitable executions during the
current Beijing day. The current authorization remains `UNTIL_REVOKED`; sizing remains balance-scaled with no fixed
principal cap. The release did not widen routes, lower the protected final-profit floor or remove the lifetime Gas
solvency constraint.

Two operational failure modes were corrected without restarting the live signer during the final reporting rollout:

1. Release `56fa162...` classifies a quote or fee-cap decay between candidate discovery and final protected preflight as
   a normal candidate miss. The watcher records `NO_SHOT_NO_SIGNATURE_NO_BROADCAST` and continues instead of treating
   market decay as an invariant failure.
2. Release `d094220...` atomically persists a compact, versioned and allowlisted board projection. The business reporter
   reads this handoff independently of the board's busy JavaScript event loop, while bounded loopback HTTP remains only
   a fallback.

The new handoff contains only its evidence time, board health, four funnel counts and four source counts. It has a
64 KiB ceiling, mode `0640`, rejects group/world-writable files, expires after three minutes and is combined with the
actual systemd board liveness state. It contains no RPC URL, provider configuration, wallet identity, pool payload,
signing material or authorization data. A write failure cannot block the signer's separate execution feed.

## Receipt-confirmed economic result

The public schema-v3 business snapshot and the append-only execution ledger agree on the following current-day result:

| Transaction     | Route                     |                  Principal | Gas treatment                     |                Verified net |
| --------------- | ------------------------- | -------------------------: | --------------------------------- | --------------------------: |
| `0xa50b...bd44` | WETH -> AI -> WETH        | `0.001472354582686471 ETH` | included                          | `+0.000026757162131997 ETH` |
| `0x7f21...1ba`  | WETH -> MOO -> AI -> WETH | `0.001361335094140907 ETH` | included                          | `+0.000028370133910591 ETH` |
| `0xd85c...6656` | WETH -> AI -> WETH        | `0.001636794916531606 ETH` | `0.000031756347148 ETH`, included | `+0.000036211379891123 ETH` |

Current-day total: **three confirmed executions, `+0.000091338675933711 ETH` verified net, zero failed transactions
and zero failed Gas**. The final transaction receipt was independently read from the official Robinhood Chain public
RPC: status `1`, block `61390923`, expected sender and executor target, nonce `24`, and six logs.

The all-time marked strategy result is 18 confirmed executions, `+9.463562 USDG` and
`+0.000408741377705695 ETH`. These native-asset results remain separate. Whole-project business net is still `UNKNOWN`
because the operating-cost ledger has only partial historical coverage; no missing cost is treated as zero.

## Candidate-decay incident and continuity fix

At about 04:12 CST, the old watcher reached a gross-positive candidate but the current fee cap and final quote no longer
met the protected result before signing. It correctly created no signature or broadcast and spent zero failed Gas, but
its parent treated that final-market decay as a stop condition. PR #136 changed only this classification and added the
candidate-miss branch to the deterministic tests.

The new watcher was started after reconciliation showed no unresolved mutation. Its lock acquisition reclaimed the
dead predecessor's stale `dual-watch.lock` under the existing atomic lock policy. A later real event reached exact
preflight and ended `NO_SHOT_NO_SIGNATURE_NO_BROADCAST`; the new parent remained running and released the temporary
wallet lock. This production observation proves signer continuity after a no-shot event, while the precise fee-cap
decay branch remains directly proven by tests rather than a second naturally occurring production event.

## Immutable promotion and automated gates

- PR #135, loopback GET retry: GitHub Actions run
  `https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/actions/runs/34716759368` passed.
- PR #136, final candidate-decay continuity: PR job
  `https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/actions/runs/34717229917/job/103616549631` and protected-main run
  `https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/actions/runs/34717324156` passed.
- PR #137, persisted operations handoff: PR job
  `https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/actions/runs/34718633486/job/103620264809` passed.
- Local `npm run check` passed formatting, JavaScript/Solidity/shell lint, checked-JavaScript types, production UI build,
  all three Solidity compilers, `285/285` Node tests, all three deterministic contract suites and a `325`-file secret
  scan.
- The Ubuntu release gate passed Linux systemd verification, the production build, all three contract suites and a
  `313`-file source-archive secret scan.
- The exact GitHub source archive SHA-256 was
  `3f47a49b33924dbb49807891cb5711d88433f6a225a37da7a22c1fada00b1149`.
- Cloud Assistant invocation `t-usw6wvndxwnf7cw` completed successfully and removed its staged archive after
  acceptance.

No contract bytecode, private key, RPC credential, Feishu credential, authorization or funds changed during the
`d094220...` board/reporting promotion.

## Production runtime and soak readback

The final readback resolved `/opt/manga-chan-arbitrage/current` to the exact `d094220...` release and reported:

| Component                        | Runtime evidence                                                        |
| -------------------------------- | ----------------------------------------------------------------------- |
| Robinhood dual watcher           | systemd PID `4216`, Node/lock PID `4241`, active/running, `NRestarts=0` |
| Opportunity board                | PID `5290`, active/running, `NRestarts=0`                               |
| Base live canary                 | PID `2281`, active/running, `NRestarts=0`                               |
| Robinhood/BNB cross-venue shadow | PID `2207`, active/running, `NRestarts=0`                               |
| Report timer and ledger path     | active/waiting                                                          |

`dual-base-arb.mjs watch-status` reported `RUNNING`, lock PID `4241` alive and `unresolvedMutation=null`. The only signer
lock present was that live `dual-watch.lock`; no wallet lock or stale competing watcher lock remained. Board memory was
about 381 MiB at the final sample, with a 513 MiB observed peak under the 576 MiB cgroup ceiling.

The decisive production soak deliberately bounded a direct loopback board health request to one second. That request
returned no HTTP response while the event loop was busy, but `manga-business-report.service` completed successfully in
one second with `ExecMainStatus=0`. Its market evidence remained `HEALTHY`, and `market.observedAt` exactly preserved the
persisted board snapshot time. This demonstrates the intended independence instead of merely observing an idle board.

The first accepted persisted snapshot at `2026-09-12T21:06:10.362Z` reported 4,107 admitted candidate tokens, one fresh
quote, zero screened-positive and zero exact-ready routes, with source counts of 2,630 PAIR listings, 24,671 Long
routes, 55,184 Doppler targets and 80,196 retained pools. A later natural refresh advanced the market evidence to
4,109 candidates and 11 fresh quotes while remaining zero screened-positive and zero exact-ready.

## Public API and browser acceptance

The final external readback returned:

- dashboard `/`: HTTP `200`;
- live `/healthz`: HTTP `200` after the busy-loop soak;
- `/api/v1/business`: HTTP `200`;
- `/api/v1/profit/daily`: HTTP `200` with receipt-gated current-day results;
- `/api/v1/opportunities/chains`: HTTP `200` with current Robinhood and BNB shadow observations;
- unauthenticated `POST /api/v1/profit/daily`: HTTP `403`.

The GET surfaces are reachable from the public Internet without an address allowlist. The `403` is method protection
for a read-only API, not a client-IP restriction.

An in-app browser reload of the real production overview showed the Chinese-first, data-first view: today's
`+0.000091 ETH / 3` receipt-confirmed result, all-time `+9.46 USDG / +0.000409 ETH`, capital, opportunity count and
receipt-backed transaction rows. No raw provider or signing fields appeared, navigation remained clear and browser
warning/error logs were empty.

## Remaining evidence boundaries

- One intermediate public portfolio refresh was `PARTIAL`: Base balances were verified, but some Robinhood
  contract-token reads were unavailable in that cycle. The later `2026-09-12T21:20:03.732Z` public report recovered to
  `VERIFIED` for both networks, including `51.021011 USDG / 0.0032 WETH / 0.003025083246341695 ETH` on Robinhood Chain
  and `0.003 WETH / 0.006987074636027231 ETH` on Base. Future partial reads must still remain partial rather than
  borrowing this older complete total.
- Whole-project business net remains `UNKNOWN` because historical operating-cost coverage is partial. The receipt-gated
  strategy net is real but is not the same metric as whole-project profitability.
- `/healthz` intentionally queries the live board and can still time out during a long single-process maintenance
  cycle. The persisted business surface now remains current through that condition; eliminating the board's own
  event-loop latency is a separate scaling change.
- The Robinhood and BNB cross-venue engine is read-only shadow mode. Its final sample found zero gross-positive,
  Gas-adjusted-positive or executable cycles. It has no signing or broadcast authority.
- Arbitrary longer routes, new adapters and cross-platform live execution remain outside the reviewed authorization.
  They require separate contract-path, callback, token-behaviour, Gas, receipt-decoding and bounded-loss evidence.
