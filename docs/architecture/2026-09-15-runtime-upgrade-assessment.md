# 2026-09-15 实盘架构升级评估

## 结论

`manga-chan-atomic-arbitrage` 与 `atomic-cycle-engine` 不是同一个程序。它们可以共享服务器、公开经营面板和
机会/收益数据协议，但不能共享一个隐式 signer 或 nonce 队列。

- MANGA 是 Robinhood Chain 的成熟实盘系统：统一调度 Earn、全局跨协议和既有 USDG/WETH 执行适配器，
  由一个钱包、一个授权和一个 nonce 域串行签名。
- Atomic Cycle 是跨链通用循环验证系统：Base 有独立小额实盘 canary，Robinhood/BNB 目前是只读或 shadow
  证据。它拥有不同的账户、合约和运行账本。
- “最优统一”是统一状态、图、候选、过滤原因、执行回执和经营 API；不是把不同链、不同钱包的私钥塞进
  同一进程，也不是把 shadow 结果说成 MANGA 实盘。

2026-09-15 的生产审计识别出两个独立项目系统、五个常驻应用服务、一个 Nginx 公网代理和两个 systemd
定时工作流。oneshot 报告/健康服务只在 timer 触发时运行，不应重复计为常驻程序。

## 参考架构与当前落点

目标数据流：

```text
链事件 / 区块 / 公共与托管 RPC
  -> 版本化 canonical state
  -> Token / Pool / Funding registry
  -> 统一流动性图 + DependencyToRoutes
  -> 事件局部搜索 + 周期恢复
  -> 便宜筛选 -> 精确求解 -> 最终同块模拟
  -> 统一风险与单 signer/nonce lane
  -> 原子执行器 -> 回执/余额/经营账本
```

已经实现并有测试门禁的部分：

1. 重叠 Sequencer Feed 帧逐消息去重，不丢新增尾部；
2. 待处理信号按池和资产依赖并集合并；
3. Earn 与 Global 使用保护周期恢复的公平调度，签名仍串行；
4. 报价失败、RPC 不可用、策略过滤、可执行净正和回执结果分型；
5. Earn、Uniswap v2/v3/v4 进入统一资产图，支持同平台与跨平台 2–4 池循环和 Earn BPT 超边；
6. 动态结算资产必须有库存或闪电流动性以及可验证退出估值；
7. 未知交易只暂停共享钱包的新签名，其他市场观察和异步对账继续；
8. Solidity 编译移出实盘进程，运行时只验证构建期工件；
9. v0.16.10/v0.16.11 将安全审计读取改为增量缓存，并兼容流式跳过唯一已知的旧版超大诊断行；
10. 本次候选版本修复高频 Feed 信号合并的指数级字符串回流，并在网络解码前增加 8 MiB 帧上限。

本次 P1 增量已经实现并有本地差分测试、但尚待生产 release 读回的部分：

1. Global Feed 事件可立即进入常驻、credential-stripped 的只读 worker，与串行 Earn/signer 调度并行；
2. catalog identity 相同时复用 canonical topology graph，动态状态仍逐请求固定区块读取；
3. 事件循环遍历保持完整有界计数和旧排序，但只物化依赖相关 Top-8；正值仍回到唯一 signer 完整重验；
4. worker 崩溃、超时、坏响应或超大输出只回退该信号到旧 Global child。
5. signer-free board 将完整 source catalog 压缩成权限、大小、PoolKey、hash 和新鲜度均受控的 Global universe
   投影；优先候选持续驻留，长尾候选轮转进入统一图与 Feed 监听集合；
6. 搜索拓扑与原子资金准入已经解耦，经营 API 能区分可搜索路线、可供资路线、证据不完整和完整报价无利润；
7. 通用跨协议执行器已经纳入资金面板，但没有自动把固定执行器库存转入通用执行器。

仍未完成、不得宣称已经生效的目标：

1. 所有协议的完整池动态状态仍未成为一个独立、版本化、可重放的 canonical state 服务；
2. V3 ticks、V4 hook 状态和所有 Earn 动态量还没有完整增量镜像，部分精确真值仍按候选临时读取；
3. 常驻 worker 仍属于 signer service 的受限 child；图维护、粗筛、精确求解和 signer 尚未全部拆为独立
   OS 身份与可独立扩缩容的服务；
4. Feed 到提交的阿里云生产路径仍受官方 Sequencer Feed 的 403/限流约束，不能把本地握手成功当生产成功；
5. BNB、Base 与 Robinhood 的统一 schema 已有读模型，但跨链资金和签名仍是独立执行域；
6. 没有回执的候选、竞争者成交或 shadow 正值都不能计入自身收益。
7. 当前 universe 仍是有界轮转投影，不是所有约九万池动态状态同时常驻内存；完整状态镜像仍未实现。

## 本次最小最优改良

本次不做事故中的全仓重构。优先修复会让实盘根本无法持续运行或无法看到 Earn 状态的边界：

1. 让原子原因列表成为待执行信号的唯一真源，禁止派生展示字符串再次进入合并；
2. 对原因数量、单项长度、依赖集合和 Feed frame 在分配前设置硬上限；
3. 超大或畸形 Feed 只降级该事件入口，公共日志和周期恢复继续；
4. 把外部 RPC 失败投影为短的业务原因，详细诊断保持有界且不进入经营主视图；
5. 部署时必须 disarm、对账、runtime verify、重新 arm；
6. 生产浸泡同时核对 RSS/heap、服务状态、Feed、RPC 用量、nonce、余额和未决交易；
7. 只有 exact-positive 才可能签名，只有回执与余额净增加才记实盘收益。

## 后续优先级

- P1：把 canonical pool state 和 DependencyToRoutes 做成常驻增量服务，消除每个 child 的目录/图重建；
- P1：提供固定区块事件重放和 solver 等价性测试，再拆求解 worker；
- P2：按链建立独立 signer gateway，统一上层候选 schema，不共享 nonce；
- P2：给 dashboard 增加各阶段延迟、过滤归因、RPC 成本和回执漏斗，不展示私钥、RPC URL 或原生噪声字段；
- P3：只有实盘回执证明新增系统长期净正后，才扩大托管 RPC 日预算或机器规格。
