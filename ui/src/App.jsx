import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  PAGES,
  assetClassLabel,
  businessHeadline,
  compactAddress,
  currentPage,
  decisionLabel,
  evidenceClaimLabel,
  formatBeijingTime,
  formatMetric,
  humanStatus,
  relativeAge,
  sourceLabel,
  sourceAdapterDescription,
  sourceAdapterLabel,
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

const RADAR_PAGE_SIZE = 50

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

function StatusBadge({ children, status = children }) {
  return <span className={`status-badge status-${toneForStatus(status)}`}>{children}</span>
}

function EmptyState({ eyebrow, title, body }) {
  return (
    <div className="empty-state">
      <span className="section-index">{eyebrow}</span>
      <h3>{title}</h3>
      <p>{body}</p>
    </div>
  )
}

function GlobalHeader({ overview, business, refreshedAt, loading, error }) {
  return (
    <header className="global-header">
      <div className="wordmark">
        <span className="wordmark-mark" aria-hidden="true">
          M/
        </span>
        <div>
          <strong>MANGA RADAR</strong>
          <span>PROVENANCE CONSOLE</span>
        </div>
      </div>
      <div className="header-flags" aria-label="Safety mode">
        <StatusBadge status="CURRENT">私有访问</StatusBadge>
        <StatusBadge status="UNKNOWN">只读</StatusBadge>
      </div>
      <div className="header-telemetry">
        <span>
          扫描 <strong>{business?.market?.candidateTokens ?? overview?.coverage?.candidateTokens ?? '—'}</strong>
        </span>
        <span>
          有效机会 <strong>{overview?.exactReady ?? '—'}</strong>
        </span>
        <span>
          今日成交 <strong>{business?.economics?.today?.confirmedExecutions ?? '—'}</strong>
        </span>
        <span className={error ? 'telemetry-error' : ''}>
          {error
            ? '数据读取异常'
            : loading
              ? '正在同步'
              : `更新于 ${relativeAge(overview?.generatedAt || refreshedAt)} 前`}
        </span>
      </div>
    </header>
  )
}

function Navigation({ page }) {
  return (
    <nav className="side-rail" aria-label="Primary">
      <div className="rail-spine">经营 / 机会 / 成交 / 证据</div>
      <div className="nav-list">
        {PAGES.map((item) => (
          <a
            key={item.id}
            href={`#/${item.id}`}
            className={page === item.id ? 'active' : ''}
            aria-current={page === item.id ? 'page' : undefined}
          >
            <span>{item.index}</span>
            {item.label}
          </a>
        ))}
      </div>
      <div className="rail-safety">
        <span className="pulse-dot" />
        只读面板
        <small>不能授权、签名或发起交易</small>
      </div>
    </nav>
  )
}

function Metric({ label, value, unit = null, note, tone = 'neutral' }) {
  return (
    <article className={`metric metric-${tone}`}>
      <span>{label}</span>
      <strong>
        {value}
        {unit && <small>{unit}</small>}
      </strong>
      <p>{note}</p>
    </article>
  )
}

function TruthLadder({ overview }) {
  const steps = [
    { label: '持续扫描', value: overview?.coverage?.candidateTokens ?? 0, tone: 'neutral' },
    { label: '本轮新鲜报价', value: overview?.freshCandidates ?? 0, tone: 'neutral' },
    { label: '初筛达到门槛', value: overview?.screenedPositive ?? 0, tone: 'proxy' },
    { label: '精确核验通过', value: overview?.exactReady ?? 0, tone: 'verified' },
    { label: '链上确认', value: overview?.confirmed ?? 0, tone: 'verified' },
  ]
  return (
    <section className="truth-ladder" aria-label="Evidence ladder">
      {steps.map((step, index) => (
        <div className={`truth-step truth-${step.tone}`} key={step.label}>
          <span>{String(index + 1).padStart(2, '0')}</span>
          <strong>{step.value}</strong>
          <p>{step.label}</p>
        </div>
      ))}
    </section>
  )
}

function signedMetric(value, digits = 6) {
  if (value === null || value === undefined) return '—'
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return '—'
  return `${numeric >= 0 ? '+' : ''}${formatMetric(numeric, digits)}`
}

