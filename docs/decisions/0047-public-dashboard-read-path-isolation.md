# ADR 0047: isolate the public dashboard read path from market scanning

- Status: Accepted
- Date: 2026-09-12
- Extends: ADR 0044

## Context

The public firewall already allowed TCP port 80 from `0.0.0.0/0`, but Nginx proxied the UI files and every presentation
request to the same Node process that performs market discovery. Production evidence showed one external root request
waiting more than 12 seconds and timing out, while the Nginx log contained thousands of client-closed requests plus
502 and 504 responses. The board was still running with zero restarts, but was using about 448 MiB and its bounded CPU
share. This is read-path contention, not an IP allowlist failure.

## Decision

1. Make the port-80 server the IPv4 and IPv6 default virtual host with `server_name _`. Keep the SWAS source CIDR for
   port 80 at `0.0.0.0/0`; do not expose the board's loopback port 8788.
2. Serve `/` and the immutable Vite assets directly from the exact release symlink in Nginx. A busy or restarting board
   must not prevent the browser shell from loading.
3. Cache successful GET/HEAD responses from `/api/v1/*` for 30 seconds. Coalesce a cold-key stampede, refresh expired
   entries in the background, retain inactive entries for seven days, and serve the last timestamped payload during an
   upstream timeout or 5xx response. Clear and re-warm this recoverable cache on an intentional configuration install.
4. Keep `/healthz` uncached so operational health checks continue to measure the live board. Keep browser responses
   `no-store`, the existing security headers, the API allowlist and all mutation-method rejection.
5. During installation, disable only Ubuntu's stock enabled-site symlink, preserve its target for rollback, validate the
   catch-all static root, warm every endpoint used by the UI and prove a cache hit before accepting the Nginx reload.
6. Do not restart, re-arm or otherwise mutate the trading watcher. This change affects presentation availability only.

## Consequences

- Repeated browser tabs no longer multiply the board's presentation work, and a short board event-loop delay does not
  produce a blank page.
- Cached data may be older than 30 seconds when the board is unavailable. Every payload retains its generation time;
  the fallback is a preserved observation, never relabelled as a current chain read.
- Query/collector isolation improves public-read resilience but is not host fault isolation. A host, Nginx or network
  outage still makes the dashboard unavailable.
- The public surface remains intentionally read-only. Catch-all Host handling does not grant access to signer material,
  private RPC credentials, raw ledgers or internal APIs.

## Verification

- Repository formatting, lint, type, unit, contract, secret and systemd checks pass.
- Production `nginx -t` passes; the exact release UI is served with an arbitrary Host header.
- A warmed API request reports `X-Dashboard-Cache: HIT`; external repeated reads return promptly during the observation
  window, while `/healthz` remains an uncached board response.
- SWAS still exposes port 80 from `0.0.0.0/0`, port 8788 remains absent, and the signer PID, authorization and restart
  counter remain unchanged.
