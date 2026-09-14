# Story：候选在签名前失效后继续观察

## Outcome

作为实盘经营者，我希望一个候选因 Gas 或报价在签名前变差时只放弃这一笔，而不是让无限运行的 watcher 永久停机。

## Acceptance criteria

- 最新费率超过预检保护上限时不签名、不广播、不记失败 Gas；
- 最新报价低于保护输出下限时不签名、不广播、不记失败 Gas；
- 两种结果都记录为 `CANDIDATE_REJECTED_EXACT` 并继续 watcher；
- generic exact-profit miss 继续沿用相同语义；
- receipt/balance effect 冲突和 executor identity 错误不能被降级为机会消失；
- unresolved mutation 优先进入共享签名域隔离和异步核账，不会被 no-shot 分类覆盖，也不会停止无签名扫描。

## Non-goals

- 不放宽费率、报价、Gas、净利润、余额、nonce 或授权门槛；
- 不自动重启真正的 invariant；
- 不新增交易次数、资金或 RPC 配额。
