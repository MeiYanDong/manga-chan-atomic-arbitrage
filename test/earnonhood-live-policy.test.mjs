import assert from 'node:assert/strict'
import test from 'node:test'
import { deriveEarnOnHoodExecutionBounds } from '../src/earnonhood-live-policy.mjs'

test('protected output floor guarantees the requested net profit at the full gas cap', () => {
  const result = deriveEarnOnHoodExecutionBounds({
    amountInWei: 2_000_000_000_000_000n,
    quotedAmountOutWei: 2_158_791_832_578_822n,
    estimatedGas: 570_990n,
    observedFeePerGasWei: 133_113_600n,
    minimumNetProfitWei: 20_000_000_000_000n,
    minimumQuoteHeadroomWei: 10_000_000_000_000n,
  })

  assert.equal(result.executable, true)
  assert.ok(result.minimumAmountOutWei + result.quoteHeadroomWei === 2_158_791_832_578_822n)
  assert.equal(result.minimumAmountOutWei - 2_000_000_000_000_000n - result.maximumGasCostWei, 20_000_000_000_000n)
  assert.ok(result.quotedNetAtGasCapWei > 20_000_000_000_000n)
})

test('a positive gross quote is rejected when it cannot cover gas, net floor, and headroom', () => {
  const result = deriveEarnOnHoodExecutionBounds({
    amountInWei: 2_000_000_000_000_000n,
    quotedAmountOutWei: 2_050_000_000_000_000n,
    estimatedGas: 570_990n,
    observedFeePerGasWei: 133_113_600n,
    minimumNetProfitWei: 20_000_000_000_000n,
    minimumQuoteHeadroomWei: 10_000_000_000_000n,
  })

  assert.equal(result.executable, false)
  assert.equal(result.reason, 'QUOTE_HEADROOM_BELOW_FLOOR')
  assert.ok(result.grossProfitWei > 0n)
  assert.ok(result.quotedNetAtGasCapWei < 0n)
})

test('buffers cannot silently reduce estimated gas or observed fee', () => {
  assert.throws(
    () =>
      deriveEarnOnHoodExecutionBounds({
        amountInWei: 1n,
        quotedAmountOutWei: 2n,
        estimatedGas: 1n,
        observedFeePerGasWei: 1n,
        minimumNetProfitWei: 1n,
        minimumQuoteHeadroomWei: 0n,
        gasLimitBufferBps: 9_999n,
      }),
    /buffers must be at least 10000 bps/,
  )
})
