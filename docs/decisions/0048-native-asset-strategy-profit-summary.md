# ADR 0048: report strategy profit in each receipt-native asset

- Status: Accepted
- Date: 2026-09-12
- Extends: ADR 0045 and ADR 0046

## Context

The unified keeper confirmed two new EarnOnHood transactions and its runtime correctly reported their ETH net profit.
The transaction stream and project ledger also included them, but the dashboard's today, all-time and active-strategy
summary was built only from the USDG and WETH executor state files. As a result, the headline could say zero trades and
zero strategy profit while canonical ETH receipts were visible lower on the same page.

Converting ETH to USDG at an unrecorded spot price would hide the evidence boundary. Omitting ETH from the strategy
summary is also incorrect.

## Decision

1. Build one receipt-gated Earn execution set from `mutation_effect` rows whose status proves realized net profit,
   transaction hash and confirmation time are valid, and net ETH is strictly positive.
2. Deduplicate identical transaction hashes. If two rows for one hash disagree on time, authorization or net amount,
   exclude that hash from the summary instead of choosing a value.
3. Add Earn counts and exact ETH net to daily, all-time and active-authorization summaries. Retain the existing marked
   USDG result as a separate field; never add the two units together.
4. Present the non-zero native result as the primary dashboard value, with the other native unit and confirmed count on
   the same card. Show the current Earn authorization's count and net ETH on the strategy page.
5. Include both native units and the Earn count in the Feishu daily report. Keep receipt hashes in the transaction
   disclosure rather than the headline.
6. Make this an additive schema-v3 presentation change so the already-running loopback board can validate and serve the
   refreshed snapshot without restarting the trading or scanning processes.

## Consequences

- A successful ETH-native loop can no longer be hidden behind a USDG-only zero.
- The operator sees several native result lines rather than a fabricated cross-asset total.
- Historical Earn receipts without the current authorization remain in today/all-time results but not the current
  authorization result.
- This change does not alter opportunity detection, sizing, Gas gates, signing, nonce ownership or broadcasting.

## Verification

- Tests cover Shanghai-day grouping, current-authorization filtering, exact ETH summation, identical receipt
  deduplication and conflicting-evidence rejection.
- UI and Feishu tests require both native units and the Earn count.
- Production readback must reconcile the two new receipt hashes, `2` current-authorization Earn executions and
  `0.000062758024519054 ETH` current net while retaining the lifetime total independently.
