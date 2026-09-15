# 高频 Feed 信号合并修复前验证

- 日期：2026-09-15（Asia/Shanghai）
- 基线：v0.16.11 / `3d946b01ea81ad14ab52bb783c058ed2ab9bb007`
- 证据等级：生产只读/受控故障定位 + 本地确定性回归；尚不是候选版本生产验收或新收益证据

## 生产排除证据

目标实例固定为 `cbe793c9cb9241ce97752334f65cab48`（`manga-chan-arb-us-west`，`us-west-1`）。所有短时
探针均在授权撤销后只读运行，或在受控 canary 后立即撤销；最终 wallet latest/pending nonce 仍为 `54/54`，
wallet ETH 仍为 `0.003423006698510168`，且 `unresolvedMutation=null`。

- `t-usw6x37nbkwngn4`：确认 watcher 主 PID 在约 6 秒达到 320 MiB V8 heap，生产账本为 16,652,719 bytes；
- `t-usw6x37sovs9zi8`：单独托管 WSS 探针峰值 98,120 KiB；
- `t-usw6x381w66h5vk`：托管 WSS 与 Sequencer Feed 组合峰值 115,664 KiB；
- `t-usw6x384vct4iyo`：真实 Earn signer-free preflight 峰值 132,192 KiB；
- `t-usw6x38yf083pj4`：从当前游标处理 534 个 Feed frame，峰值 73,388 KiB；
- 实盘失败 PID `5147` 与 `5817` 均先从约 337.7 MiB 压缩到 231.6 MiB，随后在约 100 MiB 新分配后立即
  回到 337.6 MiB 并 abort。

这些结果排除了单独的历史账本、Earn 图、托管 WSS、Feed 解码或 Solidity 编译。生产与独立探针之间唯一剩余的
热操作是 supervisor 对 actionable frame 的待执行信号合并。

## 确定性复现

旧算法在已有 `classificationReasons=[A,B]` 时，又把派生字段 `classificationReason=A+B` 放回下一轮集合。
本地 24 次交替合并的末五次字符数为：

```text
10,747,903 -> 21,495,807 -> 42,991,615 -> 85,983,231 -> 171,966,463
```

修复后的 20,000 次合并保持两个原子原因、两个依赖地址和 40 字符展示值。聚焦回归：

```bash
node --test \
  test/sequencer-transport.test.mjs \
  test/feed-signal-coalescer.test.mjs \
  test/protected-strategy-scheduler.test.mjs
```

结果：20 tests，20 passed，0 failed。

完整本地门禁：

```bash
npm run check
```

结果：格式检查、JavaScript/Solidity/Shell lint、类型检查、前端构建、Solidity 编译、427 个单元测试、
4 套确定性合约测试和敏感信息扫描全部通过；`secret:scan` 共检查 458 个文件。GitHub CI、不可变 release、
生产重新授权、持续浸泡和回执读回仍待后续步骤，不能由本文件提前宣称完成。
