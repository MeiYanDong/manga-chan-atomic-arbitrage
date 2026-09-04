# Mechanism and execution specification

## 1. Mechanism

The deployed fixed canary remains:

```text
f(x, state) = V3_NVDA_USDG(V4_MANGA_NVDA(V4_MSFT_MANGA(V3_USDG_MSFT(x))))
```

Generic-v2 evaluates a bounded family instead of one symbol tuple:

```text
f(target, A, B, x, state) = V3_B_USDG(V4_target_B(V4_A_target(V3_USDG_A(x))))
```

`A` and `B` are asset addresses, not categories. Stocks, AI tokens and memes have identical execution semantics. Each
V3 anchor is either the USDG identity, one canonical direct pool, or exactly one WETH bridge. The board explores the
bounded grid `5, 7.5, 10, 12.5, 15, 25, 50, 75, 100 USDG`, then refines around the best coarse point. `100 USDG` is a
hard cap, never a forced order size.

A shot is economically eligible only when:

```text
f(x, state) - x >= on-chain gross floor
f(x, state) - x - worst-case gas in USDG >= off-chain net floor
```

The quoted asset category is irrelevant. The opportunity exists when the on-chain relative price carried through one quote path is stale against the other path after fees and price impact.

## 2. Race Thesis

- **Reward source:** AMM reserves updated at different times across four pools.
- **State claim:** `EXCLUSIVE_STATE_CLAIM` with possible residual value. A winning swap changes the same reserves used by later attempts.
- **Sequencing:** first arrival at the Robinhood Chain sequencer. A higher gas price is a validity/cost parameter, not a queue-jump guarantee.
- **Earliest causal signal:** a Swap affecting one of the four route pools.
- **Shot profile:** `REACTIVE_GUARDED`; no pre-signed multi-candidate nonce race.
- **Unknowns:** opportunity frequency, competitor count, inclusion probability and realized live PnL remain `UNKNOWN` until canonical receipts and an opportunity census exist.

External stock or AI price data may prewarm computation. It cannot authorize a transaction because it does not prove the current executable AMM state.

## 3. Shot Policy

### Fixed canary

A shot requires all of the following at one readable block revision:

1. chain ID, target bytecode, token metadata, V3 pool composition, local source hash and deployed runtime hash match;
2. no unresolved mutation and `latest nonce == pending nonce == expected nonce`;
3. executor principal is within the fixed amount grid and on-chain cap;
4. all four quote legs succeed and a profitable size exists;
5. the executor `eth_call` agrees with the composed Quoter output;
6. the live gas price and worst-case fee remain inside the net-profit and wallet-reserve limits;
7. the arm is unexpired and below all four budgets: confirmed executions, signed attempts, failed gas and principal;
8. a final pre-sign simulation succeeds with a short deadline.

### Generic-v2

A generic candidate advances through three distinct evidence levels:

```text
fixed-block board screen
-> typed candidate and canonical quote-block identity
-> current-block GenericAtomicArb eth_call + estimateGas
-> immutable signed plan and canonical receipt/effect
```

The board exposes full route payloads for its profitable amount variants. The preflight evaluates at most six strongest
variants, rejects any that exceed the executor principal or fail a route boundary, and chooses the greatest **absolute
exact net USDG profit**. It does not optimize ROI and does not force 100 USDG. Before signing, the selected route and
amount must still be in the board's positive set, nonce and residual/allowance boundaries must still be clean, and a
fresh exact simulation must satisfy both the gross-retention floor and worst-case gas-adjusted net floor.

The only valid no-action result is `NO_SHOT` with evidence. Quote failure is not the same as an unprofitable quote.

## 4. Durable mutation protocol

```text
Opportunity -> Intent -> Plan -> Signed exact raw -> Broadcast observation
            -> Provisional receipt -> Confirmed EffectRecord
```

