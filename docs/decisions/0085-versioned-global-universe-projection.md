# ADR 0085: Project the discovery universe into Global without coupling search to funding

## Status

Accepted for implementation on 2026-09-15.

## Context

The source board has independently attested more than 91,000 retained Uniswap V4 pools and more than 4,700 admitted
multi-pool candidates. The live Global graph nevertheless contained about 91 assets, 827 directed swap edges and five
V4 pools. The two services use different state directories, so `global-arb.mjs` could not consume the board's current
source catalog and silently fell back to its reviewed bootstrap pools.

The complete source catalog is about 40 MB and changes whenever cursor or evidence state advances. Copying or parsing it
inside the signer process would add latency, memory pressure and an unsafe coupling to a large read model. It would also
turn harmless catalog timestamp changes into expensive V2/V3 RPC refreshes.

Production readback exposed a second semantic coupling. Settlement funding admission happened before route discovery.
One current recovery saw 37 settlement candidates, admitted zero funding sources and consequently reported zero routes.
That is evidence that the universal executor could not fund a route at that block; it is not evidence that the graph had
no route or that the market had no price discrepancy.

## Decision

- The signer-free board writes a separate, small `global-universe.json` handoff whenever it commits a source-catalog
  generation. It contains only normalized PoolKeys, token addresses, capability classifications, a safe head and a
  deterministic topology hash. It contains no quote, credential, authorization, nonce, transaction or signing field.
- The projection is deterministically bounded by target, asset and pool counts. Candidates with direct USDG/WETH
  connectivity, stronger current execution capability and newer chain evidence form a persistent priority tranche; a
  second bounded tranche rotates across the remaining valid candidates. Capacity drops and unsupported candidates
  remain explicit summary/rejection evidence instead of disappearing.
- The topology hash excludes timestamps and source-cursor-only changes. Global rebuilds its in-memory graph immediately
  when the topology hash changes, but does not buy a new V2/V3 catalog refresh merely because the board wrote a new
  timestamp. The existing six-hour base-catalog refresh remains the only RPC writer.
- The read-only resident worker may read the projection but still has no writer, managed RPC or signer capability.
  Missing, stale, malformed or over-bound projections are ignored fail-closed and never invalidate the last canonical
  base catalog.
- Global merges the projected V4 groups into its base Earn/Uniswap graph under the existing total graph bounds. The
  universal executor still performs the same current-block exact quote, Gas, minimum-net, balance, nonce and full-call
  simulation before signing. Projection membership is search authority only, never execution proof.
- Route topology is measured for USDG/WETH seeds even when neither Morpho nor the universal executor currently supplies
  principal. Funding admission controls quote/simulation/signing jobs, not whether the system can report searchable
  routes. A funded-empty round is reported as funding-blocked rather than as proven no-profit.
- Edge identity uses a set during graph construction, and a fixed-snapshot test proves the bounded projection preserves
  the expected route. A durable dependency-to-route index remains a later optimization and is not claimed here.
- The shared live authorization commits to the Global-universe policy version. Deploying this release therefore requires
  revoking the old authorization and creating a fresh one after runtime verification.
- The current projection extends the ordered Feed address filter with its route assets and hooks. It remains a wake hint:
  every positive still returns through the unique signer and all latest-state execution gates.

## Safety and evidence boundary

- Discovery evidence can prove that a PoolKey and topology exist. It cannot prove current liquidity, hook behavior,
  profitability, transaction inclusion or realized profit.
- A projected arbitrary hook is searchable only. Empty-hook-data compatibility and every other runtime invariant remain
  subject to exact contract simulation at the latest block.
- No funding is transferred by this change. Fixed executors and the universal executor remain separate custody domains.
- No receipt means no new profit. A funding-blocked or unsupported result must not be presented as zero market profit.

## Consequences

New source pools can enter the Global search graph on the next board projection instead of waiting for a manual file copy
or six-hour catalog refresh. Long-tail candidates receive eventual rotating coverage while the highest-priority tranche
remains continuously resident. The signer consumes a small bounded artifact rather than the full source database.
Operators can distinguish “no route”, “route exists but funding is unavailable”, “quoted non-profitable” and “exact net
positive”.

This does not yet provide a full local V3 tick, V4 hook-state or Earn-state mirror. It also does not make the board's
60-second public log polling competitive with a healthy Sequencer Feed, and it does not make inventory held by a fixed
executor atomically available to the universal executor.

## Rollback

Revoke the current shared authorization, restore the preceding immutable release, run reconciliation, verify runtime and
create a new authorization. The board's source catalog and the new projection are read-only evidence and may be retained.
