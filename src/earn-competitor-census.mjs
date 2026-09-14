import { createHash } from 'node:crypto'

import { decodeEventLog, formatEther, formatUnits, parseEther } from 'viem'

import { EARN_SWAP_ABI } from './earnonhood-receipt.mjs'
import { EARN_AI, EARN_MOO, EARN_ROUTES, EARN_TOKEN, EARN_VAULT, EARN_WETH } from './earnonhood-routes.mjs'

export const EARN_COMPETITOR_SCHEMA_VERSION = 3
export const EARN_COMPETITOR_DISCLOSURE_DELAY_MS = 5 * 60 * 1_000

const ROBINHOOD_USDG = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168'
const ROBINHOOD_NVDA = '0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC'

/** @type {Map<string, {symbol: string, decimals: number}>} */
const KNOWN_TOKEN_METADATA = new Map([
  [EARN_WETH.toLowerCase(), { symbol: 'WETH', decimals: 18 }],
  [EARN_TOKEN.toLowerCase(), { symbol: 'EARN', decimals: 18 }],
  [EARN_AI.toLowerCase(), { symbol: 'AI', decimals: 18 }],
  [EARN_MOO.toLowerCase(), { symbol: 'MOO', decimals: 18 }],
  [ROBINHOOD_USDG.toLowerCase(), { symbol: 'USDG', decimals: 6 }],
  [ROBINHOOD_NVDA.toLowerCase(), { symbol: 'NVDA', decimals: 18 }],
])

function sameAddress(left, right) {
  return String(left || '').toLowerCase() === String(right || '').toLowerCase()
}

function decimal(value) {
  return formatEther(BigInt(value || 0))
}

/** @param {Array<Record<string, any>>} logs */
export function decodeEarnSwapLogs(logs) {
  return logs
    .filter((log) => sameAddress(log.address, EARN_VAULT))
    .map((log) => {
      try {
        const decoded = decodeEventLog({
          abi: EARN_SWAP_ABI,
          data: log.data,
          topics: /** @type {[`0x${string}`, ...`0x${string}`[]]} */ ([...log.topics]),
        })
        if (decoded.eventName !== 'Swap') return null
        const args = /** @type {Record<string, any>} */ (decoded.args)
        return {
          pool: args.pool,
          tokenIn: args.tokenIn,
          tokenOut: args.tokenOut,
          amountIn: BigInt(args.amountIn),
          amountOut: BigInt(args.amountOut),
          logIndex: Number(log.logIndex || 0),
        }
      } catch {
        return null
      }
    })
    .filter(Boolean)
    .sort((left, right) => left.logIndex - right.logIndex)
}

function routeMatches(swaps, offset, route) {
  let expectedAmountIn = swaps[offset]?.amountIn
  if (!expectedAmountIn || expectedAmountIn <= 0n) return null
  for (let index = 0; index < route.steps.length; index += 1) {
    const swap = swaps[offset + index]
    const step = route.steps[index]
    if (
      !swap ||
      !sameAddress(swap.pool, step.pool) ||
      !sameAddress(swap.tokenIn, step.tokenIn) ||
      !sameAddress(swap.tokenOut, step.tokenOut) ||
      swap.amountIn !== expectedAmountIn ||
      swap.amountOut <= 0n
    ) {
      return null
    }
    expectedAmountIn = swap.amountOut
  }
  const amountInWei = swaps[offset].amountIn
  return {
    routeId: route.id,
    route: route.symbols.join(' → '),
    swapCount: route.steps.length,
    amountInWei,
    amountOutWei: expectedAmountIn,
    grossProfitWei: expectedAmountIn - amountInWei,
    offset,
  }
}

/**
 * Match only contiguous, amount-linked copies of the reviewed WETH round trips.
 * Other Vault swaps in the same receipt remain visible to the matcher and stop
 * a false exact-path classification.
 *
 * @param {{logs?: Array<Record<string, any>>}} receipt
 */
export function findReviewedEarnCycles(receipt) {
  const swaps = decodeEarnSwapLogs(receipt?.logs || [])
  const cycles = []
  for (let offset = 0; offset < swaps.length; offset += 1) {
    const match = EARN_ROUTES.map((route) => routeMatches(swaps, offset, route)).find(Boolean)
    if (!match) continue
    cycles.push(match)
    offset += match.swapCount - 1
  }
  return cycles
}

const KNOWN_TOKEN_LABELS = new Map(
  [...KNOWN_TOKEN_METADATA.entries()].map(([address, metadata]) => [address, metadata.symbol]),
)

