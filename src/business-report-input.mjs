import path from 'node:path'

import { IncrementalJsonlEventReader } from './incremental-jsonl-reader.mjs'

const BUSINESS_AUDIT_EVENTS = Object.freeze([
  'mutation_reverted',
  'dual_runtime_verified',
  'global_preflight',
  'global_watch_exact_preflight_started',
])

function transactionFields(record) {
  return {
    transactionHash: record?.transactionHash || null,
    hash: record?.hash || null,
    blockNumber: record?.blockNumber ?? null,
  }
}

function projectAuditRecord(record, authorizationId) {
  if (record?.event === 'mutation_reverted') {
    return {
      event: record.event,
      authorizationId: record.authorizationId || null,
      gasSpentWei: record.gasSpentWei || null,
      at: record.at || null,
      ...transactionFields(record),
    }
  }
  if (record?.event === 'dual_runtime_verified') {
    return {
      event: record.event,
      walletEth: record.walletEth || null,
      at: record.at || null,
    }
  }
  if (!authorizationId || record?.authorizationId !== authorizationId) return null
  if (record?.event === 'global_watch_exact_preflight_started') {
    return { event: record.event, authorizationId }
  }
  if (record?.event === 'global_preflight') {
    return {
      event: record.event,
      authorizationId,
      grossPositive: record.grossPositive ?? null,
      exactNetPositive: record.exactNetPositive ?? null,
      workset: record.workset || null,
      timing: record.timing || null,
    }
  }
  return null
}

function projectCollectionRecord(record) {
  if (record?.event !== 'withdrawal_complete') return null
  return {
    event: record.event,
    hash: record.hash || null,
    confirmedAt: record.confirmedAt || null,
    at: record.at || null,
    amountUsdg: record.amountUsdg || null,
    gasSpentWei: record.gasSpentWei || null,
    targetId: record.targetId || null,
    blockNumber: record.blockNumber ?? null,
  }
}

function projectEarnRecord(record) {
  if (
    record?.event !== 'mutation_effect' ||
    !['CONFIRMED_NET_PROFIT', 'REALIZED_NET_VERIFIED'].includes(record?.status)
  ) {
    return null
  }
  return {
    event: record.event,
    status: record.status,
    transaction: record.transaction || null,
    hash: record.hash || null,
    transactionHash: record.transactionHash || null,
    confirmedAt: record.confirmedAt || null,
    at: record.at || null,
    authorizationId: record.authorizationId || null,
    realizedNetProfitWei: record.realizedNetProfitWei || null,
    realizedNetProfitEth: record.realizedNetProfitEth || null,
    amountInEth: record.amountInEth || null,
    gasSpentEth: record.gasSpentEth || null,
    route: record.route || null,
    blockNumber: record.blockNumber ?? null,
  }
}

function readProjected(file, events, projectRecord) {
  return new IncrementalJsonlEventReader(file, { events, projectRecord }).read()
}

/**
 * Stream the append-only ledgers and retain only the fields consumed by the
 * public business read model. The source ledgers remain untouched and
 * authoritative; this projection is deliberately signer-free and disposable.
 */
export function readBusinessReportInputs({ runDirectory, authorizationId = null }) {
  if (typeof runDirectory !== 'string' || runDirectory.length === 0) {
    throw new Error('business report run directory is required')
  }
  const auditRecords = readProjected(path.join(runDirectory, 'audit.jsonl'), BUSINESS_AUDIT_EVENTS, (record) =>
    projectAuditRecord(record, authorizationId),
  )
  const latestRuntimeVerification = [...auditRecords]
    .reverse()
    .find((record) => record?.event === 'dual_runtime_verified')
  const boundedAuditRecords = auditRecords.filter((record) => record?.event !== 'dual_runtime_verified')
  if (latestRuntimeVerification) boundedAuditRecords.push(latestRuntimeVerification)

  return {
    auditRecords: boundedAuditRecords,
    collectionRecords: readProjected(
      path.join(runDirectory, 'legacy-collection-audit.jsonl'),
      ['withdrawal_complete'],
      projectCollectionRecord,
    ),
    earnOnHoodRecords: readProjected(
      path.join(runDirectory, 'earnonhood-audit.jsonl'),
      ['mutation_effect'],
      projectEarnRecord,
    ),
  }
}
