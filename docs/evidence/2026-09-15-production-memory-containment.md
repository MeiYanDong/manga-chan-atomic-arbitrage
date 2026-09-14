# Production memory containment evidence — 2026-09-15

Evidence state: implementation validated locally; production canary pending release deployment.

## Observed incident

- Exact instance: `cbe793c9cb9241ce97752334f65cab48` (`manga-chan-arb-us-west`, `us-west-1`).
- The OOM cycle began on release `v0.16.6`, before the `v0.16.7` release switch.
- systemd recorded repeated OOM kills for `manga-dual-watcher.service` under its 512 MiB cgroup.
- A reversible runtime-only 640 MiB canary stayed active for 60 seconds but reached about 628 MiB and was followed by
  loss of HTTP, SSH session establishment and Cloud Assistant command execution while the control plane remained
  `Running`.
- The latest pre-incident chain-state readback showed no unresolved mutation or pending transaction.

## Containment acceptance

- Static unit tests require a 320 MiB inherited V8 heap cap, 448 MiB high watermark and unchanged 512 MiB hard cap.
- Static unit tests require direct Node startup for the live watcher and reject the previous npm wrapper.
- Full project quality and contract gates must pass on GitHub before promotion.
- Production acceptance requires an independent post-switch readback of release identity, service state, restart
  count, cgroup current/peak memory, watcher authorization, unresolved mutation state, public health and at least one
  completed typed Global lifecycle. A running process alone is insufficient.
