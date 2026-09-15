# Changelog

## Unreleased

- Pace canonical Multicall3 catalog requests by at least 250 ms and retry only aggregate failures classified as
  `NETWORK`, `THROTTLED` or `STATE_NOT_READY`, at most three attempts with exponential backoff. Persist and validate
  the fixed retry policy, actual request count, retry count and transient-failure count. Production v0.17.8 proved the
  need: its first refresh found 29 V2 and 84 V3 pools but left 132 V3 transport failures; a normal second refresh
  retained the 29 V2 pools and raised V3 coverage to 94, yet public throttling affected 179 V2 and 233 V3 queries.
  Business/invariant failures still do not retry, the maintenance unit remains signer-free and public-only, and no
  transaction, Gas, capital, profit or receipt boundary changes.
- Replace the signer-free Global catalog's hundreds of bursty V2/V3 JSON-RPC reads with sequential, fixed-block calls
  to the code-hash-verified canonical Multicall3 contract. Each request contains at most 12 factory or pool-state
  subcalls; schema v4 validates the code identity, aggregate request count, logical subcall count and existing partial
  topology evidence before any search consumes the snapshot. The same official public endpoint remains the only
  catalog transport. Persist only typed error labels, never provider URLs, request bodies or calldata. A live read-only
  probe at block 63,606,133 completed in 47,239 ms with 32 Earn, 29 V2 and 119 V3 pools, zero query errors, and 95 HTTP
  RPC requests representing 1,118 same-block subcalls. This changes no signer, capital, Gas, profit, simulation,
  submission or receipt boundary.
- Recover only the logical call omitted from a malformed official-public JSON-RPC batch by retrying that call directly
  against the same public endpoint. The catalog process still has no managed RPC or signer, and HTTP denial,
  throttling, deterministic RPC errors and EVM reverts do not fan out. Extend bounded topology continuity to Earn:
  schema v3 retains an exact previously verified pool for at most six hours only when that pool's current fixed-block
  state read fails as `NETWORK`, `THROTTLED` or `STATE_NOT_READY`. Fresh state wins, deterministic rejection removes
  the old pool, retention counts are validated on every read, and every quote, Gas estimate, balance, nonce,
  simulation, submission and receipt remains current-state. This addresses production v0.17.6 completing with only 16
  Earn pools and zero V2/V3 pools after omitted public-batch responses; it restores discovery evidence, not profit or
  transaction authority.
- Isolate catalog chain-head and canonical Earn identity reads on a non-batched official-public client and retry only
  transient failures three times with bounded backoff. This closes the production-observed viem missing-batch-item
  crash before partial-query reconciliation, while preserving the prior atomic snapshot if all retries fail. Persist
  retry counts without error bodies or endpoints. The maintenance process still receives no signer, managed RPC, WSS,
  transaction or economic authority.
- Preserve recently verified Uniswap V2/V3 topology when an exact pair or fee query fails with a classified transient
  public-RPC error. A catalog generation may reuse only the matching pool existence evidence for up to six hours;
  current successful reads replace it immediately, deterministic negatives remove it, and malformed or expired
  evidence fails closed. Catalog schema v2 records fresh, retained and expired counts, while every executable quote,
  Gas estimate, balance, nonce, simulation and submission still requires current-state validation. This repairs the
  production-observed partial refresh that replaced 29 V2 and 59 V3 pools with zero without granting any signing,
  capital, RPC, Gas or profit authority.
- Stream the complete bounded Global recovery traversal into a deterministic block-rotated reservoir instead of
  materializing, hashing and sorting every discovered cycle. The runtime still counts the full topology and preserves
  four-hop coverage, but each settlement asset retains at most the authorized per-wake route budget before quoting.
  Event traversal now reuses the same allocation-light backtracking core. Add a checksum-pinned release bootstrap that
  runs the candidate archive's installer, so a new release can install systemd units unknown to the preceding release.
  Neither change grants signing authority, raises RPC/Gas/capital limits or converts partial evidence into no-profit.
- Remove broad Global factory discovery from every latency-critical search and signing process. A dedicated
  credential-free systemd one-shot now refreshes the atomic base-catalog snapshot from the official public RPC every
  15 minutes, under its own lock, six-minute deadline and shared-host resource bounds. Live and resident search paths
  are cache-only: an absent or six-hour-stale snapshot degrades Global evidence without blocking Earn or entering the
  60-second signer deadline. The maintenance unit receives no private key, managed RPC, WSS or live authorization;
  this changes no capital, Gas, profit, quote, simulation, nonce, submission or receipt gate.
- Keep the rotating board-derived V4 universe as a current search overlay instead of persisting it into the six-hour
  Earn/Uniswap base catalog. A later rotation can no longer consume current graph capacity or make already-present
  PoolKeys look rejected. Bound V2/V3 factory reads to Earn assets and settlement hubs, attach validated transport
  completeness evidence, retry a partial writer catalog after five minutes, and classify an incomplete negative as
  evidence-incomplete rather than proven no-profit. Missing atomic funding is now a typed policy result, and the public
  business API exposes compact catalog completeness and failure counts without provider details. This changes no
  capital, Gas, signing, execution or receipt gate and claims no new profit.
- Stream the append-only trading ledgers into a field-minimized business-report projection instead of loading and
  parsing the complete audit history on every refresh. The original ledgers remain authoritative and unchanged; the
  reporter retains only failed-Gas evidence, the latest wallet verification, the active authorization's Global funnel,
  confirmed Earn receipts and completed legacy collections. Oversized or malformed safety-relevant rows still fail
  closed, while the known signer-free legacy wake is streamed past. This fixes the production-observed 128 MiB report
  cgroup OOM without granting signer access, increasing the memory limit or changing execution accounting.
- Connect the signer-free board's multi-source V4 discovery universe to Global through a small, versioned and
  group-readable `global-universe.json` projection instead of copying the roughly 40 MB source catalog into the signer.
  The projection retains a high-priority tranche, rotates bounded long-tail coverage, verifies PoolKeys, topology hash,
  file permissions, size and freshness, and immediately extends both the unified graph and Sequencer Feed address set.
  Search topology is now independent from funding admission, so a route with no Morpho liquidity or universal-executor
  inventory reports `NO_EXECUTABLE_FUNDING` rather than false no-profit. Authorization v13 commits the new universe and
  feed policies; the public business API shows searchable versus funded routes, and the funds view now includes the
  universal executor. This change moves no capital and claims no new receipt or profit.
- Let the protocol-agnostic Global graph wake from the existing canonical Earn Vault WSS stream and public Earn-log
  recovery backstop, in addition to Sequencer Feed. Each reviewed Earn swap contributes only its exact changed-pool
  dependencies; source provenance survives bounded coalescing and appears in lifecycle evidence. This creates no new
  subscription, paid-RPC debit, signer or transaction authority: the resident worker remains public-RPC-only and every
  positive hint still returns through the sole signer's latest-state, quote, Gas, balance, nonce, simulation,
  authorization and receipt gates. Uniswap-only events still rely on Sequencer Feed or periodic Global recovery.
