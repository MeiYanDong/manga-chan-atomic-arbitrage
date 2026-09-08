# Story: understand the live strategy without reading engineering fields

## Outcome

As the strategy owner, I want the private dashboard to tell me the current result and the reason for no execution in
plain Chinese, so I can understand the business state before choosing to inspect technical evidence.

## Acceptance criteria

- The default page starts with current-strategy status and current-strategy receipt-confirmed net profit.
- Account-wide profit from before the current strategy started is visibly labeled and cannot be mistaken for the current
  strategy's result.
- Primary money values use two decimals; exact precision is one explicit expansion away.
- Navigation contains only 总览, 机会, 账单 and 更多.
- Opportunity navigation defaults to 可以执行, separately counts 接近门槛, and does not render the complete candidate
  population until 全部观察 is selected.
- Each opportunity card states what prevents execution in plain Chinese.
- Contract addresses, raw evidence axes and evidence records are not visible before 技术信息 is expanded.
- The transaction ledger leads with date, route, input and receipt-confirmed net result; Gas and hash are in 明细.
- PAIR, LONG, Doppler and on-chain pools remain separate, with an explicit NINECAT attribution correction.
- The interface works without horizontal page scrolling at 390, 768 and 1440 CSS pixels.
- Keyboard focus, Escape-to-close and reduced-motion behavior remain supported.

## Risk boundary

- No signer, private key, wallet address, authorization, nonce, RPC credential, transaction, threshold or deployment
  policy is added or changed.
- The board remains private, loopback-only and read-only.
- Frontend health is not treated as economic proof; receipts and reconciled balance effects remain the accounting source
  of truth.
