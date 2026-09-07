import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  PAGES,
  compactAddress,
  currentPage,
  economicHeadline,
  formatMetric,
  relativeAge,
  toneForStatus,
} from './view-model.mjs'

const emptyData = {
  overview: null,
  opportunities: [],
  sources: [],
  sourceSummary: null,
  episodes: [],
  executions: [],
  system: null,
}

const RADAR_PAGE_SIZE = 50

async function requestJson(path, signal) {
  const response = await fetch(path, { headers: { accept: 'application/json' }, signal })
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
        const [overview, opportunities, sources, episodes, executions, system] = await Promise.all([
          requestJson('/api/v1/overview', controller.signal),
          requestJson('/api/v1/opportunities', controller.signal),
          requestJson('/api/v1/sources', controller.signal),
          requestJson('/api/v1/episodes', controller.signal),
          requestJson('/api/v1/executions', controller.signal),
          requestJson('/api/v1/system', controller.signal),
        ])
        if (!mounted) return
        setState({
          data: {
            overview,
            opportunities: opportunities.items || [],
            sources: sources.items || [],
            sourceSummary: sources.summary || null,
            episodes: episodes.items || [],
            executions: executions.items || [],
            system,
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

function GlobalHeader({ overview, refreshedAt, loading, error }) {
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
        <StatusBadge status="CURRENT">PRIVATE</StatusBadge>
        <StatusBadge status="UNKNOWN">READ ONLY</StatusBadge>
      </div>
      <div className="header-telemetry">
        <span>
          FRESH <strong>{overview?.freshCandidates ?? '—'}</strong>
        </span>
        <span>
          PROXY+ <strong>{overview?.screenedPositive ?? '—'}</strong>
        </span>
        <span>
          EXACT <strong>{overview?.exactReady ?? '—'}</strong>
        </span>
        <span className={error ? 'telemetry-error' : ''}>
          {error ? 'DATA ERROR' : loading ? 'SYNCING' : `DATA ${relativeAge(overview?.generatedAt || refreshedAt)} OLD`}
        </span>
      </div>
    </header>
  )
}

function Navigation({ page }) {
  return (
    <nav className="side-rail" aria-label="Primary">
      <div className="rail-spine">EVIDENCE / ECONOMICS / EXECUTION</div>
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
        NO SIGNER
        <small>UI cannot arm or broadcast</small>
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
    { label: 'Discovered', value: overview?.coverage?.candidateTokens ?? 0, tone: 'neutral' },
    { label: 'Fresh quote', value: overview?.freshCandidates ?? 0, tone: 'neutral' },
    { label: 'Screened proxy+', value: overview?.screenedPositive ?? 0, tone: 'proxy' },
    { label: 'Exact-ready', value: overview?.exactReady ?? 0, tone: 'verified' },
    { label: 'Confirmed', value: overview?.confirmed ?? 0, tone: 'verified' },
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

function OverviewPage({ data, onOpenOpportunity }) {
  const top = data.opportunities.slice(0, 5)
  return (
    <div className="page-stack">
      <section className="hero-band">
        <div>
          <span className="section-index">01 / CURRENT SIGNAL</span>
          <h1>{economicHeadline(data.overview)}</h1>
        </div>
        <p>代理利润、精确预检、链上收据与已核验净收益是四个独立事实。面板不会把“看起来有价差”升级成“已经赚钱”。</p>
      </section>
      <div className="metric-grid">
        <Metric
          label="SCREENED PROXY"
          value={data.overview?.screenedPositive ?? '—'}
          note="固定区块报价减 Gas 代理，不是可执行保证"
          tone="proxy"
        />
        <Metric
          label="EXACT READY"
          value={data.overview?.exactReady ?? '—'}
          note="当前执行器 eth_call 与 gas estimate 已通过"
          tone="verified"
        />
        <Metric
          label="CONFIRMED"
          value={data.overview?.confirmed ?? '—'}
          note="存在 canonical receipt；不自动等于净收益"
        />
        <Metric
          label="REALIZED NET"
          value={formatMetric(data.overview?.realizedNetUsdg, 4)}
          unit="U"
          note="收据、余额效果与 Gas 估值均已核验"
          tone="verified"
        />
      </div>
      <TruthLadder overview={data.overview} />
      <section className="panel">
        <div className="panel-heading">
          <div>
            <span className="section-index">LIVE RADAR / TOP 5</span>
            <h2>Highest-signal routes</h2>
          </div>
          <a className="text-link" href="#/radar">
            OPEN FULL RADAR →
          </a>
        </div>
        {top.length ? (
          <OpportunityTable items={top} onOpen={onOpenOpportunity} compact />
        ) : (
          <EmptyState
            eyebrow="00"
            title="No source-aware candidates yet"
            body="适配器仍在回填，或当前范围内没有达到展示条件的多池资产。"
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
            <th>Target / route</th>
            <th>Best size</th>
            <th>Screened net</th>
            <th>Platform route</th>
            <th>Protocol / venue</th>
            <th>Truth state</th>
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
                {item.quote.bestSizeUsdg ? `${formatMetric(item.quote.bestSizeUsdg)} U` : '—'}
              </td>
              <td className={`numeric net-${toneForStatus(item.axes.quote)}`}>
                {item.quote.screenedNetUsdg === null
                  ? '—'
                  : `${Number(item.quote.screenedNetUsdg) >= 0 ? '+' : ''}${formatMetric(item.quote.screenedNetUsdg, 4)} U`}
              </td>
              <td>
                <StatusBadge status={item.provenance.platformAttribution.status}>
                  {item.provenance.platformAttribution.platformId || 'UNKNOWN'}
                </StatusBadge>
                <small>{item.provenance.platformAttribution.status}</small>
              </td>
              <td>
                <span>{item.provenance.launchProtocol.protocolId}</span>
                <small>{item.provenance.liquidityVenue.venueId}</small>
              </td>
              <td>
                <StatusBadge status={item.axes.quote}>{item.axes.quote}</StatusBadge>
                <small>{item.pairClass}</small>
              </td>
              <td>
                <button
                  className="row-action"
                  type="button"
                  onClick={() => onOpen(item)}
                  aria-label={`Inspect ${item.target.symbol}`}
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
          title="No matching route"
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
        <span className="section-index">02 / ROUTE RADAR</span>
        <h1>Source-aware opportunity field</h1>
        <p>
          {filtered.length} visible / {opportunities.length} observed. Platform, protocol and venue are independent
          filters.
        </p>
      </section>
      <section className="filter-bar" aria-label="Opportunity filters">
        <label className="filter-field filter-search">
          <span>SEARCH</span>
          <input
            value={filters.query}
            onChange={(event) => update('query')(event.target.value)}
            placeholder="symbol / address / route"
          />
        </label>
        <FilterSelect label="PLATFORM ROUTE" value={filters.platform} onChange={update('platform')}>
          <option value="">All</option>
          <option value="LONG_ROUTE">LONG route</option>
          <option value="UNATTRIBUTED_CHAIN">Unattributed chain</option>
          <option value="PAIR">PAIR</option>
        </FilterSelect>
        <FilterSelect label="PROTOCOL" value={filters.protocol} onChange={update('protocol')}>
          <option value="">All</option>
          <option value="DOPPLER">Doppler</option>
          <option value="UNKNOWN">Unknown</option>
        </FilterSelect>
        <FilterSelect label="QUOTE STATE" value={filters.quote} onChange={update('quote')}>
          <option value="">All</option>
          <option value="FRESH_PROXY_POSITIVE">Proxy positive</option>
          <option value="FRESH_NO_EDGE">No edge</option>
          <option value="UNQUOTED">Unquoted</option>
          <option value="STALE">Stale</option>
        </FilterSelect>
        <FilterSelect label="PROOF" value={filters.attribution} onChange={update('attribution')}>
          <option value="">All</option>
          <option value="CHAIN_ATTESTED">Chain-attested</option>
          <option value="UNKNOWN">Unknown</option>
          <option value="CONFLICTED">Conflicted</option>
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
            ← PREV
          </button>
          <span>
            PAGE {currentPageIndex + 1} / {pageCount} · ROWS {currentPageIndex * RADAR_PAGE_SIZE + 1}–
            {Math.min((currentPageIndex + 1) * RADAR_PAGE_SIZE, filtered.length)}
          </span>
          <button
            type="button"
            onClick={() => setPageIndex(Math.min(pageCount - 1, currentPageIndex + 1))}
            disabled={currentPageIndex === pageCount - 1}
          >
            NEXT →
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
        <span className="section-index">03 / COVERAGE</span>
        <h1>Independent source adapters</h1>
        <p>一个适配器的 complete 不会提升另一个适配器；链扫描只承诺 configured start 之后的范围。</p>
      </section>
      <div className="ops-grid">
        <Metric label="PAIR LISTINGS" value={summary?.pairListings ?? 'UNKNOWN'} note="listing evidence only" />
        <Metric label="LONG ROUTES" value={summary?.longLaunches ?? 'UNKNOWN'} note="registered entry events" />
        <Metric
          label="DOPPLER TARGETS"
          value={summary?.dopplerTargetsDiscovered ?? 'UNKNOWN'}
          note={`${summary?.dopplerLaunches ?? 'UNKNOWN'} visible: PAIR, LONG, multi-pool or pending scan`}
        />
        <Metric
          label="TARGET POOLS"
          value={summary?.genericPools ?? 'UNKNOWN'}
          note={summary?.poolRetention?.policy || 'retention policy unavailable'}
        />
      </div>
      <div className="source-grid">
        {sources.map((source) => (
          <article className="source-module" key={source.adapterId}>
            <div className="source-head">
              <span>{source.adapterId}</span>
              <StatusBadge status={source.status}>{source.status}</StatusBadge>
            </div>
            <h2>{source.label}</h2>
            <p>{source.claimScope}</p>
            <dl>
              <div>
                <dt>Last success</dt>
                <dd>{source.lastSuccessAt ? `${relativeAge(source.lastSuccessAt)} ago` : 'never'}</dd>
              </div>
              <div>
                <dt>Lag</dt>
                <dd>{source.lagBlocks ?? 'UNKNOWN'} blocks</dd>
              </div>
              <div>
                <dt>Boundary</dt>
                <dd>{source.configuredStartBlock ?? 'API snapshot'}</dd>
              </div>
              <div>
                <dt>Safe head</dt>
                <dd>{source.safeHead ?? '—'}</dd>
              </div>
            </dl>
            {source.lastError && <code className="source-error">{source.lastError}</code>}
          </article>
        ))}
        {sources.length === 0 && (
          <EmptyState eyebrow="00" title="Adapter state unavailable" body="等待第一个 SQLite read-model commit。" />
        )}
      </div>
    </div>
  )
}

function EpisodesPage({ episodes }) {
  return (
    <div className="page-stack">
      <section className="page-title">
        <span className="section-index">04 / ECONOMIC WINDOWS</span>
        <h1>Continuous opportunity episodes</h1>
        <p>STALE 与 UNQUOTABLE 表示 continuity UNKNOWN，不会虚构关闭或重复开启。</p>
      </section>
      {episodes.length === 0 ? (
        <EmptyState
          eyebrow="00"
          title="No durable episode recorded"
          body="只有 fresh screened-positive 才会开启 episode；没有记录不等于市场绝无机会。"
        />
      ) : (
        <div className="ledger-list">
          {episodes.map((episode) => (
            <article key={episode.episodeId}>
              <StatusBadge status={episode.state}>{episode.state}</StatusBadge>
              <strong>{episode.episodeId}</strong>
              <span>
                {episode.openedAt || '—'} → {episode.closedAt || 'OPEN'}
              </span>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}

function ExecutionPage({ executions }) {
  return (
    <div className="page-stack">
      <section className="page-title">
        <span className="section-index">05 / EFFECT TRUTH</span>
        <h1>Read-only execution ledger</h1>
        <p>
          Intent → exact plan → signature → broadcast → receipt → balance effect → realized
          net。缺一层，就停在对应证据等级。
        </p>
      </section>
      <div className="safety-ribbon">
        <strong>NO COMMAND BUS</strong>
        <span>没有 deploy / arm / sign / execute / withdraw 控件，也不暴露 raw signed transaction。</span>
      </div>
      {executions.length === 0 ? (
        <EmptyState
          eyebrow="NONE"
          title="No execution evidence in this read model"
          body="当前为 NONE；屏幕上的代理价差不能替代链上 receipt 与余额效果。"
        />
      ) : (
        <div className="ledger-list">
          {executions.map((execution) => (
            <article key={execution.executionId}>
              <StatusBadge status={execution.state}>{execution.state}</StatusBadge>
              <strong>{execution.executionId}</strong>
              <span>
                {execution.transactionHash ? compactAddress(execution.transactionHash) : 'no transaction hash'}
              </span>
            </article>
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
  const limits = shadow?.limits
  const rpcTotals = shadow?.quoteRpcTotals
  const backoff = Number(shadow?.consecutiveErrors || 0)
  const backoffLabel = backoff > 0 ? `ACTIVE x${2 ** Math.min(backoff, 4)}` : 'NONE'
  return (
    <div className="page-stack">
      <section className="page-title">
        <span className="section-index">06 / OPERATIONS</span>
        <h1>Infrastructure constraints</h1>
        <p>这里展示服务与证据状态，不把进程存活解释为成交。</p>
      </section>
      <div className="ops-grid">
        <Metric
          label="SERVICE"
          value={overview?.serviceStatus || 'UNKNOWN'}
          note="scanner process health"
          tone={toneForStatus(overview?.serviceStatus)}
        />
        <Metric
          label="READ MODEL"
          value={persistence?.status || 'UNKNOWN'}
          note={`SQLite revision ${persistence?.currentRevision ?? '—'} / parity ${String(persistence?.parity ?? '—')}`}
          tone={toneForStatus(persistence?.status)}
        />
        <Metric
          label="RPC MODE"
          value="PUBLIC"
          note="read-only provider; no paid endpoint configured in UI"
          tone="proxy"
        />
        <Metric
          label="SIGNER"
          value={overview?.signer || 'UNKNOWN'}
          note="board process capability boundary"
          tone="verified"
        />
      </div>
      <section className="system-sheet">
        <div>
          <span>Release</span>
          <code>{system?.release || 'UNKNOWN'}</code>
        </div>
        <div>
          <span>Registry</span>
          <code>{system?.registryVersion || 'UNKNOWN'}</code>
        </div>
        <div>
          <span>Source safe head</span>
          <code>{system?.sourceSafeHead || 'UNKNOWN'}</code>
        </div>
        <div>
          <span>Evidence records</span>
          <code>{persistence?.evidenceRecords ?? 'UNKNOWN'}</code>
        </div>
        <div>
          <span>SQLite file</span>
          <code>{persistence?.sqlitePath || 'UNKNOWN'}</code>
        </div>
        <div>
          <span>JSONL file</span>
          <code>{persistence?.evidencePath || 'UNKNOWN'}</code>
        </div>
        <div>
          <span>Hot cursor / pending</span>
          <code>
            {shadow?.nextBlock || 'UNKNOWN'} / {shadow?.pendingCandidates ?? 'UNKNOWN'}
          </code>
        </div>
        <div>
          <span>RPC transport</span>
          <code>
            {transport?.activeMode || 'UNKNOWN'} · batch {transport?.batchSize ?? '—'} · concurrency{' '}
            {transport?.maxHttpConcurrency ?? '—'}
          </code>
        </div>
        <div>
          <span>RPC posts / retries / fallbacks</span>
          <code>
            {rpcTotals?.rpcHttpPosts ?? 'UNKNOWN'} / {rpcTotals?.rpcLogicalRetries ?? 'UNKNOWN'} /{' '}
            {rpcTotals?.rpcBatchFallbacks ?? 'UNKNOWN'}
          </code>
        </div>
        <div>
          <span>Event to quote latency</span>
          <code>
            {shadow?.lastEventToQuoteMs === null || shadow?.lastEventToQuoteMs === undefined
              ? 'UNKNOWN'
              : `${shadow.lastEventToQuoteMs} ms`}
          </code>
        </div>
        <div>
          <span>Backoff / poll errors</span>
          <code>
            {backoffLabel} / {backoff}
          </code>
        </div>
        <div>
          <span>Candidate quota / RPC attempts</span>
          <code>
            {shadow?.lastCycleCandidateCount ?? 'UNKNOWN'} / {limits?.eventWakeMaxCandidates ?? 'UNKNOWN'} · attempts{' '}
            {limits?.rpcLogicalAttempts ?? 'UNKNOWN'}
          </code>
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
      'Launch route',
      item.provenance.platformAttribution.platformId || 'UNKNOWN',
      item.provenance.platformAttribution.status,
    ],
    ['Creator client', 'UNKNOWN', item.provenance.launchFrontend.status],
    ['Launch protocol', item.provenance.launchProtocol.protocolId, item.provenance.launchProtocol.status],
    ['Liquidity venue', item.provenance.liquidityVenue.venueId, item.provenance.liquidityVenue.status],
    ['Asset class', item.pairClass, item.target.classification.status],
    ['Quote', item.axes.quote, item.quote.method || 'NO FIXED-BLOCK EVIDENCE'],
    ['Execution', item.axes.execution, item.execution.receiptEvidence],
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
        <button
          ref={closeButton}
          className="drawer-close"
          type="button"
          onClick={onClose}
          aria-label="Close evidence drawer"
        >
          ×
        </button>
        <span className="section-index">CLAIM-LEVEL EVIDENCE</span>
        <h2 id="drawer-title">
          {item.target.symbol} <small>/ {item.quoteAssets.map((asset) => asset.symbol).join(' · ') || 'UNKNOWN'}</small>
        </h2>
        <code className="drawer-address">{item.target.address}</code>
        <div className="claim-matrix">
          {claims.map(([label, value, status]) => (
            <div key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
              <StatusBadge status={status}>{status}</StatusBadge>
            </div>
          ))}
        </div>
        <div className="drawer-section">
          <h3>Evidence timeline</h3>
          {item.detailState === 'LOADING' ? (
            <p className="muted">Loading full evidence projection…</p>
          ) : item.detailState === 'ERROR' ? (
            <p className="source-error">Full evidence request failed. The summary remains visible.</p>
          ) : timeline.length === 0 ? (
            <p className="muted">No immutable evidence envelope linked.</p>
          ) : (
            <ol className="evidence-timeline">
              {timeline.map((evidence) => (
                <li key={`${evidence.claimType}:${evidence.evidenceId}`}>
                  <span>{evidence.claimType}</span>
                  <strong>{evidence.label}</strong>
                  <code>{evidence.evidenceId}</code>
                  <small>
                    {evidence.blockNumber ? `block ${evidence.blockNumber}` : 'off-chain snapshot'} ·{' '}
                    {evidence.producer || 'UNKNOWN'}
                  </small>
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
  else if (page === 'execution') content = <ExecutionPage executions={state.data.executions} />
  else if (page === 'system') content = <SystemPage system={state.data.system} overview={state.data.overview} />
  else content = <OverviewPage data={state.data} onOpenOpportunity={openOpportunity} />

  return (
    <div className="console-shell">
      <GlobalHeader
        overview={state.data.overview}
        refreshedAt={state.refreshedAt}
        loading={state.loading}
        error={state.error}
      />
      <Navigation page={page} />
      <main className="workspace" aria-busy={state.loading}>
        {state.error && (
          <div className="error-banner" role="alert">
            <strong>READ MODEL DEGRADED</strong>
            <span>{state.error}</span>
          </div>
        )}
        {content}
      </main>
      <EvidenceDrawer item={selected} onClose={closeDrawer} />
    </div>
  )
}