- Begin Global event search immediately in a resident, credential-stripped read-only worker instead of waiting behind
  the serial Earn/signer scheduler. Busy events retain the full pool/asset/sequence union; worker failure falls back to
  the prior bounded child, complete-evidence negative results may avoid duplicate reads, and every positive remains
  only a hint that the sole signer must revalidate at a latest block. The worker is public-RPC-only so it cannot race
  the signer's durable paid-RPC budget. Cache only catalog-derived topology and stream the complete bounded
  event traversal while materializing Top-8 dependent routes, reducing representative USDG/WETH traversal time about
  4.3x without changing capital, Gas, profit, nonce, authorization, simulation, broadcast or receipt gates.
- Serve the sanitized operating snapshot for `/api/v1/business` directly from Nginx after an atomic, world-readable
  publication by the signer-free business reporter. Portfolio, capital and receipt evidence no longer wait behind the
  4,714-candidate market scanner's Node event loop; timestamps remain in the payload, and this adds no signer, RPC,
  transaction or write endpoint.
- Retry the dual watcher arm's coherent chain/deployment/nonce/principal baseline only when RPC classification proves a
  transient state-readiness or transport failure. The whole baseline is reacquired at a fresh fixed block, while a
  pending nonce, missing principal, foreign runtime or any business invariant still fails immediately. Signing material
  is now loaded only after all read-only evidence and economic gates converge; the arm remains a local authorization
  write and performs no signature or broadcast.
- Stop hot Sequencer Feed traffic from amplifying one pending wake into an exponential heap leak. Atomic
  `classificationReasons` are now the only merge source and the joined display label never feeds back into later
  coalescing; 20,000 alternating wakes remain two reasons and a 40-character projection instead of growing past
  171 MiB after only 24 legacy merges. Bound all coalesced signal collections and reason sizes, cap WebSocket payloads
  at 8 MiB before decode, and degrade an oversized frame to public-log/periodic recovery. These intake limits add no
  signing authority and leave exact state, simulation, Gas, nonce, balance, profit and receipt gates unchanged.
- Preserve fail-closed signer startup while migrating the one production-observed 6.9 MiB legacy
  `global_watch_wake` row. The incremental reader may stream-discard only that exact signer-free scheduler event;
  unknown and safety-event rows still fail when oversized, and the discard scanner rejects any accepted safety-event
  marker hidden later in the row. No ledger data is deleted or rewritten.
- Keep the live signer heap bounded as audit history grows. Authorization, nonce reconciliation, receipt economics and
  route quarantine now stream append-only JSONL in 64 KiB chunks, cache only safety-relevant events and read only new
  bytes; normal provider errors are redacted and capped before persistence. Earn discovery remains public-first but may
  recover from production HTTP 403 through persisted 40,000-call daily and 128/192-call per-wake managed budgets, while
  canonical Vault swaps arrive over managed WSS with bounded reconnect dedupe and a 60-second public recovery poll.
  Authorization v12 binds every new source and cost boundary; exact quote, simulation, Gas, balance, nonce, profit,
  signed-raw and receipt gates are unchanged.
- Remove Solidity compilation from the live dual-signing process. CI/release builds now emit source- and
  bytecode-hashed Generic and WETH artifacts beside the existing Universal artifact; runtime deployment verification,
  simulation and receipt decoding reload those small artifacts only after recomputing their source, source-bundle,
  bytecode and compiler-policy evidence. The explicit compile command retains a dynamic compiler import, while the
  watcher import graph contains no `solc`; all on-chain runtime, operator, protocol, ledger and trading gates remain.
- Keep the unified signer supervisor inside the 512 MiB production cgroup by capping each inherited Node/V8 heap at
  320 MiB, starting both the signer watcher and read-only opportunity board directly instead of retaining an npm
  wrapper, and throttling the watcher at a 448 MiB high watermark before the hard limit. This is an operational
  containment fix for the production-observed Global-child OOM; it changes no route, capital, Gas, profit, nonce,
  simulation, authorization, signing, submission or receipt policy.
- Make every Global opportunity decision evidence-typed and traceable. Parsed positive/zero/negative quotes, RPC
  failures, unavailable block state, unsupported routes and policy filters no longer collapse into one no-profit label;
  exact-evaluation catches now remain aggregate evidence. Carry one event ID from source sequence and protected
  scheduling through fixed block/catalog/graph versions, search, quote, simulation, optional signing, same-raw
  submission and receipt, with purpose-only RPC counts that retain no endpoint, params, calldata or raw transaction.
  Existing wallet, contract, capital, Gas, profit, nonce, simulation, authorization and receipt gates are unchanged.
- Protect Earn and Global recovery coverage with one explicit fair scheduler. Overdue periodic work now runs before
  ordinary event or board work, event wakes never move the periodic deadline, coalesced dependencies retain the
  highest-priority reason, and Global throttling cannot block an eligible Earn lane. The signer remains serial; the
  change adds no wallet, capital, Gas, profit, simulation or broadcast authority.
- Make Sequencer Feed intake lossless at the message boundary: an overlapping replay such as `[100, 101]` now drops
  only message `100` and still dispatches `101`, while fully replayed frames, gaps and out-of-order evidence receive
  explicit bounded metrics. Coalesce every pending Earn and Global pool/asset dependency by set union instead of
  letting a newer event overwrite an older route. Feed remains a wake hint; public-log/periodic recovery, exact state,
  simulation, Gas, nonce, balance, authorization and receipt gates are unchanged.
- Route one shared ordered Sequencer Feed into typed Earn and Global adapters instead of treating platform names as
  separate bots. Exact Earn pool/asset frames now run the Earn adapter first while leaving the broader cross-protocol
  search queued, every pool matched in a coalesced wake participates in local route ranking, and public discovery
  reuses protected canonical static metadata while refreshing only fixed-block dynamic balances. The managed signer
  still rechecks the exact selected route, nonce, quote, simulation, Gas, balance and profit floor before signing.
- Turn a canonical Earn revert into an exact-route quarantine rather than a platform-wide pause. Only a newer event on
  one of that route's pools, or a confirmed success for the same route, releases it; unrelated routes and adapters keep
  running. Preserve the 2026-09-15 WETH/AI exit-pool state race as an address-only regression fixture, explicitly marked
  as strong inference rather than a historical execution trace, and run the final quote/call/Gas gate concurrently at
  one fixed block to reduce post-quote drift.
- Make critical Feishu paging reflect user impact: an isolated Earn, Global or board failure is a silent degraded state;
  paging begins only when the shared execution foundation is repeatedly unavailable, every independent discovery
  adapter is simultaneously down, the signer stops, or transaction reconciliation stalls. Recovery copy now says
  whether full or partial coverage returned and continues to omit hashes, nonce, RPC and authorization internals.
