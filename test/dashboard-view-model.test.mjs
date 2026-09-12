import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BASE_BOOTSTRAP_RECEIPT,
  PAGES,
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
  noTradeReason,
  opportunityLane,
  opportunityReason,
  portfolioMoneyMap,
  relativeAge,
  sortOpportunitiesForOperator,
  sourceLabel,
  sourceAdapterDescription,
  sourceAdapterLabel,
  toneForStatus,
} from '../ui/src/view-model.mjs'

test('funds map keeps live balances separate and reconciles the Base bootstrap receipt', () => {
  const portfolio = {
    networks: [
      {
        id: 'ROBINHOOD',
        active: { USDG: '35.344393', WETH: '0.0032' },
        parked: { USDG: '15.676618' },
        all: { USDG: '51.021011' },
      },
    ],
    accounts: [
      { id: 'base-operator', assets: [{ symbol: 'ETH', amount: '0.006987074636027231' }] },
      { id: 'base-executor', assets: [{ symbol: 'WETH', amount: '0.003' }] },
      { id: 'robinhood-operator', assets: [{ symbol: 'ETH', amount: '0.002759654781831194' }] },
    ],
  }
  assert.deepEqual(portfolioMoneyMap(portfolio), {
    base: { walletEth: '0.006987074636027231', executorWeth: '0.003' },
    robinhood: {
      walletEth: '0.002759654781831194',
      activeUsdg: '35.344393',
      activeWeth: '0.0032',
      parkedUsdg: '15.676618',
      totalUsdg: '51.021011',
    },
  })
  const accounted =
    Number(BASE_BOOTSTRAP_RECEIPT.walletEthAfterBootstrap) +
    Number(BASE_BOOTSTRAP_RECEIPT.executorWethAfterBootstrap) +
    Number(BASE_BOOTSTRAP_RECEIPT.deploymentAndInitializationGasEth)
  assert.ok(Math.abs(accounted - Number(BASE_BOOTSTRAP_RECEIPT.depositedEth)) < 1e-15)
  assert.match(BASE_BOOTSTRAP_RECEIPT.fundingTransactionUrl, /^https:\/\/base\.blockscout\.com\/tx\/0x/)
})

test('dashboard navigation only accepts known workspaces', () => {
  assert.equal(PAGES.length, 5)
  assert.deepEqual(
    PAGES.map((page) => page.label),
    ['总览', '资金', '机会', '账单', '更多'],
  )
  assert.equal(currentPage('#/portfolio'), 'portfolio')
  assert.equal(currentPage('#/radar'), 'opportunities')
  assert.equal(currentPage('#/sources'), 'more')
  assert.equal(currentPage('#/execution/detail'), 'execution')
  assert.equal(currentPage('#/not-a-page'), 'overview')
})

test('display helpers keep unknown values explicit', () => {
  assert.equal(formatMetric(null), '—')
  assert.equal(compactAddress(null), '待核验')
  assert.equal(relativeAge(null), '时间待核验')
  assert.equal(relativeAge('2026-09-07T00:00:00.000Z', Date.parse('2026-09-07T00:01:01.000Z')), '1 分钟前')
})

test('screened proxy and exact-ready headlines stay distinct', () => {
  assert.equal(economicHeadline({ screenedPositive: 1, exactReady: 0 }), '发现初筛价差，正在继续核验')
  assert.equal(economicHeadline({ screenedPositive: 1, exactReady: 1 }), '有机会已通过成交前核验')
  assert.equal(economicHeadline({ screenedPositive: 0, exactReady: 0, freshCandidates: 3 }), '最新报价暂未达到收益门槛')
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
  assert.equal(
    businessHeadline(
      {
        strategy: { status: 'RUNNING' },
        market: { status: 'HEALTHY' },
        economics: { activeStrategy: { confirmedExecutions: 0 } },
      },
      {},
    ),
    '本策略暂未成交',
  )
  assert.equal(humanStatus('CONNECTED'), '已连接')
  assert.equal(humanStatus('PARKED'), '等待归集')
  assert.equal(humanStatus('VERIFIED'), '已核验')
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

test('opportunity stages explain what is still missing without exposing machine states', () => {
  const exact = { axes: { exactPreflight: 'PASSED', execution: 'NONE', quote: 'FRESH_PROXY_POSITIVE' } }
  const near = { axes: { exactPreflight: 'NOT_RUN', execution: 'NONE', quote: 'FRESH_PROXY_POSITIVE' } }
  const stale = { axes: { exactPreflight: 'NOT_RUN', execution: 'NONE', quote: 'STALE' } }
  assert.equal(opportunityLane(exact), 'executable')
  assert.equal(opportunityLane(near), 'near')
  assert.equal(opportunityLane(stale), 'watching')
  assert.match(opportunityReason(near), /还没有通过成交前精确核验/)
  assert.match(opportunityReason(stale), /已过期/)
  assert.equal(
    sortOpportunitiesForOperator([
      { axes: { quote: 'STALE' }, quote: { quotedAt: '2026-09-08T02:00:00.000Z' } },
      { axes: { quote: 'FRESH_NO_EDGE' }, quote: { quotedAt: '2026-09-08T01:00:00.000Z' } },
    ])[0].axes.quote,
    'FRESH_NO_EDGE',
  )
  assert.match(
    noTradeReason(
      { strategy: { status: 'RUNNING' }, market: { status: 'HEALTHY' } },
      { freshCandidates: 3, screenedPositive: 0, exactReady: 0 },
    ),
    /3 条最新报价.*没有达到/,
  )
  assert.match(
    noTradeReason(
      { strategy: { status: 'RUNNING' }, market: { status: 'HEALTHY' } },
      {
        freshCandidates: 0,
        screenedPositive: 0,
        exactReady: 0,
        coverageQuality: { status: 'LIMITED', freshQuotedTokens: 2, candidateTokens: 100 },
      },
    ),
    /只覆盖 2\/100.*不能据此断言/,
  )
  assert.equal(humanStatus('LIMITED'), '覆盖有限')
})
