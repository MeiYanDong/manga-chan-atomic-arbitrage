import { formatUnits } from 'viem'

export const BUSINESS_ACTIVITY_TYPES = Object.freeze({
  CAPITAL_IN: 'CAPITAL_IN',
  DEPLOYMENT: 'DEPLOYMENT',
  AUTHORIZATION: 'AUTHORIZATION',
  ARBITRAGE: 'ARBITRAGE',
  COLLECTION: 'COLLECTION',
  FAILED_TRANSACTION: 'FAILED_TRANSACTION',
})

const TYPE_ORDER = Object.freeze({
  ARBITRAGE: 6,
  COLLECTION: 5,
  FAILED_TRANSACTION: 4,
  AUTHORIZATION: 3,
  DEPLOYMENT: 2,
  CAPITAL_IN: 1,
})

function bigint(value) {
  try {
    return BigInt(value ?? 0)
  } catch {
    return 0n
  }
}

function decimal(value, decimals) {
  return formatUnits(bigint(value), decimals)
}

function validDate(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null
}

function validHash(value) {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value) ? value.toLowerCase() : null
}

function validBlockNumber(value) {
  const numeric = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value
  return Number.isSafeInteger(numeric) && numeric >= 0 ? numeric : null
}

function validAmount(entry) {
  if (!entry || !['IN', 'OUT', 'INTERNAL', 'CIRCULATED'].includes(entry.direction)) return null
  if (!/^[A-Z0-9._-]{2,16}$/.test(entry.asset || '') || !/^-?\d+(?:\.\d+)?$/.test(String(entry.value || ''))) {
    return null
  }
  return { asset: entry.asset, value: String(entry.value), direction: entry.direction }
}

function validEffect(entry) {
  if (!entry || !['PROFIT', 'COST'].includes(entry.kind)) return null
  if (!/^[A-Z0-9._-]{2,16}$/.test(entry.asset || '') || !/^\d+(?:\.\d+)?$/.test(String(entry.value || ''))) {
    return null
  }
  return { kind: entry.kind, asset: entry.asset, value: String(entry.value) }
}

function evidence({ receipt = false, balanceEffect = false, level = 'PARTIAL' } = {}) {
  return { receipt: Boolean(receipt), balanceEffect: Boolean(balanceEffect), level }
}

function explorer(networkId, transactionHash) {
  if (!transactionHash) return null
  if (networkId === 'BASE') return `https://base.blockscout.com/tx/${transactionHash}`
  if (networkId === 'ROBINHOOD') return `https://robinhoodchain.blockscout.com/tx/${transactionHash}`
  return null
}

function registryActivity(record) {
  const transactionHash = validHash(record?.transactionHash)
  const occurredAt = validDate(record?.occurredAt)
  const type = BUSINESS_ACTIVITY_TYPES[record?.type]
  if (!record?.activityId || !occurredAt || !type || !['BASE', 'ROBINHOOD'].includes(record?.networkId)) return null
  return {
    activityId: String(record.activityId),
    occurredAt,
    networkId: record.networkId,
    network: record.networkId === 'BASE' ? 'Base' : 'Robinhood Chain',
    type,
    title: String(record.title || '项目链上活动'),
    status: record.status === 'REVERTED' ? 'REVERTED' : record.status === 'UNKNOWN' ? 'UNKNOWN' : 'CONFIRMED',
    amounts: (record.amounts || []).map(validAmount).filter(Boolean),
    effects: (record.effects || []).map(validEffect).filter(Boolean),
    transactionHash,
    explorerUrl: transactionHash ? explorer(record.networkId, transactionHash) : null,
    blockNumber: validBlockNumber(record.blockNumber),
    gas: record.gas
      ? {
          asset: 'ETH',
          value: String(record.gas.value),
          treatment: ['OPERATING_COST', 'INCLUDED_IN_RESULT', 'EXTERNAL'].includes(record.gas.treatment)
            ? record.gas.treatment
            : 'OPERATING_COST',
        }
      : null,
    evidence: evidence(record.evidence),
  }
}

