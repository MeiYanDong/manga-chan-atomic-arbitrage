# EarnOnHood two-pool AI route production promotion

- Date: 2026-09-12 (Asia/Shanghai)
- Runtime release: `4690726da071b131bf5189ebb25fa19316e67d8f`
- Source pull request: [#126](https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/pull/126)
- Release archive SHA-256: `9ea423fcefcb68ecae8edbd4d4f6d3fe448814b000456590474b02654c4d2380`
- New authorization: `0xc34fef94660b1fc24cd73dc00e77a9c33575d1195cb6217aa506b54b57ccfaac`
- Route commitment: `0xe9b21e5bec428e98dfbadae505b191806f2d0cc70aadcd94fa8e4b3c53b21498`
- Chain mutation caused by the release promotion and new authorization: none
- Signed or broadcast attempts under the new authorization at final readback: zero

## Scope

The production route book now contains four explicitly reviewed EarnOnHood loops:

- STOCK MEMES `WETH -> AI`, then LONG ECO `AI -> WETH`;
- LONG ECO `WETH -> AI`, then STOCK MEMES `AI -> WETH`;
- the existing `WETH -> AI -> MOO -> WETH` triangle; and
- the existing `WETH -> MOO -> AI -> WETH` triangle.

The pool set remains bounded to the same three reviewed EarnOnHood Omnipools. No discovered token, pool or platform can
enter the signing book dynamically. Each profitable route receives one representative place in the bounded Gas
shortlist before the remaining slots use global gross ranking. Exact quote, Gas estimate, final call, output floor,
wallet reserve, failed-Gas fuse, nonce ownership and canonical receipt reconciliation remain mandatory.

## Repository gates

The feature branch and protected `main` gate both passed. PR CI run `34696442426` and protected-branch CI run
`34696543933` completed successfully. The merged production commit is
`4690726da071b131bf5189ebb25fa19316e67d8f`.

Local `npm run check` passed formatting, JavaScript/Solidity/shell lint, checked-JavaScript types, the production UI
build, 266 Node tests, all three deterministic contract suites and the 302-file repository secret scan. The macOS run
accurately skipped Linux-only systemd semantic verification.

The production installer fetched the immutable commit archive, matched the expected SHA-256 and reran the complete
Linux release gate before changing the `current` symlink. It passed 266 Node tests, all three contract suites, the
290-file release secret scan and `systemd-analyze verify`. The only systemd warnings referred to the host's unrelated
Alibaba `cloudmonitor.service`.

## Safe cutover and runtime identity

The previous authorization `0x840860ba36fc8c50b9025ca969085deb5660eeef1d7ca18b2c7654e1121b2bd5` was
durably revoked before the old watcher stopped. `dual:reconcile` then returned `CLEAN` with no unresolved mutation.
The release installer did not arm or start a signer.

After the signer-free board started, `/opt/manga-chan-arbitrage/current` and the watcher process working directory both
resolved to `/opt/manga-chan-arbitrage/releases/4690726da071b131bf5189ebb25fa19316e67d8f`. The board reported release
`4690726da071b131bf5189ebb25fa19316e67d8f`, schema 5, `RUNNING`, `signerLoaded=false` and
`executionAuthorized=false`.

The exact-release `dual:runtime-verify` gate returned `RUNTIME_VERIFIED_READY_FOR_DUAL_ARM` with:

- chain ID `4663`;
- wallet nonce latest/pending `21/21`;
- wallet Gas balance `0.002893909777810176 ETH`;
- executor balances `35.344393 USDG` and `0.0032 WETH`;
- canonical executor source and runtime code hashes; and
- `unresolvedMutation=null`.

Only after that readback did the one-shot arm create authorization
`0xc34fef94660b1fc24cd73dc00e77a9c33575d1195cb6217aa506b54b57ccfaac`. It is `UNTIL_REVOKED`, has
unlimited execution/preflight counts, and commits balance-scaled Earn sizing with no fixed principal cap. It still
retains the `0.00012 ETH` per-attempt Gas ceiling, `0.001 ETH` failed-Gas breaker, wallet reserve and lifetime-positive
Earn Gas-solvency constraint.

## Live readback

`manga-dual-watcher.service` was enabled and started on the new authorization. Its systemd state was `active/running`,
main PID `37475`, runtime PID `37489`, restart count zero and process release directory equal to the exact promoted
commit. The runtime reported:

- `status=RUNNING` and authorization `ARMED / UNTIL_REVOKED`;
- route commitment `0xe9b21e5bec428e98dfbadae505b191806f2d0cc70aadcd94fa8e4b3c53b21498`;
- public Earn swap-event polling every four seconds plus five-minute recovery probes;
- zero skipped blocks and no event, board or execution-RPC error;
- no unresolved mutation; and
- zero signed attempts, zero confirmed executions and zero failed Gas under the new authorization.

The startup probe and the next reviewed-pool swap-event probe both completed without a signature or broadcast. The
later sample's best quoted net at the conservative Gas cap was `-0.000037780368663512 ETH`, so the protected decision
was `NO_SHOT_NO_SIGNATURE_NO_BROADCAST`. This is evidence that the newly admitted routes are live and fail closed; it
is not a new profit receipt.

Lifetime canonical Earn receipts remain four confirmed executions, `+0.000277567909174176 ETH` verified execution
net and zero failed transactions/Gas. The new authorization starts its own economic counter at zero; historical profit
was preserved only as the Gas-surplus solvency input.

## Public dashboard recovery

During the board restart, the external health probe briefly observed `502` and then one `504` while the new process
opened its SQLite projection. Systemd showed the board active with zero restarts and the journal reached
`BOARD_HTTP_READY` on loopback port `8788`. Subsequent public probes returned HTTP 200 for `/`, `/healthz`,
`/api/v1/system` and `/api/v1/business`; health was `HEALTHY`, runtime was `RUNNING`, persistence was `HEALTHY` and
projection parity was true. The earlier `18788` loopback diagnostic was an obsolete-port probe, not a board failure.

The business reporter, five-minute timer and path trigger were restored after the board became healthy. All are
isolated from the signer; reporting failure cannot authorize or broadcast a transaction.

## Remaining boundary

This promotion is a four-route reviewed EarnOnHood keeper, not a permissionless arbitrary-pool arbitrage engine. The
platform-wide catalog and other launchpads remain read-only discovery sources. Promoting dynamically discovered pools
to signing requires a separate admission and authorization design; it is not implied by this production rollout.
