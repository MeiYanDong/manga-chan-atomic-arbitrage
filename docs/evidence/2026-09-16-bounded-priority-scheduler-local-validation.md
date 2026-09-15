# v0.17.15 bounded priority scheduler local validation

Date: 2026-09-16

## Production input

Immediately after v0.17.14 promotion, the live scheduler reported a filtered market event with `waitMs=43790`, while
the Global startup recovery was admitted 13,991 ms late. Both Earn and Global remained healthy and no unresolved
mutation existed. This is queue evidence, not evidence that the delayed candidate would have been profitable.

## Candidate

The scheduler permits only priority 80+ events to precede the oldest overdue recovery job, and only below a 30,000 ms
hard lateness limit. A claimed event does not move any periodic deadline. The single signer lane and asynchronous
unknown-transaction quarantine remain unchanged.

## Validation gate

The candidate requires formatting, lint, typecheck, UI and contract compilation, all Node and deterministic contract
tests, secret scanning, GitHub CI, immutable release promotion and production runtime readback. Live effectiveness must
be measured from later event lifecycle timestamps; local tests prove policy behavior only.

Local command:

```bash
npm run check
```

Result: passed. Formatting, lint, typecheck, UI build and compilation passed; 477 Node tests and all four deterministic
contract suites passed; the secret scanner passed across 527 files. Linux systemd verification was skipped on macOS
and remains a production promotion gate.
