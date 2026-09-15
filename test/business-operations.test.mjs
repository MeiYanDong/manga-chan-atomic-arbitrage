import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  assertFeishuWebhookUrl,
  assertPublicDailyProfitSnapshot,
  assertPublicBusinessSnapshot,
  buildBusinessSnapshot,
  buildDailyProfitSnapshot,
  dailyReportSchedule,
  deriveDeliveryState,
  formatFeishuDailyReport,
  publicRealtimeDiscovery,
  publicRuntimeStatus,
  readPublicBusinessSnapshot,
  shanghaiDateKey,
} from '../src/business-operations.mjs'

function fixture() {
  const authorizationId = 'active-dual-authorization'
  const legacyExecution = {
    hash: `0x${'1'.repeat(64)}`,
    confirmedAt: '2026-09-07T14:00:00.000Z',
    routeLabel: 'legacy USDG route',
    amountInWei: '10000000',
    grossProfitWei: '2000000',
    netProfitUsdgWei: '1700000',
    gasSpentWei: '10000000000000',
    gasSpentUsdgWei: '300000',
  }
  const usdgExecution = {
    hash: `0x${'2'.repeat(64)}`,
    confirmedAt: '2026-09-08T00:30:00.000Z',
    routeLabel: 'USDG → TEST → USDG',
    baseAsset: 'USDG',
    authorizationId,
    amountInWei: '10000000',
    grossProfitWei: '1000000',
    normalizedNetProfitUsdgWei: '800000',
    gasSpentWei: '10000000000000',
    gasSpentUsdgWei: '200000',
    executorBaseBeforeWei: '10000000',
    executorBaseAfterWei: '11000000',
  }
  const wethExecution = {
    hash: `0x${'3'.repeat(64)}`,
    confirmedAt: '2026-09-08T01:00:00.000Z',
    routeLabel: 'WETH → TEST → WETH',
    baseAsset: 'WETH',
    authorizationId,
    amountInWei: '1000000000000000',
    grossProfitWei: '100000000000000',
    normalizedNetProfitUsdgWei: '500000',
    gasSpentWei: '10000000000000',
    executorBaseBeforeWei: '1000000000000000',
    executorBaseAfterWei: '1100000000000000',
  }
  const arm = {
    authorizationId,
    authorizationLifetime: 'UNTIL_REVOKED',
    baselineUsdgExecutionCount: 1,
    baselineWethExecutionCount: 0,
    usdgPrincipalWeiAtArm: '10000000',
    usdgHardCapWei: '100000000',
    wethPrincipalWeiAtArm: '1000000000000000',
    wethHardCapWei: '1000000000000000000',
    walletEthReserveWei: '2000000000000000',
    earnOnHood: {
      initialGasSurplusWei: '131868227091194',
    },
  }
  /** @type {Array<Record<string, any>>} */
  const auditRecords = [
    {
      event: 'mutation_reverted',
      authorizationId,
      kind: 'weth-execute',
      gasSpentWei: '20000000000000',
      at: '2026-09-08T02:00:00.000Z',
    },
    {
      event: 'dual_runtime_verified',
      walletEth: '0.003',
      at: '2026-09-08T02:30:00.000Z',
    },
  ]
  return {
    now: new Date('2026-09-08T03:00:00.000Z'),
    arm,
    runtime: {
      status: 'RUNNING',
      startedAt: '2026-09-08T00:00:00.000Z',
      lastDecision: 'NO_SCREENED_OPPORTUNITY',
      processedBoardGenerations: 42,
      usage: {
        exactPreflights: 2,
        signedAttempts: 2,
        confirmedExecutions: 3,
        confirmedByBase: { USDG: 1, WETH: 1, EARN_ETH: 1 },
        earnLifetimeGasSurplusEth: '0.000131868227091194',
        earnCurrentAuthorizationNetEth: '0.00003',
      },
      earnOnHood: {
        status: 'WATCHING',
        lastResult: 'NO_SHOT_NO_SIGNATURE_NO_BROADCAST',
        lastDynamicMaximumPrincipalEth: '0.002378210095727194',
        nextPeriodicAt: '2026-09-08T03:05:00.000Z',
        searchWorker: {
          status: 'RUNNING',
          inFlight: true,
          pending: false,
          completed: 8,
          failures: 1,
          restarts: 1,
          coalesced: 3,
          pid: 1234,
          lastError: 'private provider detail',
        },
      },
    },
    usdgState: { executions: [legacyExecution, usdgExecution] },
    wethState: { executions: [wethExecution] },
    auditRecords,
    earnOnHoodRecords: [
      {
        event: 'mutation_effect',
        status: 'CONFIRMED_NET_PROFIT',
        at: '2026-09-07T14:30:00.000Z',
        transaction: `0x${'5'.repeat(64)}`,
        route: 'WETH → MOO → AI → WETH',
        amountInEth: '0.001',
        gasSpentEth: '0.00001',
        realizedNetProfitEth: '0.00002',
        blockNumber: 2,
      },
      {
        event: 'mutation_effect',
        status: 'CONFIRMED_NET_PROFIT',
        at: '2026-09-08T02:45:00.000Z',
        transaction: `0x${'6'.repeat(64)}`,
        authorizationId,
        route: 'WETH → AI → MOO → WETH',
        amountInEth: '0.0012',
        gasSpentEth: '0.00001',
        realizedNetProfitEth: '0.00003',
        realizedNetProfitWei: '30000000000000',
        blockNumber: 3,
      },
    ],
    projectRegistry: [
      {
        activityId: 'fixture-deployment',
        occurredAt: '2026-09-07T13:00:00.000Z',
        networkId: 'ROBINHOOD',
        type: 'DEPLOYMENT',
        title: '测试执行合约部署',
        status: 'CONFIRMED',
        amounts: [{ asset: 'USDG', value: '10', direction: 'INTERNAL' }],
        effects: [{ kind: 'COST', asset: 'ETH', value: '0.0004' }],
        transactionHash: `0x${'4'.repeat(64)}`,
        blockNumber: 1,
        gas: { value: '0.0004', treatment: 'OPERATING_COST' },
        evidence: { receipt: true, balanceEffect: true, level: 'CHAIN_ATTESTED' },
      },
    ],
    board: {
      generatedAt: '2026-09-08T03:00:00.000Z',
      health: { status: 'HEALTHY' },
      overview: { coverage: { candidateTokens: 863 }, freshCandidates: 4, screenedPositive: 1, exactReady: 0 },
      sources: { pairListings: 20, longLaunches: 30, dopplerTargetsDiscovered: 40, genericPools: 50 },
    },
    delivery: null,
    processAlive: true,
    portfolio: {
      schemaVersion: 1,
      generatedAt: '2026-09-08T03:00:00.000Z',
      status: 'VERIFIED',
      summary: { watchedObjects: 8, activeObjects: 6, parkedObjects: 2, parkedUsdg: '15.676618' },
      services: [],
      networks: [],
      accounts: [],
    },
  }
}

