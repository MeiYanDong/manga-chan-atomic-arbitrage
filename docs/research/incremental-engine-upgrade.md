# 从双仓库到统一增量套利系统

## 结论

`manga-chan-atomic-arbitrage` 与 `atomic-cycle-engine` 不是同一个程序，也不应在缺少迁移证据时直接合并签名进程。
前者是 Robinhood Chain 的生产控制面与实盘执行系统；后者是独立的通用研究内核、Base 实盘金丝雀和
Robinhood/BNB 只读发现器。二者应先统一领域契约和证据语义，再按链与钱包划分 signer lane。

目标不是一个无边界的“大机器人”，而是一个逻辑平台、多个隔离执行域：

```text
链事件 / 公开日志 / 周期恢复
             │
             ▼
       版本化本地状态
             │ CatalogDelta
             ▼
Token / Pool / Funding Registry ──► Market Graph
                                      │ dependency index
                                      ▼
                                受影响的局部路线
                                      │
                         本地筛选 → 精确链上复核
                                      │
                             单一风险与签名仲裁
                                      │
                   Robinhood lane / Base lane / BNB lane
```

## 当前职责边界

| 系统         | 当前权威职责                                                                                         | 当前非职责                               |
| ------------ | ---------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| MANGA        | Robinhood 统一 supervisor、Earn/Global/双币 typed adapter、唯一钱包/nonce 域、公开经营面板、竞争证据 | Base signer、BNB signer                  |
| Atomic Cycle | 通用 2–4 跳模型；Base 独立 signer 与执行器；Robinhood/BNB 只读跨场所路线簿                           | MANGA 钱包或授权、Robinhood 混合路线签名 |

同一服务器只是共享主机，不代表共享进程、钱包、nonce、状态目录或发布生命周期。Base live 在迁移前保留独立
release 和 systemd unit；Robinhood/BNB shadow 继续作为独立发现分母，不能冒充 MANGA 的实盘能力。

## 升级顺序与完成定义

| 阶段 | 结果                                                                         | 当前状态                                        |
| ---- | ---------------------------------------------------------------------------- | ----------------------------------------------- |
| P0   | 事件时间线、逐 message 去重、pending dependency union、周期公平性            | 本 release 完成去重与并集；公平调度另行验收     |
| P1   | canonical Token/Pool/Funding registry、CatalogDelta、版本化 quote capability | 现有 catalog 可复用，但尚未形成唯一版本化状态源 |
| P2   | `DependencyToRoutes` 增量拓扑索引，事件只重算局部路线                        | 已有有界 workset，尚未消除全局 child 的重复装载 |
| P3   | 常驻无签名 worker，本地 cheap filter 与金额优化，最终 exact solver           | 尚未完成；不能声称低延迟架构已经上线            |
| P4   | fault injection、持久化恢复、逐链 signer lane 迁移与旧路径退役               | 尚未开始；每条链需独立回执与回滚证据            |

“完成”必须同时具备测试、GitHub CI、不可变生产 release、活跃 PID/工作目录、授权与未决交易读回，以及至少一次
候选决策证据。只有规范回执和余额/Gas 对账后的 effect 才是收益；发现、模拟、服务运行都不是。

## 合并原则

1. 先共享小而稳定的类型、ID、quote capability、outcome/evidence schema；不先共享 signer 或数据库。
2. 先让新 worker 与旧路径对同一固定块输出 parity 证据，再切换读取方；不能用一次测试替代生产回读。
3. Robinhood 保持一个 signer/nonce owner；Base 保持当前独立 owner，直到新控制面具备同等 fence、same-raw、
   reconciliation 和 rollback 证据。
4. BNB 在 typed executor、资金和正净收益样本都不存在时仍为只读；不能为了“统一”而继承别的链的交易权限。
5. 每次发布只关闭一个可验证缺口，保留上一不可变 release，避免架构重写同时改变发现、风险和资金三条边界。
