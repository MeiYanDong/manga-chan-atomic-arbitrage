# Global 多源事件唤醒本地验证

- 日期：2026-09-15（Asia/Shanghai）
- 目标版本：v0.16.16
- 基线：生产 v0.16.15 / `0bb8155fa9fc0479b991b7a523539121b259d4f3`
- 证据等级：生产触发源故障取证 + 本地实现与确定性回归；不是新增成交或收益证据

## 生产问题

v0.16.15 的常驻 Global worker、父 watcher 和 cgroup 均健康，但新 Sequencer Feed 连接返回 HTTP 403，
worker 的 `completed=0`。这说明当时没有事件请求进入 worker，不能把它描述为“搜索后没有机会”。既有 Earn
WSS 与公共 Earn 日志回补仍在工作，但此前只唤醒 Earn adapter，没有把变化池交给统一 Global 图。

## 最小修复

- 复用已有 Earn Vault WSS 和公共日志回补事件，不创建新订阅；
- 只把事件中的规范 pool 地址作为 Global 图依赖，允许命中同 Earn 或跨协议闭环；
- 保留事件来源、最早时间和合并后的全部变化池，拒绝未知来源与畸形地址；
- 常驻 worker 仍剥离 credential、live arm 与 managed endpoint，只使用官方公共 RPC；
- 任何只读正值仍必须回到唯一 signer，在最新区块重做报价、Gas、余额、nonce、模拟和授权检查；
- Sequencer Feed 不可用时，Uniswap-only 事件仍依靠周期 Global recovery，未虚构为全链实时覆盖。

## 本地回归

聚焦测试覆盖 Earn→Global 地址投影、多源合并、生命周期来源、busy-tail、worker 权限剥离和双路由接线，
43 tests，43 passed，0 failed。完整 `npm run check` 通过：441 tests，441 passed，0 failed；四组确定性合约
测试、格式、lint、类型检查、UI 构建、四个编译器、shell 校验和密钥扫描（471 files）全部通过。本机没有
`systemd-analyze`，Linux unit 语义须由 release/生产门禁继续验证。GitHub CI、不可变 release、生产切换和真实
event→search 计数仍需后续证据；没有 canonical receipt 不得记为新增收益。