- Make Feishu's headline number the actual receipt-gated result after both profitable-transaction Gas and failed-transaction
  Gas, and replace internal operator phrasing with direct Chinese labels for impact, automatic handling and required user
  action. Persist `STOPPED_BY_SIGNAL` immediately on SIGTERM/SIGINT so a bounded child process cannot make a controlled
  release switch look like an unexplained live outage.
- Keep one supervisor alive when a signed transaction cannot yet be reconciled: pause every new signature in the
  shared wallet/nonce domain, continue signer-free board, Earn-event and Sequencer Feed observation, and retry the
  lane-specific reconciler in the background. A canonical revert is now a settled failed attempt rather than an
  invariant failure; it consumes one nonce, debits the existing failed-Gas and lifetime-profit breakers, and allows
  unrelated routes to continue when those breakers remain open. Replace the critical-alert process's heavy imports,
  raise its cgroup ceiling from 64 to 128 MiB, and rewrite critical and daily Feishu messages as concise Chinese
  operator outcomes without raw internal fields. Production isolation proved the remaining `SIGABRT` was the health
  unit's eight-task ceiling when Node opened DNS/TLS workers, not an OOM: raise `TasksMax` to 16, matching the existing
  bounded business reporter.
- Publish `/api/v1/agent/daily-profit` as a server-generated, anonymous read-only projection. It preserves receipt-gated
  USDG/ETH results, deducts failed Gas exactly once, excludes the overlapping project-result layer and offchain costs,
  and adds guarded CoinGecko/Kraken USD plus Frankfurter CNY reference estimates without assuming fixed USDG parity.
  Provider disagreement or missing quotes remains visibly partial, while genuine zero-profit days stay known zero.
- Generalize the universal opportunity graph from cross-venue-only cycles to all bounded same-venue or cross-venue
  two-to-four-pool atomic cycles. Remove the offchain venue-count guard that hid the historical all-Earn
  `PLTR -> EARN -> SPCX -> PLTR` route, preserve distinct-pool/simple-cycle checks in both discovery and plan building,
  and add an address-only historical fixture so token labels cannot become route policy again.
- Replace the fixed settlement allowlist with rule-based dynamic admission. USDG, WETH and configured extras are only
  priority seeds; event wakes add touched graph assets and periodic recovery rotates across the wider graph. Every
  admitted settlement must have trustworthy fixed-block decimals, Morpho flash liquidity or protected executor
  inventory, and graph-verified executable V3 paths for Gas and USDG normalization. Funding checks remain capped at 64,
  admitted assets at 16 and route work at the existing shared budgets; authorization v11 binds the new policy and
  rejects superseded v10/v9/v8 arms.
- Enforce `maximumEventRoutesPerWake` once across every settlement asset instead of once per asset. Event candidates
  now share the eight-route budget by deterministic round-robin, so USDG and WETH each receive fair coverage and an
  empty lane yields its slots to the other. Startup and periodic recovery keep their wider rotating workset, and no
  execution, economic, Gas, nonce, capital or receipt boundary is changed.
- Remove every shared protocol root from the route-specific pool set even when an adapter repeats that root in each
  pool record. In particular, Uniswap v4 PoolManager-only Feed matches are now shared context instead of exact-pool
  wakes; PoolManager plus a non-settlement asset still projects that asset into the event workset. This closes the
  production-observed case where one nominal pool match still touched hundreds of routes without changing profit,
  signing, Gas, nonce, capital or recovery-coverage gates.
- Stop shared protocol roots and WETH/USDG settlement hubs from marking every global route as event-relevant. Project
  Sequencer Feed matches into exact pool/hook and non-hub asset dependencies, quote only those dependent routes, keep
  rotating periodic recovery for completeness, and bind the new semantics to authorization v10. Persist wake-to-decision
  latency and selected-workset evidence, then expose a Chinese execution funnel on the competition page without claiming
  a lost race when same-block counterfactual evidence is absent.
- Add a dedicated Chinese market-competition page for the seven-day Earn receipt census. Rank public competitor
  addresses and route shapes by confirmed closed-cycle receipts, aggregate receipt-based WETH/ETH net estimates, and
  preserve USDG/NVDA or unknown settlement profit in its native asset beside ETH Gas instead of calling the whole
  amount uncertain. Rehydrate retained evidence into schema v3 without changing signing, execution or disclosure
  policy, and treat a live `EXECUTING` watcher as running in the read-only business view.

- Use a Nitro-v2-compatible WebSocket client for the Robinhood Sequencer Feed: send the required client-version and
  requested-sequence headers, negotiate per-message compression, begin at the already-read startup block, and resume
  from the next observed feed sequence. Replace fixed one-second rejection retries with bounded exponential backoff
  that honors server `Retry-After`, preventing a bad handshake from turning into an IP cooldown while leaving every
  exact quote, Gas, nonce, simulation, balance and profit gate unchanged.
- Require a Sequencer Feed frame to match one reviewed protocol/pool address or at least two distinct graph assets
  before waking global discovery. Event wakes now rank and quote at most eight related routes without filling unused
  slots with unrelated rotations; startup and periodic recovery retain bounded broad coverage. Add non-persistent
  managed-fallback ceilings of 32 logical calls per event wake and eight per recovery wake, keep the existing persisted
  20,000-call daily ceiling, and bind all four limits to a fresh v9 authorization. A cap refusal is recorded as degraded
  signer-free coverage and cannot be reported as a zero-opportunity result.
- Cap global public discovery batches at eight logical calls, matching the live Robinhood Chain RPC boundary. Larger
  `eth_call` batches returned HTTP 429 and consumed 4,560 managed fallback calls without producing a signed attempt;
  the watcher was disarmed cleanly before this production correction.
- Treat viem's exact missing-batch-item failure as a transport fault and retry only that omitted logical call on the
  authorization-bounded managed fallback. Arbitrary `TypeError`, malformed RPC requests and EVM reverts still fail
  without provider fanout.
- Batch global graph reads on the official public RPC and use the managed endpoint only after a transport or rate-limit
  failure. Persist a 20,000-logical-call UTC-day ceiling, debit it before fallback, bind it to authorization v8 and
  expose only the operator-safe used/limit totals in the business snapshot. Deterministic EVM reverts, signed-raw
  submission, profit guards and the single nonce lane remain unchanged.
- Generate a source- and bytecode-hashed universal executor artifact during the release build, then load that small
  root-owned artifact in every live quote, reconciliation and fork process. The signer no longer loads Solc or
  recompiles the executor on each Sequencer/periodic wake, keeping its graph scan inside the production memory cgroup
  and shortening the event-to-submit path without weakening code-identity checks.
