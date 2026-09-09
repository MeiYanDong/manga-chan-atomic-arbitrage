import assert from 'node:assert/strict'
import test from 'node:test'
import { encodeAbiParameters, encodeEventTopics, getAddress } from 'viem'
import {
  OBSERVED_LAUNCH_V2_HOOK,
  OFFICIAL_PAIR_HOOK,
  PoolAdmission,
  PoolEvidence,
  V4_INITIALIZE_EVENT,
  V4_INITIALIZE_TOPIC,
  canonicalPoolKey,
  decodePoolManagerLog,
  inferPairLaunchPools,
  mergeApiAndChainCatalog,
  mergeChainPools,
  normalizeApiPool,
  pairPoolId,
} from '../src/pair-catalog.mjs'

const TARGET = getAddress('0x9a4b94ac36433b0fdefea6ebbabb1ced7e4a5555')
const QUOTE_A = getAddress('0x0bd7d308f8e1639fab988df18a8011f41eacad73')
const QUOTE_B = getAddress('0x322f0929c4625ed5bad873c95208d54e1c003b2d')

function apiPair(overrides = {}) {
  const hookAddress = overrides.hookAddress || OFFICIAL_PAIR_HOOK
  const quoteAddress = overrides.quoteAddress || QUOTE_A
  const key = canonicalPoolKey(TARGET, quoteAddress, 10_000, 200, hookAddress)
  return {
    poolId: pairPoolId(key),
    canonical: true,
    ammVersion: 'V4_MULTI',
    hookAddress,
    poolFee: 10_000,
    tickSpacing: 200,
    activeVirtualSwapDepthUsd: '250.5',
    quoteToken: { address: quoteAddress, symbol: 'QUOTE', decimals: 18, enabled: true },
    ...overrides,
  }
}

function initializeLog({ target = TARGET, quote, transactionHash, logIndex }) {
  const key = canonicalPoolKey(target, quote, 10_000, 200, OFFICIAL_PAIR_HOOK)
  return {
    address: getAddress('0x8366a39CC670B4001A1121B8F6A443A643e40951'),
    topics: encodeEventTopics({
      abi: [V4_INITIALIZE_EVENT],
      eventName: 'Initialize',
      args: { id: pairPoolId(key), currency0: key.currency0, currency1: key.currency1 },
    }),
    data: encodeAbiParameters(
      [{ type: 'uint24' }, { type: 'int24' }, { type: 'address' }, { type: 'uint160' }, { type: 'int24' }],
      [10_000, 200, OFFICIAL_PAIR_HOOK, 123n, -42],
    ),
    blockNumber: '0x2c72a00',
    blockHash: `0x${'a'.repeat(64)}`,
    transactionHash,
    logIndex: `0x${logIndex.toString(16)}`,
  }
}

test('API metadata stays separate from PoolKey and fixed-block chain evidence', () => {
  const pair = apiPair()
  const withoutChain = normalizeApiPool(TARGET, pair, {
    minDepthUsd: 100,
    quoteAssetAddresses: new Set([QUOTE_A.toLowerCase()]),
  })
  assert.equal(withoutChain.poolIdEvidence, PoolEvidence.POOL_KEY_MATCHED)
  assert.equal(withoutChain.executionAdmission, PoolAdmission.SHADOW_ONLY_CHAIN_ATTESTATION_UNKNOWN)
  assert.equal(withoutChain.shadowEligible, true)

  const attested = normalizeApiPool(TARGET, pair, {
    minDepthUsd: 100,
    chainAttestations: new Map([
      [pair.poolId, { status: PoolEvidence.INITIALIZED_QUOTER_CONFIRMED, blockNumber: '56500000' }],
    ]),
  })
  assert.equal(attested.executionAdmission, PoolAdmission.EXECUTOR_COMPATIBLE)
})

test('disabled, depth-unknown, shallow, new-hook and mismatched pools fail closed independently', () => {
  const disabled = normalizeApiPool(
    TARGET,
    apiPair({ quoteToken: { address: QUOTE_A, symbol: 'AI', decimals: 18, enabled: false } }),
    { minDepthUsd: 100 },
  )
  assert.equal(disabled.executionAdmission, PoolAdmission.SHADOW_ONLY_DISABLED_QUOTE)
  assert.equal(disabled.shadowEligible, true)

  const unknownDepth = normalizeApiPool(TARGET, apiPair({ activeVirtualSwapDepthUsd: null }), { minDepthUsd: 100 })
  assert.equal(unknownDepth.executionAdmission, PoolAdmission.SHADOW_ONLY_DEPTH_UNKNOWN)
  assert.equal(unknownDepth.shadowEligible, true)

  const shallow = normalizeApiPool(TARGET, apiPair({ activeVirtualSwapDepthUsd: '99.99' }), { minDepthUsd: 100 })
  assert.equal(shallow.executionAdmission, PoolAdmission.QUARANTINED_SHALLOW)
  assert.equal(shallow.shadowEligible, false)

  const launchV2 = normalizeApiPool(
    TARGET,
    apiPair({
      hookAddress: OBSERVED_LAUNCH_V2_HOOK,
      poolId: pairPoolId(canonicalPoolKey(TARGET, QUOTE_A, 10_000, 200, OBSERVED_LAUNCH_V2_HOOK)),
    }),
    {
      minDepthUsd: 100,
      chainAttestations: new Map([
        [
          pairPoolId(canonicalPoolKey(TARGET, QUOTE_A, 10_000, 200, OBSERVED_LAUNCH_V2_HOOK)),
          { status: PoolEvidence.INITIALIZED_QUOTER_CONFIRMED },
        ],
      ]),
    },
  )
  assert.equal(launchV2.executionAdmission, PoolAdmission.SHADOW_ONLY_UNSUPPORTED_HOOK)

  const mismatch = normalizeApiPool(TARGET, apiPair({ poolId: `0x${'1'.repeat(64)}` }), { minDepthUsd: 100 })
  assert.equal(mismatch.executionAdmission, PoolAdmission.QUARANTINED_POOL_KEY_MISMATCH)
  assert.equal(mismatch.shadowEligible, false)

  const chainAttestedUnknownHook = normalizeApiPool(
    TARGET,
    apiPair({
      hookAddress: getAddress('0x7777777777777777777777777777777777777777'),
      poolId: pairPoolId(canonicalPoolKey(TARGET, QUOTE_A, 10_000, 200, '0x7777777777777777777777777777777777777777')),
      chainSourceAttested: true,
    }),
    { minDepthUsd: 100 },
  )
  assert.equal(chainAttestedUnknownHook.shadowEligible, true)
  assert.equal(chainAttestedUnknownHook.executionAdmission, PoolAdmission.SHADOW_ONLY_UNSUPPORTED_HOOK)
  assert.equal(chainAttestedUnknownHook.apiCanonicalClaim, false)
})

