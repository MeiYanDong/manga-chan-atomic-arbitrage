import assert from 'node:assert/strict'
import test from 'node:test'
import { encodeAbiParameters, getAddress } from 'viem'
import {
  AdapterRunStatus,
  DOPPLER_CREATE_TOPIC,
  LONG_LAUNCH_CREATED_TOPIC,
  SOURCE_ADAPTER_MANIFESTS,
  adaptPairCatalogToken,
  adaptRobinhoodAssets,
  createAdapterStates,
  decodeDopplerCreateLog,
  decodeLongLauncherLog,
  markAdapterError,
  markAdapterSuccess,
  sourceFactsByAsset,
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
