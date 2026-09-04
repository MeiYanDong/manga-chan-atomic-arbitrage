# ADR 0001: standalone public repository

- Status: Accepted
- Date: 2026-09-04

## Decision

MANGA CHAN arbitrage is extracted into its own repository. PAIR LP, `$1` LP, private runtime files, signed transactions and credentials are excluded. The deployed Solidity source remains byte-for-byte identical so the local build continues to match the existing runtime hash.

The repository uses the MIT license. Public source does not grant access to the operator wallet or authorize live trading.

## Consequences

- Review, CI, releases and issues have a narrow scope.
- The exact route is easier for competitors to copy.
- Runtime evidence must be transferred and backed up separately from Git.
