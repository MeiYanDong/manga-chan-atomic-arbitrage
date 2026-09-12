import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { buildBusinessActivities, summarizeProjectEconomics } from '../src/business-activity.mjs'

const registry = JSON.parse(
  fs.readFileSync(new URL('../deployments/project-history-mainnet.json', import.meta.url), 'utf8'),
).entries

test('normalizes reviewed history and runtime ledgers into one newest-first activity stream', () => {
  const executionHash = `0x${'a'.repeat(64)}`
  const collectionHash = `0x${'b'.repeat(64)}`
  const activities = buildBusinessActivities({
    registry,
    executions: [
      {
        hash: executionHash,
        confirmedAt: '2026-09-12T06:00:00.000Z',
        routeLabel: 'USDG → TEST → USDG',
        baseAsset: 'USDG',
        amountInWei: '10000000',
        grossProfitWei: '1000000',
        gasSpentWei: '10000000000000',
      },
    ],
    collectionRecords: [
      {
        event: 'withdrawal_complete',
        hash: collectionHash,
        confirmedAt: '2026-09-12T05:25:38.000Z',
        targetId: 'MANGA',
        token: '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168',
        amountUsdg: '10.045402',
        gasSpentWei: '6582268176000',
        blockNumber: 60855935,
      },
    ],
  })

  assert.equal(activities.length, registry.length + 2)
  assert.equal(activities[0].transactionHash, executionHash)
  assert.equal(activities[1].type, 'COLLECTION')
  assert.equal(activities[1].title, 'MANGA 资金归集')
  assert.doesNotMatch(JSON.stringify(activities[1]), /0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168/i)
  assert.deepEqual(activities[0].effects, [
    { kind: 'PROFIT', asset: 'USDG', value: '1' },
    { kind: 'COST', asset: 'ETH', value: '0.00001' },
  ])
  assert.equal(activities.find((item) => item.type === 'CAPITAL_IN').effects.length, 0)
  assert.equal(activities.find((item) => item.type === 'CAPITAL_IN').gas.treatment, 'EXTERNAL')
})

test('counts only explicit native-asset effects and keeps cross-asset totals separate', () => {
  const activities = buildBusinessActivities({
    executions: [
      {
        hash: `0x${'c'.repeat(64)}`,
        confirmedAt: '2026-09-12T06:00:00.000Z',
        baseAsset: 'WETH',
        amountInWei: '1000000000000000',
        grossProfitWei: '100000000000000',
        gasSpentWei: '10000000000000',
      },
    ],
    earnOnHoodRecords: [
      {
        event: 'mutation_effect',
        status: 'CONFIRMED_NET_PROFIT',
        transaction: `0x${'d'.repeat(64)}`,
        at: '2026-09-11T19:00:43.000Z',
        route: 'EarnOnHood ETH loop',
        amountInEth: '0.002',
        gasSpentEth: '0.000047463672072',
        realizedNetProfitEth: '0.000131868227091194',
        blockNumber: '60487738',
      },
    ],
  })
  const result = summarizeProjectEconomics(activities)

  assert.equal(result.coverage, 'PARTIAL')
  assert.equal(activities[1].blockNumber, 60487738)
  assert.deepEqual(result.byAsset, [
    { asset: 'ETH', profit: '0.000131868227091194', cost: '0.00001', net: '0.000121868227091194' },
    { asset: 'WETH', profit: '0.0001', cost: '0', net: '0.0001' },
  ])
  assert.match(result.coverageNote, /未知历史不按零处理/)
})

test('drops malformed and unrelated audit records instead of leaking raw fields', () => {
  const activities = buildBusinessActivities({
    registry: [{ activityId: 'bad', type: 'CAPITAL_IN', occurredAt: 'never', networkId: 'BASE' }],
    auditRecords: [{ event: 'runtime_started', privateKey: 'must-not-appear' }],
  })
  assert.deepEqual(activities, [])
})
