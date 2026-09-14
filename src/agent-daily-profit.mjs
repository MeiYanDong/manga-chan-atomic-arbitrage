import { formatUnits, parseUnits } from 'viem'

export const AGENT_DAILY_PROFIT_SCHEMA_VERSION = 1
export const AGENT_DAILY_PROFIT_MODE = 'PUBLIC_AGENT_DAILY_STRATEGY_NET'

const QUOTE_DECIMALS = 8
const MAX_SNAPSHOT_BYTES = 128_000
const ASSET_DECIMALS = Object.freeze({ USDG: 6, ETH: 18 })
const MAX_QUOTE_AGE_MS = 15 * 60 * 1_000

function instant(value) {
  const result = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(result.getTime())) throw new Error('invalid agent valuation timestamp')
  return result
}

function decimalString(value, { positive = false, decimals = QUOTE_DECIMALS } = {}) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || (positive && numeric <= 0)) return null
  return numeric.toFixed(decimals).replace(/\.?0+$/, '') || '0'
}

function exactUnits(value, decimals) {
  const text = String(value)
  if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text)) throw new Error('invalid exact decimal amount')
  return parseUnits(text, decimals)
}

function exactString(value, decimals) {
  return formatUnits(value, decimals)
    .replace(/\.0+$/, '')
    .replace(/(\.\d*?)0+$/, '$1')
}

function validCoinGeckoQuote(payload, id, now) {
  const quote = payload?.[id]
  const updatedAt = Number(quote?.last_updated_at) * 1_000
  const age = now.getTime() - updatedAt
  const value = decimalString(quote?.usd, { positive: true })
  if (!value || !Number.isFinite(updatedAt) || age < -60_000 || age > MAX_QUOTE_AGE_MS) return null
  return { provider: 'CoinGecko', value, observedAt: new Date(updatedAt).toISOString() }
}

function validKrakenQuote(payload, pair, now) {
  if (!Array.isArray(payload?.error) || payload.error.length !== 0) return null
  const value = decimalString(payload?.result?.[pair]?.c?.[0], { positive: true })
  return value ? { provider: 'Kraken', value, observedAt: now.toISOString() } : null
}

function combinedQuote(pair, sources, maxSpreadBps, { stablecoin = false } = {}) {
  const usable = sources.filter(Boolean)
  if (usable.length === 0) {
    return { pair, value: null, status: 'UNAVAILABLE', sources: [] }
  }
  const values = usable.map((source) => Number(source.value))
  const midpoint = values.reduce((sum, value) => sum + value, 0) / values.length
  const spreadBps = values.length > 1 ? ((Math.max(...values) - Math.min(...values)) / midpoint) * 10_000 : null
  if (spreadBps !== null && spreadBps > maxSpreadBps) {
    return {
      pair,
      value: null,
      status: 'SOURCE_DISAGREEMENT',
      maxSourceSpreadBps: decimalString(spreadBps, { decimals: 2 }),
      sources: usable,
    }
  }
  const value = decimalString(midpoint, { positive: true })
  const result = {
    pair,
    value,
    status: usable.length > 1 ? 'TWO_SOURCE_CONFIRMED' : 'SINGLE_SOURCE',
    maxSourceSpreadBps: spreadBps === null ? null : decimalString(spreadBps, { decimals: 2 }),
    sources: usable,
  }
  if (stablecoin) {
    const pegDeviationBps = Math.abs(midpoint - 1) * 10_000
    result.pegState = pegDeviationBps <= 100 ? 'WITHIN_ONE_PERCENT' : 'DEPEG_WARNING'
    result.pegDeviationBps = decimalString(pegDeviationBps, { decimals: 2 })
  }
  return result
}

function usdCnyQuote(payload, now) {
  const value = decimalString(payload?.rates?.CNY, { positive: true })
  const quoteDate = /^\d{4}-\d{2}-\d{2}$/.test(payload?.date || '') ? payload.date : null
  const quoteAt = quoteDate ? new Date(`${quoteDate}T00:00:00.000Z`) : null
  const ageDays = quoteAt ? Math.floor((now.getTime() - quoteAt.getTime()) / 86_400_000) : null
  if (
    payload?.base !== 'USD' ||
    Number(payload?.amount) !== 1 ||
    !value ||
    ageDays === null ||
    ageDays < 0 ||
    ageDays > 7
  ) {
    return { pair: 'USD/CNY', value: null, status: 'UNAVAILABLE', source: null }
  }
  return {
    pair: 'USD/CNY',
    value,
    status: 'REFERENCE_RATE',
    source: { provider: 'Frankfurter', quoteDate, observedAt: now.toISOString() },
  }
}

