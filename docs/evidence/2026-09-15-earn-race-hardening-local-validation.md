# 2026-09-15 Earn 竞态收敛：本地验证证据

## 已观察的生产事实

- 我方交易 `0x3a2c2d1b6f7c6dd20bd5445a2079b2aa5930573ab8ec1d57878e7ca0b2b10cc1` 在区块
  `63032258` 取得 canonical revert，失败 Gas 为 `0.00001662675336 ETH`；
- 路线是两个不同池子的 WETH → AI → WETH，输入 `0.001501341875674918 ETH`，签名前报价
  `0.001562809508580310 WETH`，保护输出 `0.001540666560591359 WETH`；
- 外部交易 `0xc30118adc35883ec06a68c966fa5233c6154061b29ac4178bcc9bcecd1e4b265` 在前两个区块对同一
  退出池执行 AI → WETH；
- 当前状态重放得到 `SwapLimit`，实际输出 `0.001514535541258272 WETH`，低于原保护输出；
- 公开事件到公开筛选约 26.4 秒，托管精确预检约 3.4 秒，签名到 Sequencer 接受约 0.47 秒；
- 公共节点没有该历史块状态或 trace，所以结论是强竞态推断，不是历史执行 trace 证明。

地址、金额与证据等级已保存在
`test/fixtures/earn-ai-state-race-63032258.json`，没有私钥、RPC URL、Webhook 或其他 credential。

## 修复范围

- Sequencer Feed 同时向 Earn 与 Global typed adapter 分发，Earn 精确命中优先、Global 保持排队；
- 全部命中池参与局部路线排序；
- 公开热路径复用 canonical 静态 catalog，只刷新 fixed-block dynamic state；
- 托管阶段保留核心协议与 exact route identity 校验；
- 最终 quote/call/Gas gate 同区块并发；
- canonical revert 建立 route-local quarantine，旧帧不能误解除；
- 飞书只上报会影响整体实盘能力的关键状态。

## 本地验证

- 定向 Node tests：48/48 通过；
- 定向 ESLint：通过；
- TypeScript `--noEmit`：通过；
- `git diff --check`：通过。
- 完整 `npm run check`：通过；
- Node tests：386/386 通过；
- deterministic contract suites：4/4 通过；
- secret scan：419 个文件通过；
- macOS 不提供 `systemd-analyze`，Linux unit 验证必须由 GitHub Actions 和生产机完成。

GitHub Actions、不可变 release 与生产 Linux/runtime 读回仍必须按发布流程另行验证；本文件不会把本地结果写成
生产已生效。
