import assert from 'node:assert/strict'
import test from 'node:test'

import {
  EvaluationCoverage,
  EvaluationOutcome,
  classifyEvaluationFailure,
  classifyQuoteOutcome,
  summarizeEvaluationOutcomes,
} from '../src/evaluation-outcome.mjs'

test('parsed quote results alone can prove profitable or valid non-profitable', () => {
  assert.equal(classifyQuoteOutcome({ result: 7n }).outcome, EvaluationOutcome.PROFITABLE)
  assert.equal(classifyQuoteOutcome({ result: 0n }).outcome, EvaluationOutcome.VALID_NON_PROFITABLE)
  assert.equal(classifyQuoteOutcome({ result: -2n }).outcome, EvaluationOutcome.VALID_NON_PROFITABLE)
})

test('RPC and unavailable state never become no-profit evidence', () => {
  const network = Object.assign(new Error('HTTP request failed'), { name: 'HttpRequestError' })
  assert.equal(classifyQuoteOutcome({ error: network }).outcome, EvaluationOutcome.RPC_ERROR)
  assert.equal(
    classifyQuoteOutcome({ error: new Error('header not found for requested block') }).outcome,
    EvaluationOutcome.STATE_UNAVAILABLE,
  )
})

test('policy and unsupported failures remain distinct from economic results', () => {
  assert.equal(
    classifyEvaluationFailure(new Error('gross quote does not fund worst-case Gas plus net floor')),
    EvaluationOutcome.POLICY_FILTERED,
  )
  assert.equal(
    classifyEvaluationFailure(new Error('no graph-verified V3 valuation path for settlement asset')),
    EvaluationOutcome.UNSUPPORTED,
  )
  assert.equal(
    classifyEvaluationFailure(Object.assign(new Error('bounded aggregate'), { evaluationOutcome: 'RPC_ERROR' })),
    EvaluationOutcome.RPC_ERROR,
  )
})

test('summary exposes partial coverage while retaining valid economic evidence', () => {
  const summary = summarizeEvaluationOutcomes([
    { outcome: EvaluationOutcome.VALID_NON_PROFITABLE },
    { outcome: EvaluationOutcome.RPC_ERROR, stage: 'COARSE', reason: 'timeout' },
  ])
  assert.equal(summary.decisionClassification, EvaluationOutcome.VALID_NON_PROFITABLE)
  assert.equal(summary.coverage, EvaluationCoverage.PARTIAL)
  assert.equal(summary.valid, 1)
  assert.equal(summary.unavailable, 1)
  assert.equal(summary.counts.RPC_ERROR, 1)
  assert.deepEqual(summary.samples, [
    {
      outcome: EvaluationOutcome.RPC_ERROR,
      stage: 'COARSE',
      templateId: null,
      fundingMode: null,
      rpcClass: null,
      reason: 'timeout',
    },
  ])
})

test('all failed calls report unavailable coverage instead of no profit', () => {
  const summary = summarizeEvaluationOutcomes([
    { outcome: EvaluationOutcome.RPC_ERROR },
    { outcome: EvaluationOutcome.STATE_UNAVAILABLE },
  ])
  assert.equal(summary.decisionClassification, EvaluationOutcome.STATE_UNAVAILABLE)
  assert.equal(summary.coverage, EvaluationCoverage.UNAVAILABLE)
  assert.equal(summary.valid, 0)
})

test('empty worksets remain explicit', () => {
  const summary = summarizeEvaluationOutcomes([])
  assert.equal(summary.decisionClassification, EvaluationOutcome.STATE_UNAVAILABLE)
  assert.equal(summary.coverage, EvaluationCoverage.EMPTY)
})