export function buildAgentMarketValuation({ now, coinGecko = null, kraken = null, frankfurter = null }) {
  const observedAt = instant(now)
  const assetUsd = [
    combinedQuote(
      'USDG/USD',
      [validCoinGeckoQuote(coinGecko, 'global-dollar', observedAt), validKrakenQuote(kraken, 'USDGUSD', observedAt)],
      50,
      { stablecoin: true },
    ),
    combinedQuote(
      'ETH/USD',
      [validCoinGeckoQuote(coinGecko, 'ethereum', observedAt), validKrakenQuote(kraken, 'XETHZUSD', observedAt)],
      100,
    ),
  ]
  const usdCny = usdCnyQuote(frankfurter, observedAt)
  const ready = assetUsd.every((quote) => quote.value !== null) && usdCny.value !== null
  const guarded = assetUsd.every((quote) => quote.status === 'TWO_SOURCE_CONFIRMED')
  return {
    status: ready && guarded ? 'READY' : ready ? 'PARTIAL_SINGLE_SOURCE' : 'PARTIAL',
    observedAt: observedAt.toISOString(),
    policy: 'MARKET_REFERENCE_NO_FIXED_USDG_PARITY',
    assetUsd,
    usdCny,
  }
}

function byAsset(entries, field) {
  if (!Array.isArray(entries)) throw new Error(`invalid ${field} array`)
  const result = new Map()
  for (const entry of entries) {
    const asset = String(entry?.asset || '')
    if (!/^[A-Z0-9._-]{2,16}$/.test(asset) || result.has(asset)) {
      throw new Error(`invalid or duplicate ${field} asset`)
    }
    const decimals = ASSET_DECIMALS[asset]
    if (decimals === undefined) {
      if (String(entry?.value) !== '0') throw new Error(`unsupported nonzero ${field} asset`)
      result.set(asset, { decimals: 0, value: 0n })
      continue
    }
    result.set(asset, { decimals, value: exactUnits(entry?.value, decimals) })
  }
  return result
}

function quoteMap(valuation) {
  return new Map((valuation?.assetUsd || []).map((quote) => [quote.pair.split('/')[0], quote]))
}

function dayProjection(day, valuation) {
  const marked = byAsset(day.markedTradingNetByAsset, 'marked trading net')
  const failed = byAsset(day.failedGasByAsset, 'failed gas')
  const assets = [...new Set([...marked.keys(), ...failed.keys()])].sort()
  const quotes = quoteMap(valuation)
  const native = []
  let usdUnits = 0n
  let fullyValued = true
  let singleSource = false
  let nonzero = false
  for (const asset of assets) {
    const decimals = ASSET_DECIMALS[asset]
    const markedValue = BigInt(marked.get(asset)?.value ?? 0)
    const failedValue = BigInt(failed.get(asset)?.value ?? 0)
    const netValue = markedValue - failedValue
    native.push({
      asset,
      markedTradingNet: exactString(markedValue, decimals || 0),
      failedGas: exactString(failedValue, decimals || 0),
      netAfterFailedGas: exactString(netValue, decimals || 0),
    })
    if (netValue === 0n) continue
    nonzero = true
    const quote = quotes.get(asset)
    if (decimals === undefined || !quote?.value) {
      fullyValued = false
      continue
    }
    singleSource ||= quote.status === 'SINGLE_SOURCE'
    const rate = exactUnits(quote.value, QUOTE_DECIMALS)
    usdUnits += (netValue * rate) / 10n ** BigInt(decimals)
  }
  const zero = !nonzero
  const usdValue = fullyValued ? exactString(usdUnits, QUOTE_DECIMALS) : null
  const usdStatus = zero
    ? 'KNOWN_ZERO_NO_QUOTE_REQUIRED'
    : !fullyValued
      ? 'UNAVAILABLE'
      : singleSource
        ? 'ESTIMATED_SINGLE_SOURCE'
        : 'ESTIMATED_MARKET_REFERENCE'
  const cnyRate = valuation?.usdCny?.value
  const cnyUnits =
    usdValue !== null && (zero || cnyRate) ? (usdUnits * exactUnits(cnyRate || '1', 6)) / 1_000_000n : null
  return {
    date: day.date,
    periodStatus: day.periodStatus,
    evidenceStatus: day.evidenceStatus,
    successfulTrades: day.successfulTrades,
    failedTransactions: day.failedTransactions,
    native,
    strategyNetAfterFailedGas: {
      usd: { value: usdValue, status: usdStatus },
      cny: {
        value: cnyUnits === null ? null : exactString(cnyUnits, QUOTE_DECIMALS),
        status: zero ? 'KNOWN_ZERO_NO_QUOTE_REQUIRED' : cnyUnits === null ? 'UNAVAILABLE' : usdStatus,
      },
    },
    businessNet: { state: 'UNKNOWN', reason: 'OFFCHAIN_OPERATING_COSTS_EXCLUDED' },
  }
}

