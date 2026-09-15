# v0.17.8 canonical Multicall production promotion — 2026-09-15

Evidence state: immutable release installed; topology materially improved but remained transport-partial; live signer
intentionally inactive.

## Release and installation

- PR `#197` passed CI run `34961554458` and merged as
  `78347e04c9023ebf414610ec89a32d28c6792b05`.
- Main CI run `34961780306` and release workflow `34961988067` passed.
- The CI archive SHA-256 was `fe8564a406d83000adbd3d67d030c42ff1f47dc351d5f30392d71b626c73d9d8`.
- The independently downloaded codeload archive SHA-256 was
  `a55f2cdee40c89823f977e7ed061e5a2a41675b956050c340ca0350469b22199`.
- Cloud Assistant invocation `t-usw6x4wi55vkhs0` installed the exact commit. Production release build and secret scan
  passed; Linux unit verification emitted only pre-existing Alibaba `cloudmonitor.service` warnings.
- The board and census ran from the new commit. The unrelated atomic-cycle service remained at PID 781 in its own
  release directory.

## Production catalog observations

- First schema-v4 generation at block `63,617,141`: 32 current Earn pools, 29 V2, 84 V3 and five V4 pools. V2 had zero
  transport failures; V3 had 132. Multicall identity matched the reviewed runtime hash.
- Second normal generation at block `63,619,426`: 32 Earn, 29 retained V2, 60 fresh plus 34 retained V3, and five V4
  pools. It reported 179 V2 and 233 V3 transient query failures. The exact-query retention policy raised total V3
  coverage to 94 but did not make the generation complete.
- The board subsequently returned HTTP 200 `HEALTHY`; its signer capability remained absent.
- `manga-dual-watcher.service` and the critical alert timer remained inactive. No signature, broadcast, receipt, Gas or
  profit is attributed to this release.

## Conclusion

Canonical Multicall removed the v0.17.7 transport-shape blindness and recovered materially more topology, but ordinary
production load proved that sequential requests still needed pacing and aggregate-level transient retry. This evidence
motivates ADR 0092; it is not a profitable-opportunity or lost-race receipt.
