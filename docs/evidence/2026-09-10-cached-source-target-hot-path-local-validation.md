# Cached source-target hot-path local validation — 2026-09-10

## Outcome

Version `0.8.9` removes repeated complete-source normalization from the signer-free event ingestion path. It caches the
validated source-target index, refreshes it at the three owning source adapters, reuses it for hot retention and graph
construction, skips empty Initialize ingestion, and exposes four subphase timings.

This is local/repository evidence only. It does not prove production installation, a steady-state latency reduction, a
screened opportunity, an exact preflight, a signed transaction or realized profit.

## Production defect evidence used as input

The active `0.8.8` board remained `active/running` with zero restarts, but a loopback API read timed out after 20 seconds
during synchronous work. A completed catch-up poll over 200 blocks reported 1,986 decoded events and 5,641.67 ms in the
combined decode/route phase. The next periodic cycle took approximately 127 seconds between published snapshots and
increased the admitted candidate count from 3,546 to 3,547. These observations identify blocking work; they do not
prove which subphase dominates after this change.

## Comparative local workload

A one-process synthetic workload used 44,521 source targets and 62,441 retained pools, matching the scale of a prior
production source snapshot. On this machine:

- building and checksumming the target index took 394.00 ms;
- retaining pools while normalizing that already-built index again took 355.44 ms;
- retaining the same pools with the prevalidated index took 4.21 ms; and
- building the graph with the cached index took 3,358.58 ms, compared with 3,778.69 ms without it in the preceding
  same-shape run.

These are comparative local timings, not an SLO and not server performance evidence. Dataset contents, CPU, memory
pressure and V8 state differ from production.

## Correctness and safety boundary

- The general `retainPoolsForSourceTargets` API still normalizes arbitrary inputs.
- The optimized API rejects an unbranded index, even if it is a `Set`, and is called only with the index produced from
  already validated source facts.
- When source membership can change, the owning adapter rebuilds the index. PAIR refresh also re-applies full pool
  retention, so removals are not hidden by the cache.
- Existing pools remain within the old retained-target invariant; new pools are filtered against the same current index
  before merge.
- The board remains signer-free. No private key, wallet client, transaction submission, economic threshold or provider
  limit changed.

## Test evidence

The complete local `npm run check` passed Prettier, ESLint, Solhint, shell syntax, checked-JavaScript type analysis, the
production dashboard build, all three Solidity compilations, all 236 Node tests, all three deterministic Cancun
contract suites and a 251-file secret/privacy scan. Linux-only `systemd-analyze` was unavailable locally. Linux artifact
verification and production readback remain release gates at this point.
