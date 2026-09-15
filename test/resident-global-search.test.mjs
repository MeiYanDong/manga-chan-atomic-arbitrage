import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import { PassThrough, Writable } from 'node:stream'
import test from 'node:test'

import {
  GLOBAL_CATALOG_BULK_READ_POLICY,
  GLOBAL_CATALOG_CRITICAL_READ_POLICY,
  GLOBAL_CATALOG_MAINTENANCE_POLICY,
  assertGlobalCatalogMaintenanceBoundary,
  buildGlobalSearchWorkerEnvironment,
  classifyGlobalCatalogAccess,
  classifyGlobalSearchHandoff,
  encodeGlobalSearchResult,
  parseGlobalSearchRequest,
  readGlobalCatalogCritical,
  ResidentGlobalSearchClient,
} from '../src/resident-global-search.mjs'

const POOL_A = '0x000000000000000000000000000000000000000a'
const POOL_B = '0x000000000000000000000000000000000000000b'
const POOL_C = '0x000000000000000000000000000000000000000c'

test('catalog critical reads retry transient public failures but never retry an invariant', async () => {
  let transientCalls = 0
  const retries = []
  const recovered = await readGlobalCatalogCritical(
    async () => {
      transientCalls += 1
      if (transientCalls < 3) {
        const error = Object.assign(new Error('temporary RPC transport failure'), { rpcClass: 'NETWORK' })
        throw error
      }
      return { blockNumber: 123n }
    },
    { onRetry: (_error, attempt) => retries.push(attempt) },
  )
  assert.deepEqual(recovered, { value: { blockNumber: 123n }, retries: 2 })
  assert.deepEqual(retries, [1, 2])

  let invariantCalls = 0
  await assert.rejects(
    readGlobalCatalogCritical(async () => {
      invariantCalls += 1
      throw new Error('canonical factory identity mismatch')
    }),
    /canonical factory identity mismatch/,
  )
  assert.equal(invariantCalls, 1)
})

