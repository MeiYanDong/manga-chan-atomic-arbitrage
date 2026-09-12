# Story：繁忙看板期间仍生成可信经营快照

## Outcome

作为经营面板用户，我希望一次短暂的本机看板繁忙不会让市场状态连续五分钟显示未知，同时真正的持续故障仍能
清楚失败关闭。

## Acceptance criteria

- 经营报表只读取 loopback 看板，不新增外部 RPC、credential 或交易能力；
- 首次读取成功时只发一个请求；
- timeout、HTTP 失败或 JSON 失败最多重试一次；
- 第二次成功时使用当前响应生成快照；
- 两次都失败时返回 null，市场状态继续为 `UNKNOWN`；
- 非 loopback URL 在调用 transport 前被拒绝；
- 两次读取与等待的最坏时长低于 oneshot 的 45 秒系统上限。

## Non-goals

- 不掩盖持续的看板故障；
- 不把旧市场值标成当前值；
- 不提高候选扫描频率、付费 RPC 配额或执行资金。
