# Global 多源事件唤醒生产发布证据

- 发布日期：2026-09-15（Asia/Shanghai）
- 生产版本：`v0.16.16`
- 不可变提交：`cbe7f7692725937fdfe6e60f66779750b683f5ce`
- 证据边界：代码、发布、运行时、实盘授权与自然 Earn 事件唤醒已闭环；截至验收快照，新授权尚无新增签名、
  广播、receipt、Gas 或收益

## 目标与结果

v0.16.16 已部署到 `manga-chan-arb-us-west`。Earn 的规范池事件现在除唤醒 Earn adapter 外，还会把精确变化池
投影为 Global 图的 `routeAddresses`，因此同一个事件可以触发同 Earn 或 Earn/Uniswap 跨协议闭环搜索。该投影
不授予签名或 managed RPC 权限；常驻 Global worker 仍然 signer-free，只有其只读结果通过唯一 signer 的最新
状态、Gas、余额、nonce、授权、精确模拟和净利润检查后才可能广播。

生产验收时：watcher、board、census、关键健康监控和经营报告服务均已恢复；共享主机上的
`atomic-cycle-live.service` 与 `atomic-cycle-shadow.service` 保持原 PID、零重启。新授权为
`ARMED / UNTIL_REVOKED`，但没有新交易结果，不得把本次发布描述为新增盈利。

## 合并、门禁与不可变发布包

- Pull request：<https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/pull/187>
- 合并提交：`cbe7f7692725937fdfe6e60f66779750b683f5ce`
- PR CI：<https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/actions/runs/34928370407>，`success`
- main CI：<https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/actions/runs/34928481742>，`success`
- release CI：<https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/actions/runs/34928603267>，`success`
- GitHub release：<https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/releases/tag/v0.16.16>
- 发布包 SHA-256：`ec0f8879545ee8766cedb0d466d6c1118aa701cfa6805c1637fd6df8d1252f5c`

本地完整 `npm run check` 在合并前通过：441/441 Node tests、4/4 deterministic contract suites，以及格式、
lint、类型、UI build、四个合约编译器、shell 校验和 471-file secret scan。Linux GitHub 门禁补齐了 macOS
无法执行的 systemd unit 校验。生产安装器再次完成类型检查、UI build、合约编译和 456-file secret scan。

## 受控切换

生产目标由 `default / us-west-1 / swas.us-west-1.aliyuncs.com / cbe793c9cb9241ce97752334f65cab48`
精确解析，控制面和 Cloud Assistant 均健康。

1. 预检 invocation `t-usw6x3w1deqhurk` 读取 v0.16.15 的服务、授权、nonce 域和触发源状态；首次只读命令
   因 Cloud Assistant 使用 POSIX `sh` 而不支持 `set -o pipefail`，在任何状态变更前退出。
2. `t-usw6x3w5sett9fk` 持久撤销旧授权、停止 watcher 与关键 timer，并要求 `dual:reconcile=CLEAN`；
   `atomic-cycle` 两个服务未停止。
3. `t-usw6x3w8934jsao` 下载不可变 release、校验上述 SHA-256、完成构建、安装与 systemd 校验；安装脚本明确
   报告“service was not armed or started”。
4. `t-usw6x3wgaxnw4xs` 恢复 signer-free board、census 与经营报告。冷启动期间公网先返回 502/503；随后
   `/healthz` 返回 HTTP 200，runtime/persisted snapshot 均为 `RUNNING`，SQLite integrity 为 `HEALTHY` 且
   parity 为 `true`，`/api/v1/system.release` 精确匹配本提交。
5. `t-usw6x3wrjm7otfk` 再次要求 `dual:reconcile=CLEAN` 且 `unresolvedMutation=null`。
6. `t-usw6x3wsx59pj40` 取得 `RUNTIME_VERIFIED_READY_FOR_DUAL_ARM`：链 ID 4663，wallet latest/pending
   nonce 为 `62 / 62`，USDG/WETH 执行器地址、source hash、runtime hash 与链上状态匹配，board 为
   `READ_ONLY_NO_SIGNING_NO_BROADCAST`。
7. `t-usw6x3wv1q0ndhc` 创建全新的、绑定当前发布和当前本金的授权；`t-usw6x3wwh7jsydc` 启动 watcher。
8. `t-usw6x3wyhj9ypds` 回读精确 release cwd、service cgroup、Node child、授权和运行账本；
   `t-usw6x3x09qp04xs` 手动关键健康检查返回 `TRADING_HEALTHY / notification=NONE`；
   `t-usw6x3x1v15o1ds` 才恢复关键健康 timer 和经营报告 path/timer。
