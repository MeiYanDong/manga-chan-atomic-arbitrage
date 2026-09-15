import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  GLOBAL_GRAPH_POLICY,
  buildUnifiedLiquidityGraph,
  enumerateAtomicSwapCycles,
} from '../src/global-liquidity-graph.mjs'
import {
  GLOBAL_UNIVERSE_POLICY,
  assertGlobalUniverseProjection,
  buildGlobalUniverseProjection,
  classifyGlobalUniverseAccess,
  mergeGlobalUniverseProjection,
  readGlobalUniverseFile,
} from '../src/global-universe-projection.mjs'
import { PoolAdmission, canonicalPoolKey, pairPoolId } from '../src/pair-catalog.mjs'

const USDG = '0x0000000000000000000000000000000000000001'
const WETH = '0x0000000000000000000000000000000000000002'
const TARGET = '0x0000000000000000000000000000000000000003'
const QUOTE = '0x0000000000000000000000000000000000000004'
const HOOK = '0x0000000000000000000000000000000000000005'
const V3_POOL = '0x0000000000000000000000000000000000000011'
const SOURCE_HASH = `sha256:${'1'.repeat(64)}`

function pool(target, quote, overrides = {}) {
  const poolKey = canonicalPoolKey(
    target,
    quote,
    overrides.fee ?? 3_000,
    overrides.tickSpacing ?? 60,
    overrides.hooks ?? HOOK,
  )
  return {
    poolId: pairPoolId(poolKey),
    poolKey,
    fee: poolKey.fee,
    tickSpacing: poolKey.tickSpacing,
    hookAddress: poolKey.hooks,
    shadowEligible: true,
    executionAdmission: overrides.executionAdmission || PoolAdmission.SHADOW_ONLY_UNSUPPORTED_HOOK,
    sourceAdapterId: 'uniswap-v4.pool-manager.v1',
    sourceBlockNumber: String(overrides.blockNumber ?? 100),
  }
}

function candidate(target = TARGET, overrides = {}) {
  return {
    id: target.toLowerCase(),
    tokenAddress: target,
    symbol: overrides.symbol || 'TARGET',
    pools: overrides.pools || [pool(target, USDG), pool(target, WETH, { fee: 500, tickSpacing: 10 })],
  }
}

function projection(overrides = {}) {
  return buildGlobalUniverseProjection({
    candidates: overrides.candidates || [candidate()],
    sourceCatalogHash: overrides.sourceCatalogHash || SOURCE_HASH,
    safeHead: overrides.safeHead ?? '123',
    generatedAt: overrides.generatedAt || '2026-09-15T00:00:00.000Z',
    rotationOffset: overrides.rotationOffset || 0,
    settlementTokens: [USDG, WETH],
  })
}

test('builds a bounded signer-free projection with explicit execution capability', () => {
  const value = projection()
  assert.equal(value.mode, 'READ_ONLY_NO_SIGNING_NO_BROADCAST')
  assert.equal(value.targets.length, 1)
  assert.equal(value.assets.length, 3)
  assert.equal(value.v4Pools.length, 2)
  assert.equal(value.summary.exactSimulationRequiredPools, 2)
  assert.match(value.topologyHash, /^sha256:[0-9a-f]{64}$/)
  assert.equal(assertGlobalUniverseProjection(value), value)
})

test('timestamp and source-cursor generations do not invalidate identical topology', () => {
  const first = projection()
  const second = projection({
    generatedAt: '2026-09-15T00:01:00.000Z',
    sourceCatalogHash: `sha256:${'2'.repeat(64)}`,
    safeHead: '124',
    candidates: [candidate(TARGET, { symbol: 'RENAMED' })],
  })
  assert.equal(first.topologyHash, second.topologyHash)

  const changed = projection({
    candidates: [
      candidate(TARGET, {
        pools: [
          pool(TARGET, USDG),
          pool(TARGET, WETH, { fee: 500, tickSpacing: 10 }),
          pool(TARGET, QUOTE, { fee: 10_000, tickSpacing: 200 }),
        ],
      }),
    ],
  })
  assert.notEqual(first.topologyHash, changed.topologyHash)
})

test('malformed and over-capacity candidates remain explicit instead of entering the graph', () => {
  const candidates = [{ ...candidate(), pools: [{ ...pool(TARGET, USDG), poolId: `0x${'0'.repeat(64)}` }] }]
  for (let index = 0; index < GLOBAL_UNIVERSE_POLICY.maximumTargets + 20; index += 1) {
    const target = `0x${(index + 100).toString(16).padStart(40, '0')}`
    const quoteA = `0x${(index + 10_000).toString(16).padStart(40, '0')}`
    const quoteB = index % 2 === 0 ? USDG : WETH
    candidates.push(candidate(target, { pools: [pool(target, quoteA), pool(target, quoteB, { fee: 500 })] }))
  }
  const value = projection({ candidates })
  assert.ok(value.targets.length <= GLOBAL_UNIVERSE_POLICY.maximumTargets)
  assert.ok(value.assets.length <= GLOBAL_UNIVERSE_POLICY.maximumAssets)
  assert.ok(value.v4Pools.length <= GLOBAL_UNIVERSE_POLICY.maximumPools)
  assert.equal(value.summary.invalidCandidates, 1)
  assert.ok(value.summary.capacityRejectedCandidates > 0)
  assert.ok(value.rejected.some((item) => /pool key does not match/i.test(item.reason)))
  assert.ok(value.rejected.some((item) => /capacity reached/i.test(item.reason)))
})

