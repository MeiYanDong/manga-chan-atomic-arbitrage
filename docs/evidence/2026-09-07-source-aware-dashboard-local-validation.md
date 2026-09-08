# Source-aware dashboard local validation

- Observation date: 2026-09-07
- Release candidate: v0.6.0 on `feat/source-aware-dashboard-v1`
- Scope: local code, deterministic tests and temporary signer-free public-RPC runtime
- Production status: not deployed by this evidence

## Business-result checks

A temporary board used the official Robinhood Chain public RPC, a private temporary runtime directory and loopback port
`18789`. No signer environment, wallet client or broadcast path was loaded.

The v1 opportunity endpoint returned exactly one NINECAT target under `platform=LONG_ROUTE` with:

```json
{
  "symbol": "NINECAT",
  "quoteSymbols": ["AI"],
  "platform": { "platformId": "LONG_ROUTE", "status": "CHAIN_ATTESTED" },
  "protocol": { "protocolId": "DOPPLER", "status": "CHAIN_ATTESTED" },
  "venue": { "venueId": "UNISWAP_V4", "status": "CHAIN_ATTESTED" },
  "pairClass": "CUSTOM_TOKEN/CUSTOM_TOKEN"
}
```

The search also displayed an independent AI-target row whose route references NINECAT. It did not merge that row with
the NINECAT target or duplicate AI as NINECAT's quote asset. The evidence drawer linked the LONG, Doppler and PoolManager
claims to separate receipt logs from creation transaction `0xd9bd…1a69` at block `45,879,015`.

This is source-attribution evidence only. The NINECAT row was `UNQUOTED`, execution was `NONE`, and the run observed no
screened-positive opportunity.

## Browser checks

The built client was exercised against the temporary live board at desktop `1440x1000` and mobile `390x844` sizes.

- Radar search and independent platform/protocol/venue filters rendered correctly.
- The 1,422-row observation snapshot rendered 50 rows per page instead of mounting the full result set.
- `/api/v1/opportunities` returned a summary projection; full evidence was fetched only after opening a row.
- NINECAT visually read `LONG_ROUTE / DOPPLER / UNISWAP_V4 / CUSTOM_TOKEN/CUSTOM_TOKEN` with quote asset `AI`.
- Opening the drawer focused its close control; `Tab` remained inside it; `Escape` closed it and returned focus to
  `Inspect NINECAT`.
- Integrated browser console result: 0 errors, 0 warnings.
- Under `prefers-reduced-motion: reduce`, computed animation and transition duration were both `0.00001s`.

The measured summary response at 1,422 observed rows was `2,085,861` bytes and completed locally in `0.035444s`. The
time is a loopback serialization/readback measurement, not an Internet latency or production SLO.

## Automated gates

Final local commands:

```bash
npm run check
npm audit --audit-level=low
```

Observed results:

- Prettier, ESLint, Solhint, shell syntax and checked-JS type analysis passed.
- Vite built 17 modules; the main JS bundle was `213.65 kB` (`67.38 kB` gzip) and CSS was `16.37 kB` (`4.26 kB`
  gzip).
- 113/113 Node tests passed.
- Fixed and generic deterministic Cancun EVM contract suites passed, including their negative authorization, route,
  amount, profit-floor and atomic-revert assertions.
- The secret scan passed across 133 tracked source files.
- npm audit reported 0 vulnerabilities after the compatible `tmp@0.2.7` override.
- macOS did not provide `systemd-analyze`; the repository reported the Linux-only unit check as skipped. It must pass on
  the target Linux host before promotion.

## Unclosed items

- GitHub pull-request CI has not yet run for this release candidate.
- No production release SHA, systemd state or loopback endpoint has been read back yet.
- Source catalog backfill is bounded from the configured start block and was partial during the temporary run.
- The Execution page correctly remains `NONE`; no sanitized signer-ledger export is connected.
- Opportunity frequency, inclusion success and realized economics remain unproven by this UI release.
