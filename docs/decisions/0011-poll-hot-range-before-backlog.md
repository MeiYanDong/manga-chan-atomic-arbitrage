# ADR 0011: poll one hot range before draining the quote backlog

- Status: Superseded by ADR 0027 after production showed periodic quote latency still blocked polling
- Date: 2026-09-07

## Context

The v0.6.1 board bounded source storage and candidate quote size, but its event wait returned immediately whenever the
candidate queue was nonempty. One historical 2,000-block range produced 171 pending candidates. While the board safely
quoted four at a time, a later production readback showed the pending count falling to 139 with the event poll count
still fixed at one and `lastPollAt` unchanged for approximately 29 minutes. Quote progress therefore starved discovery:
the service was healthy, but the hot cursor could not approach the current chain head.

Increasing the quote batch would spend more public-RPC capacity and would not repair the scheduling invariant. Skipping
historical blocks would reduce lag by discarding event evidence. A background concurrent poller would introduce shared
cursor, queue and persistence races that are disproportionate to this correction.

## Decision

Each event wait performs one existing bounded `pollHotEvents` operation before it drains an existing candidate queue.
The configured 2,000-block range and four-candidate quote cap do not change.

- If the poll returns a wake, that wake is used; the helper does not consume a second batch.
- If the poll advances without selecting a wake, the latest active queue supplies up to four pending candidates.
- If the poll fails, the error remains observable and already-seen candidates may still progress; the cursor is not
  advanced by the failed poll.
- The queue is resolved after the poll because canonical reorg handling replaces it. The fallback path therefore cannot
  return stale candidates from the discarded pre-reorg queue.
- The mandatory periodic-reconciliation deadline remains unchanged, so event work cannot starve catalog coverage.

## Consequences

- A quote backlog can no longer freeze `lastPollAt` or the hot cursor.
- Catch-up remains intentionally gradual: at most one bounded range advances per event cycle. This is not a claim of
  sub-block latency while historical lag remains.
- Public-RPC log reads increase from zero to one bounded hot-range attempt per backlogged event cycle. Quote candidate
  count, paid-RPC use, signer state and transaction authority do not increase.
- Production acceptance requires observing consecutive poll and cursor advances while the pending queue is still
  nonzero, plus unchanged cgroup, signer-file and wallet-nonce evidence.
