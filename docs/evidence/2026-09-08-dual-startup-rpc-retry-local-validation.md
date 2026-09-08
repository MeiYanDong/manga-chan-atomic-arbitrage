# Dual watcher startup RPC retry local validation

- Date: 2026-09-08 (Asia/Shanghai)
- Production mutation during diagnosis and local validation: none
- Active production release during diagnosis: `55177b8a28807b8ef91dded6f5378d6963a66467`
- Local verdict: accepted for reviewed promotion; production verification pending

## Production finding

After release `55177b8a` passed its Linux install gate and the signer-free board completed a healthy cycle, a controlled
dual-watcher restart received `429 Too Many Requests` while reading PoolManager bytecode from the configured official
public RPC. The watcher wrote `HALTED_STARTUP` and exited before loading a candidate, exact-preflighting, signing or
broadcasting.

The board was paused for eight seconds and the same authorization was started again. It reached `RUNNING` at
`2026-09-08T09:19:54.213Z`, recovered the temporarily absent signer feed, and had consumed three distinct generations
by `09:22:34Z`. The board completed a healthy cycle at `09:22:27Z`. Usage remained:

```text
exactPreflights=0
signedAttempts=0
confirmedExecutions=0
failedGasEth=0
```

A canonical runtime verification then returned chain ID `4663`, nonce `15/15`, `35.344393 USDG`, `0.0032 WETH`,
wallet Gas balance `0.00262778655474 ETH`, matching executor bytecode hashes, the unchanged until-revoked authorization
and no unresolved mutation.

## Correction

The dual watcher now retries the complete read-only startup evidence bundle up to five times. Backoff is 1, 2, 4 and 8
seconds. Retry state and audit output are redacted. The private credential is loaded only after chain identity,
deployment code/constants, principal balances, wallet balance/nonce and authorization usage all converge.

Only transport-classified failures retry. Wrong chain, code/constants mismatch, authorization or ledger inconsistency,
nonce conflict and unresolved mutation remain first-observation terminal failures.

## Verification

The focused gate passed formatting, ESLint, checked-JavaScript types and 25 relevant tests. Business assertions prove
that a `429 Too Many Requests` read recovers on a later attempt, a wrong-chain invariant is attempted exactly once, and
the signer load occurs after the retrying startup readback path. Full repository, Linux and production restart gates
remain required before this correction is called production-verified.

## Related design

- [Story: recover a dual watcher from a transient startup RPC throttle](../stories/dual-startup-rpc-retry.md)
- [ADR 0023: bounded dual startup RPC retry before signer load](../decisions/0023-bounded-dual-startup-rpc-retry.md)
- [Production promotion and remaining live-retry boundary](2026-09-08-post-quote-and-startup-reliability-production-promotion.md)
