# Coalesced periodic source-projection local validation — 2026-09-10

## Outcome

Version `0.9.0` coalesces periodic source-catalog projection while retaining a fail-closed cursor checkpoint. All source
adapters update their in-memory facts during one protected cycle, one atomic catalog write follows, and only then may
the advanced source cursors enter the general runtime checkpoint.

This is repository/local evidence only. It does not prove production installation, loopback responsiveness under a
natural maintenance cycle, a screened opportunity, a transaction or profit.

## Correctness boundary

- The cursor checkpoint is a copy of the last durably projected source cursors; later in-memory mutation cannot alter
  it.
- Hot-poll persistence selects that old checkpoint for as long as projection is deferred.
- After a successful projection commit, persistence selects the current advanced cursors.
- If runtime state persistence fails after the projection write, the in-memory checkpoint is restored. A retry or
  restart safely re-observes the range rather than skipping it.
- Every metadata/source advancement call in the protected periodic lane explicitly defers its own large projection to
  the one final commit.
- The change remains inside the signer-free board and does not modify source attribution, candidate admission, RPC
  selection, quote limits, economics, authorization or broadcast logic.

## Test evidence

The complete local `npm run check` passed Prettier, ESLint, Solhint, shell syntax, checked-JavaScript type analysis, the
production dashboard build, all three Solidity compilations, all 237 Node tests, all three deterministic Cancun
contract suites and a 255-file secret/privacy scan. Linux-only `systemd-analyze` was unavailable locally. The new
business assertion mutates the live cursor object after checkpoint capture and proves persistence still selects the
original values until commit; it then proves current cursors become durable after the checkpoint clears.

Linux artifact verification, production board-only promotion and post-cycle metrics remain release gates at this point
and must not be inferred from this file.
