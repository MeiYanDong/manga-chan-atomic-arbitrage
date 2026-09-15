# Story：Global 事件搜索不再等待签名队列

## 用户结果

作为实盘经营者，我希望 Global 多池事件一到就开始搜索，而不是先等待 Earn 或周期任务完成；同时任何并行搜索
都不能成为第二个签名器，也不能把过期正值直接变成交易。

## 验收标准

- Sequencer Feed、现有 Earn WSS 和公共 Earn 日志回补中的 Global 依赖事件立即进入一个常驻只读 worker；
- Earn 事件只投影真实变化池地址，不按代币名称或“必须跨平台”限制路线；
- 不为多源唤醒新增订阅、付费 RPC 消耗或签名权限；
- worker 忙时保留所有新池、资产、序号和最早观察时间，不覆盖旧依赖；
- worker 环境不含私钥文件、credential directory、授权 ID、Webhook 或 live-arm 权限；
- worker 只读共享 catalog；目录缺失或过期时回退既有单写入刷新链路；
- worker 仅使用公共 RPC；RPC/状态证据不完整时必须回退原有 managed-capable child，不能写成“没有机会”；
- worker 只缓存 catalog/graph 拓扑，动态资金、报价和模拟仍绑定每次固定区块；
- 事件遍历与旧的有界完整遍历拥有相同总循环数、相关循环数和 Top-K 排序；
- worker 为负且未被更新事件覆盖时，主循环不再重复同一轮只读 RPC；
- worker 为正时，必须由唯一 signer 在最新区块重新报价、估 Gas、查余额和 nonce、完整模拟后才可签名；
- worker 崩溃、超时、坏响应或超大输出只让该请求回退旧 Global child，不停止 Earn、看板或 Feed；
- 生产验收读取 worker PID/计数、服务重启、cgroup 内存、event→search、event→decision、nonce、未决交易和
  canonical receipt；没有回执不得记为新增收益。

## 非目标

- 不在本故事实现完整 V3 tick/V4 hook/Earn 动态状态镜像；
- 不承诺 Sequencer Feed 不可用时对 Uniswap-only 交易提供逐事件唤醒；这类覆盖仍由周期恢复承担；
- 不改变本金、Gas、最低净利润、失败 Gas、授权或执行合约；
- 不把候选、模拟或 worker 正值记作收益；
- 不扩大 ChainStack 日预算或服务器规格。
