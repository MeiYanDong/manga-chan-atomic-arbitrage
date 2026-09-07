# ADR 0017: explicit public execution-RPC fallback

- Status: Accepted as an emergency fallback
- Date: 2026-09-08

## Context

The configured managed execution RPC rejected startup identity reads because the provider account was paused for unpaid
invoices. No exact preflight, signature or broadcast had occurred. The operator had already directed the system to use
public RPC before paying for additional capacity.

Robinhood documents that its mainnet public RPC can read chain data and broadcast transactions, but is rate-limited,
not intended for production-grade, high-throughput or latency-sensitive applications, and has no uptime guarantee.
Silently falling back would therefore change execution risk without an auditable decision.

## Decision

Keep public execution RPC rejected by default. Permit the official endpoint only when
`MANGA_ALLOW_PUBLIC_EXECUTION_RPC=1` is set explicitly in the private production configuration. The generic watcher's
idle path continues to read the local persisted board feed, so the public execution endpoint is used only for startup
identity/nonce/balance checks and after a candidate clears the local economic gate.

The normal chain-ID, code, operator, token identity, current nonce, balance, exact simulation, gas, profit, deadline and
authorization checks remain unchanged. If receipt evidence becomes ambiguous and no independent reader is available,
the result remains `UNKNOWN` and blocks the next nonce.

## Consequences

- Service can resume without waiting for managed-provider billing recovery.
- Rate limiting, latency, broadcast availability and race performance are materially worse or unknown.
- The flag is evidence of accepted provider risk, not evidence that the endpoint is production-grade.
- Managed execution RPC should replace the fallback after credentials and billing are independently verified.
- One signer and one nonce source remain unchanged; this decision does not authorize multiple signed transactions or
  blind rebroadcast.
