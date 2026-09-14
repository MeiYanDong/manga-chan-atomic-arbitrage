# Earn 竞态收敛与关键告警生产发布证据

- 发布日期：2026-09-15（Asia/Shanghai）
- 生产版本：`v0.16.4`
- 不可变提交：`2de1d45f50621695a79731ff57696462842544b2`
- 结论：共享 supervisor、Earn 局部竞态收敛和关键告警 V3 已部署。生产事件证明 Global 单路线超时不会阻塞
  Earn，也不会误发停机提醒；v0.16.4 已取得第一笔 canonical 正收益 receipt。但公共 Sequencer Feed 当前对该
  服务器返回 HTTP 403，因此 Feed 低延迟唤醒仍是 `DEGRADED`，公共链上事件补位保持运行。

## 目标与发布边界

SWAS 实时清单按实例 ID 唯一解析目标：

```text
profile       default
region        us-west-1
endpoint      swas.us-west-1.aliyuncs.com
instance      cbe793c9cb9241ce97752334f65cab48
name          manga-chan-arb-us-west
public IP     47.251.185.146
```

控制面为 `Running / Normal`，Cloud Assistant 可用。`intl` profile 没有可用 OAuth 凭据，因此全账号 inventory
coverage 为 `partial`；上述生产实例仍由精确 instance ID、region、endpoint、名称和公网 IP 唯一确认。

本次没有改变钱包、私钥、RPC credential、Webhook、执行器合约、资金、授权 ID、利润门槛、失败 Gas 熔断或
nonce 基线。共享主机上的独立 `atomic-cycle-live.service` 不在变更范围。

## 合并、门禁与不可变发布包

- Pull request：<https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/pull/173>
- 合并提交：`2de1d45f50621695a79731ff57696462842544b2`
- PR CI：<https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/actions/runs/34888963208>，`success`
- release CI：<https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/actions/runs/34889259212>，`success`
- GitHub release：<https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/releases/tag/v0.16.4>
- 发布包 SHA-256：`026b08aaf6009b840fe92c70294cb80d62cf742d2a687372c24d0fd9e16fe759`

发布代码合并前的本地完整 `npm run check` 通过：386/386 Node tests、4/4 deterministic contract suites、格式、
lint、类型、UI build、合约编译和 419-file secret scan 均通过。加入本生产证据后再次运行同一完整门禁，结果仍为
386/386、4/4，并完成 420-file secret scan。macOS 不提供 `systemd-analyze`；Linux CI 与生产安装器完成相应
unit/release 验证。

## 受控安装与恢复

发布前读回 invocation `t-usw6x2m22aidp1c` 确认：旧 release 为 `4d8ad3cb…ac462`、watcher/board/Base
均 active、`NRestarts=0`、授权为 `ARMED / UNTIL_REVOKED`，且 `latestUnresolvedMutation=null`。

首次安装 invocation `t-usw6x2majusq3gg` 在任何安装动作前失败：Cloud Assistant 默认 `/bin/sh` 不支持
`set -o pipefail`。没有停止服务、写入 release 或切换 symlink。修正为 POSIX shell 后：

1. `t-usw6x2mceb3h6gw` 停止关键告警 timer 与 watcher，确认 `STOPPED_BY_SIGNAL`、无未决交易，重新校验发布包
   SHA-256，完成构建、编译、secret scan 和原子 symlink 切换；
2. `t-usw6x2mhdu7r9j4` 重启 board、competitor census 与 watcher，待 Node child PID 和手动健康检查通过后恢复
   critical timer；
3. `t-usw6x2mn49h6igw` 完成链 ID、wallet latest/pending nonce、executor 余额、授权、无未决交易和 signer-free
   board 读回；
4. `t-usw6x2n8451joxs` 与 `t-usw6x2neuyu73ls` 在持续运行后重新读取服务、API、审计账本和关键告警状态；
5. `t-usw6x2o22j6g3y8` 对 v0.16.4 第一笔成功交易完成 plan、签名、Sequencer 接受、receipt、Gas、余额变化和
   服务连续性读回。

