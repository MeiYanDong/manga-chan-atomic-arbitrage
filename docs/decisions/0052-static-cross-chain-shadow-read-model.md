# ADR 0052：以独立静态读模型接入跨链 Shadow

- 状态：Accepted
- 日期：2026-09-13

## 背景

Robinhood 主机会板既承担市场发现，也承载现有 Signer 的只读升级入口。把 BNB 和新增协议扫描继续塞入同一进程会扩大故障域，也会让页面再次混合平台、协议、venue 与执行权限。另一方面，用户需要在同一个经营面板看到扩大后的真实覆盖。

## 决策

1. 跨链报价由 `atomic-cycle-engine` 的独立、无凭据 systemd 服务生成；
2. 仅将经过字段白名单的 mode-0644 JSON 文件交给 Nginx；
3. Nginx 以精确路径 `/api/v1/opportunities/chains` 直接提供 GET/HEAD，不反向代理到主板；
4. 前端只展示链、场所、资产、漏斗和扣除 Gas 后的结论；块承诺保留在 API 作为审计证据，不放在主视图；
5. 新接口失败只使该模块显示未知，不阻断资金、交易记录和既有机会页；
6. `signingEnabled=false`、`broadcastEnabled=false` 是接口身份的一部分，不能被 UI 推断或改写。

## 影响

- 新扫描器故障不会占用现有 nonce、钱包或交易账本，也不会让主面板空白；
- 用户可以区分“完整扫描无净正”与“数据不完整”；
- 这次发布扩大观察面，不扩大资金风险。任何新实盘仍需独立 calldata/risk/effect 适配器、分叉验证和授权。
