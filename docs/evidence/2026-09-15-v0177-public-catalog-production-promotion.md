# v0.17.7 public catalog production promotion — 2026-09-15

Evidence state: immutable release installed and signer-free production readback complete; live signer intentionally
inactive because V3 coverage remained unavailable.

## Release and installation

- PR `#196` merged as commit `80130aa5fd7940087101642404dc33d6ac450542` after PR CI run `34958795334` passed.
- Main CI run `34959019094` passed. Release workflow `34959261308` passed and produced a commit-addressed archive whose
  CI SHA-256 was `34273d25160bc138cbc2d17095420f05372286e18bf102e4ab987bfaea6cc58a`.
- The independently downloaded commit-addressed codeload archive had SHA-256
  `91ddbe623d39f5a3a11d553b92f7a5d67faacc3a0c4c6c67271a82ecb59d5331` and was verified before installation.
- Cloud Assistant install invocation `t-usw6x4to1o77cw0` completed successfully. The production symlink and both
  signer-free process working directories resolved to commit `80130aa5fd7940087101642404dc33d6ac450542`.
- Linux systemd static verification passed for project units. Its output included only pre-existing warnings from the
  unrelated Alibaba `cloudmonitor.service`.

## Production readback

- The first schema-v3 catalog completed at block `63,598,818` using only the official public endpoint.
- Earn recovered from 16 to 32 pools, all current fixed-block observations; no Earn pool was retained from stale
  evidence.
- V2 recovered from zero to five pools, but 117 V2 reads were throttled. V3 remained zero and all 716 V3 queries were
  throttled. Therefore the snapshot remained correctly `PARTIAL` and did not prove no opportunity.
- The board and competitor census ran from the new immutable release. A later `/healthz` read returned `HEALTHY`, with
  4,741 candidates, healthy SQLite parity and zero screened-positive proxy rows at that observation.
- `manga-dual-watcher.service` remained inactive. No signature, transaction, receipt or profit is claimed.
- The independent `atomic-cycle-live.service` stayed active at PID 781 from its own release directory.

The first reader-recovery command returned non-zero only because its operator-side health parser attempted to decode an
empty warm-up response as JSON. A separate bounded readback proved the services and catalog completed; this operator
error was not treated as a rollback or trading receipt.