function tokenLabel(address, tokenLabels) {
  const addressKey = String(address).toLowerCase()
  return (
    tokenLabels?.get?.(addressKey) ||
    tokenLabels?.[addressKey] ||
    KNOWN_TOKEN_LABELS.get(addressKey) ||
    `${String(address).slice(0, 6)}…${String(address).slice(-4)}`
  )
}

function tokenMetadata(address, suppliedMetadata) {
  const addressKey = String(address).toLowerCase()
  const supplied = suppliedMetadata?.get?.(addressKey) || suppliedMetadata?.[addressKey]
  const known = supplied || KNOWN_TOKEN_METADATA.get(addressKey)
  const decimals = Number(known?.decimals)
  return {
    address: String(address),
    symbol: known?.symbol || tokenLabel(address),
    decimals: Number.isSafeInteger(decimals) && decimals >= 0 && decimals <= 255 ? decimals : null,
  }
}

/**
 * Detect any contiguous, amount-linked closed Vault cycle. This is evidence of
 * the transaction shape, independent of token names or our executable route
 * policy. Non-WETH cycles remain unnormalised rather than being misreported as
 * ETH profit.
 */
export function findEarnClosedCycles(receipt, options = {}) {
  const swaps = decodeEarnSwapLogs(receipt?.logs || [])
  const cycles = []
  for (let offset = 0; offset < swaps.length; offset += 1) {
    const first = swaps[offset]
    const baseToken = first.tokenIn
    let expectedAmountIn = first.amountIn
    let currentToken = baseToken
    const usedPools = new Set()
    const usedTokens = new Set([String(baseToken).toLowerCase()])
    const steps = []
    for (let index = offset; index < swaps.length; index += 1) {
      const swap = swaps[index]
      if (
        !sameAddress(swap.tokenIn, currentToken) ||
        swap.amountIn !== expectedAmountIn ||
        usedPools.has(String(swap.pool).toLowerCase())
      ) {
        break
      }
      const closes = sameAddress(swap.tokenOut, baseToken)
      if (!closes && usedTokens.has(String(swap.tokenOut).toLowerCase())) break
      steps.push(swap)
      usedPools.add(String(swap.pool).toLowerCase())
      expectedAmountIn = swap.amountOut
      currentToken = swap.tokenOut
      if (closes) {
        if (steps.length >= 2) {
          const path = [baseToken, ...steps.map((step) => step.tokenOut)]
          const routeHash = createHash('sha256')
            .update(
              steps
                .map(
                  (step) => `${step.pool.toLowerCase()}:${step.tokenIn.toLowerCase()}:${step.tokenOut.toLowerCase()}`,
                )
                .join('|'),
            )
            .digest('hex')
            .slice(0, 16)
          cycles.push({
            routeId: `EARN_CLOSED_${routeHash}`,
            route: path.map((token) => tokenLabel(token, options.tokenLabels)).join(' → '),
            baseToken,
            swapCount: steps.length,
            amountInRaw: first.amountIn,
            amountOutRaw: expectedAmountIn,
            grossProfitRaw: expectedAmountIn - first.amountIn,
            offset,
          })
          offset = index
        }
        break
      }
      usedTokens.add(String(swap.tokenOut).toLowerCase())
    }
  }
  return cycles
}

export function competitorAlias(actor, ownActors = []) {
  if (ownActors.some((candidate) => sameAddress(candidate, actor))) return '本策略'
  const digest = createHash('sha256')
    .update(String(actor || '').toLowerCase())
    .digest('hex')
    .slice(0, 6)
  return `外部地址 #${digest}`
}

