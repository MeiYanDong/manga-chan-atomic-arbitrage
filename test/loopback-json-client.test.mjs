import assert from 'node:assert/strict'
import test from 'node:test'
import { requestLoopbackJson } from '../src/loopback-json-client.mjs'

const baseUrl = 'http://127.0.0.1:8788'

test('loopback business read stops after the first successful response', async () => {
  let calls = 0
  const expected = { status: 'HEALTHY' }
  const result = await requestLoopbackJson('/healthz', {
    baseUrl,
    fetchImpl: async () => {
      calls += 1
      return new globalThis.Response(JSON.stringify(expected), { status: 200 })
    },
    timeoutSignal: () => AbortSignal.abort(),
    waitImpl: async () => assert.fail('a successful first read must not wait'),
  })

  assert.deepEqual(result, expected)
  assert.equal(calls, 1)
})

test('loopback business read retries one busy window and returns the current snapshot', async () => {
  const calls = []
  const waits = []
  const timeouts = []
  const expected = { status: 'HEALTHY', generatedAt: '2026-09-12T20:00:00.000Z' }

  const result = await requestLoopbackJson('/healthz', {
    baseUrl,
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options })
      if (calls.length === 1) throw new Error('busy loopback window')
      return new globalThis.Response(JSON.stringify(expected), { status: 200 })
    },
    timeoutSignal: (milliseconds) => {
      timeouts.push(milliseconds)
      return AbortSignal.abort()
    },
    waitImpl: async (milliseconds) => {
      waits.push(milliseconds)
    },
  })

  assert.deepEqual(result, expected)
  assert.equal(calls.length, 2)
  assert.deepEqual(waits, [500])
  assert.deepEqual(timeouts, [8_000, 8_000])
  assert.equal(calls[0].url, 'http://127.0.0.1:8788/healthz')
  assert.deepEqual(calls[0].options.headers, { accept: 'application/json' })
})

test('loopback business read stays UNKNOWN after exactly two failed attempts', async () => {
  let calls = 0
  const result = await requestLoopbackJson('/api/v1/overview', {
    baseUrl,
    fetchImpl: async () => {
      calls += 1
      return new globalThis.Response('', { status: 503 })
    },
    timeoutSignal: () => AbortSignal.abort(),
    waitImpl: async () => {},
  })

  assert.equal(result, null)
  assert.equal(calls, 2)
})

test('loopback business read retries a malformed JSON response once', async () => {
  let calls = 0
  const expected = { serviceStatus: 'RUNNING' }
  const result = await requestLoopbackJson('/api/v1/overview', {
    baseUrl,
    fetchImpl: async () => {
      calls += 1
      return calls === 1
        ? new globalThis.Response('not-json', { status: 200 })
        : new globalThis.Response(JSON.stringify(expected), { status: 200 })
    },
    timeoutSignal: () => AbortSignal.abort(),
    waitImpl: async () => {},
  })

  assert.deepEqual(result, expected)
  assert.equal(calls, 2)
})

test('loopback business read rejects non-loopback targets before transport', async () => {
  let calls = 0
  const result = await requestLoopbackJson('/api/v1/overview', {
    baseUrl: 'https://example.com',
    fetchImpl: async () => {
      calls += 1
      return new globalThis.Response('{}', { status: 200 })
    },
    timeoutSignal: () => AbortSignal.abort(),
    waitImpl: async () => {},
  })

  assert.equal(result, null)
  assert.equal(calls, 0)
})
