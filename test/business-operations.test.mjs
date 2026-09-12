import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  assertFeishuWebhookUrl,
  assertPublicBusinessSnapshot,
  buildBusinessSnapshot,
  dailyReportSchedule,
  deriveDeliveryState,
  formatFeishuDailyReport,
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
  }
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
      usage: { exactPreflights: 2, signedAttempts: 2, confirmedExecutions: 2 },
    },
    usdgState: { executions: [legacyExecution, usdgExecution] },
    wethState: { executions: [wethExecution] },
    auditRecords,
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
      summary: { watchedObjects: 7, activeObjects: 5, parkedObjects: 2, parkedUsdg: '15.676618' },
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

test('builds receipt-gated business results and compounds only authorized profit', () => {
  const snapshot = buildBusinessSnapshot(fixture())

  assert.equal(snapshot.strategy.status, 'RUNNING')
  assert.equal(snapshot.economics.today.verifiedExecutionNetUsdg, '1.3')
  assert.equal(snapshot.economics.today.confirmedExecutions, 2)
  assert.deepEqual(snapshot.economics.today.confirmedByBase, { USDG: 1, WETH: 1 })
  assert.equal(snapshot.economics.today.failedTransactions, 1)
  assert.equal(snapshot.economics.today.failedGasEth, '0.00002')
  assert.equal(snapshot.economics.previousDay.verifiedExecutionNetUsdg, '1.7')
  assert.equal(snapshot.economics.allTime.verifiedExecutionNetUsdg, '3')
  assert.equal(snapshot.economics.activeStrategy.verifiedExecutionNetUsdg, '1.3')
  assert.equal(snapshot.capital.spendableUsdg, '11')
  assert.equal(snapshot.capital.spendableWeth, '0.0011')
  assert.equal(snapshot.capital.walletGasLastVerifiedEth, '0.003')
  assert.equal(snapshot.market.sourceCounts.pairListings, 20)
  assert.equal(snapshot.market.sourceCounts.longRoutes, 30)
  assert.equal(snapshot.recentExecutions[0].baseAsset, 'WETH')
  assert.equal(snapshot.activities.length, 5)
  assert.equal(snapshot.activities.at(-1).type, 'DEPLOYMENT')
  assert.equal(snapshot.economics.project.coverage, 'PARTIAL')
  assert.deepEqual(snapshot.economics.project.byAsset, [
    { asset: 'ETH', profit: '0', cost: '0.00045', net: '-0.00045' },
    { asset: 'USDG', profit: '3', cost: '0', net: '3' },
    { asset: 'WETH', profit: '0.0001', cost: '0', net: '0.0001' },
  ])
  assert.equal(snapshot.portfolio.summary.watchedObjects, 7)
  assert.doesNotMatch(JSON.stringify(snapshot), /active-dual-authorization/)
})

test('daily Feishu copy reports business outcomes without raw execution identifiers', () => {
  const snapshot = buildBusinessSnapshot(fixture())
  const report = formatFeishuDailyReport(snapshot, '2026-09-07')

  assert.match(report, /昨日结果：已确认净收益 \+1\.70 USDG/)
  assert.match(report, /成交：1 笔（USDG 本金 1 笔，WETH 本金 0 笔）/)
  assert.match(report, /可复投资金：11\.00 USDG；0\.0011 WETH/)
  assert.match(report, /当前机会：可以执行 0 条；接近门槛 1 条/)
  assert.match(report, /资金监控：5 个活跃地址；2 个待归集地址（15\.68 USDG）/)
  assert.doesNotMatch(report, /扫描 863 个标的|canonical receipt/)
  assert.doesNotMatch(report, /0x[0-9a-f]{64}|authorization|webhook/i)
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