function ProfitStrip({ days = [] }) {
  const values = days.map((day) => Math.abs(Number(day.verifiedExecutionNetUsdg || 0)))
  const maximum = Math.max(0.000001, ...values)
  return (
    <section className="profit-strip" aria-label="最近七日已核验交易净利润">
      <div className="panel-heading">
        <div>
          <span className="section-index">最近 7 日 / 北京时间</span>
          <h2>已核验交易净利润</h2>
        </div>
        <small>仅计链上确认、余额效果和交易 Gas</small>
      </div>
      <div className="profit-bars">
        {days.map((day) => {
          const value = Number(day.verifiedExecutionNetUsdg || 0)
          const height = value === 0 ? 4 : Math.max(10, (Math.abs(value) / maximum) * 86)
          return (
            <div className="profit-day" key={day.periodKey}>
              <strong className={value < 0 ? 'negative' : ''}>{signedMetric(value, 3)}</strong>
              <div className="profit-bar-track">
                <span className={value < 0 ? 'negative' : ''} style={{ height: `${height}%` }} />
              </div>
              <small>{day.periodKey.slice(5)}</small>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function CapitalAndDelivery({ business }) {
  const capital = business?.capital
  const delivery = business?.delivery
  return (
    <div className="business-split">
      <section className="capital-board">
        <span className="section-index">可复投资金</span>
        <div className="capital-lines">
          <div>
            <span>USDG 策略</span>
            <strong>{formatMetric(capital?.spendableUsdg, 6)}</strong>
            <small>USDG</small>
          </div>
          <div>
            <span>WETH 策略</span>
            <strong>{formatMetric(capital?.spendableWeth, 6)}</strong>
            <small>WETH</small>
          </div>
        </div>
        <p>
          Gas 最近核验 {formatMetric(capital?.walletGasLastVerifiedEth, 6)} ETH · 安全线{' '}
          {formatMetric(capital?.gasReserveEth, 6)} ETH
          {capital?.walletGasVerifiedAt ? ` · ${formatBeijingTime(capital.walletGasVerifiedAt)}` : ''}
        </p>
      </section>
      <section className="delivery-board">
        <div>
          <span className="section-index">飞书日报</span>
          <StatusBadge status={delivery?.status}>{humanStatus(delivery?.status)}</StatusBadge>
        </div>
        <h2>
          {delivery?.schedule || '09:05'} <small>北京时间</small>
        </h2>
        <p>每天发送前一自然日；失败自动重试，成功后按日期去重。</p>
        <dl>
          <div>
            <dt>上次送达</dt>
            <dd>{formatBeijingTime(delivery?.lastSuccessAt)}</dd>
          </div>
          <div>
            <dt>下次计划</dt>
            <dd>{formatBeijingTime(delivery?.nextReportAt)}</dd>
          </div>
        </dl>
      </section>
    </div>
  )
}

function SourceStrip({ sourceCounts }) {
  const items = [
    ['PAIR 平台列表', sourceCounts?.pairListings],
    ['LONG 路线发行', sourceCounts?.longRoutes],
    ['Doppler 目标', sourceCounts?.dopplerTargets],
    ['已保留池子', sourceCounts?.retainedPools],
  ]
  return (
    <section className="source-strip">
      <div>
        <span className="section-index">来源分开统计</span>
        <p>NINECAT 等 LONG/Doppler 资产不会被归入 PAIR 平台。</p>
      </div>
      {items.map(([label, value]) => (
        <div key={label}>
          <strong>{value ?? '—'}</strong>
          <span>{label}</span>
        </div>
      ))}
    </section>
  )
}

function RecentBusinessExecutions({ items = [] }) {
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <span className="section-index">最近成交</span>
          <h2>像账单一样查看链上交易</h2>
        </div>
        <a className="text-link" href="#/execution">
          查看全部 →
        </a>
      </div>
      {items.length === 0 ? (
        <EmptyState eyebrow="0 笔" title="当前双资产策略尚未成交" body="没有链上回执，就不会显示虚构收益。" />
      ) : (
        <div className="business-ledger">
          {items.slice(0, 5).map((item) => (
            <a
              href={`https://robinhoodchain.blockscout.com/tx/${item.transactionHash}`}
              target="_blank"
              rel="noreferrer"
              key={item.transactionHash}
            >
              <span>{formatBeijingTime(item.confirmedAt)}</span>
              <strong>{item.route}</strong>
              <small>
                {formatMetric(item.amountIn, item.baseAsset === 'WETH' ? 6 : 2)} {item.baseAsset}
              </small>
              <b>{signedMetric(item.verifiedNetUsdg, 6)} U</b>
              <i>查看链上 ↗</i>
            </a>
          ))}
        </div>
      )}
    </section>
  )
}

function OverviewPage({ data, onOpenOpportunity }) {
  const top = data.opportunities.slice(0, 5)
  const business = data.business
  const today = business?.economics?.today
  const active = business?.economics?.activeStrategy
  return (
    <div className="page-stack">
      <section className="hero-band">
        <div>
          <span className="section-index">01 / 经营中枢</span>
          <h1>{businessHeadline(business, data.overview)}</h1>
        </div>
        <div className="hero-copy">
          <StatusBadge status={business?.strategy?.status}>{humanStatus(business?.strategy?.status)}</StatusBadge>
          <p>{decisionLabel(business?.strategy?.lastDecision)}</p>
          <small>价差、精确核验、链上成交和实际净收益始终分开计算。</small>
        </div>
      </section>
      <div className="metric-grid">
        <Metric
          label="今日已核验交易净利润"
          value={signedMetric(today?.verifiedExecutionNetUsdg, 6)}
          unit="USDG"
          note="北京时间自然日；不把未成交价差计入收益"
          tone="verified"
        />
        <Metric
          label="活跃策略累计净利润"
          value={signedMetric(active?.verifiedExecutionNetUsdg, 6)}
          unit="USDG"
          note="仅统计当前 USDG/WETH 双资产授权"
          tone="verified"
        />
        <Metric
          label="今日链上成交"
          value={today?.confirmedExecutions ?? '—'}
          unit="笔"
          note={`USDG ${today?.confirmedByBase?.USDG ?? '—'} / WETH ${today?.confirmedByBase?.WETH ?? '—'}`}
        />
        <Metric
          label="今日失败 Gas"
          value={formatMetric(today?.failedGasEth, 6)}
          unit="ETH"
          note={`${today?.failedTransactions ?? '—'} 笔失败交易；达到熔断线会自动停止`}
          tone={Number(today?.failedGasEth || 0) > 0 ? 'proxy' : 'neutral'}
        />
      </div>
      {!business && <div className="business-pending">经营快照正在建立；机会雷达仍然正常运行，交易权限没有变化。</div>}
      <CapitalAndDelivery business={business} />
      <ProfitStrip days={business?.economics?.lastSevenDays || []} />
      <TruthLadder overview={data.overview} />
      <SourceStrip sourceCounts={business?.market?.sourceCounts} />
      <RecentBusinessExecutions items={business?.recentExecutions} />
      <section className="panel">
        <div className="panel-heading">
          <div>
            <span className="section-index">当前观察 / 前 5 条</span>
            <h2>最值得继续盯的路线</h2>
          </div>
          <a className="text-link" href="#/radar">
            查看完整雷达 →
          </a>
        </div>
        {top.length ? (
          <OpportunityTable items={top} onOpen={onOpenOpportunity} compact />
        ) : (
          <EmptyState
            eyebrow="00"
            title="暂时没有可展示路线"
            body="来源仍在回填，或当前范围内没有满足展示条件的多池资产。"
          />
        )}
      </section>
    </div>
  )
}

function FilterSelect({ label, value, onChange, children }) {
  return (
    <label className="filter-field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {children}
      </select>
    </label>
  )
}

function OpportunityTable({ items, onOpen, compact = false }) {
  return (
    <div className="table-shell">
      <table className="opportunity-table">
        <thead>
          <tr>
            <th>资产与路线</th>
            <th>建议测试金额</th>
            <th>观察到的净价差</th>
            <th>来源</th>
            <th>流动性</th>
            <th>当前状态</th>
            <th>
              <span className="sr-only">Open detail</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.opportunityId}>
              <td>
                <strong className="token-symbol">{item.target.symbol}</strong>
                <span className="route-label">{item.routeLabel}</span>
                <code>{compactAddress(item.target.address)}</code>
              </td>
              <td className="numeric">
                {item.quote.bestSizeBase
                  ? `${formatMetric(item.quote.bestSizeBase, item.quote.baseAsset === 'WETH' ? 6 : 2)} ${item.quote.baseAsset}`
                  : '—'}
              </td>
              <td className={`numeric net-${toneForStatus(item.axes.quote)}`}>
                {item.quote.screenedNetUsdg === null
                  ? '—'
                  : `${Number(item.quote.screenedNetUsdg) >= 0 ? '+' : ''}${formatMetric(item.quote.screenedNetUsdg, 4)} U`}
              </td>
              <td>
                <StatusBadge status={item.provenance.platformAttribution.status}>
                  {sourceLabel(item.provenance.platformAttribution.platformId)}
                </StatusBadge>
                <small>{humanStatus(item.provenance.platformAttribution.status)}</small>
              </td>
              <td>
                <span>{sourceLabel(item.provenance.launchProtocol.protocolId)}</span>
                <small>{sourceLabel(item.provenance.liquidityVenue.venueId)}</small>
              </td>
              <td>
                <StatusBadge status={item.axes.quote}>{humanStatus(item.axes.quote)}</StatusBadge>
                <small>{item.axes.quote === 'STALE' ? '不能进入执行' : '等待下一层核验'}</small>
              </td>
              <td>
                <button
                  className="row-action"
                  type="button"
                  onClick={() => onOpen(item)}
                  aria-label={`查看 ${item.target.symbol} 的证据`}
                >
                  ↗
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!compact && items.length === 0 && (
        <EmptyState
          eyebrow="00"
          title="没有符合筛选条件的路线"
          body="当前筛选条件下没有结果；UNKNOWN 与 CONFLICTED 不会被静默归入其他来源。"
        />
      )}
    </div>
  )
}

function RadarPage({ opportunities, onOpen }) {
  const [filters, setFilters] = useState({ query: '', platform: '', protocol: '', quote: '', attribution: '' })
  const [pageIndex, setPageIndex] = useState(0)
  const filtered = useMemo(
    () =>
      opportunities.filter((item) => {
        const haystack = `${item.target.symbol} ${item.target.address} ${item.routeLabel} ${item.quoteAssets
          .flatMap((asset) => [asset.symbol, asset.address])
          .join(' ')}`.toLowerCase()
        if (filters.query && !haystack.includes(filters.query.toLowerCase())) return false
        if (filters.platform && item.provenance.platformAttribution.platformId !== filters.platform) return false
        if (filters.protocol && item.provenance.launchProtocol.protocolId !== filters.protocol) return false
        if (filters.quote && item.axes.quote !== filters.quote) return false
        if (filters.attribution && item.axes.attribution !== filters.attribution) return false
        return true
      }),
    [filters, opportunities],
  )
  const pageCount = Math.max(1, Math.ceil(filtered.length / RADAR_PAGE_SIZE))
  const currentPageIndex = Math.min(pageIndex, pageCount - 1)
  const visible = filtered.slice(currentPageIndex * RADAR_PAGE_SIZE, (currentPageIndex + 1) * RADAR_PAGE_SIZE)
  const update = (key) => (value) => {
    setFilters((before) => ({ ...before, [key]: value }))
    setPageIndex(0)
  }
  return (
    <div className="page-stack">
      <section className="page-title">
        <span className="section-index">02 / 机会雷达</span>
        <h1>哪些路线值得继续盯</h1>
        <p>
          当前显示 {filtered.length} / {opportunities.length} 条。平台来源、发行协议和流动性场所分别核验，不混为一谈。
        </p>
      </section>
      <section className="filter-bar" aria-label="Opportunity filters">
        <label className="filter-field filter-search">
          <span>搜索</span>
          <input
            value={filters.query}
            onChange={(event) => update('query')(event.target.value)}
            placeholder="代币、地址或路线"
          />
        </label>
        <FilterSelect label="来源路线" value={filters.platform} onChange={update('platform')}>
          <option value="">全部</option>
          <option value="LONG_ROUTE">LONG 路线</option>
          <option value="UNATTRIBUTED_CHAIN">其他链上池</option>
          <option value="PAIR">PAIR 平台</option>
        </FilterSelect>
        <FilterSelect label="发行协议" value={filters.protocol} onChange={update('protocol')}>
          <option value="">全部</option>
          <option value="DOPPLER">Doppler</option>
          <option value="UNKNOWN">待核验</option>
        </FilterSelect>
        <FilterSelect label="报价状态" value={filters.quote} onChange={update('quote')}>
          <option value="">全部</option>
          <option value="FRESH_PROXY_POSITIVE">新鲜价差</option>
          <option value="FRESH_NO_EDGE">无有效价差</option>
          <option value="UNQUOTED">尚未报价</option>
          <option value="STALE">已过期</option>
        </FilterSelect>
        <FilterSelect label="来源证据" value={filters.attribution} onChange={update('attribution')}>
          <option value="">全部</option>
          <option value="CHAIN_ATTESTED">链上已核验</option>
          <option value="UNKNOWN">待核验</option>
          <option value="CONFLICTED">证据冲突</option>
        </FilterSelect>
      </section>
      <OpportunityTable items={visible} onOpen={onOpen} />
      {filtered.length > RADAR_PAGE_SIZE && (
        <nav className="pagination" aria-label="Radar pages">
          <button
            type="button"
            onClick={() => setPageIndex(Math.max(0, currentPageIndex - 1))}
            disabled={currentPageIndex === 0}
          >
            ← 上一页
          </button>
          <span>
            第 {currentPageIndex + 1} / {pageCount} 页 · 第 {currentPageIndex * RADAR_PAGE_SIZE + 1}–
            {Math.min((currentPageIndex + 1) * RADAR_PAGE_SIZE, filtered.length)}
          </span>
          <button
            type="button"
            onClick={() => setPageIndex(Math.min(pageCount - 1, currentPageIndex + 1))}
            disabled={currentPageIndex === pageCount - 1}
          >
            下一页 →
          </button>
        </nav>
      )}
    </div>
  )
}

function SourcesPage({ sources, summary }) {
  return (
    <div className="page-stack">
      <section className="page-title">
        <span className="section-index">03 / 来源覆盖</span>
        <h1>平台、路线与协议分开看</h1>
        <p>每个来源独立核验；一个来源完整，不代表其他来源也已经完整。</p>
      </section>
      <div className="ops-grid">
        <Metric label="PAIR 平台列表" value={summary?.pairListings ?? '—'} note="只代表 PAIR 官方列表证据" />
        <Metric label="LONG 路线" value={summary?.longLaunches ?? '—'} note="来自 LONG Launcher 的发行事件" />
        <Metric
          label="Doppler 目标"
          value={summary?.dopplerTargetsDiscovered ?? '—'}
          note={`${summary?.dopplerLaunches ?? '—'} 个当前可见发行记录`}
        />
        <Metric label="已保留池子" value={summary?.genericPools ?? '—'} note="只保留与已发现目标资产有关的流动性池" />
      </div>
      <div className="source-grid">
        {sources.map((source) => (
          <article className="source-module" key={source.adapterId}>
            <div className="source-head">
              <span>独立数据源</span>
              <StatusBadge status={source.status}>{humanStatus(source.status)}</StatusBadge>
            </div>
            <h2>{sourceAdapterLabel(source.adapterId)}</h2>
            <p>{sourceAdapterDescription(source.adapterId)}</p>
            <dl>
              <div>
                <dt>最近成功</dt>
                <dd>{source.lastSuccessAt ? `${relativeAge(source.lastSuccessAt)} 前` : '尚未成功'}</dd>
              </div>
              <div>
                <dt>链上进度</dt>
                <dd>
                  {source.lagBlocks === null || source.lagBlocks === undefined
                    ? '不适用'
                    : Number(source.lagBlocks) === 0
                      ? '已追到安全区块'
                      : `落后 ${source.lagBlocks} 区块`}
                </dd>
              </div>
              <div>
                <dt>覆盖方式</dt>
                <dd>{source.configuredStartBlock ? '从配置边界持续回填' : '平台当前快照'}</dd>
              </div>
              <div>
                <dt>异常</dt>
                <dd>{source.lastError ? '有，系统已降级处理' : '无'}</dd>
              </div>
            </dl>
          </article>
        ))}
        {sources.length === 0 && <EmptyState eyebrow="00" title="来源状态尚未建立" body="等待第一份持久化来源快照。" />}
      </div>
    </div>
  )
}

function EpisodesPage({ episodes }) {
  return (
    <div className="page-stack">
      <section className="page-title">
        <span className="section-index">04 / 机会窗口</span>
        <h1>价差持续了多久</h1>
        <p>报价过期或暂不可报价时只表示无法继续确认，不会擅自判定机会已经关闭。</p>
      </section>
      {episodes.length === 0 ? (
        <EmptyState
          eyebrow="00"
          title="尚无持续价差窗口"
          body="只有新鲜且达到初筛门槛的价差才会开始计时；没有记录不等于市场绝无机会。"
        />
      ) : (
        <div className="ledger-list">
          {episodes.map((episode) => (
            <article key={episode.episodeId}>
              <StatusBadge status={episode.state}>{humanStatus(episode.state)}</StatusBadge>
              <strong>{episode.lastPositiveRoute || '路线待核验'}</strong>
              <span>
                {formatBeijingTime(episode.openedAt)} 开始 · 最近观察净价差{' '}
                {signedMetric(episode.lastPositiveNetUsdg, 4)} USDG
              </span>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}

function ExecutionPage({ business }) {
  const businessExecutions = business?.recentExecutions || []
  return (
    <div className="page-stack">
      <section className="page-title">
        <span className="section-index">05 / 链上账单</span>
        <h1>每一笔钱去了哪里</h1>
        <p>只展示已经拿到链上回执并核对余额效果的交易；点击可直接在 Blockscout 查看。</p>
      </section>
      <div className="safety-ribbon">
        <strong>只读账单</strong>
        <span>这里不能部署、授权、签名、交易或提现，也不会暴露原始签名数据。</span>
      </div>
      {businessExecutions.length === 0 ? (
        <EmptyState eyebrow="0 笔" title="当前没有可展示的成交" body="观察到的价差不能替代链上回执和余额变化。" />
      ) : (
        <div className="business-ledger business-ledger-full">
          {businessExecutions.map((item) => (
            <a
              href={`https://robinhoodchain.blockscout.com/tx/${item.transactionHash}`}
              target="_blank"
              rel="noreferrer"
              key={item.transactionHash}
            >
              <span>{formatBeijingTime(item.confirmedAt)}</span>
              <strong>{item.route}</strong>
              <small>
                {formatMetric(item.amountIn, item.baseAsset === 'WETH' ? 6 : 2)} {item.baseAsset}
              </small>
              <b>{signedMetric(item.verifiedNetUsdg, 6)} USDG</b>
              <i>查看链上 ↗</i>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}

function SystemPage({ system, overview }) {
  const persistence = system?.persistence
  const shadow = system?.health?.eventDrivenShadow
  const transport = shadow?.rpcTransport
  const rpcTotals = shadow?.quoteRpcTotals
  const backoff = Number(shadow?.consecutiveErrors || 0)
  return (
    <div className="page-stack">
      <section className="page-title">
        <span className="section-index">06 / 运行状态</span>
        <h1>服务是否真的在工作</h1>
        <p>这里展示服务与证据状态，不把进程存活解释为成交。</p>
      </section>
      <div className="ops-grid">
        <Metric
          label="扫描服务"
          value={humanStatus(overview?.serviceStatus)}
          note="持续发现和报价候选路线"
          tone={toneForStatus(overview?.serviceStatus)}
        />
        <Metric
          label="经营数据"
          value={humanStatus(persistence?.status)}
          note={`已保存 ${persistence?.evidenceRecords ?? '—'} 条证据 · 一致性 ${persistence?.parity === true ? '正常' : '待核验'}`}
          tone={toneForStatus(persistence?.status)}
        />
        <Metric label="链上数据源" value="公共 RPC" note="可能限流；出现异常时系统自动降级或等待恢复" tone="proxy" />
        <Metric label="面板权限" value="只读" note="面板进程没有私钥，也不能发送交易" tone="verified" />
      </div>
      <section className="system-sheet">
        <div>
          <span>当前版本</span>
          <strong>{system?.release ? String(system.release).slice(0, 8) : '待核验'}</strong>
        </div>
        <div>
          <span>市场快照</span>
          <strong>{overview?.generatedAt ? `${relativeAge(overview.generatedAt)} 前更新` : '待核验'}</strong>
        </div>
        <div>
          <span>待处理路线</span>
          <strong>{shadow?.pendingCandidates ?? '待核验'}</strong>
        </div>
        <div>
          <span>持久化证据</span>
          <strong>{persistence?.evidenceRecords ?? '待核验'} 条</strong>
        </div>
        <div>
          <span>事件到报价</span>
          <strong>
            {shadow?.lastEventToQuoteMs === null || shadow?.lastEventToQuoteMs === undefined
              ? '待核验'
              : `${shadow.lastEventToQuoteMs} 毫秒`}
          </strong>
        </div>
        <div>
          <span>RPC 当前状态</span>
          <strong>{backoff > 0 ? `自动退避中（连续 ${backoff} 次）` : '正常'}</strong>
        </div>
        <div>
          <span>RPC 请求方式</span>
          <strong>{transport?.activeMode === 'INDIVIDUAL_FALLBACK' ? '独立请求降级' : '批量请求'}</strong>
        </div>
        <div>
          <span>RPC 自动重试 / 降级</span>
          <strong>
            {rpcTotals?.rpcLogicalRetries ?? '待核验'} / {rpcTotals?.rpcBatchFallbacks ?? '待核验'} 次
          </strong>
        </div>
      </section>
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
      previouslyFocused?.focus()
    }
  }, [item, onClose])
  if (!item) return null
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
      <aside
        className="evidence-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-title"
        onKeyDown={(event) => {
          if (event.key === 'Tab') {
            event.preventDefault()
            closeButton.current?.focus()
          }
        }}
      >
        <button ref={closeButton} className="drawer-close" type="button" onClick={onClose} aria-label="关闭证据面板">
          ×
        </button>
        <span className="section-index">逐项核验证据</span>
        <h2 id="drawer-title">
          {item.target.symbol} <small>/ {item.quoteAssets.map((asset) => asset.symbol).join(' · ') || '待核验'}</small>
        </h2>
        <code className="drawer-address">{item.target.address}</code>
        <div className="claim-matrix">
          {claims.map(([label, value, status]) => (
            <div key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
              <StatusBadge status={status}>{humanStatus(status)}</StatusBadge>
            </div>
          ))}
        </div>
        <div className="drawer-section">
          <h3>证据时间线</h3>
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
        </div>
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
      const detail = await requestJson(`/api/v1/opportunities/${encodeURIComponent(summary.opportunityId)}`, undefined)
      if (detailRequest.current === requestId) setSelected({ ...detail, detailState: 'READY' })
    } catch {
      if (detailRequest.current === requestId) {
        setSelected({ ...summary, evidenceTimeline: [], detailState: 'ERROR' })
      }
    }
  }, [])
  const state = useConsoleData()
  useEffect(() => {
    const update = () => setPage(currentPage(window.location.hash))
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [])
  let content
  if (page === 'radar') content = <RadarPage opportunities={state.data.opportunities} onOpen={openOpportunity} />
  else if (page === 'sources') {
    content = <SourcesPage sources={state.data.sources} summary={state.data.sourceSummary} />
  } else if (page === 'episodes') content = <EpisodesPage episodes={state.data.episodes} />
  else if (page === 'execution') {
    content = <ExecutionPage business={state.data.business} />
  } else if (page === 'system') content = <SystemPage system={state.data.system} overview={state.data.overview} />
  else content = <OverviewPage data={state.data} onOpenOpportunity={openOpportunity} />

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
          <div className="error-banner" role="alert">
            <strong>经营数据暂时不可用</strong>
            <span>系统会继续自动重试；该状态不代表发生了成交或资金变化。</span>
          </div>
        )}
        {content}
      </main>
      <EvidenceDrawer item={selected} onClose={closeDrawer} />
    </div>
  )
}
