import assert from 'node:assert/strict'
import test from 'node:test'

import {
  assessSettlementFunding,
  classifyGlobalSearchReadiness,
  enumerateV3ValuationRoutes,
  GLOBAL_SETTLEMENT_ADMISSION_POLICY,
  globalSettlementSeeds,
  rankDynamicSettlementCandidates,
  selectSettlementSearchRoots,
  selectSettlementFundingCandidates,
} from '../src/global-settlement-assets.mjs'
import { buildUnifiedLiquidityGraph } from '../src/global-liquidity-graph.mjs'

const USDG = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168'
const WETH = '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73'
const EXTRA = '0xA3b6AEe90017b72c0812dC1e013De70eB2917ba3'

test('settlement seed set deduplicates defaults and explicit priorities', () => {
  assert.deepEqual(globalSettlementSeeds([USDG, WETH], `${USDG.toLowerCase()}, ${EXTRA}`), [USDG, WETH, EXTRA])
})

test('settlement seed set rejects malformed and unbounded input', () => {
  assert.throws(() => globalSettlementSeeds([USDG, WETH], 'not-an-address'))
  const extras = Array.from({ length: 15 }, (_, index) => `0x${(index + 10).toString(16).padStart(40, '0')}`)
  assert.throws(() => globalSettlementSeeds([USDG, WETH], extras.join(',')), /2\.\.16/)
})

test('settlement funding requires trustworthy decimals and an actual atomic funding source', () => {
  const candidate = { token: EXTRA, catalogDecimals: 18 }
  const flash = assessSettlementFunding(candidate, { decimals: 18, morphoLiquidity: 7n, inventory: 0n })
  assert.deepEqual(flash.fundingModes, ['MORPHO_FLASH'])
  assert.equal(flash.morphoLiquidity, 7n)
  const inventory = assessSettlementFunding(candidate, { decimals: 18, morphoLiquidity: 0n, inventory: 3n })
  assert.deepEqual(inventory.fundingModes, ['EXECUTOR_INVENTORY'])
  assert.throws(
    () => assessSettlementFunding(candidate, { decimals: 6, morphoLiquidity: 7n, inventory: 0n }),
    /decimals disagree/,
  )
  assert.throws(
    () => assessSettlementFunding(candidate, { decimals: 18, morphoLiquidity: 0n, inventory: 0n }),
    /no Morpho liquidity/,
  )
})

test('settlement valuation probes only V3 paths committed by the unified graph', () => {
  const TOKEN_A = '0x0000000000000000000000000000000000000011'
  const TOKEN_B = '0x0000000000000000000000000000000000000012'
  const graph = buildUnifiedLiquidityGraph({
    v3Pools: [
      {
        address: '0x0000000000000000000000000000000000000021',
        token0: { address: TOKEN_A },
        token1: { address: TOKEN_B },
        fee: 500,
      },
      {
        address: '0x0000000000000000000000000000000000000022',
        token0: { address: TOKEN_A },
        token1: { address: WETH },
        fee: 3_000,
      },
      {
        address: '0x0000000000000000000000000000000000000023',
        token0: { address: WETH },
        token1: { address: TOKEN_B },
        fee: 100,
      },
    ],
  })
  const routes = enumerateV3ValuationRoutes(graph, TOKEN_A, TOKEN_B, WETH)
  assert.deepEqual(
    routes.map((route) => route.fees),
    [[500], [3_000, 100]],
  )
  assert.equal(enumerateV3ValuationRoutes(graph, TOKEN_B, USDG, WETH).length, 0)
})

test('dynamic admission ranks event-touched graph assets without turning seeds into an allowlist', () => {
  const TOKEN_A = '0x0000000000000000000000000000000000000011'
  const TOKEN_B = '0x0000000000000000000000000000000000000012'
  const TOKEN_C = '0x0000000000000000000000000000000000000013'
  const POOL_AB = '0x0000000000000000000000000000000000000021'
  const graph = buildUnifiedLiquidityGraph({
    earnPools: [
      { address: POOL_AB, initialized: true, tokens: [{ address: TOKEN_A }, { address: TOKEN_B }] },
      {
        address: '0x0000000000000000000000000000000000000022',
        initialized: true,
        tokens: [{ address: TOKEN_B }, { address: TOKEN_C }],
      },
      {
        address: '0x0000000000000000000000000000000000000023',
        initialized: true,
        tokens: [{ address: TOKEN_C }, { address: TOKEN_A }],
      },
    ],
  })
  const ranked = rankDynamicSettlementCandidates(graph, {
    seeds: [USDG, WETH],
    wakeAddresses: [POOL_AB],
  })
  assert.equal(ranked.policy, GLOBAL_SETTLEMENT_ADMISSION_POLICY)
  assert.equal(ranked.candidates.length, 5)
  assert.deepEqual(new Set(ranked.candidates.slice(0, 2).map((item) => item.token)), new Set([USDG, WETH]))
  assert.deepEqual(
    ranked.candidates.slice(2, 4).map((item) => item.token),
    [TOKEN_A, TOKEN_B],
  )
  assert.ok(ranked.candidates.some((item) => item.token === TOKEN_C && !item.seeded))
  assert.ok(ranked.candidates.some((item) => item.token === USDG && item.seeded))
})

