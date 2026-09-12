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

/** @param {string} value */
function decimalEtherToWei(value) {
  if (!/^-?\d+(?:\.\d{1,18})?$/.test(String(value))) throw new Error(`invalid ETH decimal: ${value}`)
  const negative = String(value).startsWith('-')
  const unsigned = negative ? String(value).slice(1) : String(value)
  const [whole, fraction = ''] = unsigned.split('.')
  const wei = BigInt(whole) * 10n ** 18n + BigInt(fraction.padEnd(18, '0'))
  return negative ? -wei : wei
}

/**
 * Build a balance-scaled probe grid. There is deliberately no fixed principal
 * ceiling: the largest probe is exactly all currently spendable native ETH
 * after the wallet reserve and one full failed-Gas allowance.
 *
 * @param {{walletBalanceWei: bigint, walletReserveWei: bigint, gasRiskAllowanceWei: bigint, probePoints?: number}} input
 */
export function buildEarnOnHoodProbeAmounts(input) {
  const { walletBalanceWei, walletReserveWei, gasRiskAllowanceWei, probePoints = 24 } = input
  if ([walletBalanceWei, walletReserveWei, gasRiskAllowanceWei].some((value) => typeof value !== 'bigint')) {
    throw new Error('EarnOnHood sizing inputs must be bigint')
  }
  if (walletBalanceWei <= 0n || walletReserveWei < 0n || gasRiskAllowanceWei <= 0n) {
    throw new Error('EarnOnHood sizing requires positive balance/Gas allowance and a non-negative reserve')
  }
  if (!Number.isSafeInteger(probePoints) || probePoints < 4 || probePoints > 64) {
    throw new Error('EarnOnHood probePoints must be within 4..64')
  }
  const spendableWei = walletBalanceWei - walletReserveWei - gasRiskAllowanceWei
  if (spendableWei <= 0n) return { spendableWei: 0n, amounts: [] }

  const denominator = BigInt(probePoints * probePoints)
  const amounts = new Set()
  for (let index = 1; index <= probePoints; index += 1) {
    const numerator = BigInt(index * index)
    const amount = (spendableWei * numerator) / denominator
    if (amount > 0n) amounts.add(amount)
  }
  amounts.add(spendableWei)
  return { spendableWei, amounts: [...amounts].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)) }
}

/**
 * Keep the best gross quote from every reviewed route in the bounded Gas
 * evaluation set before filling the remaining slots globally. Gas is largely
 * fixed per route, so the maximum-gross amount is also the useful first Gas
 * sample for that route. This prevents a lower-Gas two-hop route from being
 * hidden by several higher-gross but net-negative three-hop amounts.
 *
 * @param {Array<{route: {id: string}, amountIn: bigint, amountOut: bigint, error?: unknown}>} quotes
 * @param {number} maximumCandidates
 */
export function selectEarnOnHoodGasCandidates(quotes, maximumCandidates) {
  if (!Array.isArray(quotes)) throw new Error('EarnOnHood Gas candidates must be an array')
  if (!Number.isSafeInteger(maximumCandidates) || maximumCandidates <= 0) {
    throw new Error('EarnOnHood Gas candidate limit must be a positive integer')
  }
  const positive = quotes
    .filter(
      (quote) =>
        !quote.error &&
        typeof quote.route?.id === 'string' &&
        quote.route.id.length > 0 &&
        typeof quote.amountIn === 'bigint' &&
        typeof quote.amountOut === 'bigint' &&
        quote.amountOut > quote.amountIn,
    )
    .sort((left, right) => {
      const leftGross = left.amountOut - left.amountIn
      const rightGross = right.amountOut - right.amountIn
      return rightGross === leftGross ? 0 : rightGross > leftGross ? 1 : -1
    })
  const selected = []
  const selectedQuotes = new Set()
  const representedRoutes = new Set()
  for (const quote of positive) {
    if (representedRoutes.has(quote.route.id)) continue
    selected.push(quote)
    selectedQuotes.add(quote)
    representedRoutes.add(quote.route.id)
  }
  selected.sort((left, right) => {
    const leftGross = left.amountOut - left.amountIn
    const rightGross = right.amountOut - right.amountIn
    return rightGross === leftGross ? 0 : rightGross > leftGross ? 1 : -1
  })
  if (selected.length > maximumCandidates) return selected.slice(0, maximumCandidates)
  for (const quote of positive) {
    if (selectedQuotes.has(quote)) continue
    selected.push(quote)
    if (selected.length === maximumCandidates) break
  }
  return selected
}

/**
 * Rebuild the Earn lane's lifetime gas-solvency balance from receipt-backed
 * append-only records. Positive mutation effects are already net of Gas;
 * reverted transactions contribute their canonical Gas loss.
 *
 * @param {Array<Record<string, any>>} records
 * @param {{authorizationId?: string | null, initialSurplusWei?: bigint}} [options]
 */
export function earnOnHoodGasSolvency(records, options = {}) {
  const authorizationId = options.authorizationId || null
  const initialSurplusWei = options.initialSurplusWei || 0n
  if (!Array.isArray(records) || typeof initialSurplusWei !== 'bigint' || initialSurplusWei < 0n) {
    throw new Error('invalid EarnOnHood gas-solvency input')
  }
  let realizedNetProfitWei = 0n
  let failedGasWei = 0n
  let confirmedProfitableExecutions = 0
  let revertedExecutions = 0
  const seenEffects = new Set()
  const seenReverts = new Set()

  for (const record of records) {
    if (authorizationId && record.authorizationId !== authorizationId) continue
    const isEarn = record.kind === 'earnonhood-execute' || String(record.lane || '').startsWith('earnonhood')
    const transactionHash = record.hash || record.transaction
    if (!isEarn || !transactionHash) continue
    if (record.event === 'mutation_effect' && !seenEffects.has(transactionHash)) {
      const net =
        record.realizedNetProfitWei !== undefined
          ? BigInt(record.realizedNetProfitWei)
          : record.realizedNetProfitEth !== undefined
            ? decimalEtherToWei(record.realizedNetProfitEth)
            : null
      if (net === null) throw new Error('EarnOnHood mutation effect lacks realized net-profit evidence')
      seenEffects.add(transactionHash)
      realizedNetProfitWei += net
      if (net > 0n) confirmedProfitableExecutions += 1
    }
    if (record.event === 'mutation_reverted' && !seenReverts.has(transactionHash)) {
      if (record.gasSpentWei === undefined) throw new Error('EarnOnHood revert lacks canonical Gas evidence')
      seenReverts.add(transactionHash)
      failedGasWei += BigInt(record.gasSpentWei)
      revertedExecutions += 1
    }
  }
  return {
    initialSurplusWei,
    realizedNetProfitWei,
    failedGasWei,
    surplusWei: initialSurplusWei + realizedNetProfitWei - failedGasWei,
    confirmedProfitableExecutions,
    revertedExecutions,
  }
}

/**
 * Permit a new attempt only when charging its entire buffered Gas limit would
 * leave the lifetime Earn lane strictly net-positive.
 *
 * @param {bigint} currentSurplusWei
 * @param {bigint} maximumGasCostWei
 */
export function preservesEarnOnHoodLongTermProfit(currentSurplusWei, maximumGasCostWei) {
  if (typeof currentSurplusWei !== 'bigint' || typeof maximumGasCostWei !== 'bigint') {
    throw new Error('EarnOnHood gas-solvency values must be bigint')
  }
  return currentSurplusWei > 0n && maximumGasCostWei > 0n && currentSurplusWei - maximumGasCostWei > 0n
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
