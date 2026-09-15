# Story：授权基线必须自行跨过瞬时 RPC 状态差

## 用户结果

作为实盘经营者，我希望通过全部链上验证的版本可以自行处理 RPC 节点间短暂的区块不同步，而不是依赖人工反复
点击授权；同时任何真实的 nonce、余额、部署或经济异常仍必须阻止实盘。

## 验收标准

- canonical chain、三份部署、钱包 latest/pending nonce 与两份执行器 principal 每次作为同一组重新读取；
- `header not found` 等已分类瞬时错误最多重试五次，并使用新的固定块；
- pending nonce、零 principal、代码哈希不符和业务不变量不重试；
- 每次重试原因脱敏且有界；
- 私钥只在只读证据和经济约束全部通过后加载；
- arm 过程不签名、不广播，失败后 watcher 仍为 disabled。
