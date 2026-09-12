import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('opportunity board stays signer-free while isolating the bounded managed event-quote path', () => {
  const source = fs.readFileSync(path.join(root, 'scripts', 'opportunity-board.mjs'), 'utf8')
  for (const forbidden of [
    'createWalletClient',
    'privateKeyToAccount',
    'MANGA_PRIVATE_KEY',
    'MANGA_KEYCHAIN_SERVICE',
    'MANGA_RPC_URL',
    'MANGA_WS_URL',
  ]) {
    assert.equal(source.includes(forbidden), false, `read-only board unexpectedly references ${forbidden}`)
  }
  assert.equal(source.includes('MANGA_BOARD_RPC_URL'), true)
  assert.equal(source.includes('READ_ONLY_NO_SIGNING_NO_BROADCAST'), true)
  assert.match(source, /eth_getLogs/)
  assert.match(source, /waitForEventWake/)
  assert.match(source, /scheduler: 'INDEPENDENT_HOT_POLL_PLUS_PROTECTED_RECONCILIATION'/)
  assert.match(source, /quoteCyclePolicy/)
  assert.match(source, /this\.hotPollTask = this\.runHotPollLoop\(\)/)
  assert.match(source, /await this\.pollHotEvents\(\)/)
  assert.match(source, /coalesceLatestSwapPerPool\(decodedEvents\)/)
  assert.match(source, /MULTICALL3_RUNTIME_CODE_HASH/)
  assert.match(source, /keccak256\(code\)/)
  assert.match(source, /this\.quoteClient\(\)\.multicall\(/)
  assert.match(source, /multicallAddress: MULTICALL3/)
  assert.match(source, /batchSize: 0/)
  assert.match(source, /readWithBoundedMulticall/)
  assert.match(source, /multicallDirectRecoveries/)
  assert.match(source, /seedV3ShortlistsFromObservations/)
  assert.match(source, /v3PersistentShortlistHits/)
  assert.match(source, /selectV3BootstrapRoutes/)
  assert.match(source, /v3BoundedBootstrapMisses/)
  assert.match(source, /v4RouteShortlistCache\.getOrCreate\(fixed\.blockNumber/)
  assert.match(source, /selectV4RoutePairs/)
  assert.match(source, /v4QuoteCache\.getOrCreate\(blockNumber/)
  assert.match(source, /v4QuoterCacheHits/)
  assert.match(source, /protectedPeriodicCandidates: this\.config\.protectedPeriodicCandidates/)
  assert.match(source, /periodicV4PairLimit: this\.config\.periodicV4PairLimit/)
  assert.match(source, /periodicAmountLimit: this\.config\.periodicAmountLimit/)
  assert.match(source, /periodicV3RouteLimit: this\.config\.periodicV3RouteLimit/)
  assert.match(source, /probe: eventWake === null \? null : policy\.probe/)
  assert.match(source, /probe: parentContext\?\.candidateProbe \|\| null/)
  assert.match(source, /coverageProbe \? boundedV3RouteLimit : this\.config\.v3BootstrapMaxRoutes/)
  assert.match(source, /optimizationMode = eventFastPath[\s\S]*BOUNDED_COVERAGE_SAMPLE/)
  assert.match(source, /this\.quoteClient\(\)\.simulateContract\(/)
  assert.match(source, /EVENT_ONLY_EXECUTOR_COMPATIBLE_OR_EXECUTOR_SHAPE/)
  assert.match(source, /PUBLIC_ON_DAILY_CAP_OR_TRANSIENT_FAILURE/)
  assert.match(source, /DailyHotRpcBudget/)
  assert.match(source, /candidatePriorities: eventWake\?\.candidatePriorities \|\| \[\]/)
  assert.match(source, /if \(this\.eventQueue\.size > 0\)/)
  assert.match(source, /priorityForCandidate: \(candidateId\) => candidateWakePriority/)
  assert.match(source, /eventLiveCompatibleCandidatesSelected/)
  assert.match(source, /eventExecutorShapeCandidatesSelected/)
  assert.match(source, /eventShadowOnlyCandidatesSelected/)
  assert.doesNotMatch(source, /pollBeforeDrainingWakeQueue/)
  const cycleStart = source.indexOf('async cycle(options = {})')
  const dependencyBuild = source.indexOf(
    'this.dependencyIndex = buildShadowDependencyIndex(this.catalog, this.observations)',
    cycleStart,
  )
  const fixedBlock = source.indexOf('const fixed = await this.fixedBlock()', cycleStart)
  assert.ok(cycleStart >= 0 && dependencyBuild > cycleStart && dependencyBuild < fixedBlock)
  assert.match(
    source.slice(cycleStart, fixedBlock),
    /if \(!eventWake\) \{[\s\S]*buildShadowDependencyIndex[\s\S]*periodicScanningPublicationsDeferred/,
  )
  assert.doesNotMatch(source.slice(dependencyBuild, fixedBlock), /this\.publish\(/)
  assert.match(source, /advanceChainCatalog/)
  assert.match(source, /advanceSourcePoolCatalog/)
  assert.match(source, /pair\.chain-catalog\.v1/)
  assert.match(source, /INDIVIDUAL_FALLBACK/)
  assert.match(source, /activateUnbatchedTransport/)
  assert.match(source, /boardHealthIsReady\(\{/)
  assert.match(source, /runtimeStatus: this\.runtimeHealthStatus/)
  assert.match(
    source,
    /DEFER_NON_MATERIAL_EVENT[\s\S]*this\.persistState\(this\.lastCycleAt\)[\s\S]*this\.runtimeHealthStatus = finalStatus/,
  )
  assert.match(source, /eventWakeMaxCandidates: this\.config\.eventWakeMaxCandidates/)
  assert.match(source, /rpcLogicalAttempts: this\.config\.rpcLogicalAttempts/)
  assert.match(source, /NOT_RUN_EXACT_EXECUTOR_PREFLIGHT_REQUIRED/)
  assert.doesNotMatch(source, /GENERIC_EXECUTOR_NOT_DEPLOYED/)
  assert.match(source, /respondJsonFile\(response, this\.sourceCatalogPath\)/)
  assert.match(source, /sourceCatalog: null,[\s\S]*sourceCatalogHash: this\.latestSourceCatalogHash/)
  assert.match(source, /writeStableJsonAtomic\(this\.snapshotPath, reconciled\.snapshot\)/)
  assert.match(source, /initializeIngestNeedsCatalogRefresh\(initializeResult\)/)
  assert.match(source, /catalogMaintenancePolicy\(\{/)
  assert.match(source, /this\.sourceTargetIndex = sourceTargetAddresses\(\{/)
  assert.match(source, /retainPoolsForSourceTargetIndex\(allGenericFacts, sourceTargets\)/)
  assert.match(source, /sourceTargetIndex: this\.sourceTargetIndex/)
  assert.match(source, /markPhase\('initializeIngestMs'\)/)
  assert.match(source, /if \(initializeEvents\.length === 0\)/)
  assert.match(source, /refreshCatalog\(\{ full: fullCatalogDue, deferProjection: true \}\)/)
  assert.match(source, /advanceLaunchSourceCatalog\(fixed\.blockNumber, \{ deferProjection: true \}\)/)
  assert.match(source, /advanceSourcePoolCatalog\(fixed\.blockNumber, \{ deferProjection: true \}\)/)
  assert.match(source, /advanceChainCatalog\(fixed\.blockNumber, \{ deferProjection: true \}\)/)
  assert.match(source, /if \(!eventWake\) this\.beginSourceProjectionDeferral\(\)/)
  assert.match(source, /source projection commit requires a durable cursor checkpoint/)
  assert.match(source, /this\.commitDeferredSourceProjection\(fixed\.blockNumber\)/)
  assert.match(source, /coalescedPeriodicSourceProjectionCycles/)
  assert.match(source, /eventCyclePublicationPolicy\(\{/)
  assert.match(source, /EventCyclePublication\.DEFER_NON_MATERIAL_EVENT/)
  assert.match(source, /EventCyclePublication\.EVENT_EXECUTION_FEED_CLEAR/)
  assert.match(source, /EventCyclePublication\.EVENT_EPISODE_RECONCILIATION/)
  assert.match(source, /eventDeferredFullSnapshotPublications/)
  assert.match(source, /persistedExecutionFeed = readJson\(this\.executionSnapshotPath\)/)
  assert.match(source, /if \(this\.snapshot\) this\.publishExecutionFeed\(this\.snapshot\)/)
  const publishStart = source.indexOf('publish(status')
  const publishEnd = source.indexOf('async cycle(options = {})', publishStart)
  const executionFeedWrite = source.indexOf('this.publishExecutionFeed(reconciled.snapshot)', publishStart)
  const compatibilityWrite = source.indexOf('writeStableJsonAtomic(this.snapshotPath', publishStart)
  assert.ok(publishStart >= 0 && publishEnd > publishStart)
  assert.ok(
    compatibilityWrite > publishStart && executionFeedWrite > compatibilityWrite && executionFeedWrite < publishEnd,
  )
  const hotPollStart = source.indexOf('async pollHotEvents()')
  const hotPollEnd = source.indexOf('async runHotPollLoop()', hotPollStart)
  assert.ok(hotPollStart >= 0 && hotPollEnd > hotPollStart)
  const hotPollBody = source.slice(hotPollStart, hotPollEnd)
  assert.doesNotMatch(hotPollBody, /writeSourceCatalog|writeChainCatalog|refreshCatalog/)
})

test('dashboard client is same-origin, read-only and free of signer material', () => {
  const app = fs.readFileSync(path.join(root, 'ui', 'src', 'App.jsx'), 'utf8')
  const index = fs.readFileSync(path.join(root, 'ui', 'index.html'), 'utf8')
  const styles = fs.readFileSync(path.join(root, 'ui', 'src', 'styles.css'), 'utf8')
  const vite = fs.readFileSync(path.join(root, 'vite.config.mjs'), 'utf8')
  const combined = `${app}\n${index}\n${styles}\n${vite}`
  const externalUrls = (combined.match(/https?:\/\/[^\s'"`]+/g) || []).filter(
    (value) =>
      !/^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?\/?$/.test(value) &&
      value !== 'https://robinhoodchain.blockscout.com/tx/${item.transactionHash}',
  )

  assert.deepEqual(externalUrls, [])
  assert.doesNotMatch(combined, /MANGA_PRIVATE_KEY|createWalletClient|privateKeyToAccount|eth_sendRawTransaction/)
  assert.doesNotMatch(combined, /fetch\([^)]*,\s*\{[^}]*method:\s*['"](?:POST|PUT|PATCH|DELETE)/s)
  assert.match(app, /requestJson\('\/api\/v1\/system'/)
  assert.match(app, /requestOptionalJson\('\/api\/v1\/business'/)
  assert.match(app, /不能授权、签名或发起交易/)
  assert.match(app, /RPC 自动重试 \/ 降级/)
  assert.match(styles, /\.page-stack\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s)
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/)
})

test('managed hot RPC benchmark is read-only and does not disclose endpoint values', () => {
  const source = fs.readFileSync(path.join(root, 'scripts', 'benchmark-board-hot-rpc.mjs'), 'utf8')
  assert.doesNotMatch(source, /createWalletClient|privateKeyToAccount|MANGA_PRIVATE_KEY|eth_sendRawTransaction/)
  assert.match(source, /simulateContract/)
  assert.match(source, /blockNumber/)
  assert.match(source, /matchingOutput/)
  assert.match(source, /managedProviderLabel/)
  assert.doesNotMatch(source, /console\.log\([^)]*(?:publicRpcUrl|managedRpcUrl)/s)
})

test('systemd unit keeps the board in a separate loopback-only identity without credentials', () => {
  const unit = fs.readFileSync(path.join(root, 'deploy', 'systemd', 'manga-opportunity-board.service'), 'utf8')
  assert.match(unit, /^User=manga-board$/m)
  assert.match(unit, /^Group=manga-board$/m)
  assert.match(unit, /^EnvironmentFile=\/etc\/manga-opportunity-board\/live\.env$/m)
  assert.match(unit, /^ProtectSystem=strict$/m)
  assert.match(unit, /^ReadWritePaths=\/var\/lib\/manga-opportunity-board$/m)
  assert.match(unit, /^MemoryHigh=448M$/m)
  assert.match(unit, /^MemoryMax=512M$/m)
  assert.match(unit, /^Environment=NODE_OPTIONS=--max-old-space-size=256$/m)
  assert.match(unit, /^RuntimeDirectory=manga-opportunity-board-feed$/m)
  assert.match(unit, /^RuntimeDirectoryMode=0750$/m)
  assert.match(unit, /^RuntimeDirectoryPreserve=restart$/m)
  assert.match(
    unit,
    /^Environment=MANGA_BOARD_EXECUTION_SNAPSHOT=\/run\/manga-opportunity-board-feed\/execution-snapshot\.json$/m,
  )
  assert.match(
    unit,
    /^Environment=MANGA_BOARD_BUSINESS_SNAPSHOT=\/var\/lib\/manga-business-report\/business-snapshot\.json$/m,
  )
  assert.match(
    unit,
    /^ExecStart=\/usr\/bin\/env MANGA_BOARD_EVENT_MAX_BLOCK_RANGE=200 MANGA_BOARD_EVENT_MAX_LAG_BLOCKS=500 MANGA_BOARD_EVENT_WAKE_MAX_CANDIDATES=1 MANGA_BOARD_EVENT_WAKE_MAX_AGE_MS=20000 MANGA_BOARD_EVENT_V4_PAIR_LIMIT=1 MANGA_BOARD_EVENT_AMOUNT_LIMIT=2 MANGA_BOARD_EVENT_V3_SHORTLIST_SIZE=1 MANGA_BOARD_EVENT_RPC_LOGICAL_ATTEMPTS=2 MANGA_BOARD_EVENT_RPC_RETRY_DELAY_MS=200 MANGA_BOARD_HOT_RPC_DAILY_EVENT_CANDIDATES=200 MANGA_BOARD_HOT_RPC_DAILY_LOGICAL_CALLS=4000 MANGA_BOARD_HOT_RPC_HTTP_CONCURRENCY=4 MANGA_BOARD_RPC_BATCH_SIZE=1 MANGA_BOARD_RPC_RETRY_DELAY_MS=1000 MANGA_BOARD_MULTICALL_MAX_CALLS=4 MANGA_BOARD_CYCLE_MAX_CANDIDATES=4 MANGA_BOARD_PROTECTED_PERIODIC_CANDIDATES=1 MANGA_BOARD_PERIODIC_V4_PAIR_LIMIT=1 MANGA_BOARD_PERIODIC_AMOUNT_LIMIT=1 MANGA_BOARD_PERIODIC_V3_ROUTE_LIMIT=1 MANGA_BOARD_MAX_POOLS_PER_TARGET=8 MANGA_BOARD_V3_BOOTSTRAP_MAX_ROUTES=8 MANGA_BOARD_V3_SHORTLIST_REFRESH_MS=300000 MANGA_BOARD_V3_SHORTLIST_REFRESHES_PER_CYCLE=2 MANGA_BOARD_V4_SHORTLIST_SIZE=3 npm run board$/m,
  )
  assert.doesNotMatch(unit, /LoadCredential|manga-private-key|MANGA_PRIVATE_KEY/)

  const example = fs.readFileSync(path.join(root, 'deploy', 'opportunity-board.env.example'), 'utf8')
  assert.match(example, /^MANGA_BOARD_HOST=127\.0\.0\.1$/m)
  assert.match(example, /^MANGA_BOARD_EVENT_POLL_MS=4000$/m)
  assert.match(example, /^MANGA_BOARD_CHAIN_CATALOG_START_BLOCK=45000000$/m)
  assert.match(example, /^MANGA_BOARD_RPC_BATCH_SIZE=1$/m)
  assert.match(example, /^MANGA_BOARD_RPC_RETRY_DELAY_MS=1000$/m)
  assert.match(example, /^MANGA_BOARD_MULTICALL_MAX_CALLS=4$/m)
  assert.match(example, /^MANGA_BOARD_CYCLE_MAX_CANDIDATES=4$/m)
  assert.match(example, /^MANGA_BOARD_V3_BOOTSTRAP_MAX_ROUTES=8$/m)
  assert.match(example, /^MANGA_BOARD_V4_SHORTLIST_SIZE=3$/m)
  assert.match(example, /^MANGA_BOARD_V3_SHORTLIST_REFRESH_MS=300000$/m)
  assert.match(example, /^MANGA_BOARD_V3_SHORTLIST_REFRESHES_PER_CYCLE=2$/m)
  assert.match(example, /^MANGA_BOARD_EVENT_WAKE_MAX_CANDIDATES=1$/m)
  assert.match(example, /^MANGA_BOARD_EVENT_WAKE_MAX_AGE_MS=20000$/m)
  assert.match(example, /^MANGA_BOARD_EVENT_V4_PAIR_LIMIT=1$/m)
  assert.match(example, /^MANGA_BOARD_EVENT_AMOUNT_LIMIT=2$/m)
  assert.match(example, /^MANGA_BOARD_EVENT_V3_SHORTLIST_SIZE=1$/m)
  assert.match(example, /^MANGA_BOARD_EVENT_RPC_LOGICAL_ATTEMPTS=2$/m)
  assert.match(example, /^MANGA_BOARD_EVENT_RPC_RETRY_DELAY_MS=200$/m)
  assert.match(example, /^MANGA_BOARD_HOT_RPC_ENABLED=0$/m)
  assert.match(example, /^MANGA_BOARD_HOT_RPC_DAILY_EVENT_CANDIDATES=200$/m)
  assert.match(example, /^MANGA_BOARD_HOT_RPC_DAILY_LOGICAL_CALLS=4000$/m)
  assert.match(example, /^MANGA_BOARD_HOT_RPC_HTTP_CONCURRENCY=4$/m)
  assert.match(example, /^MANGA_BOARD_RPC_HTTP_CONCURRENCY=1$/m)
  assert.match(example, /^MANGA_BOARD_FULL_GRID_EVERY_CYCLES=0$/m)
  assert.match(example, /^MANGA_BOARD_READ_MODEL=sqlite$/m)
  assert.match(example, /^MANGA_BOARD_SOURCE_CATALOG_START_BLOCK=45000000$/m)
  assert.doesNotMatch(example, /MANGA_PRIVATE_KEY|MANGA_RPC_URL=|MANGA_WS_URL=/)
})

test('business reporter can read ledgers but cannot sign or write trading state', () => {
  const service = fs.readFileSync(path.join(root, 'deploy', 'systemd', 'manga-business-report.service'), 'utf8')
  const timer = fs.readFileSync(path.join(root, 'deploy', 'systemd', 'manga-business-report.timer'), 'utf8')
  const pathUnit = fs.readFileSync(path.join(root, 'deploy', 'systemd', 'manga-business-report.path'), 'utf8')
  const basePortfolioDropIn = fs.readFileSync(
    path.join(root, 'deploy', 'systemd', 'manga-business-report-base-portfolio.conf'),
    'utf8',
  )
  const source = fs.readFileSync(path.join(root, 'scripts', 'business-report.mjs'), 'utf8')
  const installer = fs.readFileSync(path.join(root, 'deploy', 'install-release.sh'), 'utf8')

  assert.match(service, /^Type=oneshot$/m)
  assert.match(service, /^User=manga-chan-arb$/m)
  assert.match(service, /^Group=manga-board$/m)
  assert.match(service, /^StateDirectory=manga-business-report$/m)
  assert.match(service, /^StateDirectoryMode=0750$/m)
  assert.match(service, /^ProtectSystem=strict$/m)
  assert.match(service, /^ReadWritePaths=\/var\/lib\/manga-business-report$/m)
  assert.match(
    service,
    /^LoadCredentialEncrypted=manga-feishu-webhook:\/etc\/credstore\.encrypted\/manga-feishu-webhook$/m,
  )
  assert.match(service, /^Environment=MANGA_FEISHU_WEBHOOK_FILE=%d\/manga-feishu-webhook$/m)
  assert.match(service, /^ExecStart=\/usr\/bin\/env node scripts\/business-report\.mjs tick$/m)
  assert.doesNotMatch(service, /^ExecStart=.*npm/m)
  assert.doesNotMatch(service, /manga-private-key|MANGA_PRIVATE_KEY|MANGA_RPC_URL|MANGA_WS_URL/)
  assert.doesNotMatch(source, /createWalletClient|privateKeyToAccount|eth_sendRawTransaction/)
  assert.match(source, /isSecureSystemdCredential/)
  assert.match(source, /process\.env\.CREDENTIALS_DIRECTORY/)
  assert.match(source, /status: 'DELIVERED'/)
  assert.match(source, /receipt\?\.periodKey === schedule\.periodKey/)
  assert.match(source, /deriveDeliveryState/)
  assert.match(source, /fs\.fsyncSync\(descriptor\)/)
  assert.match(timer, /^OnBootSec=2min$/m)
  assert.match(timer, /^OnCalendar=\*-\*-\* \*:0\/5:00$/m)
  assert.match(timer, /^Persistent=true$/m)
  assert.match(installer, /manga-business-report\.service/)
  assert.match(installer, /manga-business-report\.path/)
  assert.match(installer, /manga-business-report\.timer/)
  assert.match(pathUnit, /^Unit=manga-business-report\.service$/m)
  assert.match(pathUnit, /^PathChanged=\/var\/lib\/manga-chan-arbitrage\/generic-state\.json$/m)
  assert.match(pathUnit, /^PathChanged=\/var\/lib\/manga-chan-arbitrage\/weth-state\.json$/m)
  assert.match(basePortfolioDropIn, /^SupplementaryGroups=atomic-cycle$/m)
  assert.match(
    basePortfolioDropIn,
    /^Environment=MANGA_BUSINESS_BASE_HEARTBEAT_PATH=\/run\/atomic-cycle-portfolio\/heartbeat\.json$/m,
  )
  assert.match(basePortfolioDropIn, /^Environment=MANGA_BUSINESS_BASE_RPC_URL=https:\/\/base-rpc\.publicnode\.com$/m)
  assert.match(basePortfolioDropIn, /^ReadOnlyPaths=-\/run\/atomic-cycle-portfolio$/m)
  assert.doesNotMatch(basePortfolioDropIn, /^ReadWritePaths=/m)
})

test('SSH access permits only a client-local forward to the loopback board', () => {
  const sshd = fs.readFileSync(path.join(root, 'deploy', 'sshd', '60-manga-chan-arbitrage-hardening.conf'), 'utf8')
  const ports = fs.readFileSync(path.join(root, 'deploy', 'sshd', '61-dashboard-tunnel-port.conf'), 'utf8')
  const socket = fs.readFileSync(
    path.join(root, 'deploy', 'systemd', 'ssh.socket.d', '61-dashboard-tunnel-port.conf'),
    'utf8',
  )
  assert.match(sshd, /^AllowTcpForwarding local$/m)
  assert.match(sshd, /^PermitOpen 127\.0\.0\.1:8788$/m)
  assert.match(sshd, /^GatewayPorts no$/m)
  assert.match(sshd, /^PermitTunnel no$/m)
  assert.match(sshd, /^PasswordAuthentication no$/m)
  assert.match(ports, /^Port 22$/m)
  assert.match(ports, /^Port 2222$/m)
  assert.match(socket, /^ListenStream=$/m)
  assert.match(socket, /^ListenStream=0\.0\.0\.0:2222$/m)
  assert.match(socket, /^ListenStream=\[::\]:2222$/m)
  assert.doesNotMatch(socket, /8788/)
})

test('public dashboard proxy exposes only the read-only presentation surface', () => {
  const nginx = fs.readFileSync(path.join(root, 'deploy', 'nginx', 'manga-public-dashboard.conf'), 'utf8')
  const installer = fs.readFileSync(path.join(root, 'deploy', 'install-public-dashboard.sh'), 'utf8')
  assert.match(nginx, /^\s*listen 80;$/m)
  assert.match(nginx, /^\s*server_name 47\.251\.185\.146;$/m)
  assert.match(nginx, /^\s*proxy_pass http:\/\/127\.0\.0\.1:8788;$/m)
  assert.match(nginx, /^\s*location \^~ \/api\/v1\/ \{$/m)
  assert.match(nginx, /^\s*location \^~ \/api\/ \{$[\s\S]*?^\s*return 404;$/m)
  assert.match(nginx, /limit_except GET HEAD \{ deny all; \}/)
  assert.match(nginx, /Content-Security-Policy/)
  assert.match(nginx, /X-Robots-Tag "noindex, nofollow"/)
  assert.doesNotMatch(nginx + installer, /MANGA_PRIVATE_KEY|LoadCredential|eth_sendRawTransaction/)
  assert.match(installer, /nginx -t/)
  assert.match(installer, /systemctl reload nginx|systemctl start nginx/)
  assert.match(installer, /--header 'Host: 47\.251\.185\.146'/)
  assert.match(installer, /for attempt in \{1\.\.10\}/)
  assert.match(installer, /if \(\(health_ready != 1\)\); then\s+rollback/)
})

test('generic signer keeps the board read-only and uses a bounded loopback-escalation watcher', () => {
  const source = fs.readFileSync(path.join(root, 'scripts', 'generic-arb.mjs'), 'utf8')
  const plannerSource = fs.readFileSync(path.join(root, 'src', 'generic-plan.mjs'), 'utf8')
  assert.match(source, /MANGA_GENERIC_BOARD_URL|genericBoardUrl/)
  assert.match(source, /searchParams\.set\('view', 'execution'\)/)
  assert.match(source, /genericBoardSnapshot/)
  assert.match(source, /board snapshot must not be group- or world-writable/)
  assert.match(source, /buildGenericExecutionCandidates/)
  assert.match(source, /assertGenericBoardIdentity\(board\)/)
  assert.match(plannerSource, /READ_ONLY_NO_SIGNING_NO_BROADCAST/)
  assert.match(source, /watch-arm\.json/)
  assert.match(source, /watch\.lock/)
  assert.match(source, /assertFixedSignerInactive\(\)/)
  assert.match(source, /async function watchGeneric\(/)
  assert.match(source, /idleRpcBehavior: 'NONE'/)
  assert.match(source, /generic_watch_exact_preflight_started/)
  assert.match(source, /evaluateGenericArmBudgetAtBroadcast/)
  assert.match(source, /assertStillAuthorized\(\{ stage: 'before-broadcast', currentSignedAttempt \}\)/)
  assert.match(source, /generic execution raw must not be rebroadcast/)
  assert.match(source, /appendAudit\('mutation_abandoned'/)
  assert.match(source, /status: 'RUNNING',[\s\S]*consecutiveBoardErrors: 0,[\s\S]*reason: null/)
  assert.match(source, /genericWatchTransportFailurePolicy/)
  assert.match(source, /if \(failurePolicy\.shouldStop\)/)

  for (const unitName of ['manga-generic-watcher.service', 'manga-generic-arm.service']) {
    const unit = fs.readFileSync(path.join(root, 'deploy', 'systemd', unitName), 'utf8')
    assert.match(unit, /^SupplementaryGroups=manga-board$/m)
    assert.match(
      unit,
      /^Environment=MANGA_GENERIC_BOARD_SNAPSHOT=\/run\/manga-opportunity-board-feed\/execution-snapshot\.json$/m,
    )
  }

  const installer = fs.readFileSync(path.join(root, 'deploy', 'install-release.sh'), 'utf8')
  assert.match(installer, /usermod --append --groups "\$\{board_group\}" "\$\{service_user\}"/)
})

test('generic and dual systemd services isolate the board and mutually exclude signer generations', () => {
  const watcher = fs.readFileSync(path.join(root, 'deploy', 'systemd', 'manga-generic-watcher.service'), 'utf8')
  const arm = fs.readFileSync(path.join(root, 'deploy', 'systemd', 'manga-generic-arm.service'), 'utf8')
  const deploy = fs.readFileSync(path.join(root, 'deploy', 'systemd', 'manga-generic-deploy.service'), 'utf8')
  const fixed = fs.readFileSync(path.join(root, 'deploy', 'systemd', 'manga-chan-watcher.service'), 'utf8')
  const dualWatcher = fs.readFileSync(path.join(root, 'deploy', 'systemd', 'manga-dual-watcher.service'), 'utf8')
  const dualArm = fs.readFileSync(path.join(root, 'deploy', 'systemd', 'manga-dual-arm.service'), 'utf8')
  const wethDeploy = fs.readFileSync(path.join(root, 'deploy', 'systemd', 'manga-dual-weth-deploy.service'), 'utf8')

  for (const unit of [watcher, arm, deploy, dualWatcher, dualArm, wethDeploy]) {
    assert.match(unit, /^User=manga-chan-arb$/m)
    assert.match(unit, /^LoadCredentialEncrypted=manga-private-key:/m)
    assert.match(unit, /^Environment=MANGA_RUN_DIR=\/var\/lib\/manga-chan-arbitrage$/m)
    assert.match(unit, /^ReadWritePaths=\/var\/lib\/manga-chan-arbitrage$/m)
  }
  assert.match(watcher, /^Conflicts=.*manga-chan-watcher\.service.*manga-dual-watcher\.service/m)
  assert.match(arm, /^Conflicts=.*manga-chan-watcher\.service.*manga-dual-watcher\.service/m)
  assert.match(watcher, /^ExecStart=\/usr\/bin\/env npm run generic:watch$/m)
  assert.match(arm, /^Type=oneshot$/m)
  assert.match(arm, /^ExecStart=\/usr\/bin\/env npm run generic:watch:arm$/m)
  assert.match(deploy, /^Type=oneshot$/m)
  assert.match(deploy, /^ExecStart=\/usr\/bin\/env npm run generic:deploy$/m)
  assert.match(deploy, /^TimeoutStartSec=180$/m)
  assert.match(
    deploy,
    /^Conflicts=.*manga-chan-watcher\.service.*manga-generic-watcher\.service.*manga-dual-watcher\.service/m,
  )
  assert.match(
    fixed,
    /^Conflicts=.*manga-generic-watcher\.service.*manga-dual-watcher\.service.*manga-dual-arm\.service.*manga-dual-weth-deploy\.service/m,
  )
  assert.match(dualWatcher, /^SupplementaryGroups=manga-board$/m)
  assert.match(dualWatcher, /^Conflicts=.*manga-chan-watcher\.service.*manga-generic-watcher\.service/m)
  for (const unit of [dualWatcher, dualArm]) {
    assert.match(unit, /^Environment=EARN_WATCH_ENABLED=1$/m)
    assert.match(unit, /^Environment=EARN_LIVE_PROBE_POINTS=24$/m)
    assert.match(unit, /^Environment=EARN_LIVE_MIN_NET_WETH=0\.000000000000000001$/m)
    assert.match(unit, /^Environment=EARN_LIVE_MIN_HEADROOM_WETH=0$/m)
    assert.match(unit, /^Environment=EARN_LIVE_MAX_FAILED_GAS_WETH=0\.00012$/m)
    assert.match(unit, /^Environment=EARN_LIVE_WALLET_RESERVE_WETH=0\.00025$/m)
    assert.doesNotMatch(unit, /^Environment=EARN_LIVE_(?:MAX_)?(?:AMOUNT|PRINCIPAL)/m)
  }
  assert.match(
    dualWatcher,
    /^ExecStart=\/usr\/bin\/env .*EARN_WATCH_ENABLED=1 .*EARN_LIVE_MIN_NET_WETH=0\.000000000000000001 .*MANGA_GENERIC_WATCH_MIN_SCREENED_NET_USDG=0\.05 npm run dual:watch$/m,
  )
  assert.match(dualArm, /^Type=oneshot$/m)
  assert.match(
    dualArm,
    /^ExecStart=\/usr\/bin\/env .*EARN_WATCH_ENABLED=1 .*EARN_LIVE_MIN_NET_WETH=0\.000000000000000001 .*MANGA_GENERIC_WATCH_MIN_SCREENED_NET_USDG=0\.05 npm run dual:watch:arm$/m,
  )
  assert.match(wethDeploy, /^Type=oneshot$/m)
  assert.match(wethDeploy, /^ExecStart=\/usr\/bin\/env npm run dual:weth:deploy$/m)

  const dualSource = fs.readFileSync(path.join(root, 'scripts', 'dual-base-arb.mjs'), 'utf8')
  const dualWatchSource = dualSource.slice(
    dualSource.indexOf('async function watchDual()'),
    dualSource.indexOf('async function dualWatchStatus()'),
  )
  const startupRetry = dualWatchSource.indexOf('await retryReadOnly(')
  const signerLoad = dualWatchSource.indexOf('loadAccount()')
  assert.ok(startupRetry >= 0, 'dual watcher must retry transient startup readback')
  assert.ok(signerLoad > startupRetry, 'dual watcher must not load the signer before startup readback converges')
  assert.match(dualWatchSource, /isTransientRpcError/)
  assert.match(dualWatchSource, /DUAL_WATCH_STARTUP_RPC_RETRY/)
  assert.match(dualSource, /event: EARN_SWAP_ABI\[0\],[\s\S]*args: \{ pool: EARN_POOL_ADDRESSES \}/)
  assert.match(dualWatchSource, /freezeDualExecutionTrigger\(board\.snapshot, candidate/)
  assert.match(dualWatchSource, /frozenTrigger,/)
  const executeStart = dualSource.indexOf('async function execute(')
  const executeEnd = dualSource.indexOf('async function reconcile(', executeStart)
  const executeSource = dualSource.slice(executeStart, executeEnd)
  assert.doesNotMatch(executeSource, /currentBoard = await boardCandidates/)
})

test('legacy collection is a one-shot allowlisted signer with a shared wallet lane', () => {
  const unit = fs.readFileSync(path.join(root, 'deploy', 'systemd', 'manga-legacy-collect.service'), 'utf8')
  const installer = fs.readFileSync(path.join(root, 'deploy', 'install-release.sh'), 'utf8')
  const source = fs.readFileSync(path.join(root, 'scripts', 'legacy-funds-collector.mjs'), 'utf8')

  assert.match(unit, /^Type=oneshot$/m)
  assert.match(unit, /^User=manga-chan-arb$/m)
  assert.match(unit, /^LoadCredentialEncrypted=manga-private-key:/m)
  assert.match(unit, /^ExecStart=\/usr\/bin\/env npm run legacy:collect$/m)
  assert.match(
    unit,
    /^Conflicts=.*manga-chan-watcher\.service.*manga-generic-watcher\.service.*manga-dual-watcher\.service/m,
  )
  assert.match(unit, /^ReadWritePaths=\/var\/lib\/manga-chan-arbitrage \/var\/lib\/spx-arbitrage$/m)
  assert.match(installer, /manga-legacy-collect\.service/)
  assert.match(source, /legacy-usdg-collection/)
  assert.match(source, /assertSignerLanesInactive\(\)/)
  assert.match(source, /persistSignedRaw/)
  assert.match(source, /waitForTransactionReceipt/)
  assert.match(source, /EXECUTOR_ZERO_AND_OPERATOR_USDG_DELTA_CONFIRMED/)
})
