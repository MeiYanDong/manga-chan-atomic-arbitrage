# Dual USDG/WETH execution stories

## Story 1: isolated WETH principal

As the operator, I can seed a WETH-based executor without changing the deployed USDG executor.

Acceptance:

- deployment wraps the exact native seed into WETH and leaves zero native ETH in the contract;
- immutable maximum amount and gross-profit floor are read back from bytecode state;
- the USDG contract source hash remains unchanged; and
- deployment receipt, nonce, wallet ETH delta, WETH balance, code hash, and operator are reconciled before state is
  recorded.

## Story 2: one-block cross-base selection

As the operator, I want the signer to choose the economically strongest executable cycle regardless of its base asset.

Acceptance:

- the board publishes independently validated USDG and WETH lanes at one fixed block;
- every exact candidate is simulated and gas-estimated at one current block;
- WETH-to-USDG normalization rounds profit down while USDG gas marking rounds cost up;
- the largest normalized exact net candidate wins; and
- exactly one transaction is signed with a base-local protected minimum profit.

## Story 3: one signer and recoverable ambiguity

As the operator, I do not want USDG and WETH processes to race the wallet nonce.

Acceptance:

- both bases share one process, wallet lock, nonce baseline, journal, and signed-raw directory;
- fixed-route, generic-v2, and dual-v3 watcher units are mutually exclusive;
- a broadcast or receipt ambiguity becomes `UNKNOWN` and blocks all new nonces; and
- reconciliation can only close the mutation from canonical receipt/effect evidence or expired two-reader absence.

## Story 4: infinite operation with bounded economic risk

As the operator, I want confirmed profit reinvested without a seven-day or trade-count stop.

Acceptance:

- dual mode requires `UNTIL_REVOKED` and all three count settings explicitly set to `unlimited`;
- receipt-reconciled gross base-asset profits expand arm-time principal only up to the corresponding immutable cap;
- unrelated top-ups require a fresh authorization before they expand spendable principal;
- failed Gas, wallet ETH reserve, minimum net, nonce, code identity, deadline, revocation and UNKNOWN remain breakers; and
- the server process runs its own continuous loop with no local Codex timer or cron dependency.

## Story 5: evidence-gated production promotion

As the operator, I can distinguish completed code from actual live activation.

Acceptance:

- local quality gates and a public-RPC read-only dual quote pass before release;
- the current generic watcher remains live until a controlled cutover window;
- current balance determines the explicit WETH seed only after reserving deployment and operating Gas;
- deployment, arm, service start, and first trade are each separate observable steps; and
- production status is not claimed until systemd, board schema, chain code, balances, nonce, authorization, receipt, and
  post-state are read back.
