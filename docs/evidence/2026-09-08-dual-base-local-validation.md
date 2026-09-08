# Dual-base local and public-RPC validation — 2026-09-08

## Scope and evidence boundary

This record covers source, deterministic EVM, CLI, and one signer-free public-RPC board cycle. It is not WETH executor
deployment, production service, live transaction, receipt, or profit evidence. The existing generic-v2 production
deployment was not changed by this validation.

## Local quality gate

Command:

```bash
npm run check
```

Result:

- Prettier, ESLint, Solhint, shell syntax, checked-JS type analysis, and Vite production build passed.
- `172/172` Node tests passed, including WETH-only dashboard projection, dual-board identity, conservative normalized
  screening, WETH-only economic episodes, and external-top-up authorization isolation.
- Fixed, generic USDG, and WETH deterministic Cancun EVM tests passed.
- The WETH test measured `215606` Gas for the exercised two-hop route and `162416` Gas for the direct route.
- Constructor evidence proved `0.02 WETH` from a `0.02 ETH` seed and zero stranded native ETH.
- Route residuals and router allowances were zero after both successful WETH paths.
- Negative tests covered operator, deployment cap, profit floor, deadline, forged callbacks, path endpoints, missing
  pools, hop/bridge policy, hook identity, duplicate V4 pools, and unprofitable atomic revert.
- Secret scan passed across `177` repository files.
- `systemd-analyze` was unavailable on macOS, so Linux unit semantic verification remains a CI/release-host gate rather
  than being reported as passed here.

Build identities:

```text
Existing GenericAtomicArb source hash:
0x5b03b1f117600d2e241f67eaa5026adc80082172daaa28b7cf84dfc3f26da78e

WethAtomicArb source hash:
0xcebb5a9911bcb49ef198e4bd105b3ed817f476c51c45434b5ff31f97e94715c7

WETH source bundle hash:
0x86905c76489db029ceeee55702e295f18c47941cb0cfbaa39383b976d4bf7a86

WETH creation code hash:
0xeeceb704bd3476f51b67d867047c31218593fa6ba35d813abcfd6c36c58c02e4
```

The dependency hash in the WETH build equals the unchanged GenericAtomicArb source hash.

## GitHub CI gate

[PR #60](https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/pull/60) ran the Ubuntu `quality` job against
commit `946266c` in [Actions run 34189495705](https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/actions/runs/34189495705).
The run completed with `success`. Its fresh checkout executed the complete `npm run check`, including Linux
`systemd-analyze verify`, `172/172` Node tests, all three deterministic contract tests, and a `159`-file secret scan.
The different local and CI scan counts reflect checkout/generated-file scope; both reported `SECRET_SCAN_PASSED`.

## Signer-free public-RPC dual quote

The temporary run used Robinhood's official public endpoint, one HTTP request at a time, WETH mode enabled, a one-row
periodic batch, and a reduced `5,10 USDG` validation grid. No wallet, signer, private key, simulation against a deployed
WETH executor, or broadcast path was loaded.

Result at snapshot generation `2026-09-08T04:57:13.917Z`:

- schema `5`, service health `RUNNING`, `signerLoaded=false`;
- `687` bounded HTTP POSTs carrying `727` logical quoter calls, with peak transport concurrency `1`, `65` bounded
  logical retries, and one fail-closed batch-to-individual fallback;
- `861` discovered candidate tokens, `4` quoted historically and `2` fresh in this deliberately bounded cycle;
- both USDG and WETH lanes used block `57419911` and block hash
  `0x66cd48b05afc90c706e2dfb08ff1e53e1e6e47994ebc6891f2af4f8259654358`;
- SIGMA USDG best screen: `7.5 USDG`, normalized net `-0.070903 USDG`;
- SIGMA WETH best screen: `0.003022571353841949 WETH`, normalized net `-0.137301 USDG`;
- the WETH exit path decoded to `INTC -> USDG -> WETH`, proving the approved USDG bridge rather than the obsolete
  self-bridge encoding;
- StockCat was `UNQUOTABLE` in both bases; and
- `baseSelection=NO_SCREENED_BASE_NET_POSITIVE`, `executionAuthorized=false`, so the compact execution feed retained
  zero rows.

This cycle proves the additive schema, same-block dual quote, conservative common-unit comparison, signer isolation,
approved bridge encoding, and positive-only feed behavior. The quote cycle completed, while the independent historical
PAIR chain-catalog backfill was `BACKFILL_PARTIAL` after the public endpoint returned HTTP 429. That partial discovery
state was retained explicitly and did not become execution evidence. This cycle does not estimate opportunity frequency
and correctly produced no transaction.

## Production pre-cutover readback

A read-only check of the `manga-chan-arb-us-west` SWAS host at approximately `2026-09-08T05:17Z` confirmed the existing
release `b8ab13509be6f9c033d51054759162eaff5f34a1` was still active. The board and generic watcher were both
`active/running` with zero service restarts. No production file, service, authorization, or chain state was changed by
this check.

Canonical runtime verification reported:

```text
chainId=4663
walletEth=0.006441287054404
nonceLatest=14
noncePending=14
genericExecutor=0x3f3A60A2da9E8D9811F41c6093280D7a90685aDD
executorUsdg=35.344393
confirmedExecutions=10
unresolvedMutation=null
boardMode=READ_ONLY_NO_SIGNING_NO_BROADCAST
boardSignerLoaded=false
```

The until-revoked generic arm had confirmed two executions after its eight-execution baseline, from four exact
preflights and two signed attempts, with zero failed Gas. Its last confirmed transaction was
`0x62414964fa7ce9e8494826792a1181733dad12e392cd1fd01a3f06e43921ffa9`, and its recorded normalized net profit was
`1.05211 USDG`. These are generic-v2 receipt/ledger results, not WETH or dual-v3 results.

## Remaining production gates

1. Protected-branch review/merge and commit-addressed release installation.
2. Explicit WETH seed selected only after current deployment Gas and retained operating reserve are known.
3. Canonical WETH deployment receipt and contract post-state.
4. Schema-v5 production board readback, dual runtime verification, durable generic-v2 disarm, dual arm, and service
   readback.
5. Any first live transaction must independently prove receipt, base-balance delta, canonical Gas, normalized net, clean
   residuals, and the next nonce. Until then, realized WETH PnL is `UNKNOWN`.
