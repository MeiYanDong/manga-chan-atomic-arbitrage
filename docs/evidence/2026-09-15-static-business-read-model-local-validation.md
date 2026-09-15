# Static business read model: local validation

Date: 2026-09-15

## Observed failure boundary

The production board remained active and continued to publish snapshots, while a cold public read could wait behind a
4,714-candidate scan until Nginx returned `504`. The business reporter already produced a roughly 60 KiB sanitized
snapshot, so the failure was presentation-path contention rather than missing business data or a stopped signer.

## Implemented boundary

The reporter now atomically publishes `business-snapshot.json` with public-read permission after schema and forbidden
field validation. Nginx serves that exact file for `/api/v1/business`; all non-GET/HEAD methods remain denied.

## Local verification

`npm run check` passed on 2026-09-15:

- formatting, JavaScript/Solidity/shell lint and TypeScript checks passed;
- the production dashboard build and all four deterministic contract builds passed;
- 427 unit tests and four contract test suites passed;
- the secret scan passed across 464 files.

Production promotion still requires release-artifact verification, Nginx configuration validation, public readback,
unchanged signer nonce and a fresh watcher/service readback.
