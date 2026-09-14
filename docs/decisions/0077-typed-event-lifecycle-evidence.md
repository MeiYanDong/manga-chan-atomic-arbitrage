# ADR 0077：强类型机会结果与端到端事件证据

- 状态：Accepted
- 日期：2026-09-15
- 补充：ADR 0067、ADR 0075、ADR 0076

## 问题

Global 路线原先把合约报价返回空值、零值、负值和 RPC/区块状态错误压成同一个
`NO_GROSS_PROFIT`，最终精确评估还使用空 `catch {}`。因此 `NO_EXACT_NET_OPPORTUNITY` 既可能表示有效报价没有净利润，
也可能表示报价根本没有完成。面板和经营归因无法区分市场结论与基础设施故障。

事件证据也只保存源时间和总耗时，缺少同一事件从观察、排队、状态固定、建图、搜路、报价、模拟到签名、提交、回执的
共同标识。即使后来找到失败记录，也无法可靠回答机会在哪一阶段消失。

## 决策

1. 报价与精确评估使用六种互斥结果：`PROFITABLE`、`VALID_NON_PROFITABLE`、`RPC_ERROR`、
   `STATE_UNAVAILABLE`、`UNSUPPORTED`、`POLICY_FILTERED`。只有解析出的有符号报价可以成为前两种经济证据。
2. 继续保留兼容状态 `NO_EXACT_NET_OPPORTUNITY`，但必须同时发布 `decisionClassification` 和
   `evidenceCoverage`。RPC 或区块状态不可用时不得展示为“市场没有利润”。
3. 每个 Feed 范围或周期恢复任务生成一个 `eventId`，保留 source sequence、观察/入队/出队时间、固定状态区块号与哈希、
   catalog/graph 版本以及阶段时间线。事件只公开依赖数量，不公开完整可复制路线。
4. 在 Viem transport 外层用 `AsyncLocalStorage` 记录逻辑 RPC 次数，按用途、客户端和方法汇总；不保留 endpoint、params、
   calldata 或响应正文。
5. 计划构建、结算资产准入、粗报价、细化报价和最终模拟中的异常全部转为可聚合证据；禁止精确循环中的空 catch。
6. 最终 quote、模拟、余额基线、签名、提交和回执沿用同一个 lifecycle。交易计划持久化 eventId、状态区块和图版本，便于
   回执反查。

## 不变边界

- 不改变钱包、合约、私钥、授权 ID、本金、Gas 上限、利润底线、闪电贷或库存资金规则；
- 不因新标签增加签名、广播、重试或 RPC 配额；
- Feed 仍只是唤醒提示，签名前仍使用最新区块重新报价、模拟、核对 nonce、余额与最低净利润；
- `PROFITABLE` 是成交前证据，只有 canonical success receipt 与余额差额能证明实际收益。

## 验收

1. RPC 失败和 state-not-ready 不能进入 valid/no-profit 计数；
2. 空、零、负与正的解析报价有确定分类，策略或执行器拒绝单独计数；
3. `[100, 101]` 合并事件能在同一 eventId 下看到观察、排队、状态、建图、搜路、报价和决定阶段；
4. 若进入实盘，后续签名、提交、回执继续使用同一 eventId；
5. 每个精确 catch 都留下类型、阶段和受限原因样本；
6. RPC 遥测只包含用途、client label、method 和计数，秘密扫描与公开面板测试通过。

## 回滚

回滚应用 release 即可恢复旧版读写格式；合约、授权文件和链上状态没有迁移。新版字段为附加字段，旧消费者仍可读取原
`status`、`graph`、`workset` 与 `timing`。
