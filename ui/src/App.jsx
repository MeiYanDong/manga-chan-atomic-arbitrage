import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  PAGES,
  assetClassLabel,
  baseLiveSummary,
  currentPage,
  decisionLabel,
  evidenceClaimLabel,
  formatBeijingTime,
  formatMetric,
  humanStatus,
  noTradeReason,
  opportunityLane,
  opportunityReason,
  opportunityStageLabel,
  opportunityStageTone,
  relativeAge,
  runtimeBadge,
  selectOpportunitiesForOperator,
  crossChainRouteResult,
  sourceAdapterDescription,
  sourceAdapterLabel,
  sourceLabel,
  toneForStatus,
} from './view-model.mjs'

const emptyData = {
  overview: null,
  opportunities: [],
  sources: [],
  sourceSummary: null,
  system: null,
  business: null,
  chainOpportunities: null,
}

const activityLabels = Object.freeze({
  CAPITAL_IN: '资金转入',
  DEPLOYMENT: '合约部署',
  AUTHORIZATION: '策略授权',
  ARBITRAGE: '套利成交',
  COLLECTION: '资金归集',
  FAILED_TRANSACTION: '失败交易',
})

async function requestJson(path, signal) {
  const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(8_000)]) : AbortSignal.timeout(8_000)
  const response = await fetch(path, { headers: { accept: 'application/json' }, signal: requestSignal })
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`)
  return response.json()
}

async function requestOptionalJson(path, signal) {
  const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(8_000)]) : AbortSignal.timeout(8_000)
  const response = await fetch(path, { headers: { accept: 'application/json' }, signal: requestSignal })
  if ([404, 503].includes(response.status)) return null
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`)
  return response.json()
}

function useOperationsData() {
  const [state, setState] = useState({ data: emptyData, loading: true, error: null, partial: null, refreshedAt: null })
  useEffect(() => {
    let mounted = true
    let controller = null
    const load = async () => {
      controller?.abort()
      controller = new AbortController()
      try {
        const results = await Promise.allSettled([
          requestJson('/api/v1/overview', controller.signal),
          requestJson('/api/v1/sources', controller.signal),
          requestJson('/api/v1/system', controller.signal),
          requestOptionalJson('/api/v1/business', controller.signal),
          requestOptionalJson('/api/v1/opportunities/chains', controller.signal),
        ])
        if (!mounted) return
        const succeeded = results.filter((result) => result.status === 'fulfilled').length
        if (succeeded === 0) throw new Error('all presentation endpoints are unavailable')
        const value = (index) => (results[index].status === 'fulfilled' ? results[index].value : null)
        const overview = value(0)
        const sources = value(1)
        const system = value(2)
        const business = value(3)
        const chainOpportunities = value(4)
        setState((before) => ({
          data: {
            overview: overview || before.data.overview,
            opportunities: before.data.opportunities,
            sources: sources?.items || before.data.sources,
            sourceSummary: sources?.summary || before.data.sourceSummary,
            system: system || before.data.system,
            business: business || before.data.business,
            chainOpportunities: chainOpportunities || before.data.chainOpportunities,
          },
          loading: false,
          error: null,
          partial: succeeded < results.length ? '部分市场数据暂时不可用，已保留最近一次成功结果。' : null,
          refreshedAt: new Date().toISOString(),
        }))
      } catch (error) {
        if (!mounted || error.name === 'AbortError') return
        setState((before) => ({ ...before, loading: false, error: error.message, partial: null }))
      }
    }
    load()
    const interval = setInterval(load, 15_000)
    return () => {
      mounted = false
      clearInterval(interval)
      controller?.abort()
    }
  }, [])
  return state
}

function useStrategyOpportunities(enabled) {
  const [state, setState] = useState({ items: [], count: 0, loading: false, error: null })
  useEffect(() => {
    if (!enabled) return undefined
    let mounted = true
    let controller = null
    const load = async () => {
      controller?.abort()
      controller = new AbortController()
      setState((before) => ({ ...before, loading: true }))
      try {
        const payload = await requestJson('/api/v1/opportunities?limit=12', controller.signal)
        if (!mounted) return
        setState({ items: payload.items || [], count: payload.count || 0, loading: false, error: null })
      } catch (error) {
        if (!mounted || error.name === 'AbortError') return
        setState((before) => ({ ...before, loading: false, error: error.message }))
      }
    }
    load()
    const interval = setInterval(load, 30_000)
    return () => {
      mounted = false
      clearInterval(interval)
      controller?.abort()
    }
  }, [enabled])
  return state
}

function useOpportunityLedger(stage) {
  const [state, setState] = useState({
    summary: null,
    items: [],
    episodes: [],
    competitors: null,
    loading: true,
    error: null,
  })
  useEffect(() => {
    let mounted = true
    let controller = null
    const load = async () => {
      controller?.abort()
      controller = new AbortController()
      try {
        const paths = [
          '/api/v1/opportunity-ledger/summary',
          `/api/v1/opportunity-ledger/items?stage=${encodeURIComponent(stage)}&limit=50`,
          stage === 'UNKNOWN' ? '/api/v1/opportunity-ledger/episodes?limit=50' : null,
          '/api/v1/competitors/earn',
        ]
        const results = await Promise.allSettled(
          paths.map((path) => (path ? requestOptionalJson(path, controller.signal) : Promise.resolve(null))),
        )
        if (!mounted) return
        const value = (index) => (results[index].status === 'fulfilled' ? results[index].value : null)
        const summary = value(0)
        const items = value(1)
        const episodes = value(2)
        const competitors = value(3)
        if (!summary || !items) throw new Error('opportunity ledger is unavailable')
        setState({
          summary,
          items: items.items || [],
          episodes: episodes?.items || [],
          competitors,
          loading: false,
          error: null,
        })
      } catch (error) {
        if (!mounted || error.name === 'AbortError') return
        setState((before) => ({ ...before, loading: false, error: error.message }))
      }
    }
    load()
    const interval = setInterval(load, 15_000)
    return () => {
      mounted = false
      clearInterval(interval)
      controller?.abort()
    }
  }, [stage])
  return state
}

