import assert from 'node:assert/strict'
import test from 'node:test'

import {
  OpportunityStage,
  buildOpportunityLedger,
  opportunityLedgerSummary,
  queryOpportunityEpisodes,
  queryOpportunityLedger,
} from '../src/opportunity-ledger.mjs'

const GENERATED_AT = '2026-09-13T10:00:00.000Z'

function candidate(id, symbol, lane) {
  return {
    id,
    symbol,
    status: lane.status,
    fresh: lane.fresh,
    ...lane,
  }
}

function fixture() {
  return {
    snapshot: {
      generatedAt: GENERATED_AT,
      items: [
        candidate('ready', 'READY', {
          status: 'SCREENED_NET_POSITIVE',
          fresh: true,
          exactPreflight: 'PASSED',
          route: 'USDG → READY → USDG',
          quotedAt: '2026-09-13T09:59:59.000Z',
          normalizedAmountInUsdg: '10',
          normalizedGrossProfitUsdg: '0.3',
          normalizedGasCostProxyUsdg: '0.1',
          normalizedScreenedNetUsdg: '0.2',
        }),
        candidate('near', 'NEAR', {
          status: 'GROSS_POSITIVE_NET_NEGATIVE',
          fresh: true,
          route: 'USDG → NEAR → USDG',
          quotedAt: '2026-09-13T09:59:58.000Z',
          normalizedAmountInUsdg: '10',
          normalizedGrossProfitUsdg: '0.08',
          normalizedGasCostProxyUsdg: '0.1',
          normalizedScreenedNetUsdg: '-0.02',
        }),
        candidate('filtered', 'FILTERED', {
          status: 'NO_EDGE',
          fresh: true,
          route: 'USDG → FILTERED → USDG',
          quotedAt: '2026-09-13T09:59:57.000Z',
          normalizedScreenedNetUsdg: '-0.5',
        }),
        candidate('stale-positive', 'STALE', {
          status: 'STALE',
          underlyingStatus: 'SCREENED_NET_POSITIVE',
          fresh: false,
          route: 'USDG → STALE → USDG',
          quotedAt: '2026-09-13T09:00:00.000Z',
          normalizedScreenedNetUsdg: '0.1',
        }),
        candidate('unquoted', 'UNQUOTED', {
          status: 'DISCOVERED_UNQUOTED',
          fresh: false,
          quotedAt: null,
        }),
      ],
    },
    episodes: [
      {
        episodeId: 'episode:one',
        state: 'OPEN',
        openedAt: '2026-09-12T00:00:00.000Z',
        lastPositiveRoute: 'A → B → A',
        lastPositiveNetUsdg: '0.05',
      },
    ],
    executions: [{ state: 'CONFIRMED' }, { state: 'PENDING' }],
  }
}

test('opportunity ledger keeps actionable, near, filtered and unknown outcomes separate', () => {
  const ledger = buildOpportunityLedger(fixture())
  assert.deepEqual(ledger.counts, { NOW: 1, NEAR: 1, FILTERED: 1, UNKNOWN: 2 })
  assert.equal(ledger.execution.confirmedReceipts, 1)
  assert.equal(ledger.missed.confirmedLostRace, 0)
  assert.equal(ledger.missed.continuityUnknown, 1)
  assert.match(ledger.missed.conclusion, /不能给出绝对错失利润/)
  assert.equal(ledger.coverage.status, 'PARTIAL')
})

test('current positive routes delay exact public details while negative decisions remain explainable', () => {
  const ledger = buildOpportunityLedger(fixture())
  const ready = ledger.items.find((item) => item.asset === 'READY')
  const filtered = ledger.items.find((item) => item.asset === 'FILTERED')
  assert.equal(ready.stage, OpportunityStage.NOW)
  assert.equal(ready.disclosure.exactRouteDelayed, true)
  assert.equal(ready.route, 'READY 多池闭环')
  assert.equal(ready.economics.principal, null)
  assert.equal(filtered.disclosure.exactRouteDelayed, false)
  assert.equal(filtered.reasonCode, 'NO_GROSS_EDGE')
  assert.equal(filtered.route, 'USDG → FILTERED → USDG')
})

test('ledger pagination is bounded and never upgrades history into missed profit', () => {
  const ledger = buildOpportunityLedger(fixture())
  const filtered = queryOpportunityLedger(ledger, new URLSearchParams({ stage: 'UNKNOWN', limit: '1' }))
  assert.equal(filtered.count, 2)
  assert.equal(filtered.items.length, 1)
  assert.equal(filtered.nextCursor, '1')
  const history = queryOpportunityEpisodes(ledger, new URLSearchParams())
  assert.equal(history.items[0].classification, 'CONTINUITY_UNKNOWN')
  assert.match(history.items[0].conclusion, /不能计作错失利润/)
  assert.throws(
    () => queryOpportunityLedger(ledger, new URLSearchParams({ stage: 'NOT_REAL' })),
    /invalid opportunity stage/,
  )
})

test('summary omits row payloads and keeps the API compact', () => {
  const summary = opportunityLedgerSummary(buildOpportunityLedger(fixture()))
  assert.equal('items' in summary, false)
  assert.equal('episodes' in summary, false)
  assert.equal(summary.counts.FILTERED, 1)
})
