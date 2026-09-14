# ADR 0071：可恢复子进程时限与最少必要关键提醒

- 状态：Accepted
- 日期：2026-09-14
- 补充：ADR 0024、ADR 0055、ADR 0070

## 问题

生产 Global 子进程在一次 Sequencer 唤醒后超过 240 秒未返回。父进程发送 `SIGTERM`，但把自己的受控时限
识别成关键不变量失败并退出；systemd 的 `Restart=on-abnormal` 又不会恢复普通非零退出。一个没有未决交易的
资源故障因此停止了 Global、Earn 和基础双币三个通道。原有 `OnFailure` 只写 journal，没有外部提醒。

同时，套利系统的普通状态非常嘈杂。没有净利润、候选被 Gas 过滤和单次 RPC 波动都是正常经营结果，不能每分钟
通知用户。通知必须只表达真正丧失实盘能力或需要人工核对的状态。

## 决策

1. Earn 与 Global 实盘子进程使用共同的受界运行器。实盘时限固定为 60 秒，先发 `SIGTERM`，五秒后仍未退出才
   发 `SIGKILL`；reconcile 保留原有更长时限。
2. 子进程超过父进程设定的时限时产生结构化 `CHILD_PROCESS_DEADLINE_EXCEEDED`。父进程先读取未决 mutation：
   存在未决 mutation 仍进入 `HALTED_UNKNOWN`；没有未决 mutation才记录 `CHILD_TIMEOUT_NO_UNRESOLVED_MUTATION`
   并保持主进程运行。
3. Global 超时后重新开始最小间隔，主动把执行槽让给 Earn 和基础通道。连续三次同类通道故障才进入关键提醒，
   单次超时不提醒。
4. watcher 对临时 RPC 终止使用可重启退出码；UNKNOWN、关键不变量和 nonce 冲突使用专用不可自动重启退出码。
   systemd 使用 `Restart=on-failure`，并用 `RestartPreventExitStatus` 保留 fail-closed 边界。
5. 独立的一分钟健康检查只读取授权、撤销标记、运行状态和 PID，不读取私钥、RPC 或交易 raw。它只在以下状态
   转换时发送飞书：授权仍有效但进程死亡；UNKNOWN/invariant/nonce/启动校验终止；心跳超过三分钟；任一交易
   通道连续三次故障；以及上述故障后的首次恢复。
6. 无机会、利润不足、候选过滤、单次 RPC/子进程超时、扫描数量和普通日报均不触发关键提醒。同一故障状态只发
   一次；恢复只发一次。
7. 关键提醒使用独立的 host-bound systemd encrypted credential，不复用或覆盖经营日报 Webhook。凭据不进入 Git、
   环境文件、argv、日志或发布包。

## 不变边界

- 本决策不降低净利润、Gas、deadline、nonce、授权、receipt、余额或未决 mutation 门槛；
- 一个已签名或广播但未核对的交易不能因为子进程超时被当成可恢复；
- 通知器没有 signer、RPC、广播、撤销、重启或资金权限；
- systemd 自动重启只恢复明确的临时失败，不能恢复 UNKNOWN、nonce 冲突或关键不变量失败。

## 验收

1. 单元测试证明 deadline error 与普通子进程错误不同，并且不会包含子进程输出；
2. 单元测试证明普通 no-shot、一次 RPC/timeout 不提醒，连续故障和进程死亡提醒，恢复只提醒一次；
3. Linux `systemd-analyze verify` 通过，通知 unit 不包含私钥或 RPC 配置；
4. 生产部署前先 reconcile，要求无未决 mutation 且 latest/pending nonce 一致；
5. 飞书测试响应 code `0`，加密凭据权限为 root-only；
6. 生产 watcher 重新运行，状态、PID、授权、Feed、nonce 与服务重启策略读回一致。
