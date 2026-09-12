# Story: understand project funds from the public dashboard

## Outcome

As the operator, I can open one public URL and immediately see where this arbitrage project's funds live, what is active,
what only pays Gas, and what is parked for later collection.

## Acceptance criteria

- The first funds view says it covers this arbitrage project rather than all personal wealth.
- Base and Robinhood Chain are visually separated and ETH, WETH and USDG retain their native units.
- The Base bootstrap panel explains the exact `0.01 ETH` deposit, links the canonical funding transaction and shows that
  wallet ETH, executor WETH and bootstrap Gas reconcile without an unexplained difference.
- The current funds map is visibly distinct from the historical bootstrap receipt.
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
