# ADR 0004: isolated read-only opportunity board

- Status: Accepted
- Date: 2026-09-04

## Decision

Run multi-pool discovery and quote screening as a separate `manga-board` Unix identity, systemd unit, configuration
directory and state directory. It receives only a dedicated HTTP read endpoint. It cannot read the signer strategy's
configuration directory, encrypted credential or runtime ledger. The dashboard binds to loopback and is accessed
through an SSH tunnel.

The first discovery adapter is PAIR's first-party token API. It continuously refreshes the full catalog and the newest
page, then admits tokens with at least two canonical active V4 pools above the configured depth floor. Quote-asset
category is not a gate: stock tokens, AI tokens and meme tokens are treated identically if they appear in the source
and have a quotable USDG anchor route.

## Rationale

The board has a much broader RPC workload and a weaker evidence level than the fixed MANGA executor. Sharing its
process, provider or signer identity would allow a catalog outage or broad quote sweep to degrade a live trading lane.
Loopback access avoids adding an unauthenticated Internet endpoint to the signing host.

The board is intentionally a candidate census. A `SCREENED_NET_POSITIVE` row means that four Quoter legs at one fixed
block exceed a conservative gas proxy. It is not a generic executor simulation, signed transaction, included receipt
or realized profit.

## Consequences

- The fixed MANGA watcher remains the only signing process and retains its existing route and authorization.
- The board can be stopped, restarted or rolled back without changing wallet state.
- Newly discovered PAIR multi-pool tokens are added automatically; other launchpads or arbitrary PoolManager history
  require another explicit discovery adapter before their coverage can be called complete.
- Before promoting any row to live execution, a route-specific contract, exact execution estimate and the existing
  mutation/UNKNOWN protections are still required.
