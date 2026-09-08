import assert from 'node:assert/strict'
import test from 'node:test'
import { encodeAbiParameters, getAddress } from 'viem'
import {
  AdapterRunStatus,
  DOPPLER_CREATE_TOPIC,
  LONG_LAUNCH_CREATED_TOPIC,
  SOURCE_ADAPTER_MANIFESTS,
  SOURCE_CATALOG_PROJECTION_VERSION,
  SOURCE_CATALOG_SCHEMA_VERSION,
  SourceFactKind,
  adaptPairCatalogToken,
  adaptRobinhoodAssets,
  assertCompactSourceCatalogProjection,
  boundSourceCatalogPools,
  compactSourceCatalogProjectionInPlace,
  compactSourceFact,
  createAdapterStates,
  decodeDopplerCreateLog,
  decodeLongLauncherLog,
  markAdapterError,
  markAdapterSuccess,
  mergeDopplerTargetFacts,
  planSourceTargetPoolRange,
  retainPoolsForSourceTargets,
  selectVisibleDopplerLaunches,
  sourceFactsByAsset,
  sourceTargetAddresses,
} from '../src/source-adapters.mjs'

const TX = '0xd9bd6b7d5cef0e8cc97838cb8d471b9f323ee6e6ac7aacd7e0146710e1a51a69'
const BLOCK_HASH = '0x352ddaae6aa0e0d8afb49a58f309a1e2771add4e589d5135ca87945028edeaf0'
const NINECAT = getAddress('0x7d3f54f19038d5b819e8730606d048de9d0d1e18')
const AI = getAddress('0x2e8c31162b855a2ffa90f6f8634643ad6f111e18')
const HOOK = getAddress('0x4e3468951d49f2eea976ed0d6e75ffcb44a9a544')
const LAUNCHER = getAddress('0x43831cfaa6c05289ac91361fc930b511eefdbddb')

const addressTopic = (value) => `0x${value.toLowerCase().slice(2).padStart(64, '0')}`

function commonLog(address, topics, data, logIndex) {
  return {
    address,
    topics,
    data,
    blockNumber: '0x2bc0ee7',
    blockHash: BLOCK_HASH,
    transactionHash: TX,
    logIndex,
  }
}

test('LongLauncher adapter decodes the NINECAT launch event deterministically', () => {
  const data = encodeAbiParameters(
    [
      { type: 'address' },
      { type: 'address' },
      { type: 'bytes32' },
      { type: 'uint256' },
      { type: 'uint256' },
      { type: 'string' },
    ],
    [HOOK, LAUNCHER, `0x${'ab'.repeat(32)}`, 1_787_674_987n, 1_787_761_387n, 'NINECAT'],
  )
  const decoded = decodeLongLauncherLog(
    commonLog(
      '0x22e99278308b393ea1260859b181ad7e78f5eeed',
      [LONG_LAUNCH_CREATED_TOPIC, addressTopic(NINECAT), addressTopic(NINECAT), addressTopic(AI)],
      data,
      '0x57',
    ),
  )
  assert.equal(decoded.platformId, 'LONG_ROUTE')
  assert.equal(decoded.poolOrHook, NINECAT)
  assert.equal(decoded.asset, NINECAT)
  assert.equal(decoded.numeraire, AI)
  assert.equal(decoded.poolInitializer, HOOK)
  assert.equal(decoded.launcher, LAUNCHER)
  assert.equal(decoded.normalizedTicker, 'NINECAT')
  assert.equal(decoded.blockNumber, '45879015')
  assert.match(decoded.evidence.payloadHash, /^sha256:[0-9a-f]{64}$/)
})

test('Doppler adapter proves the shared protocol without assigning a platform', () => {
  const data = encodeAbiParameters(
    [{ type: 'address' }, { type: 'address' }, { type: 'address' }],
    [NINECAT, HOOK, NINECAT],
  )
  const decoded = decodeDopplerCreateLog(
    commonLog('0xeb7c034704ef8dcd2d32324c1545f62fb4ad0862', [DOPPLER_CREATE_TOPIC, addressTopic(AI)], data, '0x56'),
  )
  assert.equal(decoded.protocolId, 'DOPPLER')
  assert.equal(Object.hasOwn(decoded, 'platformId'), false)
  assert.equal(decoded.asset, NINECAT)
  assert.equal(decoded.numeraire, AI)
})