test('uses Beijing calendar boundaries and schedules the completed prior day', () => {
  assert.equal(shanghaiDateKey('2026-09-07T15:59:59.999Z'), '2026-09-07')
  assert.equal(shanghaiDateKey('2026-09-07T16:00:00.000Z'), '2026-09-08')

  assert.deepEqual(dailyReportSchedule('2026-09-08T01:04:00.000Z'), {
    due: false,
    periodKey: '2026-09-07',
    nextReportAt: '2026-09-08T01:05:00.000Z',
  })
  assert.deepEqual(dailyReportSchedule('2026-09-08T01:05:00.000Z'), {
    due: true,
    periodKey: '2026-09-07',
    nextReportAt: '2026-09-09T01:05:00.000Z',
  })
})

test('an in-flight exact execution remains a healthy live process in read models', () => {
  assert.equal(publicRuntimeStatus({ status: 'EXECUTING' }, true), 'RUNNING')
  assert.equal(publicRuntimeStatus({ status: 'HALTED_UNKNOWN' }, true), 'HALTED')
  assert.equal(publicRuntimeStatus({ status: 'RECONCILING_UNKNOWN' }, true), 'RECONCILING')
  assert.equal(publicRuntimeStatus({ status: 'RUNNING' }, false), 'STOPPED')
})

test('public real-time status exposes only useful connection and recovery facts', () => {
  const result = publicRealtimeDiscovery(
    {
      earnOnHood: {
        eventSource: { status: 'DEGRADED', subscriptionActive: false, lastError: 'secret provider failure' },
        eventSourceRetry: { nextRetryAt: '2026-09-08T03:02:00.000Z' },
      },
      global: {
        feed: {
          connected: false,
          lastStatus: 'REJECTED',
          lastHttpStatus: 403,
          feedUrl: 'wss://secret.invalid',
          nextReconnectAt: '2026-09-08T04:00:00.000Z',
        },
      },
    },
    {
      earnOnHood: { eventPollMs: 60_000 },
      global: { periodicMs: 300_000 },
    },
  )
  assert.deepEqual(result, {
    status: 'FALLBACK_ONLY',
    connectedLowLatencyPaths: 0,
    totalLowLatencyPaths: 2,
    fallbackStatus: 'ACTIVE',
    earnFallbackMaximumDelaySeconds: 60,
    globalFallbackMaximumDelaySeconds: 300,
    nextAutomaticRetryAt: '2026-09-08T03:02:00.000Z',
  })
  assert.doesNotMatch(JSON.stringify(result), /secret|wss|403|provider/i)
})

