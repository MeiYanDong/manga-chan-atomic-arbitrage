import { createHash } from 'node:crypto'

import { decodeEventLog, formatEther } from 'viem'

import { EARN_SWAP_ABI } from './earnonhood-receipt.mjs'
import { EARN_AI, EARN_MOO, EARN_ROUTES, EARN_TOKEN, EARN_VAULT, EARN_WETH } from './earnonhood-routes.mjs'

export const EARN_COMPETITOR_SCHEMA_VERSION = 2
export const EARN_COMPETITOR_DISCLOSURE_DELAY_MS = 5 * 60 * 1_000

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
  [
    [EARN_WETH, 'WETH'],
    [EARN_TOKEN, 'EARN'],
    [EARN_AI, 'AI'],
    [EARN_MOO, 'MOO'],
  ].map(([address, symbol]) => [address.toLowerCase(), symbol]),
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
export function reviewedReceiptRecord({ receipt, occurredAt, ownActors = [], tokenLabels = null }) {
  const cycles = findEarnClosedCycles(receipt, { tokenLabels })
  if (cycles.length === 0) return null
  const actor = receipt.from
  const wethCycles = cycles.filter((cycle) => sameAddress(cycle.baseToken, EARN_WETH))
  const grossProfitWei = wethCycles.reduce((sum, cycle) => sum + cycle.grossProfitRaw, 0n)
  const gasCostWei = BigInt(receipt.gasUsed || 0) * BigInt(receipt.effectiveGasPrice || 0)
  const estimatedNetWei = wethCycles.length > 0 ? grossProfitWei - gasCostWei : null
  return {
    evidenceId: `earn-receipt:${String(receipt.transactionHash).toLowerCase()}`,
    transactionHash: receipt.transactionHash,
    blockNumber: String(receipt.blockNumber),
    blockHash: receipt.blockHash,
    occurredAt,
    actorClass: ownActors.some((candidate) => sameAddress(candidate, actor)) ? 'OWN' : 'EXTERNAL',
    actorAlias: competitorAlias(actor, ownActors),
    route: [...new Set(cycles.map((cycle) => cycle.route))].join(' + '),
    cycleCount: cycles.length,
    wethCycleCount: wethCycles.length,
    nonWethCycleCount: cycles.length - wethCycles.length,
    settlementAssets: [...new Set(cycles.map((cycle) => cycle.baseToken))],
    amountInWeth: wethCycles.length ? decimal(wethCycles.reduce((sum, cycle) => sum + cycle.amountInRaw, 0n)) : null,
    grossProfitWeth: wethCycles.length ? decimal(grossProfitWei) : null,
    gasCostEth: decimal(gasCostWei),
    estimatedNetEth: estimatedNetWei === null ? null : decimal(estimatedNetWei),
    economicsState: wethCycles.length ? 'WETH_CLOSED_CYCLE_RECEIPT_NET_ESTIMATE' : 'NON_WETH_CLOSED_CYCLE_UNNORMALIZED',
  }
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
  for (const record of external) {
    const current = leaders.get(record.actorAlias) || {
      actorAlias: record.actorAlias,
      confirmedCycleReceipts: 0,
      positiveRouteEstimates: 0,
      lastSeenAt: null,
    }
    current.confirmedCycleReceipts += 1
    if (Number(record.estimatedNetEth) > 0) current.positiveRouteEstimates += 1
    if (!current.lastSeenAt || String(record.occurredAt).localeCompare(current.lastSeenAt) > 0) {
      current.lastSeenAt = record.occurredAt
    }
    leaders.set(record.actorAlias, current)
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
      distinctExternalActors: new Set(external.map((record) => record.actorAlias)).size,
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
    leaders: [...leaders.values()].sort(
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
        route: record.route,
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