test('adapter manifests make execution capabilities explicitly unsupported', () => {
  for (const manifest of SOURCE_ADAPTER_MANIFESTS) {
    assert.equal(manifest.capabilities.sign, 'unsupported')
    assert.equal(manifest.capabilities.broadcast, 'unsupported')
  }
})

test('adapter coverage and failures stay independent', () => {
  const states = createAdapterStates({ configuredStartBlock: 45_000_000 })
  states['long.launcher.v1'] = markAdapterSuccess(states['long.launcher.v1'], {
    status: AdapterRunStatus.COMPLETE_FROM_CONFIGURED_START,
    safeHead: 56_000_000,
    scannedThroughBlock: 56_000_000,
    observations: 3,
  })
  states['pair.catalog.v1'] = markAdapterError(states['pair.catalog.v1'], new Error('metadata HTTP 503'))
  assert.equal(states['long.launcher.v1'].status, AdapterRunStatus.COMPLETE_FROM_CONFIGURED_START)
  assert.equal(states['pair.catalog.v1'].status, AdapterRunStatus.ERROR)
  assert.equal(states['pair.catalog.v1'].lastSuccessAt, null)
})

test('PAIR adapter emits a listing fact, not platform attribution', () => {
  const listing = adaptPairCatalogToken(
    { address: NINECAT },
    { evidenceId: 'pair-api:test', observedAt: '2026-09-07T00:00:00.000Z' },
  )
  assert.equal(listing.claim, 'LISTED_BY_PAIR_API')
  assert.equal(listing.platformId, 'PAIR')
  assert.equal(listing.platformAttribution, undefined)
})

test('Robinhood adapter classifies only exact active deployment addresses', () => {
  const result = adaptRobinhoodAssets(
    {
      assets: [
        {
          status: 'ASSET_STATUS_ACTIVE',
          deployments: [
            { chainId: 4663, contractAddress: '0x1111111111111111111111111111111111111111' },
            { chainId: 1, contractAddress: NINECAT },
          ],
        },
        {
          status: 'ASSET_STATUS_INACTIVE',
          deployments: [{ chainId: 4663, contractAddress: NINECAT }],
        },
      ],
    },
    { evidenceId: 'rh:test', observedAt: '2026-09-07T00:00:00.000Z' },
  )
  assert.deepEqual(result.addresses, [getAddress('0x1111111111111111111111111111111111111111')])
})

test('source facts remain independently queryable by asset', () => {
  const byAsset = sourceFactsByAsset({
    longLaunches: [{ asset: NINECAT }],
    dopplerLaunches: [{ asset: NINECAT }],
    pools: [{ currency0: AI, currency1: NINECAT }],
  })
  const result = byAsset.get(NINECAT.toLowerCase())
  assert.equal(result.longLaunches.length, 1)
  assert.equal(result.dopplerLaunches.length, 1)
  assert.equal(result.pools.length, 1)
})

test('pool retention admits only currencies discovered as source targets', () => {
  const OTHER = getAddress('0x3333333333333333333333333333333333333333')
  const targets = sourceTargetAddresses({
    pairListings: [{ targetAddress: OTHER }],
    longLaunches: [{ asset: NINECAT }],
    dopplerLaunches: [{ asset: NINECAT }],
  })
  const retained = retainPoolsForSourceTargets(
    [
      { poolId: 'ninecat-ai', currency0: NINECAT, currency1: AI },
      { poolId: 'listed-ai', currency0: OTHER, currency1: AI },
      {
        poolId: 'unrelated',
        currency0: getAddress('0x4444444444444444444444444444444444444444'),
        currency1: getAddress('0x5555555555555555555555555555555555555555'),
      },
    ],
    targets,
  )
  assert.deepEqual(
    retained.map((pool) => pool.poolId),
    ['ninecat-ai', 'listed-ai'],
  )
  assert.equal(targets.has(AI.toLowerCase()), false, 'a quote currency must not recursively expand the target set')
})