/** @param {Record<string, any>} receipt */
export function reviewedReceiptRecord({
  receipt,
  occurredAt,
  ownActors = [],
  tokenLabels = null,
  tokenMetadata: suppliedMetadata = null,
}) {
  const cycles = findEarnClosedCycles(receipt, { tokenLabels })
  if (cycles.length === 0) return null
  const actor = receipt.from
  const wethCycles = cycles.filter((cycle) => sameAddress(cycle.baseToken, EARN_WETH))
  const grossProfitWei = wethCycles.reduce((sum, cycle) => sum + cycle.grossProfitRaw, 0n)
  const gasCostWei = BigInt(receipt.gasUsed || 0) * BigInt(receipt.effectiveGasPrice || 0)
  const onlyWethSettlement = wethCycles.length === cycles.length
  const estimatedNetWei = onlyWethSettlement ? grossProfitWei - gasCostWei : null
  const economicsByAsset = new Map()
  for (const cycle of cycles) {
    const key = String(cycle.baseToken).toLowerCase()
    const metadata = tokenMetadata(cycle.baseToken, suppliedMetadata)
    const current = economicsByAsset.get(key) || {
      assetAddress: metadata.address,
      symbol: metadata.symbol,
      decimals: metadata.decimals,
      cycleCount: 0,
      amountInRaw: 0n,
      amountOutRaw: 0n,
      grossProfitRaw: 0n,
    }
    current.cycleCount += 1
    current.amountInRaw += cycle.amountInRaw
    current.amountOutRaw += cycle.amountOutRaw
    current.grossProfitRaw += cycle.grossProfitRaw
    economicsByAsset.set(key, current)
  }
  const assetEconomics = [...economicsByAsset.values()].map((item) => ({
    assetAddress: item.assetAddress,
    symbol: item.symbol,
    decimals: item.decimals,
    cycleCount: item.cycleCount,
    amountInRaw: item.amountInRaw.toString(),
    amountOutRaw: item.amountOutRaw.toString(),
    grossProfitRaw: item.grossProfitRaw.toString(),
    amountIn: item.decimals === null ? null : formatUnits(item.amountInRaw, item.decimals),
    amountOut: item.decimals === null ? null : formatUnits(item.amountOutRaw, item.decimals),
    grossProfit: item.decimals === null ? null : formatUnits(item.grossProfitRaw, item.decimals),
    evidenceState: item.decimals === null ? 'RAW_AMOUNT_CONFIRMED_DECIMALS_UNKNOWN' : 'NATIVE_AMOUNT_CONFIRMED',
  }))
  const hopCounts = [...new Set(cycles.map((cycle) => cycle.swapCount))].sort((left, right) => left - right)
  return {
    recordSchemaVersion: 2,
    evidenceId: `earn-receipt:${String(receipt.transactionHash).toLowerCase()}`,
    transactionHash: receipt.transactionHash,
    blockNumber: String(receipt.blockNumber),
    blockHash: receipt.blockHash,
    occurredAt,
    actorClass: ownActors.some((candidate) => sameAddress(candidate, actor)) ? 'OWN' : 'EXTERNAL',
    actorAlias: competitorAlias(actor, ownActors),
    actorAddress: actor,
    transactionTarget: receipt.to || null,
    route: [...new Set(cycles.map((cycle) => cycle.route))].join(' + '),
    routeIds: [...new Set(cycles.map((cycle) => cycle.routeId))],
    cycleCount: cycles.length,
    hopCounts,
    strategyShape:
      hopCounts.length === 1 ? `EARN_VAULT_${hopCounts[0]}_HOP_CLOSED_CYCLE` : 'EARN_VAULT_MIXED_HOP_CLOSED_CYCLES',
    wethCycleCount: wethCycles.length,
    nonWethCycleCount: cycles.length - wethCycles.length,
    settlementAssets: [...new Set(cycles.map((cycle) => cycle.baseToken))],
    assetEconomics,
    amountInWeth: wethCycles.length ? decimal(wethCycles.reduce((sum, cycle) => sum + cycle.amountInRaw, 0n)) : null,
    grossProfitWeth: wethCycles.length ? decimal(grossProfitWei) : null,
    gasCostEth: decimal(gasCostWei),
    estimatedNetEth: estimatedNetWei === null ? null : decimal(estimatedNetWei),
    economicsState: onlyWethSettlement
      ? 'WETH_CLOSED_CYCLE_RECEIPT_NET_ESTIMATE'
      : 'NATIVE_GROSS_CONFIRMED_GAS_NOT_NORMALIZED',
  }
}

function bigintFrom(value) {
  try {
    return BigInt(value || 0)
  } catch {
    return 0n
  }
}

function addAssetEconomics(target, items = []) {
  for (const item of items) {
    const key = String(item.assetAddress || item.symbol || 'UNKNOWN').toLowerCase()
    const current = target.get(key) || {
      assetAddress: item.assetAddress || null,
      symbol: item.symbol || '未知资产',
      decimals: Number.isSafeInteger(item.decimals) ? item.decimals : null,
      cycleCount: 0,
      grossProfitRaw: 0n,
    }
    current.cycleCount += Number(item.cycleCount || 0)
    current.grossProfitRaw += bigintFrom(item.grossProfitRaw)
    target.set(key, current)
  }
}