test('retains a stable priority tranche while rotating bounded coverage across the long tail', () => {
  const candidates = []
  for (let index = 0; index < GLOBAL_UNIVERSE_POLICY.maximumTargets + 80; index += 1) {
    const target = `0x${(index + 1_000).toString(16).padStart(40, '0')}`
    const quote = `0x${(index + 10_000).toString(16).padStart(40, '0')}`
    candidates.push(candidate(target, { pools: [pool(target, WETH), pool(target, quote, { fee: 500 })] }))
  }
  const first = projection({ candidates, rotationOffset: 0 })
  const rotated = projection({ candidates, rotationOffset: 120 })
  const priority = candidates.slice(0, GLOBAL_UNIVERSE_POLICY.priorityTargets).map((item) => item.tokenAddress)
  const firstTargets = new Set(first.targets.map((item) => item.token.toLowerCase()))
  const rotatedTargets = new Set(rotated.targets.map((item) => item.token.toLowerCase()))
  assert.ok(priority.every((target) => firstTargets.has(target.toLowerCase())))
  assert.ok(priority.every((target) => rotatedTargets.has(target.toLowerCase())))
  assert.notDeepEqual(first.targets, rotated.targets)
  assert.notEqual(first.topologyHash, rotated.topologyHash)
})

test('access classification rejects stale, malformed and tampered projections fail-closed', () => {
  const value = projection()
  assert.equal(classifyGlobalUniverseAccess(value, { now: Date.parse('2026-09-15T00:14:59.000Z') }), 'CURRENT')
  assert.equal(classifyGlobalUniverseAccess(value, { now: Date.parse('2026-09-15T00:15:01.000Z') }), 'STALE')
  assert.equal(classifyGlobalUniverseAccess(null), 'MISSING')
  assert.equal(classifyGlobalUniverseAccess({ ...value, topologyHash: `sha256:${'0'.repeat(64)}` }), 'INVALID')
})

test('file handoff accepts only a current non-writable bounded projection', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'manga-global-universe-'))
  const file = path.join(directory, 'global-universe.json')
  try {
    fs.writeFileSync(file, JSON.stringify(projection()), { mode: 0o640 })
    assert.equal(readGlobalUniverseFile(file, { now: Date.parse('2026-09-15T00:01:00.000Z') }).status, 'CURRENT')
    fs.chmodSync(file, 0o660)
    assert.equal(readGlobalUniverseFile(file).status, 'INVALID')
    fs.writeFileSync(file, '{not-json', { mode: 0o640 })
    fs.chmodSync(file, 0o640)
    assert.equal(readGlobalUniverseFile(file).status, 'INVALID')
    const link = path.join(directory, 'linked.json')
    fs.symlinkSync(file, link)
    assert.equal(readGlobalUniverseFile(link).status, 'INVALID')
    assert.equal(readGlobalUniverseFile(path.join(directory, 'missing.json')).status, 'MISSING')
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('projection overlay is route-equivalent to the same complete bounded V4 input', () => {
  const universe = projection()
  const baseUniswap = {
    v2Pools: [],
    v3Pools: [{ address: V3_POOL, token0: USDG, token1: WETH, fee: 100 }],
    v4Pools: [],
  }
  const merged = mergeGlobalUniverseProjection({
    earnPools: [],
    uniswap: baseUniswap,
    projection: universe,
    maximumAssets: GLOBAL_GRAPH_POLICY.maximumAssets,
    maximumSwapEdges: GLOBAL_GRAPH_POLICY.maximumSwapEdges,
  })
  const incrementalGraph = buildUnifiedLiquidityGraph({
    v3Pools: merged.uniswap.v3Pools,
    v4Pools: merged.uniswap.v4Pools,
  })
  const completeGraph = buildUnifiedLiquidityGraph({
    v3Pools: baseUniswap.v3Pools,
    v4Pools: universe.v4Pools,
  })
  assert.equal(merged.universe.admittedPools, 2)
  assert.equal(incrementalGraph.commitment, completeGraph.commitment)
  assert.deepEqual(
    enumerateAtomicSwapCycles(incrementalGraph, USDG, { maximumHops: 3 }).map((item) => item.id),
    enumerateAtomicSwapCycles(completeGraph, USDG, { maximumHops: 3 }).map((item) => item.id),
  )
})

test('counts an identical projection already present in a refreshed base catalog exactly once', () => {
  const universe = projection()
  const merged = mergeGlobalUniverseProjection({
    earnPools: [],
    uniswap: {
      v2Pools: [],
      v3Pools: [],
      v4Pools: universe.v4Pools.map((poolValue) => ({ ...poolValue })),
    },
    projection: universe,
    maximumAssets: GLOBAL_GRAPH_POLICY.maximumAssets,
    maximumSwapEdges: GLOBAL_GRAPH_POLICY.maximumSwapEdges,
  })

  assert.equal(merged.universe.admittedTargets, 1)
  assert.equal(merged.universe.admittedPools, 2)
  assert.equal(merged.universe.capacityRejectedTargets, 0)
  assert.equal(merged.uniswap.v4Pools.length, 2)
})
