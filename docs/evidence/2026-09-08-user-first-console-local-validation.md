# User-first operations console local validation

- Date: 2026-09-08 (Asia/Shanghai)
- Branch: `feat/user-first-operations-console`
- Production mutation during this validation: none
- Chain mutation during this validation: none

## Product result

The dashboard now leads with the current strategy result rather than the evidence schema. Primary navigation is limited
to 总览, 机会, 账单 and 更多. Account-wide historical profit is visibly separated from the current strategy result;
opportunities default to the executable stage; exact money, Gas, hashes, addresses and claim evidence require an
explicit expansion.

The source view keeps PAIR, LONG, Doppler and generic on-chain pools separate and explicitly states that NINECAT is not
a PAIR listing. The dashboard remains loopback-only and read-only. No signer, wallet, RPC, Gas, amount, threshold,
authorization or trading-policy code changed.

## Browser verification

The production API was read through the existing private SSH forward while the new frontend ran locally. Browser checks
covered the overview, all three opportunity stages, one opportunity explanation drawer, the receipt ledger disclosure
and the source/system page.

- At 389 CSS pixels, the document and viewport widths both remained 389 pixels.
- At 768 CSS pixels, the document and viewport widths both remained 768 pixels.
- At 1440 CSS pixels, the document and viewport widths both remained 1440 pixels.
- The default opportunity view did not expose a token address.
- Opening an opportunity showed its plain-language reason before the collapsed technical evidence.
- Opening a receipt showed exact gross result, Gas and a fixed Blockscout link only after deliberate disclosure.
- The live values observed during the check included zero exact-ready routes and, later, one transient near-threshold
  route. These values are time-bound observations, not an execution or profit claim.

## Automated gates

`npm run check` passed on macOS after the product-language and isolation regressions were updated. It covered formatting,
JavaScript/Solidity/shell lint, checked-JavaScript types, the production Vite build, 194 Node tests, deterministic
contract suites and the repository secret scan. The Linux-only `systemd-analyze verify` step was accurately skipped
locally and remains a production-release gate.

## Remaining verification boundary

This document proves the local build against live read-only API data. It does not prove production promotion, a new
Feishu delivery or a new arbitrage execution. Those require separate production service, browser and receipt readback.
