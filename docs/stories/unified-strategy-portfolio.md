# Story: see every funded strategy account in one place

## Outcome

As the operator, I want one publicly readable Chinese funds page that answers which wallets and contracts still require attention,
what each one currently holds, which services are running and which stopped contracts still contain recoverable funds.

## Acceptance criteria

- The registry contains exactly two operator wallets, three active executors and two stopped-but-funded executors across
  Base and Robinhood Chain.
- The primary page says `7 monitored / 5 active / 2 awaiting collection` and never hides a funded stopped contract.
- Native ETH, USDG and WETH are read at one fixed block per chain; an incomplete read produces `PARTIAL` and never a
  fabricated zero or complete total.
- Every contract has runtime bytecode and immutable `operator()` checked against the expected wallet. Wallets expose a
  pending-transaction count without exposing nonce internals on the primary page.
- Addresses and explorer links stay behind deliberate disclosure; labels, balances and required actions remain primary.
- A first-screen funds map separates Base and Robinhood Chain, active principal, Gas wallets and parked balances without
  fabricating one cross-asset fiat total.
- The initial `0.01 Base ETH` has a receipt-linked historical reconciliation into retained wallet ETH, executor WETH and
  deployment/initialization Gas; those fixed bootstrap figures are not mislabeled as live balances.
- The Base service exports only a field-allowlisted same-host heartbeat. The dashboard cannot read the Base signer,
  private ledger, RPC detail, raw transaction or route failure text.
- The portfolio collector runs with the five-minute business snapshot, not inside the quote or signing hot path.
- Portfolio or Feishu failure cannot stop, arm, sign for, broadcast from or withdraw from either strategy.
- Desktop and mobile builds pass automated checks and visual inspection.

## Non-goals

- No transfer, withdrawal or consolidation action from the dashboard.
- No conversion of cross-chain WETH, native ETH or USDG into a fabricated single fiat total.
- No direct public exposure of the loopback Node listener, raw catalogs, event metrics or signer/runtime files.
- No claim that a healthy service or funded executor has produced profit.