一次后置只读探针 `t-usw6x2n2ux2y6m8` 因操作者将 `CommandContent` 重复 Base64 编码而以 exit 127 结束；它只
尝试执行不存在的文本命令，没有读取 credential、改变服务或链上状态。后续读回使用 CLI 的原生编码流程成功。

## 生产运行读回

2026-09-15 04:06 CST 的服务读回如下；04:15 的再次读回保持相同 PID 与零重启：

| 对象                     | 版本或 PID                             | 状态           | 重启   |
| ------------------------ | -------------------------------------- | -------------- | ------ |
| `current` symlink        | `2de1d45f…544b2`                       | package 0.16.4 | 不适用 |
| MANGA watcher            | systemd PID `54081` / Node PID `54111` | active/running | 0      |
| opportunity board        | PID `54051`                            | active/running | 0      |
| competitor census        | PID `54077`                            | active/running | 0      |
| Base `atomic-cycle-live` | PID `783`                              | active/running | 0      |
| critical/report timers   | 不适用                                 | active         | 不适用 |

公网 `/healthz` 返回 `HEALTHY`：runtime 与 persisted snapshot 均为 `RUNNING`，SQLite integrity 为
`HEALTHY`、parity 为 `true`。`/api/v1/system` 返回精确 release SHA，board 明确为 signer-free。
`dual-watch-state.json` 为 `RUNNING`，授权 ID 未变。04:15 的账本已有 8 个已消费 nonce，与 6 笔成功、2 笔
回滚一致，无未决交易。

### 路线隔离在真实运行中的证据

生产 audit 记录了以下连续事件：

1. `20:03:37.055Z`：Global 周期恢复开始；
2. `20:04:37.422Z`：Global child 达到 60 秒受控 timeout，记录
   `NO_UNRESOLVED_MUTATION_CONTINUE`；
3. `20:04:38.057Z`：635 毫秒后，Earn 收到包含两个相关池的事件并开始局部检查；
4. `20:04:48.230Z`：Earn 以 `NO_SHOT_NO_SIGNATURE_NO_BROADCAST` 正常完成。

因此，这一生产样本直接证明：Global adapter 的独立超时没有停止 watcher、没有阻塞后续 Earn 路线、没有产生
签名或未决 nonce。关键告警在 `20:08:12.665Z` 仍为 `HEALTHY / TRADING_HEALTHY`；后续 timer 检查全部记录
`notification=NONE`。状态文件保留的最后一次 `RECOVERY` 发送时间是 `19:18:14.880Z`，早于本次发布，不得将其
误报为 v0.16.4 新发送的通知。

### Earn 热路径效果

v0.16.4 启动后，Earn 的全部公开筛选均明确记录：

```text
PROTECTED_CANONICAL_STATIC_CACHE_PLUS_FIXED_BLOCK_DYNAMIC_MULTICALL
```

6 个完整事件样本从事件接收到结果分别约为 `7.79s`、`16.97s`、`7.47s`、`10.15s`、`10.17s`、`8.88s`；
历史竞态样本是约 `26.4s` 才完成公开筛选。两者的工作集和市场状态不同，不能当作严格基准测试，但足以证明新
静态目录缓存路径在生产被实际使用，而不是只存在于测试代码。所有样本的净报价均低于门槛，所以没有签名、广播
或 Gas 消耗。

### Sequencer Feed 尚未闭环

