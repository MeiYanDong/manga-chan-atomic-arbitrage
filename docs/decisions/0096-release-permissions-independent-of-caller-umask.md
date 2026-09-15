# ADR 0096: Make release permissions independent of caller umask

Status: accepted

## Context

The v0.17.12 production bootstrap was deliberately invoked from a restrictive operator shell with `umask 0077`.
Archive verification and the production build passed, but npm inherited that mask and created application directories
that only root could traverse. The signer service and the two read-only identities are intentionally different Linux
users. As a result, the opportunity board and competitor census could not import `viem`; the processes failed before
their application health checks despite an otherwise valid immutable release.

An operator repaired the existing release permissions without exposing configuration or credentials. This restored
module imports, but an unrecorded post-install permission rewrite is not a safe release contract and would recur on the
next restrictive invocation.

The v0.17.13 promotion then proved a second boundary: GitHub codeload archives preserve stored file and directory mode
bits. Establishing `umask 0022` prevented newly created npm content from becoming private, but it did not remove the
archive's existing group-write bits. The installer therefore also needs an explicit post-build normalization and proof.

## Decision

1. The release installer establishes `umask 0022` before it creates the immutable release, extracts source or runs npm.
2. After the production build, the installer removes group/other write permission and adds shared read/traverse
   permission across the immutable release tree. It verifies no regular file or directory remains group/world writable
   before writing the release identity or promoting the current symlink.
3. Immutable application code and dependencies are readable and traversable by isolated service identities, but are
   never writable by group or other users.
4. Configuration, encrypted credentials and mutable state do not inherit that general release policy. The installer
   continues to give each of them an explicit owner, group and restrictive mode.
5. Regression tests verify both the pre-install umask and the post-build permission normalization precede promotion.
6. Production promotion must prove the contract by invoking the bootstrap beneath `umask 0077`, then importing a
   runtime dependency as the read-only board identity without a repair step.

## Consequences

- A caller's shell policy can no longer silently make a valid release unreadable to a required service identity.
- Permission intent is split explicitly: broadly readable immutable code, narrowly readable configuration and
  identity-specific mutable state.
- This does not authorize a signer, start a service, change an economic limit or establish a profit receipt.
