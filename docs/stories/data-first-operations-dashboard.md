# Story: run the arbitrage project from a minimal evidence-backed dashboard

## Outcome

As the project operator, I can read business results, transaction history, fund distribution and strategy state without
decoding implementation fields or remembering which wallet performed which action.

## Acceptance criteria

- Navigation contains only `概览`, `交易`, `资金` and `策略`.
- The overview leads with today's and cumulative receipt-confirmed strategy result, reinvestable capital and exact-ready
  opportunity count. USDG and ETH results remain separate; an ETH-native Earn receipt cannot leave the headline count
  at zero.
- Project economics list profit, cost and net impact separately for each native asset, with incomplete coverage labeled
  `部分待核验` rather than silently treated as complete.
- The transaction table uses `时间 / 类型 / 链 / 金额 / Gas / 经营影响 / 状态`, supports type/network/status filters and
  contains the initial Base funding as an ordinary capital-in event.
- Capital transfers and collections are not counted as profit. Deployment, authorization, collection and reverted-
  transaction Gas are operating costs. Gas already included in a verified net result is not counted twice.
- The funds page lists only current project accounts, purpose, non-zero balances and status. Full addresses and explorer
  links require deliberate disclosure. It has no standalone Base funding presentation.
- The strategy page keeps PAIR, LONG, Doppler and unattributed on-chain pools as separate source scopes and explains why
  a route is not executable in plain Chinese.
- The strategy page reports the current Earn authorization's confirmed count and ETH net separately from lifetime Gas
  surplus, and the Feishu report carries both USDG and ETH result lines.
- The UI uses the OS Chinese sans-serif stack, tabular figures, small headings and flat neutral surfaces. It contains no
  Songti/Georgia display type, gradients, decorative shadows or animation.
- The browser remains same-origin and read-only; no wallet connection, signer material, mutation method or arbitrary RPC
  proxy is introduced.
- A material ledger change triggers a sanitized snapshot refresh. The five-minute timer remains the balance catch-up and
  Feishu retry path.

## Independent verification cards

1. **Ledger card:** fixture history plus execution, collection, failed-Gas and native-ETH records produce deterministic
   ordered activities and per-asset totals.
2. **Interface card:** build and product-language tests prove the four routes, minimal styling and disclosure boundary.
3. **Runtime card:** Linux unit verification, public API readback and browser inspection pass while signer PID,
   authorization and nonce evidence remain unchanged.