- Materialize every Solidity `immutable` reference with the reviewed constructor value before committing a universal
  executor runtime hash. Recover the single v0.14.2 deployment only when its old template commitment, successful
  receipt, exact concrete runtime, operator and protocol identities all agree; future plans bind the concrete hash
  before signing.
- Match the real Balancer v3 and Uniswap v4 settlement boundaries in the universal executor: approve BPT removals to
  the Earn Router that actually pulls them, and execute each v4 swap before settling its resulting input debt and
  taking its output credit. Tighten deterministic mocks so either reversed ordering or the wrong allowance spender
  fails in CI before the mandatory mainnet-fork gate.
- Require nonzero reserves for discovered Uniswap v2 pools and nonzero active liquidity for Uniswap v3 pools at the
  catalog block. Canonical factory existence alone no longer admits an inert pool into the executable asset graph;
  zero-liquidity records remain visible in the rejected evidence set.
- Keep the mandatory four-template mainnet-fork gate bounded to its four exact calls. Per-action prefix replay remains
  an explicit one-template diagnostic mode, preventing a failed gate from silently expanding into dozens of fork
  calls and exhausting a small production host.
- Probe each Earn token's canonical Permit2 approval behavior with a fixed-block, non-persistent `eth_call`. Preserve
  swaps that receive a restricted token and every remove-liquidity edge, while excluding only Earn input edges and add
  hyperedges that the deployed Router cannot fund. This captures venue-specific token behavior instead of assuming
  every nominal ERC-20 is Permit2-compatible.
- Make the universal mainnet-fork gate read its canonical catalog and place Hardhat's fork cache under `MANGA_RUN_DIR`
  by default, so the documented unprivileged production command validates protected runtime artifacts without path or
  filesystem-permission overrides.
- Add a typed-only universal atomic executor and one asset graph across Earn plus Uniswap v2/v3/v4. Support USDG,
  WETH and explicitly allowlisted settlement assets backed by zero-fee Morpho flash liquidity or protected executor
  inventory. Enumerate bounded BPT premium/discount templates and rotating 2–4 hop cross-venue cycles, refine positive
  sizes without a fixed capital cap, and preserve exact pool, residual, repayment, minimum-profit and receipt-effect
  checks.
- Add the Robinhood Sequencer Feed as an address-filtered wake source and submit every persisted signed raw transaction
  to the official Sequencer before falling back to the managed RPC with that identical raw. Bind the executor hashes,
  settlement/funding/graph/route/feed/submission policies and quote-work bounds to a fresh v7 authorization, include
  global effects in the single nonce ledger, daily-profit model and Chinese operations dashboard, and retain public
  RPC for broad discovery.
- Remove the Earn website API from the live signing dependency after Cloudflare challenged the production server with
  HTTP 403. Discover all pools directly from the canonical Omnipool Factory, retain one explicitly reviewed pre-factory
  pool, and read each pool's immutable tokens/weights plus current scaled balances/status at one chain block. Quarantine
  a malformed permissionless pool instead of stopping unrelated routes. Authorization policy v6 now binds the onchain
  source, factory, scope, 2–4 hop graph and existing quote/Gas limits.
- Replace the Earn live executor's four AI/MOO routes with a dynamic graph over every initialized Omnipool returned by
  the official catalog. Enumerate all simple WETH-settled cycles up to four swaps, rank the full graph locally with a
  Gas-aware weighted-pool model, then buy exact quotes for at most 24 hop-diverse routes and refine at most eight. Any
  canonical Vault Swap now wakes the lane, the selected dynamic route is frozen into the immutable mutation plan, and
  policy v5 binds the pool scope, hop limit and 120-call public ceiling while retaining the one-route nine-call managed
  preflight and every existing net-profit, reserve, nonce, simulation and receipt guard. Expand the read-only
  competitor census from four known paths to every contiguous amount-linked Vault cycle without mislabelling non-WETH
  settlement as ETH profit.
- Add one independent `机会` page without restructuring the existing operations pages. A lightweight paginated ledger
  separates exact-ready, near-threshold, filtered and unknown candidates, delays current positive route/principal
  disclosure for five minutes, and never upgrades historical positive episodes into lost-profit evidence. Remove the
  full opportunity projection from global browser polling and load only twelve summaries when the original strategy
  page is open.
- Add a signer-free seven-day Earn reviewed-receipt census on the official public RPC. It recognizes only exact
  pool/token/order/amount-linked copies of the four approved WETH cycles, aliases actors in the public projection and
  keeps external economics at `ROUTE_RECEIPT_NET_ESTIMATE`; confirmed lost races remain unknown until a same-block
  counterfactual exists.
- Follow the funded Base executor migration to `0x002ccD95D1304C6fB88f67183DC1e7d1b90A577F` and consume sanitized
  heartbeat schema v2. Both fixed profit floors are now one wei, so the strategy page distinguishes a merely
  gross-positive spread from a candidate that passed latest-block re-quote, Gas and net-profit gates; no Base signer,
  capital policy or broadcast behavior is implemented by the dashboard repository.
- Publish a tiny allowlisted market-operations snapshot atomically beside the signer feed and make the business
  reporter consume that file before its bounded HTTP fallback. This removes the five-minute report from the scanner's
  busy event loop while preserving a three-minute freshness limit, systemd liveness check and explicit observation
  time; wallet, signing, quote and RPC behavior are unchanged.
- Treat a final pre-sign fee increase or quote drop as one exact candidate miss after the unresolved-mutation gate,
  rather than terminating the until-revoked watcher as an invariant. Receipt, balance, nonce and identity conflicts
  remain terminal, and no signing or economic threshold is relaxed.
- Retry a busy loopback board read once before publishing an `UNKNOWN` market section in the business snapshot. Keep
  both attempts local, bounded to eight seconds each, and fail closed after the second failure without reusing stale
  market values or touching any RPC/signing path.
- Move the full unit and deterministic contract suites out of the 2 GB production install path and keep them in the
  mandatory GitHub quality gate. Production now rebuilds types, UI, contract artifacts and the secret scan only. Raise
  the measured board boundary to a 320 MiB V8 heap inside 512/576 MiB cgroup thresholds after the growing compact index
  exhausted the prior 256 MiB heap during a controlled restart.
- Limit the operator-facing Robinhood opportunity table to the twelve highest-priority routes while keeping the full
  source API and background scan intact. State the hidden-row count explicitly so the operations page stays concise
  without implying that unshown candidates disappeared.
- Publish a receipt-gated seven-day `/api/v1/profit/daily` read model directly through Nginx. Keep USDG and ETH/WETH
  separate, mark the current Beijing day in progress, expose failed Gas, and leave consolidated business net UNKNOWN
  while shared-cost coverage is partial.
- Integrate the credential-free atomic-cycle Robinhood/BNB venue shadow through
  `/api/v1/opportunities/chains`. The Chinese strategy page shows per-chain venue/asset coverage, completed quotes and
  Gas-adjusted positive counts; partial coverage remains visibly unknown and grants no execution authority.
