import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('opportunity board source has no signer, wallet-client or hot-transport path', () => {
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
  assert.match(source, /scheduler: 'INDEPENDENT_HOT_POLL_LOOP'/)
  assert.match(source, /this\.hotPollTask = this\.runHotPollLoop\(\)/)
  assert.match(source, /await this\.pollHotEvents\(\)/)
  assert.match(source, /coalesceLatestSwapPerPool\(decodedEvents\)/)
  assert.match(source, /if \(this\.eventQueue\.size > 0\)/)
  assert.doesNotMatch(source, /pollBeforeDrainingWakeQueue/)
  const cycleStart = source.indexOf('async cycle(options = {})')
  const dependencyBuild = source.indexOf(
    'this.dependencyIndex = buildShadowDependencyIndex(this.catalog, this.observations)',
    cycleStart,
  )
  const fixedBlock = source.indexOf('const fixed = await this.fixedBlock()', cycleStart)
  assert.ok(cycleStart >= 0 && dependencyBuild > cycleStart && dependencyBuild < fixedBlock)
  assert.match(source, /advanceChainCatalog/)
  assert.match(source, /advanceSourcePoolCatalog/)
  assert.match(source, /pair\.chain-catalog\.v1/)
  assert.match(source, /INDIVIDUAL_FALLBACK/)
  assert.match(source, /activateUnbatchedTransport/)
  assert.match(source, /persistenceHealthy/)
  assert.match(source, /eventWakeMaxCandidates: this\.config\.eventWakeMaxCandidates/)
  assert.match(source, /rpcLogicalAttempts: this\.config\.rpcLogicalAttempts/)
  assert.match(source, /NOT_RUN_EXACT_EXECUTOR_PREFLIGHT_REQUIRED/)
  assert.doesNotMatch(source, /GENERIC_EXECUTOR_NOT_DEPLOYED/)
  assert.match(source, /respondJsonFile\(response, this\.sourceCatalogPath\)/)
  assert.match(source, /sourceCatalog: null,[\s\S]*sourceCatalogHash: this\.latestSourceCatalogHash/)
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

test('systemd unit keeps the board in a separate loopback-only identity without credentials', () => {
  const unit = fs.readFileSync(path.join(root, 'deploy', 'systemd', 'manga-opportunity-board.service'), 'utf8')
  assert.match(unit, /^User=manga-board$/m)
  assert.match(unit, /^Group=manga-board$/m)
  assert.match(unit, /^EnvironmentFile=\/etc\/manga-opportunity-board\/live\.env$/m)
  assert.match(unit, /^ProtectSystem=strict$/m)
  assert.match(unit, /^ReadWritePaths=\/var\/lib\/manga-opportunity-board$/m)
  assert.match(unit, /^MemoryHigh=448M$/m)
  assert.match(unit, /^MemoryMax=512M$/m)
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
    /^ExecStart=\/usr\/bin\/env MANGA_BOARD_EVENT_MAX_BLOCK_RANGE=200 MANGA_BOARD_EVENT_MAX_LAG_BLOCKS=500 npm run board$/m,
  )
  assert.doesNotMatch(unit, /LoadCredential|manga-private-key|MANGA_PRIVATE_KEY/)

  const example = fs.readFileSync(path.join(root, 'deploy', 'opportunity-board.env.example'), 'utf8')
  assert.match(example, /^MANGA_BOARD_HOST=127\.0\.0\.1$/m)
  assert.match(example, /^MANGA_BOARD_EVENT_POLL_MS=4000$/m)
  assert.match(example, /^MANGA_BOARD_CHAIN_CATALOG_START_BLOCK=45000000$/m)
  assert.match(example, /^MANGA_BOARD_RPC_BATCH_SIZE=20$/m)
  assert.match(example, /^MANGA_BOARD_RPC_HTTP_CONCURRENCY=1$/m)
  assert.match(example, /^MANGA_BOARD_FULL_GRID_EVERY_CYCLES=0$/m)
  assert.match(example, /^MANGA_BOARD_READ_MODEL=sqlite$/m)
  assert.match(example, /^MANGA_BOARD_SOURCE_CATALOG_START_BLOCK=45000000$/m)
  assert.doesNotMatch(example, /MANGA_PRIVATE_KEY|MANGA_RPC_URL=|MANGA_WS_URL=/)
})

test('business reporter can read ledgers but cannot sign or write trading state', () => {
  const service = fs.readFileSync(path.join(root, 'deploy', 'systemd', 'manga-business-report.service'), 'utf8')
  const timer = fs.readFileSync(path.join(root, 'deploy', 'systemd', 'manga-business-report.timer'), 'utf8')
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
  assert.match(installer, /manga-business-report\.timer/)
})

test('SSH access permits only a client-local forward to the loopback board', () => {
  const sshd = fs.readFileSync(path.join(root, 'deploy', 'sshd', '60-manga-chan-arbitrage-hardening.conf'), 'utf8')
  assert.match(sshd, /^AllowTcpForwarding local$/m)
  assert.match(sshd, /^PermitOpen 127\.0\.0\.1:8788$/m)
  assert.match(sshd, /^GatewayPorts no$/m)
  assert.match(sshd, /^PermitTunnel no$/m)
  assert.match(sshd, /^PasswordAuthentication no$/m)
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
  assert.match(
    dualWatcher,
    /^ExecStart=\/usr\/bin\/env MANGA_GENERIC_WATCH_MIN_SCREENED_NET_USDG=0\.05 npm run dual:watch$/m,
  )
  assert.match(dualArm, /^Type=oneshot$/m)
  assert.match(
    dualArm,
    /^ExecStart=\/usr\/bin\/env MANGA_GENERIC_WATCH_MIN_SCREENED_NET_USDG=0\.05 npm run dual:watch:arm$/m,
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
})
