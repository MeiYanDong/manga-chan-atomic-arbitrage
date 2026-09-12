# ADR 0044: public read-only funds dashboard

- Status: Accepted
- Date: 2026-09-12
- Supersedes: ADR 0042 decision 5 only for presentation access

## Context

The sanitized portfolio already tracks two operator wallets, three active executors and two parked executors, but it was
reachable only through a key-only SSH tunnel. The operator explicitly chose public access and asked for the distribution
of project funds to be understandable without remembering addresses. Public addresses and balances are already visible
on-chain, but presenting them together discloses that they belong to one operating system.

The Node board also serves large raw catalogs and runtime diagnostics that are unnecessary for the business UI. Binding
that process directly to a public interface would expand the exposed surface and weaken the existing signer-free board
boundary.

## Decision

1. Keep `manga-opportunity-board` bound to `127.0.0.1:8788` under its existing signer-free Unix identity.
2. Publish `http://47.251.185.146/` through Nginx on TCP port 80. Proxy only static UI assets, `/healthz` and
   `/api/v1/*`; return 404 for other `/api/*` paths and allow only GET/HEAD.
3. Retain same-origin browser requests and add restrictive browser headers. Do not add login, wallet connection,
   arbitrary RPC proxying, write methods or transaction controls.
4. Present a current two-chain funds map before address-level cards. Keep ETH, WETH and USDG as separate units instead
   of inventing a single fiat total.
5. Record the initial `0.01 Base ETH` as a historical, receipt-linked reconciliation: wallet ETH after bootstrap,
   executor WETH and confirmed deployment/initialization Gas sum exactly to the deposit. Current balances remain a
   separate live projection.
6. Preserve the SSH tunnel for private operational endpoints and do not open TCP 8788 publicly.

## Consequences

- Anyone with the IP can associate all displayed addresses, balances and strategy labels. This is an accepted disclosure
  for this project, not a claim that other personal assets are covered.
- Private keys, signed raw transactions, provider credentials, the Feishu webhook, private ledgers and Base signer state
  remain outside the presentation snapshot and Nginx surface.
- Direct-IP HTTP has no transport authentication or TLS. No secret or mutation control may ever be added to this surface;
  a future domain should add HTTPS before any broader functionality.
- The board and signer remain independently recoverable if Nginx is stopped or the public firewall rule is removed.

## Acceptance

- Full repository checks and focused funds-view tests pass.
- Nginx configuration validation succeeds on the production Ubuntu host.
- Public `/`, `/healthz` and `/api/v1/business` return current data; `/api/event-metrics` is not public and POST is
  rejected.
- The public funds page shows both chains, all seven accounts, parked funds and the Base bootstrap reconciliation.
- Board and signer PIDs, release identity, authorization and nonce ownership remain unchanged except for the deliberate
  board-only UI release restart.
