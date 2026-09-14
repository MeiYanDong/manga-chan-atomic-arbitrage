import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import { createPublicClient, defineChain } from 'viem'

import { publicFirstRpcTransport, shouldFallbackToManagedRpc } from '../src/public-first-rpc.mjs'

const chain = defineChain({
  id: 4_663,
  name: 'Test Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['http://127.0.0.1'] } },
})

/** @param {(request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse) => void | Promise<void>} handler */
async function listen(handler) {
  const server = createServer(handler)
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve(undefined))
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('test RPC server has no TCP address')
  return {
    server,
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve) => server.close(() => resolve(undefined))),
  }
}

/** @param {import('node:http').IncomingMessage} request */
async function requestBody(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

/** @param {any} body */
function rpcResponse(body) {
  const requests = Array.isArray(body) ? body : [body]
  const responses = requests.map((request) => ({
    jsonrpc: '2.0',
    id: request.id,
    result: request.method === 'eth_blockNumber' ? '0x2a' : '0x3b9aca00',
  }))
  return Array.isArray(body) ? responses : responses[0]
}

test('batches public calls and falls back once when the public transport is rate limited', async (context) => {
  const primaryBodies = []
  const fallbackBodies = []
  const primary = await listen(async (request, response) => {
    primaryBodies.push(await requestBody(request))
    response.writeHead(429, { 'content-type': 'text/plain' })
    response.end('rate limit')
  })
  const secondary = await listen(async (request, response) => {
    const body = await requestBody(request)
    fallbackBodies.push(body)
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify(rpcResponse(body)))
  })
  context.after(async () => {
    await Promise.all([primary.close(), secondary.close()])
  })

  const client = createPublicClient({
    chain,
    transport: publicFirstRpcTransport(primary.url, secondary.url, { batchWaitMs: 5 }),
  })
  const [blockNumber, gasPrice] = await Promise.all([client.getBlockNumber(), client.getGasPrice()])

  assert.equal(blockNumber, 42n)
  assert.equal(gasPrice, 1_000_000_000n)
  assert.equal(primaryBodies.length, 1)
  assert.equal(fallbackBodies.length, 1)
  assert.equal(Array.isArray(primaryBodies[0]), true)
  assert.equal(primaryBodies[0].length, 2)
  assert.equal(Array.isArray(fallbackBodies[0]), true)
  assert.equal(fallbackBodies[0].length, 2)
})

test('does not contact the managed fallback when the public batch succeeds', async (context) => {
  let primaryCalls = 0
  let fallbackCalls = 0
  const primary = await listen(async (request, response) => {
    primaryCalls += 1
    const body = await requestBody(request)
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify(rpcResponse(body)))
  })
  const secondary = await listen((_request, response) => {
    fallbackCalls += 1
    response.writeHead(500).end()
  })
  context.after(async () => {
    await Promise.all([primary.close(), secondary.close()])
  })

  const client = createPublicClient({
    chain,
    transport: publicFirstRpcTransport(primary.url, secondary.url, { batchWaitMs: 0 }),
  })
  assert.equal(await client.getBlockNumber(), 42n)
  assert.equal(primaryCalls, 1)
  assert.equal(fallbackCalls, 0)
})

test('splits public calls at an eight-item provider ceiling without using the managed fallback', async (context) => {
  const primaryBodies = []
  let fallbackCalls = 0
  const primary = await listen(async (request, response) => {
    const body = await requestBody(request)
    primaryBodies.push(body)
    if (Array.isArray(body) && body.length > 8) {
      response.writeHead(429, { 'content-type': 'text/plain' })
      response.end('provider batch limit')
      return
    }
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify(rpcResponse(body)))
  })
  const secondary = await listen((_request, response) => {
    fallbackCalls += 1
    response.writeHead(500).end()
  })
  context.after(async () => {
    await Promise.all([primary.close(), secondary.close()])
  })

  const client = createPublicClient({
    chain,
    transport: publicFirstRpcTransport(primary.url, secondary.url, { batchSize: 8, batchWaitMs: 5 }),
  })
  const balances = await Promise.all(
    Array.from({ length: 16 }, (_, index) =>
      client.getBalance({ address: `0x${(index + 1).toString(16).padStart(40, '0')}` }),
    ),
  )

  assert.deepEqual(balances, Array(16).fill(1_000_000_000n))
  assert.equal(primaryBodies.length, 2)
  assert.deepEqual(
    primaryBodies.map((body) => body.length),
    [8, 8],
  )
  assert.equal(fallbackCalls, 0)
})

