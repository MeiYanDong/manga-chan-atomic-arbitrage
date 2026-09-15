import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import { PassThrough, Writable } from 'node:stream'
import test from 'node:test'

import {
  EARN_SEARCH_NEGATIVE_MAX_AGE_MS,
  ResidentEarnSearchClient,
  buildEarnSearchWorkerEnvironment,
  classifyEarnSearchHandoff,
  encodeEarnLiveRevalidationInput,
  encodeEarnSearchResult,
  parseEarnLiveRevalidationInput,
  parseEarnSearchRequest,
} from '../src/resident-earn-search.mjs'
import { isEarnCatalogSnapshotCurrent } from '../scripts/earnonhood-live.mjs'

const POOL_A = '0x000000000000000000000000000000000000000a'
const POOL_B = '0x000000000000000000000000000000000000000b'
const ROUTE_ID = 'EARN_DYNAMIC_1234567890ABCDEF'

function searchSignal(overrides = {}) {
  return {
    sourceReceivedAt: '2026-09-16T00:00:00.000Z',
    eventPools: [POOL_A],
    routeAddresses: [POOL_A],
    wakeSource: 'MANAGED_WSS_EARN_SWAP',
    searchContext: { earnGasSurplusWei: '100', excludedRouteIds: [] },
    ...overrides,
  }
}

function fakeSpawner() {
  const children = []
  const requests = []
  const spawnProcess = () => {
    /** @type {any} */
    const child = new EventEmitter()
    child.pid = 20_000 + children.length
    child.stdout = new PassThrough()
    child.stderr = new PassThrough()
    child.stdin = new Writable({
      write(chunk, _encoding, callback) {
        requests.push(parseEarnSearchRequest(String(chunk).trim()))
        callback()
      },
    })
    child.kill = () => true
    children.push(child)
    return child
  }
  return { children, requests, spawnProcess }
}

test('Earn resident environment is allowlisted, public-only and signer-free', () => {
  const environment = buildEarnSearchWorkerEnvironment({
    PATH: '/usr/bin',
    MANGA_RUN_DIR: '/var/lib/manga-chan-arbitrage',
    EARN_LIVE_REFINEMENT_POINTS: '6',
    MANGA_RPC_URL: 'https://managed.example.invalid',
    MANGA_WS_URL: 'wss://managed.example.invalid',
    MANGA_PRIVATE_KEY_FILE: '/run/credentials/private-key',
    CREDENTIALS_DIRECTORY: '/run/credentials/service',
    EARN_SHARED_AUTHORIZATION_ID: 'authorization',
    FEISHU_WEBHOOK_SECRET: 'secret',
    EARN_LIVE_ARM: '1',
  })
  assert.equal(environment.PATH, '/usr/bin')
  assert.equal(environment.MANGA_RUN_DIR, '/var/lib/manga-chan-arbitrage')
  assert.equal(environment.EARN_LIVE_REFINEMENT_POINTS, '6')
  assert.equal(environment.MANGA_RPC_URL, undefined)
  assert.equal(environment.MANGA_WS_URL, undefined)
  assert.equal(environment.MANGA_PRIVATE_KEY_FILE, undefined)
  assert.equal(environment.CREDENTIALS_DIRECTORY, undefined)
  assert.equal(environment.EARN_SHARED_AUTHORIZATION_ID, undefined)
  assert.equal(environment.FEISHU_WEBHOOK_SECRET, undefined)
  assert.equal(environment.EARN_LIVE_ARM, '0')
  assert.equal(environment.EARN_SEARCH_READ_ONLY, '1')
  assert.equal(environment.MANGA_CONFIG_FILE, '/dev/null')
})

test('Earn resident worker coalesces pools while taking the newest solvency context', () => {
  const fake = fakeSpawner()
  const results = []
  const client = new ResidentEarnSearchClient({
    scriptPath: '/tmp/earn-search-worker.mjs',
    cwd: '/tmp',
    environment: {},
    timeoutMs: 5_000,
    spawnProcess: fake.spawnProcess,
    onResult: (result) => results.push(result),
    onFailure: () => {},
  })
  client.start()
  client.enqueue(searchSignal())
  client.enqueue(
    searchSignal({
      sourceReceivedAt: '2026-09-16T00:00:01.000Z',
      eventPools: [POOL_B],
      routeAddresses: [POOL_B],
      wakeSource: 'PUBLIC_EARN_LOG_BACKSTOP',
      searchContext: { earnGasSurplusWei: '200', excludedRouteIds: [ROUTE_ID] },
    }),
  )
  assert.equal(fake.requests.length, 1)
  fake.children[0].stdout.write(
    `${encodeEarnSearchResult(fake.requests[0].requestId, {
      status: 'NO_SHOT',
      evidenceCoverage: 'COMPLETE',
      report: { status: 'NO_SHOT' },
    })}\n`,
  )
  assert.equal(results.length, 1)
  assert.equal(results[0].superseded, true)
  assert.equal(fake.requests.length, 2)
  assert.deepEqual(fake.requests[1].signal.eventPools, [POOL_B])
  assert.equal(fake.requests[1].signal.searchContext.earnGasSurplusWei, '200')
  assert.deepEqual(fake.requests[1].signal.searchContext.excludedRouteIds, [ROUTE_ID])
  assert.equal(client.snapshot().policy, 'RESIDENT_SIGNER_FREE_EARN_SEARCH_V1')
  client.stop()
})

