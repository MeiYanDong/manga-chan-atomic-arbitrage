# ADR 0075：Feed 逐消息去重与待处理依赖并集

- 状态：Accepted
- 日期：2026-09-15
- 补充：ADR 0065、ADR 0067、ADR 0074

## 问题

共享 Sequencer Feed 已能把同一帧同时路由给 Earn 与 Global，但接收和排队仍有两个确定性漏失边界。

第一，旧接收器按帧的第一条 sequence number 去重。已处理到 `100` 后收到重叠帧 `[100, 101]` 时，整帧被
丢弃，尚未见过的 `101` 也不会触发任何路线。第二，supervisor 只有一个 `pendingEarnSignal` 和一个
`pendingGlobalSignal`；A 池事件尚未调度时若 B 池事件到达，后者会覆盖前者，A 对应的局部闭环不会进入本轮报价。

这两处都发生在报价之前，因此最终模拟和利润门槛无法补救。Feed 当前只是低延迟提示，公开日志与周期恢复仍是
完整性兜底；修复不能把 Feed 当成可签名状态，也不能因为 sequence gap 停止其他发现路线。

## 决策

1. 每条 Feed message 都必须有合法的非负 sequence number。frame 只负责传输，不再作为去重单位。
2. 以已消费的最高 sequence number 为高水位，只删除不大于高水位或同帧重复的 message。重叠帧中的新尾部继续
   参与地址匹配和唤醒；完全重复的帧不唤醒。
3. 内部 sequence 使用 `BigInt`，对外在安全整数范围内保持 number，超出后使用十进制字符串，避免静默精度损失。
4. 合法 frame、重复 frame/message、重叠 frame、gap 和乱序分别计数。gap 触发
   `SEQUENCE_GAP_RECOVERABLE` 状态证据，但继续处理已收到的新 message，并依赖公开日志和周期扫描补洞。
5. Earn 与 Global 的待处理 Feed 信号都按 pool、asset、matched address 做集合并集；sequence 范围取最小与最大值，
   延迟计时保留最早事件时间，另记最后到达时间。公开 Earn 日志与 Feed 同时排队时也合并全部事件池。
6. coalescing 只减少重复启动，不得减少依赖集合。每次子进程收到的是该调度窗口内已知的完整局部工作集。

## 不变边界

- Feed 仍不能替代规范 RPC 区块、固定块精确报价、合约身份、余额、Gas、授权、nonce、模拟或回执；
- 不改变钱包、合约、授权 ID、资金规模、利润底线、Gas 熔断器或广播路径；
- sequence gap 不证明丢失了可盈利交易，完全重复也不证明没有机会；两者只是传输层证据；
- 所有协议继续共享一个 signer/nonce 域，未知交易仍只冻结该签名域，不停止只读发现。

## 验收

1. `[100, 101]` 在高水位 `100` 时只用 `101` 匹配地址并唤醒；随后重放 `101` 不再次唤醒；
2. 非法 sequence 作为 malformed frame 失败关闭，超大整数不丢精度；
3. gap 与乱序有明确指标，同时不授予执行权限；
4. A、B 两个连续 Feed 信号的池和资产全部传给 Earn/Global 子流程；Feed 与公开日志也不会相互覆盖；
5. 聚焦测试、全量本地门禁、GitHub Linux 门禁、不可变 release 和生产进程/授权/回执读回全部通过后才恢复实盘。
