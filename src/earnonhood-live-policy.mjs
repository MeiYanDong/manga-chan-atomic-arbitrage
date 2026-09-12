const BPS_DENOMINATOR = 10_000n

export const EARN_SIZING_ALGORITHM = 'BALANCE_SCALED_BRACKET_REFINEMENT_V1'

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
 * Refine one route around the best exact gross quote from a coarse, ordered
 * balance-scaled grid. The refinement stays inside the two adjacent successful
 * coarse samples (or the spendable boundary), so a bounded second quote round
 * improves sizing resolution without rescanning the complete principal range.
 *
 * Gross profit is the correct sizing objective inside one fixed route before
 * Gas evaluation because the route's execution shape is unchanged. Exact Gas
 * and protected net-profit checks still run on the selected candidate.
 *
 * @param {{spendableWei: bigint, quotes: Array<{amountIn: bigint, amountOut: bigint, error?: unknown}>, refinementPoints?: number}} input
 */
export function buildEarnOnHoodRefinementAmounts(input) {
  const { spendableWei, quotes, refinementPoints = 6 } = input
  if (typeof spendableWei !== 'bigint' || spendableWei <= 0n) {
    throw new Error('EarnOnHood refinement requires positive spendableWei')
  }
  if (!Array.isArray(quotes)) throw new Error('EarnOnHood refinement quotes must be an array')
  if (!Number.isSafeInteger(refinementPoints) || refinementPoints < 2 || refinementPoints > 16) {
    throw new Error('EarnOnHood refinementPoints must be within 2..16')
  }
  const successful = quotes
    .filter(
      (quote) =>
        !quote.error &&
        typeof quote.amountIn === 'bigint' &&
        typeof quote.amountOut === 'bigint' &&
        quote.amountIn > 0n &&
        quote.amountIn <= spendableWei &&
        quote.amountOut >= 0n,
    )
    .sort((left, right) => (left.amountIn < right.amountIn ? -1 : left.amountIn > right.amountIn ? 1 : 0))
  if (successful.length === 0) {
    return { amounts: [], bestAmountInWei: null, lowerBoundWei: null, upperBoundWei: null }
  }

  let bestIndex = 0
  for (let index = 1; index < successful.length; index += 1) {
    const bestGross = successful[bestIndex].amountOut - successful[bestIndex].amountIn
    const candidateGross = successful[index].amountOut - successful[index].amountIn
    if (candidateGross > bestGross) bestIndex = index
  }
  const bestAmountInWei = successful[bestIndex].amountIn
  const lowerBoundWei = bestIndex === 0 ? 0n : successful[bestIndex - 1].amountIn
  const upperBoundWei = bestIndex === successful.length - 1 ? spendableWei : successful[bestIndex + 1].amountIn
  const width = upperBoundWei - lowerBoundWei
  const denominator = BigInt(refinementPoints + 1)
  const known = new Set(successful.map((quote) => quote.amountIn.toString()))
  const amounts = new Set()
  for (let index = 1; index <= refinementPoints; index += 1) {
    const amount = lowerBoundWei + (width * BigInt(index)) / denominator
    if (amount > 0n && amount <= spendableWei && !known.has(amount.toString())) amounts.add(amount)
  }
  return {
    amounts: [...amounts].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)),
    bestAmountInWei,
    lowerBoundWei,
    upperBoundWei,
  }
}

/**
 * Build the managed-RPC candidate set from the public screen's immediate
 * bracket. Bounds are clipped to the current spendable balance. Re-quoting the
 * bracket endpoints, the public anchor and bounded interior points makes the
 * managed stage both current-block exact and substantially smaller than a full
 * four-route rescan.
 *
 * @param {{spendableWei: bigint, lowerBoundWei: bigint, upperBoundWei: bigint, anchorWei: bigint, refinementPoints?: number}} input
 */
export function buildEarnOnHoodTargetedAmounts(input) {
  const { spendableWei, lowerBoundWei, upperBoundWei, anchorWei, refinementPoints = 6 } = input
  if (
    [spendableWei, lowerBoundWei, upperBoundWei, anchorWei].some((value) => typeof value !== 'bigint') ||
    spendableWei <= 0n ||
    lowerBoundWei < 0n ||
    upperBoundWei <= 0n ||
    anchorWei <= 0n
  ) {
    throw new Error('EarnOnHood targeted sizing requires valid bigint bounds')
  }
  if (!Number.isSafeInteger(refinementPoints) || refinementPoints < 2 || refinementPoints > 16) {
    throw new Error('EarnOnHood refinementPoints must be within 2..16')
  }
  const lower = lowerBoundWei < spendableWei ? lowerBoundWei : 0n
  const upper = upperBoundWei < spendableWei ? upperBoundWei : spendableWei
  if (upper <= lower) return { lowerBoundWei: 0n, upperBoundWei: spendableWei, amounts: [spendableWei] }

  const amounts = new Set()
  const add = (amount) => {
    if (amount > 0n && amount <= spendableWei) amounts.add(amount)
  }
  add(lower)
  add(upper)
  add(anchorWei < spendableWei ? anchorWei : spendableWei)
  const width = upper - lower
  const denominator = BigInt(refinementPoints + 1)
  for (let index = 1; index <= refinementPoints; index += 1) {
    add(lower + (width * BigInt(index)) / denominator)
  }
  return {
    lowerBoundWei: lower,
    upperBoundWei: upper,
    amounts: [...amounts].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)),
  }
}

/**
 * Return the immediate successful quote neighbours around a selected amount.
 * These bounds become the next-stage refinement window, not an authorization
 * to exceed the current spendable balance.
 *
 * @param {{quotes: Array<{route?: {id?: string}, amountIn: bigint, amountOut: bigint, error?: unknown}>, routeId: string, selectedAmountInWei: bigint, spendableWei: bigint}} input
 */
export function earnOnHoodQuoteBracket(input) {
  const { quotes, routeId, selectedAmountInWei, spendableWei } = input
  if (!Array.isArray(quotes) || typeof routeId !== 'string' || routeId.length === 0) {
    throw new Error('EarnOnHood quote bracket requires quotes and routeId')
  }
  if (typeof selectedAmountInWei !== 'bigint' || typeof spendableWei !== 'bigint' || spendableWei <= 0n) {
    throw new Error('EarnOnHood quote bracket requires valid bigint amounts')
  }
  const routeQuotes = quotes
    .filter(
      (quote) =>
        !quote.error &&
        quote.route?.id === routeId &&
        typeof quote.amountIn === 'bigint' &&
        typeof quote.amountOut === 'bigint',
    )
    .sort((left, right) => (left.amountIn < right.amountIn ? -1 : left.amountIn > right.amountIn ? 1 : 0))
  const selectedIndex = routeQuotes.findIndex((quote) => quote.amountIn === selectedAmountInWei)
  if (selectedIndex < 0) throw new Error('selected EarnOnHood quote is absent from its route bracket')
  return {
    lowerBoundWei: selectedIndex === 0 ? 0n : routeQuotes[selectedIndex - 1].amountIn,
    upperBoundWei: selectedIndex === routeQuotes.length - 1 ? spendableWei : routeQuotes[selectedIndex + 1].amountIn,
  }
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