test('builds receipt-gated business results and compounds only authorized profit', () => {
  const snapshot = buildBusinessSnapshot(fixture())

  assert.equal(snapshot.strategy.status, 'RUNNING')
  assert.equal(snapshot.strategy.earnOnHood.status, 'WATCHING')
  assert.equal(snapshot.strategy.earnOnHood.fixedPrincipalCap, null)
  assert.equal(snapshot.strategy.earnOnHood.lastDynamicMaximumPrincipalEth, '0.002378210095727194')
  assert.equal(snapshot.strategy.earnOnHood.confirmedExecutions, 1)
  assert.equal(snapshot.strategy.earnOnHood.currentNetEth, '0.00003')
  assert.deepEqual(snapshot.strategy.earnOnHood.search, {
    status: 'RUNNING',
    scanning: true,
    queued: false,
    completedSearches: 8,
    failedSearches: 1,
    restarts: 1,
    coalescedSignals: 3,
  })
  assert.doesNotMatch(JSON.stringify(snapshot.strategy.earnOnHood.search), /private|provider|pid|lastError/)
  assert.equal(snapshot.economics.today.verifiedExecutionNetUsdg, '1.3')
  assert.equal(snapshot.economics.today.verifiedExecutionNetEth, '0.00003')
  assert.equal(snapshot.economics.today.confirmedExecutions, 3)
  assert.deepEqual(snapshot.economics.today.confirmedByBase, { USDG: 1, WETH: 1, EARN_ETH: 1, GLOBAL: 0 })
  assert.equal(snapshot.economics.today.failedTransactions, 1)
  assert.equal(snapshot.economics.today.failedGasEth, '0.00002')
  assert.equal(snapshot.economics.previousDay.verifiedExecutionNetUsdg, '1.7')
  assert.equal(snapshot.economics.previousDay.verifiedExecutionNetEth, '0.00002')
  assert.equal(snapshot.economics.previousDay.confirmedExecutions, 2)
  assert.equal(snapshot.economics.allTime.verifiedExecutionNetUsdg, '3')
  assert.equal(snapshot.economics.allTime.verifiedExecutionNetEth, '0.00005')
  assert.equal(snapshot.economics.allTime.confirmedExecutions, 5)
  assert.equal(snapshot.economics.activeStrategy.verifiedExecutionNetUsdg, '1.3')
  assert.equal(snapshot.economics.activeStrategy.verifiedExecutionNetEth, '0.00003')
  assert.equal(snapshot.economics.activeStrategy.confirmedExecutions, 3)
  assert.equal(snapshot.capital.spendableUsdg, '11')
  assert.equal(snapshot.capital.spendableWeth, '0.0011')
  assert.equal(snapshot.capital.walletGasLastVerifiedEth, '0.003')
  assert.equal(snapshot.market.sourceCounts.pairListings, 20)
  assert.equal(snapshot.market.sourceCounts.longRoutes, 30)
  assert.equal(snapshot.market.observedAt, '2026-09-08T03:00:00.000Z')
  assert.equal(snapshot.recentExecutions[0].baseAsset, 'WETH')
  assert.equal(snapshot.activities.length, 7)
  assert.equal(snapshot.activities.at(-1).type, 'DEPLOYMENT')
  assert.equal(snapshot.economics.project.coverage, 'PARTIAL')
  assert.deepEqual(snapshot.economics.project.byAsset, [
    { asset: 'ETH', profit: '0.00005', cost: '0.00045', net: '-0.0004' },
    { asset: 'USDG', profit: '3', cost: '0', net: '3' },
    { asset: 'WETH', profit: '0.0001', cost: '0', net: '0.0001' },
  ])
  assert.equal(snapshot.portfolio.summary.watchedObjects, 8)
  assert.doesNotMatch(JSON.stringify(snapshot), /active-dual-authorization/)
})

