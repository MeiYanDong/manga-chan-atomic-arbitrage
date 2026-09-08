# Story: recover a dual watcher from a transient startup RPC throttle

## Outcome

As the live operator using the official public RPC fallback, I want one transient startup `429` to delay the dual
watcher safely instead of leaving its systemd service failed until a manual restart.

## Acceptance criteria

- Startup chain identity, executor code/constants, balances and nonce readback retry only transport-classified errors.
- Retry is bounded to five attempts with `1/2/4/8` second backoff between attempts.
- Every retry writes redacted `DEGRADED_STARTUP_RPC` state and an append-only audit event.
- The private credential is loaded only after all startup public-chain evidence and local authorization checks converge.
- Wrong chain, bytecode/constants mismatch, revoked or malformed authorization, inconsistent ledger/balance, pending
  nonce and unresolved mutation fail immediately without retry.
- No retry signs, persists raw transaction data, broadcasts or consumes failed-Gas budget.

## Non-goals

- No claim that the official public RPC is production-grade or continuously available.
- No relaxation of execution-RPC failure limits after exact preflight begins.
- No automatic authorization replacement, provider purchase or secret change.
