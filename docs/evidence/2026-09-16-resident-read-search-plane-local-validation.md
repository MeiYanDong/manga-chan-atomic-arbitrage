# v0.17.16 resident read-search plane local validation

Date: 2026-09-16

## Production input

Production v0.17.15 kept one signer and no unresolved transaction, but its Global periodic recovery was admitted up to
46.759 seconds late behind an already-running Earn read child. The first filtered event waited 27.122 seconds. These are
scheduler timing observations, not evidence that either wake contained a profitable trade.

Code review also found that the Earn cache reader accepted only schema v1 while production writes schema v4. This made
a valid protected catalog unavailable to that path and increased repeated public discovery work.

## Candidate

The candidate puts Earn and Global event/periodic search in two resident public-only workers. A complete negative is
reusable for 15 seconds. Earn positives enter the existing route revalidation. Global positives carry a minimal typed
hint; the signer reloads the atomic graph, checks both commitments, reconstructs the route and plan, and reacquires
funding, latest quote, Gas, simulation, balance, nonce and authorization evidence.

## Local validation

Targeted command:

```bash
node --test test/resident-global-search.test.mjs test/resident-earn-search.test.mjs \
  test/bounded-child-process.test.mjs test/feed-signal-coalescer.test.mjs \
  test/opportunity-board-isolation.test.mjs test/business-operations.test.mjs
```

Result: passed, 49 tests. JavaScript syntax checks, TypeScript checking and changed-file ESLint also passed.

Full command:

```bash
npm run check
```

Result: passed. Formatting, JavaScript/Solidity/shell lint, typecheck, UI build and all four contract compilations passed;
485 Node tests and all four deterministic contract suites passed; the secret scanner passed across 533 files. Linux
`systemd-analyze` was unavailable on macOS and remains a production promotion gate. GitHub CI, immutable artifact
verification and production runtime readback remain separate gates.

## Evidence boundary

The tests prove bounded protocols, source isolation and policy behavior. They do not prove lower live latency, a market
opportunity, a transaction or profit. Post-promotion acceptance must observe both worker processes, scheduler lateness,
unchanged signer/nonce invariants and any canonical receipt separately.
