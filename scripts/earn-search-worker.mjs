import readline from 'node:readline'

import { earnReadOnlySearch } from './earnonhood-live.mjs'
import {
  EARN_SEARCH_WORKER_POLICY,
  earnSearchWorkerFailure,
  encodeEarnSearchResult,
  parseEarnSearchRequest,
} from '../src/resident-earn-search.mjs'

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity, terminal: false })
for await (const line of input) {
  let requestId = 'invalid-request'
  let result
  try {
    const request = parseEarnSearchRequest(line)
    requestId = request.requestId
    const { signal } = request
    const searched = await earnReadOnlySearch({
      earnGasSurplusWei: signal.searchContext.earnGasSurplusWei,
      focusPools: signal.eventPools,
      excludedRouteIds: signal.searchContext.excludedRouteIds,
    })
    result = {
      workerPolicy: EARN_SEARCH_WORKER_POLICY,
      ...searched,
    }
  } catch (error) {
    result = {
      workerPolicy: EARN_SEARCH_WORKER_POLICY,
      status: 'PREFLIGHT_FAILED_NO_SIGNATURE',
      evidenceCoverage: 'UNAVAILABLE',
      report: {
        status: 'PREFLIGHT_FAILED_NO_SIGNATURE',
        evidence: 'RESIDENT_EARN_SEARCH_FAILURE_BEFORE_MUTATION',
        reasons: ['READ_ONLY_SEARCH_UNAVAILABLE'],
        reason: earnSearchWorkerFailure(error),
      },
      candidateHint: null,
      searchedAt: new Date().toISOString(),
    }
  }
  process.stdout.write(`${encodeEarnSearchResult(requestId, result)}\n`)
}
