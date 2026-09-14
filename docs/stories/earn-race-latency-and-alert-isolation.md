# Story：缩短 Earn 竞态窗口并隔离无关路线

## Outcome

作为实盘经营者，我希望池子一发生相关变化，统一 supervisor 就立即把信号交给正确 adapter；如果某条路线因
状态竞争回滚，只暂停这条路线到下一次相关变化，其他路线继续寻找正净收益，同时飞书只在整体交易能力真正受损
时打扰我。

## Acceptance criteria

- 一个 Sequencer Feed 连接同时服务 Earn 与 Global，不创建第二个 signer；
- 精确 Earn 命中先执行 Earn 局部搜索，同一帧的 Global 搜索不会丢失；
- 同一批命中的所有池子都参与路线聚焦；
- 公开热路径复用受保护静态 catalog，只刷新当前池状态；异常缓存安全回退完整链上发现；
- 托管阶段再次校验选中路线和核心协议，不以缓存代替签名前证据；
- 最终 quote、call 和 Gas estimate 在同一固定区块并行完成；
- canonical revert 只隔离 exact route，更新相关池或成功 effect 后自动解除；
- 单个 adapter 超时/回滚不发飞书；共享执行不可用、全部扫描中断、停机或核账超时才发一次；
- 回归样本明确区分 canonical receipt、当前状态 replay 与历史 trace 缺口。

## Non-goals

- 不保证在公开 mempool/Sequencer 排序竞争中总能第一；
- 不降低 `minAmountOut`、净利润、Gas、余额、nonce、合约身份或 receipt 门槛；
- 不让不同 adapter 并行签同一钱包；
- 不把一次回滚、报价或模拟写成已实现收益。
