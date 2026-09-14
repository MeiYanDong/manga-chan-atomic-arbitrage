# 2026-09-15 共享签名域恢复：本地验证证据

## 生产故障事实

- `manga-dual-watcher.service` 于 2026-09-15 00:57:32 CST 以退出码 71 停止；
- 对应交易 `0xb845ecd7b225f68d20fe2a60d4df778385193637769f9d10453d1afb246a8365` 已取得
  canonical reverted receipt，而不是 UNKNOWN；
- 该回滚消耗 nonce 40 和 `0.00001691917001 ETH` Gas；
- `manga-critical-health.service` 反复 ABRT。旧入口为复用两个小型校验函数加载了
  `business-operations.mjs`、`journal.mjs` 及其链上依赖；生产对照探针后来进一步定位到直接触发条件是
  `TasksMax=8`：纯 Node 可运行，但 Node `fetch` 建立 DNS/TLS 网络请求时 ABRT；`TasksMax=16` 时成功；
- 现有公共 RPC 不提供该历史块的 `eth_call` 状态，也不提供 `debug_traceTransaction`。所以可以确认回滚和
  Gas，不能把具体 EVM 回滚原因伪装成已知。

## 根因

1. Earn 子进程先正确写入 `mutation_reverted`，随后抛异常并以非零退出；父 watcher 把这个已经确定的业务结果
   错当成全局不变量失败并退出。
2. 授权 nonce 只累计成功交易，没有累计 canonical revert。即使重启，下一次合法 nonce 也会被误判成钱包冲突。
3. UNKNOWN 的处理边界是整个进程，而不是共享钱包的签名域，导致无签名的市场扫描也一起停止。
4. 飞书检查器依赖过重，且八个 task 的 systemd 上限不足以运行 Node 网络请求；文案还暴露内部术语，没有
   优先说明影响、系统动作和用户是否需要处理。

## 修复后的规则

- 成功和已确认回滚都终结 mutation、消耗 nonce；回滚只记失败 Gas，不停用已验证执行器；
- Earn、Global、USDG、WETH 的已确认回滚均返回结构化结果，父 watcher 在熔断预算允许时继续；
- UNKNOWN 只暂停共享钱包的新签名，后台每五秒按 mutation 类型核账；看板、Earn 事件和 Sequencer Feed 继续；
- 严格限制 UNKNOWN 期间 nonce 只能处于未观察、pending 或已出块待核账的一个-nonce窗口；
- 飞书前三分钟不提醒正常核账，卡住才提醒一次；日报和关键提醒不展示哈希、nonce、RPC 或内部状态码；
- 关键提醒器改为无第三方依赖的小模块，systemd 内存上限调整为 128 MiB，task 上限调整为 16。

## 本地验证

- `npm run check`：通过；
- Node 测试：379/379 通过；
- deterministic contract suites：4/4 通过；
- secret scan：414 个文件通过；
- 修复后重点测试：57/57 通过；
- `git diff --check`：通过；
- 轻量提醒依赖冷启动 peak memory：14,599,872 bytes；旧经营与 journal 依赖组合：44,963,216 bytes。

生产 Linux systemd 校验、GitHub Actions 和部署后运行读回必须在 promotion 阶段另行记录；本文件不把本地结果
写成生产已生效。
