import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  BoardStatus,
  applyFreshness,
  buildBoardSnapshot,
  catalogIsComplete,
  materialEvents,
  nextCycleDelay,
  normalizePairCandidate,
  publicError,
  screenRoundTrip,
  writeJsonAtomic,
} from '../src/opportunity-board.mjs'

test('cycle pacing preserves start interval and enforces a post-cycle cooldown', () => {
  assert.equal(nextCycleDelay({ scanIntervalMs: 120_000, cycleDurationMs: 45_000, minimumPauseMs: 60_000 }), 75_000)
  assert.equal(nextCycleDelay({ scanIntervalMs: 120_000, cycleDurationMs: 150_000, minimumPauseMs: 60_000 }), 60_000)
  assert.throws(
    () => nextCycleDelay({ scanIntervalMs: 120_000, cycleDurationMs: -1, minimumPauseMs: 60_000 }),
    /non-negative/,
  )
})

const TOKEN = '0x7aad9faa5ee27bdeeb17d5a8c1870278824c4c59'
const GOOGL = '0x2e0847e8910a9732eb3fb1bb4b70a580adad4fe3'
const MU = '0xff080c8ce2e5feadaca0da81314ae59d232d4afd'
const HOOK = '0x16d1560630ce74af4478d9b8ad46548a092a2000'

function pair(overrides = {}) {
  return {
    ammVersion: 'V4_MULTI',
    canonical: true,
    poolId: `0x${'1'.repeat(64)}`,
    poolFee: 10_000,
    tickSpacing: 200,
    hookAddress: HOOK,
    activeVirtualSwapDepthUsd: '687.12',
    impliedPriceUsd: '0.0000036',
    quoteToken: { address: GOOGL, symbol: 'GOOGL', decimals: 18, enabled: true },
    ...overrides,
  }
}

function candidateFixture(overrides = {}) {
  return {
    address: TOKEN,
    symbol: 'SIGMA',
    name: 'SIGMA',
    hidden: false,
    flagged: false,
    totalDepthUsd: '3434.39',
    volume24hUsd: null,
    pairs: [
      pair(),
      pair({
        poolId: `0x${'2'.repeat(64)}`,
        impliedPriceUsd: '0.0000038',
        quoteToken: { address: MU, symbol: 'MU', decimals: 18, enabled: true },
      }),
    ],
    ...overrides,
  }
}

test('PAIR discovery admits only canonical active V4 pools above the depth floor', () => {
  const stockAddresses = new Set([GOOGL, MU].map((address) => address.toLowerCase()))
  const candidate = normalizePairCandidate(candidateFixture(), { minDepthUsd: 100, stockAddresses })
  assert.equal(candidate.symbol, 'SIGMA')
  assert.equal(candidate.pools.length, 2)
  assert.equal(
    candidate.pools.every((pool) => pool.quoteKind === 'ROBINHOOD_ASSET'),
    true,
  )
  assert.equal(Number(candidate.indicativeGapPct.toFixed(2)), 5.56)

  assert.equal(normalizePairCandidate(candidateFixture({ hidden: true }), { minDepthUsd: 100 }), null)
  assert.equal(
    normalizePairCandidate(
      candidateFixture({ pairs: [pair(), pair({ canonical: false, poolId: `0x${'2'.repeat(64)}` })] }),
      { minDepthUsd: 100 },
    ),
    null,
  )
  assert.equal(
    normalizePairCandidate(
      candidateFixture({
        pairs: [pair(), pair({ activeVirtualSwapDepthUsd: '99.99', poolId: `0x${'2'.repeat(64)}` })],
      }),
      { minDepthUsd: 100 },
    ),
    null,
  )
})

test('catalog completeness is evaluated after newest-page reconciliation', () => {
  assert.equal(catalogIsComplete(1_729, 1_728), true)
  assert.equal(catalogIsComplete(1_727, 1_728), false)
  assert.equal(catalogIsComplete(0, 0), false)
})

