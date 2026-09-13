# Universal cross-protocol live promotion evidence

- Status: production-observed
- Production release: `638e2cb6d85a764f76b35d63ef96bc7a073a41d2` (`v0.14.4`)
- Observation date: 2026-09-14 CST
- Chain: Robinhood Chain (`4663`)

## Scope

This record closes the first live promotion of the universal execution lane. The promoted system:

- builds one typed liquidity graph from Earn pools and canonical Uniswap v2, v3 and reviewed v4 pools;
- settles in USDG or WETH, with additional settlement assets admitted only when configured and backed by executor
  inventory or Morpho flash liquidity;
- executes mixed-protocol actions atomically through one deployed executor;
- consumes the ordered Sequencer Feed as an address-filtered wake source; and
- signs once, persists the exact raw transaction, submits it directly to the Sequencer, and allows only the same raw
  transaction as the managed-RPC fallback.

The signer never accepts a discovery quote as execution evidence. A route must remain positive through current-state
contract simulation, exact Gas estimation, nonce convergence, the authorization policy and a final pre-sign simulation.

## Deployment and release identity

The universal executor is `0xC167e650e8E3279a61d0650d963F65F768B031dA`. Its deployment transaction is
`0xa9f9ba79df5cfd8a5fdd9d2018752c5ad70d2fa6a691bb5dd68f86b3e0989f32` in block `62297386`.

Two independent RPC readers agreed on the successful deployment receipt, operator, Morpho identity and runtime code.
The materialized immutable runtime hash is
`0x189525d9135bb70015874c4afd4d054c06dcf0d20cc7882357431e900a90e0fd`. The release symlink and
`MANGA_RELEASE_SHA` both resolved to the production release above.

Before arming, `dual:runtime-verify` proved:

- operator wallet `0x77f771E83f118C32547A1291dda438a757B4b91B`;
- latest and pending nonce `28 / 28`;
- USDG executor `0x3f3A60A2da9E8D9811F41c6093280D7a90685aDD` with `35.344393 USDG`;
- WETH executor `0xeC6BB0511Eb7a348ad1879535F66320a51a3eDfc` with `0.0032 WETH`;
- the universal executor above; and
- no unresolved mutation.

The new until-revoked authorization was
`0x7e4af55dd99ec329bfe323b3676dc86dda35ff0edbbcc0adf314ac244351201e`. It replaced the explicitly revoked
pre-hotfix authorization. Execution, attempt and preflight counts are unlimited, while the immutable executor caps,
minimum net-profit floors, Gas reserve, failed-Gas breaker, nonce checks and revocation marker remain enforced.

## First canonical live result

The first live execution is
[`0xf4005c48f03b443be10879f487907205f2785ae2be3d78a1821069d3b577f856`](https://robinhoodchain.blockscout.com/tx/0xf4005c48f03b443be10879f487907205f2785ae2be3d78a1821069d3b577f856),
included in block `62323665` at `2026-09-14 06:49:13 CST`.

The decoded atomic plan was a Morpho-flash-funded three-hop cycle:

1. `0.000125 WETH` to Index through the canonical Uniswap v3 `0.05%` pool
   `0x36Ab2f1b987f4777724c6EF7bFD816660537719b`;
2. Index to NVDA through the Earn GLDN pool `0x9C22f8374aC9527162409BB28EF98B5f5E1708d2`; and
3. NVDA back to WETH through the Earn BIGTECH pool `0xf23942801CD33c75a2D6e4832BC2FB05Ca1044ec`.

The result was:

| Evidence                                        | Value                  |
| ----------------------------------------------- | ---------------------- |
| Principal, repaid in the same transaction       | `0.000125 WETH`        |
| Executor WETH balance before                    | `0 WETH`               |
| Executor WETH balance after / gross profit      | `0.000433643119225948` |
| Canonical Gas                                   | `0.00006500513252 ETH` |
| Realized net, denominated in WETH               | `0.000368637986705948` |
| Block-time normalized realized net              | `0.912668 USDG`        |
| Direct Sequencer submission                     | `ACCEPTED`             |
| Managed fallback                                | not used               |
| Wallet nonce after confirmation, latest/pending | `29 / 29`              |

The managed reader and the official public reader independently returned the same successful receipt, block hash,
`Executed` event, Gas, WETH balance delta and nonce. The public event reported the same plan hash, WETH settlement
token, principal, gross profit and `flashFunded=true` values committed before signing.

This is canonical receipt and balance-delta evidence. It is not a quote, simulation or dashboard-derived profit claim.

## Recovery and resource evidence

The exact signed raw transaction was persisted before broadcast with mode `0600`. Its locally recomputed Keccak hash is
the canonical transaction hash above. The mutation ledger has no unresolved entry.

The previous release imported Solc and rebuilt the executor on every wake, causing the 512 MiB watcher cgroup to OOM
before a live decision. `v0.14.4` moved compilation to release build and loads the bytecode- and source-hashed artifact
on the live path. On the first successful production wake:

- watcher peak memory remained below 380 MiB;
- `memory.events` reported `oom=0` and `oom_kill=0`;
- systemd restart count remained `0`; and
- the same process continued into subsequent global and Earn wakes.

## Runtime coverage and public readback

The running graph reported:

- 88 assets;
- 31 Earn pools;
- 29 active Uniswap v2 pools;
- 112 active Uniswap v3 pools;
- 5 reviewed Uniswap v4 pools;
- 760 directed swap edges and 46 Earn BPT hyperedges; and
- 5,343 USDG routes plus 5,876 WETH routes, including cross-venue cycles of up to three swap hops.

The Sequencer Feed connected without reconnects or transport errors and filtered frames against 237 relevant pool and
protocol addresses. The public dashboard health check recovered to HTTP 200. The static daily-profit endpoint and the
business read model both exposed the new receipt-gated global result; the five-minute reporter timer and ledger-change
path were re-enabled.

## Known limits and follow-up

- The official public RPC returned transient HTTP 429 responses during several densely clustered Feed wakes. Those
  wakes produced no signature, no failed Gas and no unresolved mutation; a later wake completed as
  `NO_EXACT_NET_OPPORTUNITY`. The next performance change should project each matched address to only its dependent
  routes before public quoting, instead of repeatedly reconsidering the wider bounded route set.
- V4 coverage is intentionally limited to five chain-attested, reviewed pool keys. A generic PoolManager event without
  a complete key is discovery evidence, not executable authority.
- USDG and WETH are the only armed settlement assets. Another asset requires explicit configuration plus proven
  executor inventory or Morpho liquidity and a trustworthy normalization path.
- The business dashboard's project total remains partial because not every historical operating cost is covered. The
  execution result above remains independently receipt-gated.

The production signer remains enabled and until-revoked. Emergency shutdown is revocation first, followed by stopping
the watcher; a signer must never be restarted after an unknown mutation without reconciliation.