test('catalog access keeps every search path on the last atomic maintenance snapshot', () => {
  const now = Date.parse('2026-09-15T00:00:00.000Z')
  const topology = {
    earn: { pools: [] },
    uniswap: {
      v2Pools: [],
      v3Pools: [],
      v4Pools: [],
      readEvidence: {
        status: 'COMPLETE',
        complete: true,
        requestedPairs: 3,
        requestedV3FeeQueries: 12,
        v2TransportErrors: 0,
        v3TransportErrors: 0,
      },
    },
  }
  const fresh = { schemaVersion: 1, generatedAt: '2026-09-14T23:59:00.000Z', ...topology }
  const stale = { schemaVersion: 1, generatedAt: '2026-09-14T17:59:59.999Z', ...topology }
  assert.equal(classifyGlobalCatalogAccess(fresh, { now }), 'CACHE')
  const retained = {
    schemaVersion: 2,
    generatedAt: '2026-09-14T23:59:00.000Z',
    ...topology,
    uniswap: {
      ...topology.uniswap,
      readEvidence: {
        status: 'PARTIAL',
        complete: false,
        requestedPairs: 3,
        requestedV3FeeQueries: 12,
        v2TransportErrors: 1,
        v3TransportErrors: 2,
        topologyRetention: {
          policy: 'FAILED_TRANSIENT_QUERY_LAST_VERIFIED_V1',
          previousCatalogBlock: '123',
          freshV2Pools: 0,
          freshV3Pools: 0,
          retainedV2Pools: 0,
          retainedV3Pools: 0,
          expiredV2Pools: 0,
          expiredV3Pools: 0,
        },
      },
    },
  }
  assert.equal(classifyGlobalCatalogAccess(retained, { now }), 'CACHE')
  const schema3 = {
    ...retained,
    schemaVersion: 3,
    earn: {
      pools: [],
      readEvidence: {
        topologyRetention: {
          policy: 'FAILED_TRANSIENT_POOL_READ_LAST_VERIFIED_V1',
          previousCatalogBlock: '123',
          freshPools: 0,
          retainedPools: 0,
          expiredPools: 0,
        },
      },
    },
  }
  assert.equal(classifyGlobalCatalogAccess(schema3, { now }), 'CACHE')
  const schema4 = {
    ...schema3,
    schemaVersion: 4,
    uniswap: {
      ...schema3.uniswap,
      readEvidence: {
        ...schema3.uniswap.readEvidence,
        bulkRead: {
          policy: 'CANONICAL_MULTICALL3_FIXED_BLOCK_PACED_RETRY_V2',
          multicallCodeHash: '0xd5c15df687b16f2ff992fc8d767b4216323184a2bbc6ee2f9c398c318e770891',
          maximumAttempts: 3,
          minimumRequestIntervalMs: 250,
          retryBaseDelayMs: 750,
          rpcRequests: 2,
          retries: 0,
          transientFailures: 0,
          subcalls: 15,
        },
      },
    },
  }
  assert.equal(classifyGlobalCatalogAccess(schema4, { now }), 'CACHE')
  assert.equal(
    classifyGlobalCatalogAccess(
      {
        ...schema4,
        uniswap: {
          ...schema4.uniswap,
          readEvidence: {
            ...schema4.uniswap.readEvidence,
            bulkRead: { ...schema4.uniswap.readEvidence.bulkRead, retries: 3 },
          },
        },
      },
      { now },
    ),
    'UNAVAILABLE',
  )
  assert.equal(
    classifyGlobalCatalogAccess(
      {
        ...schema4,
        uniswap: {
          ...schema4.uniswap,
          readEvidence: {
            ...schema4.uniswap.readEvidence,
            bulkRead: { ...schema4.uniswap.readEvidence.bulkRead, multicallCodeHash: `0x${'00'.repeat(32)}` },
          },
        },
      },
      { now },
    ),
    'UNAVAILABLE',
  )
  const schema3WithRetainedEarn = {
    ...schema3,
    earn: {
      pools: [
        {
          address: POOL_A,
          tokens: [{ address: POOL_B }, { address: POOL_C }],
          lastVerifiedAt: '2026-09-14T23:59:00.000Z',
          catalogObservation: 'RETAINED_AFTER_CURRENT_TRANSIENT_POOL_READ_FAILURE',
        },
      ],
      readEvidence: {
        topologyRetention: {
          ...schema3.earn.readEvidence.topologyRetention,
          retainedPools: 1,
        },
      },
    },
  }
  assert.equal(classifyGlobalCatalogAccess(schema3WithRetainedEarn, { now }), 'CACHE')
  assert.equal(
    classifyGlobalCatalogAccess(
      {
        ...schema3WithRetainedEarn,
        earn: {
          ...schema3WithRetainedEarn.earn,
          pools: [
            {
              ...schema3WithRetainedEarn.earn.pools[0],
              lastVerifiedAt: '2026-09-14T17:59:59.999Z',
            },
          ],
        },
      },
      { now },
    ),
    'UNAVAILABLE',
  )
  assert.equal(
    classifyGlobalCatalogAccess(
      {
        ...schema3,
        earn: {
          ...schema3.earn,
          readEvidence: {
            topologyRetention: { ...schema3.earn.readEvidence.topologyRetention, retainedPools: 1 },
          },
        },
      },
      { now },
    ),
    'UNAVAILABLE',
  )
  assert.equal(
    classifyGlobalCatalogAccess(
      {
        ...retained,
        uniswap: {
          ...retained.uniswap,
          readEvidence: {
            ...retained.uniswap.readEvidence,
            topologyRetention: { ...retained.uniswap.readEvidence.topologyRetention, retainedV2Pools: 1 },
          },
        },
      },
      { now },
    ),
    'UNAVAILABLE',
  )
  assert.equal(
    classifyGlobalCatalogAccess(
      {
        ...retained,
        uniswap: {
          ...retained.uniswap,
          v2Pools: [
            {
              address: POOL_A,
              token0: POOL_B,
              token1: POOL_C,
              lastVerifiedAt: '2026-09-14T17:59:59.999Z',
              catalogObservation: 'RETAINED_AFTER_CURRENT_TRANSIENT_QUERY_FAILURE',
            },
          ],
          readEvidence: {
            ...retained.uniswap.readEvidence,
            topologyRetention: { ...retained.uniswap.readEvidence.topologyRetention, retainedV2Pools: 1 },
          },
        },
      },
      { now },
    ),
    'UNAVAILABLE',
  )
  assert.equal(
    classifyGlobalCatalogAccess(
      {
        ...fresh,
        generatedAt: '2026-09-14T23:54:00.000Z',
        uniswap: {
          ...fresh.uniswap,
          readEvidence: {
            status: 'PARTIAL',
            complete: false,
            requestedPairs: 3,
            requestedV3FeeQueries: 12,
            v2TransportErrors: 1,
            v3TransportErrors: 2,
          },
        },
      },
      { now },
    ),
    'CACHE',
  )
  assert.equal(
    classifyGlobalCatalogAccess(
      {
        ...fresh,
        generatedAt: '2026-09-14T23:54:00.000Z',
        uniswap: {
          ...fresh.uniswap,
          readEvidence: {
            status: 'PARTIAL',
            complete: false,
            requestedPairs: 3,
            requestedV3FeeQueries: 12,
            v2TransportErrors: 1,
            v3TransportErrors: 2,
          },
        },
      },
      { now },
    ),
    'CACHE',
  )
  assert.equal(classifyGlobalCatalogAccess(stale, { now }), 'UNAVAILABLE')
  assert.equal(
    classifyGlobalCatalogAccess({ schemaVersion: 1, generatedAt: '2026-09-14T23:59:00.000Z' }, { now }),
    'UNAVAILABLE',
  )
  assert.equal(
    classifyGlobalCatalogAccess(
      {
        schemaVersion: 1,
        generatedAt: '2026-09-14T23:59:00.000Z',
        earn: { pools: [] },
        uniswap: { v2Pools: [], v3Pools: [], v4Pools: [] },
      },
      { now },
    ),
    'UNAVAILABLE',
  )
  assert.equal(
    classifyGlobalCatalogAccess(
      {
        ...fresh,
        uniswap: {
          ...fresh.uniswap,
          readEvidence: {
            status: 'COMPLETE',
            complete: false,
            requestedPairs: 3,
            requestedV3FeeQueries: 12,
            v2TransportErrors: 1,
            v3TransportErrors: 0,
          },
        },
      },
      { now },
    ),
    'UNAVAILABLE',
  )
  assert.equal(classifyGlobalCatalogAccess(null, { now }), 'UNAVAILABLE')
  assert.deepEqual(GLOBAL_CATALOG_MAINTENANCE_POLICY, {
    version: 'SIGNER_FREE_PUBLIC_CATALOG_MAINTENANCE_V6',
    refreshIntervalMs: 15 * 60 * 1_000,
    maximumAgeMs: 6 * 60 * 60 * 1_000,
    writer: 'DEDICATED_SYSTEMD_ONESHOT',
    readPath: 'ATOMIC_CACHE_ONLY',
    rpc: 'OFFICIAL_PUBLIC_ONLY',
    partialRefresh: 'FAILED_TRANSIENT_QUERY_LAST_VERIFIED_V1',
    earnPartialRefresh: 'FAILED_TRANSIENT_POOL_READ_LAST_VERIFIED_V1',
    criticalRead: 'DIRECT_PUBLIC_CRITICAL_READ_RETRY_V1',
    bulkRead: 'CANONICAL_MULTICALL3_FIXED_BLOCK_PACED_RETRY_V2',
  })
  assert.deepEqual(GLOBAL_CATALOG_CRITICAL_READ_POLICY, {
    version: 'DIRECT_PUBLIC_CRITICAL_READ_RETRY_V1',
    attempts: 3,
    delayMs: 1_000,
    transport: 'OFFICIAL_PUBLIC_NON_BATCHED',
  })
  assert.deepEqual(GLOBAL_CATALOG_BULK_READ_POLICY, {
    version: 'CANONICAL_MULTICALL3_FIXED_BLOCK_PACED_RETRY_V2',
    transport: 'OFFICIAL_PUBLIC_NON_BATCHED',
    maximumSubcallsPerRequest: 12,
    concurrency: 1,
    maximumAttempts: 3,
    minimumRequestIntervalMs: 250,
    retryBaseDelayMs: 750,
    runtimeCodeHash: '0xd5c15df687b16f2ff992fc8d767b4216323184a2bbc6ee2f9c398c318e770891',
  })
})

