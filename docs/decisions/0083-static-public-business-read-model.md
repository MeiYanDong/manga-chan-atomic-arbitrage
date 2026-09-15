# ADR 0083: Serve the public business read model independently of market scanning

## Status

Accepted on 2026-09-15.

## Context

The public operating console loaded `/api/v1/business` through the opportunity-board HTTP server. That process also
discovers and quotes 4,714 candidates. A long synchronous projection or scan could therefore hold the Node event loop
past Nginx's eight-second upstream timeout even though the already-sanitized business snapshot existed on disk.

Increasing the timeout would hide the coupling and make a browser refresh consume more scarce scanner time. The
business reporter already validates the snapshot, writes it atomically, carries its generation timestamp and has no
signing or broadcasting capability.

## Decision

- Publish `business-snapshot.json` as mode `0644` only after `assertPublicBusinessSnapshot` succeeds.
- Serve exactly `GET` and `HEAD /api/v1/business` from that file in Nginx.
- Keep all mutation methods denied and retain `no-store`, CORS, CSP and other public-dashboard controls.
- Retain the board's loopback handler as a compatibility path, but remove it from the public request path.
- Preserve the payload timestamp. Availability does not turn stale evidence into current evidence.

## Consequences

Capital, portfolio and receipt pages continue to load while market discovery is busy. The change grants public read
access only to an object already designed and validated for anonymous publication. Market-detail endpoints remain a
separate presentation-load concern and are not claimed to be decoupled by this ADR.
