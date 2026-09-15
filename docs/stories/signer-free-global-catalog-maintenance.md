# Story：Global 慢速目录维护不再卡住实盘

## Outcome

作为实盘经营者，我希望全市场目录读取再慢，也不会占用签名热路径的 60 秒窗口、阻塞 Earn 或造成“程序在跑但
Global 总超时”的假象。

## Acceptance criteria

- Global resident worker、周期恢复和正向提示后的签名子进程都只读取原子目录快照；
- 只有独立 systemd one-shot 可以刷新目录，并以文件锁拒绝并发 writer；
- one-shot 不加载私钥、live arm、付费 RPC 或 WSS，只使用 Robinhood Chain 官方公共 RPC；
- 定时器在上一次任务结束 15 分钟后再次运行，重启后补跑，单次最长六分钟；
- 服务受到 384 MiB 内存、低 CPU 权重、只写策略运行目录等系统边界；
- 发布脚本只把可选结算资产配置复制到维护进程的 allowlist 文件；
- 刷新失败保留上一个原子快照；快照超过六小时后 Global 降级，但 Earn 和其他服务继续；
- 部分 RPC 证据保持 `PARTIAL`，不得宣称“完整扫描没有机会”；
- 自动测试验证热路径没有刷新调用、systemd 无凭据、周期/超时/权限边界和显式维护命令；
- 生产恢复前验证目录服务、计时器、实盘 watcher、nonce 和共享主机另一个程序均正常。

## Non-goals

- 不自动迁移其他执行器的资金；
- 不把公共 RPC 的部分覆盖包装成完整覆盖；
- 不降低净利润、Gas、nonce、模拟、授权、签名、提交或回执门槛；
- 不把运行中的扫描当作已成交或已盈利。
