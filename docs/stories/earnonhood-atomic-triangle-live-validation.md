# Story: validate one EarnOnHood atomic triangle without opening a second signer

> Historical validation story. The one-shot operating model was superseded by the accepted continuous criteria in
> `earnonhood-unified-standing-keeper.md`; the receipt evidence below remains canonical.

## Outcome

As the operator, I want to discover EarnOnHood weighted-pool cycles cheaply and execute only a currently protected
WETH-returning triangle, so that a real mainnet receipt can validate the mechanism without leaving intermediate-token
inventory or racing the existing wallet watcher.

## Acceptance criteria

- Broad discovery enumerates 2–4 hop WETH/USDG cycles from eligible Omnipools and treats API pricing only as a shortlist.
- Every shortlisted exact quote is anchored to one block after initialized, paused, recovery and token-set checks.
- Live execution permits only the reviewed WETH/AI/MOO pools, both directions and at most `0.002 WETH` input.
- The on-chain output floor covers input, buffered maximum Gas and at least `0.00002 ETH` net profit, with a separate
  `0.00001 ETH` quote-headroom requirement.
- A running dual watcher, dirty pending nonce, identity mismatch, stale economics, excessive Gas or insufficient wallet
  reserve returns no signature and no broadcast.
- The private credential is loaded only after the latest quote, call, Gas, balance and nonce pass.
- The exact signed raw is durable before broadcast; receipt and native-balance delta determine the terminal result.
- RPC error text is sanitized before it enters stdout or the audit ledger.

## Accepted evidence

- Policy and configuration tests pass as part of `npm run check`.
- Mainnet transaction
  [`0x27ed…a2028`](https://robinhoodchain.blockscout.com/tx/0x27ed9bab2e6d78b82a1b0790de6c33c44359f7134d86f03d71936b61ed1a2028)
  settled `WETH -> MOO -> AI -> WETH` atomically.
- Receipt Gas was `0.000047463672072 ETH`; the wallet's verified net increase was
  `0.000131868227091194 ETH`.

## Non-goals

- No claim of risk-free, continuous or scalable profit from one receipt.
- No automatic onboarding of arbitrary API pools into the signer.
- No parallel signer, new approval, new executor contract, capital increase or paid-RPC quota increase.
