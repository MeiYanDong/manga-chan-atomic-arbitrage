import assert from 'node:assert/strict'
import fs from 'node:fs'
import nodePath from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { encodePacked } from 'viem'
import {
  GENERIC_PAIR_HOOK,
  GENERIC_USDG,
  buildGenericExecutionCandidate,
  buildGenericExecutionCandidates,
  decodeV3Path,
  pairPoolId,
} from '../src/generic-plan.mjs'
import { BoardStatus } from '../src/opportunity-board.mjs'

const root = nodePath.resolve(nodePath.dirname(fileURLToPath(import.meta.url)), '..')

const TARGET = '0x3363Cd5019Aa1F3E50C73086d5F5dCab3D90f558'
const ENTRY = '0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9'
const EXIT = '0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC'
const WETH = '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73'

function poolKey(quote) {
  const currency0 = BigInt(TARGET) < BigInt(quote) ? TARGET : quote
  return {
    currency0,
    currency1: currency0 === TARGET ? quote : TARGET,
    fee: 10_000,
    tickSpacing: 200,
    hooks: GENERIC_PAIR_HOOK,
  }
}

const ENTRY_POOL_ID = pairPoolId(poolKey(ENTRY))
const EXIT_POOL_ID = pairPoolId(poolKey(EXIT))

function path(tokens, fees) {
  const types = ['address']
  const values = [tokens[0]]
  for (let index = 0; index < fees.length; index += 1) {
    types.push('uint24', 'address')
    values.push(fees[index], tokens[index + 1])
  }
  return encodePacked(types, values)
}

function snapshotFixture(overrides = {}) {
  const item = {
    id: TARGET.toLowerCase(),
    tokenAddress: TARGET,
    symbol: 'SPX',
    status: BoardStatus.SCREENED_POSITIVE,
    fresh: true,
    quotedAt: '2026-09-05T00:00:00.000Z',
    blockNumber: '55000000',
    blockHash: `0x${'a'.repeat(64)}`,
    amountInUsdg: '25',
    amountOutUsdg: '25.8',
    grossProfitUsdg: '0.8',
    gasCostProxyUsdg: '0.3',
    screenedNetUsdg: '0.5',
    routeKey: `${ENTRY_POOL_ID}:${EXIT_POOL_ID}`,
    amountQuotes: [],
    entryV3Path: path([GENERIC_USDG, ENTRY], [500]),
    exitV3Path: path([EXIT, WETH, GENERIC_USDG], [500, 100]),
    legs: {
      entryPoolId: ENTRY_POOL_ID,
      entryV3Fees: [500],
      entryV3Hops: 1,
      exitPoolId: EXIT_POOL_ID,
      exitV3Fees: [500, 100],
      exitV3Hops: 2,
    },
    pools: [
      {
        poolId: ENTRY_POOL_ID,
        quoteAddress: ENTRY,
        fee: 10_000,
        tickSpacing: 200,
        hookAddress: GENERIC_PAIR_HOOK,
      },
      {
        poolId: EXIT_POOL_ID,
        quoteAddress: EXIT,
        fee: 10_000,
        tickSpacing: 200,
        hookAddress: GENERIC_PAIR_HOOK,
      },
    ],
    ...overrides,
  }
  return {
    schemaVersion: 2,
    service: 'manga-opportunity-board',
    mode: 'READ_ONLY_NO_SIGNING_NO_BROADCAST',
    selection: { id: item.id, executionAuthorized: false },
    items: [item],
  }
}

test('V3 path decoding supports direct and one-WETH-bridge anchors', () => {
  assert.deepEqual(decodeV3Path(path([GENERIC_USDG, ENTRY], [500])), {
    tokens: [GENERIC_USDG, ENTRY],
    fees: [500],
  })
  assert.deepEqual(decodeV3Path(path([EXIT, WETH, GENERIC_USDG], [500, 100])), {
    tokens: [EXIT, WETH, GENERIC_USDG],
    fees: [500, 100],
  })
  assert.throws(() => decodeV3Path(path([GENERIC_USDG, WETH, TARGET, ENTRY], [100, 500, 500])), /one or two hops/)
  assert.throws(() => decodeV3Path(path([GENERIC_USDG, TARGET, ENTRY], [100, 500])), /must use WETH/)
  assert.throws(() => decodeV3Path(path([GENERIC_USDG, ENTRY], [123])), /outside the allowlist/)
})

test('fresh global selection becomes a typed bounded generic execution candidate', () => {
  const candidate = buildGenericExecutionCandidate(snapshotFixture(), {
    nowMs: Date.parse('2026-09-05T00:00:10.000Z'),
  })
  assert.equal(candidate.amountIn, 25_000_000n)
  assert.equal(candidate.screenedNetProfit, 500_000n)
  assert.equal(candidate.route.targetToken, TARGET)
  assert.equal(candidate.route.entryV4Pool.hooks, GENERIC_PAIR_HOOK)
  assert.match(candidate.executionKey, /^0x[0-9a-f]{64}$/)
  assert.match(candidate.candidateHash, /^0x[0-9a-f]{64}$/)
})