- The plan commits chain, wallet, nonce, destination, calldata hash, gas, fee, amount and relevant before-balances.
- Generic plans additionally commit candidate hash, stable route/amount execution key, route hash and quote-block identity.
- Exact raw bytes are written with mode `0600` before the first broadcast.
- Broadcast failure is `UNKNOWN`, because the provider may have accepted the transaction before the response failed.
- `reconcile` checks receipt, transaction visibility and latest/pending nonce. Two independent readers are required before returning `NOT_OBSERVED`.
- Optional recovery may rebroadcast the same raw bytes. It never signs a replacement nonce.
- Conflicting receipts, an unexplained consumed nonce or a balance/event mismatch remains halted.

## 5. Provider and event model

The watcher subscribes only to:

- the V3 `Swap` event at the USDG/MSFT entry pool;
- the V3 `Swap` event at the USDG/NVDA exit pool;
- the V4 PoolManager `Swap` event for the exact MSFT/MANGA and MANGA/NVDA pool IDs.

Duplicate and out-of-order logs collapse into a monotonic opportunity revision. HTTP must first prove that the triggering block is readable. `header not found`, unknown block, rate-limit and network failures enter bounded recovery; target/code/operator mismatches halt as invariants.

A 30-second recovery poll protects against subscription gaps. It is not the primary trigger.

## 6. Evidence boundary

| Evidence                                            | What it proves                                 |
| --------------------------------------------------- | ---------------------------------------------- |
| compile hash                                        | local source/build identity only               |
| deterministic EVM test                              | contract behavior against reviewed mocks       |
| fork test                                           | behavior against a historical chain snapshot   |
| WSS heartbeat                                       | transport/process liveness only                |
| simulation                                          | current-call feasibility at one observed state |
| accepted transaction hash                           | provider acceptance, not inclusion             |
| confirmed receipt + Executed event + balance change | realized gross effect                          |
| gas receipt + contemporaneous mark                  | estimated realized net PnL                     |

No process state, CI result or simulation is labeled as live profit.

## 7. Acceptance criteria

- Exact positive contract result and zero MSFT/MANGA/NVDA residuals are asserted.
- Generic tests assert both direct-pool and one-WETH-bridge paths, the exact 100 USDG cap, zero residuals/allowances and
  rejection of non-WETH intermediaries or unreviewed V3 fee tiers.
- Every negative boundary checks the intended custom error, not merely “some revert.”
- `header not found` cannot terminate as an invariant on its first occurrence.
- execute, deploy and withdraw persist the signed raw transaction before broadcast.
- withdraw, deploy, execute and arm all reject an unresolved mutation.
- UNKNOWN recovery never creates a second raw transaction for the nonce.
- The public repository secret scan finds no signer, provider credential, signed raw, runtime log or personal absolute path.

## 8. Read-only opportunity census

The generalized board evaluates one economic unit:

```text
USDG -> quote asset A -> candidate token -> quote asset B -> USDG
```

For each observation, the four swap legs and the ETH/USDG native mark share one fixed block. The current gas screen is:

```text
gas proxy = sum(Quoter gas estimates) + orchestration overhead
screened net = quoted USDG out - USDG in - native gas proxy converted to USDG
```

The board itself deliberately stops below `READY_TO_EXECUTE`: it has no signer, wallet client or generic executor state.
Generic-v2's separate signing-lane preflight can consume the typed candidate payload and add exact `eth_call`, execution
gas, residual, allowance and nonce evidence. No generic mainnet deployment exists at this repository revision, so
current mainnet executor simulation and receipt evidence remain absent. Old observations become `STALE` instead of
remaining actionable. Metadata failures, missing anchors and quote reverts are `UNQUOTABLE`, never silently converted
to zero profit.

The catalog is refreshed in full and supplemented by a frequent newest-token page. Priority candidates and current
positive rows are requoted first; the rest are covered with a persistent round-robin cursor. Coverage is reported in
the snapshot rather than implied by process liveness.
