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

## Candidate change

The installer now establishes `umask 0022` before creating the release tree, extracting the archive and installing
dependencies. Existing explicit modes remain authoritative for configuration, encrypted credentials and mutable
runtime state. A source-contract test verifies both presence and ordering of the normalized umask.

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

Production additionally must invoke the exact candidate under `umask 0077`, verify dependency import as `manga-board`
without a permission repair, and bind the running processes to the immutable release commit. Until those steps pass,
this document describes a locally validated candidate fix rather than a deployed fix.
