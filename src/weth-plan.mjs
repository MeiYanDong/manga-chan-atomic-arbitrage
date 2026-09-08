import { getAddress, keccak256, parseUnits, toHex } from 'viem'
import { BoardStatus } from './opportunity-board.mjs'
import { PoolAdmission, PoolEvidence } from './pair-catalog.mjs'
import { GENERIC_USDG, GENERIC_WETH, assertDualBoardIdentity, decodeV3Path, pairPoolKey } from './generic-plan.mjs'
import { stableStringify } from './journal.mjs'

export const WETH_HARD_MAX_AMOUNT_IN = 1_000_000_000_000_000_000n

/**
 * Build exact WETH executor payloads from the signer-free board. The nested
 * lane is untrusted input and is independently checked against the parent pool
 * catalog and same-block attestations.
 *
 * @param {Record<string, any>} snapshot
 * @param {{nowMs?: number, maxAgeMs?: number, limit?: number}} [options]
 */
export function buildWethExecutionCandidates(snapshot, options = {}) {
  assertDualBoardIdentity(snapshot)
  const nowMs = options.nowMs ?? Date.now()
  const maxAgeMs = options.maxAgeMs ?? 30_000
  const limit = options.limit ?? 6
  if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 32) throw new Error('candidate limit must be in 1..32')

  const rows = []
  for (const parent of snapshot.items || []) {
    const lane = parent.baseOpportunities?.WETH
    if (lane?.status !== BoardStatus.SCREENED_POSITIVE || lane?.fresh !== true) continue
    const completeAmounts = (lane.amountQuotes || []).filter(
      (quote) =>
        quote.status === BoardStatus.SCREENED_POSITIVE &&
        quote.entryV3Path !== undefined &&
        quote.exitV3Path !== undefined &&
        quote.legs?.entryPoolId &&
        quote.legs?.exitPoolId,
    )
    const variants = completeAmounts.length > 0 ? completeAmounts.map((quote) => ({ ...lane, ...quote })) : [lane]
    for (const variant of variants) {
      try {
        rows.push(buildCandidate(parent, variant, { nowMs, maxAgeMs }))
      } catch {}
    }
  }
  rows.sort((left, right) => {
    if (left.normalizedScreenedNetUsdg !== right.normalizedScreenedNetUsdg) {
      return left.normalizedScreenedNetUsdg > right.normalizedScreenedNetUsdg ? -1 : 1
    }
    if (left.expectedGrossProfit !== right.expectedGrossProfit) {
      return left.expectedGrossProfit > right.expectedGrossProfit ? -1 : 1
    }
    return left.amountIn < right.amountIn ? -1 : left.amountIn > right.amountIn ? 1 : 0
  })
  const unique = new Map()
  for (const candidate of rows) {
    if (!unique.has(candidate.executionKey)) unique.set(candidate.executionKey, candidate)
    if (unique.size >= limit) break
  }
  if (unique.size === 0) throw new Error('snapshot has no fresh typed WETH screened-positive candidate')
  return [...unique.values()]
}

