import assert from 'node:assert/strict'
import test from 'node:test'
import {
  PAGES,
  assetClassLabel,
  baseLiveSummary,
  businessHeadline,
  compactAddress,
  competitionStrategyLabel,
  crossChainRouteResult,
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
  opportunityStageLabel,
  opportunityStageTone,
  portfolioMoneyMap,
  relativeAge,
  runtimeBadge,
  selectOpportunitiesForOperator,
  sortOpportunitiesForOperator,
  sourceLabel,
  sourceAdapterDescription,
  sourceAdapterLabel,
  toneForStatus,
} from '../ui/src/view-model.mjs'

test('funds map keeps live balances separate', () => {
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
})

test('dashboard navigation only accepts known workspaces', () => {
  assert.equal(PAGES.length, 6)
  assert.deepEqual(
    PAGES.map((page) => page.label),
    ['概览', '机会', '竞争', '交易', '资金', '策略'],
  )
  assert.equal(currentPage('#/portfolio'), 'portfolio')
  assert.equal(currentPage('#/opportunities'), 'opportunities')
  assert.equal(currentPage('#/radar'), 'opportunities')
  assert.equal(currentPage('#/episodes'), 'opportunities')
  assert.equal(currentPage('#/competitors'), 'competition')
  assert.equal(currentPage('#/sources'), 'strategy')
  assert.equal(currentPage('#/execution/detail'), 'activity')
  assert.equal(currentPage('#/not-a-page'), 'overview')
})

test('competition labels state only the receipt-proven path shape', () => {
  assert.equal(competitionStrategyLabel('EARN_VAULT_2_HOP_CLOSED_CYCLE'), 'Earn 内部 2 跳闭环')
  assert.equal(competitionStrategyLabel('EARN_VAULT_4_HOP_CLOSED_CYCLE'), 'Earn 内部 4 跳闭环')
  assert.equal(competitionStrategyLabel('UNKNOWN'), 'Earn 内部闭环')
})

test('opportunity presentation keeps live, near, filtered and unknown stages distinct', () => {
  assert.equal(opportunityStageLabel('NOW'), '现在能做')
  assert.equal(opportunityStageLabel('UNKNOWN'), '错过与未知')
  assert.equal(opportunityStageTone('NOW'), 'READY')
  assert.equal(opportunityStageTone('NEAR'), 'PARTIAL')
  assert.deepEqual(crossChainRouteResult({ estimatedNetProfit: '0.1 WETH' }), {
    stage: 'NEAR',
    label: '只读净正，待执行准入',
  })
  assert.deepEqual(crossChainRouteResult({ grossProfit: '0.1 WETH', estimatedNetProfit: '-0.01 WETH' }), {
    stage: 'NEAR',
    label: 'Gas 与风险储备吞掉价差',
  })
  assert.equal(crossChainRouteResult({ grossProfit: '-0.1 WETH', estimatedNetProfit: '-0.2 WETH' }).stage, 'FILTERED')
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

test('runtime badge reports the execution process independently from market-data coverage', () => {
  assert.deepEqual(runtimeBadge({ strategy: { status: 'RUNNING' }, market: { status: 'UNKNOWN' } }), {
    status: 'RUNNING',
    label: '实盘运行中',
  })
  assert.deepEqual(runtimeBadge({ strategy: { status: 'STOPPED' } }), {
    status: 'STOPPED',
    label: '执行已停止',
  })
  assert.deepEqual(runtimeBadge(null, { error: true }), {
    status: 'ERROR',
    label: '运行状态待核验',
  })
})

test('Base live summary distinguishes dust gross spread from executable net profit', () => {
  assert.equal(
    baseLiveSummary({
      status: 'RUNNING',
      routesChecked: 525,
      positiveGrossCandidates: 5,
      bestGrossProfitEth: '0.000000298718090992',
      fullLiveGateCandidates: 0,
      primaryBlockReason: '毛利低于合约利润底线',
    }),
    '本轮检查 525 条路线，5 条只是毛利为正，0 条达到实盘净利润门槛；最高毛利 0.000000298718090992 ETH。未广播原因：毛利低于合约利润底线。',
  )
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

test('operator opportunity selection keeps the panel focused without truncating source data', () => {
  const items = Array.from({ length: 20 }, (_, index) => ({
    opportunityId: `opportunity-${String(index)}`,
    axes: { quote: index === 19 ? 'FRESH_PROXY_POSITIVE' : 'UNQUOTED' },
    quote: { quotedAt: `2026-09-08T01:${String(index).padStart(2, '0')}:00.000Z` },
  }))
  const selected = selectOpportunitiesForOperator(items)
  assert.equal(selected.length, 12)
  assert.equal(selected[0].opportunityId, 'opportunity-19')
  assert.equal(items.length, 20)
  assert.throws(() => selectOpportunitiesForOperator(items, 0), /positive integer/)
})
