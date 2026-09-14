import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assertPublicAgentDailyProfitSnapshot,
  buildAgentDailyProfitSnapshot,
  buildAgentMarketValuation,
} from '../src/agent-daily-profit.mjs'

const NOW = '2026-09-08T03:00:00.000Z'

function market(overrides = {}) {
  const updatedAt = Date.parse(NOW) / 1_000
  return buildAgentMarketValuation({
    now: NOW,
    coinGecko: {
      ethereum: { usd: 2500, last_updated_at: updatedAt },
      'global-dollar': { usd: 1, last_updated_at: updatedAt },
    },
    kraken: {
      error: [],
      result: {
        XETHZUSD: { c: ['2500.00000', '1'] },
        USDGUSD: { c: ['1.00000000', '1'] },
      },
    },
    frankfurter: { amount: 1, base: 'USD', date: '2026-09-08', rates: { CNY: 7 } },
    ...overrides,
  })
}

function daily() {
  return {
    schemaVersion: 1,
    mode: 'READ_ONLY_RECEIPT_GATED_DAILY_PROFIT',
    generatedAt: NOW,
    timeZone: 'Asia/Shanghai',
    days: [
      {
        date: '2026-09-07',
        periodStatus: 'FINAL',
        evidenceStatus: 'RECEIPT_GATED',
        successfulTrades: 0,
        markedTradingNetByAsset: [
          { asset: 'USDG', value: '0' },
          { asset: 'ETH', value: '0' },
        ],
        failedTransactions: 0,
        failedGasByAsset: [{ asset: 'ETH', value: '0' }],
        projectResultByAsset: [{ asset: 'ETH', profit: '99', cost: '0', net: '99' }],
      },
      {
        date: '2026-09-08',
        periodStatus: 'IN_PROGRESS',
        evidenceStatus: 'RECEIPT_GATED',
        successfulTrades: 3,
        markedTradingNetByAsset: [
          { asset: 'USDG', value: '1.3' },
          { asset: 'ETH', value: '0.00003' },
        ],
        failedTransactions: 1,
        failedGasByAsset: [{ asset: 'ETH', value: '0.00002' }],
        projectResultByAsset: [{ asset: 'ETH', profit: '100', cost: '0', net: '100' }],
      },
    ],
  }
}

test('builds a compact agent projection and deducts failed Gas exactly once', () => {
  const valuation = market()
  const snapshot = buildAgentDailyProfitSnapshot(daily(), valuation)
  const today = snapshot.days.at(-1)

  assert.equal(valuation.status, 'READY')
  assert.equal(valuation.assetUsd[0].status, 'TWO_SOURCE_CONFIRMED')
  assert.equal(valuation.assetUsd[0].pegState, 'WITHIN_ONE_PERCENT')
  assert.equal(snapshot.status, 'READY')
  assert.equal(today.native.find((item) => item.asset === 'USDG').netAfterFailedGas, '1.3')
  assert.equal(today.native.find((item) => item.asset === 'ETH').netAfterFailedGas, '0.00001')
  assert.deepEqual(today.strategyNetAfterFailedGas, {
    usd: { value: '1.325', status: 'ESTIMATED_MARKET_REFERENCE' },
    cny: { value: '9.275', status: 'ESTIMATED_MARKET_REFERENCE' },
  })
  assert.equal(snapshot.summary.knownStrategyNetUsd, '1.325')
  assert.equal(snapshot.summary.knownStrategyNetCny, '9.275')
  assert.equal(snapshot.accounting.projectResultByAssetIncluded, false)
  assert.equal(snapshot.accounting.failedTransactionGasDeducted, true)
  assert.doesNotMatch(JSON.stringify(snapshot), /"projectResultByAsset":/)
  assert.equal(assertPublicAgentDailyProfitSnapshot(snapshot), snapshot)
})

test('a real zero remains known without a market quote', () => {
  const snapshot = buildAgentDailyProfitSnapshot(
    { ...daily(), days: [daily().days[0]] },
    buildAgentMarketValuation({ now: NOW }),
  )
  assert.deepEqual(snapshot.days[0].strategyNetAfterFailedGas, {
    usd: { value: '0', status: 'KNOWN_ZERO_NO_QUOTE_REQUIRED' },
    cny: { value: '0', status: 'KNOWN_ZERO_NO_QUOTE_REQUIRED' },
  })
})

test('single-source valuation stays usable but visibly partial', () => {
  const snapshot = buildAgentDailyProfitSnapshot(daily(), market({ kraken: null }))
  assert.equal(snapshot.valuation.status, 'PARTIAL_SINGLE_SOURCE')
  assert.equal(snapshot.status, 'PARTIAL')
  assert.equal(snapshot.days.at(-1).strategyNetAfterFailedGas.usd.status, 'ESTIMATED_SINGLE_SOURCE')
  assert.equal(snapshot.days.at(-1).strategyNetAfterFailedGas.usd.value, '1.325')
})

test('disagreeing sources suppress the cross-asset total instead of picking one', () => {
  const updatedAt = Date.parse(NOW) / 1_000
  const valuation = market({
    coinGecko: {
      ethereum: { usd: 2500, last_updated_at: updatedAt },
      'global-dollar': { usd: 1, last_updated_at: updatedAt },
    },
    kraken: {
      error: [],
      result: { XETHZUSD: { c: ['3000', '1'] }, USDGUSD: { c: ['1', '1'] } },
    },
  })
  const snapshot = buildAgentDailyProfitSnapshot(daily(), valuation)
  assert.equal(valuation.assetUsd.find((quote) => quote.pair === 'ETH/USD').status, 'SOURCE_DISAGREEMENT')
  assert.equal(snapshot.days.at(-1).strategyNetAfterFailedGas.usd.value, null)
  assert.equal(snapshot.status, 'PARTIAL')
})

test('rejects duplicate native assets and forbidden public fields', () => {
  const bad = daily()
  bad.days[0].markedTradingNetByAsset.push({ asset: 'ETH', value: '0' })
  assert.throws(() => buildAgentDailyProfitSnapshot(bad, market()), /duplicate marked trading net asset/)
  const valid = buildAgentDailyProfitSnapshot(daily(), market())
  assert.throws(
    () => assertPublicAgentDailyProfitSnapshot({ ...valid, walletAddress: `0x${'1'.repeat(40)}` }),
    /forbidden data/,
  )
})
