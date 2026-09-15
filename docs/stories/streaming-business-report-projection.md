# Story：账本持续增长时经营面板仍能刷新

## Outcome

作为实盘经营者，我希望审计账本持续增长时，经营 API、每日收益与飞书日报仍能在独立的小内存服务中生成，
同时历史证据不被删除、缩水或误算。

## Acceptance criteria

- 完整账本只读、原样保留，不做截断、重写或迁移后删除；
- 报告按块扫描 JSONL，不能对交易审计账本调用整文件读取；
- 只保留失败 Gas、最新余额核验、当前授权 Global 漏斗、确认 Earn 收益和完成归集所需字段；
- 旧授权 Global 记录和大体积无关诊断不得进入报告常驻对象；
- 已选择的损坏记录或超限安全记录继续失败关闭；
- 与生产历史同量级的 legacy wake 回归样本可被流式跳过，并保留其后的安全记录；
- `buildBusinessSnapshot` 的收益、Gas、活动与脱敏断言保持通过；
- 生产 `manga-business-report.service` 在原 128 MiB 上限内成功，生成时间更新后才恢复 timer/path；
- 修复不得读取 signer credential、签名、广播、改变授权、资金或利润门槛。

## Non-goals

- 不把经营报告升级为交易数据库；
- 不删除、压缩或轮转 canonical ledger；
- 不因面板故障停止健康的交易路线；
- 不把无 canonical receipt 的候选或模拟记为收益。
