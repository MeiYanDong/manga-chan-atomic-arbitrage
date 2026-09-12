# ADR 0055：签名前最后一刻的费率与报价恶化属于本次放弃

- 状态：Accepted
- 日期：2026-09-13

## 背景

EarnOnHood 路径在公共筛选和托管 RPC 精确预检后，还会在签名前重新读取区块、nonce、余额、费率、报价、call 和
Gas。2026-09-13 生产中，一条候选进入精确预检后，最新费率超过已保护的上限。执行子进程在加载私钥和签名前
正确拒绝，但父 watcher 把这个可预期的市场漂移归类成 invariant，因而以 `HALTED_INVARIANT` 正常退出；systemd
的 `Restart=on-abnormal` 不会自动重启正常的安全退出。

## 决策

1. `fee increased beyond the protected preflight cap` 与 `quote fell below the protected output floor` 归为 exact
   candidate miss；
2. 父 watcher 记录 `CANDIDATE_REJECTED_EXACT` 后继续下一轮，不签名、不广播，也不增加失败 Gas；
3. 分类只在父 watcher 已确认没有 unresolved mutation 后生效；若已有签名/广播或回执未知，仍先进入
   `HALTED_UNKNOWN`；
4. nonce 变化、余额异常、授权/合约身份不一致、回执或余额效果冲突仍保持 terminal halt；
5. 不把 systemd 改成对所有失败自动重启，以免真正 invariant 被循环掩盖。

## 影响

- 机会在最后一道门禁自然消失时，7x24 watcher 不再永久离线；
- 经济和链上安全边界没有放宽，变化只影响“拒绝后是否继续观察”；
- 生产中这次错误发生在 mutation intent、签名和广播之前，因此恢复没有 nonce 对账负担。
