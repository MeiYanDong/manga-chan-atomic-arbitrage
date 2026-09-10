# ADR 0038: cache the validated source-target index on the hot poll path

- Status: Production-observed on release `55df95ed9d152bd66bfe273cbee578caccb456b8`
- Date: 2026-09-10

## Context

Production release `a9f5f99e4187f0996e0f4cf7bb8e6988d9705fa8` removed the full graph rebuild and full-board
publication from the pre-quote event path, staged the second amount and ran the two base lanes concurrently. Its first
17 natural managed cycles avoided 34 deferred amount quotes, but the public ingestion path remained slow during restart
catch-up. One 200-block poll decoded 1,986 logs and spent 5,641.67 ms in the combined decode/route phase. During a later
maintenance cycle, even loopback `/healthz` could not answer within 20 seconds while the process remained active with
zero restarts.

Source inspection found repeated work inside every hot poll:

1. `ingestInitializeEvents` rebuilt and checksummed the entire source-target set even when the source arrays had not
   changed;
2. the pool-retention helper normalized that same already-validated set again; and
3. an event batch with no Initialize logs still rebuilt PAIR pool and ambiguity collections.

The retained source projection is validated at startup, and every new source fact is validated before it enters that
projection. PAIR, Long and Doppler source arrays change only in their explicit catalog adapters.

## Decision

- Build one lowercase source-target index after the validated restart projection loads.
- Refresh the index only after PAIR listings or Long/Doppler target facts change.
- Use a separately named `retainPoolsForSourceTargetIndex` function on the in-memory hot path. The function accepts only
  an index branded by `sourceTargetAddresses`, making the prevalidated trust boundary explicit; the general retention
  API keeps its normalization.
- Pass the same index into the strategy-graph builder so a rebuild does not checksum the unchanged source universe a
  second time.
- Preserve the retained-pool invariant incrementally: existing pools were already retained, and every incoming fact is
  filtered against the current index. A PAIR catalog refresh still re-prunes the complete retained set.
- Return immediately when a poll contains no Initialize logs. Rebuild PAIR pool or ambiguity collections only when the
  decoder actually produced those facts.
- Split the former `decodeRouteMs` measurement into decode, coalesce, Initialize ingestion and route/queue phases while
  retaining the aggregate field for compatibility.

No source is reclassified and no pool becomes executable through this cache. Candidate admission, quote shape, fixed-
block evidence, provider caps, profit floors, signing and receipt reconciliation are unchanged.

## Consequences and limits

- The ordinary hot poll avoids work proportional to the complete source universe when no source metadata changed.
- A real source update still pays the explicit index-rebuild cost, and a catalog maintenance cycle may still serialize
  a large durable projection. Production phase telemetry must determine whether projection coalescing is the next
  justified change.
- The optimized retention function is safe only with an index produced by `sourceTargetAddresses`; its name, runtime
  brand check and call sites make that boundary reviewable.
- A synthetic local workload matching the previously observed 44,521 targets and 62,441 pools is useful comparative
  evidence, not a production latency claim.

## Rollback

Restart only the signer-free board on release `a9f5f99e4187f0996e0f4cf7bb8e6988d9705fa8`. Do not restart or re-arm the
dual signer, and retain the durable quote-budget, evidence and execution ledgers.

## Production follow-up

The reviewed release passed GitHub and Linux artifact gates and was promoted board-only. In its first 200-block
catch-up sample, it reduced aggregate decode/route work from the earlier 5,587.10 ms observation to 252.23 ms and the
complete poll from 11,309 ms to 1,088.91 ms. A later sample covering 79 blocks and 548 decoded events completed
decode/route in 64.64 ms and the complete poll in 824.57 ms. These short, differently shaped samples confirm activation
and remove the prior CPU-scale bottleneck; they are not a durable latency SLO.

The release still allowed up to four synchronous writes of the 45,294,139-byte source projection in a single protected
periodic cycle. That separate remaining bottleneck led to
[ADR 0039](0039-coalesce-periodic-source-projection.md). Full promotion evidence is in
[the production record](../evidence/2026-09-10-cached-source-target-hot-path-production-promotion.md).
