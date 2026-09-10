# ADR 0037: adaptive event-quote critical path

- Status: Accepted for implementation; production observation pending
- Date: 2026-09-10

## Context

The first managed-RPC release proved correct same-block output and low ordinary point latency, but it did not make the
whole event path fast. A later production readback recorded 151 managed event candidates, 2,872 managed logical calls,
zero HTTP failures, a 17.05 ms request p50, a 5,542.27 ms p95 and a 22,899 ms latest poll-start-to-quote result. The hot
queue still held 288 candidates. No active-strategy receipt or realized profit existed.

Source inspection found three local contributors that a larger paid quota would not repair:

1. each event rebuilt the multi-thousand-candidate dependency index and published a full `SCANNING` projection before
   establishing its fixed block;
2. every non-positive lane quoted both configured event sizes even though the second size was useful only after a
   gross edge or incomplete first result; and
3. USDG and WETH read-only lanes ran serially despite sharing one immutable fixed block and having independent
   settlement principals.

The original `lastEventToQuoteMs` begins when the public log poll starts. It therefore includes public log collection,
queue admission and local work as well as managed Quoter reads. Treating it as provider latency was incorrect.

## Decision

For event-triggered cycles only:

- reuse the dependency index committed by the previous completed cycle and omit the pre-quote full `SCANNING`
  projection; catalog-changing periodic cycles retain both operations;
- begin a previously non-actionable lane with the smallest configured executable amount;
- defer the remaining bounded event amount and request it only if the first result has positive gross profit or lacks
  complete numeric evidence;
- keep both bounded amounts immediately when the prior lane was already gross- or net-positive;
- run the required USDG lane and optional WETH lane concurrently at the same fixed block; a USDG failure remains
  terminal, while a WETH-only failure remains explicit optional-lane evidence; and
- publish bounded phase timings plus managed JSON-RPC operation-class latency. Telemetry retains no URL, calldata or
  signing material.

The final post-quote publication and the positive execution-feed checkpoint remain unchanged. Exact simulation, Gas,
net-profit, principal, nonce, authorization, final simulation, receipt and post-state gates remain unchanged.

## Gate classification

- Smallest-size event probe: adaptive economic gate. A complete non-positive gross result stops only the deferred size
  fan-out for that event.
- Deferred size: adaptive gate triggered by positive gross evidence, incomplete evidence or prior actionability.
- Parallel base lanes: asynchronous read optimization at one fixed block; it does not combine funds or execution
  authority.
- USDG lane: required correctness evidence.
- WETH lane: best-effort independent opportunity evidence, as before.
- Phase and operation metrics: asynchronous operational evidence; never profit or execution evidence.

## Consequences and limits

- Ordinary no-edge events should use fewer paid calls and have a shorter critical path, but only a production natural-
  event window can quantify the improvement.
- Concurrent lanes may expose managed-provider burst limits sooner. The existing four-request gate, no-hidden-retry
  policy, daily caps and public fallback remain the hard boundary.
- An unusual non-monotonic hook could theoretically be non-positive at the smallest size and positive at a larger one.
  The live lane is already restricted to the supported PoolKey shape, and protected periodic reconciliation remains
  the coverage backstop; this release does not claim universal curve monotonicity.
- Faster screens still do not establish sequencing priority, inclusion or profit.

## Rollback

Restart only the signer-free board on the prior reviewed release. Do not restart or re-arm the active signer. Retain
the durable RPC budget and economic ledgers so rollback cannot manufacture unused quota or erase receipt history.
