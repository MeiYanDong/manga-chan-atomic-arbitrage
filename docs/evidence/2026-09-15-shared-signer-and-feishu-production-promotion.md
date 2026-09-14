# 共享签名域恢复与飞书文案生产发布证据

- 发布日期：2026-09-15（Asia/Shanghai）
- 生产版本：`v0.16.3`
- 不可变提交：`4d8ad3cb352741eeb7a5c991e436f7b3e88ac462`
- 结论：已恢复一个共享签名监督器下的 Earn、Global、USDG、WETH adapter；canonical revert 不再停止所有
  adapter；日报已扣除失败交易 Gas；生产服务、链上只读校验和公网读模均通过。

## 目标与边界

发布前通过 SWAS 实时清单按实例 ID 唯一解析目标：

```text
profile       default
region        us-west-1
endpoint      swas.us-west-1.aliyuncs.com
instance      cbe793c9cb9241ce97752334f65cab48
name          manga-chan-arb-us-west
public IP     47.251.185.146
```

控制面读回为 `Running / Normal`，Cloud Assistant 可用。`intl` profile 当时没有可用 OAuth 凭据，因此全账号
inventory coverage 为 `partial`；这不影响上述按精确实例 ID、区域和公网 IP 完成的唯一目标解析。该 2 GiB
主机同时承载独立的 `atomic-cycle-live.service`，所以发布后另行核对该服务。

本次没有更换钱包、私钥、RPC、执行器、资金、利润门槛、授权 ID 或 nonce 基线，也没有部署新合约。发布动作
只安装经 CI 验证的代码并受控重启 MANGA watcher、只读 board 与报告服务。

## 合并、门禁与发布包

- Pull request：<https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/pull/171>
- 合并提交：`4d8ad3cb352741eeb7a5c991e436f7b3e88ac462`
- main quality：<https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/actions/runs/34880768441>，`success`
- release artifact：<https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/actions/runs/34880966701>，`success`
- GitHub release：<https://github.com/MeiYanDong/manga-chan-atomic-arbitrage/releases/tag/v0.16.3>
- 发布包 SHA-256：`243e77d5398d21657104014d9562702d92c98c203d4ad73e9631f0fe76ac9834`

本地完整 `npm run check` 通过：379/379 Node tests、4/4 deterministic contract suites、格式、lint、类型、
UI build、四个合约编译和 414-file secret scan 均通过。Linux CI 同时执行 systemd unit 验证。
加入本生产证据和 Cloud Assistant 运行手册修订后再次运行同一完整门禁，仍为 379/379、4/4，并完成
415-file secret scan；新的 Linux CI 结果随文档 PR 单独记录。

## 发布前状态

Cloud Assistant invocation `t-usw6x2eyf9cejgg` 在 2026-09-15 02:33 CST 读回：

- 旧 release：`dea7824a9e554a66a81fae839fa65f47c0ca5730`；
- watcher、board、critical timer 均为 active；
- authorization：`0x2ee4eb795ce54cd575b16e9dc19ffcea544748e8fabde2ae8ccf30fd56de762b`，`ARMED`；
- `latestUnresolvedMutation=null`；
- 当前授权已经有 3 笔 confirmed Earn profit、1 笔 canonical revert、4 个已消费 nonce；
- 已确认盈利交易净额为 `0.000077289279089588 ETH`，失败 Gas 为 `0.00001691917001 ETH`。

安装前再次停止 watcher 并在停稳后读取 append-only audit，结果仍为
`POST_STOP_UNRESOLVED=null`。发布包下载后的 SHA-256 与 GitHub release 完全一致，安装器成功完成
`npm ci`、release build、合约编译、secret scan 和原子 `current` symlink 切换。

## Cloud Assistant 超时与误报警

首次 promotion invocation `t-usw6x2fgt9vmigw` 使用了 Cloud Assistant 默认的 60 秒 timeout。安装已经成功，
但 post-start 验收同时犯了两个错误：

1. 将 systemd 的 `npm` wrapper `MainPID` 与 watcher 写入状态文件的 Node child PID 要求相等；两者按当前 unit
   本来就是不同进程；
2. board 的首次完整投影从 02:39:52 到 02:41:16 才进入 `BOARD_HTTP_READY`，超过了同一 invocation 的剩余
   时间。

云助手在 02:40:21 强制结束命令并触发 failure trap。该 trap 过早恢复 critical timer，在新 watcher 尚未写入
Node child PID 时，于 02:40:23 误发一次“实盘已暂停”。这不是链上 UNKNOWN、nonce 冲突或实盘进程真实故障。
新 watcher 随后正常发布状态；invocation `t-usw6x2foreeexa8` 在确认状态 PID `50638` 存活后运行健康检查，
02:41:24 得到 `TRADING_HEALTHY` 并发送一次“实盘已恢复”。

