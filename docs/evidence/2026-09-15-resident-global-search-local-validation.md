# Global 常驻只读搜索本地验证

- 日期：2026-09-15（Asia/Shanghai）
- 基线：v0.16.14 / `ac860cecee312688fcea43a4cdb0a205bf51659d`
- 证据等级：生产只读瓶颈取证 + 本地实现与确定性回归；尚不是候选版本生产验收或新增收益证据

## 生产基线

目标固定为 SWAS `cbe793c9cb9241ce97752334f65cab48`、`us-west-1`、`47.251.185.146`。控制面在
`2026-09-15T03:11:47Z` 报告实例 Running，Cloud Assistant 可用。只读 guest 探针 invocation
`t-usw6x3p9boqu3nk` 在 `03:12:40Z` 观察到：

- 1,613 MiB 总内存，1,204 MiB 已用，408 MiB available，无 swap；
- dual watcher、board、两个 Atomic Cycle 服务和 census 均 active/running，`NRestarts=0`；
- dual watcher 约 96 MiB current / 173 MiB peak，board 约 576 MiB current；
- release 为 `ac860cecee312688fcea43a4cdb0a205bf51659d`，`unresolvedMutation=null`；
- 最近一轮 Global event 为 17,123 ms source→decision，其中 preflight 928 ms；该轮没有任何结算资产被准入，
  因此不是重现最慢路径的样本。

此前同一 release 的生命周期证据有一轮 source→decision 约 270 秒：约 216 秒在进入 Global preflight 前
等待，之后对动态结算资产重复构建路线约 42 秒。该单样本用于定位工程瓶颈，不代表 p50/p95。

## 本地差分与故障回归

在本地保留的真实 catalog（31 个 Earn pools、29 个 v2、184 个 v3、5 个 v4）上，以 AI 地址作为事件依赖，
旧/新遍历使用相同 settlement、相同 20,000-cycle 限制和相同 4→3 hop 回退：

| Settlement | 旧全物化 | 新依赖流式 Top-8 |  加速 | 完整循环 | 相关循环 |
| ---------- | -------: | ---------------: | ----: | -------: | -------: |
| USDG       |   436 ms |           100 ms | 4.35x |   12,336 |      912 |
| WETH       |   445 ms |           104 ms | 4.27x |   15,516 |    1,732 |

差分测试验证总循环、相关循环和静态排序与全量基线一致。worker 测试还覆盖：busy-tail 依赖并集、响应 ID
绑定、正值必须回到 live revalidation、签名环境剥离、共享 catalog 单写入边界、坏进程只回退当前信号。
聚焦命令：

```bash
node --test \
  test/resident-global-search.test.mjs \
  test/feed-signal-coalescer.test.mjs \
  test/global-liquidity-graph.test.mjs \
  test/protected-strategy-scheduler.test.mjs \
  test/dual-base-cli.test.mjs
```

结果：33 tests，33 passed，0 failed。完整 `npm run check` 同样通过：436 tests，436 passed，0 failed；
四组确定性合约测试、格式、lint、类型检查、UI 构建、systemd shell 校验及密钥扫描全部通过。GitHub CI、
不可变 release、生产切换、浸泡和真实收益回执仍待后续步骤，不能由本文件提前宣称完成。
