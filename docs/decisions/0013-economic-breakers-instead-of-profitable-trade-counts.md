# ADR 0013: stop on economic risk, not accumulated profitable executions

- Status: Accepted by explicit operator direction; production promotion pending
- Date: 2026-09-07

## Context

The first two generic live authorizations used terminal totals for confirmed executions, signed attempts and exact
preflights. The first authorization stopped after five signed attempts even though four transactions had confirmed
positive net results and the fifth signed payload was proven absent and abandoned without Gas loss. Across the first six
confirmed generic executions, every transaction had positive receipt-backed USDG gross profit and positive
ETH-Gas-marked USDG net profit, with no on-chain revert. A terminal success counter therefore became a liveness limit
rather than a loss limit.

Six profitable receipts do not prove that future market regimes are risk-free. Removing the success counter must not
remove the boundaries that cap actual economic loss or ambiguous state.

## Decision

1. The generic watcher accepts the explicit configuration value `unlimited` for confirmed executions, signed attempts
   and exact preflights. The fixed-route watcher keeps its existing finite attempt policy.
2. `unlimited` removes only the terminal lifetime count for the current authorization. It does not bypass authorization
   expiry, failed-Gas budget, wallet ETH reserve, screened and exact net-profit floors, per-trade principal cap, quote
   freshness, opportunity deduplication, nonce convergence or the unresolved-mutation barrier.
3. A numeric value remains supported and keeps the previous finite behavior. Zero, negative, malformed and out-of-range
   numeric limits fail closed; `null` is the authorization representation of the explicit `unlimited` setting.
4. Status output renders an unlimited count as `UNLIMITED` rather than an ambiguous zero or missing field.

## Consequences

- Repeated receipt-confirmed profitable transactions do not stop an otherwise valid authorization.
- An execution revert still consumes the cumulative failed-Gas budget, and an unknown signed transaction still halts the
  wallet lane until reconciliation.
- Exact preflights can consume provider quota for every distinct promoted opportunity. The loopback screen,
  opportunity-level deduplication and explicit authorization expiry remain the current infrastructure boundaries; a
  rolling provider-rate budget can be added later without reintroducing a terminal lifetime counter.
- The operator still needs sufficient ETH above the configured reserve. Unlimited count authority cannot turn an
  underfunded wallet into an executable opportunity.