test('dynamic admission is deterministically bounded before any RPC funding checks', () => {
  const pools = Array.from({ length: 20 }, (_, index) => ({
    address: `0x${(index + 100).toString(16).padStart(40, '0')}`,
    initialized: true,
    tokens: [
      { address: `0x${(index + 200).toString(16).padStart(40, '0')}` },
      { address: `0x${(((index + 1) % 20) + 200).toString(16).padStart(40, '0')}` },
    ],
  }))
  const ranked = rankDynamicSettlementCandidates(buildUnifiedLiquidityGraph({ earnPools: pools }), {
    seeds: [USDG, WETH],
    maximum: 8,
  })
  assert.equal(ranked.candidates.length, 8)
  assert.ok(ranked.deferred > 0)
  const rotated = rankDynamicSettlementCandidates(buildUnifiedLiquidityGraph({ earnPools: pools }), {
    seeds: [USDG, WETH],
    maximum: 8,
    rotationOffset: 7n,
  })
  assert.deepEqual(new Set(rotated.candidates.slice(0, 2).map((item) => item.token)), new Set([USDG, WETH]))
  assert.notDeepEqual(
    rotated.candidates.slice(2).map((item) => item.token),
    ranked.candidates.slice(2).map((item) => item.token),
  )
})

test('event funding checks cover only seeds and touched assets while recovery rotates broadly', () => {
  const ranked = {
    structurallyEligible: 5,
    deferred: 1,
    candidates: [
      { token: USDG, seeded: true, eventTouched: false },
      { token: EXTRA, seeded: false, eventTouched: true },
      { token: WETH, seeded: false, eventTouched: false },
      { token: '0x0000000000000000000000000000000000000011', seeded: false, eventTouched: false },
    ],
  }
  const event = selectSettlementFundingCandidates(ranked, { eventWake: true })
  assert.deepEqual(
    event.candidates.map((candidate) => candidate.token),
    [USDG, EXTRA],
  )
  assert.equal(event.admissionScope, 'SEEDS_AND_EVENT_TOUCHED')
  assert.equal(event.deferred, 3)
  const recovery = selectSettlementFundingCandidates(ranked)
  assert.equal(recovery.candidates.length, 4)
  assert.equal(recovery.admissionScope, 'ROTATING_GRAPH_RECOVERY')
  assert.equal(recovery.deferred, 1)
})

test('search roots retain graph-present seeds independently from atomic funding', () => {
  const graph = buildUnifiedLiquidityGraph({
    v3Pools: [
      {
        address: '0x0000000000000000000000000000000000000021',
        token0: USDG,
        token1: WETH,
        fee: 100,
      },
    ],
  })
  assert.deepEqual(selectSettlementSearchRoots(graph, { seeds: [USDG, WETH], admitted: [] }), [USDG, WETH])
  assert.throws(
    () => selectSettlementSearchRoots(graph, { seeds: [USDG, WETH], admitted: [{ token: EXTRA }] }),
    /absent from the graph/,
  )
})

test('readiness never turns a funding block or incomplete evidence into no-profit', () => {
  assert.deepEqual(
    classifyGlobalSearchReadiness({
      selected: false,
      searchableRouteCount: 12,
      fundedCount: 0,
      fundingEvidenceComplete: true,
      evaluationValid: 0,
      evaluationCoverage: 'COMPLETE',
    }),
    {
      status: 'NO_EXECUTABLE_FUNDING',
      evidenceCoverage: 'PARTIAL',
      fundingBlocked: true,
      evaluationIncomplete: false,
    },
  )
  assert.equal(
    classifyGlobalSearchReadiness({
      selected: false,
      searchableRouteCount: 12,
      fundedCount: 0,
      fundingEvidenceComplete: false,
      evaluationValid: 0,
      evaluationCoverage: 'UNAVAILABLE',
    }).status,
    'EVALUATION_INCOMPLETE_NO_SIGNATURE',
  )
  assert.equal(
    classifyGlobalSearchReadiness({
      selected: false,
      searchableRouteCount: 12,
      fundedCount: 1,
      fundingEvidenceComplete: true,
      evaluationValid: 1,
      evaluationCoverage: 'COMPLETE',
    }).status,
    'NO_EXACT_NET_OPPORTUNITY',
  )
})
