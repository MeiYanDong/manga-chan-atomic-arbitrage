# EarnOnHood 机制、套利边界与主网实盘验证

- 调研日期：2026-09-12（Asia/Shanghai）
- 链：Robinhood Chain mainnet，chain ID `4663`
- 结论：**存在可成交的原子多池套利；已用一笔主网交易证明扣除 Gas 后净盈利。**
- 证据边界：一笔收据证明机制可行，不证明机会持续、胜率稳定或可安全扩大本金。

## 1. 实盘结果

交易：[`0x27ed…a2028`](https://robinhoodchain.blockscout.com/tx/0x27ed9bab2e6d78b82a1b0790de6c33c44359f7134d86f03d71936b61ed1a2028)

| 项目       | 主网事实                                                            |
| ---------- | ------------------------------------------------------------------- |
| 区块       | `60487738`                                                          |
| 发起钱包   | `0x77f771E83f118C32547A1291dda438a757B4b91B`                        |
| 调用目标   | EarnOnHood BatchRouter `0x2d6DD5A990a643A8B11CD06554FBC290a1a82bA6` |
| 路径       | `WETH -> MOO -> AI -> WETH`                                         |
| 输入       | `0.002 ETH`                                                         |
| 最终输出   | `0.002179331899163194 ETH`                                          |
| 毛利润     | `0.000179331899163194 ETH`                                          |
| Gas        | `441654 × 107468000 wei = 0.000047463672072 ETH`                    |
| 钱包净利润 | **`0.000131868227091194 ETH`**                                      |
| 钱包余额   | `0.00262778655474 -> 0.002759654781831194 ETH`                      |

按执行前扫描器采用的 `2540.17402427 USD/WETH` 参考价，毛利润约 `$0.455534`，Gas 约 `$0.120566`，净利润约
`$0.334968`。美元值只是同一时点的估值；ETH 数量、收据和余额差才是结算事实。

收据中的三次 Vault Swap 为：

1. `0.002 WETH -> 156.253734801449611363 MOO`；
2. `156.253734801449611363 MOO -> 17.791182423823270744 AI`；
3. `17.791182423823270744 AI -> 0.002179331899163194 WETH`。

BatchRouter 使用 `wethIsEth=true`，因此钱包直接支付原生 ETH，Router 在同一交易内包装为 WETH，并在最后解包
回 ETH；没有留下 MOO/AI 中间仓位，也不需要 ERC-20 授权。Balancer v3 的
[`IBatchRouter`](https://github.com/balancer/balancer-v3-monorepo/blob/main/pkg/interfaces/contracts/vault/IBatchRouter.sol)
和
[`BatchRouter`](https://github.com/balancer/balancer-v3-monorepo/blob/main/pkg/vault/contracts/BatchRouter.sol)
定义了这条结算语义。

## 2. 项目到底是什么

[EarnOnHood 官方文档](https://earnonhood.com/docs)描述的是 Robinhood Chain 上的流动性协议，不是单一套利
产品。当前可以拆成三层：

1. **Omnipools**：2～8 个资产的加权 AMM。池创建者选择资产、权重和初始数量；初始数量直接形成价格，
   没有外部预言机替它校准。
2. **Automated Vaults**：把资金放进集中流动性头寸，由
   [Steer](https://docs.steer.finance/)管理区间，并可叠加
   [Merkl](https://docs.merkl.xyz/)激励。这是 LP 收益产品，不等于套利器。
3. **EARN staking**：质押 EARN 获取协议激励，是另一套收益与代币风险。

本次机会只来自第一层 Omnipools。Vault 和 staking 的 APR、奖励或 TVL 均没有被当成套利利润。

## 3. 套利的第一性原理

加权池的不变量可写为：

```text
V = ∏ Bᵢ^Wᵢ
spot(in/out) = (Bᵢ/Wᵢ) / (Bₒ/Wₒ)
out ≈ Bₒ × [1 - (Bᵢ / (Bᵢ + in × (1-fee)))^(Wᵢ/Wₒ)]
```

这与 [Balancer 加权池白皮书](https://docs.balancer.fi/whitepaper.pdf)及
[WeightedPool 实现](https://github.com/balancer/balancer-v3-monorepo/blob/main/pkg/pool-weighted/contracts/WeightedPool.sol)
一致。由于不同池的创建者分别设置权重和初始余额，同一资产在多个池里的隐含相对价格会不一致。只要一个闭环
的最终输出大于：

```text
本金 + 全部池费 + 滑点 + 最大 Gas 成本 + 最低净利润
```

就形成可执行候选。套利者把不同池的价格重新拉近，利润实质上来自旧价格一侧 LP 的价值转移，而不是平台额外
补贴。

本次三跳每一池静态费率均为 `0.30%`，只算乘法费损已约 `0.897%`，随后还要扣滑点和 Gas。原子交易消除了
中间币库存风险，但不消除失败 Gas、别人抢先改变状态、排序、RPC、合约、代币、管理员和私钥风险。因此它是
**有严格下限保护的原子套利，不是数学意义的无风险套利**。

[Robinhood Chain 文档](https://docs.robinhood.com/chain/)说明其排序采用 FCFS sequencer；这使状态发现和提交
延迟比单纯提高 tip 更关键，也不代表发送者一定赢得排序。

## 4. 池子与数据质量

一次固定区块审计得到：

| 层级                           | 观察结果                                                      | 可否直接作为可执行证据 |
| ------------------------------ | ------------------------------------------------------------- | ---------------------- |
| Omnipool API                   | 29 个池；18 个 TVL 不低于 `$25`；约 `$161.7k` TVL             | 否，只用于发现和粗排   |
| 链上 Vault 核验                | 18 个候选均完成 initialized、paused、recovery、token-set 核对 | 是，身份边界           |
| 路径枚举                       | WETH/USDG、2～4 跳共 1,236 个路径签名，10,816 个金额候选      | 否，仍是搜索空间       |
| BatchRouter 固定区块查询       | 对粗排后的候选做 exact quote                                  | 是，报价证据           |
| 最终交易级 call + Gas estimate | 重新验证最小输出、Gas、余额、nonce                            | 是，签名前证据         |
| 主网 receipt + 余额差          | 本次交易成功且净余额增加                                      | 是，最终收益证据       |

API 中多数 USD 估值来自池内隐含价格；小池能产生荒谬的 TVL/收益错觉。因此研究器默认排除 TVL 小于 `$25`
的池，并且任何近似数学结果都必须升级成同一区块的 BatchRouter exact quote。API 的 network-volume 接口在调研
时返回不可用，另一个 liquidity overview 的计算时间停在 `2026-08-27`，均未被用来证明当前交易量。

Automated Vaults 当时约 15 个、合计约 `$315.2k`；协议页面的更大总值包含约 `$983k` 的质押 EARN，不能与
可用于交换的 Omnipool 深度相加。公开 APR 接口也没有给出可核验的实时收益，因此不对 Vault 年化作收益承诺。

## 5. 机会不是常数

同一批池在几个观察区块内发生了方向翻转：

- 区块 `60465208`：`WETH -> CASHCAT -> AI -> MOO -> WETH` 的 `0.002 WETH` 路径在 Gas 缓冲后仍为正；
- 区块 `60484049`：同方向 `0.0005 WETH` 已变成毛亏，保护性预检返回 `NO_SHOT`，没有签名、广播或 Gas；
- 区块 `60484244` 后：反方向 `WETH -> MOO -> AI -> WETH` 转正；
- 区块 `60487047`：`0.002 WETH` 通过最终保护门；
- 区块 `60487738`：主网成交，实际输出优于早先报价并实现净利润。
- 区块 `60494886`：执行后的全池扫描虽找到多条毛收益为正的路径，但 12 条最高毛收益 WETH 样本中仅一条在
  缓冲 Gas 后仍为正；该 `WETH -> MOO -> WETH` 样本预期只剩 `0.000005343462727825 ETH`，低于本策略的
  最低净收益和余量门，不应再次实盘。

这说明核心机会是**短时、薄深度、会换方向的状态不一致**。手工发现后再操作太慢；一次成功也不足以推断每小时
频率、胜率、容量上限或月收益。

## 6. 本次执行保护

执行器只支持两个写死资产/池身份的三跳方向，默认金额为 `0.0005/0.001/0.0015/0.002 ETH`。每次预检都会：

- 核对 chain ID、Vault、BatchRouter、WETH、池 bytecode、池 token 集、初始化/暂停/恢复状态和 `0.30%` 费率；
- 在一个固定区块精确报价，估算最终交易 Gas；
- 给 Gas limit 加 `15%`、Gas 单价加 `5%`；
- 把 `本金 + 最大 Gas + 0.00002 ETH 最低净利润` 写入链上 `minAmountOut`；
- 额外要求报价仍有 `0.00001 ETH` 余量、单笔失败 Gas 上限 `0.00012 ETH`、钱包至少保留
  `0.00025 ETH`；
- 签名前重新读取最新区块的报价、deadline、Gas、余额和 latest/pending nonce；
- 与现有 dual watcher 共用钱包锁，watcher 仍运行时拒绝执行；
- 先持久化 mutation plan 和已签原始交易，再广播；最后等待收据并核对余额变化。

`EARN_LIVE_ARM=1` 只对一次命令生效，不保存在配置中。发现程序默认使用官方公共 RPC；只有最终精确预检和广播
才使用受控执行 RPC。

## 7. 合约与信任边界

在固定区块 `60489987` 的链上读回中：

- Vault 未暂停，query 未禁用；BatchRouter 的 Vault/WETH 依赖与官方文档地址一致；
- 三个成交池均已初始化、未暂停、未进入 recovery mode，静态 swap fee 均为 `0.30%`；
- 协议 swap fee 比例为池费收入的 `10%`，没有改变交易者面对的 `0.30%` 总池费；
- 三个池的专属 pause/swap-fee/creator 角色均为零地址，但协议 Authorizer/治理仍是管理员风险。

Balancer v3 上游仓库公开了代码、审计材料和
[安全政策](https://github.com/balancer/balancer-v3-monorepo/blob/main/SECURITY.md)，但本次没有取得 EarnOnHood
部署字节码与某个已审计源码版本的一一对应证明；Sourcify 也未给出 full/partial match。因此“EarnOnHood 当前
部署已独立审计”保持 **UNKNOWN**，不能由它使用类似 Balancer 的接口倒推出结论。

## 8. 产品化判断与下一阶段

当前最合理的生产形态不是另起一个并行签名机器人，而是把 Earn Omnipool 做成现有架构中的一个来源适配器：

```text
公共 RPC / Earn API 发现
  -> 链上身份、余额、权重和事件核验
  -> 加权公式低成本粗排
  -> BatchRouter 固定区块 exact quote
  -> 近可执行候选才使用付费 RPC
  -> 唯一 signer/nonce lane 最终预检与原子成交
  -> receipt / Swap logs / 余额差记账
```

在扩大本金或 ChainStack 配额前，应连续收集至少 7～14 天：有效事件数、exact-positive 数、`SHOT_READY` 数、
签名/确认/竞争失败/回滚数、按路径统计的毛利润/Gas/净利润，以及机会生命周期 p50/p95。只有收据净利润覆盖
失败 Gas 与 RPC 增量成本后，才逐级增加单笔上限。

## 9. 可复现命令

```bash
npm ci --no-audit --no-fund
npm run check

# 只读全池发现；默认官方公共 RPC
npm run earnonhood:research

# 使用策略专用执行 RPC，只做最终精确预检，不签名、不广播
MANGA_CONFIG_FILE=/path/to/live.env npm run earnonhood:preflight

# 有状态操作：必须先停用共享钱包的其他 watcher，并仅为本次命令显式 arm
EARN_LIVE_ARM=1 MANGA_CONFIG_FILE=/path/to/live.env npm run earnonhood:execute
```

运行状态、私钥、RPC 凭证、已签原始交易和私有审计账本都不进入 Git。
