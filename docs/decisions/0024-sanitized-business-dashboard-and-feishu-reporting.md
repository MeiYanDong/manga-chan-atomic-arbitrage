# ADR 0024: sanitized business dashboard and isolated Feishu reporting

- Status: Accepted; production promotion pending
- Date: 2026-09-08

## Context

The signer-free opportunity board already exposed provenance and scanner internals, but it did not answer the operator's
daily questions directly: how much receipt-verified execution profit was earned, how much authorized principal can be
reinvested, whether failed transactions consumed Gas, and whether the daily report reached Feishu. Rendering raw
adapter IDs, storage paths and evidence hashes also made the primary screen harder to use.

Feishu delivery needs access to historical execution ledgers, but it must not become another signing or broadcast path.
The webhook is a credential and cannot be stored in Git, an environment file or a process argument. Notification failure
must not change trading authority or watcher liveness.

## Decision

1. Build one sanitized business snapshot from the dual authorization, canonical USDG/WETH execution ledgers,
   append-only audit records and signer-free board summaries.
2. Keep observed quotes, exact-preflight readiness, confirmed executions and receipt-verified economics separate. The
   reported profit is explicitly limited to canonical receipt, balance-effect and marked successful-execution Gas
   evidence. Failed Gas is shown separately; it is not silently converted into a complete business PnL.
3. Group daily values by `Asia/Shanghai`. At 09:05 Beijing time, report the previous completed natural day. A five-minute
   systemd calendar tick retries a failed delivery and deduplicates a successful period by its durable local receipt.
4. Store the Feishu custom-bot webhook as a host-bound encrypted systemd credential. The reporter does not load the
   wallet credential, RPC credential, wallet client or broadcast code.
5. Run reporting as a one-shot service. `ProtectSystem=strict` makes trading state read-only and the only writable path is
   `/var/lib/manga-business-report`. The service uses the existing strategy UID only because canonical ledgers remain
   mode 0700; its primary group lets the separate board UID read only the mode-0640 sanitized snapshot.
6. Serve the snapshot through the existing loopback-only board at `/api/v1/business`. Reject invalid, writable or older
   than 15-minute snapshots instead of presenting stale values as current.
7. Keep the dashboard same-origin and read-only. Transaction links may leave the page only for the fixed Robinhood Chain
   Blockscout transaction prefix.

## Consequences

- The operator gets a business-first overview, seven-day trend, source split, capital status, delivery status and
  receipt-linked transaction ledger without exposing signer material.
- Feishu failure can fail and retry independently while the scanner and signer continue under their existing policy.
- The success ledger is append-and-fsync before the convenience state file is updated, so a later run can recover from a
  crash between those writes.
- A crash after Feishu accepts a request but before the local success receipt is durable can still cause one duplicate on
  retry. The custom-bot webhook offers no end-to-end idempotency key, so exactly-once remote delivery is not claimed.
- The reporter shares the strategy UID for read access and is therefore not full host-account isolation. Its filesystem
  write boundary and credential boundary are enforced, but a future dedicated ledger-exporter UID would provide stronger
  defense in depth.
- A running process, healthy panel or delivered message remains operational evidence, not proof of a new trade or profit.

## Production acceptance

- Linux CI and release installation pass all repository gates.
- The encrypted webhook exists only in the host credential store with root-only metadata.
- One report receives Feishu response code `0` and has a durable period-keyed receipt.
- The timer is enabled and the next trigger is visible.
- `/api/v1/business`, the browser view and the report receipt agree on the same Beijing period and economic values.
- The board and dual watcher retain their PIDs/restart posture or are explicitly reconciled after any controlled board
  restart; dual authorization usage and wallet nonce are unchanged by this feature.