function number(value, digits = 2, signed = false) {
  if (value === null || value === undefined || value === '') return '—'
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return '—'
  const sign = numeric < 0 ? '−' : signed && numeric > 0 ? '+' : ''
  const absolute = Math.abs(numeric)
  const threshold = 10 ** -digits
  if (absolute > 0 && absolute < threshold) return `${sign}<${formatMetric(threshold, digits)}`
  return `${sign}${formatMetric(absolute, digits)}`
}

function exact(value) {
  return value === null || value === undefined || value === '' ? '待核验' : String(value)
}

function Status({ value, label = humanStatus(value) }) {
  return <span className={`status status-${toneForStatus(value)}`}>{label}</span>
}

function Header({ page, business, overview, loading, error }) {
  const runtime = runtimeBadge(business, { loading, error: Boolean(error) })
  return (
    <header className="app-header">
      <div className="header-row">
        <a className="brand" href="#/overview">
          套利经营面板
        </a>
        <div className="header-state">
          <Status value={runtime.status} label={runtime.label} />
          <span>{relativeAge(business?.generatedAt || overview?.generatedAt)}</span>
          <span className="readonly">只读</span>
        </div>
      </div>
      <nav className="main-nav" aria-label="主要页面">
        {PAGES.map((item) => (
          <a key={item.id} href={`#/${item.id}`} className={page === item.id ? 'active' : ''}>
            {item.label}
          </a>
        ))}
      </nav>
    </header>
  )
}

function PageTitle({ title, note = null, side = null }) {
  return (
    <div className="page-title">
      <div>
        <h1>{title}</h1>
        {note && <p>{note}</p>}
      </div>
      {side}
    </div>
  )
}

function Section({ title, side = null, children, className = '' }) {
  return (
    <section className={`section ${className}`}>
      <div className="section-heading">
        <h2>{title}</h2>
        {side}
      </div>
      {children}
    </section>
  )
}

function Notice({ tone = 'warning', children }) {
  return <div className={`notice notice-${tone}`}>{children}</div>
}

function executionMetric(summary) {
  if (!summary) return { primary: '—', secondary: '收益口径待核验' }
  const usdg = Number(summary.verifiedExecutionNetUsdg)
  const eth = Number(summary.verifiedExecutionNetEth)
  const primaryIsEth = Number.isFinite(eth) && eth !== 0 && (!Number.isFinite(usdg) || usdg === 0)
  return {
    primary: primaryIsEth
      ? `${number(summary.verifiedExecutionNetEth, 6, true)} ETH`
      : `${number(summary.verifiedExecutionNetUsdg, 2, true)} USDG`,
    secondary: primaryIsEth
      ? `${number(summary.verifiedExecutionNetUsdg, 2, true)} USDG · ${summary.confirmedExecutions} 笔`
      : `${number(summary.verifiedExecutionNetEth, 6, true)} ETH · ${summary.confirmedExecutions} 笔`,
  }
}

function MetricStrip({ business, overview }) {
  const today = business?.economics?.today
  const allTime = business?.economics?.allTime
  const todayMetric = executionMetric(today)
  const allTimeMetric = executionMetric(allTime)
  return (
    <section className="metric-strip" aria-label="核心经营指标">
      <div>
        <span>今日策略净收益</span>
        <strong>{todayMetric.primary}</strong>
        <small>{todayMetric.secondary}</small>
      </div>
      <div>
        <span>策略累计净收益</span>
        <strong>{allTimeMetric.primary}</strong>
        <small>{allTimeMetric.secondary}</small>
      </div>
      <div>
        <span>可复投资金</span>
        <strong>{number(business?.capital?.spendableUsdg, 2)}</strong>
        <small>USDG · {number(business?.capital?.spendableWeth, 4)} WETH</small>
      </div>
      <div>
        <span>可执行机会</span>
        <strong>{overview?.exactReady ?? '—'}</strong>
        <small>接近门槛 {overview?.screenedPositive ?? '—'} 条</small>
      </div>
    </section>
  )
}

