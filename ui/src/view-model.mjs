export const PAGES = Object.freeze([
  { id: 'overview', label: 'Overview', index: '01' },
  { id: 'radar', label: 'Radar', index: '02' },
  { id: 'sources', label: 'Sources', index: '03' },
  { id: 'episodes', label: 'Episodes', index: '04' },
  { id: 'execution', label: 'Execution', index: '05' },
  { id: 'system', label: 'System', index: '06' },
])

export function currentPage(hash) {
  const candidate = String(hash || '')
    .replace(/^#\/?/, '')
    .split('/')[0]
  return PAGES.some((page) => page.id === candidate) ? candidate : 'overview'
}

export function formatMetric(value, digits = 2) {
  if (value === null || value === undefined || value === '') return '—'
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return '—'
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(numeric)
}

export function compactAddress(value) {
  if (!value) return 'UNKNOWN'
  return `${value.slice(0, 8)}…${value.slice(-6)}`
}

export function relativeAge(timestamp, now = Date.now()) {
  if (!timestamp || !Number.isFinite(Date.parse(timestamp))) return 'never'
  const seconds = Math.max(0, Math.floor((now - Date.parse(timestamp)) / 1_000))
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h`
  return `${Math.floor(seconds / 86_400)}d`
}

export function toneForStatus(status) {
  if (['CHAIN_ATTESTED', 'CORROBORATED', 'CURRENT', 'HEALTHY', 'CONFIRMED', 'REALIZED_NET_VERIFIED'].includes(status)) {
    return 'verified'
  }
  if (['FRESH_PROXY_POSITIVE', 'SCREENED_PROXY', 'BACKFILL_PARTIAL', 'PARTIAL', 'STALE'].includes(status)) {
    return 'proxy'
  }
  if (['CONFLICTED', 'ERROR', 'DEGRADED', 'REVERTED', 'HALTED'].includes(status)) return 'danger'
  return 'neutral'
}

export function economicHeadline(overview) {
  if (Number(overview?.exactReady || 0) > 0) return 'EXACT PREFLIGHT READY'
  if (Number(overview?.screenedPositive || 0) > 0) return 'PROXY EDGE OBSERVED'
  return 'NO FRESH PROXY EDGE'
}
