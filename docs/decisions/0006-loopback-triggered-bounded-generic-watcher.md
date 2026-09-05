# ADR 0006: loopback-triggered bounded generic watcher

- Status: Accepted for implementation; live promotion pending
- Date: 2026-09-05

## Decision

Run generic-v2 autonomously on the existing Linux signing host, but keep broad discovery and live execution as two
separate trust and RPC domains.

The signer-free `manga-opportunity-board` continues to discover and quote broadly through the official public RPC. The
generic watcher polls its loopback snapshot, processes each generated snapshot once and performs no chain request while
the board has no newly eligible candidate. A candidate must first pass typed route validation, freshness, opportunity
deduplication, the arm's screened-net floor and the arm's principal cap. Only then may the signing identity use its
strategy-owned HTTP RPC for that exact opportunity's canonical-block check, executor simulation, Gas estimate, nonce,
balance, residual and allowance checks.

Automation is authorized by a local arm bound to the exact executor, source hash, runtime hash and economic policy. It
expires and independently limits exact preflights, signatures, confirmed executions and failed Gas. The process checks
the arm and stop state immediately before and immediately after signing. Fixed and generic generations mutually reject
one another's arm and process lock and share the wallet lock and UNKNOWN mutation barrier.

Deployment stays a separate guarded one-shot operation. The watcher never auto-deploys, auto-funds, auto-reprices or
creates a replacement transaction. After any ambiguous signed transaction it stops until reconciliation proves a
terminal effect or explicitly permits rebroadcast of the same raw bytes.

## Rationale

The local Codex heartbeat is too slow and unreliable for an opportunity that often disappears between board cycles,
and it should not hold the wallet key or sit in the execution hot path. Conversely, continuously exact-preflighting the
whole catalog through a paid RPC wastes quota and increases throttling risk. Loopback triggering preserves cheap broad
coverage while reserving the managed endpoint for candidates that can plausibly become a transaction.

The arm is intentionally narrower than an always-on key. It makes the maximum economic and infrastructure spend
explicit and prevents a service restart or configuration edit from silently widening authority.

## Consequences

- The Linux host, not the local Codex task, owns sub-second trigger polling and execution continuity.
- The local heartbeat may audit receipts and failures, but it is not an execution dependency.
- A public-board screen remains noncanonical and cannot authorize a signature by itself.
- Provider usage becomes event-driven and bounded, not zero; every promoted candidate still needs exact chain evidence.
- An expiring arm must be renewed explicitly. Budget exhaustion and policy expiry stop cleanly; UNKNOWN and invariant
  failures stop as incidents.
- Mainnet deployment, arm activation and realized profit remain unproven until their own canonical evidence is recorded.
