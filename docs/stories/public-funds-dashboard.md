# Story: understand project funds from the public dashboard

> Presentation note: ADR 0045 moves the Base bootstrap reconciliation into the unified transaction ledger. The receipt
> remains available, but a standalone bootstrap panel is no longer an active acceptance requirement.

## Outcome

As the operator, I can open one public URL and immediately see where this arbitrage project's funds live, what is active,
what only pays Gas, and what is parked for later collection.

## Acceptance criteria

- The first funds view says it covers this arbitrage project rather than all personal wealth.
- Base and Robinhood Chain are visually separated and ETH, WETH and USDG retain their native units.
- The initial `0.01 ETH` deposit remains receipt-linked in the unified transaction ledger rather than a standalone
  funds-page panel.
- The funds page is a current-balance view; historical funding and deployment activity is visibly kept in the transaction
  ledger.
- Every monitored wallet and contract remains available below the summary with a full address and explorer link behind
  deliberate disclosure.
- Public access uses port 80 through Nginx. The Node board remains loopback-only, raw internal APIs stay private and all
  mutation methods are rejected.
- Desktop and mobile UI builds, product-language checks, isolation tests, Nginx validation and public production readback
  pass before completion is claimed.

## Non-goals

- No wallet connection, withdrawal, signing, broadcast or RPC credential in the browser.
- No fabricated USD conversion or claim that current balances equal profit.
- No coverage of wallets outside this arbitrage project.
