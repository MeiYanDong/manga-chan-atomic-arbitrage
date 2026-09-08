import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assetClassLabel,
  businessHeadline,
  compactAddress,
  currentPage,
  decisionLabel,
  economicHeadline,
  evidenceClaimLabel,
  formatBeijingTime,
  formatMetric,
  humanStatus,
  relativeAge,
  sourceLabel,
  sourceAdapterDescription,
  sourceAdapterLabel,
  toneForStatus,
} from '../ui/src/view-model.mjs'

test('dashboard navigation only accepts known workspaces', () => {
  assert.equal(currentPage('#/radar'), 'radar')
  assert.equal(currentPage('#/execution/detail'), 'execution')
  assert.equal(currentPage('#/not-a-page'), 'overview')
})

test('display helpers keep unknown values explicit', () => {
  assert.equal(formatMetric(null), '—')
  assert.equal(compactAddress(null), 'UNKNOWN')
  assert.equal(relativeAge(null), 'never')
  assert.equal(relativeAge('2026-09-07T00:00:00.000Z', Date.parse('2026-09-07T00:01:01.000Z')), '1m')
})

test('screened proxy and exact-ready headlines stay distinct', () => {
  assert.equal(economicHeadline({ screenedPositive: 1, exactReady: 0 }), '发现价差，正在精确核验')
  assert.equal(economicHeadline({ screenedPositive: 1, exactReady: 1 }), '发现可执行机会')
  assert.equal(economicHeadline({ screenedPositive: 0, exactReady: 0 }), '系统持续运行，等待有效机会')
  assert.equal(toneForStatus('FRESH_PROXY_POSITIVE'), 'proxy')
  assert.equal(toneForStatus('CONFIRMED'), 'verified')
})

test('business labels are human-facing while preserving degraded and unknown states', () => {
  assert.equal(
    businessHeadline({ strategy: { status: 'STOPPED' }, market: { status: 'HEALTHY' } }, {}),
    '执行服务需要检查',
  )
  assert.equal(
    businessHeadline({ strategy: { status: 'RUNNING' }, market: { status: 'NOT_READY' } }, {}),
    '市场数据暂时降级',
  )
  assert.equal(humanStatus('CONNECTED'), '已连接')
  assert.equal(humanStatus('SOMETHING_NEW'), '待核验')
  assert.equal(sourceLabel('PAIR'), 'PAIR 平台')
  assert.equal(sourceLabel('LONG_ROUTE'), 'LONG 路线')
  assert.equal(sourceAdapterLabel('long.launcher.v1'), 'LONG 发行路线')
  assert.match(sourceAdapterDescription('pair.catalog.v1'), /PAIR 平台/)
  assert.equal(assetClassLabel('STOCK'), '股票代币')
  assert.equal(evidenceClaimLabel('EXECUTION'), '执行证据')
  assert.equal(decisionLabel('NO_SCREENED_OPPORTUNITY'), '当前没有达到门槛的机会')
  assert.match(formatBeijingTime('2026-09-08T01:05:00.000Z'), /09:05/)
})
