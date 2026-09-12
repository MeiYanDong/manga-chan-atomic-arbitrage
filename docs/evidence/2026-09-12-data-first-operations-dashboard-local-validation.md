# Data-first operations dashboard local validation

- Date: 2026-09-12 (Asia/Shanghai)
- Branch: `feat/data-first-operations-dashboard`
- Production mutation during this validation: none
- Chain mutation during this validation: none

## Product result

The dashboard is now a restrained, Chinese-first operations view with four primary pages: 概览, 交易, 资金 and 策略.
The overview leads with verified strategy results, spendable principal, executable opportunities and project economics.
Capital transfers, deployments, authorizations, arbitrage receipts, collections and failed transactions share one
newest-first activity ledger. The original Base funding is therefore an ordinary transaction record instead of a
special funds-page story.

Native assets remain separate in the project ledger. USDG profit, ETH/WETH profit and native Gas are not converted into
one invented total. Addresses, transaction hashes, block numbers and explorer links remain available only after an
explicit evidence disclosure. No execution threshold, signing, nonce, broadcast, authorization or contract code changed.

## Browser verification

The new frontend ran locally against a schema-v3 presentation proxy assembled from the checked-in reviewed history and
the production read-only API. The check covered all four pages, transaction filters, the receipt drawer, the funds map
and the strategy/source view.

- Desktop width `1440` rendered the operating metrics and tables without overflow.
- Mobile width `390` rendered the funds summary and all wallet/contract rows as labelled data records without horizontal
  scrolling.
- The receipt drawer exposed the Base capital-in transaction hash and block only after selecting 凭证.
- A simulated slow or unavailable presentation endpoint did not block successful business data; the page retained the
  last successful values and displayed a partial-data warning.
- Browser warning and error logs were empty after the final strategy-page check.

The observed balances and opportunities were time-bound read-only inputs. This browser validation is not evidence of a
new trade, new profit or production promotion.

## Automated gates

`npm run check` passed locally. It covered Prettier, JavaScript/Solidity/shell lint, checked-JavaScript types, the Vite
production build, all three compiler paths, `256/256` Node tests, all three deterministic contract suites and a
`289`-file secret scan. The Linux-only `systemd-analyze verify` step was accurately skipped on macOS and remains an
immutable-release installation gate.

## Remaining verification boundary

Production still serves the prior schema until the reviewed release is merged and promoted. Production verification
must prove the new schema, activity ledger and path-triggered reporter while showing that the continuously running signer
kept the same PID, restart count, authorization and ledger usage across the board-only rollout.
