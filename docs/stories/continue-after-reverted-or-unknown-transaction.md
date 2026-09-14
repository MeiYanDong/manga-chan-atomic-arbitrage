# Story：一笔交易异常时继续经营

## Outcome

作为实盘经营者，我希望一次已知回滚只支付并记录该笔 Gas，其他路线继续竞争；一笔结果暂时未知时，系统自行
核账而不是整套退出，同时绝不冒险复用同一钱包 nonce。

## Acceptance criteria

- 已确认回滚终结 mutation、累计失败 Gas 和 nonce consumption；
- 失败-Gas与长期正收益熔断器未触发时，父 watcher 保持运行；
- 未决 mutation 只暂停共享钱包签名，市场看板、Earn 事件和 Sequencer Feed 继续观察；
- Earn、Global、USDG 和 WETH 使用各自 reconciler，但共享一个钱包级签名隔离状态；
- 后台核账成功或确认回滚后自动恢复，不要求人工重启；
- 长时间不能核对才发一次中文关键提醒，且明确用户是否需要操作；
- 日报不展示协议内部分类、原生状态码、哈希、nonce、授权或 RPC 字段。

## Non-goals

- 不允许多个进程同时签同一钱包；
- 不在 UNKNOWN 期间执行另一条路线；
- 不降低净利润、Gas、余额、合约身份、授权或 receipt 证明门槛；
- 不把回滚或未知结果记录为收益。
