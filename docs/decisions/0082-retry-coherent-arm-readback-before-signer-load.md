# ADR-0082: Retry a coherent arm readback before loading the signer

Status: accepted

Date: 2026-09-15

## Context

After v0.16.12 passed CI and production runtime verification, three consecutive one-shot arm attempts failed on an ERC20
`balanceOf` pinned to the block returned by the same managed RPC. The provider intermittently routed the subsequent
fixed-block read to a backend that reported `header not found`. No authorization was written, the watcher stayed
disabled, nonce remained unchanged and no transaction was signed.

The continuously running watcher already retries the same startup evidence on errors classified as transient, but the
one-shot arm performed the equivalent chain/deployment/nonce/principal read only once. Repeating the systemd unit by
hand was therefore an operational retry loop outside the audited policy.

## Decision

- Reacquire the complete canonical chain, verified deployment, wallet nonce/balance and fixed-block executor principal
  baseline as one read-only operation.
- Retry that operation at most five times with exponential delay only when `isTransientRpcError` admits the failure.
- Start every attempt from a fresh block; never combine a wallet snapshot from one attempt with principal from another.
- Preserve fail-fast handling for a pending nonce, zero principal, runtime mismatch and every other business invariant.
- Record each retry with a bounded, redacted diagnostic, and load the private key only after all read-only and economic
  gates converge.

## Consequences

Transient provider backend skew no longer requires an operator to repeatedly invoke the arm unit. The maximum extra
delay is bounded, the arm still writes only local authorization state, and it cannot turn an invariant into permission.
