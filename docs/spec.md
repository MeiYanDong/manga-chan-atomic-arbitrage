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

Dual-v3 adds a second, independently bounded family without modifying generic-v2:

```text
g(target, A, B, x, state) = V3_B_WETH(V4_target_B(V4_A_target(V3_WETH_A(x))))
```

The WETH anchors are identity WETH, one direct V3 pool, or exactly one USDG bridge. The board converts the existing USDG
amount grid into WETH at its fixed-block mark, rounding down. At escalation, every USDG and WETH candidate is exact-called
and gas-estimated at one current block. WETH net is normalized to USDG with downward rounding only for ranking; the
selected contract's amount, minimum profit, balance delta, and retained profit stay in the native base asset.

A shot is economically eligible only when:

```text
f(x, state) - x >= on-chain gross floor
f(x, state) - x - worst-case gas in USDG >= off-chain net floor
```

For WETH, the common USDG net floor is converted upward at the exact block mark before building the protected call:

```text
minimumNetWeth = ceil(minimumNetUsdg * markInputWeth / markOutputUsdg)
g(x, state) - x - worst-case gas in wei >= minimumNetWeth
```

Cross-base selection maximizes `floor(WETH net * USDG mark / WETH mark input)` versus exact USDG net, then signs one
candidate. The mark is a conservative decision input, not a claim of guaranteed execution or an on-chain oracle.

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

Autonomous generic shots additionally require a deployment-bound arm. Fixed-expiry and rolling-lease arms retain a time
boundary. An explicit schema-v3 `UNTIL_REVOKED` arm has no time stop and derives its current eligible principal from the
last confirmed executor USDG post-balance, capped at 100 USDG. The watcher processes each compact fresh-positive board
generation once, deduplicates by opportunity identity and rejects candidates outside the current principal or
screened-net floor before making a chain request. Exact preflights, signed attempts, confirmed executions and failed Gas
have independent arm budgets. The arm, durable revocation and stop signal are checked immediately before and immediately
after signing.

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

The generic and fixed generations deliberately use different hot paths. Generic idle discovery is the signer-free
loopback board backed by the official public RPC. The board incrementally polls bounded PoolManager and known V3 anchor
log ranges, maps a changed pool to affected candidates, and then repeats the full fixed-block quote for those candidates.
A dedicated serial hot-poll loop advances independently of slow quote and catalog cycles. It only coalesces revisions
into the bounded candidate queue; the main scheduler is the sole queue consumer. A public-RPC failure is retained as
source-health evidence and applies bounded backoff without blocking already-observed wakes. A reorg replaces the queue;
an already-consumed wake can only request a new canonical fixed-block quote and is never executable evidence by itself.
The quote batch limit is unchanged.
Events are wake evidence only: the local post-event mirror is never used as executable output. A low-frequency round-robin
reconciliation remains necessary because the V3 event set contains previously quoted routes rather than every route that
could become best. Only a new eligible board candidate escalates to the explicitly configured execution RPC for exact
simulation, Gas, signing, broadcast and receipt convergence. This bounds provider use without making a rate-limited public endpoint
a live signing dependency.

The fixed-route watcher subscribes only to:

- the V3 `Swap` event at the USDG/MSFT entry pool;
- the V3 `Swap` event at the USDG/NVDA exit pool;
- the V4 PoolManager `Swap` event for the exact MSFT/MANGA and MANGA/NVDA pool IDs.

Duplicate logs collapse into one candidate wake. A persisted block/hash anchor detects a reorganization and rewinds the
bounded cursor before replay. Rate-limit and network failures do not advance the cursor and enter exponential polling
backoff; target/code/operator mismatches remain invariants.

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
| gas receipt + contemporaneous mark                  | realized marked net PnL                        |

No process state, CI result or simulation is labeled as live profit.

## 7. Acceptance criteria

- Exact positive contract result and zero MSFT/MANGA/NVDA residuals are asserted.
- Generic tests assert both direct-pool and one-WETH-bridge paths, the exact 100 USDG cap, zero residuals/allowances and
  rejection of non-WETH intermediaries or unreviewed V3 fee tiers.
