# ADR 0051: serve daily profit from a scanner-independent read model

- Status: Accepted
- Date: 2026-09-13

## Context

The full business endpoint already contains daily economics, but it is coupled to the single-process opportunity board.
Heavy market maintenance can delay that process and produce a public 504. It is also much larger than an external
consumer needs. A second risk is naming receipt-confirmed execution results "business net profit" while server, RPC or
other operating costs are not fully registered.

## Decision

1. The five-minute read-only reporter also writes a compact `daily-profit.json` projection.
2. Nginx serves `GET /api/v1/profit/daily` directly from that file with `Access-Control-Allow-Origin: *`.
3. The API retains two layers: marked receipt-gated trading net and native-asset project effects.
4. The consolidated business net is `UNKNOWN` until operating-cost coverage becomes complete.
5. Today is explicitly in progress, completed Beijing-calendar days are final, and assets are never silently converted.
6. The endpoint cannot sign, broadcast or expose identifiers and credentials.

## Consequences

- API availability no longer depends on the market scanner event loop after a snapshot has been generated.
- The maximum normal staleness remains the existing five-minute report cadence and is visible in `generatedAt`.
- The report directory is traversable by Nginx, while the full business snapshot and delivery state retain restrictive
  file modes; only the sanitized daily projection is world-readable.
- This release changes presentation and reporting only. It does not restart, re-arm or widen the live signer policy.

## Verification

- Repository and Linux release gates must pass.
- Production must return the compact endpoint from Nginx while the full business endpoint and signer remain unchanged.
- A production readback must compare the latest API day with the receipt-gated business snapshot and record signer PID,
  authorization usage and restart counts before and after promotion.
