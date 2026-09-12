# Story: public daily profit API

As the operator, I need one small public endpoint for daily economic results so an external dashboard can read verified
profit without downloading the full market board or depending on the scanner event loop.

## Acceptance criteria

- `GET /api/v1/profit/daily` returns at most seven Beijing-calendar days plus a generation timestamp.
- Today is `IN_PROGRESS`; completed days are `FINAL`.
- Receipt-gated marked trading net, failed Gas and partial native-asset project effects remain separate.
- Business net stays `UNKNOWN` while operating-cost coverage is partial; missing cost never becomes zero.
- USDG, ETH and WETH are never silently added or converted.
- The payload contains no wallet address, authorization id, transaction hash, RPC URL, webhook or signing material.
- Nginx serves the precomputed JSON directly with public read-only CORS; the scanner cannot sign or mutate through it.
- Tests verify calendar boundaries, amounts, incomplete-cost semantics, size and forbidden-field rejection.