test('builds a compact daily profit API without inventing a cross-asset business total', () => {
  const daily = buildDailyProfitSnapshot(buildBusinessSnapshot(fixture()))
  assert.equal(daily.schemaVersion, 1)
  assert.equal(daily.mode, 'READ_ONLY_RECEIPT_GATED_DAILY_PROFIT')
  assert.equal(daily.timeZone, 'Asia/Shanghai')
  assert.equal(daily.coverage.execution, 'RECEIPT_GATED')
  assert.equal(daily.coverage.project, 'PARTIAL')
  assert.equal(daily.coverage.businessNet, 'UNKNOWN')
  assert.equal(daily.days.length, 7)

  const today = daily.days.find((day) => day.date === '2026-09-08')
  assert.ok(today)
  assert.equal(today.periodStatus, 'IN_PROGRESS')
  assert.equal(today.successfulTrades, 3)
  assert.deepEqual(today.markedTradingNetByAsset, [
    { asset: 'USDG', value: '1.3' },
    { asset: 'ETH', value: '0.00003' },
  ])
  assert.equal(today.failedTransactions, 1)
  assert.deepEqual(today.failedGasByAsset, [{ asset: 'ETH', value: '0.00002' }])
  assert.deepEqual(today.projectResultByAsset, [
    { asset: 'ETH', profit: '0.00003', cost: '0.00004', net: '-0.00001' },
    { asset: 'USDG', profit: '1', cost: '0', net: '1' },
    { asset: 'WETH', profit: '0.0001', cost: '0', net: '0.0001' },
  ])
  assert.deepEqual(today.businessNet, {
    state: 'UNKNOWN',
    reason: 'OPERATING_COST_COVERAGE_PARTIAL',
  })
  assert.doesNotMatch(JSON.stringify(daily), /0x[0-9a-f]{40}|transactionHash|authorizationId|walletAddress/)
  assert.equal(assertPublicDailyProfitSnapshot(daily), daily)
  assert.throws(() => assertPublicDailyProfitSnapshot({ ...daily, webhook: 'forbidden' }), /forbidden data/)
})

