# Generic-v2 local validation — 2026-09-05

## Evidence boundary

This record contains repository, deterministic local EVM, historical Robinhood Chain fork and current read-only quote
evidence. It contains no generic-v2 mainnet deployment, signature, broadcast, receipt or realized profit. Local Hardhat
addresses and transaction hashes below are not mainnet identities.

## Repository gate

`npm run check` passed locally with formatting, JavaScript/Solidity/Shell lint, checked-JS types, both deterministic
contract suites, `36 / 36` unit tests and a secret scan over `75` repository files. `git diff --check` also passed.
The Linux-only `systemd-analyze verify` step was explicitly skipped on macOS; it must still run in GitHub Actions or on
the release host. These working-tree changes have not been pushed, so no GitHub Actions run exists for this version.

## Build and deterministic contract

- Solidity: `0.8.26`, Cancun, optimizer 200, via IR.
- Generic source hash: `0x5b03b1f117600d2e241f67eaa5026adc80082172daaa28b7cf84dfc3f26da78e`.
- Creation code hash: `0x6c0b71f16b9e68a3f8a66f3d81593439223198309906b259a3368bead40c7d2a`.
- Creation/runtime size: `10,385 / 9,829 bytes`.
- The exact 100 USDG deterministic bridged route consumed `213,512` mock gas; the 25 USDG direct-anchor route consumed
  `159,891` mock gas.
- Exact balances increased by the expected gross profit; entry, target and exit residuals and USDG/exit router allowances
  were zero.
- Negative checks covered operator, 100 USDG cap, 0.05 USDG floor, expiry, both forged callbacks, endpoint mismatch,
  missing canonical V3 pool, more than two hops, non-WETH intermediary, V3 fee outside the allowlist, wrong PAIR hook,
  duplicate V4 pool and an unprofitable atomic revert.

Command:

```bash
npm run lint:sol
npm run compile
npm run test:contract
```

## Historical mainnet-fork execution

`npm run fork-test:generic` uses the checked-in, signer-free historical board fixture
`test/fixtures/generic-sigma-54406832.json`, forks canonical block `54406832` and replays the selected
`GOOGL -> SIGMA -> SNDK` route. The fixture revalidates to candidate hash
`0xb21865f814091515f9f2ffb6cd3c5250340637efd4ce96d8926c43d6010cc1e7` and execution key
`0xc0028ddc63549372a10c10e703e05e70ece2df031eece0115908c137d0cdf877`:

- local executor: `0x512F7469BcC83089497506b5df64c6E246B39925`;
- local deployment gas: `2,329,237`, seeded balance `24.504630 USDG` from `0.01 ETH`;
- selected input: `15 USDG`;
- exact output/gross: `15.856634 / 0.856634 USDG`;
- estimated/receipt execution gas: `689,963 / 572,082`;
- all three intermediate residuals and both relevant router allowances: zero.

The explicit result label was `LOCAL_FORK_ONLY_NO_MAINNET_BROADCAST`.

## Current read-only board observation

A fresh one-cycle validation generated at `2026-09-04T22:48:35.111Z` reported:

- complete discovered PAIR catalog: `1,887 / 1,887` source tokens;
- admitted multi-pool candidates: `496`;
- freshly quoted in that bounded cycle: `47` (`9.48%`), so this is not a simultaneous exact census of all 496;
- screened net-positive: `0`;
- `ASS` was gross-positive at 5 USDG (`+0.295034`) but net-negative after the calibrated gas proxy
  (`-0.167829`); larger configured sizes were unquotable in that observation;
- `SIGMA` was net-negative in the refreshed state.

The official public RPC returned a 60-second rate-limit response immediately after the broad validation cycle. That is
runtime evidence for keeping discovery on a bounded read lane and using a managed execution RPC; it is not evidence that
the board cycle itself failed.

## Sniper specification

`docs/sniper-spec.v2.json` passed the skill validator with three correctness invariants, one adaptive gate and one soft
check. Its operating profile remains `shadow`: generic signing and broadcast code exists, but mainnet invocation and
canonical receipt evidence are explicitly unverified.
