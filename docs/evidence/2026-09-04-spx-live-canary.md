# SPX fixed-route live canary evidence

## Scope

This evidence record covers the isolated `USDG -> AAPL -> SPX -> NVDA -> USDG`
canary. The existing MANGA executor and its runtime state were not changed.

## Release and deployment

- source release: `60fa8fb041c97dd40576dd442a0615b73c5552ae`;
- source hash: `0x0a085f1ecd1af15b6007b5c9450cc73dc3a2e84a738094e5789d80a7c0fc8755`;
- executor: `0x5eA86EAFB0F918557E1cE76E68F407568Dc2bCcd`;
- deployment transaction: `0xb187570120b4d19d1baa9fbeb203adf29e808e50d033a1795d077b448eede0f0`;
- deployment block: `54358113`;
- deployment gas: `0.000432354300196 ETH`;
- seeded principal: `5.128343 USDG`;
- runtime bytecode: `4231 bytes`;
- runtime code hash: `0x27d996f187b176942b3181a93bbb061ddf96e99406752ea1290a663d40627577`.

The deploy command observed a successful receipt, then read back the exact
operator, runtime bytecode, USDG seed balance and clean nonce. The signing host
used the explicitly configured Robinhood official public HTTP RPC because both
available Chainstack endpoints returned HTTP 503 at deployment time.

## Execution effect

- transaction: `0xb1097719de30734c2672422d177ca50136929c264c0243c5070ad122b1b1a865`;
- block: `54358535`;
- amount in: `5.000000 USDG`;
- amount out: `5.502873 USDG`;
- gross profit: `0.502873 USDG`;
- gas used: `412048`;
- effective gas price: `361710000 wei`;
- gas spent: `0.00014904188208 ETH`, marked as `0.363918 USDG` at the receipt block;
- execution net profit after execution gas: `0.138955 USDG`;
- executor USDG after: `5.631216 USDG`;
- wallet ETH after: `0.002941695604316 ETH`;
- wallet nonce after: `latest=3`, `pending=3`;
- intermediate residuals: AAPL `0`, SPX `0`, NVDA `0`.

An independent public-RPC read observed a successful receipt and decoded the
`Executed(5000000, 5502873, 502873)` event. This proves the execution effect. It
does not make the strategy risk-free: a reverted attempt still spends gas, and
the one-time deployment gas is not included in the per-execution net figure.

## Verification and known issue

The release passed local and signing-host checks: formatting, JavaScript and
Solidity lint, shell validation, checked-JS type analysis, compilation, 22 unit
tests, deterministic contract tests and secret scan. GitHub Actions run
`33887198606` also completed successfully.

The first post-deployment `runtime-verify` correctly rejected the old MANGA
deployment manifest. The follow-up release adds the SPX-specific manifest and a
polling-only verification result for the explicit public-RPC canary. This change
does not alter the deployed Solidity source or bytecode.