test('includes only receipt-gated universal executions in the operating totals', () => {
  const input = fixture()
  input.universalState = {
    executions: [
      {
        hash: `0x${'9'.repeat(64)}`,
        lane: 'global-v1',
        authorizationId: input.arm.authorizationId,
        confirmedAt: '2026-09-08T02:50:00.000Z',
        routeLabel: '跨平台 2 跳循环',
        baseAsset: 'USDG',
        settlementDecimals: 6,
        amountInWei: '10000000',
        grossProfitWei: '250000',
        normalizedNetProfitUsdgWei: '200000',
        gasSpentWei: '10000000000000',
        blockNumber: '10',
      },
    ],
  }
  input.arm.global = { settlementSeeds: ['USDG', 'WETH'], managedFallbackDailyLogicalCallCap: 20_000 }
  input.runtime.global = {
    status: 'WATCHING',
    lastResult: 'GLOBAL_LIVE_NET_PROFIT_CONFIRMED',
    graph: {
      settlementAdmission: { admitted: 1 },
      catalogReadEvidence: {
        status: 'COMPLETE',
        complete: true,
        requestedPairs: 14,
        requestedV3FeeQueries: 56,
        v2TransportErrors: 0,
        v3TransportErrors: 0,
      },
      universe: {
        status: 'CURRENT',
        selectedTargets: 128,
        selectedPools: 256,
        admittedTargets: 120,
        admittedPools: 240,
        capacityRejectedTargets: 8,
        safeHead: '12345678',
      },
    },
    feed: { frames: 1_200, wakes: 80, filtered: 1_120 },
    coalescedFeedWakes: 9,
    workset: {
      wakeKind: 'EVENT',
      totalRoutes: 12_091,
      touchedRoutes: 14,
      searchableRoutes: 240,
      fundedRoutes: 8,
      selectedRoutes: 8,
      searchableSettlementAssets: 2,
      fundedSettlementAssets: 1,
      fundingBlocked: false,
    },
    timing: { sourceToDecisionMs: 1_234 },
    rpc: { managedFallbackBudget: { consumedLogicalCalls: 432 } },
    decisionClassification: 'VALID_NON_PROFITABLE',
    evidenceCoverage: 'PARTIAL',
    lifecycle: { eventId: 'ROBINHOOD_SEQUENCER:100:101', graphVersion: '0xgraph' },
  }
  input.runtime.usage.confirmedByBase.GLOBAL = 1
  input.auditRecords.push(
    {
      event: 'global_watch_exact_preflight_started',
      authorizationId: input.arm.authorizationId,
      at: '2026-09-08T02:48:00.000Z',
    },
    {
      event: 'global_preflight',
      authorizationId: input.arm.authorizationId,
      grossPositive: 1,
      exactNetPositive: 1,
      at: '2026-09-08T02:49:00.000Z',
    },
  )
  const snapshot = buildBusinessSnapshot(input)
  assert.equal(snapshot.economics.today.verifiedExecutionNetUsdg, '1.5')
  assert.equal(snapshot.economics.today.confirmedExecutions, 4)
  assert.equal(snapshot.economics.today.confirmedByBase.GLOBAL, 1)
  assert.equal(snapshot.economics.today.confirmedByBase.USDG, 1)
  assert.equal(
    Object.values(snapshot.economics.today.confirmedByBase).reduce((total, count) => total + count, 0),
    snapshot.economics.today.confirmedExecutions,
  )
  assert.equal(snapshot.strategy.global.confirmedExecutions, 1)
  assert.equal(snapshot.strategy.global.settlementAssets, 1)
  assert.equal(snapshot.strategy.global.searchableSettlementAssets, 2)
  assert.equal(snapshot.strategy.global.fundedSettlementAssets, 1)
  assert.equal(snapshot.strategy.global.fundingBlocked, false)
  assert.deepEqual(snapshot.strategy.global.catalogEvidence, {
    status: 'COMPLETE',
    complete: true,
    requestedPairs: 14,
    requestedV3FeeQueries: 56,
    transportFailures: 0,
  })
  assert.deepEqual(snapshot.strategy.global.universe, {
    status: 'CURRENT',
    selectedTargets: 128,
    selectedPools: 256,
    admittedTargets: 120,
    admittedPools: 240,
    capacityRejectedTargets: 8,
    safeHead: '12345678',
  })
  assert.equal(snapshot.strategy.global.managedFallbackLogicalCallsToday, 432)
  assert.equal(snapshot.strategy.global.managedFallbackDailyLogicalCallCap, 20_000)
  assert.deepEqual(snapshot.strategy.global.executionFunnel, {
    feedMessages: 1_200,
    relevantSignals: 80,
    filteredSignals: 1_120,
    coalescedSignals: 9,
    exactPreflights: 1,
    grossPositiveRounds: 1,
    exactNetPositiveRounds: 1,
    confirmedExecutions: 1,
  })
  assert.deepEqual(snapshot.strategy.global.latestWorkset, {
    wakeKind: 'EVENT',
    totalRoutes: 12_091,
    touchedRoutes: 14,
    searchableRoutes: 240,
    fundedRoutes: 8,
    selectedRoutes: 8,
  })
  assert.equal(snapshot.strategy.global.latestDecisionLatencyMs, 1_234)
  assert.equal(snapshot.strategy.global.attribution.confirmedLostRaces, null)
  assert.equal(snapshot.strategy.global.attribution.latestClassification, 'VALID_NON_PROFITABLE')
  assert.equal(snapshot.strategy.global.attribution.coverage, 'PARTIAL')
  assert.equal(snapshot.strategy.global.attribution.lifecycle.eventId, 'ROBINHOOD_SEQUENCER:100:101')
  assert.equal(snapshot.recentExecutions[0].route, '跨平台 2 跳循环')
})

test('deduplicates identical Earn receipts and drops conflicting profit evidence', () => {
  const duplicated = fixture()
  duplicated.earnOnHoodRecords.push({ ...duplicated.earnOnHoodRecords[1] })
  const duplicatedSnapshot = buildBusinessSnapshot(duplicated)
  assert.equal(duplicatedSnapshot.economics.allTime.confirmedExecutions, 5)
  assert.equal(duplicatedSnapshot.economics.allTime.verifiedExecutionNetEth, '0.00005')

  const conflicted = fixture()
  conflicted.earnOnHoodRecords.push({
    ...conflicted.earnOnHoodRecords[1],
    authorizationId: conflicted.arm.authorizationId,
    realizedNetProfitEth: '0.00004',
    realizedNetProfitWei: '40000000000000',
  })
  const conflictedSnapshot = buildBusinessSnapshot(conflicted)
  assert.equal(conflictedSnapshot.economics.allTime.confirmedExecutions, 4)
  assert.equal(conflictedSnapshot.economics.allTime.verifiedExecutionNetEth, '0.00002')
  assert.equal(conflictedSnapshot.economics.activeStrategy.confirmedExecutions, 2)
  assert.equal(conflictedSnapshot.economics.activeStrategy.verifiedExecutionNetEth, '0')
})

