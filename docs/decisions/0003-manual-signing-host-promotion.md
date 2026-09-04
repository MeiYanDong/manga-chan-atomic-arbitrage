# ADR 0003: manual promotion to a single signing host

- Status: Accepted
- Date: 2026-09-04

## Decision

CI builds and verifies commit-addressed release artifacts but never receives the operator private key. A human-approved runbook promotes one artifact to one signing host. systemd credentials expose the key only to the service process.

The macOS lane must be stopped and disarmed before the cloud lane is armed. File locks are only a local defense; nonce and arm readback provide the cross-host cutover gate.

## Consequences

- There is no unattended wallet deployment from GitHub Actions.
- Runtime verification is required after each promotion.
- A fresh canary wallet is required before materially increasing capital because the present key has previously been disclosed in conversation.
