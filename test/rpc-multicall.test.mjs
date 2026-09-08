import assert from 'node:assert/strict'
import test from 'node:test'

import { readWithBoundedMulticall } from '../src/rpc-multicall.mjs'

const invariant = (message) => Object.assign(new Error(message), { kind: 'INVARIANT' })
const transient = (message) => Object.assign(new Error(message), { kind: 'TRANSIENT' })
/** @param {unknown} error */
const isTransient = (error) =>
  Boolean(error && typeof error === 'object' && /** @type {{kind?: string}} */ (error).kind === 'TRANSIENT')

test('bounds aggregate calls and directly recovers only failed subcalls', async () => {
  const batches = []
  const direct = []
  const contracts = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id }))
  const outcome = await readWithBoundedMulticall({
    contracts,
    maxCalls: 2,
    readBatch: async (chunk) => {
      batches.push(chunk.map(({ id }) => id))
      return chunk.map(({ id }) =>
        id === 'b' || id === 'd'
          ? { status: 'failure', error: invariant(`aggregate ${id}`) }
          : { status: 'success', result: id },
      )
    },
    readDirect: async ({ id }) => {
      direct.push(id)
      if (id === 'd') throw invariant('direct d')
      return `${id}-direct`
    },
    isTransient,
  })

  assert.deepEqual(batches, [['a', 'b'], ['c', 'd'], ['e']])
  assert.deepEqual(direct, ['b', 'd'])
  assert.deepEqual(
    outcome.results.map((item) => (item.status === 'success' ? item.result : item.error.message)),
    ['a', 'b-direct', 'c', 'direct d', 'e'],
  )
  assert.deepEqual(outcome.stats, {
    batchRequests: 3,
    batchedSubcalls: 5,
    failedSubcalls: 2,
    aggregateFailures: 0,
    directFallbacks: 2,
    directRecoveries: 1,
    transientStops: 0,
  })
})

test('turns one rejected aggregate into direct evidence without losing result order', async () => {
  const aggregateError = transient('aggregate rejected')
  const outcome = await readWithBoundedMulticall({
    contracts: [{ id: 'a' }, { id: 'b' }],
    maxCalls: 4,
    readBatch: async (chunk) => chunk.map(() => ({ status: 'failure', error: aggregateError })),
    readDirect: async ({ id }) => {
      if (id === 'a') throw invariant('pool revert')
      return `${id}-direct`
    },
    isTransient,
  })

  assert.equal(outcome.results[0].status, 'failure')
  assert.equal(outcome.results[0].error.message, 'pool revert')
  assert.deepEqual(outcome.results[1], { status: 'success', result: 'b-direct' })
  assert.equal(outcome.stats.aggregateFailures, 1)
  assert.equal(outcome.stats.directFallbacks, 2)
  assert.equal(outcome.stats.directRecoveries, 1)
})

test('stops fallback fanout after the first direct transient failure', async () => {
  const direct = []
  const aggregateError = transient('aggregate rejected')
  const outcome = await readWithBoundedMulticall({
    contracts: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }],
    maxCalls: 2,
    readBatch: async (chunk) => chunk.map(() => ({ status: 'failure', error: aggregateError })),
    readDirect: async ({ id }) => {
      direct.push(id)
      throw transient(`direct ${id}`)
    },
    isTransient,
  })

  assert.deepEqual(direct, ['a'])
  assert.equal(outcome.results.length, 4)
  assert.equal(
    outcome.results.every((item) => item.status === 'failure'),
    true,
  )
  assert.equal(outcome.stats.batchRequests, 1)
  assert.equal(outcome.stats.directFallbacks, 1)
  assert.equal(outcome.stats.transientStops, 1)
})

test('rejects invalid bounds and mismatched aggregate results', async () => {
  await assert.rejects(
    readWithBoundedMulticall({
      contracts: [],
      maxCalls: 0,
      readBatch: async () => [],
      readDirect: async () => null,
      isTransient: () => false,
    }),
    /positive integer/,
  )
  await assert.rejects(
    readWithBoundedMulticall({
      contracts: [{ id: 'a' }],
      maxCalls: 1,
      readBatch: async () => [],
      readDirect: async () => null,
      isTransient: () => false,
    }),
    /result count mismatch/,
  )
})
