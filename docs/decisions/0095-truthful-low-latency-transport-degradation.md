# ADR 0095: Treat low-latency transport as an observed runtime capability

Status: accepted

## Context

Production can have a valid provider configuration while a particular transport is unavailable. On 2026-09-15 the
configured managed Robinhood endpoint returned chain ID 4663 over HTTPS, but the separately configured WSS credential
path did not upgrade to HTTP 101. A read-only probe that retained the verified HTTPS authority and credential while
changing only the protocol to WSS passed both chain identity and a live subscription. The official Sequencer Feed
independently returned HTTP 403 and a one-hour retry instruction. Public Earn log recovery, the local opportunity board
and periodic Global search remained healthy.

The previous supervisor retried the failed managed WSS every 30 seconds and the critical-health result still said
`TRADING_HEALTHY`. Neither behavior matched the operating truth: repeated handshakes added noise and provider load,
while the process was safe but slower than its intended event path.

## Decision

1. A configured URL is not evidence that its transport is connected. Runtime readback is authoritative.
2. Initial managed-WSS handshake failures use a bounded exponential schedule: 30, 60, 120, 240, 480 and at most 900
   seconds. A successful subscription clears the failure epoch.
3. Production may replace a stale WSS value only after a read-only candidate passes both the exact chain ID and an
   actual subscription. The value is updated atomically with original permissions and is never printed, committed or
   sent through the public API.
4. The official Sequencer Feed continues to honor server `Retry-After` and its existing bounded reconnect policy.
5. If both low-latency inputs are observably unavailable, trading health is `DEGRADED`, not `HEALTHY` and not
   `CRITICAL`. Public-log, periodic and board recovery continue, so this state does not send a Feishu page.
6. The public business snapshot contains only the number of connected low-latency paths, the bounded recovery
   intervals and next automatic retry time. Provider URLs, HTTP status, native client errors and credentials remain
   private diagnostics.
7. Event transport never grants transaction authority. Every candidate still requires current exact quote,
   simulation, Gas, reserve, nonce and profit checks; accepted profit still requires a canonical receipt and balance
   effect.

## Consequences

- A provider or public Feed outage no longer creates a reconnect storm or a misleading green status.
- Users can distinguish real-time discovery from slower recovery without seeing raw infrastructure fields.
- This change does not restore an unavailable provider. A working managed WSS endpoint, permitted official Feed,
  separately operated relay or another reviewed production provider is still required for full low-latency coverage.
- Polling frequency and managed-RPC budgets remain unchanged; the system does not buy speed by silently increasing
  paid usage.
