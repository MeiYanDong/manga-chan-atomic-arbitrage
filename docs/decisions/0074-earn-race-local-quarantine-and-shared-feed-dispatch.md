# ADR 0074：Earn 竞态局部隔离与共享 Feed 调度

- 状态：Accepted
- 日期：2026-09-15
- 补充：ADR 0067、ADR 0071、ADR 0073

## 问题

生产上的 WETH → AI → WETH 交易
`0x3a2c2d1b6f7c6dd20bd5445a2079b2aa5930573ab8ec1d57878e7ca0b2b10cc1` 在最终报价、调用模拟和 Gas
估算均通过后得到 canonical revert。审计时间线显示，从公开事件到公开筛选完成约 26.4 秒，托管节点精确
预检再用约 3.4 秒，签名到 Sequencer 接受约 0.47 秒。另一地址在我们的交易前两个区块对同一退出池执行了
同方向 AI → WETH Swap；当前状态重放返回 Balancer `SwapLimit`，输出低于已保护的 `minAmountOut`。

这组证据强烈支持“报价后池状态被竞争交易改变”的判断，但公共节点不提供对应历史状态的 `eth_call` 或 trace，
所以不能把具体历史执行路径写成已证明事实。保护下限发挥了作用：本金没有成交，只损失 canonical Gas。

旧架构还有三个放大因素：Earn 只由一秒级公开日志轮询唤醒，而 Global 已接 Sequencer Feed；公开 Earn 每次重复
读取 Factory、静态池元数据、代币标签和 Permit2 探针；一次回滚后没有精确的路线级冷却语义。与此同时，告警把
单个 adapter 的持续超时提升成用户级事故，造成平台边界与资金安全边界混淆。

## 决策

1. Earn、Global、USDG、WETH 继续使用各自的 typed adapter，但只由一个 supervisor、一个钱包锁和一个 nonce
   域调度。PAIR、LONG 或其他平台以后也遵循同一模型，不因品牌创建独立 signer。
2. 同一 Sequencer Feed 同时分类 Earn 与 Global。精确 Earn 池或 Earn 协议加非结算资产命中时，优先运行 Earn
   局部闭环；若该帧也满足 Global 条件，跨协议搜索保持排队，Earn 完成后继续，不能二选一丢弃。
3. Feed 或公开日志一次命中的全部 Earn 池都进入焦点集合；本地排序优先任何包含这些池的路线，而不是只取第一
   个池。精确报价预算仍受既有上限约束。
4. 复用六小时内的 protected canonical Global/Earn catalog 的 Factory membership、tokens、weights、labels
   和 Permit2 结果；事件热路径只用 bounded multicall 刷新 fixed-block dynamic balances/status。缓存缺失、过期、
   来自未来、损坏或不包含事件池时，回退到完整 canonical Factory 刷新。
5. 托管签名阶段只复用公开阶段选中路线的 canonical snapshot，并再次校验核心协议与该路线全部池子的 Vault
   identity、token 集合、费率和状态。缓存从不单独构成签名证据。
6. 最后一次 exact quote、`eth_call` 和 Gas estimate 在同一固定区块并行执行；任何一项失败或报价低于保护下限
   都不签名。签名后仍直接提交 Sequencer，并保留相同 raw 的托管节点 fallback。
7. canonical revert 只隔离 exact `routeId`。隔离持续到该路线任一池出现更新且顺序晚于回滚，或同路线取得成功
   effect；其他 Earn 路线、Global 和看板继续。比较 Feed 的源接收时间/区块，而不是父进程延迟写入时间，防止
   回滚前已排队的帧错误解除隔离。
8. 单个 Earn、Global 或 board adapter 持续失败只进入 `DEGRADED`，不发飞书。只有共享执行基础连续故障、全部
   discovery adapters 同时不可用、signer 停止/终止或 UNKNOWN 核账超时才发送一次关键提醒。

## 不变边界

- 不改变钱包、执行器、授权 ID、route commitment、资金上限语义、Gas 预算、正净利润约束或 45 秒链上 deadline；
- 不允许两个 adapter 并行签同一钱包，也不允许 UNKNOWN 时复用 nonce；
- Feed 只负责唤醒，不能代替固定区块报价、模拟、合约身份、余额、Gas 和回执证明；
- 路线隔离不能把回滚损失改写成 no-shot，failed Gas 继续进入终身正收益熔断器；
- 竞态 fixture 的证据等级固定为 `STRONG_STATE_RACE_INFERENCE_NOT_HISTORICAL_TRACE`。

## 验收

1. 历史 fixture 证明竞争交易命中同一退出池/方向，当前重放输出低于保护下限，同时不虚构历史 trace；
2. 测试证明回滚只隔离 exact route，旧/延迟 Feed 帧不能解除，更新相关池或成功 effect 可以解除；
3. 测试证明一个 Feed 帧可同时路由 Earn 与 Global，且 supervisor 先 Earn、后保留 Global；
4. 测试证明热路径只刷新 dynamic pool data，选中路线在托管阶段仍做 canonical identity 校验；
5. 测试证明单 adapter 降级不提醒，全部 discovery 中断或 execution foundation 故障才提醒；
6. 本地全量门禁、GitHub Linux 门禁、不可变 release 和生产读回全部通过后才恢复关键告警 timer。
