import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BASE_BOOTSTRAP_RECEIPT,
  PAGES,
  assetClassLabel,
  businessHeadline,
  compactAddress,
  currentPage,
  evidenceClaimLabel,
  formatBeijingTime,
  formatMetric,
  humanStatus,
  noTradeReason,
  opportunityLane,
  opportunityReason,
  portfolioMoneyMap,
  relativeAge,
  sortOpportunitiesForOperator,
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
  episodes: [],
  system: null,
  business: null,
}

const OPPORTUNITY_PAGE_SIZE = 20

async function requestJson(path, signal) {
  const response = await fetch(path, { headers: { accept: 'application/json' }, signal })
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`)
  return response.json()
}

async function requestOptionalJson(path, signal) {
  const response = await fetch(path, { headers: { accept: 'application/json' }, signal })
  if ([404, 503].includes(response.status)) return null
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`)
  return response.json()
}

function useConsoleData() {
  const [state, setState] = useState({ data: emptyData, loading: true, error: null, refreshedAt: null })
  useEffect(() => {
    let mounted = true
    let controller = null
    const load = async () => {
      controller?.abort()
      controller = new AbortController()
      try {
        const [overview, opportunities, sources, episodes, system, business] = await Promise.all([
          requestJson('/api/v1/overview', controller.signal),
          requestJson('/api/v1/opportunities', controller.signal),
          requestJson('/api/v1/sources', controller.signal),
          requestJson('/api/v1/episodes', controller.signal),
          requestJson('/api/v1/system', controller.signal),
          requestOptionalJson('/api/v1/business', controller.signal),
        ])
        if (!mounted) return
        setState({
          data: {
            overview,
            opportunities: opportunities.items || [],
            sources: sources.items || [],
            sourceSummary: sources.summary || null,
            episodes: episodes.items || [],
            system,
            business,
          },
          loading: false,
          error: null,
          refreshedAt: new Date().toISOString(),
        })
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
  }, [])
  return state
}

function primaryNumber(value, { digits = 2, signed = false } = {}) {
  if (value === null || value === undefined || value === '') return '—'
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return '—'
  const absolute = Math.abs(numeric)
  const sign = numeric < 0 ? '−' : signed && numeric > 0 ? '+' : ''
  const threshold = 10 ** -digits
  if (absolute > 0 && absolute < threshold) return `${sign}<${formatMetric(threshold, digits)}`
  return `${sign}${formatMetric(absolute, digits)}`
}

function exactNumber(value, digits = 6) {
  if (value === null || value === undefined || value === '') return '待核验'
  return formatMetric(value, digits)
}

function StatusBadge({ children, status = children }) {
  return <span className={`status-badge status-${toneForStatus(status)}`}>{children}</span>
}

function EmptyState({ title, body, action = null }) {
  return (
    <div className="empty-state">
      <span className="empty-mark" aria-hidden="true" />
      <h3>{title}</h3>
      <p>{body}</p>
      {action}
    </div>
  )
}

function GlobalHeader({ overview, business, refreshedAt, loading, error }) {
  const services = business?.portfolio?.services || []
  const serviceHealthy =
    business?.strategy?.status === 'RUNNING' &&
    ['HEALTHY', 'SCANNING', 'RUNNING'].includes(business?.market?.status) &&
    services.length === 2 &&
    services.every((service) => service.status === 'RUNNING')
  const coverageLimited = ['LIMITED', 'DEGRADED'].includes(overview?.coverageQuality?.status)
  const label = error
    ? '数据读取异常'
    : loading
      ? '正在同步数据'
      : !serviceHealthy
        ? '运行状态需检查'
        : coverageLimited
          ? '服务运行中 · 覆盖有限'
          : '自动策略运行中'
  return (
    <header className="global-header">
      <a className="wordmark" href="#/overview" aria-label="返回总览">
        <span className="wordmark-mark" aria-hidden="true">
          M
        </span>
        <span>
          <strong>套利经营台</strong>
          <small>BASE + ROBINHOOD</small>
        </span>
      </a>
      <div className={`live-state ${error || !serviceHealthy || coverageLimited ? 'live-state-warning' : ''}`}>
        <span className="live-dot" aria-hidden="true" />
        <strong>{label}</strong>
        <small>{loading ? '请稍候' : relativeAge(overview?.generatedAt || refreshedAt)}</small>
      </div>
      <div className="privacy-note">
        <strong>公网 · 只读</strong>
        <span>只展示链上公开数据</span>
      </div>
    </header>
  )
}

function Navigation({ page }) {
  return (
    <nav className="side-rail" aria-label="主要页面">
      <div className="nav-intro">
        <span>经营视角</span>
        <p>先看结果，再看证据</p>
      </div>
      <div className="nav-list">
        {PAGES.map((item) => (
          <a
            key={item.id}
            href={`#/${item.id}`}
            className={page === item.id ? 'active' : ''}
            aria-current={page === item.id ? 'page' : undefined}
          >
            <span className="nav-index">{item.index}</span>
            <span className="nav-copy">
              <strong>{item.label}</strong>
              <small>{item.description}</small>
            </span>
          </a>
        ))}
      </div>
      <div className="rail-safety">
        <span className="shield-mark" aria-hidden="true" />
        <div>
          <strong>交易权限已隔离</strong>
          <small>不能授权、签名或发起交易</small>
        </div>
      </div>
    </nav>
  )
}

function PageHeading({ eyebrow, title, body, aside = null }) {
  return (
    <section className="page-heading">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{body}</p>
      </div>
      {aside}
    </section>
  )
}

function ExactValue({ label = '查看精确值', children }) {
  return (
    <details className="exact-value">
      <summary>{label}</summary>
      <div>{children}</div>
    </details>
  )
}

function ResultHero({ business, overview }) {
  const active = business?.economics?.activeStrategy
  return (
    <section className="result-hero">
      <div className="result-hero-copy">
        <div className="hero-status-row">
          <span className="eyebrow">当前自动策略</span>
          <StatusBadge status={business?.strategy?.status}>{humanStatus(business?.strategy?.status)}</StatusBadge>
        </div>
        <h1>{businessHeadline(business, overview)}</h1>
        <p>{noTradeReason(business, overview)}</p>
        <div className="hero-actions">
          <a className="button button-primary" href="#/opportunities">
            查看机会原因
          </a>
          <a className="button button-secondary" href="#/execution">
            核对成交账单
          </a>
        </div>
      </div>
      <div className="strategy-result">
        <span>本策略累计已确认净收益</span>
        <strong>{primaryNumber(active?.verifiedExecutionNetUsdg, { signed: true })}</strong>
        <b>USDG</b>
        <p>当前策略启动后 {active?.confirmedExecutions ?? '—'} 笔成交</p>
        <ExactValue>
          {exactNumber(active?.verifiedExecutionNetUsdg)} USDG · 失败 Gas {exactNumber(active?.failedGasEth)} ETH
        </ExactValue>
      </div>
    </section>
  )
}

function SummaryCards({ business, overview }) {
  const today = business?.economics?.today
  const capital = business?.capital
  const gasBalance = Number(capital?.walletGasLastVerifiedEth)
  const gasReserve = Number(capital?.gasReserveEth)
  const gasHealthy = Number.isFinite(gasBalance) && Number.isFinite(gasReserve) && gasBalance >= gasReserve
  return (
    <section className="summary-grid" aria-label="今日经营摘要">
      <article className="summary-card summary-card-profit">
        <span>今天全部已确认收益</span>
        <strong>
          {primaryNumber(today?.verifiedExecutionNetUsdg, { signed: true })} <small>USDG</small>
        </strong>
        <p>共 {today?.confirmedExecutions ?? '—'} 笔；包含当前策略启动前的历史策略成交。</p>
        <ExactValue>{exactNumber(today?.verifiedExecutionNetUsdg)} USDG</ExactValue>
      </article>
      <article className="summary-card">
        <span>当前可复投资金</span>
        <div className="capital-pair">
          <strong>
            {primaryNumber(capital?.spendableUsdg)} <small>USDG</small>
          </strong>
          <strong>
            {primaryNumber(capital?.spendableWeth, { digits: 4 })} <small>WETH</small>
          </strong>
        </div>
        <p>两种本金分别循环，不把 WETH 伪装成 USDG。</p>
        <ExactValue>
          {exactNumber(capital?.spendableUsdg)} USDG · {exactNumber(capital?.spendableWeth)} WETH
        </ExactValue>
      </article>
      <article className="summary-card">
        <span>当前可执行机会</span>
        <strong>
          {overview?.exactReady ?? '—'} <small>条</small>
        </strong>
        <p>
          {overview?.screenedPositive ?? '—'} 条接近门槛 · {overview?.freshCandidates ?? '—'} 条最新报价
        </p>
        <small className="summary-footnote">
          当前授权已触发 {business?.strategy?.exactPreflights ?? '—'} 次成交前精确核验
        </small>
        <a className="inline-link" href="#/opportunities">
          查看筛选过程
        </a>
      </article>
      <article className={`summary-card ${gasHealthy ? '' : 'summary-card-warning'}`}>
        <span>Gas 安全垫</span>
        <strong className="textual-number">{gasHealthy ? '余额充足' : '需要补充'}</strong>
        <p>
          最近核验 {primaryNumber(capital?.walletGasLastVerifiedEth, { digits: 4 })} ETH，安全线{' '}
          {primaryNumber(capital?.gasReserveEth, { digits: 4 })} ETH。
        </p>
        <ExactValue>{exactNumber(capital?.walletGasLastVerifiedEth)} ETH</ExactValue>
      </article>
    </section>
  )
}

function OpportunityFunnel({ overview }) {
  const funnel = overview?.funnel || {}
  const coverage = overview?.coverageQuality || {}
  const stages = [
    ['发现池子', funnel.discoveredPools, '来自各独立信息源'],
    ['组成多池目标', funnel.multiPoolTargets, '至少两个可比较池'],
    ['进入策略候选', funnel.admittedCandidates, '通过结构校验和上限'],
    ['当前新鲜结果', funnel.freshQuotes, '报价或失败仍在有效期'],
    ['初筛净收益为正', funnel.proxyPositive, '已扣 Gas 估算'],
    ['成交前核验通过', funnel.exactReady, '才允许进入签名路径'],
  ]
  return (
    <section className="panel funnel-panel">
      <div className="panel-heading funnel-heading">
        <div>
          <span className="eyebrow">机会漏斗</span>
          <h2>池子很多，不等于此刻有可成交利润</h2>
        </div>
        <StatusBadge status={coverage.status}>{humanStatus(coverage.status)}</StatusBadge>
      </div>
      <div className="funnel-flow" aria-label="套利机会筛选漏斗">
        {stages.map(([label, value, note], index) => (
          <article key={label} className={index >= 4 ? 'funnel-decision-stage' : ''}>
            <span>{label}</span>
            <strong>{value ?? '—'}</strong>
            <small>{note}</small>
          </article>
        ))}
      </div>
      <div className="coverage-explanation">
        <p>
          当前新鲜报价覆盖 <strong>{coverage.freshQuotedTokens ?? '—'}</strong> /{' '}
          <strong>{coverage.candidateTokens ?? '—'}</strong> 条候选（{coverage.freshCoveragePct ?? '—'}%）。
        </p>
        <p>
          当前自动执行器可直接支持约 <strong>{funnel.executorShapeCandidates ?? '—'}</strong>{' '}
          个多池目标；其他池型先只做报价观察，不会直接获得实盘权限。
        </p>
      </div>
    </section>
  )
}

function ProfitChart({ days = [] }) {
  const values = days.map((day) => Number(day.verifiedExecutionNetUsdg || 0))
  const maximum = Math.max(0.01, ...values.map(Math.abs))
  return (
    <section className="panel profit-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">最近 7 天</span>
          <h2>每天实际赚了多少</h2>
        </div>
        <small>北京时间 · 已扣成功交易 Gas</small>
      </div>
      <div className="profit-bars">
        {days.map((day) => {
          const value = Number(day.verifiedExecutionNetUsdg || 0)
          const height = value === 0 ? 3 : Math.max(8, (Math.abs(value) / maximum) * 100)
          return (
            <div className="profit-day" key={day.periodKey}>
              <strong className={value < 0 ? 'negative' : ''}>{primaryNumber(value, { signed: true })}</strong>
              <div className="profit-bar-track">
                <span className={value < 0 ? 'negative' : ''} style={{ height: `${height}%` }} />
              </div>
              <small>{day.periodKey.slice(5).replace('-', '/')}</small>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function RecentExecutions({ items = [], limit = 4 }) {
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">最近成交</span>
          <h2>像银行账单一样核对</h2>
        </div>
        <a className="inline-link" href="#/execution">
          查看全部账单
        </a>
      </div>
      {items.length === 0 ? (
        <EmptyState title="还没有成交记录" body="只有拿到链上回执并核对余额的交易，才会出现在这里。" />
      ) : (
        <div className="execution-list execution-list-compact">
          {items.slice(0, limit).map((item) => (
            <ExecutionRow item={item} key={item.transactionHash} />
          ))}
        </div>
      )}
    </section>
  )
}

function ExecutionRow({ item }) {
  return (
    <article className="execution-row">
      <div className="execution-main">
        <span>{formatBeijingTime(item.confirmedAt)}</span>
        <strong>{item.route}</strong>
        <small>
          投入 {primaryNumber(item.amountIn, { digits: item.baseAsset === 'WETH' ? 4 : 2 })} {item.baseAsset}
        </small>
      </div>
      <div className="execution-profit">
        <span>已确认净收益</span>
        <strong>
          {primaryNumber(item.verifiedNetUsdg, { signed: true })} <small>USDG</small>
        </strong>
      </div>
      <details className="receipt-details">
        <summary>查看明细</summary>
        <dl>
          <div>
            <dt>毛收益</dt>
            <dd>
              {exactNumber(item.grossProfitBase)} {item.baseAsset}
            </dd>
          </div>
          <div>
            <dt>Gas 折算</dt>
            <dd>{exactNumber(item.gasMarkedUsdg)} USDG</dd>
          </div>
          <div>
            <dt>Gas 原值</dt>
            <dd>{exactNumber(item.gasEth)} ETH</dd>
          </div>
          <div>
            <dt>交易凭证</dt>
            <dd>
              <code>{compactAddress(item.transactionHash)}</code>
            </dd>
          </div>
        </dl>
        <a
          className="button button-secondary button-small"
          href={`https://robinhoodchain.blockscout.com/tx/${item.transactionHash}`}
          target="_blank"
          rel="noreferrer"
        >
          在区块浏览器核对
        </a>
      </details>
    </article>
  )
}

function DeliveryCard({ delivery }) {
  return (
    <section className="delivery-card">
      <div>
        <span className="eyebrow">飞书日报</span>
        <StatusBadge status={delivery?.status}>
          {delivery?.status === 'CONNECTED' ? '送达正常' : '等待首次送达'}
        </StatusBadge>
      </div>
      <h2>每天 {delivery?.schedule || '09:05'} 自动汇报</h2>
      <p>只发送真正影响经营判断的内容：净收益、成交、失败 Gas、可用资金和运行状态。</p>
      <div className="delivery-times">
        <span>
          上次送达 <strong>{formatBeijingTime(delivery?.lastSuccessAt)}</strong>
        </span>
        <span>
          下次计划 <strong>{formatBeijingTime(delivery?.nextReportAt)}</strong>
        </span>
      </div>
    </section>
  )
}

function PortfolioGlance({ portfolio }) {
  if (!portfolio) {
    return <div className="notice notice-warning">双链资金快照正在建立，暂不把未知余额显示成零。</div>
  }
  return (
    <section className={`portfolio-glance portfolio-glance-${toneForStatus(portfolio.status)}`}>
      <div>
        <span className="eyebrow">资金雷达</span>
        <h2>现在盯住 {portfolio.summary.watchedObjects} 个钱包与合约</h2>
        <p>
          {portfolio.summary.activeObjects} 个持续运行，{portfolio.summary.parkedObjects} 个等待资金归集。
        </p>
      </div>
      <div className="parked-balance">
        <span>旧合约待归集</span>
        <strong>{primaryNumber(portfolio.summary.parkedUsdg)}</strong>
        <small>USDG</small>
      </div>
      <a className="button button-primary" href="#/portfolio">
        查看全部资金
      </a>
    </section>
  )
}

function OverviewPage({ data }) {
  const business = data.business
  return (
    <div className="page-stack">
      <ResultHero business={business} overview={data.overview} />
      {!business && <div className="notice notice-warning">经营快照正在建立，交易权限没有变化。</div>}
      <PortfolioGlance portfolio={business?.portfolio} />
      <SummaryCards business={business} overview={data.overview} />
      <OpportunityFunnel overview={data.overview} />
      <div className="overview-split">
        <ProfitChart days={business?.economics?.lastSevenDays || []} />
        <DeliveryCard delivery={business?.delivery} />
      </div>
      <RecentExecutions items={business?.recentExecutions || []} />
    </div>
  )
}

function accountPrimaryBalance(account) {
  return account?.assets?.find((asset) => asset.symbol === account.primaryAsset) || null
}

function accountSecondaryBalances(account) {
  return (account?.assets || []).filter(
    (asset) => asset.symbol !== account.primaryAsset && asset.amount !== null && Number(asset.amount) !== 0,
  )
}

function PortfolioAccount({ account }) {
  const primary = accountPrimaryBalance(account)
  const secondary = accountSecondaryBalances(account)
  const displayStatus =
    account.monitoringState === 'PARKED' && account.status === 'VERIFIED' ? 'PARKED' : account.status
  return (
    <article className={`account-card ${account.monitoringState === 'PARKED' ? 'account-card-parked' : ''}`}>
      <div className="account-heading">
        <div>
          <span>{account.kind === 'WALLET' ? '钱包' : '合约'}</span>
          <h3>{account.label}</h3>
        </div>
        <StatusBadge status={displayStatus}>{humanStatus(displayStatus)}</StatusBadge>
      </div>
      <div className="account-balance">
        <span>{account.monitoringState === 'PARKED' ? '当前待归集' : '当前主要余额'}</span>
        <strong>
          {primaryNumber(primary?.amount, { digits: account.primaryAsset === 'USDG' ? 2 : 6 })}
          <small>{account.primaryAsset}</small>
        </strong>
      </div>
      {secondary.length > 0 && (
        <p className="secondary-balance">
          另有 {secondary.map((asset) => `${primaryNumber(asset.amount, { digits: 6 })} ${asset.symbol}`).join(' · ')}
        </p>
      )}
      {Number(account.pendingTransactions || 0) > 0 && (
        <p className="pending-callout">有 {account.pendingTransactions} 笔交易等待链上确认</p>
      )}
      <details className="account-details">
        <summary>查看地址与链上记录</summary>
        <div>
          <code>{account.address}</code>
          <span>身份核验：{humanStatus(account.checks?.identity)}</span>
          <a href={account.explorerUrl} target="_blank" rel="noreferrer">
            打开区块浏览器
          </a>
        </div>
      </details>
    </article>
  )
}

function NetworkPortfolio({ network, accounts }) {
  const visibleTotals = Object.entries(network.all || {}).filter(
    ([, amount]) => amount !== null && Number(amount) !== 0,
  )
  return (
    <section className="panel network-portfolio">
      <div className="panel-heading network-heading">
        <div>
          <span className="eyebrow">{network.id === 'BASE' ? '低成本执行链' : 'MANGA 主策略链'}</span>
          <h2>{network.label}</h2>
        </div>
        <div className="network-totals">
          {visibleTotals.map(([symbol, amount]) => (
            <span key={symbol}>
              <strong>{primaryNumber(amount, { digits: symbol === 'USDG' ? 2 : 6 })}</strong> {symbol}
            </span>
          ))}
        </div>
      </div>
      <div className={`account-grid account-grid-${accounts.length}`}>
        {accounts.map((account) => (
          <PortfolioAccount account={account} key={account.id} />
        ))}
      </div>
    </section>
  )
}

function StrategyServices({ services = [] }) {
  return (
    <section className="strategy-service-grid" aria-label="双链策略运行状态">
      {services.map((service) => (
        <article key={service.id}>
          <span className={`state-light state-${toneForStatus(service.status)}`} />
          <div>
            <span>{service.label}</span>
            <strong>{humanStatus(service.status)}</strong>
            {service.id === 'base-live' && (
              <small>
                已确认收益 {primaryNumber(service.verifiedNetEth, { digits: 6 })} ETH · 最近检查{' '}
                {service.routesChecked ?? '—'} 条路线
              </small>
            )}
          </div>
        </article>
      ))}
    </section>
  )
}

function CurrentFundsOverview({ portfolio }) {
  const money = portfolioMoneyMap(portfolio)
  const baseStatus = portfolio.networks.find((network) => network.id === 'BASE')?.status
  const robinhoodStatus = portfolio.networks.find((network) => network.id === 'ROBINHOOD')?.status
  return (
    <section className="funds-overview" aria-label="当前资金全景">
      <div className="funds-overview-heading">
        <div>
          <span className="eyebrow">当前资金全景</span>
          <h2>钱分在两条链，不再靠记地址</h2>
          <p>ETH、WETH 和 USDG 分开显示，不用临时价格拼成一个容易误导的总数。</p>
        </div>
        <div className="funds-count">
          <strong>{portfolio.summary.watchedObjects}</strong>
          <span>处已纳入追踪</span>
        </div>
      </div>
      <div className="funds-chain-grid">
        <article className="funds-chain funds-chain-base">
          <header>
            <div>
              <span>BASE</span>
              <h3>低成本执行资金</h3>
            </div>
            <StatusBadge status={baseStatus}>{humanStatus(baseStatus)}</StatusBadge>
          </header>
          <div className="funds-chain-assets">
            <div>
              <span>Gas 钱包</span>
              <strong>{primaryNumber(money.base.walletEth, { digits: 6 })}</strong>
              <small>ETH</small>
            </div>
            <div>
              <span>执行合约</span>
              <strong>{primaryNumber(money.base.executorWeth, { digits: 6 })}</strong>
              <small>WETH</small>
            </div>
          </div>
          <p>前者支付交易手续费，后者才是循环套利的本金。</p>
        </article>
        <article className="funds-chain funds-chain-robinhood">
          <header>
            <div>
              <span>ROBINHOOD CHAIN</span>
              <h3>主策略与历史资金</h3>
            </div>
            <StatusBadge status={robinhoodStatus}>{humanStatus(robinhoodStatus)}</StatusBadge>
          </header>
          <div className="funds-chain-assets funds-chain-assets-three">
            <div>
              <span>Gas 钱包</span>
              <strong>{primaryNumber(money.robinhood.walletEth, { digits: 6 })}</strong>
              <small>ETH</small>
            </div>
            <div>
              <span>运行中本金</span>
              <strong>{primaryNumber(money.robinhood.activeUsdg)}</strong>
              <small>USDG</small>
            </div>
            <div>
              <span>运行中本金</span>
              <strong>{primaryNumber(money.robinhood.activeWeth, { digits: 6 })}</strong>
              <small>WETH</small>
            </div>
          </div>
          <p>
            USDG 合计 {primaryNumber(money.robinhood.totalUsdg)}；其中 {primaryNumber(money.robinhood.parkedUsdg)} USDG
            仍在旧合约等待归集。
          </p>
        </article>
      </div>
    </section>
  )
}

function BaseBootstrapReceipt() {
  return (
    <section className="bootstrap-receipt">
      <div className="bootstrap-receipt-heading">
        <div>
          <span className="eyebrow">Base 首笔入金 · 已完整对账</span>
          <h2>你转入的 0.01 ETH，部署完成后去了这三处</h2>
          <p>这是历史入金凭证；上方资金全景显示的是当前链上余额。</p>
        </div>
        <a
          className="button button-secondary"
          href={BASE_BOOTSTRAP_RECEIPT.fundingTransactionUrl}
          target="_blank"
          rel="noreferrer"
        >
          核对入金交易
        </a>
      </div>
      <div className="bootstrap-flow" aria-label="0.01 Base ETH 资金去向">
        <article>
          <span>留在 Gas 钱包</span>
          <strong>{BASE_BOOTSTRAP_RECEIPT.walletEthAfterBootstrap}</strong>
          <small>ETH · 随时支付执行手续费</small>
        </article>
        <article>
          <span>进入执行合约</span>
          <strong>{BASE_BOOTSTRAP_RECEIPT.executorWethAfterBootstrap}</strong>
          <small>WETH · 实盘循环本金</small>
        </article>
        <article className="bootstrap-gas">
          <span>部署与初始化</span>
          <strong>{BASE_BOOTSTRAP_RECEIPT.deploymentAndInitializationGasEth}</strong>
          <small>ETH · 已消耗 Gas</small>
        </article>
      </div>
      <div className="bootstrap-proof">
        <strong>三部分合计 = {BASE_BOOTSTRAP_RECEIPT.depositedEth} ETH</strong>
        <span>部署完成时没有未解释差额；后续变化以上方当前余额为准。</span>
        <a href={BASE_BOOTSTRAP_RECEIPT.deploymentTransactionUrl} target="_blank" rel="noreferrer">
          查看部署凭证
        </a>
      </div>
    </section>
  )
}

function PortfolioPage({ portfolio }) {
  if (!portfolio) {
    return (
      <div className="page-stack">
        <PageHeading
          eyebrow="资金"
          title="正在建立双链资金快照"
          body="任何读取失败都会显示为待核验，不会被当作零余额。"
        />
        <EmptyState title="资金快照暂不可用" body="自动交易不依赖这个只读页面，系统会在下一次经营快照继续重试。" />
      </div>
    )
  }
  return (
    <div className="page-stack">
      <PageHeading
        eyebrow="资金"
        title="本套利项目的钱，现在分布在这里"
        body={`覆盖 Base 与 Robinhood Chain 共 ${portfolio.summary.watchedObjects} 个钱包或合约。钱包负责 Gas，活跃合约负责循环本金，旧合约保留到资金归集完成。`}
        aside={
          <div className="heading-result">
            <span>等待归集</span>
            <strong>{portfolio.summary.parkedObjects}</strong>
            <small>个</small>
          </div>
        }
      />
      <CurrentFundsOverview portfolio={portfolio} />
      <BaseBootstrapReceipt />
      <div className="portfolio-rule">
        <strong>日常重点：{portfolio.summary.activeObjects} 个</strong>
        <span>
          另外 {portfolio.summary.parkedObjects} 个旧合约合计还有 {primaryNumber(portfolio.summary.parkedUsdg)}{' '}
          USDG；归集完成前不能隐藏。
        </span>
      </div>
      {portfolio.networks.map((network) => (
        <NetworkPortfolio
          network={network}
          accounts={portfolio.accounts.filter((account) => account.networkId === network.id)}
          key={network.id}
        />
      ))}
      <StrategyServices services={portfolio.services} />
      <div className="read-only-note">
        <strong>公网只读资金页</strong>
        <span>这里只展示公开地址、余额、合约身份和待确认交易；不会连接钱包、授权、签名或发起提现。</span>
      </div>
    </div>
  )
}

function stageMeta(stage) {
  if (stage === 'executable') return { label: '可以执行', title: '已经通过成交前精确核验', tone: 'verified' }
  if (stage === 'near') return { label: '接近门槛', title: '初筛有价差，等待最终核验', tone: 'proxy' }
  return { label: '继续观察', title: '还没有形成可执行机会', tone: 'neutral' }
}

function OpportunityCard({ item, onOpen }) {
  const stage = opportunityLane(item)
  const meta = stageMeta(stage)
  const quoteIsCurrent = ['FRESH_PROXY_POSITIVE', 'FRESH_NO_EDGE'].includes(item.axes.quote)
  return (
    <article className={`opportunity-card opportunity-${meta.tone}`}>
      <div className="opportunity-identity">
        <StatusBadge status={item.axes.quote}>{meta.label}</StatusBadge>
        <span>{sourceLabel(item.provenance.platformAttribution.platformId)}</span>
      </div>
      <h2>{item.target.symbol}</h2>
      <p className="route-copy">{item.routeLabel}</p>
      <p className="opportunity-reason">{opportunityReason(item)}</p>
      <div className="opportunity-values">
        <div>
          <span>{quoteIsCurrent ? '初筛净收益' : '当前结果'}</span>
          <strong>
            {quoteIsCurrent && item.quote.screenedNetUsdg !== null
              ? `${primaryNumber(item.quote.screenedNetUsdg, { signed: true })} USDG`
              : humanStatus(item.axes.quote)}
          </strong>
        </div>
        <div>
          <span>测试金额</span>
          <strong>
            {item.quote.bestSizeBase
              ? `${primaryNumber(item.quote.bestSizeBase, { digits: item.quote.baseAsset === 'WETH' ? 4 : 2 })} ${item.quote.baseAsset}`
              : '待核验'}
          </strong>
        </div>
      </div>
      <button className="button button-secondary" type="button" onClick={() => onOpen(item)}>
        查看为什么
      </button>
    </article>
  )
}

function OpportunitiesPage({ opportunities, overview, business, onOpen }) {
  const [stage, setStage] = useState('executable')
  const [query, setQuery] = useState('')
  const [pageIndex, setPageIndex] = useState(0)
  const groups = useMemo(
    () => ({
      executable: opportunities.filter((item) => opportunityLane(item) === 'executable'),
      near: opportunities.filter((item) => opportunityLane(item) === 'near'),
      watching: sortOpportunitiesForOperator(opportunities),
    }),
    [opportunities],
  )
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return groups[stage]
    return groups[stage].filter((item) =>
      `${item.target.symbol} ${item.target.name} ${item.routeLabel}`.toLowerCase().includes(normalized),
    )
  }, [groups, query, stage])
  const pageCount = Math.max(1, Math.ceil(filtered.length / OPPORTUNITY_PAGE_SIZE))
  const currentPageIndex = Math.min(pageIndex, pageCount - 1)
  const visible = filtered.slice(
    currentPageIndex * OPPORTUNITY_PAGE_SIZE,
    (currentPageIndex + 1) * OPPORTUNITY_PAGE_SIZE,
  )
  const selectStage = (next) => {
    setStage(next)
    setPageIndex(0)
    setQuery('')
  }
  return (
    <div className="page-stack">
      <PageHeading
        eyebrow="机会"
        title="只看离成交最近的路线"
        body={`扫描数量不是机会数量。这里按“可以执行、接近门槛、继续观察”分层，避免把 ${overview?.coverage?.candidateTokens ?? '全部'} 条候选池误当成同等数量的套利机会。`}
        aside={
          <div className="heading-result">
            <span>当前可执行</span>
            <strong>{overview?.exactReady ?? '—'}</strong>
            <small>条</small>
          </div>
        }
      />
      <section className="stage-switcher" aria-label="机会阶段">
        <button
          type="button"
          className={stage === 'executable' ? 'active' : ''}
          onClick={() => selectStage('executable')}
        >
          <span>可以执行</span>
          <strong>{groups.executable.length}</strong>
          <small>已通过最终核验</small>
        </button>
        <button type="button" className={stage === 'near' ? 'active' : ''} onClick={() => selectStage('near')}>
          <span>接近门槛</span>
          <strong>{groups.near.length}</strong>
          <small>只有初筛价差</small>
        </button>
        <button type="button" className={stage === 'watching' ? 'active' : ''} onClick={() => selectStage('watching')}>
          <span>全部观察</span>
          <strong>{groups.watching.length}</strong>
          <small>包含历史与过期报价</small>
        </button>
      </section>
      {stage === 'watching' && (
        <label className="search-field">
          <span>搜索资产或路线</span>
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setPageIndex(0)
            }}
            placeholder="例如 MANGA、NINECAT、TSLA"
          />
        </label>
      )}
      {visible.length === 0 ? (
        <EmptyState
          title={
            stage === 'executable'
              ? '当前没有可以执行的机会'
              : stage === 'near'
                ? '当前没有接近门槛的路线'
                : '没有找到匹配路线'
          }
          body={
            stage === 'executable'
              ? noTradeReason(business, overview)
              : '系统仍在后台持续扫描；没有结果不代表服务停止。'
          }
          action={
            stage !== 'watching' ? (
              <button type="button" className="button button-secondary" onClick={() => selectStage('watching')}>
                查看全部观察
              </button>
            ) : null
          }
        />
      ) : (
        <section className="opportunity-grid" aria-live="polite">
          {visible.map((item) => (
            <OpportunityCard item={item} onOpen={onOpen} key={item.opportunityId} />
          ))}
        </section>
      )}
      {filtered.length > OPPORTUNITY_PAGE_SIZE && (
        <nav className="pagination" aria-label="机会列表翻页">
          <button
            type="button"
            onClick={() => setPageIndex(Math.max(0, currentPageIndex - 1))}
            disabled={currentPageIndex === 0}
          >
            上一页
          </button>
          <span>
            第 {currentPageIndex + 1} / {pageCount} 页
          </span>
          <button
            type="button"
            onClick={() => setPageIndex(Math.min(pageCount - 1, currentPageIndex + 1))}
            disabled={currentPageIndex === pageCount - 1}
          >
            下一页
          </button>
        </nav>
      )}
    </div>
  )
}

function ExecutionPage({ business }) {
  const today = business?.economics?.today
  const allTime = business?.economics?.allTime
  const items = business?.recentExecutions || []
  return (
    <div className="page-stack">
      <PageHeading
        eyebrow="账单"
        title="每一笔收益都有链上凭证"
        body="首页先给两位小数，这里可以展开精确值、Gas 和交易凭证。没有回执的价差不会进入账单。"
      />
      <section className="ledger-summary">
        <div>
          <span>今天已确认</span>
          <strong>
            {primaryNumber(today?.verifiedExecutionNetUsdg, { signed: true })} <small>USDG</small>
          </strong>
          <p>{today?.confirmedExecutions ?? '—'} 笔成交</p>
        </div>
        <div>
          <span>历史累计已确认</span>
          <strong>
            {primaryNumber(allTime?.verifiedExecutionNetUsdg, { signed: true })} <small>USDG</small>
          </strong>
          <p>{allTime?.confirmedExecutions ?? '—'} 笔成交</p>
        </div>
        <div>
          <span>今天失败成本</span>
          <strong>
            {primaryNumber(today?.failedGasEth)} <small>ETH</small>
          </strong>
          <p>{today?.failedTransactions ?? '—'} 笔失败交易</p>
        </div>
      </section>
      <div className="read-only-note">
        <strong>只读账单</strong>
        <span>点击“查看明细”只会展开凭证，不会连接钱包或发起交易。</span>
      </div>
      {items.length === 0 ? (
        <EmptyState title="当前没有可展示的成交" body="观察到的价差不能替代链上回执和余额变化。" />
      ) : (
        <section className="execution-list">
          {items.map((item) => (
            <ExecutionRow item={item} key={item.transactionHash} />
          ))}
        </section>
      )}
    </div>
  )
}

function SourceCoverage({ summary, sources }) {
  const counts = [
    ['PAIR 平台', summary?.pairListings, '只统计 PAIR 官方列表'],
    ['LONG 路线', summary?.longLaunches, '单独统计 LONG 发行路线'],
    ['Doppler 协议', summary?.dopplerTargetsDiscovered, '识别协议创建的目标资产'],
    ['链上流动性池', summary?.genericPools, '不等同于任何平台归属'],
  ]
  return (
    <section className="panel source-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">数据来源</span>
          <h2>平台、发行路线和池子分开统计</h2>
        </div>
      </div>
      <div className="source-callout">
        <strong>NINECAT 不属于 PAIR 平台</strong>
        <p>它会按 LONG / Doppler 或其他链上证据归类，不会因为同样使用股票或 meme 配对，就被并入 PAIR。</p>
        <p>
          这些来源现已共同进入候选图；其中 <strong>{summary?.strategyGraph?.sourceOnlyMultiPoolTargets ?? '—'}</strong>{' '}
          个多池目标来自 PAIR API 之外。
        </p>
      </div>
      <div className="source-counts">
        {counts.map(([label, value, note]) => (
          <article key={label}>
            <span>{label}</span>
            <strong>{value ?? '—'}</strong>
            <p>{note}</p>
          </article>
        ))}
      </div>
      <details className="technical-details">
        <summary>查看各数据源运行情况</summary>
        <div className="source-health-list">
          {sources.map((source) => (
            <div key={source.adapterId}>
              <span>
                <strong>{sourceAdapterLabel(source.adapterId)}</strong>
                <small>{sourceAdapterDescription(source.adapterId)}</small>
              </span>
              <StatusBadge status={source.status}>{humanStatus(source.status)}</StatusBadge>
            </div>
          ))}
        </div>
      </details>
    </section>
  )
}

function SystemSummary({ system, overview }) {
  const persistence = system?.persistence
  const shadow = system?.health?.eventDrivenShadow
  const transport = shadow?.rpcTransport
  const backoff = Number(shadow?.consecutiveErrors || 0)
  const realtimeLag = Number(shadow?.headLagBlocks)
  const realtimeHealthy =
    Number.isFinite(realtimeLag) && realtimeLag <= Number(shadow?.limits?.eventMaxLagBlocks || 500)
  const coverage = overview?.coverageQuality
  return (
    <section className="panel system-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">系统</span>
          <h2>现在是否真的在工作</h2>
        </div>
      </div>
      <div className="plain-status-grid">
        <article>
          <span className={`state-light state-${toneForStatus(coverage?.status)}`} />
          <div>
            <strong>{humanStatus(coverage?.status)}</strong>
            <p>全市场候选覆盖</p>
          </div>
        </article>
        <article>
          <span className={`state-light state-${toneForStatus(overview?.serviceStatus)}`} />
          <div>
            <strong>{humanStatus(overview?.serviceStatus)}</strong>
            <p>市场扫描服务</p>
          </div>
        </article>
        <article>
          <span className={`state-light state-${toneForStatus(persistence?.status)}`} />
          <div>
            <strong>{humanStatus(persistence?.status)}</strong>
            <p>经营数据保存</p>
          </div>
        </article>
        <article>
          <span className={`state-light ${backoff > 0 || !realtimeHealthy ? 'state-proxy' : 'state-verified'}`} />
          <div>
            <strong>{backoff > 0 ? '自动恢复中' : realtimeHealthy ? '实时跟随' : '正在追赶'}</strong>
            <p>链上事件监听</p>
          </div>
        </article>
        <article>
          <span className="state-light state-verified" />
          <div>
            <strong>权限隔离</strong>
            <p>面板只能读取</p>
          </div>
        </article>
      </div>
      <details className="technical-details">
        <summary>查看技术运行信息</summary>
        <dl className="technical-list">
          <div>
            <dt>当前版本</dt>
            <dd>{system?.release ? String(system.release).slice(0, 8) : '待核验'}</dd>
          </div>
          <div>
            <dt>市场快照</dt>
            <dd>{relativeAge(overview?.generatedAt)}</dd>
          </div>
          <div>
            <dt>待处理路线</dt>
            <dd>{shadow?.pendingCandidates ?? '待核验'}</dd>
          </div>
          <div>
            <dt>已保存证据</dt>
            <dd>{persistence?.evidenceRecords ?? '待核验'} 条</dd>
          </div>
          <div>
            <dt>请求方式</dt>
            <dd>{transport?.activeMode === 'INDIVIDUAL_FALLBACK' ? '单独请求降级' : '批量请求'}</dd>
          </div>
          <div>
            <dt>RPC 自动重试 / 降级</dt>
            <dd>{backoff > 0 ? `连续 ${backoff} 次异常` : '当前无需降级'}</dd>
          </div>
          <div>
            <dt>实时事件位置</dt>
            <dd>{realtimeHealthy ? '靠近最新区块' : '正在恢复到最新区块'}</dd>
          </div>
          <div>
            <dt>最近完成的周期扫描</dt>
            <dd>{relativeAge(coverage?.lastPeriodicAt)}</dd>
          </div>
          <div>
            <dt>当前新鲜候选覆盖</dt>
            <dd>
              {coverage?.freshQuotedTokens ?? '—'} / {coverage?.candidateTokens ?? '—'}
            </dd>
          </div>
        </dl>
      </details>
    </section>
  )
}

function MorePage({ data }) {
  return (
    <div className="page-stack">
      <PageHeading
        eyebrow="更多"
        title="需要时，再查看来源与系统"
        body="这些信息用于解释数据从哪里来、服务是否健康；它们不会挤占总览，也不会被误当成收益或成交。"
      />
      <DeliveryCard delivery={data.business?.delivery} />
      <SourceCoverage summary={data.sourceSummary} sources={data.sources} />
      <SystemSummary system={data.system} overview={data.overview} />
    </div>
  )
}

function EvidenceDrawer({ item, onClose }) {
  const closeButton = useRef(null)
  useEffect(() => {
    if (!item) return undefined
    const previouslyFocused = /** @type {HTMLElement | null} */ (document.activeElement)
    const close = (event) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', close)
    closeButton.current?.focus()
    return () => {
      window.removeEventListener('keydown', close)
      previouslyFocused?.focus?.()
    }
  }, [item, onClose])
  if (!item) return null
  const stage = opportunityLane(item)
  const meta = stageMeta(stage)
  const timeline = item.evidenceTimeline || []
  const claims = [
    [
      '平台来源',
      sourceLabel(item.provenance.platformAttribution.platformId),
      item.provenance.platformAttribution.status,
    ],
    ['创建入口', '尚未独立核验', item.provenance.launchFrontend.status],
    ['发行协议', sourceLabel(item.provenance.launchProtocol.protocolId), item.provenance.launchProtocol.status],
    ['流动性场所', sourceLabel(item.provenance.liquidityVenue.venueId), item.provenance.liquidityVenue.status],
    ['资产类别', assetClassLabel(item.pairClass), item.target.classification.status],
    ['报价状态', humanStatus(item.axes.quote), item.axes.quote],
    ['执行状态', humanStatus(item.axes.execution), item.axes.execution],
  ]
  return (
    <div
      className="drawer-backdrop"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <aside className="evidence-drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title">
        <button ref={closeButton} className="drawer-close" type="button" onClick={onClose} aria-label="关闭详情">
          关闭
        </button>
        <StatusBadge status={item.axes.quote}>{meta.label}</StatusBadge>
        <h2 id="drawer-title">{item.target.symbol}</h2>
        <p className="drawer-route">{item.routeLabel}</p>
        <section className="why-card">
          <span>{stage === 'executable' ? '当前执行状态' : '为什么没有成交'}</span>
          <h3>{meta.title}</h3>
          <p>{opportunityReason(item)}</p>
        </section>
        <dl className="plain-facts">
          <div>
            <dt>发现来源</dt>
            <dd>{sourceLabel(item.provenance.platformAttribution.platformId)}</dd>
          </div>
          <div>
            <dt>初筛净收益</dt>
            <dd>
              {item.quote.screenedNetUsdg === null
                ? '待核验'
                : `${primaryNumber(item.quote.screenedNetUsdg, { signed: true })} USDG`}
            </dd>
          </div>
          <div>
            <dt>测试金额</dt>
            <dd>
              {item.quote.bestSizeBase
                ? `${primaryNumber(item.quote.bestSizeBase, { digits: item.quote.baseAsset === 'WETH' ? 4 : 2 })} ${item.quote.baseAsset}`
                : '待核验'}
            </dd>
          </div>
          <div>
            <dt>报价时间</dt>
            <dd>{relativeAge(item.quote.quotedAt)}</dd>
          </div>
        </dl>
        <p className="automatic-note">系统会继续自动观察；这个面板不需要、也不能手动下单。</p>
        <details className="technical-details drawer-technical">
          <summary>查看技术信息与完整证据</summary>
          <div className="address-block">
            <span>资产合约</span>
            <code>{item.target.address}</code>
          </div>
          <div className="claim-matrix">
            {claims.map(([label, value, status]) => (
              <div key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
                <StatusBadge status={status}>{humanStatus(status)}</StatusBadge>
              </div>
            ))}
          </div>
          <div className="exact-quote">
            <span>初筛精确净收益</span>
            <code>{item.quote.screenedNetUsdg ?? '待核验'} USDG</code>
          </div>
          <h3>证据记录</h3>
          {item.detailState === 'LOADING' ? (
            <p className="muted">正在读取完整证据…</p>
          ) : item.detailState === 'ERROR' ? (
            <p className="source-error">完整证据读取失败，当前保留概要信息。</p>
          ) : timeline.length === 0 ? (
            <p className="muted">尚未关联不可变证据记录。</p>
          ) : (
            <ol className="evidence-timeline">
              {timeline.map((evidence) => (
                <li key={`${evidence.claimType}:${evidence.evidenceId}`}>
                  <span>{evidenceClaimLabel(evidence.claimType)}</span>
                  <strong>{evidence.label || '核验记录'}</strong>
                  <small>{evidence.blockNumber ? `链上区块 ${evidence.blockNumber}` : '平台快照'}</small>
                </li>
              ))}
            </ol>
          )}
        </details>
      </aside>
    </div>
  )
}

export default function App() {
  const [page, setPage] = useState(() => currentPage(window.location.hash))
  const [selected, setSelected] = useState(null)
  const detailRequest = useRef(0)
  const closeDrawer = useCallback(() => {
    detailRequest.current += 1
    setSelected(null)
  }, [])
  const openOpportunity = useCallback(async (summary) => {
    const requestId = detailRequest.current + 1
    detailRequest.current = requestId
    setSelected({ ...summary, evidenceTimeline: [], detailState: 'LOADING' })
    try {
      const detail = await requestJson(`/api/v1/opportunities/${encodeURIComponent(summary.opportunityId)}`)
      if (detailRequest.current === requestId) setSelected({ ...detail, detailState: 'READY' })
    } catch {
      if (detailRequest.current === requestId) {
        setSelected({ ...summary, evidenceTimeline: [], detailState: 'ERROR' })
      }
    }
  }, [])
  const state = useConsoleData()
  useEffect(() => {
    const update = () => {
      closeDrawer()
      setPage(currentPage(window.location.hash))
    }
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [closeDrawer])

  let content
  if (page === 'portfolio') {
    content = <PortfolioPage portfolio={state.data.business?.portfolio} />
  } else if (page === 'opportunities') {
    content = (
      <OpportunitiesPage
        opportunities={state.data.opportunities}
        overview={state.data.overview}
        business={state.data.business}
        onOpen={openOpportunity}
      />
    )
  } else if (page === 'execution') {
    content = <ExecutionPage business={state.data.business} />
  } else if (page === 'more') {
    content = <MorePage data={state.data} />
  } else {
    content = <OverviewPage data={state.data} />
  }

  return (
    <div className="console-shell">
      <GlobalHeader
        overview={state.data.overview}
        business={state.data.business}
        refreshedAt={state.refreshedAt}
        loading={state.loading}
        error={state.error}
      />
      <Navigation page={page} />
      <main className="workspace" aria-busy={state.loading}>
        {state.error && (
          <div className="notice notice-danger" role="alert">
            <strong>经营数据暂时不可用</strong>
            <span>系统会继续自动重试；这不代表发生了成交或资金变化。</span>
          </div>
        )}
        {content}
      </main>
      <EvidenceDrawer item={selected} onClose={closeDrawer} />
    </div>
  )
}