- Replace the Earn keeper's 24-point-per-route flat probe with the authorization-bound
  `BALANCE_SCALED_BRACKET_REFINEMENT_V1` optimizer: eight full-range balance-scaled quotes plus six exact local
  refinements per route. Cap the public screen at 56 quotes, hand only its committed route and immediate sizing bracket
  to the managed endpoint for at most nine current-block quotes, and evaluate Gas for one best amount per represented
  route before the unchanged final quote/call/Gas guards. Reduce reviewed-pool public event polling from four seconds
  to one second and record the source-receive boundary for event-to-wire analysis. The v4 authorization commits every
  sizing and quote-budget field, so deployment requires a clean revoke/reconcile/re-arm cutover.
- Admit both reviewed direct `WETH -> AI -> WETH` directions across STOCK MEMES and LONG ECO to the standing
  EarnOnHood route book. Preserve the existing two triangles and all final execution guards, validate every directed
  pool/token edge with one identity read per pool, and reserve one bounded Gas evaluation for each profitable route so
  lower-Gas two-hop loops cannot be hidden by higher-gross three-hop probes. The changed route commitment requires a
  fresh production authorization.
- Include receipt-confirmed EarnOnHood ETH loops in today's, all-time and active-authorization strategy results instead
  of leaving those counters at zero. Keep USDG and ETH net results separate, deduplicate identical receipt rows, drop
  conflicting duplicates, surface the active Earn count/net in the strategy page, and include both native units in the
  Feishu daily report.
- Make the public dashboard a catch-all port-80 virtual host instead of matching one literal Host header. Serve the
  built UI directly from Nginx and keep a 30-second, stampede-locked presentation API cache with background refresh
  and stale-on-upstream-failure fallback. The market scanner remains loopback-only, the health check remains uncached,
  and the installer now warms every UI endpoint and rolls back if either the static surface or cache is unavailable.
- Integrate the reviewed EarnOnHood WETH/AI/MOO triangle into the single until-revoked dual signer. Replace the fixed
  `0.002 WETH` input ceiling with balance-scaled probes whose maximum is the current spendable wallet balance. Public
  Vault events and a five-minute recovery tick wake the standing route book; the managed RPC is touched only after a
  public screen is net-positive. A full failed-Gas charge must leave receipt-proven lifetime Earn net strictly positive,
  and final receipt acceptance now requires the exact three Swap logs, canonical Gas and exact-block wallet delta.
- Treat gross-positive/net-negative Earn quotes as normal `NO_SHOT` results before constructing an impossible protected
  Gas estimate. Add unified nonce/audit accounting and UNKNOWN reconciliation for Earn mutations, plus a stable
  application User-Agent for the Earn discovery API.

- Replace the presentation-style console with a four-page, data-first operations dashboard: `概览`, `交易`, `资金` and
  `策略`. Add a schema-v3 unified project activity ledger, per-native-asset project economics, transaction filters and
  receipt drawers; move the Base funding receipt out of a special funds card. Material execution/collection ledger
  changes can trigger a sanitized refresh while the five-minute balance/report timer remains. Opportunity, signing,
  nonce, broadcast and contract behavior are unchanged. Collection rows use the reviewed MANGA/SPX business identity
  instead of exposing the underlying USDG contract address in the primary table. The global runtime badge now reports
  the execution process independently from market-data coverage, while incomplete quotes retain their own warning.
- Add a one-shot, exact-allowlist collector for the funded historical MANGA and SPX executors. It freezes both full
  USDG withdrawals under one aggregate Gas envelope, retains at least `0.0025 ETH`, shares the production wallet lock,
  excludes every signer generation, persists each signed raw transaction privately and requires final receipt, exact
  `Withdrawn` event, USDG/ETH balance deltas and nonce convergence before updating either legacy state file.
- Publish the sanitized Chinese operations console through a port-80 Nginx read-only proxy while keeping the Node board
  bound to loopback. Add a current two-chain funds map and a receipt-linked reconciliation of the user's initial
  `0.01 Base ETH` into retained Gas, WETH execution principal and deployment/initialization Gas. Raw board catalogs,
  mutation methods, signer material, RPC credentials and the Feishu webhook remain outside the public surface. Retry
  the post-reload virtual-host health check and restore the prior Nginx configuration if the public proxy never becomes
  healthy.
- Add a public-RPC-first EarnOnHood weighted-pool research scanner and a separately guarded native-ETH one-shot lane for
  the reviewed WETH/AI/MOO triangle. Fixed pool identity, same-block exact quote, buffered Gas, on-chain net-output floor,
  wallet reserve, latest nonce and shared-watcher exclusion gates fail closed before the private credential is loaded.
  Record the first canonical mainnet validation: `0.000131868227091194 ETH` wallet net after Gas, without treating one
  receipt as opportunity-frequency or scale evidence.
- Add one Chinese-first `资金` page for two operator wallets, three active executors and two stopped-but-funded
  executors across Base and Robinhood Chain. Read balances at one fixed block per chain, verify executor identity,
  preserve partial/unknown states, and consume only a field-allowlisted Base runtime heartbeat. Isolate its low-frequency
  Base reads on a production-verified public endpoint after the official endpoint rate-limited bounded contract calls;
  neither execution RPC nor signer service is changed or restarted.
- Add a reproducible Ubuntu `ssh.socket` drop-in for the private dashboard tunnel. Port 2222 remains key-only,
  client-local-forward-only and cloud-firewall-restricted; the dashboard itself stays bound to loopback.

- Decouple loopback health from the last full-board projection. A successful event cycle now restores live health
  immediately even when its non-material economic snapshot is intentionally deferred; error publications, partial
  catalogs, stale cycles and unhealthy SQLite parity remain fail-closed.
- Coalesce routine event-cycle board publications into the next mandatory periodic snapshot. New positive screens and
  removal of a previously signer-visible positive or reconciliation of an open economic episode still publish
  immediately; non-material negative refreshes persist only their small runtime cursor until the next periodic
  projection. Remove the redundant periodic pre-quote
  `SCANNING` snapshot and expose full-publication phase timing and deferral counters.
- Coalesce the four possible large source-catalog writes in one protected periodic cycle into one atomic projection.
  Freeze the last projected source cursors until that file and the general runtime checkpoint commit in order, so a
  crash can cause safe re-observation but cannot skip an unprojected block range. Expose projection count, duration and
  total periodic-maintenance timing without changing sources, admission, signing or RPC budgets.
- Cache the validated source-target index across hot polls, use its branded fast retention path, skip empty Initialize
  ingestion and avoid unchanged PAIR/ambiguity merges. Split decode, coalescing, Initialize ingestion and route/queue
  timing while retaining the aggregate metric.