function executionActivity(record, index) {
  const transactionHash = validHash(record?.hash)
  const occurredAt = validDate(record?.confirmedAt)
  if (!transactionHash || !occurredAt) return null
  const baseAsset = record?.baseAsset === 'WETH' ? 'WETH' : 'USDG'
  const decimals = baseAsset === 'WETH' ? 18 : 6
  const amountIn = decimal(record?.amountInWei, decimals)
  const grossProfit = decimal(record?.grossProfitWei, decimals)
  const gas = decimal(record?.gasSpentWei, 18)
  return {
    activityId: `execution:${transactionHash}:${index}`,
    occurredAt,
    networkId: 'ROBINHOOD',
    network: 'Robinhood Chain',
    type: BUSINESS_ACTIVITY_TYPES.ARBITRAGE,
    title: record?.routeLabel || `${baseAsset} 原子套利`,
    status: 'CONFIRMED',
    amounts: [{ asset: baseAsset, value: amountIn, direction: 'CIRCULATED' }],
    effects: [
      ...(bigint(record?.grossProfitWei) > 0n ? [{ kind: 'PROFIT', asset: baseAsset, value: grossProfit }] : []),
      ...(bigint(record?.gasSpentWei) > 0n ? [{ kind: 'COST', asset: 'ETH', value: gas }] : []),
    ],
    transactionHash,
    explorerUrl: explorer('ROBINHOOD', transactionHash),
    blockNumber: validBlockNumber(record?.blockNumber),
    gas: { asset: 'ETH', value: gas, treatment: 'OPERATING_COST' },
    evidence: evidence({ receipt: true, balanceEffect: true, level: 'CHAIN_ATTESTED' }),
  }
}

function failedActivity(record, index) {
  if (record?.event !== 'mutation_reverted' || !record?.gasSpentWei) return null
  const transactionHash = validHash(record?.transactionHash || record?.hash)
  const occurredAt = validDate(record?.at)
  if (!occurredAt) return null
  const gas = decimal(record.gasSpentWei, 18)
  return {
    activityId: `failed:${transactionHash || occurredAt}:${index}`,
    occurredAt,
    networkId: 'ROBINHOOD',
    network: 'Robinhood Chain',
    type: BUSINESS_ACTIVITY_TYPES.FAILED_TRANSACTION,
    title: '失败交易 Gas',
    status: 'REVERTED',
    amounts: [],
    effects: [{ kind: 'COST', asset: 'ETH', value: gas }],
    transactionHash,
    explorerUrl: explorer('ROBINHOOD', transactionHash),
    blockNumber: validBlockNumber(record?.blockNumber),
    gas: { asset: 'ETH', value: gas, treatment: 'OPERATING_COST' },
    evidence: evidence({ receipt: Boolean(transactionHash), balanceEffect: false, level: 'CHAIN_ATTESTED' }),
  }
}

function collectionActivity(record, index) {
  if (record?.event !== 'withdrawal_complete') return null
  const transactionHash = validHash(record?.hash)
  const occurredAt = validDate(record?.confirmedAt || record?.at)
  if (!transactionHash || !occurredAt) return null
  const amount = String(record?.amountUsdg || '')
  if (!/^\d+(?:\.\d+)?$/.test(amount)) return null
  const gas = decimal(record?.gasSpentWei, 18)
  return {
    activityId: `collection:${transactionHash}:${index}`,
    occurredAt,
    networkId: 'ROBINHOOD',
    network: 'Robinhood Chain',
    type: BUSINESS_ACTIVITY_TYPES.COLLECTION,
    title: `${record?.token || '旧合约'}资金归集`,
    status: 'CONFIRMED',
    amounts: [{ asset: 'USDG', value: amount, direction: 'INTERNAL' }],
    effects: bigint(record?.gasSpentWei) > 0n ? [{ kind: 'COST', asset: 'ETH', value: gas }] : [],
    transactionHash,
    explorerUrl: explorer('ROBINHOOD', transactionHash),
    blockNumber: validBlockNumber(record?.blockNumber),
    gas: { asset: 'ETH', value: gas, treatment: 'OPERATING_COST' },
    evidence: evidence({ receipt: true, balanceEffect: true, level: 'CHAIN_ATTESTED' }),
  }
}

