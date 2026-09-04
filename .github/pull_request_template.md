## Story and acceptance criterion

Describe the small story this change completes and its observable business result.

## Risk boundary

State whether signing, nonce, receipt, balance, arm, RPC failure or deployment semantics changed.

## Evidence

- [ ] `npm run check`
- [ ] No credential, runtime state, log or signed raw transaction is included
- [ ] Runtime/deployment claims are backed by current readback rather than configuration alone
