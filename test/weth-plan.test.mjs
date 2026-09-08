import assert from 'node:assert/strict'
import test from 'node:test'
import { encodePacked } from 'viem'
import { GENERIC_PAIR_HOOK, GENERIC_USDG, GENERIC_WETH, pairPoolId } from '../src/generic-plan.mjs'
import { BoardStatus } from '../src/opportunity-board.mjs'
import { PoolAdmission, PoolEvidence } from '../src/pair-catalog.mjs'
import { buildWethExecutionCandidates } from '../src/weth-plan.mjs'

const TARGET = '0x3363Cd5019Aa1F3E50C73086d5F5dCab3D90f558'
const ENTRY = '0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9'
const EXIT = '0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC'

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

function snapshotFixture(laneOverrides = {}) {
  const blockNumber = '55000000'
  const blockHash = `0x${'a'.repeat(64)}`
  const pools = [
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
  ]
  for (const pool of pools) {
    pool.poolIdEvidence = PoolEvidence.POOL_KEY_MATCHED
    pool.executionAdmission = PoolAdmission.EXECUTOR_COMPATIBLE
    pool.chainAttestation = {
      status: PoolEvidence.INITIALIZED_QUOTER_CONFIRMED,
      blockNumber,
      blockHash,
    }
  }
  const lane = {
    baseAsset: 'WETH',
    baseToken: GENERIC_WETH,
    baseDecimals: 18,
    status: BoardStatus.SCREENED_POSITIVE,
    fresh: true,
    quotedAt: '2026-09-08T00:00:00.000Z',
    blockNumber,
    blockHash,
    route: 'ENTRY → SPX → EXIT',
    routeKey: `${ENTRY_POOL_ID}:${EXIT_POOL_ID}`,
    amountInBase: '0.004',
    amountOutBase: '0.0045',
    grossProfitBase: '0.0005',
    gasCostProxyBase: '0.0003',
    screenedNetBase: '0.0002',
    normalizedScreenedNetUsdg: '0.5',
    amountQuotes: [],
    entryV3Path: path([GENERIC_WETH, ENTRY], [500]),
    exitV3Path: path([EXIT, GENERIC_USDG, GENERIC_WETH], [500, 100]),
    legs: {
      entryPoolId: ENTRY_POOL_ID,
      entryV3Fees: [500],
      entryV3Hops: 1,
      exitPoolId: EXIT_POOL_ID,
      exitV3Fees: [500, 100],
      exitV3Hops: 2,
    },
    ...laneOverrides,
  }
  return {
    schemaVersion: 5,
    service: 'manga-opportunity-board',
    mode: 'READ_ONLY_NO_SIGNING_NO_BROADCAST',
    health: { signerLoaded: false },
    selection: { id: null, executionAuthorized: false },
    baseSelection: { id: TARGET.toLowerCase(), baseAsset: 'WETH', executionAuthorized: false },
    items: [
      {
        id: TARGET.toLowerCase(),
        tokenAddress: TARGET,
        symbol: 'SPX',
        status: BoardStatus.NO_EDGE,
        fresh: true,
        pools,
        baseOpportunities: { WETH: lane },
      },
    ],
  }
}

test('fresh WETH lane becomes an independently validated typed candidate', () => {
  const [candidate] = buildWethExecutionCandidates(snapshotFixture(), {
    nowMs: Date.parse('2026-09-08T00:00:10.000Z'),
  })
  assert.equal(candidate.baseAsset, 'WETH')
  assert.equal(candidate.amountIn, 4_000_000_000_000_000n)
  assert.equal(candidate.screenedNetProfit, 200_000_000_000_000n)
  assert.equal(candidate.normalizedScreenedNetUsdg, 500_000n)
  assert.equal(candidate.route.entryV3Path, path([GENERIC_WETH, ENTRY], [500]))
  assert.match(candidate.executionKey, /^0x[0-9a-f]{64}$/)
})

test('WETH planner rejects arithmetic tampering, stale evidence and a non-USDG two-hop bridge', () => {
  assert.throws(
    () =>
      buildWethExecutionCandidates(snapshotFixture({ screenedNetBase: '0.0003' }), {
        nowMs: Date.parse('2026-09-08T00:00:10.000Z'),
      }),
    /no fresh typed WETH/,
  )
  assert.throws(
    () =>
      buildWethExecutionCandidates(snapshotFixture(), {
        nowMs: Date.parse('2026-09-08T00:02:00.000Z'),
        maxAgeMs: 30_000,
      }),
    /no fresh typed WETH/,
  )
  assert.throws(
    () =>
      buildWethExecutionCandidates(snapshotFixture({ exitV3Path: path([EXIT, TARGET, GENERIC_WETH], [500, 100]) }), {
        nowMs: Date.parse('2026-09-08T00:00:10.000Z'),
      }),
    /no fresh typed WETH/,
  )
})

test('WETH planner requires the signer-free dual-base board boundary', () => {
  const signerLoaded = snapshotFixture()
  signerLoaded.health.signerLoaded = true
  assert.throws(() => buildWethExecutionCandidates(signerLoaded), /signer-free dual-base boundary/)

  const executionAuthorized = snapshotFixture()
  executionAuthorized.baseSelection.executionAuthorized = true
  assert.throws(() => buildWethExecutionCandidates(executionAuthorized), /signer-free dual-base boundary/)
})

test('WETH planner keeps the strongest unique amount variants', () => {
  const first = snapshotFixture().items[0].baseOpportunities.WETH
  const snapshot = snapshotFixture({
    amountQuotes: [
      {
        ...first,
        amountInBase: '0.002',
        amountOutBase: '0.00235',
        grossProfitBase: '0.00035',
        screenedNetBase: '0.00005',
        normalizedScreenedNetUsdg: '0.125',
      },
      {
        ...first,
        amountInBase: '0.004',
        amountOutBase: '0.0045',
        grossProfitBase: '0.0005',
        screenedNetBase: '0.0002',
        normalizedScreenedNetUsdg: '0.5',
      },
    ],
  })
  const candidates = buildWethExecutionCandidates(snapshot, {
    nowMs: Date.parse('2026-09-08T00:00:10.000Z'),
  })
  assert.equal(candidates.length, 2)
  assert.equal(candidates[0].amountIn, 4_000_000_000_000_000n)
})
