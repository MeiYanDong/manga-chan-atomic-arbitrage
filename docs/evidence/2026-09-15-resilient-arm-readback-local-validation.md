# 双基资产授权只读重试验证

- 日期：2026-09-15（Asia/Shanghai）
- 生产基线：v0.16.12 / `229f3947fcbc8aa2fa0a68f43a7911be739ba83c`
- 证据等级：生产失败定位 + 本地候选版本验证；尚不是生产授权或成交证据

## 生产失败边界

v0.16.12 已完成不可变工件安装，`dual:runtime-verify` 返回 chain ID 4663、release SHA 和三份 runtime code
一致，wallet latest/pending nonce 为 `54/54`，USDG/WETH executor 余额分别为 `35.344393` 和 `0.0032`，且
`unresolvedMutation=null`。随后三次 `manga-dual-arm.service` 均在固定块 ERC20 `balanceOf` 返回
`header not found`；三次都在授权文件写入前失败，watcher 保持 disabled，未签名、未广播、未消耗 Gas。

## 候选版本边界

本次把完整只读基线放进已有 `retryReadOnly`，只允许 `isTransientRpcError` 分类通过后重试，最多五次。每次从
新的 wallet block 开始并重新读取全部部署和 principal；私钥加载移动到只读及经济约束之后。pending nonce、
零 principal 和业务不变量仍立即失败。

聚焦验证：

```bash
node --test \
  test/opportunity-board-isolation.test.mjs \
  test/event-driven-shadow.test.mjs \
  test/policy.test.mjs
```

结果：73 tests，73 passed，0 failed。完整门禁：

```bash
npm run check
```

结果：格式检查、JavaScript/Solidity/Shell lint、systemd 规则检查、类型检查、前端构建、Solidity 编译、
427 个单元测试、4 套确定性合约测试和敏感信息扫描全部通过；`secret:scan` 共检查 461 个文件。GitHub CI、
release 和生产重新授权在完成前不得由本文件宣称通过。
