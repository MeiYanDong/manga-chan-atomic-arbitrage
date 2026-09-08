/** @param {bigint} numerator @param {bigint} denominator */
function ceilDiv(numerator, denominator) {
  if (denominator <= 0n) throw new Error('denominator must be positive')
  return (numerator + denominator - 1n) / denominator
}

/** @param {bigint} value @param {bigint} bps */
function bpsCeil(value, bps) {
  return ceilDiv(value * bps, 10_000n)
}

/** @param {bigint[]} values */
function maximum(values) {
  return values.reduce((current, value) => (value > current ? value : current))
}

/**
 * Turn one exact executor simulation into bounded transaction economics. All
 * USDG values use six decimals and nativeMarkOutUsdg prices nativeMarkInWei.
 *
 * @param {{simulatedGrossProfit: bigint, estimatedGas: bigint, gasPriceWei: bigint, nativeMarkInWei: bigint, nativeMarkOutUsdg: bigint, minimumGrossProfit: bigint, minimumNetProfit: bigint, profitRetentionBps: bigint, gasLimitBufferBps?: bigint, feeHeadroomBps?: bigint}} input
 */
export function deriveExecutionEconomics(input) {
  const gasLimitBufferBps = input.gasLimitBufferBps ?? 11_000n
  const feeHeadroomBps = input.feeHeadroomBps ?? 10_500n
  if (
    input.simulatedGrossProfit <= 0n ||
    input.estimatedGas <= 0n ||
    input.gasPriceWei <= 0n ||
    input.nativeMarkInWei <= 0n ||
    input.nativeMarkOutUsdg <= 0n ||
    input.minimumGrossProfit <= 0n ||
    input.minimumNetProfit < 0n ||
    input.profitRetentionBps <= 0n ||
    input.profitRetentionBps > 10_000n
  ) {
    throw new Error('invalid execution economics input')
  }

  const estimatedGasCostUsdg = ceilDiv(
    input.estimatedGas * input.gasPriceWei * input.nativeMarkOutUsdg,
    input.nativeMarkInWei,
  )
  const expectedNetProfitUsdg = input.simulatedGrossProfit - estimatedGasCostUsdg
  if (expectedNetProfitUsdg < input.minimumNetProfit) throw new Error('exact simulation does not meet the net floor')

  const gasLimit = bpsCeil(input.estimatedGas, gasLimitBufferBps) + 5_000n
  const minimumProfit = maximum([
    input.minimumGrossProfit,
    (input.simulatedGrossProfit * input.profitRetentionBps) / 10_000n,
    estimatedGasCostUsdg + input.minimumNetProfit,
  ])
  if (minimumProfit > input.simulatedGrossProfit) throw new Error('gross profit cannot fund the protected net floor')

  const maxFeeByProfit =
    ((minimumProfit - input.minimumNetProfit) * input.nativeMarkInWei) / (gasLimit * input.nativeMarkOutUsdg)
  const maxFeeByHeadroom = bpsCeil(input.gasPriceWei, feeHeadroomBps)
  const maxFeePerGas = maxFeeByProfit < maxFeeByHeadroom ? maxFeeByProfit : maxFeeByHeadroom
  if (maxFeePerGas < input.gasPriceWei) throw new Error('protected max fee is below the current gas price')

  const maximumGasCostUsdg = ceilDiv(gasLimit * maxFeePerGas * input.nativeMarkOutUsdg, input.nativeMarkInWei)
  if (minimumProfit < maximumGasCostUsdg + input.minimumNetProfit) {
    throw new Error('worst-case gas cost breaks the protected net floor')
  }
  return {
    estimatedGasCostUsdg,
    expectedNetProfitUsdg,
    gasLimit,
    minimumProfit,
    maxFeePerGas,
    maximumGasCostUsdg,
  }
}

/**
 * WETH profit and native Gas share the same 18-decimal economic unit, so this
 * variant does not need an external price mark to enforce the net floor.
 *
 * @param {{simulatedGrossProfit: bigint, estimatedGas: bigint, gasPriceWei: bigint, minimumGrossProfit: bigint, minimumNetProfit: bigint, profitRetentionBps: bigint, gasLimitBufferBps?: bigint, feeHeadroomBps?: bigint}} input
 */
export function deriveWethExecutionEconomics(input) {
  const gasLimitBufferBps = input.gasLimitBufferBps ?? 11_000n
  const feeHeadroomBps = input.feeHeadroomBps ?? 10_500n
  if (
    input.simulatedGrossProfit <= 0n ||
    input.estimatedGas <= 0n ||
    input.gasPriceWei <= 0n ||
    input.minimumGrossProfit <= 0n ||
    input.minimumNetProfit < 0n ||
    input.profitRetentionBps <= 0n ||
    input.profitRetentionBps > 10_000n
  ) {
    throw new Error('invalid WETH execution economics input')
  }

  const estimatedGasCostWei = input.estimatedGas * input.gasPriceWei
  const expectedNetProfitWei = input.simulatedGrossProfit - estimatedGasCostWei
  if (expectedNetProfitWei < input.minimumNetProfit)
    throw new Error('exact WETH simulation does not meet the net floor')

  const gasLimit = bpsCeil(input.estimatedGas, gasLimitBufferBps) + 5_000n
  const minimumProfit = maximum([
    input.minimumGrossProfit,
    (input.simulatedGrossProfit * input.profitRetentionBps) / 10_000n,
    estimatedGasCostWei + input.minimumNetProfit,
  ])
  if (minimumProfit > input.simulatedGrossProfit)
    throw new Error('WETH gross profit cannot fund the protected net floor')

  const maxFeeByProfit = (minimumProfit - input.minimumNetProfit) / gasLimit
  const maxFeeByHeadroom = bpsCeil(input.gasPriceWei, feeHeadroomBps)
  const maxFeePerGas = maxFeeByProfit < maxFeeByHeadroom ? maxFeeByProfit : maxFeeByHeadroom
  if (maxFeePerGas < input.gasPriceWei) throw new Error('protected WETH max fee is below the current gas price')

  const maximumGasCostWei = gasLimit * maxFeePerGas
  if (minimumProfit < maximumGasCostWei + input.minimumNetProfit) {
    throw new Error('worst-case Gas breaks the protected WETH net floor')
  }
  return {
    estimatedGasCostWei,
    expectedNetProfitWei,
    gasLimit,
    minimumProfit,
    maxFeePerGas,
    maximumGasCostWei,
  }
}
