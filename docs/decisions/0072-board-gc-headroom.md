# ADR 0072：共享服务器上的候选面板 GC 余量

- 状态：Accepted
- 日期：2026-09-15
- 补充：ADR 0071

## 问题

生产候选面板在 4,508 个候选、约 56 MiB 精简来源目录和 41 MiB 当前快照下，RSS 到达约 519 MiB。原来的
`MemoryHigh=512M` 在 V8 完成垃圾回收前触发 cgroup 内存节流，进程持续停在
`mem_cgroup_handle_over_high`。systemd 仍显示 active，但 loopback API 和执行快照停止更新约六小时。

## 生产验证

在不重启进程的情况下，临时把高水位提高到 576 MiB、硬上限提高到 640 MiB。API 恢复响应，进程等待点回到
`ep_poll`，RSS 从约 519 MiB 回收到约 373 MiB。这证明本次故障是 GC 前的 cgroup 节流，不是无界死锁或 OOM。

## 决策

1. 保持 V8 old-space 上限 320 MiB；给 SQLite、序列化和一次 GC 峰值保留额外的进程余量；
2. 将面板 `MemoryHigh` 固定为 576 MiB，`MemoryMax` 固定为 640 MiB；硬上限仍防止面板无界侵占共享主机；
3. signer 继续只读 `/run/manga-opportunity-board-feed/execution-snapshot.json`，不依赖耗时的完整 HTTP 投影；
4. 候选数据连续 30 个 watcher 循环失效才触发一次关键提醒，短暂刷新或单次超时保持静默。

## 验收

- Linux unit 校验通过；
- 重启后面板 API、执行快照时间和 SQLite parity 正常；
- board RSS 低于高水位，`memory.events high` 不再持续增加；
- 实盘 runtime verify 使用 signer 的精简文件边界通过；
- 关键提醒不因一次 board 刷新变慢而发送。
