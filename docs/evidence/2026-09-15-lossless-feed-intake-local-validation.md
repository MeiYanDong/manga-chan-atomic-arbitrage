# Feed 逐消息去重与依赖并集合并前验证

- 验证时间：2026-09-15 CST
- 基线：`e6f91ba` / v0.16.4
- 候选版本：v0.16.5
- 证据等级：本地确定性测试与源码门禁；不是生产运行、成交或收益证据

## 已复现缺口

1. `src/sequencer-feed.mjs` 原实现比较 frame 的第一条 sequence number。高水位为 `100` 时，重叠 frame
   `[100, 101]` 整体提前返回，未消费的 `101` 也被丢弃。
2. `scripts/dual-base-arb.mjs` 原实现直接替换 `pendingEarnSignal` 与 `pendingGlobalSignal`。同一调度窗口 A、B
   两个可操作事件连续到达时，第二个信号覆盖第一个信号的 pool/asset dependency。
3. 原测试只有单 message frame，且没有验证连续 pending signal 的集合语义，因此两处缺口没有被门禁捕获。

## 修复后回归

聚焦命令：

```bash
node --test --test-reporter=spec \
  test/sequencer-transport.test.mjs \
  test/feed-signal-coalescer.test.mjs \
  test/opportunity-board-isolation.test.mjs
```

结果：23 tests，23 passed，0 failed。

覆盖边界包括：

- 重叠 `[100, 101]` 只删除 `100`，并只用 `101` 的 payload 匹配新依赖；
- 完全重放 `101` 不产生第二次 wake；
- duplicate frame/message、overlap、gap 与 out-of-order 分别计数；
- sequence 超出 JavaScript 安全整数后使用十进制字符串，不发生精度截断；
- pending Earn/Global 信号保留 A 与 B 的 pool、asset、sequence 范围和最早源时间；
- supervisor 源码门禁不再允许公开日志直接覆盖待处理 Feed 信号。

## 全量门禁

命令：

```bash
npm run check
```

结果：

- Prettier、ESLint、Solhint、Shell syntax、TypeScript：通过；
- Vite 生产构建和四套 Solidity artifact 编译：通过；
- Node 单元测试：391 passed，0 failed；
- Fixed、Generic、WETH 与 Universal 确定性合约测试：通过；
- secret scan：425 files，pass；
- `systemd-analyze`：macOS 不可用，本地明确跳过，必须由 GitHub Ubuntu CI 执行。

## 尚未证明

- 尚未取得 GitHub CI 回执或生产 release 读回；
- 尚未证明当前 Sequencer Feed 服务端允许连接，亦未证明本次减少了真实成交延迟；
- 测试与 Feed wake 都不是实盘收益，收益仍只接受 canonical receipt、事件、余额与全部 Gas 对账。