- Add an opt-in managed RPC lane only for `EXECUTOR_COMPATIBLE` and `EXECUTOR_SHAPE` event quotes while retaining
  public-RPC log polling, discovery, backfill and periodic coverage. Persist strict UTC-day ceilings of 200 event
  candidates and 4,000 logical JSON-RPC calls, degrade to the public reader on cap/transient failure, and expose
  provider-role, fallback and latency telemetry without adding signer capability or changing any economic gate.

- Prioritize event wakes by live execution evidence, then the deployed executor's exact PoolKey shape, before
  shadow-only candidates; preserve freshest-first ordering inside each tier and keep broad shadow coverage in the
  protected periodic lane. Expose selected-tier counters without changing RPC endpoints, signing authority or economic
  gates.
- Keep source-only singleton targets in the durable source catalog without allocating temporary strategy-token rows;
  only targets with a plausible multi-pool route are materialized in the live strategy graph.
- Bound the protected periodic coverage tranche to one V4 pair, one amount and one V3 route per direction after the
  first v0.8.0 production cycle required 165 Quoter calls for a single candidate. Keep sampled negatives explicitly
  non-exhaustive and leave receipt-gated execution unchanged.
- Join PAIR, LONG and Doppler target facts to the retained PoolManager catalog in a bounded multi-source strategy graph.
  Admit arbitrary chain-attested hooks only to signer-free shadow quoting, retain the current executor's exact PoolKey
  boundary for live candidates, and cap source pools per target without displacing existing PAIR rows.
- Replace event-preemptible broad scans with a one-candidate protected periodic tranche while keeping the independent
  event poller and its fast route/amount bounds. Surface completed-periodic age, fresh coverage and the full
  pool-to-preflight funnel instead of presenting process liveness as market coverage.
- Add a Chinese-first opportunity funnel to the private dashboard. It explains how many pools form multi-pool targets,
  how many enter the strategy graph, how many have fresh results and how many pass each economic gate; unsupported pool
  types remain observation-only and technical fields stay outside the primary reading path.

- Turn event wakes into a bounded hot path: discard candidate backlog older than 20 seconds, prioritize the freshest
  candidate, quote one touched/previous V4 pool pair and at most two sizes per base, and let a new accepted event
  cooperatively preempt a warm periodic reconciliation before its next RPC read. Treat a provider-wrapped preemption as
  an intentional yield instead of a network fault. Re-quote only the strongest previously proven V3 route during an
  event wake and use one fast retry there, while periodic reconciliation retains its broader topology discovery and
  three-attempt read policy. Every event probe remains a fresh fixed-block Quoter screen; full topology and sizing
  coverage stays in periodic reconciliation, and signing gates are unchanged.
- Bound previously unseen V3 directions to eight deterministic low-fee bootstrap paths unless a periodic cycle has one
  of its two full-discovery slots available. Reuse the three strongest V4 entry/exit pool pairs for later amounts only
  inside the same fixed block, deduplicating identical V4 calls there. Every reused pair and path still receives a fresh
  canonical quote, and a wholly failing V4 shortlist falls back to the full current-block pool set.
- Cap priority, positive and coverage work at four total candidates per cycle. Reuse up to three structurally validated
  V3 routes across blocks and restarts, re-quote every cached path at the current fixed block, invalidate observed
  route pools on `Swap`, and spend at most two full topology rediscoveries per periodic cycle. Event cycles never spend
  topology-refresh budget; exact execution preflight and signing gates are unchanged.
- Run hot-log polling independently of slow quote cycles, coalesce each range to the latest swap per pool and rebuild
  dependencies before the cycle fixed block, while keeping events as non-executable wake evidence.
- Replace unsupported public JSON-RPC batches with code-hash-pinned, four-call Multicall3 groups for V3 Factory and
  Quoter reads. Re-read every failed subcall directly at the same block, and stop fallback fan-out on the first direct
  transport failure. Keep V4 hook calls direct and the paid execution RPC isolated behind the exact-preflight threshold.
- Split the latency-sensitive event cursor from historical completeness: cap public-RPC hot log ranges, detect stale
  cursor lag, record every skipped interval, and resume near the confirmed head with a reorg lookback instead of
  replaying day-old swaps as if they were current.
- Separate the `0.05 USDG` signer-free screen trigger from the unchanged `0.10 USDG` exact signed-net floor. Near-edge
  rows now receive a same-block exact call and gas estimate; only an independently profitable exact result can sign.
- Surface exact-preflight activity and plain-language real-time event health in the Chinese operations console.
- Apply release-owned threshold and hot-range values at the process command boundary, so a retained production
  `EnvironmentFile` cannot silently restore the previous values.
- Rebuilt the private dashboard as a Chinese-first four-page operations console. It now separates current-strategy
  results from account history, groups opportunities by actionability, presents transactions as a readable ledger and
  hides exact values, addresses and provenance evidence behind deliberate disclosures.
- Simplified the Feishu daily report around verified net profit, executions, failed Gas, reinvestable capital and
  actionable opportunity counts.
- Close opportunity evidence automatically when navigation changes so technical detail cannot remain over another
  product page.

- Add a private business-first dashboard with Beijing-day receipt economics, authorized USDG/WETH reinvestment,
  seven-day results, source separation and Blockscout-linked transactions. Publish it through a validated sanitized
  snapshot that expires after 15 minutes and retains the board's no-signer, no-mutation boundary.
- Add an independent 09:05 Beijing Feishu daily report backed by an encrypted systemd credential, a five-minute retry
  timer, period-keyed fsynced delivery receipts and crash recovery. Reporting can read canonical ledgers but cannot load
  the trading key, write trading state or affect trading-service success.
- Start the constrained one-shot reporter with one direct Node process so its 16-task systemd limit cannot be exhausted
  by nested npm and report runtimes before the script begins.
- Accept systemd's immutable `0440 root:root` runtime credential only inside the unit-specific credentials directory,
  while continuing to reject ordinary group-readable webhook files.
- Retry transient dual-watcher startup chain readback five times with bounded exponential backoff, persist degraded
  retry telemetry, and load the private credential only after chain identity, deployments, balances and nonce converge.
  Wrong-chain, authorization, ledger and state mismatches still fail immediately.
- Publish a compact execution-feed checkpoint immediately after any newly quoted proxy-positive candidate and before
  slower source-catalog maintenance. This preserves the signer's 30-second freshness gate without relaxing its exact
  net-profit floor, route validation or fail-closed behavior.
- Count every distinct signer-free feed generation in dual-watcher liveness telemetry, including generations with zero
  screened-positive rows. Report screened-positive generations separately so an idle-but-observing watcher cannot be
  mistaken for a stopped watcher; signing and exact-preflight behavior are unchanged.
