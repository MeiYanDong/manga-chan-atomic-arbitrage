# Public Agent daily-profit API

## User story

As the user's read-only operating Agent, I can fetch one stable public URL while the operator laptop is off and receive
receipt-gated daily strategy profit in native assets plus guarded USD/CNY reference estimates, without raw execution
fields or access to a mutation surface.

## Accounting contract

- Source metric: `markedTradingNetByAsset`.
- Successful-transaction Gas is already included upstream.
- `failedGasByAsset` is deducted exactly once.
- `projectResultByAsset` is excluded because it is a different, potentially overlapping project layer.
- Offchain operating costs remain excluded, so `businessNet` stays `UNKNOWN`.
- USDG uses observed CoinGecko and Kraken USD quotes. It is never hard-coded to one US dollar.
- ETH uses the same two-provider guard; USD/CNY uses a dated Frankfurter reference.

## Acceptance criteria

1. `GET /api/v1/agent/daily-profit` returns schema version 1 from the public catch-all host without authentication.
2. The file is generated server-side by `manga-business-report.service` and remains independent of the operator laptop.
3. A true zero is returned as known zero even when price feeds are unavailable.
4. One valid market source is usable but visibly partial; disagreeing sources suppress the aggregate value.
5. Native USDG/ETH amounts, failure count and evidence status remain available when conversion is partial.
6. The output contains no transaction hash, wallet address, authorization ID, RPC URL, webhook or signing material.
7. Nginx permits only GET/HEAD for the exact path; POST is rejected.
8. Unit, type, lint, secret and deployment-isolation gates pass before production promotion.

## Runtime boundary

The API is one more atomically written static projection under `/var/lib/manga-business-report`. It does not add a
daemon, wallet access, trading authorization, RPC signing path or persistent memory load.
