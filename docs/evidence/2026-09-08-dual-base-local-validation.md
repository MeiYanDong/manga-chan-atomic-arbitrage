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

## Remaining production gates

1. Linux `systemd-analyze verify` and protected-branch CI.
2. Current production wallet ETH, nonce, generic executor balance, unresolved ledger, and service readback.
3. Explicit WETH seed selected only after current deployment Gas and retained operating reserve are known.
4. Canonical WETH deployment receipt and contract post-state.
5. Schema-v5 production board readback, dual runtime verification, durable generic-v2 disarm, dual arm, and service
   readback.
6. Any first live transaction must independently prove receipt, base-balance delta, canonical Gas, normalized net, clean
   residuals, and the next nonce. Until then, realized WETH PnL is `UNKNOWN`.