/** @param {Record<string, any>} parent @param {Record<string, any>} lane @param {{nowMs: number, maxAgeMs: number}} options */
function buildCandidate(parent, lane, options) {
  if (
    lane.baseAsset !== 'WETH' ||
    getAddress(lane.baseToken) !== GENERIC_WETH ||
    Number(lane.baseDecimals) !== 18 ||
    lane.status !== BoardStatus.SCREENED_POSITIVE
  ) {
    throw new Error('WETH lane identity is invalid')
  }
  const quotedAtMs = Date.parse(lane.quotedAt)
  if (!Number.isFinite(quotedAtMs) || options.nowMs - quotedAtMs < 0 || options.nowMs - quotedAtMs > options.maxAgeMs) {
    throw new Error('selected WETH quote is stale or has an invalid timestamp')
  }
  if (!lane.blockNumber || !/^0x[0-9a-f]{64}$/i.test(lane.blockHash || '')) {
    throw new Error('selected WETH quote is not bound to a canonical block identity')
  }

  const amountIn = parseUnits(String(lane.amountInBase), 18)
  const expectedAmountOut = parseUnits(String(lane.amountOutBase), 18)
  const expectedGrossProfit = parseUnits(String(lane.grossProfitBase), 18)
  const screenedGasCost = parseUnits(String(lane.gasCostProxyBase), 18)
  const screenedNetProfit = parseUnits(String(lane.screenedNetBase), 18)
  const normalizedScreenedNetUsdg = parseUnits(String(lane.normalizedScreenedNetUsdg), 6)
  if (amountIn <= 0n || amountIn > WETH_HARD_MAX_AMOUNT_IN) throw new Error('selected amount exceeds the WETH hard cap')
  if (
    expectedAmountOut - amountIn !== expectedGrossProfit ||
    expectedGrossProfit - screenedGasCost !== screenedNetProfit ||
    screenedNetProfit <= 0n ||
    normalizedScreenedNetUsdg <= 0n
  ) {
    throw new Error('selected WETH quote arithmetic is inconsistent or not net-positive')
  }

  const entryPool = parent.pools?.find((pool) => pool.poolId === lane.legs?.entryPoolId)
  const exitPool = parent.pools?.find((pool) => pool.poolId === lane.legs?.exitPoolId)
  if (!entryPool || !exitPool || entryPool.poolId === exitPool.poolId) {
    throw new Error('selected WETH V4 pools are missing or identical')
  }
  for (const pool of [entryPool, exitPool]) {
    if (
      pool.poolIdEvidence !== PoolEvidence.POOL_KEY_MATCHED ||
      pool.chainAttestation?.status !== PoolEvidence.INITIALIZED_QUOTER_CONFIRMED ||
      String(pool.chainAttestation?.blockNumber) !== String(lane.blockNumber) ||
      String(pool.chainAttestation?.blockHash).toLowerCase() !== String(lane.blockHash).toLowerCase() ||
      pool.executionAdmission !== PoolAdmission.EXECUTOR_COMPATIBLE
    ) {
      throw new Error('selected WETH pool lacks same-block executable chain attestation')
    }
  }
  if (parent.id !== String(parent.tokenAddress).toLowerCase())
    throw new Error('candidate id does not match target address')
  if (lane.routeKey !== `${entryPool.poolId}:${exitPool.poolId}`) throw new Error('WETH route key does not match pools')

  const targetToken = getAddress(parent.tokenAddress)
  if ([GENERIC_WETH, GENERIC_USDG].includes(targetToken)) throw new Error('WETH target token is reserved')
  const entryToken = getAddress(entryPool.quoteAddress)
  const exitToken = getAddress(exitPool.quoteAddress)
  const entryPath = decodeV3Path(lane.entryV3Path, { bridgeToken: GENERIC_USDG })
  const exitPath = decodeV3Path(lane.exitV3Path, { bridgeToken: GENERIC_USDG })
  assertPath(entryPath, GENERIC_WETH, entryToken, 'entry WETH V3 path')
  assertPath(exitPath, exitToken, GENERIC_WETH, 'exit WETH V3 path')
  if (
    Number(lane.legs?.entryV3Hops ?? entryPath.fees.length) !== entryPath.fees.length ||
    Number(lane.legs?.exitV3Hops ?? exitPath.fees.length) !== exitPath.fees.length ||
    stableStringify(lane.legs?.entryV3Fees ?? entryPath.fees) !== stableStringify(entryPath.fees) ||
    stableStringify(lane.legs?.exitV3Fees ?? exitPath.fees) !== stableStringify(exitPath.fees)
  ) {
    throw new Error('declared WETH V3 leg metadata does not match encoded paths')
  }

  const route = {
    targetToken,
    entryToken,
    exitToken,
    entryV3Path: lane.entryV3Path,
    exitV3Path: lane.exitV3Path,
    entryV4Pool: pairPoolKey(entryPool, targetToken),
    exitV4Pool: pairPoolKey(exitPool, targetToken),
  }
  const opportunityId = `${parent.id}:${lane.blockHash}:${lane.routeKey}:WETH:${lane.amountInBase}`
  const candidate = {
    schemaVersion: 1,
    baseAsset: 'WETH',
    baseToken: GENERIC_WETH,
    baseDecimals: 18,
    opportunityId,
    opportunityRevisionId: opportunityId,
    quoteBlockNumber: BigInt(lane.blockNumber),
    quoteBlockHash: lane.blockHash,
    quotedAt: lane.quotedAt,
    routeLabel: String(lane.route || 'UNKNOWN'),
    targetSymbol: String(parent.symbol || 'UNKNOWN'),
    route,
    amountIn,
    expectedAmountOut,
    expectedGrossProfit,
    screenedGasCost,
    screenedNetProfit,
    normalizedScreenedNetUsdg,
  }
  const executionKey = keccak256(
    toHex(stableStringify({ baseAsset: candidate.baseAsset, route: candidate.route, amountIn: candidate.amountIn })),
  )
  return { ...candidate, executionKey, candidateHash: keccak256(toHex(stableStringify(candidate))) }
}

/** @param {{tokens: string[], fees: number[]}} decoded @param {string} start @param {string} end @param {string} label */
function assertPath(decoded, start, end, label) {
  if (start === end) {
    if (decoded.tokens.length !== 0) throw new Error(`${label} identity path must be empty`)
    return
  }
  if (decoded.tokens[0] !== start || decoded.tokens.at(-1) !== end) {
    throw new Error(`${label} endpoints do not match the selected quote token`)
  }
}
