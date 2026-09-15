import assert from 'node:assert/strict'
import test from 'node:test'

import { retryReadOnly } from '../src/event-driven-shadow.mjs'
import {
  mapSettlementFundingCandidates,
  mapSettlementValuationPaths,
  settleConcurrentReads,
} from '../src/global-settlement-read-scheduler.mjs'
import { GLOBAL_SETTLEMENT_READ_POLICY } from '../src/global-settlement-assets.mjs'
import { isTransientRpcError } from '../src/policy.mjs'

test('settlement schedulers bound nested funding reads and wide valuation paths', async () => {
  let activeReads = 0
  let peakReads = 0
  let activeQuotes = 0
  let peakQuotes = 0
  let throttleOnce = true

  const tracked = async (kind, result) => {
    if (kind === 'read') {
      activeReads += 1
      peakReads = Math.max(peakReads, activeReads)
    } else {
      activeQuotes += 1
      peakQuotes = Math.max(peakQuotes, activeQuotes)
    }
    try {
      await new Promise((resolve) => setTimeout(resolve, 5))
      return result()
    } finally {
      if (kind === 'read') activeReads -= 1
      else activeQuotes -= 1
    }
  }

  let fundingRetries = 0
  const funding = await mapSettlementFundingCandidates(['USDG', 'WETH'], (token) =>
    retryReadOnly(
      () =>
        settleConcurrentReads(
          Array.from({ length: GLOBAL_SETTLEMENT_READ_POLICY.fundingCallsPerCandidate }, (_, index) =>
            tracked('read', () => {
              if (token === 'WETH' && index === 0 && throttleOnce) {
                throttleOnce = false
                throw Object.assign(new Error('transient test throttle'), { rpcClass: 'THROTTLED' })
              }
              return `${token}:${index}`
            }),
          ),
        ),
      {
        attempts: GLOBAL_SETTLEMENT_READ_POLICY.maximumAttempts,
        delayMs: 0,
        shouldRetry: isTransientRpcError,
        onRetry: () => {
          fundingRetries += 1
        },
      },
    ),
  )
  const quotes = await mapSettlementValuationPaths(
    Array.from({ length: 12 }, (_, index) => index),
    (index) => tracked('quote', () => index + 1),
  )

  assert.equal(funding.length, 2)
  assert.equal(fundingRetries, 1)
  assert.equal(quotes.length, 12)
  assert.deepEqual(
    quotes,
    Array.from({ length: 12 }, (_, index) => index + 1),
  )
  assert.ok(
    peakReads <=
      GLOBAL_SETTLEMENT_READ_POLICY.fundingCandidateConcurrency *
        GLOBAL_SETTLEMENT_READ_POLICY.fundingCallsPerCandidate,
  )
  assert.ok(peakQuotes <= GLOBAL_SETTLEMENT_READ_POLICY.maximumLogicalConcurrency)
})
