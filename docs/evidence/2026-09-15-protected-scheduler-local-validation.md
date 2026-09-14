# 多策略受保护调度本地验证

- 验证时间：2026-09-15 CST
- 基线：`03862a0` / v0.16.5
- 候选版本：v0.16.6
- 证据等级：本地确定性测试与源码门禁；不是生产运行、成交或收益证据

## 已复现缺口

1. 原 supervisor 用 `pendingEarnWake` / `pendingGlobalWake` 同时表达市场事件与周期恢复；
2. 每次 Earn 或 Global 事件执行都会把 `nextPeriodicAt` 改为“当前时间加周期”，因此持续事件可无限延后恢复覆盖；
3. Earn 周期工作只有在普通面板没有可执行候选时才运行，持续面板候选也可能造成饥饿；
4. 原状态没有记录每个策略真实的周期迟到值，无法区分“在线”和“按计划获得覆盖”。

## 修复后回归

聚焦命令：

```bash
node --test \
  test/protected-strategy-scheduler.test.mjs \
  test/feed-signal-coalescer.test.mjs \
  test/opportunity-board-isolation.test.mjs
```

结果：19 tests，19 passed，0 failed。

新增确定性反例包括：

- Earn 与 Global 同时到期时，两条周期任务均在事件 backlog 之前领取；
- 一个周期内连续注入 Earn 事件，周期截止时间保持不变；
- Feed 与公开日志合并后保留两个池，且高优先级 Feed 只接管原因标签、不覆盖依赖；
- Global 尚在最小间隔内时，Earn 事件仍可领取；
- 晚到 750 ms 的恢复任务明确记录 750 ms lateness。

## 全量门禁

命令：

```bash
npm run check
```

结果：

- Prettier、ESLint、Solhint、Shell syntax、TypeScript：通过；
- Vite 生产构建和四套 Solidity artifact 编译：通过；
- Node 单元测试：396 passed，0 failed；
- Fixed、Generic、WETH 与 Universal 确定性合约测试：通过；
- secret scan：430 files，pass；
- `systemd-analyze`：macOS 不可用，本地明确跳过，必须由 GitHub Ubuntu CI 执行。

## 安全与兼容边界

- 变更只替换 supervisor 的工作选择，不改变合约、钱包、授权、资金、利润、Gas、模拟、nonce 或广播；
- 每次只领取一个任务，所有可能进入交易的 adapter 仍由同一个 supervisor 串行调用；
- 子进程超时、未知交易异步对账和同 raw 重发规则保持不变；
- 同步 Global 子进程的最长阻塞仍未消除；本版本只保证任务不会被无限重置，并如实记录迟到。

## 尚未证明

- 尚未取得 GitHub Linux CI、不可变 release 或生产读回；
- 尚未证明真实 event-to-decision 延迟下降；
- 调度公平不等于出现机会、成交或利润，实盘结论仍只接受 canonical receipt 与余额/Gas 对账。
