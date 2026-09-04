import { encodeAbiParameters, getAddress, keccak256, parseUnits, toHex } from 'viem'
import { stableStringify } from './journal.mjs'
import { BoardStatus } from './opportunity-board.mjs'
import { MAX_AMOUNT_IN_USDG } from './route-optimizer.mjs'

export const GENERIC_USDG = getAddress('0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168')
export const GENERIC_WETH = getAddress('0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73')
export const GENERIC_PAIR_HOOK = getAddress('0x16D1560630Ce74af4478d9b8AD46548A092A2000')
export const GENERIC_PAIR_FEE = 10_000
export const GENERIC_PAIR_TICK_SPACING = 200
export const GENERIC_V3_FEES = Object.freeze([100, 500, 3_000, 10_000])

const POOL_KEY_ABI = [
  {
    type: 'tuple',
    components: [
      { name: 'currency0', type: 'address' },
      { name: 'currency1', type: 'address' },
      { name: 'fee', type: 'uint24' },
      { name: 'tickSpacing', type: 'int24' },
      { name: 'hooks', type: 'address' },
    ],
  },
]

/** @param {{currency0: string, currency1: string, fee: number, tickSpacing: number, hooks: string}} key */
export function pairPoolId(key) {
  return keccak256(encodeAbiParameters(POOL_KEY_ABI, [key]))
}

/** @param {string} path */
export function decodeV3Path(path) {
  if (path === '0x') return { tokens: [], fees: [] }
  if (typeof path !== 'string' || !/^0x[0-9a-f]+$/i.test(path) || path.length % 2 !== 0) {
    throw new Error('invalid V3 path encoding')
  }
  const raw = path.slice(2)
  const byteLength = raw.length / 2
  if (byteLength < 43 || byteLength > 66 || (byteLength - 20) % 23 !== 0) {
    throw new Error('V3 path must contain one or two hops')
  }
  const tokens = [getAddress(`0x${raw.slice(0, 40)}`)]
  const fees = []
  let cursor = 40
  while (cursor < raw.length) {
    fees.push(Number.parseInt(raw.slice(cursor, cursor + 6), 16))
    cursor += 6
    tokens.push(getAddress(`0x${raw.slice(cursor, cursor + 40)}`))
    cursor += 40
  }
  if (fees.some((fee) => !GENERIC_V3_FEES.includes(fee))) throw new Error('V3 path uses a fee outside the allowlist')
  if (fees.length === 2 && tokens[1] !== GENERIC_WETH) throw new Error('two-hop V3 path must use WETH as the bridge')
  return { tokens, fees }
}

/** @param {Record<string, any>} pool @param {string} targetToken */
export function pairPoolKey(pool, targetToken) {
  const target = getAddress(targetToken)
  const quote = getAddress(pool.quoteAddress)
  const currency0 = BigInt(target) < BigInt(quote) ? target : quote
  const currency1 = currency0 === target ? quote : target
  if (
    Number(pool.fee) !== GENERIC_PAIR_FEE ||
    Number(pool.tickSpacing) !== GENERIC_PAIR_TICK_SPACING ||
    getAddress(pool.hookAddress) !== GENERIC_PAIR_HOOK
  ) {
    throw new Error('selected pool does not match the reviewed PAIR pool shape')
  }
  const key = {
    currency0,
    currency1,
    fee: GENERIC_PAIR_FEE,
    tickSpacing: GENERIC_PAIR_TICK_SPACING,
    hooks: GENERIC_PAIR_HOOK,
  }
  if (!/^0x[0-9a-f]{64}$/i.test(pool.poolId || '') || pairPoolId(key) !== pool.poolId.toLowerCase()) {
    throw new Error('selected pool id does not match its canonical PoolKey')
  }
  return key
}