function presentAssetEconomics(items) {
  return [...items.values()]
    .map((item) => ({
      assetAddress: item.assetAddress,
      symbol: item.symbol,
      decimals: item.decimals,
      cycleCount: item.cycleCount,
      grossProfitRaw: item.grossProfitRaw.toString(),
      grossProfit: item.decimals === null ? null : formatUnits(item.grossProfitRaw, item.decimals),
      evidenceState: item.decimals === null ? 'RAW_AMOUNT_CONFIRMED_DECIMALS_UNKNOWN' : 'NATIVE_AMOUNT_CONFIRMED',
    }))
    .sort((left, right) => left.symbol.localeCompare(right.symbol))
}

function inRetention(record, nowMs, retentionDays) {
  const occurredAtMs = Date.parse(String(record.occurredAt || ''))
  return Number.isFinite(occurredAtMs) && occurredAtMs >= nowMs - retentionDays * 86_400_000
}

function delayed(record, nowMs, disclosureDelayMs) {
  const occurredAtMs = Date.parse(String(record.occurredAt || ''))
  return !Number.isFinite(occurredAtMs) || occurredAtMs + disclosureDelayMs > nowMs
}

export function buildEarnCompetitorSnapshot({
  state,
  records = [],
  now = new Date(),
  retentionDays = 7,
  disclosureDelayMs = EARN_COMPETITOR_DISCLOSURE_DELAY_MS,
}) {
  if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 31) {
    throw new RangeError('competitor retention days must be in [1, 31]')
  }
  const nowMs = now.getTime()
  const retained = records.filter((record) => inRetention(record, nowMs, retentionDays))
  const visible = retained.filter((record) => !delayed(record, nowMs, disclosureDelayMs))
  const external = visible.filter((record) => record.actorClass === 'EXTERNAL')
  const leaders = new Map()
  const routes = new Map()
  const marketEconomics = new Map()
  let marketEstimatedNetWei = 0n
  for (const record of external) {
    const leaderKey = String(record.actorAddress || record.actorAlias).toLowerCase()
    const current = leaders.get(leaderKey) || {
      actorAlias: record.actorAlias,
      actorAddress: record.actorAddress || null,
      confirmedCycleReceipts: 0,
      positiveRouteEstimates: 0,
      estimatedNetWei: 0n,
      nativeGross: new Map(),
      routes: new Map(),
      unnormalizedReceipts: 0,
      lastSeenAt: null,
    }
    current.confirmedCycleReceipts += 1
    if (record.estimatedNetEth !== null && record.estimatedNetEth !== undefined) {
      const estimatedNetWei = parseEther(String(record.estimatedNetEth))
      current.estimatedNetWei += estimatedNetWei
      marketEstimatedNetWei += estimatedNetWei
      if (estimatedNetWei > 0n) current.positiveRouteEstimates += 1
    } else {
      current.unnormalizedReceipts += 1
    }
    addAssetEconomics(current.nativeGross, record.assetEconomics)
    addAssetEconomics(marketEconomics, record.assetEconomics)
    current.routes.set(record.route, (current.routes.get(record.route) || 0) + 1)
    if (!current.lastSeenAt || String(record.occurredAt).localeCompare(current.lastSeenAt) > 0) {
      current.lastSeenAt = record.occurredAt
    }
    leaders.set(leaderKey, current)

    const route = routes.get(record.route) || {
      route: record.route,
      strategyShape: record.strategyShape || 'EARN_VAULT_CLOSED_CYCLE',
      confirmedCycleReceipts: 0,
      actors: new Set(),
      estimatedNetWei: 0n,
      unnormalizedReceipts: 0,
      nativeGross: new Map(),
      lastSeenAt: null,
    }
    route.confirmedCycleReceipts += 1
    route.actors.add(leaderKey)
    if (record.estimatedNetEth !== null && record.estimatedNetEth !== undefined) {
      route.estimatedNetWei += parseEther(String(record.estimatedNetEth))
    } else {
      route.unnormalizedReceipts += 1
    }
    addAssetEconomics(route.nativeGross, record.assetEconomics)
    if (!route.lastSeenAt || String(record.occurredAt).localeCompare(route.lastSeenAt) > 0) {
      route.lastSeenAt = record.occurredAt
    }
    routes.set(record.route, route)
  }
  const status = ['CURRENT', 'BACKFILLING', 'PARTIAL'].includes(state?.status) ? state.status : 'PARTIAL'
  return {
    schemaVersion: EARN_COMPETITOR_SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    status,
    mode: 'READ_ONLY_RECEIPT_CENSUS',
    summary: {
      transactionsReviewed: state?.transactionsReviewed ?? null,
      reviewedCycleReceipts: visible.length,
      externalCycleReceipts: external.length,
      wethSettledCycleReceipts: visible.filter((record) => Number(record.wethCycleCount || 0) > 0).length,
      nonWethCycleReceipts: visible.filter((record) => Number(record.nonWethCycleCount || 0) > 0).length,
      distinctExternalActors: new Set(external.map((record) => record.actorAddress || record.actorAlias)).size,
      estimatedExternalNetEth: formatEther(marketEstimatedNetWei),
      nativeGrossByAsset: presentAssetEconomics(marketEconomics),
      unnormalizedExternalReceipts: external.filter(
        (record) => record.estimatedNetEth === null || record.estimatedNetEth === undefined,
      ).length,
      confirmedLostRaces: null,
    },
    coverage: {
      retentionDays,
      startBlock: state?.startBlock || null,
      scannedThroughBlock: state?.cursorBlock || null,
      safeHeadBlock: state?.safeHeadBlock || null,
      exactPathDisclosureDelayMs: disclosureDelayMs,
      delayedReceipts: retained.length - visible.length,
      note:
        status === 'CURRENT'
          ? `已扫描到安全区块头；详细记录保留 ${retentionDays} 天，精确路线延迟 5 分钟公开。`
          : `链上回执仍在回溯；当前数字仅覆盖已扫描区间，不能推断全市场无竞争。`,
    },
    leaders: [...leaders.values()]
      .map((leader) => ({
        actorAlias: leader.actorAlias,
        actorAddress: leader.actorAddress,
        confirmedCycleReceipts: leader.confirmedCycleReceipts,
        positiveRouteEstimates: leader.positiveRouteEstimates,
        estimatedNetEth: formatEther(leader.estimatedNetWei),
        nativeGrossByAsset: presentAssetEconomics(leader.nativeGross),
        unnormalizedReceipts: leader.unnormalizedReceipts,
        topRoute:
          [...leader.routes.entries()].sort(
            (left, right) => right[1] - left[1] || String(left[0]).localeCompare(String(right[0])),
          )[0]?.[0] || null,
        distinctRoutes: leader.routes.size,
        lastSeenAt: leader.lastSeenAt,
      }))
      .sort(
        (left, right) =>
          right.confirmedCycleReceipts - left.confirmedCycleReceipts ||
          String(right.lastSeenAt).localeCompare(String(left.lastSeenAt)),
      ),
    routes: [...routes.values()]
      .map((route) => ({
        route: route.route,
        strategyShape: route.strategyShape,
        confirmedCycleReceipts: route.confirmedCycleReceipts,
        distinctActors: route.actors.size,
        estimatedNetEth: formatEther(route.estimatedNetWei),
        nativeGrossByAsset: presentAssetEconomics(route.nativeGross),
        unnormalizedReceipts: route.unnormalizedReceipts,
        lastSeenAt: route.lastSeenAt,
      }))
      .sort(
        (left, right) =>
          right.confirmedCycleReceipts - left.confirmedCycleReceipts ||
          String(right.lastSeenAt).localeCompare(String(left.lastSeenAt)),
      ),
    recentEvidence: visible
      .toSorted((left, right) => String(right.occurredAt).localeCompare(String(left.occurredAt)))
      .slice(0, 25)
      .map((record) => ({
        evidenceId: record.evidenceId,
        transactionHash: record.transactionHash,
        occurredAt: record.occurredAt,
        actorAlias: record.actorAlias,
        actorAddress: record.actorAddress || null,
        route: record.route,
        strategyShape: record.strategyShape || 'EARN_VAULT_CLOSED_CYCLE',
        assetEconomics: record.assetEconomics || [],
        gasCostEth: record.gasCostEth,
        estimatedNetEth: record.estimatedNetEth,
        economicsState: record.economicsState,
      })),
  }
}

export function assertEarnCompetitorSnapshot(snapshot) {
  const rendered = JSON.stringify(snapshot)
  if (rendered.length > 256_000) throw new Error('competitor snapshot exceeds size limit')
  if (/private.?key|mnemonic|signed.?transaction|rpc.?url|wallet.?address|webhook/i.test(rendered)) {
    throw new Error('competitor snapshot contains a forbidden field')
  }
  if (snapshot?.schemaVersion !== EARN_COMPETITOR_SCHEMA_VERSION || snapshot?.mode !== 'READ_ONLY_RECEIPT_CENSUS') {
    throw new Error('competitor snapshot identity is invalid')
  }
}