function ProjectEconomics({ project }) {
  return (
    <Section title="项目经营结果" side={<Status value={project?.coverage || 'UNKNOWN'} />}>
      <p className="section-note">按原生资产分别核算，不用临时价格拼成一个总数。</p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>资产</th>
              <th className="numeric">已确认收益</th>
              <th className="numeric">经营成本</th>
              <th className="numeric">净影响</th>
            </tr>
          </thead>
          <tbody>
            {(project?.byAsset || []).length === 0 ? (
              <tr>
                <td colSpan={4} className="empty-cell">
                  经营账正在建立，未知数据不会按零处理。
                </td>
              </tr>
            ) : (
              project.byAsset.map((item) => (
                <tr key={item.asset}>
                  <td className="asset">{item.asset}</td>
                  <td className="numeric positive">{number(item.profit, item.asset === 'USDG' ? 2 : 6, true)}</td>
                  <td className="numeric negative">{number(item.cost, item.asset === 'USDG' ? 2 : 6)}</td>
                  <td className={`numeric ${Number(item.net) < 0 ? 'negative' : 'positive'}`}>
                    {number(item.net, item.asset === 'USDG' ? 2 : 6, true)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {project?.coverageNote && <p className="coverage-note">{project.coverageNote}</p>}
    </Section>
  )
}

function networkBalances(portfolio) {
  return (portfolio?.networks || []).map((network) => ({
    ...network,
    balances: Object.entries(network.all || {}).filter(([, amount]) => amount !== null && Number(amount) !== 0),
  }))
}

function FundsSnapshot({ portfolio, compact = false }) {
  return (
    <Section
      title="资金分布"
      side={compact ? <a href="#/portfolio">查看全部</a> : <Status value={portfolio?.status || 'UNKNOWN'} />}
    >
      <div className="table-wrap">
        <table className="funds-summary-table">
          <thead>
            <tr>
              <th>链</th>
              <th>当前资产</th>
              <th className="numeric">追踪位置</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            {networkBalances(portfolio).map((network) => (
              <tr key={network.id}>
                <td data-label="链">{network.label}</td>
                <td data-label="当前资产">
                  {network.balances.length > 0
                    ? network.balances
                        .map(([asset, amount]) => `${number(amount, asset === 'USDG' ? 2 : 6)} ${asset}`)
                        .join(' · ')
                    : '余额待核验'}
                </td>
                <td className="numeric" data-label="追踪位置">
                  {(portfolio?.accounts || []).filter((account) => account.networkId === network.id).length}
                </td>
                <td data-label="状态">
                  <Status value={network.status} />
                </td>
              </tr>
            ))}
            {!portfolio && (
              <tr>
                <td colSpan={4} className="empty-cell">
                  资金快照待核验
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Section>
  )
}

function activityAmount(activity) {
  const items = activity?.amounts || []
  if (items.length === 0) return '—'
  return items
    .map((item) => {
      const sign = item.direction === 'IN' ? '+' : item.direction === 'OUT' ? '−' : ''
      return `${sign}${number(item.value, item.asset === 'USDG' ? 2 : 6)} ${item.asset}`
    })
    .join(' · ')
}

function activityImpact(activity) {
  const effects = activity?.effects || []
  if (effects.length === 0) {
    if (['CAPITAL_IN', 'COLLECTION'].includes(activity?.type)) return '本金变动，不计收益'
    return '不影响经营结果'
  }
  return effects
    .map(
      (effect) =>
        `${effect.kind === 'PROFIT' ? '+' : '−'}${number(effect.value, effect.asset === 'USDG' ? 2 : 6)} ${effect.asset}`,
    )
    .join(' · ')
}

function activityGas(activity) {
  if (!activity?.gas) return '—'
  const value = `${number(activity.gas.value, 6)} ETH`
  if (activity.gas.treatment === 'EXTERNAL') return `${value}（外部支付）`
  if (activity.gas.treatment === 'INCLUDED_IN_RESULT') return `${value}（已计入）`
  return value
}

function ActivityTable({ activities = [], limit = null, onOpen }) {
  const items = limit ? activities.slice(0, limit) : activities
  return (
    <div className="table-wrap">
      <table className="activity-table">
        <thead>
          <tr>
            <th>时间</th>
            <th>类型</th>
            <th>链</th>
            <th>金额</th>
            <th>Gas</th>
            <th>经营影响</th>
            <th>状态</th>
            <th aria-label="操作" />
          </tr>
        </thead>
        <tbody>
          {items.length === 0 ? (
            <tr>
              <td colSpan={8} className="empty-cell">
                暂无已核验的项目交易记录
              </td>
            </tr>
          ) : (
            items.map((item) => (
              <tr key={item.activityId}>
                <td>{formatBeijingTime(item.occurredAt)}</td>
                <td>
                  <strong>{activityLabels[item.type] || '项目活动'}</strong>
                  <small>{item.title}</small>
                </td>
                <td>{item.network}</td>
                <td>{activityAmount(item)}</td>
                <td>{activityGas(item)}</td>
                <td className={(item.effects || []).some((effect) => effect.kind === 'COST') ? 'negative' : 'positive'}>
                  {activityImpact(item)}
                </td>
                <td>
                  <Status value={item.status} />
                </td>
                <td>
                  <button className="text-button" type="button" onClick={() => onOpen(item)}>
                    凭证
                  </button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}

function OverviewPage({ data, onOpenActivity }) {
  const business = data.business
  const strategyUnhealthy = business && business.strategy?.status !== 'RUNNING'
  const marketUnhealthy = business && !['RUNNING', 'SCANNING', 'HEALTHY'].includes(business.market?.status)
  return (
    <div className="page-stack">
      <PageTitle title="经营概览" note="先看真实结果、可用资金和是否存在可执行机会。" />
      {!business && <Notice>经营快照尚未生成，未知数据不会显示为零。</Notice>}
      {strategyUnhealthy && <Notice tone="danger">实盘执行服务需要检查，新的交易不会被发起。</Notice>}
      {!strategyUnhealthy && marketUnhealthy && (
        <Notice>市场数据暂时不完整，策略会拒绝不完整报价；这不代表实盘执行进程已经停止。</Notice>
      )}
      <MetricStrip business={business} overview={data.overview} />
      <ProjectEconomics project={business?.economics?.project} />
      <FundsSnapshot portfolio={business?.portfolio} compact />
      <Section title="最近交易" side={<a href="#/activity">查看全部</a>}>
        <ActivityTable activities={business?.activities || []} limit={6} onOpen={onOpenActivity} />
      </Section>
    </div>
  )
}

function ActivityPage({ business, onOpen }) {
  const [type, setType] = useState('ALL')
  const [network, setNetwork] = useState('ALL')
  const [status, setStatus] = useState('ALL')
  const activities = useMemo(
    () =>
      (business?.activities || []).filter(
        (item) =>
          (type === 'ALL' || item.type === type) &&
          (network === 'ALL' || item.networkId === network) &&
          (status === 'ALL' || item.status === status),
      ),
    [business?.activities, network, status, type],
  )
  return (
    <div className="page-stack">
      <PageTitle title="交易记录" note="转入、部署、授权、套利、归集和失败交易统一按时间排列。" />
      <div className="filters" aria-label="交易筛选">
        <label>
          <span>类型</span>
          <select value={type} onChange={(event) => setType(event.target.value)}>
            <option value="ALL">全部</option>
            {Object.entries(activityLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>链</span>
          <select value={network} onChange={(event) => setNetwork(event.target.value)}>
            <option value="ALL">全部</option>
            <option value="ROBINHOOD">Robinhood Chain</option>
            <option value="BASE">Base</option>
          </select>
        </label>
        <label>
          <span>状态</span>
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="ALL">全部</option>
            <option value="CONFIRMED">已确认</option>
            <option value="REVERTED">已回滚</option>
            <option value="UNKNOWN">待核验</option>
          </select>
        </label>
        <span className="filter-count">{activities.length} 条</span>
      </div>
      <Section title="项目链上活动">
        <ActivityTable activities={activities} onOpen={onOpen} />
      </Section>
      <p className="page-footnote">只有已登记或已被运行账本识别的项目活动会显示；未知历史不会被自动补成零。</p>
    </div>
  )
}

function accountBalances(account) {
  return (account?.assets || [])
    .filter((asset) => asset.amount !== null && Number(asset.amount) !== 0)
    .map((asset) => `${number(asset.amount, asset.symbol === 'USDG' ? 2 : 6)} ${asset.symbol}`)
    .join(' · ')
}

function FundsPage({ portfolio }) {
  return (
    <div className="page-stack">
      <PageTitle
        title="资金"
        note="只展示本套利项目纳入追踪的钱包和合约；历史入金请在交易页核对。"
        side={<Status value={portfolio?.status || 'UNKNOWN'} />}
      />
      <FundsSnapshot portfolio={portfolio} />
      <Section title="钱包与合约">
        <div className="table-wrap">
          <table className="account-table">
            <thead>
              <tr>
                <th>链</th>
                <th>位置</th>
                <th>用途</th>
                <th>当前余额</th>
                <th>状态</th>
                <th>链上记录</th>
              </tr>
            </thead>
            <tbody>
              {(portfolio?.accounts || []).map((account) => {
                const displayStatus =
                  account.monitoringState === 'PARKED' && account.status === 'VERIFIED' ? 'PARKED' : account.status
                return (
                  <tr key={account.id}>
                    <td data-label="链">{account.network}</td>
                    <td data-label="位置">{account.label}</td>
                    <td data-label="用途">
                      {account.kind === 'WALLET'
                        ? '支付 Gas'
                        : account.monitoringState === 'PARKED'
                          ? '历史资金'
                          : '循环本金'}
                    </td>
                    <td data-label="当前余额">{accountBalances(account) || '0（已核验）'}</td>
                    <td data-label="状态">
                      <Status value={displayStatus} />
                    </td>
                    <td data-label="链上记录">
                      <details className="inline-details">
                        <summary>查看</summary>
                        <div>
                          <code>{account.address}</code>
                          <span>身份：{humanStatus(account.checks?.identity)}</span>
                          <a href={account.explorerUrl} target="_blank" rel="noreferrer">
                            打开区块浏览器
                          </a>
                        </div>
                      </details>
                    </td>
                  </tr>
                )
              })}
              {!portfolio && (
                <tr>
                  <td colSpan={6} className="empty-cell">
                    资金快照待核验
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  )
}

function opportunityStatus(item) {
  const lane = opportunityLane(item)
  if (lane === 'executable') return { status: 'READY', label: '可以执行' }
  if (lane === 'near') return { status: 'FRESH_PROXY_POSITIVE', label: '接近门槛' }
  return { status: item?.axes?.quote || 'UNKNOWN', label: '继续观察' }
}

function OpportunityTable({ items, onOpen }) {
  const sourceItems = items || []
  const visible = selectOpportunitiesForOperator(sourceItems)
  return (
    <>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>资产 / 路线</th>
              <th>来源</th>
              <th className="numeric">初筛净收益</th>
              <th>当前结论</th>
              <th aria-label="操作" />
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={5} className="empty-cell">
                  暂无候选路线
                </td>
              </tr>
            ) : (
              visible.map((item) => {
                const state = opportunityStatus(item)
                return (
                  <tr key={item.opportunityId}>
                    <td>
                      <strong>{item.target?.symbol || '待核验'}</strong>
                      <small>{item.routeLabel || '路线待核验'}</small>
                    </td>
                    <td>{sourceLabel(item.provenance?.platformAttribution?.platformId)}</td>
                    <td className="numeric">
                      {item.quote?.screenedNetUsdg === null || item.quote?.screenedNetUsdg === undefined
                        ? '—'
                        : `${number(item.quote.screenedNetUsdg, 2, true)} USDG`}
                    </td>
                    <td>
                      <Status value={state.status} label={state.label} />
                    </td>
                    <td>
                      <button className="text-button" type="button" onClick={() => onOpen(item)}>
                        原因
                      </button>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
      {sourceItems.length > visible.length && (
        <p className="coverage-note">
          仅展示最值得看的 {visible.length} 条；其余 {sourceItems.length - visible.length}{' '}
          条仍由系统持续扫描，不占用经营面板。
        </p>
      )}
    </>
  )
}

function SourceTable({ summary, sources }) {
  const rows = [
    ['PAIR 平台', summary?.pairListings, '仅 PAIR 官方清单'],
    ['LONG 路线', summary?.longLaunches, 'LONG 发行路线'],
    ['Doppler 协议', summary?.dopplerTargetsDiscovered, 'Doppler 创建的目标'],
    ['其他链上池', summary?.genericPools, '不归属于上述平台的流动性池'],
  ]
  return (
    <>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>信息源</th>
              <th className="numeric">已发现</th>
              <th>口径</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, value, scope]) => (
              <tr key={label}>
                <td>{label}</td>
                <td className="numeric">{value ?? '—'}</td>
                <td>{scope}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <details className="technical-details">
        <summary>数据源运行明细</summary>
        <div className="detail-list">
          {(sources || []).map((source) => (
            <div key={source.adapterId}>
              <span>
                <strong>{sourceAdapterLabel(source.adapterId)}</strong>
                <small>{sourceAdapterDescription(source.adapterId)}</small>
              </span>
              <Status value={source.status} />
            </div>
          ))}
        </div>
      </details>
    </>
  )
}

function CrossChainOpportunityTable({ snapshot }) {
  const networks = snapshot?.networks || []
  return (
    <>
      <p className="section-note">独立核对各链上的 Uniswap 与 PancakeSwap；这里只展示扣除 Gas 后的结论。</p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>链</th>
              <th>覆盖范围</th>
              <th className="numeric">有效闭环</th>
              <th className="numeric">净正机会</th>
              <th>当前结论</th>
            </tr>
          </thead>
          <tbody>
            {networks.map((network) => {
              const positive = network.funnel?.gasAdjustedPositiveCycles || 0
              return (
                <tr key={network.id}>
                  <td>{network.name}</td>
                  <td>
                    <strong>{(network.coverage?.venues || []).join('、') || '待核验'}</strong>
                    <small>{(network.coverage?.assets || []).join('、') || '资产待核验'}</small>
                  </td>
                  <td className="numeric">
                    <strong>{network.funnel?.fullyQuotedCycles ?? '—'}</strong>
                    <small>尝试 {network.funnel?.attemptedCycles ?? '—'}</small>
                  </td>
                  <td className={`numeric ${positive > 0 ? 'positive' : ''}`}>{positive}</td>
                  <td>
                    {network.status === 'PARTIAL' ? (
                      <Status value="PARTIAL" label="数据不完整" />
                    ) : positive > 0 ? (
                      <Status value="READY" label="影子净正，待工程准入" />
                    ) : (
                      <Status value="NO_SHOT" label="本轮无净正" />
                    )}
                  </td>
                </tr>
              )
            })}
            {networks.length === 0 && (
              <tr>
                <td colSpan={5} className="empty-cell">
                  跨平台扫描尚未生成；未知结果不会显示为零。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="coverage-note">影子净正不等于已成交；执行器、分叉测试和链上回执全部通过后才能记为收益。</p>
    </>
  )
}

const opportunityStages = Object.freeze(['NOW', 'NEAR', 'FILTERED', 'UNKNOWN'])

const opportunityStageNotes = Object.freeze({
  NOW: '已通过成交前精确核验；出现时由实盘服务立即处理。',
  NEAR: '已观察到价差，但经过 Gas、风险储备或成交前核验后还不能执行。',
  FILTERED: '有新鲜完整报价，但闭环毛利不为正。',
  UNKNOWN: '报价过期、不完整或仍未获取；未知不会被写成零机会。',
})

function opportunityMoney(value, unit = 'USDG', signed = false) {
  if (value === null || value === undefined || value === '') return '—'
  return `${number(value, unit === 'USDG' ? 3 : 6, signed)} ${unit}`
}

function valueTone(value) {
  if (value === null || value === undefined || value === '') return ''
  const numeric = Number.parseFloat(String(value))
  if (!Number.isFinite(numeric) || numeric === 0) return ''
  return numeric > 0 ? 'positive' : 'negative'
}

function OpportunityStageTabs({ stage, counts, onChange }) {
  return (
    <div className="opportunity-tabs" role="tablist" aria-label="机会阶段">
      {opportunityStages.map((value) => (
        <button
          key={value}
          type="button"
          role="tab"
          aria-selected={stage === value}
          className={stage === value ? 'active' : ''}
          onClick={() => onChange(value)}
        >
          <span>{opportunityStageLabel(value)}</span>
          <strong>{counts?.[value] ?? '—'}</strong>
        </button>
      ))}
    </div>
  )
}

function OpportunityLedgerTable({ items, stage, loading }) {
  return (
    <div className="table-wrap">
      <table className="opportunity-ledger-table">
        <thead>
          <tr>
            <th>资产 / 路线</th>
            <th className="numeric">测试本金</th>
            <th className="numeric">毛利</th>
            <th className="numeric">预估成本</th>
            <th className="numeric">预估净利润</th>
            <th>当前结论</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.opportunityId}>
              <td>
                <strong>{item.asset}</strong>
                <small>{item.route}</small>
                {item.disclosure?.exactRouteDelayed && (
                  <small>当前精确路线与本金将于 {formatBeijingTime(item.disclosure.availableAt)} 公开</small>
                )}
              </td>
              <td className="numeric">
                {item.disclosure?.exactRouteDelayed
                  ? '延迟公开'
                  : opportunityMoney(item.economics?.principal, item.economics?.unit)}
              </td>
              <td className={`numeric ${valueTone(item.economics?.grossProfit)}`}>
                {opportunityMoney(item.economics?.grossProfit, item.economics?.unit, true)}
              </td>
              <td className="numeric">{opportunityMoney(item.economics?.estimatedCost, item.economics?.unit)}</td>
              <td className={`numeric ${valueTone(item.economics?.estimatedNetProfit)}`}>
                {opportunityMoney(item.economics?.estimatedNetProfit, item.economics?.unit, true)}
              </td>
              <td>
                <Status value={opportunityStageTone(item.stage)} label={opportunityStageLabel(item.stage)} />
                <small>{item.reason}</small>
              </td>
            </tr>
          ))}
          {items.length === 0 && (
            <tr>
              <td colSpan={6} className="empty-cell">
                {loading ? '正在更新机会证据…' : `${opportunityStageLabel(stage)}当前为 0`}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

function OpportunityFunnel({ overview, ledger }) {
  const funnel = overview?.funnel || {}
  const stages = [
    ['已发现池子', funnel.discoveredPools],
    ['多池目标', funnel.multiPoolTargets],
    ['进入候选', funnel.admittedCandidates],
    ['新鲜报价', funnel.freshQuotes],
    ['接近门槛', ledger?.counts?.NEAR],
    ['精确可执行', ledger?.counts?.NOW],
  ]
  return (
    <Section title="机会漏斗" side={<Status value={ledger?.coverage?.status || 'UNKNOWN'} />}>
      <div className="funnel-line">
        {stages.map(([label, value], index) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{value ?? '—'}</strong>
            {index < stages.length - 1 && <i aria-hidden="true">›</i>}
          </div>
        ))}
      </div>
      <p className="coverage-note">
        当前新鲜覆盖 {overview?.coverageQuality?.freshQuotedTokens ?? '—'} /{' '}
        {overview?.coverageQuality?.candidateTokens ?? '—'} 条候选；未报价与过期报价都归入“未知”。
      </p>
    </Section>
  )
}

function CrossChainRouteLedger({ snapshot }) {
  const rows = (snapshot?.networks || []).flatMap((network) =>
    (network.bestObservedRoutes || []).map((route) => ({ network, route })),
  )
  return (
    <Section title="Robinhood 与 BNB 跨平台扫描">
      <p className="section-note">这是固定区块的只读报价；“净正”不等于已经成交。</p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>链 / 路线</th>
              <th className="numeric">测试本金</th>
              <th className="numeric">毛利</th>
              <th className="numeric">Gas / 风险储备</th>
              <th className="numeric">预估净利润</th>
              <th>结论</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ network, route }, index) => {
              const result = crossChainRouteResult(route)
              const delay =
                result.stage === 'NEAR' &&
                Number.isFinite(Date.parse(network.observedAt)) &&
                Date.now() - Date.parse(network.observedAt) < 5 * 60 * 1_000
              return (
                <tr key={`${network.id}:${route.pair}:${route.route}:${index}`}>
                  <td>
                    <strong>{network.name}</strong>
                    <small>{delay ? `${route.routeType || '多池'}闭环` : `${route.pair} · ${route.route}`}</small>
                  </td>
                  <td className="numeric">{delay ? '延迟公开' : route.principal}</td>
                  <td className={`numeric ${valueTone(route.grossProfit)}`}>{route.grossProfit}</td>
                  <td className="numeric">
                    {route.estimatedGasCost}
                    <small>储备 {route.riskReserve}</small>
                  </td>
                  <td className={`numeric ${valueTone(route.estimatedNetProfit)}`}>{route.estimatedNetProfit}</td>
                  <td>
                    <Status value={opportunityStageTone(result.stage)} label={result.label} />
                  </td>
                </tr>
              )
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="empty-cell">
                  跨平台报价尚未生成；这不代表机会为零。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Section>
  )
}

function HistoricalOpportunityTable({ items }) {
  return (
    <Section title="历史价差与证据空档">
      <p className="section-note">历史价差不自动等于错失利润；只有完整反事实证据才能记为被抢或错失。</p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>历史路线</th>
              <th>最后观察</th>
              <th className="numeric">当时预估净利润</th>
              <th>可以得出的结论</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.episodeId}>
                <td>{item.route}</td>
                <td>{formatBeijingTime(item.lastPositiveAt || item.openedAt)}</td>
                <td className="numeric positive">{opportunityMoney(item.lastPositiveNetUsdg, 'USDG', true)}</td>
                <td>{item.conclusion}</td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={4} className="empty-cell">
                  暂无历史价差记录
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Section>
  )
}

function CompetitorEvidence({ snapshot }) {
  const summary = snapshot?.summary
  const leaders = snapshot?.leaders || []
  const evidence = snapshot?.recentEvidence || []
  const generatedAtMs = Date.parse(snapshot?.generatedAt || '')
  const stale = !Number.isFinite(generatedAtMs) || Date.now() - generatedAtMs > 2 * 60 * 1_000
  const status = snapshot && !stale ? snapshot.status : 'STALE'
  return (
    <Section title="竞争者与被抢证据" side={<Status value={snapshot ? status : 'PARTIAL'} />}>
      <p className="section-note">只计入审查路线的链上成交回执；普通 swap、未知报价和历史正价差不会被冒充为竞争。</p>
      <dl className="fact-grid competitor-facts">
        <div>
          <dt>已审查交易</dt>
          <dd>{summary?.transactionsReviewed ?? '—'}</dd>
        </div>
        <div>
          <dt>外部闭环回执</dt>
          <dd>{summary?.externalCycleReceipts ?? '—'}</dd>
        </div>
        <div>
          <dt>已确认竞争者</dt>
          <dd>{summary?.distinctExternalActors ?? '—'}</dd>
        </div>
        <div>
          <dt>已证明被抢</dt>
          <dd>{summary?.confirmedLostRaces ?? '—'}</dd>
        </div>
      </dl>
      {!snapshot && <p className="coverage-note">竞争者链上取证正在接入；当前不能声称没有竞争者。</p>}
      {snapshot && stale && <p className="coverage-note">竞争者快照已过期，当前数字不能当作实时结论。</p>}
      {snapshot?.coverage?.note && <p className="coverage-note">{snapshot.coverage.note}</p>}
      {leaders.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>参与者</th>
                <th className="numeric">精确闭环回执</th>
                <th className="numeric">路线净正估算</th>
                <th>最后出现</th>
              </tr>
            </thead>
            <tbody>
              {leaders.map((item) => (
                <tr key={item.actorAlias}>
                  <td>{item.actorAlias}</td>
                  <td className="numeric">{item.confirmedCycleReceipts}</td>
                  <td className="numeric">{item.positiveRouteEstimates}</td>
                  <td>{formatBeijingTime(item.lastSeenAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {evidence.length > 0 && (
        <details className="technical-details">
          <summary>查看链上回执证据</summary>
          <ol className="evidence-list">
            {evidence.map((item) => (
              <li key={item.evidenceId}>
                <a
                  href={`https://robinhoodchain.blockscout.com/tx/${item.transactionHash}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {item.actorAlias} · {item.route}
                </a>{' '}
                · 路线净额估算 {number(item.estimatedNetEth, 6, true)} ETH · {formatBeijingTime(item.occurredAt)}
              </li>
            ))}
          </ol>
        </details>
      )}
    </Section>
  )
}

function OpportunitiesPage({ data }) {
  const [stage, setStage] = useState('NOW')
  const ledger = useOpportunityLedger(stage)
  return (
    <div className="page-stack">
      <PageTitle
        title="机会"
        note="看当前能不能做、为什么没做，以及哪些结论仍缺证据。"
        side={<Status value={ledger.summary?.coverage?.status || 'UNKNOWN'} />}
      />
      {ledger.error && <Notice tone="danger">机会总账暂时不可用，页面会继续自动重试。</Notice>}
      <OpportunityFunnel overview={data.overview} ledger={ledger.summary} />
      <OpportunityStageTabs stage={stage} counts={ledger.summary?.counts} onChange={setStage} />
      <Section
        title={opportunityStageLabel(stage)}
        side={<span className="section-summary">{ledger.items.length} 条已展示</span>}
      >
        <p className="section-note">{opportunityStageNotes[stage]}</p>
        <OpportunityLedgerTable items={ledger.items} stage={stage} loading={ledger.loading} />
      </Section>
      {stage === 'UNKNOWN' && <HistoricalOpportunityTable items={ledger.episodes} />}
      <CrossChainRouteLedger snapshot={data.chainOpportunities} />
      <CompetitorEvidence snapshot={ledger.competitors} />
      <p className="page-footnote">当前只有链上成交回执与资产增量可记为收益；只读报价、模拟与历史价差均不计收益。</p>
    </div>
  )
}

function StrategyPage({ data, opportunityData, onOpenOpportunity }) {
  const business = data.business
  const overview = data.overview
  const services = business?.portfolio?.services || []
  const baseLive = services.find((service) => service.id === 'base-live')
  const system = data.system
  return (
    <div className="page-stack">
      <PageTitle title="策略" note="查看执行服务、候选机会和信息源覆盖；不能授权、签名或发起交易。" />
      {opportunityData.error && <Notice>原有策略候选暂时不可用，页面会继续重试。</Notice>}
      <section className="service-strip">
        {services.map((service) => (
          <div key={service.id}>
            <span>{service.label}</span>
            <Status value={service.status} />
          </div>
        ))}
        {services.length === 0 && <span>服务状态待核验</span>}
      </section>
      <Section title="Base 实盘执行" side={<Status value={baseLive?.status || 'UNKNOWN'} />}>
        <Notice tone="plain">{baseLiveSummary(baseLive)}</Notice>
      </Section>
      <Section title="跨平台机会">
        <CrossChainOpportunityTable snapshot={data.chainOpportunities} />
      </Section>
      <Section
        title="Robinhood 原有策略机会"
        side={
          <span className="section-summary">
            可执行 {overview?.exactReady ?? '—'} · 接近门槛 {overview?.screenedPositive ?? '—'}
          </span>
        }
      >
        <Notice tone="plain">{noTradeReason(business, overview)}</Notice>
        <OpportunityTable items={opportunityData.items} onOpen={onOpenOpportunity} />
      </Section>
      <Section title="信息源">
        <SourceTable summary={data.sourceSummary} sources={data.sources} />
      </Section>
      <Section title="系统与日报">
        <dl className="fact-grid">
          <div>
            <dt>市场扫描</dt>
            <dd>{humanStatus(overview?.serviceStatus)}</dd>
          </div>
          <div>
            <dt>最近决策</dt>
            <dd>{decisionLabel(business?.strategy?.lastDecision)}</dd>
          </div>
          <div>
            <dt>Earn 执行</dt>
            <dd>{humanStatus(business?.strategy?.earnOnHood?.status)}</dd>
          </div>
          <div>
            <dt>Earn 可用本金</dt>
            <dd>
              {business?.strategy?.earnOnHood
                ? business.strategy.earnOnHood.lastDynamicMaximumPrincipalEth
                  ? `${formatMetric(business.strategy.earnOnHood.lastDynamicMaximumPrincipalEth, 6)} ETH（动态）`
                  : '按钱包余额动态计算'
                : '未接入'}
            </dd>
          </div>
          <div>
            <dt>Earn Gas 安全垫</dt>
            <dd>
              {business?.strategy?.earnOnHood?.lifetimeGasSurplusEth
                ? `${formatMetric(business.strategy.earnOnHood.lifetimeGasSurplusEth, 6)} ETH`
                : '待核验'}
            </dd>
          </div>
          <div>
            <dt>Earn 本轮已确认</dt>
            <dd>
              {business?.strategy?.earnOnHood
                ? `${number(business.strategy.earnOnHood.currentNetEth, 6, true)} ETH · ${business.strategy.earnOnHood.confirmedExecutions ?? '—'} 笔`
                : '待核验'}
            </dd>
          </div>
          <div>
            <dt>飞书日报</dt>
            <dd>{humanStatus(business?.delivery?.status)}</dd>
          </div>
          <div>
            <dt>下次日报</dt>
            <dd>{formatBeijingTime(business?.delivery?.nextReportAt)}</dd>
          </div>
        </dl>
        <details className="technical-details">
          <summary>技术运行信息</summary>
          <dl className="technical-list">
            <div>
              <dt>发布版本</dt>
              <dd>{system?.release ? String(system.release).slice(0, 8) : '待核验'}</dd>
            </div>
            <div>
              <dt>市场快照</dt>
              <dd>{relativeAge(overview?.generatedAt)}</dd>
            </div>
            <div>
              <dt>候选覆盖</dt>
              <dd>
                {overview?.coverageQuality?.freshQuotedTokens ?? '—'} /{' '}
                {overview?.coverageQuality?.candidateTokens ?? '—'}
              </dd>
            </div>
            <div>
              <dt>经营数据保存</dt>
              <dd>{humanStatus(system?.persistence?.status)}</dd>
            </div>
            <div>
              <dt>RPC 自动重试 / 降级</dt>
              <dd>
                {Number(system?.health?.eventDrivenShadow?.consecutiveErrors || 0) > 0 ? '正在自动恢复' : '当前正常'}
              </dd>
            </div>
          </dl>
        </details>
      </Section>
    </div>
  )
}

function Drawer({ title, onClose, children }) {
  const closeButton = useRef(null)
  useEffect(() => {
    const before = /** @type {HTMLElement | null} */ (document.activeElement)
    const close = (event) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', close)
    closeButton.current?.focus()
    return () => {
      window.removeEventListener('keydown', close)
      before?.focus?.()
    }
  }, [onClose])
  return (
    <div
      className="drawer-backdrop"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={title}>
        <div className="drawer-heading">
          <h2>{title}</h2>
          <button ref={closeButton} className="text-button" type="button" onClick={onClose}>
            关闭
          </button>
        </div>
        {children}
      </aside>
    </div>
  )
}

function ActivityDrawer({ item, onClose }) {
  if (!item) return null
  return (
    <Drawer title={activityLabels[item.type] || '交易凭证'} onClose={onClose}>
      <p className="drawer-lead">{item.title}</p>
      <dl className="fact-list">
        <div>
          <dt>时间</dt>
          <dd>{formatBeijingTime(item.occurredAt)}</dd>
        </div>
        <div>
          <dt>链</dt>
          <dd>{item.network}</dd>
        </div>
        <div>
          <dt>金额</dt>
          <dd>{activityAmount(item)}</dd>
        </div>
        <div>
          <dt>经营影响</dt>
          <dd>{activityImpact(item)}</dd>
        </div>
        <div>
          <dt>Gas</dt>
          <dd>{item.gas ? `${exact(item.gas.value)} ETH · ${humanStatus(item.gas.treatment)}` : '不适用'}</dd>
        </div>
        <div>
          <dt>证据</dt>
          <dd>
            {item.evidence?.receipt ? '回执已核验' : '回执待核验'} ·{' '}
            {item.evidence?.balanceEffect ? '余额已核对' : '不含余额核对'}
          </dd>
        </div>
      </dl>
      <details className="technical-details" open>
        <summary>链上凭证</summary>
        <dl className="technical-list">
          <div>
            <dt>交易哈希</dt>
            <dd>
              <code>{item.transactionHash || '待核验'}</code>
            </dd>
          </div>
          <div>
            <dt>区块</dt>
            <dd>{item.blockNumber ?? '待核验'}</dd>
          </div>
        </dl>
        {item.explorerUrl && (
          <a className="button" href={item.explorerUrl} target="_blank" rel="noreferrer">
            在区块浏览器核对
          </a>
        )}
      </details>
    </Drawer>
  )
}

function OpportunityDrawer({ item, onClose }) {
  if (!item) return null
  const state = opportunityStatus(item)
  const claims = [
    [
      '平台来源',
      sourceLabel(item.provenance?.platformAttribution?.platformId),
      item.provenance?.platformAttribution?.status,
    ],
    ['发行协议', sourceLabel(item.provenance?.launchProtocol?.protocolId), item.provenance?.launchProtocol?.status],
    ['流动性场所', sourceLabel(item.provenance?.liquidityVenue?.venueId), item.provenance?.liquidityVenue?.status],
    ['资产类别', assetClassLabel(item.pairClass), item.target?.classification?.status],
  ]
  return (
    <Drawer title={item.target?.symbol || '机会详情'} onClose={onClose}>
      <Status value={state.status} label={state.label} />
      <p className="drawer-lead">{item.routeLabel}</p>
      <Notice tone="plain">{opportunityReason(item)}</Notice>
      <dl className="fact-list">
        <div>
          <dt>初筛净收益</dt>
          <dd>
            {item.quote?.screenedNetUsdg === null ? '待核验' : `${number(item.quote?.screenedNetUsdg, 2, true)} USDG`}
          </dd>
        </div>
        <div>
          <dt>测试金额</dt>
          <dd>{item.quote?.bestSizeBase ? `${exact(item.quote.bestSizeBase)} ${item.quote.baseAsset}` : '待核验'}</dd>
        </div>
        <div>
          <dt>报价时间</dt>
          <dd>{relativeAge(item.quote?.quotedAt)}</dd>
        </div>
      </dl>
      <details className="technical-details">
        <summary>技术信息与完整证据</summary>
        <div className="hash-block">
          <span>资产合约</span>
          <code>{item.target?.address || '待核验'}</code>
        </div>
        <div className="detail-list">
          {claims.map(([label, value, status]) => (
            <div key={label}>
              <span>
                <strong>{label}</strong>
                <small>{value}</small>
              </span>
              <Status value={status || 'UNKNOWN'} />
            </div>
          ))}
        </div>
        {(item.evidenceTimeline || []).length > 0 && (
          <ol className="evidence-list">
            {item.evidenceTimeline.map((evidence) => (
              <li key={`${evidence.claimType}:${evidence.evidenceId}`}>
                {evidenceClaimLabel(evidence.claimType)} · {evidence.label || '核验记录'}
              </li>
            ))}
          </ol>
        )}
      </details>
    </Drawer>
  )
}

export default function App() {
  const [page, setPage] = useState(() => currentPage(window.location.hash))
  const [selectedActivity, setSelectedActivity] = useState(null)
  const [selectedOpportunity, setSelectedOpportunity] = useState(null)
  const detailRequest = useRef(0)
  const closeDrawers = useCallback(() => {
    detailRequest.current += 1
    setSelectedActivity(null)
    setSelectedOpportunity(null)
  }, [])
  const openOpportunity = useCallback(async (summary) => {
    const requestId = detailRequest.current + 1
    detailRequest.current = requestId
    setSelectedOpportunity({ ...summary, evidenceTimeline: [], detailState: 'LOADING' })
    try {
      const detail = await requestJson(`/api/v1/opportunities/${encodeURIComponent(summary.opportunityId)}`)
      if (detailRequest.current === requestId) setSelectedOpportunity({ ...detail, detailState: 'READY' })
    } catch {
      if (detailRequest.current === requestId) {
        setSelectedOpportunity({ ...summary, evidenceTimeline: [], detailState: 'ERROR' })
      }
    }
  }, [])
  const state = useOperationsData()
  const strategyOpportunities = useStrategyOpportunities(page === 'strategy')

  useEffect(() => {
    const update = () => {
      closeDrawers()
      setPage(currentPage(window.location.hash))
    }
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [closeDrawers])

  let content
  if (page === 'activity') {
    content = <ActivityPage business={state.data.business} onOpen={setSelectedActivity} />
  } else if (page === 'portfolio') {
    content = <FundsPage portfolio={state.data.business?.portfolio} />
  } else if (page === 'opportunities') {
    content = <OpportunitiesPage data={state.data} />
  } else if (page === 'strategy') {
    content = (
      <StrategyPage data={state.data} opportunityData={strategyOpportunities} onOpenOpportunity={openOpportunity} />
    )
  } else {
    content = <OverviewPage data={state.data} onOpenActivity={setSelectedActivity} />
  }

  return (
    <div className="app-shell">
      <Header
        page={page}
        business={state.data.business}
        overview={state.data.overview}
        loading={state.loading}
        error={state.error}
      />
      <main className="main" aria-busy={state.loading}>
        {state.error && <Notice tone="danger">经营数据暂时不可用，页面会继续自动重试。</Notice>}
        {state.partial && <Notice>{state.partial}</Notice>}
        {content}
      </main>
      <ActivityDrawer item={selectedActivity} onClose={closeDrawers} />
      <OpportunityDrawer item={selectedOpportunity} onClose={closeDrawers} />
    </div>
  )
}
