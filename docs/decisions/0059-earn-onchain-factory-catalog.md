# ADR 0059：Earn 实盘目录以链上 Factory 为准

- 状态：Accepted
- 日期：2026-09-14

## 背景

v0.13.0 已把四条 AI/MOO 固定路线升级成全 Omnipool 动态图，但启动仍依赖
`earnonhood.com/api/omni/pools`。生产服务器首次切换后，Cloudflare 对该数据中心 IP 返回 challenge 与 HTTP
403；唯一签名器按设计 fail closed，未签名、未广播，却也无法继续发现机会。

网页 API 适合展示名称、TVL 和美元估值，却不是协议状态的 source of truth。把它放在签名关键路径，会让前端
可用性决定链上执行可用性，也会在 API 漏池或滞后时重复制造机会盲区。

## 决策

1. 实盘目录直接调用官方 Omnipool Factory `getPools()`；Factory 地址、Vault 身份与字节码都属于授权边界。
2. 保留一个被官方应用持续列出、但早于当前 Factory 的历史池作为显式地址；任意其他 Vault 池不能仅凭一次
   `Swap` 事件进入可执行图。
3. 在同一个固定区块读取每个池的 `getWeightedPoolImmutableData()` 与
   `getWeightedPoolDynamicData()`：完整 token 集、固定权重、scaled-18 当前余额、费率、初始化、暂停和恢复状态
   都来自链上。
4. scaled-18 状态只供本地加权公式粗排。BatchRouter fixed-block exact quote、最终 call、Gas、nonce、余额、
   `minAmountOut` 与 receipt 仍是经济和成交证据。
5. Factory 是 permissionless。单个池无字节码、ABI 不兼容、权重不守恒、费率异常、暂停或 recovery 时只隔离
   该池；Factory/Vault 身份错误、目录超出已审核上限或最终候选身份错误仍整体 fail closed。
6. 授权升级为 v6，明确承诺链上目录来源、Factory、历史池集合、WETH 结算、最大四跳与既有两级报价上限。

## 结果

- Cloudflare、前端发布或网站 API 故障不再让签名器停机；
- 新 Factory 池无需代码更新即可被发现；
- 页面数据不能偷偷扩大实盘调用范围；
- 当前每轮需要额外链上只读调用，公共 RPC 压力会上升，但不会增加签名或失败 Gas；
- v5 授权不会静默获得新含义，生产必须撤销、reconcile、升级并生成新的 v6 授权。

## 非目标

- 本 ADR 不把任意 Balancer Vault 池自动视为 Earn 官方池；
- 不增加跨 Uniswap/Rialto/AUTO 的执行边；
- 不放宽净利润、Gas 偿付、钱包储备、最终模拟、nonce 或回执约束。
