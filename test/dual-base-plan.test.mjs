import assert from 'node:assert/strict'
import test from 'node:test'
import { encodePacked } from 'viem'
import { buildDualBaseExecutionCandidates } from '../src/dual-base-plan.mjs'
import { GENERIC_PAIR_HOOK, GENERIC_USDG, GENERIC_WETH, pairPoolId } from '../src/generic-plan.mjs'
import { BoardStatus } from '../src/opportunity-board.mjs'
import { PoolAdmission, PoolEvidence } from '../src/pair-catalog.mjs'

const TARGET = '0x3363Cd5019Aa1F3E50C73086d5F5dCab3D90f558'
const ENTRY = '0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9'
const EXIT = '0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC'

function path(tokens, fees) {
  const types = ['address']
  const values = [tokens[0]]
  for (let index = 0; index < fees.length; index += 1) {
    types.push('uint24', 'address')
    values.push(fees[index], tokens[index + 1])
  }
  return encodePacked(types, values)
}

function pool(quote, blockNumber, blockHash) {
  const currency0 = BigInt(TARGET) < BigInt(quote) ? TARGET : quote
  const key = {
    currency0,
    currency1: currency0 === TARGET ? quote : TARGET,
    fee: 10_000,
    tickSpacing: 200,
    hooks: GENERIC_PAIR_HOOK,
  }
  return {
    poolId: pairPoolId(key),
    quoteAddress: quote,
    fee: 10_000,
    tickSpacing: 200,
    hookAddress: GENERIC_PAIR_HOOK,
    poolIdEvidence: PoolEvidence.POOL_KEY_MATCHED,
    executionAdmission: PoolAdmission.EXECUTOR_COMPATIBLE,
    chainAttestation: { status: PoolEvidence.INITIALIZED_QUOTER_CONFIRMED, blockNumber, blockHash },
  }
}

function fixture() {
  const quotedAt = '2026-09-08T00:00:00.000Z'
  const blockNumber = '55000000'
  const blockHash = `0x${'a'.repeat(64)}`
  const entry = pool(ENTRY, blockNumber, blockHash)
  const exit = pool(EXIT, blockNumber, blockHash)
  const legs = {
    entryPoolId: entry.poolId,
    entryV3Fees: [500],
    entryV3Hops: 1,
    exitPoolId: exit.poolId,
    exitV3Fees: [500],
    exitV3Hops: 1,
  }
  const wethLane = {
    baseAsset: 'WETH',
    baseToken: GENERIC_WETH,
    baseDecimals: 18,
    status: BoardStatus.SCREENED_POSITIVE,
    fresh: true,
    quotedAt,
    blockNumber,
    blockHash,
    route: 'ENTRY → SPX → EXIT',
    routeKey: `${entry.poolId}:${exit.poolId}`,
    amountInBase: '0.004',
    amountOutBase: '0.0045',
    grossProfitBase: '0.0005',
    gasCostProxyBase: '0.0002',
    screenedNetBase: '0.0003',
    normalizedScreenedNetUsdg: '0.75',
    amountQuotes: [],
    entryV3Path: path([GENERIC_WETH, ENTRY], [500]),
    exitV3Path: path([EXIT, GENERIC_WETH], [500]),
    legs,
  }
  return {
    schemaVersion: 5,
    service: 'manga-opportunity-board',
    mode: 'READ_ONLY_NO_SIGNING_NO_BROADCAST',
    health: { signerLoaded: false },
    selection: { id: TARGET.toLowerCase(), executionAuthorized: false },
    baseSelection: { id: TARGET.toLowerCase(), baseAsset: 'WETH', executionAuthorized: false },
    items: [
      {
        id: TARGET.toLowerCase(),
        tokenAddress: TARGET,
        symbol: 'SPX',
        status: BoardStatus.SCREENED_POSITIVE,
        fresh: true,
        quotedAt,
        blockNumber,
        blockHash,
        route: 'ENTRY → SPX → EXIT',
        routeKey: `${entry.poolId}:${exit.poolId}`,
        amountInUsdg: '25',
        amountOutUsdg: '25.7',
        grossProfitUsdg: '0.7',
        gasCostProxyUsdg: '0.2',
        screenedNetUsdg: '0.5',
        amountQuotes: [],
        entryV3Path: path([GENERIC_USDG, ENTRY], [500]),
        exitV3Path: path([EXIT, GENERIC_USDG], [500]),
        legs,
        pools: [entry, exit],
        baseOpportunities: { WETH: wethLane },
      },
    ],
  }
}

test('dual-base planner ranks WETH and USDG candidates in normalized USDG', () => {
  const candidates = buildDualBaseExecutionCandidates(fixture(), {
    nowMs: Date.parse('2026-09-08T00:00:10.000Z'),
  })
  assert.equal(candidates.length, 2)
  assert.equal(candidates[0].baseAsset, 'WETH')
  assert.equal(candidates[0].normalizedScreenedNetUsdg, 750_000n)
  assert.equal(candidates[1].baseAsset, 'USDG')
  assert.equal(candidates[1].normalizedScreenedNetUsdg, 500_000n)
})

test('dual-base planner degrades to the independently valid lane', () => {
  const snapshot = fixture()
  snapshot.items[0].baseOpportunities.WETH.screenedNetBase = '0.0004'
  const [candidate] = buildDualBaseExecutionCandidates(snapshot, {
    nowMs: Date.parse('2026-09-08T00:00:10.000Z'),
  })
  assert.equal(candidate.baseAsset, 'USDG')
})
