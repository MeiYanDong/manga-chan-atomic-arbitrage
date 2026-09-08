export const PAGES = Object.freeze([
  { id: 'overview', label: '经营总览', index: '01' },
  { id: 'radar', label: '机会雷达', index: '02' },
  { id: 'sources', label: '来源覆盖', index: '03' },
  { id: 'episodes', label: '机会窗口', index: '04' },
  { id: 'execution', label: '成交账单', index: '05' },
  { id: 'system', label: '运行状态', index: '06' },
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
  if (Number(overview?.exactReady || 0) > 0) return '发现可执行机会'
  if (Number(overview?.screenedPositive || 0) > 0) return '发现价差，正在精确核验'
  return '系统持续运行，等待有效机会'
}

export function businessHeadline(business, overview) {
  if (business && business.strategy?.status !== 'RUNNING') return '执行服务需要检查'
  if (business && !['RUNNING', 'SCANNING', 'HEALTHY'].includes(business.market?.status)) return '市场数据暂时降级'
  return economicHeadline(overview)
}

export function humanStatus(status) {
  const labels = {
    RUNNING: '运行中',
    SCANNING: '扫描中',
    HEALTHY: '正常',
    DEGRADED: '数据降级',
    DEGRADED_BOARD: '看板数据降级',
    DEGRADED_RPC: 'RPC 降级',
    STOPPED: '已停止',
    HALTED: '已熔断',
    ARMED: '已授权',
    CONNECTED: '已连接',
    PENDING_FIRST_DELIVERY: '等待首次送达',
    FRESH_PROXY_POSITIVE: '新鲜价差',
    FRESH_NO_EDGE: '无有效价差',
    UNQUOTED: '尚未报价',
    UNQUOTABLE: '暂不可报价',
    STALE: '已过期',
    CHAIN_ATTESTED: '链上已核验',
    CORROBORATED: '多源已核验',
    UNKNOWN: '待核验',
    CONFLICTED: '证据冲突',
  }
  return labels[status] || '待核验'
}

export function sourceLabel(platformId) {
  const labels = {
    PAIR: 'PAIR 平台',
    LONG_ROUTE: 'LONG 路线',
    UNATTRIBUTED_CHAIN: '其他链上池',
    DOPPLER: 'Doppler 协议',
    UNISWAP_V4: 'Uniswap v4',
    UNKNOWN: '来源待核验',
  }
  return labels[platformId] || '来源待核验'
}

export function sourceAdapterLabel(adapterId) {
  const labels = {
    'pair.catalog.v1': 'PAIR 官方列表',
    'pair.chain-catalog.v1': 'PAIR 链上目录',
    'long.launcher.v1': 'LONG 发行路线',
    'doppler.registry.v1': 'Doppler 发行协议',
    'uniswap-v4.pool-manager.v1': 'Uniswap v4 流动性池',
    'robinhood.assets.v1': 'Robinhood 资产目录',
  }
  return labels[adapterId] || '数据源待核验'
}

export function sourceAdapterDescription(adapterId) {
  const labels = {
    'pair.catalog.v1': '核对哪些资产被 PAIR 平台公开列出。',
    'pair.chain-catalog.v1': '从链上事件补全 PAIR 相关资产，不把它当作平台归属证明。',
    'long.launcher.v1': '识别由 LONG Launcher 发出的资产路线。',
    'doppler.registry.v1': '识别 Doppler 协议创建的目标资产。',
    'uniswap-v4.pool-manager.v1': '持续发现目标资产对应的 Uniswap v4 池。',
    'robinhood.assets.v1': '核对资产是否属于 Robinhood 官方资产目录。',
  }
  return labels[adapterId] || '该数据源的覆盖边界仍待核验。'
}

export function assetClassLabel(assetClass) {
  const labels = {
    STOCK: '股票代币',
    CRYPTO: '加密资产',
    MEME: 'Meme 资产',
    AI: 'AI 资产',
    CUSTOM: '自定义资产',
    MANGA_CUSTOM: 'MANGA 自定义资产',
    UNKNOWN: '资产类别待核验',
  }
  return labels[assetClass] || '资产类别待核验'
}

export function evidenceClaimLabel(claimType) {
  const labels = {
    PLATFORM_ATTRIBUTION: '平台来源',
    LAUNCH_FRONTEND: '创建入口',
    LAUNCH_PROTOCOL: '发行协议',
    LIQUIDITY_VENUE: '流动性场所',
    ASSET_CLASSIFICATION: '资产类别',
    QUOTE: '报价证据',
    EXECUTION: '执行证据',
  }
  return labels[claimType] || '核验证据'
}

export function decisionLabel(decision) {
  const labels = {
    NO_SCREENED_OPPORTUNITY: '当前没有达到门槛的机会',
    NO_AUTHORIZED_SCREENED_OPPORTUNITY: '当前没有获授权的机会',
    CANDIDATE_REJECTED_EXACT: '价差未通过精确核验',
    CONFIRMED_EXECUTION: '最近一笔交易已确认',
    BOARD_RETRY_SCHEDULED: '等待看板数据恢复',
    RPC_ERROR: 'RPC 暂时异常',
    SAME_BLOCK_DUAL_EXACT_PREFLIGHT_RUNNING: '正在做同区块精确核验',
  }
  return labels[decision] || '持续监听机会'
}

export function formatBeijingTime(value) {
  if (!value || !Number.isFinite(Date.parse(value))) return '待核验'
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value))
}