- Every negative boundary checks the intended custom error, not merely “some revert.”
- `header not found` cannot terminate as an invariant on its first occurrence.
- execute, deploy and withdraw persist the signed raw transaction before broadcast.
- withdraw, deploy, execute and arm all reject an unresolved mutation.
- fixed and generic signer generations reject one another's active arm or watcher lock.
- generic idle polling performs no chain RPC and each arm independently caps exact-preflight consumption.
- generic completion requires wallet Gas delta and marked net profit to meet the immutable plan floor before the mutation becomes terminal.
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
Generic-v2's separate signing lane can consume one typed candidate and add exact `eth_call`, execution Gas, residual,
allowance and nonce evidence. Generic-v2 is now deployed and a first bounded autonomous execution has canonical
receipt, event, balance-delta and marked-net evidence. That single success proves the path can execute profitably in one
observed state; it does not establish opportunity frequency, race win probability or recovery of the one-time deployment
cost. Old observations become `STALE` instead of remaining actionable. Metadata failures, missing anchors and quote
reverts are `UNQUOTABLE`, never silently converted to zero profit.

The API catalog is refreshed in full with stable newest-first pagination and supplemented by a frequent newest-token
page. It is merged with durable, bounded PoolManager `Initialize`-log backfill. The chain artifact reports its configured
start, scanned-through block, safe head, singletons and ambiguous launches; it never claims blocks before the configured
start. Structurally valid null-depth or disabled-quote pools may be shadow-quoted, but the schema-v3 generic plan rejects
them. PoolKey identity plus a successful V4 quote at the exact observation block is required before a supported pool is
marked executor-compatible.

Priority candidates and current positive rows are covered by the periodic reconciliation cursor. Between those sweeps,
PoolManager and known V3 `Swap` events wake only the affected candidates. Quoter-call counts and event-to-quote latency
are published as runtime metrics. Equivalent V3 anchor requests are deduplicated only within the same fixed block.
V3 Factory reads and V3 Quoter paths are grouped through the code-hash-pinned canonical Multicall3 contract at that same
block; every subcall retains its independent success, revert and decoded Gas estimate. V4 Quoter calls remain direct so
their caller and hook context does not change. JSON-RPC batching is disabled on the public endpoint after production
proved its envelopes incomplete. HTTP POST counts, Multicall groups and subcalls remain separate measurements and are
never represented as provider billing-unit savings. No reduction target is considered met until a deployed observation
window measures it.

Candidate concurrency and within-candidate leg concurrency are separate controls. The conservative public profile
quotes one candidate at a time, while V3 paths share bounded onchain read aggregation; this reduces request bursts
without allowing multiple candidate grids to expand simultaneously.

The signer consumes only a compact atomically replaced execution feed from a dedicated read-only runtime directory.
Board restarts preserve its last complete generation; a transient missing or stale file handle is a board-only retry,
while unsafe permissions, file type, size or JSON content remain terminal invariants. The growing exact source catalog
is a separately hashed atomic file written through a bounded buffer. SQLite continues to hold the exact current
economic projection and material-evidence index without copying the entire source catalog into every snapshot commit.

The public-RPC profile rotates a bounded subset of historical priority rows and adds one bounded catalog batch. Every
candidate starts with 5/10 USDG probes. A gross-positive probe or a previously actionable row expands to the full amount
grid; no-edge priority status alone does not authorize a large quote fan-out. This is discovery scheduling, not execution
authorization.

For each direction at a fixed block, the first requested amount runs the complete allowed direct-or-one-WETH-bridge V3
path set and retains the top three successful paths. Other amounts at that same block receive fresh Quoter results only
for that shortlist. The snapshot labels this policy; it is not represented as an exhaustive all-path search at every
amount. A new block starts a new competition.

Economic opportunity frequency uses episode semantics. One fresh positive opens an episode; stale, unquotable and
missing observations preserve it as unknown continuity; only a fresh non-positive quote closes it. A one-time epoch
marker separates the legacy biased ledger from the new semantics.
