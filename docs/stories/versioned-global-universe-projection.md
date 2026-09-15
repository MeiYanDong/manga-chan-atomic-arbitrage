# Story：发现层的新池立即进入 Global 有界搜索

## 用户结果

作为实盘经营者，我需要系统明确区分“市场里没有路线”和“有路线但通用执行器暂时没有可用资金”，并让发现层
已经核验的新池自动进入 Global，而不是在两个运行目录之间失联。

## 验收标准

- board 每次成功提交 source catalog 时，原子写入一个独立、版本化、无签名能力的 Global universe 投影；
- 投影不复制完整 source catalog，且目标、资产、池、拒绝样本和文件大小均有确定上限；
- 高优先级候选持续驻留，剩余有效候选按周期轮转，不能永久只覆盖排序最前的一批；
- 投影拓扑未变化时，时间戳或游标推进不改变 topology hash；新增入选池时 hash 必须变化；
- Global 与 board 通过 `/run/manga-opportunity-board-feed/global-universe.json` 交接，不依赖两个私有 state
  directory 恰好相同；
- 当前投影中的资产与 hook 自动进入有界 Sequencer Feed 监听集合，但仍只构成唤醒提示；
- read-only Global worker 可读取投影，但不能写 catalog、读取私钥、使用授权或调用 managed RPC；
- 缺失、过期、坏 JSON、坏 hash、越界或 PoolKey 不一致的投影 fail-closed，不污染基础图；
- 同一固定快照下，增量投影图与等价完整输入得到相同的入选 V4 pool IDs 和路线结果；
- 图构建用集合去重，不随边数做线性重复扫描；
- USDG/WETH 没有通用资金时仍报告可搜索路线数，并将结果标记为 `NO_EXECUTABLE_FUNDING`，不得写成
  `NO_EXACT_NET_OPPORTUNITY`；
- 公网经营 API 与面板分别展示可搜索路线和有资金可报价路线，资金页包含通用跨协议执行合约；
- 有资金的结算资产继续经过当前块 exact quote、Gas、最低净利润、余额、nonce、最终模拟和 receipt 门禁；
- shared authorization 固定新的 universe policy version，旧授权不能跨版本复用；
- focused tests、完整 `npm run check`、GitHub CI、不可变 release、受控撤权/部署/重验/重授权与生产读回全部
  有证据；没有 canonical receipt 不得声称新增收益。

## 非目标

- 本故事不转移或新增资金，不合并固定执行器与通用执行器的库存；
- 不新增 RPC 套餐、服务器或第三方服务；
- 不在本故事完成 V3 tick、V4 hook 或 Earn 动态状态的完整本地镜像；
- 不把搜索命中、screen、simulation 或对手交易记成我们的收益。
