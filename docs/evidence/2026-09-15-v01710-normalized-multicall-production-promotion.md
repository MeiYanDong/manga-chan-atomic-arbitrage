# v0.17.10 normalized Multicall production promotion — 2026-09-15

Evidence state: immutable release and complete catalog readback passed; live signer remained inactive; settlement
admission fanout defect found by the no-signature preflight.

## Release and installation

- PR `#199` passed CI run `34966453459` and merged as
  `cb7dd044e6c613e6a470ef0e14cf4d4fd59cad86`.
- Main CI run `34966665397` and release workflow `34966918246` passed.
- The CI archive SHA-256 was `896d198925869700ec89c3286c35ef43c3c232e38c1d46b78eab96e87c2837dc`.
- The independently downloaded codeload archive SHA-256 was
  `4f106101bdf78d6e4cd9df5f795b79ccc74f6d40aa738d8d10733b64812b7ddb`.
- Cloud Assistant invocation `t-usw6x51cz3j5ou8` installed the exact commit. The production build, secret scan and
  Linux unit verification passed; the only unit warnings belonged to Alibaba `cloudmonitor.service`.
- The board ran from the exact release and stabilized at HTTP 200. The unrelated atomic-cycle service remained at PID
  781 in release `8b67df7e9bc97acc9ddb95c63e21957bda61b2a5`.

## Catalog and preflight evidence

The first production refresh published fixed block `63,649,800` with 32 Earn, 29 V2, 119 V3 and five base V4 pools.
V2 and V3 transport errors were both zero and catalog evidence was `COMPLETE`. This closes the embedded all-transient
Multicall failure observed in v0.17.9.

`dual:reconcile` returned `CLEAN` with `unresolvedMutation=null`. The subsequent signer-free Global preflight built a
247-asset graph with 1,583 swap edges, 38 hyperedges, 473 merged V4 pools and 18,626 theoretical routes, but admitted
zero settlement assets. It reported 16 valuation-eligible funding candidates, one funded candidate and incomplete
funding evidence. Independent fixed-block reads proved Morpho held both USDG and WETH and all four WETH/USDG V3 fee
tiers returned positive quotes. The contradiction identified nested logical-call fanout as an implementation defect,
leading to ADR 0094.

`manga-dual-watcher.service` and `manga-critical-health.timer` remained inactive. The preflight performed no signature,
broadcast or Gas spend, and no profit is attributed to this release.
