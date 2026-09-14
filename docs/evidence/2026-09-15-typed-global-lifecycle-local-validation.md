# v0.16.7 强类型 Global 事件证据：本地验证

- 日期：2026-09-15
- 范围：ADR 0077 / PR-01
- 执行权限变化：无

## 失败反例

旧实现将 `quotePlan()` 的空结果与零/负结果统一标成 `NO_GROSS_PROFIT`，并在 `globalPreflight()` 的最终候选循环中
使用空 `catch {}`。因此一次 HTTP/RPC 故障可能被经营面板错误解释为市场没有利润。

## 新行为

- 只有解析成功的 signed quote 才能成为 `PROFITABLE` 或 `VALID_NON_PROFITABLE`；
- RPC、区块状态、执行器兼容性和策略门槛分别分类并保留受限原因样本；
- lifecycle 保存 eventId、sequence、观察/入队/出队、固定状态区块号与哈希、catalog/graph 版本和各阶段时间；
- 如果进入签名，mutation plan、签名、提交和回执继续使用同一个 eventId；
- RPC 证据只保存 purpose、client label、method 和计数，不保存 endpoint、params、calldata 或响应。

## 执行命令与结果

```text
npm run check
```

结果：

- Prettier：通过；
- ESLint、Solhint、shell syntax：通过；
- TypeScript checkJs：通过；
- UI production build：通过；
- Node tests：406/406 通过；
- deterministic contract suites：MANGA、Generic、WETH、Universal 全部通过；
- secret scan：439 个文件，通过；
- macOS 本机没有 `systemd-analyze`，Linux-only unit 验证明确跳过，必须由 GitHub Linux CI 补齐。

## 兼容性与回滚

原 `status`、`graph`、`workset`、`timing` 字段保留；新字段是附加证据。合约字节码、钱包、授权、资金、Gas、利润和
nonce 边界没有变化。回滚只需恢复上一不可变 release，不需要链上迁移。

## 尚未证明

本文件只证明本地确定性行为和门禁结果，不证明 GitHub CI、production release、服务器运行或实盘成交；这些必须在合并
和部署后分别读回。