/** @param {Record<string, any>} snapshot */
function assertBoardIdentity(snapshot) {
  if (
    snapshot?.schemaVersion !== 2 ||
    snapshot.service !== 'manga-opportunity-board' ||
    snapshot.mode !== 'READ_ONLY_NO_SIGNING_NO_BROADCAST' ||
    snapshot.selection?.executionAuthorized !== false
  ) {
    throw new Error('snapshot identity or read-only boundary is invalid')
  }
}

/**
 * Convert the board's globally selected, fresh positive row into the typed
 * payload accepted by GenericAtomicArb. The snapshot is untrusted input and is
 * revalidated here; this is a plan builder, not execution authorization.
 *
 * @param {Record<string, any>} snapshot
 * @param {{nowMs?: number, maxAgeMs?: number}} [options]
 */
export function buildGenericExecutionCandidate(snapshot, options = {}) {
  assertBoardIdentity(snapshot)
  const nowMs = options.nowMs ?? Date.now()
  const maxAgeMs = options.maxAgeMs ?? 30_000
  const selectedId = snapshot?.selection?.id
  const item = (snapshot?.items || []).find((candidate) => candidate.id === selectedId)
  return buildCandidateFromItem(item, { nowMs, maxAgeMs })
}

/**
 * Produce a bounded exact-preflight set from the strongest board screens. A
 * board amount quote is admitted only when it carries the complete typed route
 * payload; older schema-v2 snapshots safely fall back to the item's winner.
 *
 * @param {Record<string, any>} snapshot
 * @param {{nowMs?: number, maxAgeMs?: number, limit?: number}} [options]
 */