- Separate dashboard control-plane, admitted-opportunity summary and one-ID evidence projections after the production
  `/api/v1/system` path expanded 41,652 source discoveries and exhausted V8 old space. Keep the complete source census
  in evidence storage and coverage metrics, drop duplicate in-memory Doppler detail objects, and retain the existing
  board cgroup and signer boundary.
- Bound the restart source projection after the live catalog reached 82 MB: retain every discovered target and PoolKey,
  move reconstructable log fields exclusively to the append-only evidence store, derive visible Doppler facts from its
  complete target index, and require an exclusive hash-verified backup for the one-shot schema-v5 migration.
- Add a separate bounded WETH-principal executor and a single dual-v3 signing lane. The signer-free board can quote
  USDG and WETH cycles at one fixed block; exact candidates are re-simulated at one current block and only the largest
  conservatively normalized net profit is signed. Retained profit compounds independently, while both bases share one
  nonce, UNKNOWN barrier, durable revocation, ETH reserve and failed-Gas breaker. Production deployment and the
  receipt-separated runtime evidence are recorded without claiming an unobserved dual-era profit.
- Stream the growing source catalog through a bounded canonical atomic writer, reference its hash from SQLite economic
  checkpoints instead of copying the full document, preserve the signer feed across board restarts and retry transient
  `ENOENT`/`ESTALE` feed loss without weakening permission, integrity or signing gates.
- Add an explicit until-revoked generic watcher authorization. It has no wall-clock expiry, compounds only from
  confirmed executor USDG post-balances up to the immutable 100 USDG contract cap, and retains failed-Gas, ETH-reserve,
  exact-profit, nonce, unresolved-mutation and manual-revocation breakers.
- Serve the signer bridge a compact fresh-positive board view and retry board-only transport failures indefinitely with
  bounded backoff. Dashboard clients keep the complete snapshot, and execution-RPC failures retain their finite halt.
- Persist the compact signer projection atomically and let the Linux watcher read it through a read-only Unix group,
  decoupling candidate consumption from the board scanner's single HTTP event loop without sharing signer state.
- Keep that signer projection in a dedicated mode-0750 runtime directory so the board's private SQLite directory can
  remain mode 0700. Add an explicit, default-off public execution-RPC exception for reviewed provider outages.
- Add opt-in rolling leases for the autonomous generic watcher. Renewal runs inside the existing Linux process, keeps
  one authorization ID so failed Gas and all usage remain cumulative, revalidates deployment/balance/nonce/reserve
  invariants, retries transient provider failures and cannot revive an expired lease.
- Accept the deployed signer-free board's additive schema-v4 snapshot through one shared generic execution/runtime
  identity gate while retaining the existing service identity, read-only mode, authorization flag and same-block
  pool-attestation checks.
- Raise only the signer-free board's cgroup headroom to `MemoryHigh=448M` and `MemoryMax=512M` after sustained live
  scanning at the prior pressure threshold starved its loopback snapshot API; signer limits and execution authority are
  unchanged.
- Allow the generic watcher authorization to declare confirmed executions, signed attempts and exact preflights as
  `unlimited`, while retaining expiry, failed-Gas, ETH-reserve, exact-profit, principal, nonce and unresolved-mutation
  circuit breakers. Fixed-route watcher limits remain unchanged.

## 0.6.2 — 2026-09-07

- Advance one bounded hot-log range before consuming an existing candidate backlog, so quote work cannot starve the
  PoolManager/V3 event cursor.
- Preserve the four-candidate quote cap: a successful poll may coalesce newer revisions into the queue, while a failed
  public-RPC poll records the error but still permits already-observed candidates to progress.
- Resolve the active wake queue only after polling, so a canonical reorg rewind cannot leak stale pre-reorg wakes.
- Keep the release signer-free: executor bytecode, watcher authorization, wallet state and broadcast paths are unchanged.

## 0.6.1 — 2026-09-07

- Reject the v0.6.0 production canary after its first source projection reached the 256 MiB cgroup ceiling; roll back
  without starting either signer or changing the wallet nonce.
- Retain PoolManager facts only when a currency is an independently discovered PAIR, LONG or Doppler target, and give
  the generic pool scan its own cursor instead of inheriting PAIR chain-catalog coverage.
- Keep a compact Doppler target index so later pools remain discoverable, while exposing only PAIR-, LONG-, multi-pool-
  or pending-scan rows and persisting full immutable log evidence before compaction.
- Replace repeated full-snapshot/source-catalog ledger records with bounded singleton SQLite current projections plus
  append-only source evidence, economic events, material positive observations and compact integrity checkpoints.
- Add crash-safe JSONL byte offsets and streaming legacy replay; preserve the v0.6.0 database and ledger without
  deleting or rewriting historical evidence.
- Set the board-only memory pressure boundary to 320 MiB and its hard cgroup ceiling to 384 MiB after a migration test;
  signer services remain disabled and isolated.
- Promote the commit-addressed artifact after Linux migration, bounded-growth, public-RPC, desktop/mobile UI and
  signer-non-mutation gates; backfill NINECAT as LONG route / Doppler / Uniswap v4 without PAIR attribution.

## 0.6.0 — 2026-09-07

- Add independent PAIR-listing, LONG-route, Doppler-protocol, Uniswap-v4 and Robinhood-asset adapters with bounded
  coverage and claim-level immutable evidence; unknown or conflicting claims fail closed.
- Correct the NINECAT projection to `LONG_ROUTE / DOPPLER / UNISWAP_V4 / NINECAT-AI` and keep both assets custom unless
  the canonical Robinhood registry proves otherwise.
- Materialize current board state in SQLite while retaining an append-only JSONL evidence ledger, replay, parity checks
  and a non-destructive legacy read-model rollback.
- Add a signer-free React/Vite private console with Overview, paginated Radar, source coverage, episodes, read-only
  execution and system-pressure views; full evidence loads only when a row is opened.
- Keep the dashboard loopback-only and same-origin, reject mutating API methods, omit signer material and preserve the
  public-RPC observation profile.
- Override `solc`'s legacy temporary-file helper with compatible `tmp@0.2.7`, closing the current npm audit findings
  without changing the Solidity compiler.

## 0.5.4 — 2026-09-07

- Normalize the obsolete executor-deployment estimate when recovering persisted board state, so stale rows cannot retain
  the inaccurate v0.5.2 label after an upgrade.

## 0.5.3 — 2026-09-07

- Describe board-only screens as requiring an exact executor preflight instead of incorrectly claiming that the already
  deployed generic executor does not exist.

## 0.5.2 — 2026-09-07

- Put a hard deadline around event waiting so a continuously busy pool-event stream cannot starve periodic catalog
  coverage, stale-state reconciliation or durable `Initialize`-log backfill.
- Publish the last and next mandatory reconciliation timestamps with the event metrics.

## 0.5.1 — 2026-09-07

- Treat an identity-only viem `UnknownRpcError` as incomplete transport evidence after EVM-revert identity has been
  excluded, so a missing batch item cannot collapse into a false no-route business result.
