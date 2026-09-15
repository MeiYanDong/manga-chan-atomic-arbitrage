# v0.17.13 release umask incident and local validation

Date: 2026-09-15

## Production incident evidence

The exact v0.17.12 commit installed and built successfully, but its first read-only service startup timed out. Sanitized
Cloud Assistant invocation `t-usw6x5c7bqjthq8` showed that both the board and competitor census failed to import
`viem`. Invocation `t-usw6x5ce6ka4av4` then established the boundary: v0.17.12 application and dependency directories
were mode `0700`, while the preceding v0.17.11 release directories were `0755`. The release bootstrap had been called
under `umask 0077`, which the installer inherited through archive extraction and npm.

Invocation `t-usw6x5cpg3u5m9s` repaired only the immutable release tree to remove group/other write permission while
adding required read/traverse permission. The board and census could then import their dependencies and start. This
repair is incident recovery evidence, not proof that the installer defect is fixed.

## v0.17.13 production promotion evidence

Sanitized invocation `t-usw6x5gj1m6slj4` installed and built the exact v0.17.13 commit but rejected the post-install
permission gate. The release tree was traversable, yet GitHub codeload had preserved group-write bits (`0664` files and
`0775` directories). This proved that caller `umask 0022` is necessary but not sufficient for archived entries.

Invocation `t-usw6x5h0woara4g` repaired only that exact immutable tree with `go-w,a+rX`. The isolated `manga-board`
identity then imported `viem` and the business module successfully, and Linux systemd verification passed. This was a
bounded recovery for v0.17.13, not installer proof.

## v0.17.14 candidate change

The installer now establishes `umask 0022` before creating the release tree, extracting the archive and installing
dependencies. After the production build it also normalizes only the immutable release tree with `go-w,a+rX`, verifies
that no regular file or directory remains group/world writable, and performs both steps before symlink promotion.
Existing explicit modes remain authoritative for configuration, encrypted credentials and mutable runtime state. A
source-contract test verifies the ordering of the umask, build, normalization, validation and promotion boundaries.

A post-recovery release check (`t-usw6x5hq48d5o1s`) also exposed an independent legacy-state coupling: the verifier
attempted `generic:runtime-verify` solely because an inactive generation's state file remained on disk, then timed out
on that obsolete loopback dependency. Targeted invocation `t-usw6x5htafhjjsw` proved the current dual generation
`CLEAN` and `RUNTIME_VERIFIED_READY_FOR_DUAL_ARM`, with equal latest/pending nonce and no unresolved mutation. The
candidate now verifies retained generic state only while its watcher is active or enabled; it does not delete history.

## Local validation

Command:

```bash
npm run check
```

Result: passed.

- formatting, lint, typecheck, UI build and all compile stages passed;
- Node tests: 476 passed, 0 failed;
- all four deterministic contract suites passed;
- secret scan: 522 files scanned, passed;
- Linux systemd verification remains a production gate because the local host is macOS.

Production additionally must invoke exact v0.17.14 under `umask 0077`, verify dependency import as `manga-board`
without a permission repair, prove no regular file or directory remains group/world writable, and bind the running
processes to the immutable release commit. Until those steps pass, this document describes a locally validated
candidate fix rather than a deployed fix.
