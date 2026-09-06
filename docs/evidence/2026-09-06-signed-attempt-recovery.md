# Generic-v2 signed-attempt recovery — 2026-09-06

## Evidence boundary

This note separates repository/CI evidence, server process evidence, public chain readback and remaining operator
authorization. It does not claim that the watcher is live, that a fifth trade executed or that a public RPC has a
production service level.

## Root cause and repair

The fifth authorized attempt was counted twice across one transaction lifecycle:

1. the pre-sign budget check observed four signed attempts and allowed the fifth;
2. `mutation_signed` durably reserved attempt five;
3. the final pre-broadcast check read five attempts and incorrectly treated the same raw transaction as a new attempt;
4. the watcher stopped on `attempt-limit` before broadcast.

The repair keeps the original `>= maxAttempts` boundary. At the final broadcast boundary only, it subtracts one exact
in-flight reservation when the latest unresolved audit record matches all of `authorizationId`, mutation kind,
`intentId`, `planHash`, transaction hash and nonce. A mismatch, duplicate, terminal record or sixth attempt still fails
closed. Expiry, confirmed-execution, failed-Gas and exact-preflight budgets remain independent.

Recovery also gained an explicit `mutation_abandoned` terminal. It is allowed only for an expired generic execution
when two independent readers both observe no transaction, no receipt and an unconsumed nonce after the signed deadline.
Expired generic raw transactions are rejected by the replay path.

The fixes passed the repository quality gate and protected-branch CI in:

- [PR #28](https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/pull/28), merge commit
  `a1796eb951bd4f1d5c2cc3593c62bf11e5ae5dba`;
- [PR #29](https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/pull/29), merge commit
  `137e081303b11429a8391f25ce2532e58d1df4bc`;
- [PR #30](https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/pull/30), merge commit
  `24c1d869ff82e912dc3ab85c147476f039247a93`.

The second repair ensures credentialized HTTP/WSS URLs are redacted from provider errors before state, audit or CLI
stderr output. The previously exposed provider endpoint credential must still be rotated at the provider.

## Server and terminal recovery readback

The signing host's active release symlink resolved to
`24c1d869ff82e912dc3ab85c147476f039247a93`. Its install gate passed formatting, lint, Linux systemd validation,
checked-JS types, compilation, 53 unit tests, both deterministic Cancun contract suites and the secret scan. The live
status readback now agrees with the audit ledger: four confirmed executions, five signed attempts and ten exact
preflights.

At `2026-09-06T06:53:22.880Z`, the append-only audit ledger recorded:

```text
event: mutation_abandoned
result: EXPIRED_NOT_OBSERVED
transaction: 0xbb2c51aac9268d23d00bac26525a64a57d2f2a1a33cb3b1cdb6f5c3746a8ea16
nonce: 8
deadline: 1788662206
primary head/timestamp: 55778248 / 1788677602
secondary head/timestamp: 55778237 / 1788677601
```

Both reader timestamps were later than the deadline. Both readers observed the transaction and receipt absent and nonce
`8` unconsumed. The current unresolved-mutation readback is `null`; therefore this raw caused no chain transaction, Gas
spend or asset movement and must never be broadcast later.

A later independent public readback observed chain ID `4663`, operator
`0x77f771E83f118C32547A1291dda438a757B4b91B`, wallet pending nonce `8`, wallet balance
`0.002425874079522 ETH` and executor balance `24.294865 USDG`. The official reader also returned latest nonce `8`;
the second public reader does not serve that particular latest-nonce request on its anonymous tier. Both still returned
the expired transaction and receipt as absent.

## Current runtime state

- `manga-generic-watcher.service`: disabled, inactive, PID `0`;
- authorization usage: four confirmed executions, five signed attempts, ten exact preflights and zero failed Gas;
- old authorization: still recorded as `ARMED` but exhausted at five signed attempts, so it cannot authorize another
  transaction;
- `manga-opportunity-board.service`: enabled and active;
- after the release restart, board snapshot `2026-09-06T07:15:15.295Z` had a complete catalog, 496 candidates, 15
  freshly quoted tokens and one proxy-screened candidate at `0.061447 USDG` net. That candidate was below the current
  `0.10 USDG` authorization gate and was not execution-authorized; `/healthz` returned HTTP `200` and `HEALTHY` after
  the first scan completed.

The configured Chainstack execution endpoint currently rejects `eth_chainId` because its monthly Request Unit quota is
exhausted. Runtime diagnostics now display `<RPC_URL_REDACTED>` instead of the credentialized URL.

## Restart blockers

No signing service should be enabled until all three are closed:

1. rotate the previously exposed provider endpoint credential and install a working protected execution RPC;
2. reconcile Gas headroom against the desired wallet reserve and bounded attempt count;
3. disarm the exhausted authorization, issue a new deployment-bound scope and obtain explicit human approval for that
   exact scope before starting the service.
