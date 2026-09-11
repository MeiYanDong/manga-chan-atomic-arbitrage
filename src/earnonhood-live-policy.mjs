const BPS_DENOMINATOR = 10_000n

/** @param {bigint} numerator @param {bigint} denominator */
export function ceilDiv(numerator, denominator) {
  if (numerator < 0n || denominator <= 0n)
    throw new Error('ceilDiv expects a non-negative numerator and positive denominator')
  return (numerator + denominator - 1n) / denominator
}

/** @param {unknown} value @param {string} label */
function positiveBigInt(value, label) {
  if (typeof value !== 'bigint' || value <= 0n) throw new Error(`${label} must be a positive bigint`)
  return value
}

/**
 * Turns an exact quote and gas estimate into an on-chain output floor. If the
 * router meets this floor, the wallet's final native balance must increase by
 * at least minimumNetProfitWei even when the complete gas limit is charged at
 * maxFeePerGas.
 * @param {{amountInWei: bigint, quotedAmountOutWei: bigint, estimatedGas: bigint, observedFeePerGasWei: bigint, minimumNetProfitWei: bigint, minimumQuoteHeadroomWei: bigint, gasLimitBufferBps?: bigint, feeBufferBps?: bigint}} input
 */
export function deriveEarnOnHoodExecutionBounds(input) {
  const {
    amountInWei,
    quotedAmountOutWei,
    estimatedGas,
    observedFeePerGasWei,
    minimumNetProfitWei,
    minimumQuoteHeadroomWei,
    gasLimitBufferBps = 11_500n,
    feeBufferBps = 10_500n,
  } = input
  positiveBigInt(amountInWei, 'amountInWei')
  positiveBigInt(quotedAmountOutWei, 'quotedAmountOutWei')
  positiveBigInt(estimatedGas, 'estimatedGas')
  positiveBigInt(observedFeePerGasWei, 'observedFeePerGasWei')
  positiveBigInt(minimumNetProfitWei, 'minimumNetProfitWei')
  if (typeof minimumQuoteHeadroomWei !== 'bigint' || minimumQuoteHeadroomWei < 0n) {
    throw new Error('minimumQuoteHeadroomWei must be a non-negative bigint')
  }
  if (gasLimitBufferBps < BPS_DENOMINATOR || feeBufferBps < BPS_DENOMINATOR) {
    throw new Error('gas and fee buffers must be at least 10000 bps')
  }

  const gasLimit = ceilDiv(estimatedGas * gasLimitBufferBps, BPS_DENOMINATOR)
  const maxFeePerGas = ceilDiv(observedFeePerGasWei * feeBufferBps, BPS_DENOMINATOR)
  const maximumGasCostWei = gasLimit * maxFeePerGas
  const minimumAmountOutWei = amountInWei + maximumGasCostWei + minimumNetProfitWei
  const grossProfitWei = quotedAmountOutWei - amountInWei
  const quotedNetAtGasCapWei = grossProfitWei - maximumGasCostWei
  const quoteHeadroomWei = quotedAmountOutWei - minimumAmountOutWei
  const executable = quoteHeadroomWei >= minimumQuoteHeadroomWei

  return {
    executable,
    reason: executable ? null : 'QUOTE_HEADROOM_BELOW_FLOOR',
    gasLimit,
    maxFeePerGas,
    maximumGasCostWei,
    minimumAmountOutWei,
    grossProfitWei,
    quotedNetAtGasCapWei,
    quoteHeadroomWei,
  }
}
