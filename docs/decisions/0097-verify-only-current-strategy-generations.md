# ADR 0097: Verify only current strategy generations during release promotion

Status: accepted

## Context

Strategy generations intentionally retain deployment and receipt evidence after they stop owning the signer lane.
The release verifier previously treated the presence of `generic-state.json` as proof that the generic watcher was
current. In production this made an obsolete loopback dependency time out and blocked validation of the active
dual/global generation, even though reconciliation was clean and no generic service was active or enabled.

## Decision

1. A retained state file remains historical evidence; it is not an activation signal.
2. The verifier runs a generation-specific runtime check only when that generation's watcher is active or enabled.
3. The dual verifier remains mandatory when the WETH deployment state exists because the current dual generation owns
   both base executors and the single wallet nonce lane.
4. The universal deployment status remains checked independently.
5. No historical state is deleted or rewritten by release verification.

## Consequences

- Obsolete strategy dependencies cannot block a current release solely because their evidence is retained.
- Active signer generations remain fail-closed on deployment identity, nonce and unresolved mutation.
- A service activation bug cannot be hidden by a state file; systemd ownership and runtime evidence must agree.