test('gas proxy uses the exact route gas, overhead and fixed-block native mark', () => {
  const expensive = screenRoundTrip({
    amountIn: 10_000_000n,
    amountOut: 10_500_000n,
    quoterGas: [50_000n, 50_000n, 50_000n, 50_000n],
    overheadGas: 50_000n,
    gasPriceWei: 1_000_000_000n,
    nativeMarkInWei: 4_000_000_000_000_000n,
    nativeMarkOutUsdg: 10_000_000n,
  })
  assert.equal(expensive.routeGas, 200_000n)
  assert.equal(expensive.gasUnitsProxy, 250_000n)
  assert.equal(expensive.gasCostUsdg, 625_000n)
  assert.equal(expensive.grossProfitUsdg, 500_000n)
  assert.equal(expensive.screenedNetUsdg, -125_000n)
  assert.equal(expensive.status, BoardStatus.GROSS_POSITIVE)

  const cheap = screenRoundTrip({
    amountIn: 10_000_000n,
    amountOut: 10_500_000n,
    quoterGas: [50_000n, 50_000n, 50_000n, 50_000n],
    overheadGas: 50_000n,
    gasPriceWei: 100_000_000n,
    nativeMarkInWei: 4_000_000_000_000_000n,
    nativeMarkOutUsdg: 10_000_000n,
  })
  assert.equal(cheap.gasCostUsdg, 62_500n)
  assert.equal(cheap.screenedNetUsdg, 437_500n)
  assert.equal(cheap.status, BoardStatus.SCREENED_POSITIVE)
})

test('freshness fails closed without changing the underlying quote classification', () => {
  const item = { status: BoardStatus.SCREENED_POSITIVE, quotedAt: '2026-09-04T00:00:00.000Z' }
  assert.equal(
    applyFreshness(item, Date.parse('2026-09-04T00:00:29.000Z'), 30_000).status,
    BoardStatus.SCREENED_POSITIVE,
  )
  const stale = applyFreshness(item, Date.parse('2026-09-04T00:00:31.000Z'), 30_000)
  assert.equal(stale.status, BoardStatus.STALE)
  assert.equal(stale.underlyingStatus, BoardStatus.SCREENED_POSITIVE)
  assert.equal(stale.fresh, false)
})

function snapshotAt(generatedAt, observation) {
  const candidate = normalizePairCandidate(candidateFixture(), { minDepthUsd: 100 })
  return buildBoardSnapshot({
    generatedAt,
    catalog: [candidate],
    observations: new Map([[candidate.id, observation]]),
    staleMs: 60_000,
    sourceState: { catalogComplete: true },
    serviceState: { status: 'RUNNING' },
  })
}

test('material event ledger reports entry, meaningful delta and exit without stale noise', () => {
  const baseObservation = {
    status: BoardStatus.NO_EDGE,
    quotedAt: '2026-09-04T00:00:00.000Z',
    screenedNetUsdg: '-0.100000',
  }
  const previous = snapshotAt('2026-09-04T00:00:01.000Z', baseObservation)
  const entered = snapshotAt('2026-09-04T00:00:02.000Z', {
    ...baseObservation,
    quotedAt: '2026-09-04T00:00:02.000Z',
    status: BoardStatus.SCREENED_POSITIVE,
    screenedNetUsdg: '0.120000',
    route: 'GOOGL → SIGMA → MU',
    blockNumber: '100',
  })
  assert.deepEqual(
    materialEvents(previous, entered).map((event) => event.type),
    ['SCREENED_POSITIVE_ENTERED'],
  )

  const changed = snapshotAt('2026-09-04T00:00:03.000Z', {
    ...entered.items[0],
    quotedAt: '2026-09-04T00:00:03.000Z',
    screenedNetUsdg: '0.190000',
  })
  assert.deepEqual(
    materialEvents(entered, changed).map((event) => event.type),
    ['MATERIAL_NET_CHANGE'],
  )

  const left = snapshotAt('2026-09-04T00:00:04.000Z', {
    ...entered.items[0],
    quotedAt: '2026-09-04T00:00:04.000Z',
    status: BoardStatus.NO_EDGE,
    screenedNetUsdg: '-0.020000',
  })
  assert.deepEqual(
    materialEvents(entered, left).map((event) => event.type),
    ['SCREENED_POSITIVE_LEFT'],
  )

  const stale = snapshotAt('2026-09-04T00:02:00.000Z', entered.items[0])
  assert.deepEqual(materialEvents(entered, stale), [])
})

test('snapshot publishing is atomic, private to the service group and contains no endpoint error', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'manga-board-'))
  const file = path.join(directory, 'snapshot.json')
  try {
    writeJsonAtomic(file, { ok: true })
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { ok: true })
    assert.equal(fs.statSync(file).mode & 0o007, 0)
    assert.deepEqual(fs.readdirSync(directory), ['snapshot.json'])
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }

  const redacted = publicError(
    new Error(
      'request failed https://provider.example/v1/secret-key 0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    ),
  )
  assert.equal(redacted.includes('secret-key'), false)
  assert.equal(redacted.includes('aaaaaaaa'), false)
  assert.match(redacted, /redacted-endpoint/)
})
