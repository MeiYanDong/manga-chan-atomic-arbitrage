# Story: 历史策略证据不阻断现役版本发布

## 用户结果

作为经营者，我希望历史执行证据长期保留，但已经停用的策略通道不会因为旧依赖超时而阻断现役引擎的
发布验证。

## 验收标准

- 只有 active 或 enabled 的策略 watcher 触发对应 runtime verification；
- 历史状态文件不删除、不改写；
- 当前 dual/global 部署、钱包 nonce 与未决交易边界仍必须验证；
- 校验路径不加载私钥、不签名、不广播；
- CI 对 inactive generic 的跳过条件建立源代码回归断言。