function earnOnHoodActivity(record, index) {
  if (
    record?.event !== 'mutation_effect' ||
    !['CONFIRMED_NET_PROFIT', 'REALIZED_NET_VERIFIED'].includes(record?.status)
  ) {
    return null
  }
  const transactionHash = validHash(record?.transaction)
  const occurredAt = validDate(record?.confirmedAt || record?.at)
  const net = String(record?.realizedNetProfitEth || '')
  if (!transactionHash || !occurredAt || !/^\d+(?:\.\d+)?$/.test(net)) return null
  const gas = String(record?.gasSpentEth || '0')
  return {
    activityId: `earnonhood:${transactionHash}:${index}`,
    occurredAt,
    networkId: 'ROBINHOOD',
    network: 'Robinhood Chain',
    type: BUSINESS_ACTIVITY_TYPES.ARBITRAGE,
    title: record?.route || 'EarnOnHood 原子套利',
    status: 'CONFIRMED',
    amounts: [{ asset: 'ETH', value: String(record?.amountInEth || '0'), direction: 'CIRCULATED' }],
    effects: [{ kind: 'PROFIT', asset: 'ETH', value: net }],
    transactionHash,
    explorerUrl: explorer('ROBINHOOD', transactionHash),
    blockNumber: validBlockNumber(record?.blockNumber),
    gas: { asset: 'ETH', value: gas, treatment: 'INCLUDED_IN_RESULT' },
    evidence: evidence({ receipt: true, balanceEffect: true, level: 'CHAIN_ATTESTED' }),
  }
}

function activityKey(activity) {
  return activity.transactionHash
    ? `${activity.networkId}:${activity.transactionHash}:${activity.type}`
    : activity.activityId
}

export function buildBusinessActivities({
  registry = [],
  executions = [],
  auditRecords = [],
  collectionRecords = [],
  earnOnHoodRecords = [],
} = {}) {
  const candidates = [
    ...registry.map(registryActivity),
    ...executions.map(executionActivity),
    ...auditRecords.map(failedActivity),
    ...collectionRecords.map(collectionActivity),
    ...earnOnHoodRecords.map(earnOnHoodActivity),
  ].filter(Boolean)
  const unique = new Map()
  for (const activity of candidates) {
    const key = activityKey(activity)
    const before = unique.get(key)
    if (!before || (activity.evidence.balanceEffect && !before.evidence.balanceEffect)) unique.set(key, activity)
  }
  return [...unique.values()].sort((left, right) => {
    const time = Date.parse(right.occurredAt) - Date.parse(left.occurredAt)
    if (time !== 0) return time
    return (TYPE_ORDER[right.type] || 0) - (TYPE_ORDER[left.type] || 0)
  })
}

function addDecimal(totals, asset, value, sign) {
  if (!/^\d+(?:\.\d+)?$/.test(String(value))) return
  const decimals = String(value).split('.')[1]?.length || 0
  const current = totals.get(asset) || { units: 0n, decimals: 0 }
  const scale = Math.max(current.decimals, decimals)
  const normalize = (units, from) => units * 10n ** BigInt(scale - from)
  const next =
    normalize(current.units, current.decimals) + sign * normalize(bigint(String(value).replace('.', '')), decimals)
  totals.set(asset, { units: next, decimals: scale })
}

function formatDecimalTotal(total) {
  if (!total) return '0'
  const negative = total.units < 0n
  const units = negative ? -total.units : total.units
  const divisor = 10n ** BigInt(total.decimals)
  const whole = units / divisor
  const fraction =
    total.decimals > 0
      ? String(units % divisor)
          .padStart(total.decimals, '0')
          .replace(/0+$/, '')
      : ''
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`
}

export function summarizeProjectEconomics(activities) {
  const profit = new Map()
  const cost = new Map()
  const net = new Map()
  let confirmedActivities = 0
  let affectedActivities = 0
  for (const activity of activities || []) {
    if (activity.status === 'CONFIRMED') confirmedActivities += 1
    if ((activity.effects || []).length > 0) affectedActivities += 1
    for (const effect of activity.effects || []) {
      const target = effect.kind === 'PROFIT' ? profit : cost
      addDecimal(target, effect.asset, effect.value, 1n)
      addDecimal(net, effect.asset, effect.value, effect.kind === 'PROFIT' ? 1n : -1n)
    }
  }
  const assets = [...new Set([...profit.keys(), ...cost.keys(), ...net.keys()])].sort()
  return {
    coverage: 'PARTIAL',
    coverageNote: '仅汇总已纳入登记表、运行账本和链上回执的项目活动；未知历史不按零处理。',
    confirmedActivities,
    affectedActivities,
    byAsset: assets.map((asset) => ({
      asset,
      profit: formatDecimalTotal(profit.get(asset)),
      cost: formatDecimalTotal(cost.get(asset)),
      net: formatDecimalTotal(net.get(asset)),
    })),
  }
}
