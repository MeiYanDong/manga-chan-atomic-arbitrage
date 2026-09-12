# ADR 0045: data-first operations dashboard and native-asset project ledger

- Status: Accepted
- Date: 2026-09-12
- Supersedes: ADR 0025 decisions 1 and 4; ADR 0044 decision 5 for primary presentation

## Context

The public dashboard exposed the required balances and receipt evidence, but its large typography, decorative cards,
five task areas and standalone Base bootstrap story made it read like a presentation. The operator could not quickly
answer the recurring business questions: what earned money, what cost Gas, where the capital sits and whether anything
is executable now.

The existing strategy result is a marked USDG result. Project-wide history also contains ETH and WETH activity,
deployment and authorization costs, capital transfers and a separately verified native-ETH arbitrage. Summing those
assets through an unrecorded spot price would create false precision.

## Decision

1. Use four primary pages: `概览`, `交易`, `资金` and `策略`. Old hashes resolve to their closest surviving page.
2. Use a restrained system-sans interface with small headings, tabular numbers, neutral surfaces, thin borders and no
   gradients, decorative shadows or motion. Tables are the primary structure on desktop.
3. Keep two economic layers. The existing strategy view retains its marked USDG net result. The project view aggregates
   explicit profit and cost effects separately for USDG, WETH and ETH; it never invents a cross-asset total.
4. Normalize reviewed project history, canonical strategy executions, reverted-mutation Gas, legacy collections and the
   EarnOnHood receipt into one newest-first activity stream. Capital movement is not profit. Successful execution Gas is
   counted exactly once according to its declared treatment.
5. Move the initial Base funding receipt into the unified transaction history. The funds page shows only current
   balances and account purpose; it no longer contains a special bootstrap card.
6. Keep hashes, full addresses, block numbers, exact values and provenance behind deliberate `凭证`, `查看` or technical
   disclosures. Primary tables use Chinese business labels rather than raw state names.
7. Add a systemd path trigger for material execution and collection ledgers while retaining the five-minute timer for
   balance catch-up and Feishu delivery. Do not watch the high-frequency idle runtime heartbeat.
8. This change does not modify opportunity admission, economic thresholds, RPC execution lanes, signing, nonce,
   broadcast, authorization or executor contracts.

## Consequences

- The original `0.01 ETH` remains auditable as an ordinary capital-in row without dominating the funds page.
- Project result coverage is explicitly `PARTIAL` until every historical activity is registered. Unknown history is not
  represented as zero.
- WETH profit and ETH Gas may appear on separate rows. That is intentional evidence preservation, not a missing total.
- Transaction-ledger changes refresh the public snapshot promptly; ordinary balance changes remain bounded by the
  existing five-minute read cadence, avoiding a high-frequency public-RPC cost increase.
- Schema version 3 requires the board and reporter to be promoted together. The signing service must remain running and
  unchanged during that presentation-only promotion.

## Verification

- Pure activity tests cover normalization, ordering, deduplication, native-asset aggregation and malformed-record
  rejection.
- Business snapshot tests cover the schema-v3 activity stream and separate asset totals.
- Product tests reject the Base bootstrap card, presentation fonts and decorative effects, and preserve progressive
  disclosure, reduced-motion and read-only boundaries.
- Linux verifies the new `.path`, `.service` and `.timer` units before production enablement.
- Production readback must confirm schema 3, all four pages, the Base funding row, current account balances and unchanged
  signer PID/restart/authorization/nonce evidence.
