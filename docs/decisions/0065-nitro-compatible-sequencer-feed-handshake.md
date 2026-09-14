# ADR 0065：Nitro 兼容的 Sequencer Feed 握手与退避

- 状态：Accepted
- 日期：2026-09-14

## 背景

v0.14.8 使用 Node 的浏览器式 WebSocket 直接连接 Robinhood Chain Sequencer Feed。生产读回显示服务进程与全局
扫描正常，但 Feed 为 `connects=0`、`frames=0`、`errors=1`。同一主机的 DNS、TLS 和 HTTPS 均可达，服务端
明确返回 HTTP 403，并说明该 IP 因持续被拒绝的 Feed 连接而临时封禁。

Robinhood 官方文档给出的 URL 没有错误。Offchain Labs Nitro 的当前参考客户端还要求握手携带
`Arbitrum-Feed-Client-Version: 2` 和起始序号，并默认协商 `permessage-deflate`。原客户端没有能力发送自定义
WebSocket 握手头，也在连接被拒后以固定一秒重试，二者共同造成了服务端拒绝和临时封禁。

## 决策

1. 运行时直接依赖维护中的 `ws` 客户端，并按 Nitro v2 发送 Feed 客户端版本和请求序号；不再使用
   `globalThis.WebSocket`。
2. 初次请求序号使用启动安全快照已经读取的最新链区块号。收到帧后保存最高消息序号，重连从下一序号继续，
   避免从零请求历史 backlog，也不把 Feed 序号虚构成可执行 RPC 状态。
3. 开启 `permessage-deflate`，设置十秒握手超时。真实公网集成探针必须只输出版本、序号、消息数和字节数，
   不记录原始 L2 消息或交易内容。
4. 普通断线按一秒到六十四秒指数退避。HTTP 拒绝必须读取 `Retry-After`，最长尊重一小时冷却；一个连接生命周期
   只安排一次重连，禁止错误事件与关闭事件重复排队。
5. Feed 仍然只是低延迟唤醒源。任何帧命中后仍须查询当前可执行状态，并通过既有报价、Gas、净利润、nonce、
   模拟、余额和原子执行门禁；Feed 断开时周期恢复继续运行，但状态必须明确显示覆盖降级。

## 验证与边界

- 修复前，同一生产 IP 的标准 HTTPS 握手得到 403；修复后的参考握手从独立公网出口获得 HTTP 101，协商
  `permessage-deflate`，并收到与当时最新区块一致的真实 Feed 序号。
- 单元测试验证必需握手头、压缩、从下一序号恢复，以及 `Retry-After` 不会形成紧密重连循环。
- 公共 Feed 由 Robinhood 明确标注为限速且不建议直接承担生产 SLA。若长期拒绝或限速，下一步是使用官方 Nitro
  relay/自有节点或具备等价低延迟能力的生产提供商；不得通过高频重连绕过服务端保护。
