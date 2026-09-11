export const PAGES = Object.freeze([
  { id: 'overview', label: '总览', description: '先看结果', index: '01' },
  { id: 'portfolio', label: '资金', description: '钱包与合约', index: '02' },
  { id: 'opportunities', label: '机会', description: '再看原因', index: '03' },
  { id: 'execution', label: '账单', description: '核对每一笔', index: '04' },
  { id: 'more', label: '更多', description: '来源与系统', index: '05' },
])

export function currentPage(hash) {
  const candidate = String(hash || '')
    .replace(/^#\/?/, '')
    .split('/')[0]
  const aliases = {
    radar: 'opportunities',
    episodes: 'opportunities',
    sources: 'more',
    system: 'more',
  }
  const normalized = aliases[candidate] || candidate
  return PAGES.some((page) => page.id === normalized) ? normalized : 'overview'
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
  if (!value) return '待核验'
  return `${value.slice(0, 8)}…${value.slice(-6)}`
}

export function relativeAge(timestamp, now = Date.now()) {
  if (!timestamp || !Number.isFinite(Date.parse(timestamp))) return '时间待核验'
  const seconds = Math.max(0, Math.floor((now - Date.parse(timestamp)) / 1_000))
  if (seconds < 15) return '刚刚'
  if (seconds < 60) return `${seconds} 秒前`
  if (seconds < 3_600) return `${Math.floor(seconds / 60)} 分钟前`
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)} 小时前`
  return `${Math.floor(seconds / 86_400)} 天前`
}

export function toneForStatus(status) {
  if (
    [
      'CHAIN_ATTESTED',
      'CORROBORATED',
      'CURRENT',
      'HEALTHY',
      'CONFIRMED',
      'REALIZED_NET_VERIFIED',
      'VERIFIED',
      'RUNNING',
    ].includes(status)
  ) {
    return 'verified'
  }
  if (
    [
      'FRESH_PROXY_POSITIVE',
      'SCREENED_PROXY',
      'BACKFILL_PARTIAL',
      'PARTIAL',
      'PENDING',
      'PARKED',
      'STALE',
      'LIMITED',
    ].includes(status)
  ) {
    return 'proxy'
  }
  if (['ALERT', 'CONFLICTED', 'ERROR', 'DEGRADED', 'REVERTED', 'HALTED', 'STOPPED'].includes(status)) return 'danger'
  return 'neutral'
}

export function economicHeadline(overview) {
  if (Number(overview?.exactReady || 0) > 0) return '有机会已通过成交前核验'
  if (Number(overview?.screenedPositive || 0) > 0) return '发现初筛价差，正在继续核验'
  if (Number(overview?.freshCandidates || 0) > 0) return '最新报价暂未达到收益门槛'
  return '持续扫描中，暂时没有有效机会'
}

export function businessHeadline(business, _overview) {
  if (!business) return '正在建立经营快照'
  if (business && business.strategy?.status !== 'RUNNING') return '执行服务需要检查'
  if (business && !['RUNNING', 'SCANNING', 'HEALTHY'].includes(business.market?.status)) return '市场数据暂时降级'
  const active = business?.economics?.activeStrategy
  if (Number(active?.confirmedExecutions || 0) > 0) {
    return `本策略已成交 ${active.confirmedExecutions} 笔`
  }
  return '本策略暂未成交'
}

export function opportunityLane(item) {
  if (item?.axes?.exactPreflight === 'PASSED' || item?.axes?.execution === 'READY') return 'executable'
  if (item?.axes?.quote === 'FRESH_PROXY_POSITIVE') return 'near'
  return 'watching'
}

export function opportunityReason(item) {
  if (opportunityLane(item) === 'executable') return '已通过成交前精确核验，等待执行结果。'
  const state = item?.axes?.quote
  if (state === 'FRESH_PROXY_POSITIVE') return '初筛发现价差，但还没有通过成交前精确核验。'
  if (state === 'FRESH_NO_EDGE') return '报价仍然有效，但预计净收益不足以覆盖 Gas 和执行门槛。'
  if (state === 'UNQUOTABLE') return '当前池子无法组成一条完整、可比较的往返路径。'
  if (state === 'UNQUOTED') return '系统已经发现池子，但尚未拿到完整报价。'
  if (state === 'STALE') return '这是一条已过期的历史报价，不能用于当前交易。'
  return '证据还不完整，系统会继续观察。'
}

export function sortOpportunitiesForOperator(items) {
  const priority = {
    FRESH_PROXY_POSITIVE: 5,
    FRESH_NO_EDGE: 4,
    UNQUOTABLE: 3,
    UNQUOTED: 2,
    STALE: 1,
  }
  return [...items].sort((left, right) => {
    const stateDifference = (priority[right?.axes?.quote] || 0) - (priority[left?.axes?.quote] || 0)
    if (stateDifference !== 0) return stateDifference
    const timeDifference = Date.parse(right?.quote?.quotedAt || 0) - Date.parse(left?.quote?.quotedAt || 0)
    if (Number.isFinite(timeDifference) && timeDifference !== 0) return timeDifference
    return Number(right?.quote?.screenedNetUsdg || 0) - Number(left?.quote?.screenedNetUsdg || 0)
  })
}

export function noTradeReason(business, overview) {
  if (!business) return '正在读取链上回执、余额和策略状态，请稍候。'
  if (business && business.strategy?.status !== 'RUNNING') return '自动执行服务没有处于运行状态，需要检查。'
  if (business && !['RUNNING', 'SCANNING', 'HEALTHY'].includes(business.market?.status)) {
    return '市场数据暂时降级，系统不会用不完整报价冒险成交。'
  }
  if (Number(overview?.exactReady || 0) > 0) return '已有机会通过精确核验，系统正在处理最新执行状态。'
  if (Number(overview?.screenedPositive || 0) > 0) {
    return `${overview.screenedPositive} 条路线通过了初筛，但还没有通过成交前精确核验。`
  }
  if (['LIMITED', 'DEGRADED'].includes(overview?.coverageQuality?.status)) {
    const fresh = Number(overview?.coverageQuality?.freshQuotedTokens || 0)
    const total = Number(overview?.coverageQuality?.candidateTokens || 0)
    return `目前没有已证实的可执行机会；但新鲜报价只覆盖 ${fresh}/${total} 条候选，不能据此断言全市场没有机会。`
  }
  if (Number(overview?.freshCandidates || 0) > 0) {
    return `${overview.freshCandidates} 条最新报价都没有达到扣除 Gas 后的收益门槛。`
  }
  return '系统持续扫描市场，目前没有出现满足执行条件的路线。'
}

export function humanStatus(status) {
  const labels = {
    RUNNING: '运行中',
    VERIFIED: '已核验',
    PARTIAL: '部分待核验',
    ALERT: '需要处理',
    PENDING: '有待确认交易',
    PARKED: '等待归集',
    SCANNING: '扫描中',
    HEALTHY: '正常',
    DEGRADED: '数据降级',
    DEGRADED_BOARD: '看板数据降级',
    DEGRADED_RPC: 'RPC 降级',
    STOPPED: '已停止',
    HALTED: '已熔断',
    ARMED: '已授权',
    CONNECTED: '已连接',
    CURRENT: '正常',
    LIMITED: '覆盖有限',
    PASSED: '已通过',
    NONE: '尚未执行',
    NOT_RUN: '尚未核验',
    READY: '可以执行',
    OPEN: '持续观察',
    CLOSED: '已经结束',
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
    NO_FRESH_BOARD_GENERATION: '等待下一轮市场数据',
    EXACT_PREFLIGHT_REJECTED: '精确核验未达到收益门槛',
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
