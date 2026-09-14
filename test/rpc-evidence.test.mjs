import assert from 'node:assert/strict'
import test from 'node:test'

import { RpcEvidence, instrumentRpcTransport, withRpcEvidence } from '../src/rpc-evidence.mjs'

test('instrumented transport counts purpose and method without retaining request data', async () => {
  const evidence = new RpcEvidence()
  const transport = instrumentRpcTransport(
    () => ({
      request: async (args) => ({ method: args.method }),
      value: { url: 'https://secret.invalid' },
    }),
    'DISCOVERY_CLIENT',
  )({})
  await withRpcEvidence(evidence, 'COARSE_QUOTE', () =>
    transport.request({ method: 'eth_call', params: [{ to: '0xdead', data: '0xsecret' }] }),
  )
  await withRpcEvidence(evidence, 'STATE_HEAD', () => transport.request({ method: 'eth_getBlockByNumber' }))
  const snapshot = evidence.snapshot()
  assert.equal(snapshot.total, 2)
  assert.equal(snapshot.byPurpose.COARSE_QUOTE.clients.DISCOVERY_CLIENT.eth_call, 1)
  assert.equal(snapshot.byPurpose.STATE_HEAD.clients.DISCOVERY_CLIENT.eth_getBlockByNumber, 1)
  assert.doesNotMatch(JSON.stringify(snapshot), /secret|dead/)
})

test('requests outside an event context are not attributed', async () => {
  const evidence = new RpcEvidence()
  const transport = instrumentRpcTransport(() => ({ request: async () => true }), 'EXECUTION_CLIENT')({})
  await transport.request({ method: 'eth_call' })
  assert.equal(evidence.snapshot().total, 0)
})
