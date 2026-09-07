# Source provenance contract v1

- Contract status: implemented and integrated into the v0.6.0 board read model; production promotion pending
- Compatibility goal: additive migration from the current opportunity-board schema
- Unknown-value rule: absent evidence is `null`/`UNKNOWN`, never a fabricated default

## Evidence envelope

Every material claim references at least one immutable evidence envelope:

```json
{
  "evidenceId": "rh:4663:tx:0xd9bd...1a69",
  "kind": "TRANSACTION",
  "producer": "ROBINHOOD_PUBLIC_RPC",
  "observedAt": "2026-09-07T00:00:00.000Z",
  "chainId": 4663,
  "blockNumber": "45879015",
  "blockHash": "0x352d...eaf0",
  "transactionHash": "0xd9bd...1a69",
  "payloadHash": "0x...",
  "status": "OBSERVED"
}
```

`observedAt` describes the read. `blockNumber` and `blockHash` describe the chain fact. A source response that lacks a
block anchor cannot be upgraded into fixed-block quote evidence.

## Opportunity projection

```json
{
  "opportunityId": "rh:4663:0x7d3f...1e18:0xee09...cd26:0x6d6f...5edd",
  "target": {
    "address": "0x7d3f54f19038d5b819e8730606d048de9d0d1e18",
    "symbol": "NINECAT",
    "classification": {
      "value": "CUSTOM_TOKEN",
      "status": "REGISTRY_CHECKED",
      "evidenceIds": ["rh-assets:2026-09-07"]
    }
  },
  "provenance": {
    "discovery": [
      {
        "adapterId": "USER_REFERENCE",
        "claim": "REFERENCE_TRANSACTION",
        "observedAt": "2026-09-03T01:06:41+08:00",
        "evidenceIds": ["rh:4663:tx:0xc155...ba2f"]
      }
    ],
    "listings": [],
    "platformAttribution": {
      "platformId": "LONG_ROUTE",
      "status": "CHAIN_ATTESTED",
      "entryContract": "0x22e99278308b393ea1260859b181ad7e78f5eeed",
      "evidenceIds": ["rh:4663:tx:0xd9bd...1a69"]
    },
    "launchFrontend": {
      "value": null,
      "status": "UNKNOWN",
      "evidenceIds": []
    },
    "launchProtocol": {
      "protocolId": "DOPPLER",
      "status": "CHAIN_ATTESTED",
      "contracts": ["0xeb7c034704ef8dcd2d32324c1545f62fb4ad0862", "0x1b37d3a72082029c44b35b604ea473617580b69a"],
      "evidenceIds": ["rh:4663:tx:0xd9bd...1a69"]
    }
  },
  "route": {
    "inputAsset": "USDG",
    "legs": [],
    "liquidityVenues": [
      {
        "protocolId": "UNISWAP_V4",
        "poolManager": "0x8366a39cc670b4001a1121b8f6a443a643e40951",
        "poolId": "0xee0963d99bcafb54879728c57df60df3e652095d3bc24890004d06c87d3ccd26",
        "baseAsset": "NINECAT",
        "quoteAsset": "AI",
        "evidenceIds": ["rh:4663:tx:0xd9bd...1a69"]
      }
    ]
  },
  "quote": {
    "state": "UNQUOTED",
    "blockNumber": null,
    "blockHash": null,
    "amountInUsdg": null,
    "grossProfitUsdg": null,
    "gasCostProxyUsdg": null,
    "screenedNetUsdg": null,
    "evidenceIds": []
  },
  "execution": {
    "state": "NONE",
    "transactionHash": null,
    "realizedGrossUsdg": null,
    "realizedGasUsdg": null,
    "realizedNetUsdg": null,
    "evidenceIds": []
  }
}
```

The example intentionally does not claim a current arbitrage amount or result. Historical route reconstruction is not
a current executable quote.

## Independent state axes

One overloaded row status is insufficient. The projection exposes independent axes:

| Axis            | States                                                                                      |
| --------------- | ------------------------------------------------------------------------------------------- |
| attribution     | `UNKNOWN`, `CHAIN_ATTESTED`, `FIRST_PARTY_ATTESTED`, `CORROBORATED`, `CONFLICTED`           |
| catalog         | `DISCOVERED`, `ADMITTED_SHADOW`, `ADMITTED_EXECUTOR`, `QUARANTINED`                         |
| quote           | `UNQUOTED`, `FRESH_NO_EDGE`, `FRESH_PROXY_POSITIVE`, `UNQUOTABLE`, `STALE`                  |
| exact preflight | `NOT_RUN`, `PASSED`, `FAILED`, `UNKNOWN`                                                    |
| execution       | `NONE`, `SIGNED`, `BROADCAST`, `PENDING`, `CONFIRMED`, `REVERTED`, `UNKNOWN`                |
| economics       | `UNPROVEN`, `SCREENED_PROXY`, `RECEIPT_ONLY`, `RECEIPT_AND_EFFECT`, `REALIZED_NET_VERIFIED` |

The UI may derive a display summary, but API consumers always receive the axes.

## Required invariants

1. `listings[*].platformId` never populates `platformAttribution.platformId`.
2. A shared protocol contract can set `launchProtocol`, not a front-end platform.
3. `platformAttribution.status = CHAIN_ATTESTED` requires a registry-approved unique entry contract/event and a chain
   evidence ID.
4. `classification.value = RH_STOCK_TOKEN` requires an address match from the canonical Robinhood asset registry.
5. Token symbol, name, image, metadata URI and address suffix cannot classify a stock or platform.
6. `quote.state = FRESH_PROXY_POSITIVE` requires one block number/hash across all route legs and an explicit gas-proxy
   method.
7. `execution.state = CONFIRMED` requires a canonical receipt; `REALIZED_NET_VERIFIED` additionally requires balance
   effect and gas valuation.
8. `UNKNOWN` values remain queryable and cannot pass an execution-admission rule.
9. `CONFLICTED` attribution or execution evidence fails closed.
10. Every adapter exposes `lastSuccessAt`, `lastAttemptAt`, lag, coverage boundary and last sanitized error.

## Read-only BFF surface

| Endpoint                        | Purpose                                               |
| ------------------------------- | ----------------------------------------------------- |
| `GET /api/v1/overview`          | global health and clearly separated economic counts   |
| `GET /api/v1/opportunities`     | filterable Radar projection                           |
| `GET /api/v1/opportunities/:id` | route, evidence and attribution detail                |
| `GET /api/v1/sources`           | adapter registry, status and coverage boundaries      |
| `GET /api/v1/episodes`          | continuous economic opportunity episodes              |
| `GET /api/v1/executions`        | read-only intent/plan/receipt/effect projection       |
| `GET /api/v1/system`            | release, cursors, RPC pressure and persistence health |

No phase-1 endpoint accepts `POST`, transaction calldata, wallet credentials, arbitrary RPC methods or signer commands.

## Additive migration

1. Preserve the current snapshot and API while adding `schemaVersion: 4` provenance fields.
2. Populate new fields from deterministic adapters; leave unsupported dimensions `UNKNOWN`.
3. Add dual-read comparison and NINECAT regression tests.
4. Switch the private UI after projection parity and evidence invariants pass.
5. Retain `MANGA_BOARD_READ_MODEL=legacy` as a non-destructive rollback during the canary window.
6. Remove legacy `catalogSources` and footer-only source semantics only in a later breaking schema release.