test('startup catalog migration records the bounded retention decision', () => {
  const migrated = boundSourceCatalogPools(
    {
      generatedAt: '2026-09-07T00:00:00.000Z',
      pairListings: [],
      longLaunches: [{ asset: NINECAT }],
      dopplerLaunches: [],
      pools: [
        { poolId: 'ninecat-ai', currency0: NINECAT, currency1: AI },
        {
          poolId: 'unrelated',
          currency0: getAddress('0x4444444444444444444444444444444444444444'),
          currency1: getAddress('0x5555555555555555555555555555555555555555'),
        },
      ],
    },
    { observedAt: '2026-09-07T01:00:00.000Z' },
  )
  assert.equal(migrated.changed, true)
  assert.equal(migrated.sourceCatalog.pools.length, 1)
  assert.equal(migrated.retention.prunedPools, 1)
  assert.equal(migrated.sourceCatalog.summary.poolRetention.policy, 'SOURCE_TARGET_CURRENCY_ONLY')
})

test('compact source facts keep provenance identity without duplicating evidence payloads', () => {
  const decoded = {
    adapterId: 'doppler.registry.v1',
    asset: NINECAT,
    numeraire: AI,
    blockNumber: '45879015',
    evidence: { evidenceId: `rh:4663:log:${TX}:86`, payload: { duplicated: true } },
  }
  const compact = compactSourceFact(decoded)
  assert.equal(compact.evidenceId, decoded.evidence.evidenceId)
  assert.equal(Object.hasOwn(compact, 'evidence'), false)
  const index = mergeDopplerTargetFacts([], [decoded])
  const targets = sourceTargetAddresses({ dopplerTargetIndex: index })
  assert.equal(targets.has(NINECAT.toLowerCase()), true)
})

test('restart projection keeps route identity while moving duplicate receipt fields to evidence storage', () => {
  const poolId = `0x${'cd'.repeat(32)}`
  const legacy = {
    schemaVersion: 4,
    pairListings: [],
    longLaunches: [
      {
        adapterId: 'long.launcher.v1',
        platformId: 'LONG_ROUTE',
        attributionStatus: 'CHAIN_ATTESTED',
        entryContract: '0x22e99278308B393ea1260859B181AD7E78f5eeED',
        asset: NINECAT,
        numeraire: AI,
        normalizedTicker: 'NINECAT',
        blockNumber: '45879015',
        blockHash: BLOCK_HASH,
        transactionHash: TX,
        logIndex: 86,
        evidenceId: `rh:4663:log:${TX}:86`,
      },
    ],
    dopplerLaunches: [
      {
        adapterId: 'doppler.registry.v1',
        protocolId: 'DOPPLER',
        asset: NINECAT,
        numeraire: AI,
        blockNumber: '45879015',
        blockHash: BLOCK_HASH,
        transactionHash: TX,
        logIndex: 87,
        evidenceId: `rh:4663:log:${TX}:87`,
      },
    ],
    dopplerTargetIndex: [],
    pools: [
      {
        adapterId: 'uniswap-v4.pool-manager.v1',
        venueId: 'UNISWAP_V4',
        attributionStatus: 'CHAIN_ATTESTED',
        poolManager: '0x8366a39cc670B4001a1121b8f6a443a643e40951',
        poolId,
        currency0: AI,
        currency1: NINECAT,
        fee: 3_000,
        tickSpacing: 60,
        hooks: HOOK,
        blockNumber: '45879016',
        blockHash: BLOCK_HASH,
        transactionHash: TX,
        logIndex: 88,
        evidenceId: `rh:4663:log:${TX}:88`,
      },
    ],
  }
  const beforeTargets = sourceTargetAddresses(legacy)
  const result = compactSourceCatalogProjectionInPlace(legacy)
  assert.equal(result.changed, true)
  assert.equal(legacy.schemaVersion, SOURCE_CATALOG_SCHEMA_VERSION)
  assert.equal(legacy.runtimeProjection.version, SOURCE_CATALOG_PROJECTION_VERSION)
  assert.equal(Object.hasOwn(legacy, 'dopplerLaunches'), false)
  assert.deepEqual(Object.keys(legacy.longLaunches[0]), [
    'asset',
    'numeraire',
    'normalizedTicker',
    'blockNumber',
    'evidenceId',
  ])
  assert.deepEqual(
    compactSourceFact(legacy.pools[0], SourceFactKind.POOL),
    legacy.pools[0],
    'every executable PoolKey field must survive compaction',
  )
  assert.deepEqual(sourceTargetAddresses(legacy), beforeTargets)
  assert.equal(legacy.dopplerTargetIndex[0].evidenceId, `rh:4663:log:${TX}:87`)
  assert.deepEqual(assertCompactSourceCatalogProjection(legacy), {
    schemaVersion: SOURCE_CATALOG_SCHEMA_VERSION,
    projectionVersion: SOURCE_CATALOG_PROJECTION_VERSION,
    longLaunches: 1,
    dopplerTargets: 1,
    pools: 1,
  })
  assert.equal(compactSourceCatalogProjectionInPlace(legacy).changed, false, 'migration must be idempotent')
})