export function buildGenericExecutionCandidates(snapshot, options = {}) {
  assertBoardIdentity(snapshot)
  const nowMs = options.nowMs ?? Date.now()
  const maxAgeMs = options.maxAgeMs ?? 30_000
  const limit = options.limit ?? 6
  if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 32) throw new Error('candidate limit must be in 1..32')

  const rows = []
  for (const item of snapshot?.items || []) {
    if (item.status !== BoardStatus.SCREENED_POSITIVE || item.fresh !== true) continue
    const completeAmounts = (item.amountQuotes || []).filter(
      (quote) =>
        quote.status === BoardStatus.SCREENED_POSITIVE &&
        quote.entryV3Path !== undefined &&
        quote.exitV3Path !== undefined &&
        quote.legs?.entryPoolId &&
        quote.legs?.exitPoolId,
    )
    const variants = completeAmounts.length > 0 ? completeAmounts.map((quote) => ({ ...item, ...quote })) : [item]
    for (const variant of variants) {
      try {
        rows.push(buildCandidateFromItem(variant, { nowMs, maxAgeMs }))
      } catch {}
    }
  }
  rows.sort((left, right) => {
    if (left.screenedNetProfit !== right.screenedNetProfit) {
      return left.screenedNetProfit > right.screenedNetProfit ? -1 : 1
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
  if (unique.size === 0) throw new Error('snapshot has no fresh typed screened-positive candidate')
  return [...unique.values()]
}

/** @param {Record<string, any> | undefined} item @param {{nowMs: number, maxAgeMs: number}} options */
function buildCandidateFromItem(item, options) {
  const { nowMs, maxAgeMs } = options
  if (!item || item.status !== BoardStatus.SCREENED_POSITIVE || item.fresh !== true) {
    throw new Error('snapshot has no fresh screened-positive selection')
  }
  const quotedAtMs = Date.parse(item.quotedAt)
  if (!Number.isFinite(quotedAtMs) || nowMs - quotedAtMs < 0 || nowMs - quotedAtMs > maxAgeMs) {
    throw new Error('selected quote is stale or has an invalid timestamp')
  }
  if (!item.blockNumber || !/^0x[0-9a-f]{64}$/i.test(item.blockHash || '')) {
    throw new Error('selected quote is not bound to a canonical block identity')
  }
  const amountIn = parseUnits(String(item.amountInUsdg), 6)
  if (amountIn <= 0n || amountIn > MAX_AMOUNT_IN_USDG) throw new Error('selected amount exceeds the 100 USDG cap')
  const expectedAmountOut = parseUnits(String(item.amountOutUsdg), 6)
  const expectedGrossProfit = parseUnits(String(item.grossProfitUsdg), 6)
  const screenedGasCost = parseUnits(String(item.gasCostProxyUsdg), 6)
  const screenedNetProfit = parseUnits(String(item.screenedNetUsdg), 6)
  if (
    expectedAmountOut - amountIn !== expectedGrossProfit ||
    expectedGrossProfit - screenedGasCost !== screenedNetProfit ||
    screenedNetProfit <= 0n
  ) {
    throw new Error('selected quote arithmetic is inconsistent or not net-positive')
  }

  const entryPool = item.pools?.find((pool) => pool.poolId === item.legs?.entryPoolId)
  const exitPool = item.pools?.find((pool) => pool.poolId === item.legs?.exitPoolId)
  if (!entryPool || !exitPool || entryPool.poolId === exitPool.poolId) {
    throw new Error('selected V4 pools are missing or identical')
  }
  if (item.id !== String(item.tokenAddress).toLowerCase()) throw new Error('candidate id does not match target address')
  if (item.routeKey !== `${entryPool.poolId}:${exitPool.poolId}`)
    throw new Error('route key does not match selected pools')
  const targetToken = getAddress(item.tokenAddress)
  const entryToken = getAddress(entryPool.quoteAddress)
  const exitToken = getAddress(exitPool.quoteAddress)
  const entryPath = decodeV3Path(item.entryV3Path)
  const exitPath = decodeV3Path(item.exitV3Path)
  const assertPath = (decoded, start, end, label) => {
    if (start === end) {
      if (decoded.tokens.length !== 0) throw new Error(`${label} identity path must be empty`)
      return
    }
    if (decoded.tokens[0] !== start || decoded.tokens.at(-1) !== end) {
      throw new Error(`${label} endpoints do not match the selected quote token`)
    }
  }
  assertPath(entryPath, GENERIC_USDG, entryToken, 'entry V3 path')
  assertPath(exitPath, exitToken, GENERIC_USDG, 'exit V3 path')
  if (
    Number(item.legs?.entryV3Hops ?? entryPath.fees.length) !== entryPath.fees.length ||
    Number(item.legs?.exitV3Hops ?? exitPath.fees.length) !== exitPath.fees.length ||
    stableStringify(item.legs?.entryV3Fees ?? entryPath.fees) !== stableStringify(entryPath.fees) ||
    stableStringify(item.legs?.exitV3Fees ?? exitPath.fees) !== stableStringify(exitPath.fees)
  ) {
    throw new Error('declared V3 leg metadata does not match the encoded paths')
  }

  const route = {
    targetToken,
    entryToken,
    exitToken,
    entryV3Path: item.entryV3Path,
    exitV3Path: item.exitV3Path,
    entryV4Pool: pairPoolKey(entryPool, targetToken),
    exitV4Pool: pairPoolKey(exitPool, targetToken),
  }
  const candidate = {
    schemaVersion: 1,
    opportunityId: `${item.id}:${item.blockHash}:${item.routeKey}:${item.amountInUsdg}`,
    quoteBlockNumber: BigInt(item.blockNumber),
    quoteBlockHash: item.blockHash,
    quotedAt: item.quotedAt,
    routeLabel: String(item.route || 'UNKNOWN'),
    targetSymbol: String(item.symbol || 'UNKNOWN'),
    route,
    amountIn,
    expectedAmountOut,
    expectedGrossProfit,
    screenedGasCost,
    screenedNetProfit,
  }
  const executionKey = keccak256(toHex(stableStringify({ route: candidate.route, amountIn: candidate.amountIn })))
  return { ...candidate, executionKey, candidateHash: keccak256(toHex(stableStringify(candidate))) }
}
