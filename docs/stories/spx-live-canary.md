# SPX fixed-route live canary

## Story

As the operator, I want one independently deployed, capital-bounded executor for
`USDG -> AAPL -> SPX -> NVDA -> USDG` so that a quoted cross-pool discrepancy can be
attempted atomically without changing the existing MANGA deployment.

## Risk envelope

- wallet: `0x77f771E83f118C32547A1291dda438a757B4b91B`;
- principal cap: `15 USDG` per transaction;
- deployment seed: `0.0021 ETH`, converted atomically to USDG;
- post-deployment wallet reserve: at least `0.0029 ETH` under the bounded deployment fee;
- on-chain gross-profit floor: `0.05 USDG`;
- off-chain expected and worst-case net-profit floor: `0.02 USDG`;
- route, V3 pools, V4 pool keys, PoolManager and hook are fixed in bytecode;
- no wallet token approval and no non-atomic intermediate position.

## Acceptance criteria

- The exact four-leg quote is taken at one block.
- A transaction-level `eth_call` returns the same output as the composed quote.
- Gas is estimated from the executor call and included in the net-profit gate.
- Nonce is clean immediately before signing and broadcasting.
- The signed raw transaction is persisted before broadcast and an unresolved attempt blocks a replacement.
- Success is accepted only after a canonical receipt, `Executed` event, exact USDG balance delta and zero intermediate-token residuals.
- A stale or unprofitable route returns `NO_SHOT`/fails closed without signing.
- Existing MANGA runtime paths, state and deployed bytecode are not modified.

## Verification commands

```bash
npm run check
node scripts/manga-chan-arb.mjs deploy-preflight
node scripts/manga-chan-arb.mjs preflight
node scripts/manga-chan-arb.mjs execute
node scripts/manga-chan-arb.mjs runtime-verify
```