入站 Feed 快照为 `connects=0 / frames=0 / lastHttpStatus=403`，并按服务端拒绝进入一小时冷却；因此上述事件由
公共链上日志触发，不是 Feed 帧触发。[Robinhood Chain 官方连接文档](https://docs.robinhood.com/chain/connecting/)
把公共 RPC、Feed 和 Sequencer 都列为限速且不建议承担生产 SLA；当前实现保留周期/公共事件恢复，拒绝期间不会
紧密重连，也不会把 Feed 不可用写成实盘停机。

这不影响出站“同一已签名 raw 直接提交 Sequencer、传输不确定时才托管 RPC fallback”的交易路径。入站低延迟
Feed 若长期对该出口拒绝，需要生产级 Feed provider、官方 Nitro relay/[自有节点](https://docs.robinhood.com/chain/run-a-full-node/)
或另一条获准出口；不能通过提高重连频率绕过服务端保护。

## 收益与交易证据

截至 `20:15:38Z`，当前 authorization 的 canonical ledger 为：

- 6 笔成功 Earn 交易，成功交易各自已经扣除自身 Gas 后合计 `+0.000179577300329581 ETH`；
- 2 笔 canonical revert，失败 Gas 合计 `-0.00003354592337 ETH`；
- 因此该 authorization 扣除成功与失败交易 Gas 后为 `+0.000146031376959581 ETH`。

北京时间 9 月 15 日截至日报生成时有 5 笔成功、2 笔回滚：成功净额 `0.000150170573777019 ETH`，再扣失败
Gas 后为 `+0.000116624650407019 ETH`；Agent API 的当时市场参考估值为约 `$0.29901219 / ¥2.00589337`。
离链服务器、订阅等经营成本仍未并入，所以 `businessNet=UNKNOWN`。

### v0.16.4 第一笔实盘

公共事件在 `20:12:09.727Z` 命中两个 Earn 池；`20:12:19.412Z` 进入托管精确预检，`20:12:22.117Z`
完成最终 plan。最终 quote、`eth_call` 和 Gas estimate 在区块 `63081479` 并发完成，耗时 `141ms`。交易在
`20:12:22.597Z` 签名，并在 `20:12:25.044Z` 由 Sequencer 直接接受，没有使用托管 RPC 广播 fallback。

- 交易：[`0xdc392dae1ef106d998995d95466e68b41e15e7ae107aea573e813cb66f66ef20`](https://robinhoodchain.blockscout.com/tx/0xdc392dae1ef106d998995d95466e68b41e15e7ae107aea573e813cb66f66ef20)
- 路线：WETH → MOO → WETH，两个不同 Earn 池；
- 输入：`0.001816158260631111 ETH`；
- 最终报价：`0.001901153085456060 WETH`；保护输出：`0.001857098452130872 WETH`；
- receipt 区块：`63081508`；毛利：`0.000084994824824949 ETH`；
- canonical Gas：`0.000025032006432 ETH`；链上实际净利润：`+0.000059962818392949 ETH`；
- 证据：receipt Swap 序列、canonical Gas 与精确区块原生余额变化三者一致。

该交易证明 v0.16.4 的静态目录缓存、局部路线选择、并发最终门禁和直接 Sequencer 提交已走过真实正收益链路。
它仍由公共日志而不是入站 Feed 唤醒：事件接收到签名约 `12.87s`，接收到 canonical effect 约 `21.90s`。因此
执行正确性已闭环，入站发现速度仍有明确优化空间。

## 尚未闭环

- 公共 Sequencer Feed 对当前生产出口仍返回 403；低延迟 Feed 路径尚无生产 frame/wake 证据；
- v0.16.4 已用新 receipt 验证并发 final gate 与直接提交；route-local quarantine 在本版本尚未遇到新的
  canonical revert，因此其激活/解除仍只有自动化测试与历史 fixture 证据；
- 历史竞态因为公共 RPC 不提供对应历史块 `eth_call` 或 trace，仍保持
  `STRONG_STATE_RACE_INFERENCE_NOT_HISTORICAL_TRACE`，不能写成已证明的历史 EVM 路径；
- Global 周期恢复仍有 60 秒 child timeout，现已被正确隔离，但它仍降低 Global 覆盖，需要后续单独优化；
- 当前正收益不保证未来收益；只有新增 canonical receipt、Gas 和余额 delta 才会改变已实现结果。
