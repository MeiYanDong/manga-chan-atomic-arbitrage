# NINECAT source-attribution correction

- Observation date: 2026-09-07
- Chain: Robinhood Chain mainnet (`4663`)
- Correction status: PAIR attribution rejected; LONG route chain-attested
- Runtime impact: implemented in the v0.6.0 source-aware projection; production promotion is separately evidenced

## Corrected conclusion

NINECAT is not a PAIR launch. Its creation transaction called the verified `LongLauncher` contract, which then created
the token through Doppler Airlock and initialized a Uniswap v4 pool against Artificial Inu (`AI`). The strongest honest
label is therefore **LONG launch route**. The chain does not prove whether the creator used the long.xyz website, a bot,
an SDK or another client that called the same permissionless launcher, so the exact launch front-end remains `UNKNOWN`.

PAIR, LONG, Doppler and Uniswap describe different layers:

| Layer                    | Correct NINECAT value                                   |
| ------------------------ | ------------------------------------------------------- |
| discovery in this review | user-supplied transaction plus chain reconstruction     |
| platform launch route    | LONG (`LongLauncher`), chain-attested                   |
| exact creator client     | `UNKNOWN`                                               |
| creation protocol        | Doppler Airlock / Doppler ERC-20 v1 factory             |
| liquidity venue          | Uniswap v4 on Robinhood Chain                           |
| launch pair              | NINECAT / Artificial Inu (`AI`), not a stock-token pair |
| later observed route     | NINECAT → AI → ETH                                      |

## Chain evidence

| Fact                  | Evidence                                                                                                                     | Result                                          |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| NINECAT token         | `0x7d3f54f19038d5b819e8730606d048de9d0d1e18`                                                                                 | exact address                                   |
| creation transaction  | [`0xd9bd…1a69`](https://robinhoodchain.blockscout.com/tx/0xd9bd6b7d5cef0e8cc97838cb8d471b9f323ee6e6ac7aacd7e0146710e1a51a69) | success at block `45,879,015`                   |
| creation call target  | [`0x22e9…eeED`](https://robinhoodchain.blockscout.com/address/0x22e99278308B393ea1260859B181AD7E78f5eeED)                    | verified contract name `LongLauncher`           |
| creation sender       | `0x43831cfaa6c05289ac91361fc930b511eefdbddb`                                                                                 | transaction `from`                              |
| creation time         | block `0x2bc0ee7`, `2026-08-25T16:40:11Z`                                                                                    | RPC block timestamp                             |
| quote/numeraire       | `0x2e8c31162b855a2ffa90f6f8634643ad6f111e18`                                                                                 | Artificial Inu (`AI`)                           |
| shared protocol       | [`0xeb7c…0862`](https://robinhoodchain.blockscout.com/address/0xeb7c034704ef8dcd2d32324c1545f62fb4ad0862)                    | Doppler Airlock `Create` log                    |
| token factory         | `0x1b37d3a72082029c44b35b604ea473617580b69a`                                                                                 | canonical Doppler ERC-20 v1 factory in calldata |
| clone implementation  | `0x3be8b97fd0e713b5abe0649fa830223b6b4bc599`                                                                                 | decoded from EIP-1167 runtime bytecode          |
| pool hook/initializer | `0x4e3468951d49f2eea976ed0d6e75ffcb44a9a544`                                                                                 | Doppler hook; not either registered PAIR hook   |
| initial pool          | `0xee0963d99bcafb54879728c57df60df3e652095d3bc24890004d06c87d3ccd26`                                                         | PoolManager `Initialize`, NINECAT/AI            |
| reference sale        | [`0xc155…ba2f`](https://robinhoodchain.blockscout.com/tx/0xc15567e1b563abeb56014ec318264f84014bff8a1cdf0f44902973aa226aba2f) | NINECAT/AI pool then AI/ETH pool                |

The creation block is `0x2bc0ee7` (decimal `45,879,015`). The hexadecimal identifier and decimal rendering were checked
against the same RPC result.

The official Whetstone deployment registry independently maps Robinhood Chain's Airlock, factory and ERC-20
implementation to these addresses. See
[`Deployments.md`](https://github.com/whetstoneresearch/doppler/blob/main/Deployments.md). Robinhood's canonical asset
registry contained neither the NINECAT address nor the AI address in the dated readback, so neither leg may be labeled a
canonical Robinhood stock token.

As an additional dated observation, `GET https://pair.fund/api/tokens` did not contain the exact NINECAT address during
this review. That absence may change and is not the basis of the correction; the positive creation-route evidence is.

## Reproduction

The following reads require no key, signature or broadcast:

```bash
RPC=https://rpc.mainnet.chain.robinhood.com

curl --silent --show-error "$RPC" \
  -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"eth_getTransactionByHash","params":["0xd9bd6b7d5cef0e8cc97838cb8d471b9f323ee6e6ac7aacd7e0146710e1a51a69"]}'

curl --silent --show-error "$RPC" \
  -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"eth_getTransactionReceipt","params":["0xd9bd6b7d5cef0e8cc97838cb8d471b9f323ee6e6ac7aacd7e0146710e1a51a69"]}'

curl --silent --show-error "$RPC" \
  -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"eth_getCode","params":["0x7d3f54f19038d5b819e8730606d048de9d0d1e18","latest"]}'
```

The public endpoint is rate-limited and not production-grade. These commands are point-in-time evidence reads only.

## Root cause

1. **Reasoning error:** the research thread had shifted to PAIR multi-pool scanning, and I substituted the active
   scanner's scope for NINECAT's launch provenance.
2. **Semantic defect:** `catalogSources`, `apiCanonicalClaim` and the aggregated dashboard `source` block describe
   discovery and pool metadata but are easy to read as platform ownership.
3. **UI defect:** source information is footer-level; a row has no field-level evidence and no independent platform,
   protocol, venue or asset-class labels.
4. **Coverage defect:** the current board is PAIR-hook specific. It cannot claim that an item outside that adapter is a
   PAIR item, nor can it claim complete cross-platform coverage.
5. **Test gap:** there is no regression asserting that discovery source and launch platform may disagree, and no
   NINECAT fixture that must resolve to LONG route + Doppler + Uniswap v4 + custom AI pair.

ADR 0009 turns these findings into deterministic data and UI rules. The v0.6.0 implementation includes the NINECAT
fixture and source-aware read model; this document still does not claim a production deployment or current arbitrage.
