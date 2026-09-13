# 2026-09-14 全局跨协议版本本地验证

## 范围

- `UniversalAtomicExecutor` typed-only 合约、编译与确定性执行测试；
- Earn/Uniswap v2/v3/v4 统一图、路径计划、结算资产和 Sequencer 传输；
- 单一签名/nonce 账本、崩溃恢复、经营报表与前端构建；
- Robinhood Chain 主网只读目录和组合规模。

## 可复现命令与结果

```text
npm run check
```

结果：格式、JavaScript/Solidity/shell lint、类型检查、UI build、合约编译、323 项 Node 测试、四组合约确定性
测试和 368 文件 secret scan 全部通过。本机没有 Linux `systemd-analyze`，对应检查按脚本明确跳过，必须在生产
主机安装前补做，不能记作已通过。

合约产物：

- source hash: `0x2e1f51523f8630b6f47e39ad7bd916e0de91b0870b238b4b3d545b0233ec912e`
- creation hash: `0x299d1d534006ee59708c977a576d8820cbc6fdc8b2dac3b4697c152d067e91be`
- runtime hash: `0x0fda9e64a37fdddea86e1eb3a2fed7f3c70dde0f624e3cef4a3e268229450790`
- runtime size: 15,891 bytes

## 主网只读目录结果

在 Robinhood Chain 区块 `62274752`，同一固定区块读取到：

- 31 个 Earn 池；
- 29 个 Uniswap v2 池；
- 184 个 Factory 已创建的 Uniswap v3 池，其中 113 个有当前 active liquidity，71 个空池被隔离；
- 5 个本地审核引导 Uniswap v4 池。

Factory 存在不再等于可执行边：V2 还必须两侧储备非零，V3 必须当前 active liquidity 非零。固定区块
`eth_call` 还确认 EARN 代币拒绝把 canonical Permit2 设为 spender，因此只禁用以 EARN 为 Earn Router 输入的边
和包含 EARN 的加池超边；Uniswap 直转、Earn 输出和拆池能力继续保留。这些记录证明发现范围和调用边界，
不证明任一路径扣除 Gas 后可成交。

## 真实协议主网 fork

公共 RPC 的重型历史状态回源超过五分钟后被安全终止；随后把既有受控 RPC 仅放进本机进程环境，未落盘或
输出。区块 `62288204` 的固定四调用门禁返回 `UNIVERSAL_MAINNET_FORK_TEST_PASSED`，临时 fork 部署地址
`0xCBBe2A5c3A22BE749D5DDF24e9534f98951983e2`，只存在于本地链：

- USDG 与 WETH 各自完成一次 `V4 买 BPT -> Earn 拆池 -> V3/V4 组件卖出`；
- USDG 与 WETH 各自完成一次 `V3 换币 -> ETHUSD Earn 加池 -> Earn 拆池 -> V3 换回`；
- 四条 quote delta 分别为 `-1007931` USDG wei、`-1006` USDG wei、`-99260501872488` WETH wei、
  `-101235270612` WETH wei，均为当前负毛利，不能广播；
- fork 过程没有加载生产签名密钥，没有主网交易、nonce 变化或 Gas 支出。

这证明真实 Morpho、Earn Router/Vault、Uniswap v3/v4 的 typed 组合调用已经闭环；仍须让不可变发布产物在
Linux 生产机完成一次同版本 fork 与 `systemd-analyze verify`，才能部署执行器和生成 v7 实盘授权。
