import { createHash } from 'node:crypto'

import { decodeEventLog, formatEther } from 'viem'

import { EARN_SWAP_ABI } from './earnonhood-receipt.mjs'
import { EARN_ROUTES, EARN_VAULT } from './earnonhood-routes.mjs'

export const EARN_COMPETITOR_SCHEMA_VERSION = 1
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

export function competitorAlias(actor, ownActors = []) {
  if (ownActors.some((candidate) => sameAddress(candidate, actor))) return '本策略'
  const digest = createHash('sha256')
    .update(String(actor || '').toLowerCase())
    .digest('hex')
    .slice(0, 6)
  return `外部地址 #${digest}`
}

/** @param {Record<string, any>} receipt */
export function reviewedReceiptRecord({ receipt, occurredAt, ownActors = [] }) {
  const cycles = findReviewedEarnCycles(receipt)
  if (cycles.length === 0) return null
  const actor = receipt.from
  const grossProfitWei = cycles.reduce((sum, cycle) => sum + cycle.grossProfitWei, 0n)
  const gasCostWei = BigInt(receipt.gasUsed || 0) * BigInt(receipt.effectiveGasPrice || 0)
  const estimatedNetWei = grossProfitWei - gasCostWei
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
    amountInWeth: decimal(cycles.reduce((sum, cycle) => sum + cycle.amountInWei, 0n)),
    grossProfitWeth: decimal(grossProfitWei),
    gasCostEth: decimal(gasCostWei),
    estimatedNetEth: decimal(estimatedNetWei),
    economicsState: 'ROUTE_RECEIPT_NET_ESTIMATE',
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