- Retry all bounded chain reads consistently and fail over once from batched JSON-RPC to independent requests when the
  provider returns a malformed or incomplete batch response; expose the active mode and fallback evidence in metrics.

## 0.5.0 — 2026-09-07

- Replace repeated hot full-board scans with bounded public-HTTP PoolManager/V3 event wakeups plus a slower coverage
  reconciliation; persist canonical cursors, deduplicate logs and rewind on a block-hash mismatch.
- Merge stable 1,000-row PAIR API pagination with incremental PoolManager `Initialize` backfill, while reporting chain
  completeness only from the configured start block.
- Recompute every API PoolKey and separate shadow admission from live admission. Disabled quotes, unknown depth and the
  API-observed undocumented Launch V2 hook cannot enter a schema-v3 execution plan.
- Require both selected pools to carry same-block V4 Quoter attestation before the current generic executor accepts a
  schema-v3 board candidate.
- Count economic opportunity episodes rather than quote refreshes, and append a migration epoch so stale or unquotable
  gaps do not inflate frequency.
- Publish event-engine metrics and chain-catalog evidence through loopback-only endpoints and the dashboard.
- Deduplicate identical V3 anchor quotes within one fixed block and transport independent JSON-RPC calls in bounded HTTP
  batches, while reporting HTTP POSTs separately from contract-call and provider-billing claims.
- Bound periodic work to priority rows, actual positive rows and one configured coverage batch; retain failed V3 factory
  evidence for the fixed block and trip a cycle-level RPC circuit instead of amplifying a provider outage.
- Rotate two historical priority rows per cycle and make full-grid expansion evidence-driven instead of spending public
  RPC capacity on every no-edge priority row.
- Separate candidate concurrency from within-candidate leg concurrency so independent fixed-block calls can share a
  bounded HTTP batch without expanding multiple candidate grids at once.
- Re-rank the complete allowed V3 path set on the first amount of every fixed block, then quote only its top-three
  shortlist for larger amounts; reduce the coarse amount grid to 5/10/25/50/100 USDG before bounded refinement.

- Treat the exact latest unresolved signed generic execution as the already-reserved current attempt at the final
  broadcast boundary, so the last authorized attempt can be sent without permitting an additional attempt.
- Fail closed when the signed-attempt identity, authorization, ordering, ledger count or unresolved state differs from
  the current immutable plan.
- Redact credentialized HTTP and WebSocket URLs before provider errors enter runtime state, audit logs or CLI stack
  output.
- Add an explicit two-reader `--abandon-expired` reconciliation terminal for unbroadcast generic executions and reject
  attempts to replay a raw transaction after its on-chain deadline.
- Project canonical audit-ledger usage over stale watcher snapshots and refresh persisted counters on every terminal or
  degraded watcher path, so operational readback cannot under-report signed attempts.

## 0.4.0 — 2026-09-05

- Add an expiring, bounded generic-v2 authorization and autonomous Linux watcher.
- Keep idle discovery on the signer-free loopback board; use the strategy RPC only for one newly triggered candidate's exact preflight, signing and receipt convergence.
- Independently cap exact preflights, signed attempts, confirmed executions, failed gas, per-transaction principal and authorization lifetime.
- Revalidate the authorization immediately before and immediately after signing, and refuse a public RPC in the live mutation lane.
- Mutually exclude fixed and generic watcher generations in code and systemd while retaining the shared wallet lock and UNKNOWN barrier.
- Require receipt, event, executor balance, wallet Gas delta and contemporaneous native mark before a generic execution becomes a terminal economic effect.
- Add hardened one-shot deployment and arm units plus a persistent generic watcher unit.
- Give the deployment one-shot a 180-second start timeout so its 120-second canonical receipt wait cannot be killed by
  systemd's default start timeout.
- Clear a recovered board-transport error from watcher readback as soon as the loopback board succeeds again.

## 0.3.0 — 2026-09-05

- Add a typed generic PAIR executor for stock, AI, meme and other quote assets without arbitrary call targets.
- Enforce the 100 USDG cap, canonical PAIR pool shape, V3 fee allowlist and direct-or-one-WETH-bridge anchors on-chain.
- Add adaptive amount search through 100 USDG, bounded midpoint refinement and maximum absolute net-profit selection.
- Pace full-grid refreshes for persistent candidates and ship a conservative official-public-RPC board profile.
- Enforce a post-cycle public-RPC cooldown even when a long scan exceeds its nominal interval.
- Publish complete typed route payloads for positive amount variants and exact-preflight the strongest candidates.
- Add generic deploy, one-shot execute, UNKNOWN reconcile and withdrawal commands with raw-before-broadcast persistence.
- Add deterministic direct/bridged contract coverage, historical mainnet-fork verification and a validated sniper spec.

## 0.2.2 — 2026-09-04

- Reconcile the newest-token page before deciding whether a moving PAIR pagination pass covered its advertised total.
- Keep up to 32 currently positive screens on the priority refresh path by default.

## 0.2.1 — 2026-09-04

- Permit only a client-local SSH forward to the loopback opportunity board while keeping arbitrary forwarding,
  GatewayPorts, tunnels and password authentication disabled.

## 0.2.0 — 2026-09-04

- Add a continuously refreshed PAIR multi-pool opportunity census with fixed-block four-leg quotes.
- Rank gross and gas-proxy net results without claiming generic execution or receipt evidence.
- Add an auto-refreshing loopback dashboard and append-only material-change ledger.
- Isolate the scanner under a signer-free Unix identity, read RPC, systemd unit and runtime directory.
- Add exact tests for discovery gates, gas math, stale fail-closed behavior, events and atomic publication.

## 0.1.3 — 2026-09-04

- Accept systemd's immutable `0440 root:root` credential files only inside the unit-specific credentials directory.
- Keep ordinary signer files restricted to owner-only permissions and reject symlinks.

## 0.1.2 — 2026-09-04

- Bind the Linux signer to an encrypted systemd credential and remove the plaintext credential source path.
- Add bounded runtime resource controls and restart only after abnormal process termination.
- Resolve npm through the controlled service path during deployment verification.
- Add a key-only SSH hardening drop-in for the dedicated signing host.

## 0.1.1 — 2026-09-04

- Verify systemd service units on Linux CI and keep runtime startup read-only under the hardened filesystem sandbox.

## 0.1.0 — 2026-09-04

- Extract the MANGA CHAN route from the mixed LP workspace without changing deployed Solidity source.
- Add durable intent/plan/raw/effect mutation records and UNKNOWN reconciliation.
- Classify provider state-readiness failures separately from invariants.
- Replace five-second primary polling with targeted WSS swap triggers and a recovery poll.
- Add independent unit and deterministic Cancun EVM contract tests.
- Add automated style, type, compile, test, secret and CI gates.
- Add release, systemd, ADR and operations documentation.
