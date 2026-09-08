# Event-driven shadow local validation — 2026-09-07

## Scope and claim boundary

This validation used the official Robinhood Chain public HTTP RPC and a temporary local run directory. The board loaded
no signer, created no wallet client, signed nothing and broadcast nothing. Results below are fixed-block Quoter screens,
not executable simulations, receipts or realized profit.

The local chain-catalog smoke deliberately started at block `56,500,000` and processed one 1,000-block batch. It proves
bounded cursor movement only; it is not evidence of completeness from the production default block `45,000,000`.

## Final successful cycle

Command shape:

```bash
MANGA_BOARD_RPC_URL=https://rpc.mainnet.chain.robinhood.com \
MANGA_BOARD_PROVIDER_LABEL=robinhood-public-http \
MANGA_BOARD_RUN_DIR=<temporary-directory> \
MANGA_BOARD_RPC_BATCH_SIZE=20 \
MANGA_BOARD_RPC_HTTP_CONCURRENCY=1 \
MANGA_BOARD_CHAIN_CATALOG_START_BLOCK=56500000 \
MANGA_BOARD_CHAIN_CATALOG_BLOCK_RANGE=1000 \
MANGA_BOARD_CHAIN_CATALOG_BATCHES_PER_CYCLE=1 \
node scripts/opportunity-board.mjs once
```

Observed readback from snapshot schema v3 at `2026-09-07T04:35:14.530Z`:

- wall time: `63.44s`;
- health: `RUNNING`, `lastError: null`;
- API catalog: 2,186 tokens, reported complete for that API snapshot;
- strategy catalog: 941 multi-pool shadow candidates;
- selected this bounded cycle: 6 candidates;
- economic results: 4 `NO_EDGE`, 2 `GROSS_POSITIVE_NET_NEGATIVE`, 0 `SCREENED_NET_POSITIVE`;
- transport: 138 HTTP POSTs, peak concurrency 1, zero logical retries;
- contract-call counters: 84 V3 factory reads, 414 V3 Quoter calls and 165 V4 Quoter calls;
- same-block reuse: 32 factory cache hits, 14 exact-amount quote cache hits, 19 full V3 route discoveries and 93
  shortlist hits;
- chain backfill: blocks 56,500,000–56,500,999 advanced successfully, with no recognized PAIR pool in that sample.

The strongest observed row was SIGMA at 10 USDG through `AMZN -> SIGMA -> MU`: quoted gross profit `0.251241 USDG`,
Gas proxy `0.337240 USDG`, screened net `-0.085999 USDG`. It therefore remained non-actionable. Cybercab also had
positive gross but negative net. No execution candidate was authorized.

## Optimization evidence and rejected approaches

These runs occurred at different chain states, so they are diagnostic observations rather than a controlled benchmark:

- the original broad first cycle selected 47 candidates, took `119.29s` and recorded 3,721 V3 plus 196 V4 Quoter
  calls;
- same-block exact-result deduplication reduced a later run to `88.23s`, but the public endpoint subsequently returned a
  60-second rate limit;
- a Multicall3 experiment preserved amount output but changed returned gas through warm-state effects and failed to
  finish the broad cycle after `245.11s`; it was removed from the implementation;
- early JSON-RPC batching exposed two fail-open defects: factory transport failures were being cached as pool absence,
  and normal V3 quote reverts could be confused with transport failures. Both now fail or continue according to call
  semantics, with tests;
- the accepted design rotates two priority rows, adds four coverage rows, starts at 5/10 USDG, expands only on gross
  evidence, uses a 5/10/25/50/100 coarse grid, and keeps the top three successful V3 paths from the first amount for
  other amounts at that fixed block.

HTTP POST count is not a claim about provider compute-unit billing. Production RPC reduction, event-to-quote latency,
opportunity frequency and race-win probability remain unknown until a deployed observation window records them.
