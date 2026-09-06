# ADR 0007: bind the in-flight signed attempt at the broadcast boundary

- Status: Accepted for implementation; production promotion pending
- Date: 2026-09-06

## Context

The generic watcher counts durable `mutation_signed` records as attempts. Its fifth authorized execution passed the
pre-sign check at four attempts, persisted the signed raw and appended the fifth record, then repeated the same
`attempts >= maxAttempts` check before broadcast. That check treated the current transaction as if it were a new sixth
attempt. The watcher stopped cleanly, but left an unresolved signed transaction that was never submitted.

Changing the comparison to `attempts > maxAttempts` would make the fifth transaction pass after signing, but it would
also allow a new sixth transaction to reach signing. The boundary needs lifecycle identity, not a looser numeric cap.

## Decision

Keep the existing pre-sign attempt cap. After raw persistence, pass an explicit current-attempt reservation to the
final authorization check. The reservation must match exactly one audit record on authorization ID, mutation kind,
intent ID, immutable plan hash, transaction hash and nonce. It must also be the latest authorized signed attempt and
the latest unresolved mutation.

Only for that exact in-flight reservation, subtract one from the signed-attempt count while evaluating whether this
transaction was permitted to begin. Expiry, confirmed executions, failed Gas and exact preflights are evaluated without
adjustment. Missing, stale, duplicate, terminal, reordered or mismatched evidence fails closed.

Provider error text and diagnostic stacks are sanitized before persistence or console output so a credential embedded
in an RPC URL cannot enter the runtime state, audit ledger or service journal.

`reconcile --abandon-expired` may append a terminal `EXPIRED_NOT_OBSERVED` record only for a generic execution whose
deadline is behind both independent readers' chain timestamps and whose hash and nonce are absent at both readers. The
same raw replay path rejects such an expired execution.

## Consequences

- The last authorized transaction can be broadcast while the next transaction remains blocked before signing.
- The signed raw remains durable before broadcast and UNKNOWN reconciliation semantics do not change.
- The current call cannot borrow a reservation from another plan, nonce, hash or authorization.
- Existing leaked endpoint credentials still require provider-side rotation; redaction prevents future log exposure but
  does not revoke an already exposed credential.
- Production recovery requires two independent readers to classify the expired raw before a new arm is created. The
  raw must not be rebroadcast after its deadline.
