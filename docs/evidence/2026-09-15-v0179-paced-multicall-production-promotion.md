# v0.17.9 paced Multicall production promotion — 2026-09-15

Evidence state: immutable release installed; pacing active; embedded transient failure gap found; live signer inactive.

## Release and installation

- PR `#198` passed CI run `34964226999` and merged as
  `9c704bbcf78ba5a32d5f2fd030f3d391c57caed1`.
- Main CI run `34964447947` and release workflow `34964670827` passed.
- The CI archive SHA-256 was `18dfa6ec560d4879f478fae612c153f2c281902c73113df80cc403623ff6f04d`.
- The codeload archive SHA-256 was `bcde1a6d052ee4ef45493ef914c487497493b7b2b5a9bf351d0c50dc112c8f1b`.
- Cloud Assistant invocation `t-usw6x4z0lj3rpc0` installed the exact commit. Production compilation, secret scan and
  Linux unit verification passed; the only unit warnings belonged to Alibaba `cloudmonitor.service`.
- The board ran from the new release and returned HTTP 200 `HEALTHY`. Atomic-cycle stayed at PID 781 in its own release.

## Production refresh

The schema-v4 refresh ran from 19:46:11 to 19:49:59 Asia/Shanghai and published block `63,633,536`:

- 32 Earn, 29 V2 and 119 total V3 pools;
- 110 V3 pools were fresh and nine were exact-query retained;
- 48 V3 queries remained transport-partial;
- the 48 errors were three 12-item V3 factory batches and one 12-item state batch, all `THROTTLED`;
- policy evidence showed 94 requests but zero retries and zero transient failures.

The contradiction is explained by viem resolving the failed aggregates as all-failure arrays under `allowFailure`, not
by the absence of pools. ADR 0093 addresses this adapter boundary. The total 119 V3 count depended partly on prior
topology retention and therefore did not make the current generation complete.

`manga-dual-watcher.service` and the critical timer remained inactive. No signature, transaction, Gas, receipt or
profit is attributed to v0.17.9.