test('falls back only for the logical call omitted from a malformed public batch', async (context) => {
  const primaryBodies = []
  const fallbackBodies = []
  const primary = await listen(async (request, response) => {
    const body = await requestBody(request)
    primaryBodies.push(body)
    const complete = rpcResponse(body)
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify(Array.isArray(complete) ? complete.slice(0, 1) : complete))
  })
  const secondary = await listen(async (request, response) => {
    const body = await requestBody(request)
    fallbackBodies.push(body)
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify(rpcResponse(body)))
  })
  context.after(async () => {
    await Promise.all([primary.close(), secondary.close()])
  })

  const client = createPublicClient({
    chain,
    transport: publicFirstRpcTransport(primary.url, secondary.url, { batchWaitMs: 5 }),
  })
  const [blockNumber, gasPrice] = await Promise.all([client.getBlockNumber(), client.getGasPrice()])

  assert.equal(blockNumber, 42n)
  assert.equal(gasPrice, 1_000_000_000n)
  assert.equal(primaryBodies.length, 1)
  assert.equal(fallbackBodies.length, 1)
  assert.equal(Array.isArray(fallbackBodies[0]), true)
  assert.equal(fallbackBodies[0].length, 1)
})

test('does not switch providers for a deterministic EVM revert', async (context) => {
  let fallbackCalls = 0
  const primary = await listen(async (request, response) => {
    const body = await requestBody(request)
    const requests = Array.isArray(body) ? body : [body]
    const errors = requests.map((item) => ({
      jsonrpc: '2.0',
      id: item.id,
      error: { code: 3, message: 'execution reverted' },
    }))
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify(Array.isArray(body) ? errors : errors[0]))
  })
  const secondary = await listen((_request, response) => {
    fallbackCalls += 1
    response.writeHead(500).end()
  })
  context.after(async () => {
    await Promise.all([primary.close(), secondary.close()])
  })

  const client = createPublicClient({ chain, transport: publicFirstRpcTransport(primary.url, secondary.url) })
  await assert.rejects(
    () => client.call({ to: '0x0000000000000000000000000000000000000001', data: '0x' }),
    /execution reverted/i,
  )
  assert.equal(fallbackCalls, 0)
})

test('does not spend fallback capacity on deterministic RPC request errors', async (context) => {
  let fallbackCalls = 0
  const primary = await listen(async (request, response) => {
    const body = await requestBody(request)
    const requests = Array.isArray(body) ? body : [body]
    const errors = requests.map((item) => ({
      jsonrpc: '2.0',
      id: item.id,
      error: { code: -32602, message: 'invalid params' },
    }))
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify(Array.isArray(body) ? errors : errors[0]))
  })
  const secondary = await listen((_request, response) => {
    fallbackCalls += 1
    response.writeHead(500).end()
  })
  context.after(async () => {
    await Promise.all([primary.close(), secondary.close()])
  })

  const client = createPublicClient({ chain, transport: publicFirstRpcTransport(primary.url, secondary.url) })
  await assert.rejects(() => client.request({ method: 'eth_notARealMethod', params: [] }), /invalid params/i)
  assert.equal(fallbackCalls, 0)
})

test('fallback classifier admits only transport and rate-limit failures', () => {
  const missingBatchItem = new TypeError("Cannot read properties of undefined (reading 'error')")
  missingBatchItem.stack = `${missingBatchItem.name}: ${missingBatchItem.message}\n    at request (file:///app/node_modules/viem/_esm/clients/transports/http.js:69:26)`
  const wrappedMissingBatchItem = new Error('unknown RPC error', { cause: missingBatchItem })
  assert.equal(shouldFallbackToManagedRpc({ name: 'TimeoutError' }), true)
  assert.equal(shouldFallbackToManagedRpc({ name: 'HttpRequestError', status: 503 }), true)
  assert.equal(shouldFallbackToManagedRpc({ name: 'RpcRequestError', code: -32_005 }), true)
  assert.equal(shouldFallbackToManagedRpc(missingBatchItem), true)
  assert.equal(shouldFallbackToManagedRpc(wrappedMissingBatchItem), true)
  assert.equal(shouldFallbackToManagedRpc({ name: 'RpcRequestError', code: -32602 }), false)
  assert.equal(
    shouldFallbackToManagedRpc(new TypeError("Cannot read properties of undefined (reading 'error')")),
    false,
  )
  assert.equal(shouldFallbackToManagedRpc(new Error('unknown failure')), false)
})

test('validates endpoint and batching bounds without echoing configured URLs', () => {
  assert.throws(() => publicFirstRpcTransport('wss://public.example', null), /HTTP or HTTPS/)
  assert.throws(() => publicFirstRpcTransport('https://public.example', null, { batchSize: 0 }), /batch size/)
  assert.throws(
    () => publicFirstRpcTransport('https://public.example', 'https://managed.example', { timeoutMs: 0 }),
    /RPC timeout/,
  )
})
