# ADR 0042: sanitized cross-strategy portfolio projection

- Status: Accepted
- Date: 2026-09-11

## Context

The existing business console showed only the active Robinhood Chain dual-v3 capital. A separate Base canary and two
stopped fixed-route executors also hold funds, so the operator could not answer a basic question from one screen: which
wallets and contracts still need monitoring? Treating stopped contracts as absent hid `15.676618 USDG` of parked funds.

The Base signer, private heartbeat and mutation ledger are isolated under another Unix account. Making those files
generally readable would weaken the signing boundary, while moving balance reads into the quote loop would add avoidable
RPC work to the execution path.

## Decision

1. Keep a typed, public-address registry of two operator wallets, three active executors and two stopped-but-funded
   executors. A stopped contract remains monitored until a separately authorized withdrawal is receipt-reconciled.
2. At each five-minute business-report tick, read native ETH and the relevant USDG/WETH balances at one fixed block per
   chain. Verify executor bytecode and immutable operator identity. Any failed read makes the affected account and total
   partial instead of zero.
3. Add a dedicated `资金` page and one compact overview strip. Human labels, balances and required action are primary;
   full addresses, identity checks and explorer links are disclosed on demand.
4. Let the Base watcher publish a second `/run` heartbeat containing only an explicit field allowlist. Its private state,
   signer credential, route failures and RPC details retain their existing permissions. Production may grant the
   one-shot reporter supplementary membership in the Base runtime group solely to read this sanitized file.
5. Keep every portfolio endpoint same-origin, loopback-only and read-only. No POST, wallet connector, arbitrary RPC proxy,
   signing or withdrawal code is added.

## Consequences

- The operator can reconcile all currently funded accounts from one page and immediately distinguish operating capital
  from parked capital.
- The business reporter adds a small, bounded public-RPC read every five minutes. It does not compete in the execution
  hot path and does not expand ChainStack usage.
- A missing Base heartbeat or RPC response is visible as partial data; it cannot be mistaken for a zero balance or a
  stopped service.
- The public address registry must be updated whenever a new executor is funded or an old executor is fully collected.

## Production acceptance

- Both repositories pass their full local quality gates.
- The Base private state remains owner-only; only the sanitized `/run` heartbeat is group-readable.
- The one-shot reporter can read that heartbeat and produces a schema-v2 business snapshot containing seven accounts.
- The dashboard and `/api/v1/business` agree on `5 active`, `2 parked` and the current chain-read parked USDG balance.
- Both trading services retain active PIDs and clean nonce lanes after controlled restart.
