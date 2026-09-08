# Story: operate the strategy from business outcomes, not raw fields

## Outcome

As the operator, I want one private dashboard and one daily Feishu message that tell me whether the strategy is running,
what it actually earned, what capital can be reused, where opportunities came from and which receipts prove each trade.

## Acceptance criteria

- The overview separates scanned targets, screened-positive quotes, exact-ready candidates and confirmed receipts.
- Today, previous day, active authorization, all-time and seven-day values use Beijing calendar boundaries.
- USDG and WETH confirmed executions share one conservative USDG comparison field without pretending the WETH principal
  itself became USDG.
- Available reinvestment grows only from the arm-time principal plus receipt-proven gross profit and remains capped by
  the immutable authorization.
- Failed-transaction Gas is visible separately from successful-execution net profit.
- PAIR, LONG, Doppler and retained pool counts remain separate; NINECAT is not labeled as a PAIR listing.
- Recent transactions use human labels and link only to the fixed Robinhood Chain Blockscout transaction prefix.
- The primary UI omits raw adapter IDs, database paths, provider error strings and evidence hashes.
- The business API rejects snapshots that are malformed, writable or more than 15 minutes old.
- The daily message covers the previous completed Beijing day, retries every five minutes after 09:05 until success and
  sends at most once per durable period receipt.
- The webhook is an encrypted systemd credential and never appears in the repository, environment files or logs.
- Reporting has no private-key credential, wallet client, arbitrary call target or transaction broadcast path.
- Report delivery failure cannot stop, re-arm, sign for or mutate the trading watcher.

## Non-goals

- No new transaction authority, route, amount, Gas, RPC or profit threshold.
- No claim of complete fund PnL, fiat accounting, unrealized value or future opportunity frequency.
- No public Internet exposure of the dashboard.
- No exactly-once guarantee across the remote-accept/local-crash ambiguity window of a custom-bot webhook.