运行手册已据此增加三条门禁：显式设置足够但有界的 Cloud Assistant timeout；安装与启动验收分成可独立轮询的
阶段；critical timer 只能在新 runtime PID 和手动健康检查通过后恢复。超时后先读回，不得把 UNKNOWN 自动写成
回滚。以后也不再用 npm wrapper PID 与 Node child PID 相等作为验收条件。

## 生产运行读回

02:47 CST 的 guest-OS 与应用读回：

| 对象                     | 版本或 PID                             | 状态                 | 重启   |
| ------------------------ | -------------------------------------- | -------------------- | ------ |
| `current` symlink        | `4d8ad3cb…ac462`                       | package `0.16.3`     | 不适用 |
| MANGA watcher            | systemd PID `50610` / Node PID `50638` | active/running       | 0      |
| opportunity board        | systemd PID `50474`                    | active/running       | 0      |
| Base `atomic-cycle-live` | PID `783`                              | active/running       | 0      |
| critical health          | `TRADING_HEALTHY`                      | timer active/waiting | 不适用 |

watcher 与 board 的进程工作目录都解析到精确 release
`/opt/manga-chan-arbitrage/releases/4d8ad3cb352741eeb7a5c991e436f7b3e88ac462`。公网 `/healthz` 返回
`HEALTHY`，并同时报告 SQLite read model、persistence integrity 与 parity 均为 healthy/true；
`/api/v1/system` 报告同一 release SHA。

链上只读验证 invocation `t-usw6x2g1r153bi8` 成功返回：

- `RUNTIME_VERIFIED_READY_FOR_DUAL_ARM`；
- Robinhood Chain ID `4663`；
- wallet latest/pending nonce `43/43`；
- `unresolvedMutation=null`；
- USDG executor 余额 `35.344393 USDG`；
- WETH executor 余额 `0.0032 WETH`；
- 原 authorization ID、`ARMED / UNTIL_REVOKED` 保持不变；
- board 为 signer-free、execution unauthorized 的只读投影。

该交互式 verify 没有加载 `/etc/manga-chan-arbitrage/release.env`，因此其输出中的 `releaseSha` 为 `UNKNOWN`；
这不是运行服务的版本未知。精确版本分别由安装包哈希、`current` symlink、两个进程 cwd 和公网 system API 四个
独立读回证明。

共享主机上的 Base watcher 保持原 PID `783`、`NRestarts=0`。最新 heartbeat 检查 531 条路线，观察到 11 条
毛利为正候选，但 0 条通过完整实盘门禁；没有广播，confirmed profit/revert 和失败 Gas 均为 0。MANGA 发布没有
重启或改变 Base signer。

## 收益与用户文案

2026-09-15 的公网 receipt-gated read model 记录 2 笔成功交易：成功交易内已核算 Gas 后为
`0.000047882552537026 ETH`；另有 1 笔失败交易 Gas `0.00001691917001 ETH`，所以当天实际策略结果为
`+0.000030963382527026 ETH`。

当前 authorization 共 3 笔成功交易，成功交易净额 `0.000077289279089588 ETH`；扣除该授权的失败 Gas 后，
实际累计为 `+0.000060370109079588 ETH`。这两个结果均来自 canonical receipt 与账本，不来自报价、模拟或面板
推测。

用生产 `/api/v1/business` 快照生成的新日报预览为：

```text
【套利日报｜9月15日】
今日净结果：+0.000030963 ETH
盈利成交：2 笔
失败成本：1 笔，共 0.000016919 ETH
本轮实盘累计：+0.00006037 ETH（3 笔盈利成交）
可用交易资金：35.34 USDG；0.0032 WETH
程序：运行中；扫描正常
你需要做：无
依据：只统计链上已确认结果，已扣成功与失败交易 Gas。
```

关键提醒也已使用“情况 / 影响 / 系统处理 / 你需要做”的中文结构，不再给用户暴露 nonce、RPC、授权 ID 或内部
状态码。普通 no-shot、利润不足和单次网络波动继续保持静默。

## 尚未闭环

- 交易 `0xb845ecd7b225f68d20fe2a60d4df778385193637769f9d10453d1afb246a8365` 的 canonical revert 与 Gas
  已确定，但公共 RPC 不支持该历史块 `eth_call` 或 debug trace，具体 EVM revert reason 仍为 `UNKNOWN`；
- Global adapter 当前偶发 `CHILD_TIMEOUT_NO_UNRESOLVED_MUTATION`，共享监督器继续运行并扫描其他 adapter；这不是
  已确认漏单或需要用户处理的关键停机；
- 公网 read model、systemd active 与 runtime verify 都不是未来盈利保证。只有新的 canonical receipt 和资产
  delta 才能增加已实现收益。
