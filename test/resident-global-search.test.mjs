import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import { PassThrough, Writable } from 'node:stream'
import test from 'node:test'

import {
  buildGlobalSearchWorkerEnvironment,
  classifyGlobalCatalogAccess,
  classifyGlobalSearchHandoff,
  encodeGlobalSearchResult,
  parseGlobalSearchRequest,
  ResidentGlobalSearchClient,
} from '../src/resident-global-search.mjs'

const POOL_A = '0x000000000000000000000000000000000000000a'
const POOL_B = '0x000000000000000000000000000000000000000b'
const POOL_C = '0x000000000000000000000000000000000000000c'

test('catalog access keeps legacy refresh as the only writer', () => {
  const now = Date.parse('2026-09-15T00:00:00.000Z')
  const topology = {
    earn: { pools: [] },
    uniswap: { v2Pools: [], v3Pools: [], v4Pools: [] },
  }
  const fresh = { schemaVersion: 1, generatedAt: '2026-09-14T23:59:00.000Z', ...topology }
  const stale = { schemaVersion: 1, generatedAt: '2026-09-14T17:59:59.999Z', ...topology }
  assert.equal(classifyGlobalCatalogAccess(fresh, { readOnly: true, now }), 'CACHE')
  assert.equal(classifyGlobalCatalogAccess(stale, { readOnly: true, now }), 'UNAVAILABLE')
  assert.equal(classifyGlobalCatalogAccess(stale, { readOnly: false, now }), 'REFRESH')
  assert.equal(
    classifyGlobalCatalogAccess({ schemaVersion: 1, generatedAt: '2026-09-14T23:59:00.000Z' }, { readOnly: true, now }),
    'UNAVAILABLE',
  )
  assert.equal(classifyGlobalCatalogAccess(null, { readOnly: true, now }), 'UNAVAILABLE')
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