test('a compact Doppler target index keeps later pools discoverable after launch details are pruned', () => {
  const catalog = {
    pairListings: [],
    longLaunches: [],
    dopplerLaunches: [],
    dopplerTargetIndex: [{ asset: NINECAT, numeraire: AI, blockNumber: '45879015', evidenceId: 'doppler:ninecat' }],
    pools: [
      { poolId: 'ninecat-ai', currency0: NINECAT, currency1: AI },
      {
        poolId: 'unrelated',
        currency0: getAddress('0x4444444444444444444444444444444444444444'),
        currency1: getAddress('0x5555555555555555555555555555555555555555'),
      },
    ],
  }
  const bounded = boundSourceCatalogPools(catalog)
  assert.deepEqual(
    bounded.sourceCatalog.pools.map((pool) => pool.poolId),
    ['ninecat-ai'],
  )
})

test('Doppler rows retain only explicit, multi-pool or not-yet-scanned targets', () => {
  const MULTI = getAddress('0x6666666666666666666666666666666666666666')
  const SINGLE = getAddress('0x7777777777777777777777777777777777777777')
  const PENDING = getAddress('0x8888888888888888888888888888888888888888')
  const target = (asset, blockNumber) => ({ asset, numeraire: AI, blockNumber, evidenceId: `target:${asset}` })
  const visible = selectVisibleDopplerLaunches({
    dopplerTargetIndex: [target(NINECAT, '100'), target(MULTI, '101'), target(SINGLE, '102'), target(PENDING, '200')],
    pools: [
      { currency0: NINECAT, currency1: AI },
      { currency0: MULTI, currency1: AI },
      { currency0: MULTI, currency1: NINECAT },
      { currency0: SINGLE, currency1: AI },
    ],
    longLaunches: [{ asset: NINECAT }],
    poolCursor: 150n,
  })
  assert.deepEqual(
    visible.map((item) => item.asset),
    [NINECAT, MULTI, PENDING],
  )
})

test('pool backfill never outruns either launch adapter', () => {
  assert.equal(
    planSourceTargetPoolRange({
      cursor: 45_000_000n,
      longCursor: 45_050_000n,
      dopplerCursor: 45_000_000n,
      safeHead: 56_000_000n,
      blockRange: 50_000n,
    }),
    null,
  )
  assert.deepEqual(
    planSourceTargetPoolRange({
      cursor: 45_000_000n,
      longCursor: 45_050_000n,
      dopplerCursor: 45_050_000n,
      safeHead: 56_000_000n,
      blockRange: 50_000n,
    }),
    {
      fromBlock: 45_000_000n,
      toBlock: 45_049_999n,
      poolSafeHead: 45_049_999n,
    },
  )
})
