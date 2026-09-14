import assert from 'node:assert/strict'
import test from 'node:test'

import { EventLifecycle } from '../src/event-lifecycle.mjs'

test('one event retains queue, state version and bounded stage timing', () => {
  const lifecycle = new EventLifecycle({
    eventId: 'ROBINHOOD_SEQUENCER:100:101',
    source: 'SEQUENCER_FEED',
    observedAt: '2026-09-15T00:00:00.000Z',
    enqueuedAt: '2026-09-15T00:00:00.010Z',
    dequeuedAt: '2026-09-15T00:00:00.020Z',
    firstSequenceNumber: '100',
    lastSequenceNumber: '101',
  })
  lifecycle
    .pinState({ number: 42n, hash: `0x${'ab'.repeat(32)}` })
    .setVersions({ catalogVersion: 'EARN:41|UNISWAP:41', graphVersion: '0xgraph' })
    .mark('QUOTES_COMPLETE', { candidateCount: 7, endpoint: 'https://secret.invalid' }, '2026-09-15T00:00:00.050Z')
  const snapshot = lifecycle.snapshot()
  assert.equal(snapshot.currentStage, 'QUOTES_COMPLETE')
  assert.equal(snapshot.state.blockNumber, '42')
  assert.equal(snapshot.state.blockHash, `0x${'ab'.repeat(32)}`)
  assert.equal(snapshot.stages.at(-1).sinceObservedMs, 50)
  assert.equal(snapshot.stages.at(-1).candidateCount, 7)
  assert.equal(snapshot.stages.at(-1).endpoint, undefined)
  assert.doesNotMatch(JSON.stringify(snapshot), /secret\.invalid/)
})

test('event identity cannot smuggle an endpoint', () => {
  assert.throws(
    () => new EventLifecycle({ eventId: 'https://secret.invalid', source: 'SEQUENCER_FEED' }),
    /id is invalid/,
  )
})
