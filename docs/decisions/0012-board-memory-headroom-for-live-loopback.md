# ADR 0012: preserve loopback trigger liveness with bounded board memory headroom

- Status: Accepted from production evidence
- Date: 2026-09-07

## Context

The v0.6.1 board data model bounded retained source facts and durable projection growth, but the original cgroup limits
were sized from a migration canary. During a sustained v0.6.2 live scan, the signer-free board held about 355 MiB and
entered Linux `mem_cgroup_handle_over_high` under `MemoryHigh=320M`. The process stayed alive and below
`MemoryMax=384M`, yet the event loop could not serve `/api/snapshot` within the watcher's five-second deadline. The
generic watcher consequently failed closed after ten consecutive loopback timeouts. The execution RPC recorded no
errors, and there was no unresolved transaction.

The production host had about 802 MiB available when the pressure was diagnosed. A live-only change to
`MemoryHigh=448M` and `MemoryMax=512M` removed the kernel throttle without restarting either service. The loopback API
then returned HTTP 200 in 0.179 seconds, and the same bounded authorization resumed with clean nonce and balance
readback.

## Decision

1. Set only `manga-opportunity-board.service` to `MemoryHigh=448M` and `MemoryMax=512M`.
2. Keep the board's `CPUQuota`, task limit, loopback binding, Unix identity, read-only RPC role and absence of signing
   credentials unchanged.
3. Do not increase watcher trade, signature, exact-preflight, failed-Gas or principal limits as part of this change.
4. Treat a future `memory.high` throttle or loopback timeout recurrence as a board-capacity incident. Measure retained
   state and heap shape before increasing the limits again.

## Consequences

- The live trigger path has 128 MiB more soft headroom and 128 MiB more hard headroom.
- A board leak can consume more host memory before systemd stops it, but it still cannot reach the host's full memory or
  access signer credentials.
- The earlier 320/384 MiB limits remain valid historical evidence for the v0.6.1 migration; this ADR supersedes them for
  current deployments.