test('catalog writer requires an explicit maintenance process boundary', () => {
  assert.throws(() => assertGlobalCatalogMaintenanceBoundary({}), /explicit maintenance command boundary/)
  assert.throws(
    () => assertGlobalCatalogMaintenanceBoundary({ GLOBAL_CATALOG_REFRESH_ALLOWED: 'true' }),
    /explicit maintenance command boundary/,
  )
  assert.doesNotThrow(() => assertGlobalCatalogMaintenanceBoundary({ GLOBAL_CATALOG_REFRESH_ALLOWED: '1' }))
})

test('resident worker entrypoint has no mutation command and disables preflight persistence', () => {
  const source = fs.readFileSync(new URL('../scripts/global-search-worker.mjs', import.meta.url), 'utf8')
  assert.match(source, /globalPreflight\(\{ print: false, persist: false \}\)/)
  assert.doesNotMatch(source, /loadAccount|privateKey|signTransaction|broadcast|persistSignedRaw|execute\(/)
})

function fakeSpawner() {
  const children = []
  const requests = []
  const spawnProcess = () => {
    /** @type {any} */
    const child = new EventEmitter()
    child.pid = 10_000 + children.length
    child.stdout = new PassThrough()
    child.stderr = new PassThrough()
    child.stdin = new Writable({
      write(chunk, _encoding, callback) {
        requests.push(parseGlobalSearchRequest(String(chunk).trim()))
        callback()
      },
    })
    child.kill = () => true
    children.push(child)
    return child
  }
  return { children, requests, spawnProcess }
}

test('worker environment is public-only and strips every signing reference', () => {
  const environment = buildGlobalSearchWorkerEnvironment({
    MANGA_RPC_URL: 'https://read.example.invalid',
    MANGA_RUN_DIR: '/tmp/global-search-test',
    MANGA_GLOBAL_UNIVERSE_PATH: '/run/example/global-universe.json',
    MANGA_PRIVATE_KEY_FILE: '/run/credentials/private-key',
    CREDENTIALS_DIRECTORY: '/run/credentials/service',
    GLOBAL_SHARED_AUTHORIZATION_ID: 'authorization',
    FEISHU_WEBHOOK_SECRET: 'secret',
    GLOBAL_LIVE_ARM: '1',
  })
  assert.equal(environment.MANGA_RPC_URL, undefined)
  assert.equal(environment.MANGA_RUN_DIR, '/tmp/global-search-test')
  assert.equal(environment.MANGA_GLOBAL_UNIVERSE_PATH, '/run/example/global-universe.json')
  assert.equal(environment.MANGA_PRIVATE_KEY_FILE, undefined)
  assert.equal(environment.CREDENTIALS_DIRECTORY, undefined)
  assert.equal(environment.GLOBAL_SHARED_AUTHORIZATION_ID, undefined)
  assert.equal(environment.FEISHU_WEBHOOK_SECRET, undefined)
  assert.equal(environment.GLOBAL_LIVE_ARM, '0')
  assert.equal(environment.GLOBAL_SEARCH_READONLY_CATALOG, '1')
  assert.equal(environment.MANGA_CONFIG_FILE, '/dev/null')
  assert.match(environment.NODE_OPTIONS, /max-old-space-size=128/)
})

test('resident worker coalesces a busy event tail and returns bounded result references', () => {
  const fake = fakeSpawner()
  const results = []
  const failures = []
  const client = new ResidentGlobalSearchClient({
    scriptPath: '/tmp/global-search-worker.mjs',
    cwd: '/tmp',
    environment: {},
    timeoutMs: 5_000,
    spawnProcess: fake.spawnProcess,
    onResult: (result) => results.push(result),
    onFailure: (failure) => failures.push(failure),
  })
  assert.equal(client.start(), true)
  assert.equal(client.enqueue({ routeAddresses: [POOL_A], firstSequenceNumber: 1, wakeSource: 'SEQUENCER_FEED' }), true)
  assert.equal(
    client.enqueue({ routeAddresses: [POOL_B], firstSequenceNumber: 2, wakeSource: 'MANAGED_WSS_EARN_SWAP' }),
    true,
  )
  assert.equal(
    client.enqueue({ routeAddresses: [POOL_C], firstSequenceNumber: 3, wakeSource: 'PUBLIC_EARN_LOG_BACKSTOP' }),
    true,
  )
  assert.equal(fake.requests.length, 1)

  fake.children[0].stdout.write(
    `${encodeGlobalSearchResult(fake.requests[0].requestId, {
      status: 'NO_EXACT_NET_OPPORTUNITY',
      snapshot: { status: 'NO_EXACT_NET_OPPORTUNITY' },
    })}\n`,
  )
  assert.equal(results.length, 1)
  assert.equal(results[0].superseded, true)
  assert.equal(fake.requests.length, 2)
  assert.deepEqual(fake.requests[1].signal.routeAddresses, [POOL_B, POOL_C])
  assert.equal(fake.requests[1].signal.firstSequenceNumber, 2)
  assert.equal(fake.requests[1].signal.lastSequenceNumber, 3)
  assert.deepEqual(fake.requests[1].signal.wakeSources, ['MANAGED_WSS_EARN_SWAP', 'PUBLIC_EARN_LOG_BACKSTOP'])
  assert.equal(fake.requests[1].signal.wakeSource, 'MULTI_SOURCE_MARKET_EVENT')

  fake.children[0].stdout.write(
    `${encodeGlobalSearchResult(fake.requests[1].requestId, {
      status: 'EXACT_NET_POSITIVE',
      snapshot: { status: 'EXACT_NET_POSITIVE' },
    })}\n`,
  )
  assert.equal(results.length, 2)
  assert.equal(results[1].superseded, false)
  assert.equal(failures.length, 0)
  assert.equal(client.snapshot().completed, 2)
  assert.equal(client.snapshot().coalesced, 1)
  client.stop()
})

test('worker failure degrades only its in-flight search and leaves a restartable fallback signal', () => {
  const fake = fakeSpawner()
  const failures = []
  const client = new ResidentGlobalSearchClient({
    scriptPath: '/tmp/global-search-worker.mjs',
    cwd: '/tmp',
    environment: {},
    timeoutMs: 5_000,
    spawnProcess: fake.spawnProcess,
    onResult: () => {},
    onFailure: (failure) => failures.push(failure),
  })
  client.start()
  client.enqueue({ routeAddresses: [POOL_A], firstSequenceNumber: 7 })
  fake.children[0].emit('close', 1, null)
  assert.equal(failures.length, 1)
  assert.deepEqual(failures[0].signal.routeAddresses, [POOL_A])
  assert.equal(client.snapshot().status, 'DEGRADED')
  assert.equal(client.snapshot().failures, 1)
  client.stop()
})

test('only a negative read result is reusable; a positive hint always returns to the live signer gate', () => {
  assert.equal(
    classifyGlobalSearchHandoff({
      snapshot: { status: 'NO_EXACT_NET_OPPORTUNITY', evidenceCoverage: 'COMPLETE' },
    }).mode,
    'REUSE_READ_ONLY_RESULT',
  )
  assert.equal(classifyGlobalSearchHandoff({ snapshot: { status: 'EXACT_NET_POSITIVE' } }).mode, 'LIVE_REVALIDATION')
  assert.equal(
    classifyGlobalSearchHandoff(
      { snapshot: { status: 'NO_EXACT_NET_OPPORTUNITY', evidenceCoverage: 'COMPLETE' } },
      { requiresLegacySearch: true },
    ).mode,
    'LEGACY_PREFLIGHT',
  )
  assert.equal(
    classifyGlobalSearchHandoff({
      snapshot: { status: 'NO_EXACT_NET_OPPORTUNITY', evidenceCoverage: 'UNAVAILABLE' },
    }).mode,
    'LEGACY_PREFLIGHT',
  )
})