test('daily Feishu copy reports business outcomes without raw execution identifiers', () => {
  const snapshot = buildBusinessSnapshot(fixture())
  const report = formatFeishuDailyReport(snapshot, '2026-09-07')

  assert.match(report, /【套利日报｜9月7日】/)
  assert.match(report, /今日净结果：\+1\.70 USDG；\+0\.000020 ETH/)
  assert.match(report, /盈利成交：2 笔/)
  assert.match(report, /本轮实盘累计：\+1\.30 USDG；\+0\.000010 ETH（3 笔盈利成交）/)
  assert.match(report, /可用交易资金：11\.00 USDG；0\.0011 WETH/)
  assert.match(report, /你需要做：无/)
  assert.match(report, /已扣成功与失败交易 Gas/)
  assert.doesNotMatch(report, /USDG 本金|Earn ETH|全局跨池|当前机会|资金监控/)
  assert.doesNotMatch(report, /扫描 863 个标的|canonical receipt/)
  assert.doesNotMatch(report, /0x[0-9a-f]{64}|authorization|webhook/i)
})

test('daily Feishu headline deducts failed Gas from the same-day ETH result', () => {
  const snapshot = buildBusinessSnapshot(fixture())
  const report = formatFeishuDailyReport(snapshot, '2026-09-08')

  assert.match(report, /今日净结果：\+1\.30 USDG；\+0\.000010 ETH/)
  assert.match(report, /失败成本：1 笔，共 0\.000020 ETH/)
})

test('recovers delivery state from the durable success receipt', () => {
  assert.deepEqual(
    deriveDeliveryState(null, [
      { status: 'FAILED', periodKey: '2026-09-06', sentAt: '2026-09-07T01:05:00.000Z' },
      { status: 'DELIVERED', periodKey: '2026-09-07', sentAt: '2026-09-08T01:05:00.000Z' },
    ]),
    { lastSuccessAt: '2026-09-08T01:05:00.000Z', lastPeriodKey: '2026-09-07' },
  )
  assert.deepEqual(
    deriveDeliveryState({ lastSuccessAt: '2026-09-09T01:05:00.000Z', lastPeriodKey: '2026-09-08' }, [
      { status: 'DELIVERED', periodKey: '2026-09-07', sentAt: '2026-09-08T01:05:00.000Z' },
    ]),
    { lastSuccessAt: '2026-09-09T01:05:00.000Z', lastPeriodKey: '2026-09-08' },
  )
})

test('accepts only an exact Feishu custom-bot webhook boundary', () => {
  const valid = 'https://open.feishu.cn/open-apis/bot/v2/hook/00000000-0000-0000-0000-000000000000'
  assert.equal(assertFeishuWebhookUrl(valid), valid)
  for (const invalid of [
    'https://example.com/open-apis/bot/v2/hook/00000000-0000-0000-0000-000000000000',
    `${valid}?leak=1`,
    'https://open.feishu.cn/open-apis/bot/v2/hook/',
    'http://open.feishu.cn/open-apis/bot/v2/hook/00000000-0000-0000-0000-000000000000',
  ]) {
    assert.throws(() => assertFeishuWebhookUrl(invalid), /invalid Feishu/)
  }
})

test('serves only validated, non-writable sanitized snapshots', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'manga-business-'))
  const file = path.join(directory, 'snapshot.json')
  const snapshot = buildBusinessSnapshot(fixture())
  try {
    fs.writeFileSync(file, JSON.stringify(snapshot), { mode: 0o640 })
    fs.chmodSync(file, 0o640)
    assert.deepEqual(readPublicBusinessSnapshot(file), snapshot)
    assert.deepEqual(
      readPublicBusinessSnapshot(file, { now: Date.parse(snapshot.generatedAt) + 60_000, maxAgeMs: 300_000 }),
      snapshot,
    )
    assert.throws(
      () => readPublicBusinessSnapshot(file, { now: Date.parse(snapshot.generatedAt) + 300_001, maxAgeMs: 300_000 }),
      /snapshot is stale/,
    )

    fs.chmodSync(file, 0o660)
    assert.throws(() => readPublicBusinessSnapshot(file), /must not be group- or world-writable/)
    assert.throws(() => assertPublicBusinessSnapshot({ ...snapshot, webhook: 'secret' }), /forbidden sensitive field/)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
