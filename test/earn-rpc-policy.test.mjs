import assert from 'node:assert/strict'
import test from 'node:test'

import {
  EARN_MANAGED_FALLBACK_EVENT_LOGICAL_CALL_CAP,
  EARN_MANAGED_FALLBACK_RECOVERY_LOGICAL_CALL_CAP,
  earnManagedFallbackLogicalCallCap,
  earnWakeKind,
} from '../src/earn-rpc-policy.mjs'

test('separates event and recovery managed RPC allowances', () => {
  assert.equal(earnWakeKind('MANAGED_WSS_EARN_SWAP'), 'EVENT')
  assert.equal(earnWakeKind('FILTERED_SEQUENCER_FEED'), 'EVENT')
  assert.equal(earnWakeKind('PERIODIC_RECOVERY'), 'RECOVERY')
  assert.equal(earnWakeKind(''), 'RECOVERY')
  assert.equal(earnManagedFallbackLogicalCallCap('MANAGED_WSS_EARN_SWAP'), EARN_MANAGED_FALLBACK_EVENT_LOGICAL_CALL_CAP)
  assert.equal(earnManagedFallbackLogicalCallCap('PERIODIC_RECOVERY'), EARN_MANAGED_FALLBACK_RECOVERY_LOGICAL_CALL_CAP)
})