test('typed preflight set keeps profitable amount variants and deduplicates execution payloads', () => {
  const fixture = snapshotFixture()
  fixture.items[0].amountQuotes = [
    {
      status: BoardStatus.SCREENED_POSITIVE,
      amountInUsdg: '10',
      amountOutUsdg: '10.4',
      grossProfitUsdg: '0.4',
      gasCostProxyUsdg: '0.2',
      screenedNetUsdg: '0.2',
      routeKey: fixture.items[0].routeKey,
      entryV3Path: fixture.items[0].entryV3Path,
      exitV3Path: fixture.items[0].exitV3Path,
      legs: fixture.items[0].legs,
    },
    {
      status: BoardStatus.SCREENED_POSITIVE,
      amountInUsdg: '25',
      amountOutUsdg: '25.8',
      grossProfitUsdg: '0.8',
      gasCostProxyUsdg: '0.3',
      screenedNetUsdg: '0.5',
      routeKey: fixture.items[0].routeKey,
      entryV3Path: fixture.items[0].entryV3Path,
      exitV3Path: fixture.items[0].exitV3Path,
      legs: fixture.items[0].legs,
    },
  ]
  const candidates = buildGenericExecutionCandidates(fixture, {
    nowMs: Date.parse('2026-09-05T00:00:10.000Z'),
    limit: 6,
  })
  assert.deepEqual(
    candidates.map((candidate) => candidate.amountIn),
    [25_000_000n, 10_000_000n],
  )
})

test('checked-in historical fork fixture preserves its reviewed route identity', () => {
  const snapshot = JSON.parse(
    fs.readFileSync(nodePath.join(root, 'test', 'fixtures', 'generic-sigma-54406832.json'), 'utf8'),
  )
  const candidate = buildGenericExecutionCandidate(snapshot, { nowMs: Date.parse(snapshot.generatedAt) })
  assert.equal(candidate.candidateHash, '0xb21865f814091515f9f2ffb6cd3c5250340637efd4ce96d8926c43d6010cc1e7')
  assert.equal(candidate.executionKey, '0xc0028ddc63549372a10c10e703e05e70ece2df031eece0115908c137d0cdf877')
  assert.equal(candidate.quoteBlockNumber, 54_406_832n)
})

test('plan builder rejects stale, non-positive and tampered route evidence', () => {
  const writableBoard = snapshotFixture()
  writableBoard.mode = 'SIGNING_ENABLED'
  assert.throws(
    () => buildGenericExecutionCandidate(writableBoard, { nowMs: Date.parse('2026-09-05T00:00:10.000Z') }),
    /read-only boundary/,
  )
  assert.throws(
    () =>
      buildGenericExecutionCandidate(snapshotFixture(), {
        nowMs: Date.parse('2026-09-05T00:01:00.000Z'),
      }),
    /stale/,
  )
  assert.throws(
    () =>
      buildGenericExecutionCandidate(snapshotFixture({ screenedNetUsdg: '-0.1' }), {
        nowMs: Date.parse('2026-09-05T00:00:10.000Z'),
      }),
    /not net-positive/,
  )
  assert.throws(
    () =>
      buildGenericExecutionCandidate(snapshotFixture({ amountOutUsdg: '25.9' }), {
        nowMs: Date.parse('2026-09-05T00:00:10.000Z'),
      }),
    /arithmetic is inconsistent/,
  )
  const tampered = snapshotFixture()
  tampered.items[0].pools[0].hookAddress = '0x0000000000000000000000000000000000000001'
  assert.throws(
    () => buildGenericExecutionCandidate(tampered, { nowMs: Date.parse('2026-09-05T00:00:10.000Z') }),
    /reviewed PAIR pool shape/,
  )
  const mismatchedPoolId = snapshotFixture()
  mismatchedPoolId.items[0].pools[0].poolId = `0x${'1'.repeat(64)}`
  mismatchedPoolId.items[0].legs.entryPoolId = mismatchedPoolId.items[0].pools[0].poolId
  mismatchedPoolId.items[0].routeKey = `${mismatchedPoolId.items[0].pools[0].poolId}:${EXIT_POOL_ID}`
  assert.throws(
    () =>
      buildGenericExecutionCandidate(mismatchedPoolId, {
        nowMs: Date.parse('2026-09-05T00:00:10.000Z'),
      }),
    /canonical PoolKey/,
  )
  assert.throws(
    () =>
      buildGenericExecutionCandidate(snapshotFixture({ amountInUsdg: '100.000001' }), {
        nowMs: Date.parse('2026-09-05T00:00:10.000Z'),
      }),
    /100 USDG cap/,
  )
})
