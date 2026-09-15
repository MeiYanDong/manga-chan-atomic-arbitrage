# ADR-0081: Bound hot Feed signal coalescing before the signer lane

Status: accepted

Date: 2026-09-15

## Context

The v0.16.11 production watcher repeatedly reached its 320 MiB V8 heap limit about five seconds after startup. The
same host independently completed the 16 MiB audit migration at about 135 MiB RSS, an Earn preflight at about 129 MiB
RSS, a managed-WSS plus Sequencer connection at about 113 MiB RSS, and 534 current-cursor Feed frames at about 72 MiB
RSS. None reproduced the failure alone.

The remaining production-only operation was pending-signal coalescing. `classificationReasons` already contained the
atomic reasons, but each later merge also inserted the prior joined `classificationReason` projection. Alternating A
and B therefore became `A`, `A+B`, `A+B+A+B`, and doubled on each subsequent merge. A deterministic reproduction
reached 171,966,463 characters after only 24 merges. This matches both the prior 6.9 MiB `global_watch_wake` audit row
and the observed GC transition from about 231 MiB live heap to about 338 MiB immediately before abort.

## Decision

- Treat `classificationReasons` as the canonical atomic evidence. Read the singular field only when no atomic list is
  present for backward-compatible first intake; never feed a joined projection back into the next merge.
- Derive `classificationReason` only after the atomic union for compact child-process compatibility.
- Limit one reason to 128 characters, the atomic reason set to 16 entries, and every generic signal-value union to
  1,024 entries. Invalid wake hints fail that intake operation; they grant no execution authority.
- Configure the WebSocket transport with an 8 MiB `maxPayload` and check all known frame types before converting them
  to text. An oversized frame closes that Feed connection and explicitly falls back to public-log and periodic
  recovery.
- Keep the single signer/nonce lane and every exact quote, final simulation, Gas, balance, authorization, minimum-net
  profit, signed-raw and receipt check unchanged.

## Consequences

Hot replay can increase counters and a bounded dependency set but cannot create an exponentially growing string.
Oversized Feed traffic may lose the low-latency hint for that frame, but it cannot take the signer supervisor down;
the slower independent recovery paths remain authoritative. A dedicated streaming Feed relay remains a later
architecture improvement, not a prerequisite for this bounded repair.
