# Business dashboard and Feishu reporting local validation

- Date: 2026-09-08 (Asia/Shanghai)
- Scope: read-only business projection, frontend presentation and notification delivery boundary
- Chain mutation: none
- External message sent during local validation: none

## Business-result tests

Deterministic fixtures crossed the UTC-to-Beijing date boundary and proved that 09:05 reports the previous completed
Beijing day. The same fixtures combined legacy USDG, active USDG and active WETH receipts while keeping today, previous
day, all-time and active-authorization totals distinct. The assertions verified base-local execution counts,
receipt-marked net USDG, failed Gas, last verified wallet Gas and principal compounding from only authorization-matched
canonical balance effects.

Webhook tests accepted only HTTPS on `open.feishu.cn` with the exact custom-bot path shape and rejected another host,
query strings, an empty hook token and HTTP. Snapshot tests rejected a group-writable file, a stale file and any
serialized sensitive field. Delivery-state tests recovered the last successful period from the fsynced receipt when the
convenience state file was absent.

## Isolation assertions

- The dashboard uses same-origin GET requests and has no mutating request, signer or raw-transaction path.
- The only external UI link is the fixed Robinhood Chain Blockscout transaction prefix.
- The reporter unit loads only the encrypted Feishu webhook credential; it contains no private-key or RPC credential.
- The reporter can write only `/var/lib/manga-business-report`; trading state remains read-only.
- The board reads only the mode-0640 sanitized snapshot and still runs under its separate `manga-board` identity.
- The timer is a persistent five-minute calendar trigger; the script enforces the Beijing cutoff and period dedupe.

## Local gates

- Full `npm run check`: passed.
- Formatting, JavaScript/Solidity/shell lint and checked-JavaScript types: passed.
- Vite production build: passed.
- All three Solidity generations compiled without changing their reviewed source hashes.
- Node tests: 190 passed, 0 failed.
- Fixed, generic USDG and WETH deterministic Cancun contract suites: passed.
- Latest secret scan: passed across 202 repository files.
- Linux systemd semantic verification: skipped on macOS because `systemd-analyze` is unavailable.

This checkpoint proves local calculation, presentation, credential-reference and isolation behavior. It does not prove
Linux unit validity, production installation, a Feishu delivery, a live transaction, current production state or profit.
Those require Linux CI plus production readback and a Feishu response-code-0 receipt.

## Production-entrypoint follow-up

The first installed one-shot used `npm run` under `TasksMax=16`. Production reproduced a 45-second startup timeout before
any snapshot or delivery receipt existed. A transient Linux unit with the same user, group, filesystem sandbox, 128 MiB
memory ceiling and 16-task ceiling reproduced the npm hang; the same unit running the script as one direct Node process
completed in under three seconds. The corrected unit therefore invokes `/usr/bin/env node` directly without raising
its task, memory, credential or write boundary. Feishu delivery remains pending until that follow-up passes review and is
installed.

The next controlled start reached webhook loading and then rejected systemd's runtime credential because the reporter's
initial check accepted only ordinary mode-0400 files. Metadata inspection proved the decrypted file was the documented
immutable `0440 root:root` file inside the unit-specific `/run/credentials/...` mount. The correction reuses the
project's existing credential-directory identity predicate: mode 0440 is accepted only when root-owned and located
directly in `CREDENTIALS_DIRECTORY`; an ordinary group-readable file remains rejected. No delivery receipt existed at
this second failure boundary.