test('only a fresh complete Earn negative is reusable and every positive requires live revalidation', () => {
  const now = Date.parse('2026-09-16T00:00:15.000Z')
  const negative = {
    status: 'NO_SHOT',
    evidenceCoverage: 'COMPLETE',
    completedAt: '2026-09-16T00:00:14.000Z',
    report: { status: 'NO_SHOT', reasons: ['NO_POSITIVE_GROSS_QUOTE'] },
  }
  assert.equal(classifyEarnSearchHandoff(negative, { now }).mode, 'REUSE_READ_ONLY_RESULT')
  assert.equal(
    classifyEarnSearchHandoff(
      { ...negative, completedAt: new Date(now - EARN_SEARCH_NEGATIVE_MAX_AGE_MS - 1).toISOString() },
      { now },
    ).mode,
    'LEGACY_PREFLIGHT',
  )
  assert.equal(
    classifyEarnSearchHandoff({ ...negative, evidenceCoverage: 'PARTIAL' }, { now }).mode,
    'LEGACY_PREFLIGHT',
  )

  const positiveCompletedAt = new Date().toISOString()
  const positive = {
    status: 'SHOT_READY',
    evidenceCoverage: 'COMPLETE',
    completedAt: positiveCompletedAt,
    report: { status: 'SHOT_READY', route: 'WETH -> AI -> WETH' },
    candidateHint: { routeId: ROUTE_ID },
  }
  assert.equal(
    classifyEarnSearchHandoff(positive, { now: Date.parse(positiveCompletedAt) + 1_000 }).mode,
    'LIVE_REVALIDATION',
  )
  const encoded = encodeEarnLiveRevalidationInput(positive)
  assert.deepEqual(parseEarnLiveRevalidationInput(encoded), {
    schemaVersion: 1,
    type: 'EARN_LIVE_REVALIDATION',
    completedAt: positive.completedAt,
    publicScreenReport: positive.report,
    candidateHint: positive.candidateHint,
  })
})

test('Earn reads current schema-v4 catalog snapshots and rejects stale or unmatched topology', () => {
  const now = Date.parse('2026-09-16T00:00:00.000Z')
  const snapshot = {
    schemaVersion: 4,
    generatedAt: '2026-09-15T23:59:00.000Z',
    blockNumber: '100',
    earn: {
      source: 'CANONICAL_FACTORY_AND_POOL_STATE_ONCHAIN',
      pools: [
        {
          address: POOL_A,
          lastVerifiedAt: '2026-09-15T23:59:00.000Z',
          catalogObservation: 'CURRENT_FIXED_BLOCK_POOL_READ',
        },
      ],
      readEvidence: {
        topologyRetention: {
          policy: 'FAILED_TRANSIENT_POOL_READ_LAST_VERIFIED_V1',
          freshPools: 1,
          retainedPools: 0,
          expiredPools: 0,
        },
      },
    },
  }
  assert.equal(isEarnCatalogSnapshotCurrent(snapshot, 101n, [POOL_A], { now }), true)
  assert.equal(isEarnCatalogSnapshotCurrent(snapshot, 101n, [POOL_B], { now }), false)
  assert.equal(
    isEarnCatalogSnapshotCurrent({ ...snapshot, generatedAt: '2026-09-15T17:59:59.999Z' }, 101n, [POOL_A], {
      now,
    }),
    false,
  )
  assert.equal(
    isEarnCatalogSnapshotCurrent(
      {
        ...snapshot,
        earn: {
          ...snapshot.earn,
          readEvidence: {
            topologyRetention: {
              ...snapshot.earn.readEvidence.topologyRetention,
              freshPools: 0,
            },
          },
        },
      },
      101n,
      [POOL_A],
      { now },
    ),
    false,
  )
})

test('Earn worker has no mutation command and the signer path consumes only an explicit revalidation envelope', () => {
  const workerSource = fs.readFileSync(new URL('../scripts/earn-search-worker.mjs', import.meta.url), 'utf8')
  assert.match(workerSource, /earnReadOnlySearch/)
  assert.doesNotMatch(workerSource, /loadAccount|privateKey|signTransaction|broadcast|persistSignedRaw|execute\(/)

  const liveSource = fs.readFileSync(new URL('../scripts/earnonhood-live.mjs', import.meta.url), 'utf8')
  assert.match(liveSource, /command === 'execute-candidate'/)
  assert.match(liveSource, /parseEarnLiveRevalidationInput\(fs\.readFileSync\(0, 'utf8'\)\)/)
  assert.match(liveSource, /assertCandidateHintCatalogMembership\(client, normalizedHint, blockNumber\)/)

  const supervisorSource = fs.readFileSync(new URL('../scripts/dual-base-arb.mjs', import.meta.url), 'utf8')
  assert.match(supervisorSource, /enqueueEarnSearchWake\('PERIODIC_RECOVERY'/)
  assert.match(supervisorSource, /wakeSource: 'PERIODIC_RECOVERY'/)
  assert.match(supervisorSource, /lastDecision: 'GLOBAL_PERIODIC_SEARCH_ENQUEUED'/)
  assert.match(supervisorSource, /firstPeriodicAt: Date\.parse\(startedAt\) \+ GLOBAL_PERIODIC_START_STAGGER_MS/)
  assert.match(supervisorSource, /RESIDENT_POSITIVE_THEN_BOUNDED_SIGNER_CHILD/)
  assert.match(supervisorSource, /handoff\.mode === 'LIVE_REVALIDATION' \? preparedSearchResult : null/)
})