test('Initialize log decoding reproduces the canonical PoolKey and multi-pool launch target', () => {
  assert.equal(V4_INITIALIZE_TOPIC, '0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438')
  const transactionHash = `0x${'b'.repeat(64)}`
  const decoded = [
    decodePoolManagerLog(initializeLog({ quote: QUOTE_A, transactionHash, logIndex: 1 })),
    decodePoolManagerLog(initializeLog({ quote: QUOTE_B, transactionHash, logIndex: 2 })),
  ]
  assert.equal(decoded[0].type, 'V4_INITIALIZE')
  assert.equal(decoded[0].tick, -42)
  const inferred = inferPairLaunchPools(decoded, new Set())
  assert.equal(inferred.ambiguities.length, 0)
  assert.equal(inferred.pools.length, 2)
  assert.equal(inferred.pools[0].targetAddress, TARGET)
  assert.equal(inferred.pools[0].computedPoolId, inferred.pools[0].poolId)
  assert.equal(inferred.pools[0].inference, 'MULTI_POOL_TRANSACTION_INTERSECTION')
})

test('single-pool inference requires one known quote and merge remains idempotent', () => {
  const transactionHash = `0x${'c'.repeat(64)}`
  const event = decodePoolManagerLog(initializeLog({ quote: QUOTE_A, transactionHash, logIndex: 0 }))
  const ambiguous = inferPairLaunchPools([event], new Set())
  assert.equal(ambiguous.pools.length, 0)
  assert.equal(ambiguous.ambiguities[0].reason, 'TARGET_TOKEN_AMBIGUOUS')

  const inferred = inferPairLaunchPools([event], new Set([QUOTE_A.toLowerCase()]))
  assert.equal(inferred.pools[0].targetAddress, TARGET)
  assert.equal(inferred.pools[0].inference, 'SINGLE_POOL_KNOWN_QUOTE_COMPLEMENT')
  const merged = mergeChainPools(inferred.pools, inferred.pools)
  assert.equal(merged.length, 1)
})

test('chain catalog restores historical pools and address-only targets without inventing depth', () => {
  const transactionHash = `0x${'d'.repeat(64)}`
  const decoded = [
    decodePoolManagerLog(initializeLog({ quote: QUOTE_A, transactionHash, logIndex: 0 })),
    decodePoolManagerLog(initializeLog({ quote: QUOTE_B, transactionHash, logIndex: 1 })),
  ]
  const chainPools = inferPairLaunchPools(decoded).pools
  const merged = mergeApiAndChainCatalog(
    [{ address: TARGET, symbol: 'D', pairs: [apiPair()] }],
    chainPools,
    new Map([[QUOTE_B.toLowerCase(), { symbol: 'TSLA', decimals: 18, enabled: true }]]),
  )
  assert.equal(merged.length, 1)
  assert.equal(merged[0].pairs.length, 2)
  const restored = merged[0].pairs.find((pool) => pool.quoteToken.address === QUOTE_B)
  assert.equal(restored.chainDiscovered, true)
  assert.equal(restored.activeVirtualSwapDepthUsd, null)

  const newTarget = getAddress('0x1111111111111111111111111111111111111111')
  const syntheticKey = canonicalPoolKey(newTarget, QUOTE_A, 10_000, 200, OFFICIAL_PAIR_HOOK)
  const synthetic = mergeApiAndChainCatalog(
    [],
    [
      {
        ...chainPools[0],
        poolId: pairPoolId(syntheticKey),
        computedPoolId: pairPoolId(syntheticKey),
        targetAddress: newTarget,
        quoteAddress: QUOTE_A,
        poolKey: syntheticKey,
      },
    ],
  )
  assert.equal(synthetic[0].symbol, 'CHAIN-111111')
  assert.equal(synthetic[0].catalogSources.includes('POOL_MANAGER_INITIALIZE_LOG'), true)
})
