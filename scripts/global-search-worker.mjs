import readline from 'node:readline'

import { globalPreflight, resetGlobalPreflightWakeState } from './global-arb.mjs'
import {
  encodeGlobalSearchResult,
  GLOBAL_SEARCH_WORKER_POLICY,
  parseGlobalSearchRequest,
} from '../src/resident-global-search.mjs'
import { errorText } from '../src/policy.mjs'

function applySignal(signal) {
  const assign = (key, value) => {
    if (value === null || value === undefined || value === '') delete process.env[key]
    else process.env[key] = String(value)
  }
  assign('GLOBAL_WAKE_RECEIVED_AT', signal.receivedAt || signal.sourceReceivedAt)
  assign('GLOBAL_WAKE_SEQUENCE_NUMBER', signal.firstSequenceNumber)
  assign('GLOBAL_WAKE_LAST_SEQUENCE_NUMBER', signal.lastSequenceNumber)
  assign('GLOBAL_WAKE_ROUTE_ADDRESSES', (signal.routeAddresses || []).join(','))
  assign('GLOBAL_WAKE_CLASSIFICATION', signal.classificationReason)
  assign('GLOBAL_WAKE_REASON', 'RESIDENT_SIGNER_FREE_EVENT_SEARCH')
  assign('GLOBAL_WAKE_ENQUEUED_AT', signal.sourceReceivedAt || signal.receivedAt)
  assign('GLOBAL_WAKE_CLAIMED_AT', new Date().toISOString())
}

function workerFailure(error) {
  const evidence = error && typeof error === 'object' ? error.globalPreflightEvidence : null
  return (
    evidence || {
      schemaVersion: 2,
      generatedAt: new Date().toISOString(),
      status: 'PREFLIGHT_FAILED_NO_SIGNATURE',
      decisionClassification: 'STATE_UNAVAILABLE',
      evidenceCoverage: 'UNAVAILABLE',
      evidence: 'RESIDENT_SIGNER_FREE_WORKER_FAILURE_BEFORE_MUTATION',
      reason: errorText(error).slice(0, 240),
    }
  )
}

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity, terminal: false })
for await (const line of input) {
  let requestId = 'invalid-request'
  let result
  try {
    const request = parseGlobalSearchRequest(line)
    requestId = request.requestId
    applySignal(request.signal)
    resetGlobalPreflightWakeState()
    const prepared = await globalPreflight({ print: false, persist: false })
    result = {
      workerPolicy: GLOBAL_SEARCH_WORKER_POLICY,
      status: prepared.snapshot.status,
      snapshot: prepared.snapshot,
    }
  } catch (error) {
    result = {
      workerPolicy: GLOBAL_SEARCH_WORKER_POLICY,
      status: 'PREFLIGHT_FAILED_NO_SIGNATURE',
      snapshot: workerFailure(error),
    }
  }
  process.stdout.write(`${encodeGlobalSearchResult(requestId, result)}\n`)
}