9. `t-usw6x3xfuatp0jk` 取得自然公共 Earn 日志进入 Global worker 的中间态证据；`t-usw6x3xj8skfxmo`
   在事件与后续周期检查完成后读回稳定 `RUNNING`、零签名、零 Gas、零重启和 `TRADING_HEALTHY`。

## 生产运行读回

| 对象                        | 读回结果                                                            |
| --------------------------- | ------------------------------------------------------------------- |
| current release             | `cbe7f769…f5ce` / package `0.16.16`                                 |
| MANGA watcher               | PID `24081`，`active/running`，`NRestarts=0`                        |
| Global signer-free worker   | PID `24095`，`RUNNING`，完成 2 次事件搜索，failures/restarts 均为 0 |
| opportunity board           | PID `23875`，`active/running`，signer 未加载                        |
| competitor census           | PID `23877`，`active/running`                                       |
| Atomic Cycle live / shadow  | PID `781 / 782`，均 `active/running`，`NRestarts=0`                 |
| critical health             | 手动 `TRADING_HEALTHY`；timer 为 `active/waiting`                   |
| authorization               | 新 ID `0x06f9…c21df`，`ARMED / UNTIL_REVOKED`                       |
| unresolved mutation         | `null`                                                              |
| 新授权签名/receipt/失败 Gas | `0 / 0 / 0 ETH`                                                     |

验收期间 Global 完成了两次自然事件搜索和两次周期恢复。最后一个完整周期在最新状态上返回
`VALID_NON_PROFITABLE / PARTIAL` 与 `NO_EXACT_NET_OPPORTUNITY`，没有签名或广播。这是一次覆盖为 `PARTIAL`
的无交易决定，不代表所有市场状态都不存在机会。

## 实时触发源的当前边界

v0.16.16 消除了“只有 Sequencer Feed 才能唤醒常驻 Global worker”的代码依赖，但生产触发源本身仍有外部可用性
问题：

- 公共 Sequencer Feed 对当前出口返回 HTTP 403；
- managed Earn WSS 返回 network/non-101，订阅尚未激活；
- watcher 的公共 Earn `eth_getLogs` 在验收初始样本中超时；
- board 的独立公共日志扫描随后成功看到了相关日志，因此市场采集没有整体停摆；
- 五分钟周期 Global recovery 始终保留，不依赖上述实时订阅。

尽管上述外部源仍不稳定，新路径已取得自然生产证据。`2026-09-15T04:41:26.452Z` 的公共 Earn 日志回补事件
以 `PUBLIC_EARN_LOG_BACKSTOP / EARN_POOL_SWAP_EVENT` 唤醒 Global，携带一个精确变化池；截至验收，Earn 和
Global scheduler 各记录 2 次 event run，`searchWorker.completed=2`，且 worker 为 `inFlight=false`、
`failures=0`、`restarts=0`。事件搜索与后续周期恢复均没有发现满足全部成本约束的候选，整个新授权保持
`signedAttempts=0 / consumedNonces=0 / failedGasEth=0`。

这证明 `Earn event -> signer-free Global worker -> 唯一 signer 最新态门禁` 的生产接线真实走过；它不证明
对应事件存在利润，也不证明每个实时源均已恢复。

## 经营数据边界

公网 `/api/v1/profit/daily` 在 `2026-09-15T04:40:20Z` 的北京时间当日快照记录 20 笔历史已确认成功交易：

- 已核验交易净收益：`0.000753973592589125 ETH`；
- 两笔失败 Gas：`0.00003354592337 ETH`；
- 策略净额：`0.000720427669219125 ETH`；
- 离链运营成本覆盖仍不完整，因此 `businessNet=UNKNOWN`。

这些是当日跨版本累计值。新授权的 `confirmedExecutions=0`、`signedAttempts=0`、`failedGasEth=0`，所以本次
发布没有认领任何新增 receipt 或利润。

## 尚未闭环

- Sequencer Feed、managed Earn WSS 和 watcher 公共日志源的外部可用性仍需分别恢复或引入合格的生产级数据源；
- Sequencer Feed 不可用时，Uniswap-only 变化仍依赖五分钟周期恢复；
- 本版本尚无新增 canonical receipt，未来正收益不能由历史收益或运行状态外推。