export function buildAgentDailyProfitSnapshot(daily, valuation) {
  if (
    daily?.mode !== 'READ_ONLY_RECEIPT_GATED_DAILY_PROFIT' ||
    daily?.timeZone !== 'Asia/Shanghai' ||
    !Number.isFinite(Date.parse(daily.generatedAt)) ||
    !Array.isArray(daily.days)
  ) {
    throw new Error('invalid source daily profit snapshot')
  }
  const days = daily.days.map((day) => dayProjection(day, valuation))
  const valuedDays = days.filter((day) => day.strategyNetAfterFailedGas.usd.value !== null)
  const cnyDays = days.filter((day) => day.strategyNetAfterFailedGas.cny.value !== null)
  const sum = (selected, currency) =>
    exactString(
      selected.reduce(
        (total, day) => total + exactUnits(day.strategyNetAfterFailedGas[currency].value, QUOTE_DECIMALS),
        0n,
      ),
      QUOTE_DECIMALS,
    )
  const result = {
    schemaVersion: AGENT_DAILY_PROFIT_SCHEMA_VERSION,
    mode: AGENT_DAILY_PROFIT_MODE,
    generatedAt: daily.generatedAt,
    timeZone: daily.timeZone,
    status:
      valuedDays.length === days.length && cnyDays.length === days.length && valuation?.status === 'READY'
        ? 'READY'
        : 'PARTIAL',
    accounting: {
      sourceMetric: 'markedTradingNetByAsset',
      successfulTransactionGasIncluded: true,
      failedTransactionGasDeducted: true,
      projectResultByAssetIncluded: false,
      offchainOperatingCostsIncluded: false,
    },
    valuation,
    summary: {
      from: days[0]?.date || null,
      to: days.at(-1)?.date || null,
      dayCount: days.length,
      valuedDayCount: valuedDays.length,
      successfulTrades: days.reduce((total, day) => total + day.successfulTrades, 0),
      knownStrategyNetUsd: valuedDays.length ? sum(valuedDays, 'usd') : null,
      knownStrategyNetCny: cnyDays.length ? sum(cnyDays, 'cny') : null,
    },
    days,
  }
  return assertPublicAgentDailyProfitSnapshot(result)
}

export function assertPublicAgentDailyProfitSnapshot(snapshot) {
  if (
    snapshot?.schemaVersion !== AGENT_DAILY_PROFIT_SCHEMA_VERSION ||
    snapshot?.mode !== AGENT_DAILY_PROFIT_MODE ||
    snapshot?.timeZone !== 'Asia/Shanghai' ||
    !Number.isFinite(Date.parse(snapshot.generatedAt)) ||
    !Array.isArray(snapshot.days) ||
    snapshot.days.length > 8
  ) {
    throw new Error('invalid agent daily profit snapshot identity')
  }
  const dates = new Set()
  for (const day of snapshot.days) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day?.date || '') || dates.has(day.date)) {
      throw new Error('invalid or duplicate agent daily profit period')
    }
    dates.add(day.date)
    if (day.businessNet?.state !== 'UNKNOWN') throw new Error('agent business net must remain unknown')
  }
  const serialized = JSON.stringify(snapshot)
  if (
    Buffer.byteLength(serialized) > MAX_SNAPSHOT_BYTES ||
    /private.?key|signed.?raw|webhook|rpc.?url|authorization.?id|wallet.?address|transaction.?hash/i.test(serialized)
  ) {
    throw new Error('agent daily profit snapshot contains forbidden data')
  }
  return snapshot
}
