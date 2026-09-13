# ADR 0061: Commit the concrete runtime hash after materializing immutables

## Status

Accepted on 2026-09-14.

## Context

`UniversalAtomicExecutor` stores the reviewed operator as a Solidity `immutable`. The compiler's deployed-bytecode
object contains zero placeholders at every immutable reference. Constructor execution replaces those words in the
actual runtime. Committing the unmaterialized template hash therefore caused the successful v0.14.2 deployment to stop
at post-receipt verification even though its code length, operator and protocol identity were correct.

## Decision

Before signing a new deployment, compile with `evm.deployedBytecode.immutableReferences`, require exactly the reviewed
operator layout, replace every 32-byte placeholder with the ABI-padded operator and commit that concrete runtime hash.
Post-receipt and steady-state verification compare chain code to the concrete hash.

The already-mined v0.14.2 mutation is recoverable without changing its signed plan only when all of these hold:

1. the plan committed the exact compiler template hash and exact creation/source hashes;
2. its canonical receipt is successful and contains the expected deployment address;
3. the chain runtime equals the independently materialized concrete runtime;
4. `operator()` and `MORPHO()` equal the reviewed identities; and
5. both RPC readers and the wallet nonce agree on the terminal receipt.

Any other planned hash, runtime byte, identity or receipt state remains a hard failure. The recovery never signs,
rebroadcasts or deploys a replacement transaction.

## Consequences

- Future mutation plans bind the exact code that will exist after constructor execution.
- The v0.14.2 transaction can advance from `UNKNOWN` to confirmed state using its original receipt and raw transaction.
- The compiler template hash remains visible as diagnostic evidence but is never called the deployed runtime hash.
