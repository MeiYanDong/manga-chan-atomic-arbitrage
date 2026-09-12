import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  assertFeishuWebhookUrl,
  buildBusinessSnapshot,
  buildDailyProfitSnapshot,
  dailyReportSchedule,
  deriveDeliveryState,
  formatFeishuDailyReport,
  readPublicBusinessSnapshot,
} from '../src/business-operations.mjs'
import { isSecureSystemdCredential } from '../src/journal.mjs'
import { collectPortfolioSnapshot, createPortfolioClients, readBasePublicHeartbeat } from '../src/portfolio-monitor.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const RUN_DIR = path.resolve(process.env.MANGA_RUN_DIR || path.join(ROOT, 'runs'))
const REPORT_DIR = path.resolve(process.env.MANGA_BUSINESS_REPORT_DIR || path.join(RUN_DIR, 'business-report'))
const SNAPSHOT_PATH = path.resolve(
  process.env.MANGA_BUSINESS_SNAPSHOT_PATH || path.join(REPORT_DIR, 'business-snapshot.json'),
)
const DAILY_PROFIT_PATH = path.resolve(
  process.env.MANGA_BUSINESS_DAILY_PROFIT_PATH || path.join(REPORT_DIR, 'daily-profit.json'),
)
const DELIVERY_STATE_PATH = path.join(REPORT_DIR, 'delivery-state.json')
const DELIVERY_RECEIPTS_PATH = path.join(REPORT_DIR, 'delivery-receipts.jsonl')
const LOCK_PATH = path.join(REPORT_DIR, 'report.lock')
const BOARD_URL = process.env.MANGA_BUSINESS_BOARD_URL || 'http://127.0.0.1:8788'
const WEBHOOK_FILE = process.env.MANGA_FEISHU_WEBHOOK_FILE || null
const BASE_HEARTBEAT_PATH =
  process.env.MANGA_BUSINESS_BASE_HEARTBEAT_PATH || '/run/atomic-cycle-portfolio/heartbeat.json'
const ROBINHOOD_RPC_URL = process.env.MANGA_BUSINESS_ROBINHOOD_RPC_URL || 'https://rpc.mainnet.chain.robinhood.com'
const BASE_RPC_URL = process.env.MANGA_BUSINESS_BASE_RPC_URL || 'https://mainnet.base.org'
const portfolioClients = createPortfolioClients({
  robinhoodRpcUrl: ROBINHOOD_RPC_URL,
  baseRpcUrl: BASE_RPC_URL,
})
const REPORT_HOUR = integer(process.env.MANGA_BUSINESS_REPORT_HOUR, 9, 0, 23)
const REPORT_MINUTE = integer(process.env.MANGA_BUSINESS_REPORT_MINUTE, 5, 0, 59)
const PROJECT_HISTORY_PATH = path.join(ROOT, 'deployments', 'project-history-mainnet.json')

function integer(value, fallback, minimum, maximum) {
  if (value === undefined || value === '') return fallback
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error('invalid business report schedule')
  }
  return parsed
}

function readJson(file) {
  if (!fs.existsSync(file)) return null
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function readJsonLines(file) {
  if (!fs.existsSync(file)) return []
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

function writeJsonAtomic(file, value, mode) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o750 })
  const temporary = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode })
  fs.renameSync(temporary, file)
  fs.chmodSync(file, mode)
}

function writePublicSnapshots(snapshot) {
  writeJsonAtomic(SNAPSHOT_PATH, snapshot, 0o640)
  writeJsonAtomic(DAILY_PROFIT_PATH, buildDailyProfitSnapshot(snapshot), 0o644)
}

function appendDeliveryReceipt(receipt) {
  fs.mkdirSync(REPORT_DIR, { recursive: true, mode: 0o750 })
  const descriptor = fs.openSync(DELIVERY_RECEIPTS_PATH, 'a', 0o600)
  try {
    fs.writeFileSync(descriptor, `${JSON.stringify(receipt)}\n`)
    fs.fsyncSync(descriptor)
  } finally {
    fs.closeSync(descriptor)
  }
  fs.chmodSync(DELIVERY_RECEIPTS_PATH, 0o600)
}

function acquireLock() {
  fs.mkdirSync(REPORT_DIR, { recursive: true, mode: 0o750 })
  let descriptor
  try {
    descriptor = fs.openSync(LOCK_PATH, 'wx', 0o600)
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error
    const metadata = fs.lstatSync(LOCK_PATH)
    const existingPid = metadata.isFile() ? Number(fs.readFileSync(LOCK_PATH, 'utf8').trim()) : Number.NaN
    if (processIsAlive(existingPid)) throw new Error('business report is already running')
    fs.unlinkSync(LOCK_PATH)
    descriptor = fs.openSync(LOCK_PATH, 'wx', 0o600)
  }
  fs.writeFileSync(descriptor, `${process.pid}\n`)
  return () => {
    try {
      fs.closeSync(descriptor)
    } catch {}
    try {
      fs.unlinkSync(LOCK_PATH)
    } catch {}
  }
}

function deliveryState() {
  return deriveDeliveryState(readJson(DELIVERY_STATE_PATH), readJsonLines(DELIVERY_RECEIPTS_PATH))
}

function processIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function serviceStatus(unit) {
  const result = spawnSync('/usr/bin/systemctl', ['is-active', unit], {
    encoding: 'utf8',
    timeout: 2_000,
  })
  const status = String(result.stdout || '').trim()
  if (status === 'active') return 'RUNNING'
  if (['inactive', 'failed', 'deactivating'].includes(status)) return 'STOPPED'
  return 'UNKNOWN'
}

function basePublicHeartbeat() {
  try {
    return readBasePublicHeartbeat(BASE_HEARTBEAT_PATH)
  } catch {
    return null
  }
}

async function requestBoard(pathname) {
  try {
    const url = new URL(pathname, BOARD_URL)
    if (!['127.0.0.1', '::1', 'localhost'].includes(url.hostname)) throw new Error('board must remain loopback-only')
    const response = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(5_000),
    })
    if (!response.ok) return null
    return response.json()
  } catch {
    return null
  }
}

async function currentBusinessSnapshot(delivery = deliveryState()) {
  const runtime = readJson(path.join(RUN_DIR, 'dual-watch-state.json'))
  const processAlive = processIsAlive(Number(runtime?.pid))
  const robinhoodServiceStatus = processStatusForPortfolio(runtime, processAlive)
  const [health, overview, sources, portfolio] = await Promise.all([
    requestBoard('/healthz'),
    requestBoard('/api/v1/overview'),
    requestBoard('/api/v1/sources'),
    collectPortfolioSnapshot({
      clients: portfolioClients,
      robinhoodServiceStatus,
      baseUnitStatus: serviceStatus('atomic-cycle-live.service'),
      baseHeartbeat: basePublicHeartbeat(),
    }),
  ])
  return buildBusinessSnapshot({
    now: new Date(),
    arm: readJson(path.join(RUN_DIR, 'dual-watch-arm.json')),
    runtime,
    usdgState: readJson(path.join(RUN_DIR, 'generic-state.json')),
    wethState: readJson(path.join(RUN_DIR, 'weth-state.json')),
    auditRecords: readJsonLines(path.join(RUN_DIR, 'audit.jsonl')),
    collectionRecords: readJsonLines(path.join(RUN_DIR, 'legacy-collection-audit.jsonl')),
    earnOnHoodRecords: readJsonLines(path.join(RUN_DIR, 'earnonhood-audit.jsonl')),
    projectRegistry: readJson(PROJECT_HISTORY_PATH)?.entries || [],
    board: { health, overview, sources: sources?.summary || null },
    delivery,
    processAlive,
    reportHour: REPORT_HOUR,
    reportMinute: REPORT_MINUTE,
    portfolio,
  })
}

function processStatusForPortfolio(runtime, processAlive) {
  if (!runtime) return 'UNKNOWN'
  if (!processAlive) return 'STOPPED'
  return runtime.status === 'RUNNING' ? 'RUNNING' : runtime.status === 'HALTED_UNKNOWN' ? 'HALTED' : 'UNKNOWN'
}

function readWebhook() {
  if (!WEBHOOK_FILE) throw new Error('Feishu webhook credential file is not configured')
  const metadata = fs.lstatSync(WEBHOOK_FILE)
  const privateFile = (metadata.mode & 0o077) === 0
  const systemdCredential = isSecureSystemdCredential(WEBHOOK_FILE, metadata, process.env.CREDENTIALS_DIRECTORY)
  if (!metadata.isFile() || metadata.size <= 0 || metadata.size > 2_048 || (!privateFile && !systemdCredential)) {
    throw new Error('Feishu webhook credential permissions are invalid')
  }
  return assertFeishuWebhookUrl(fs.readFileSync(WEBHOOK_FILE, 'utf8').trim())
}

async function sendFeishu(message) {
  const response = await fetch(readWebhook(), {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ msg_type: 'text', content: { text: message } }),
    signal: AbortSignal.timeout(10_000),
  })
  let result = null
  try {
    result = await response.json()
  } catch {}
  const code = result?.code ?? result?.StatusCode
  if (!response.ok || code !== 0) {
    throw new Error(`Feishu webhook rejected report with HTTP ${response.status} and code ${code ?? 'UNKNOWN'}`)
  }
  return { code, message: result?.msg || result?.StatusMessage || 'success' }
}

async function tick() {
  const release = acquireLock()
  try {
    let delivery = deliveryState()
    let snapshot = await currentBusinessSnapshot(delivery)
    writePublicSnapshots(snapshot)
    const schedule = dailyReportSchedule(new Date(), REPORT_HOUR, REPORT_MINUTE)
    const delivered = readJsonLines(DELIVERY_RECEIPTS_PATH).some(
      (receipt) => receipt?.periodKey === schedule.periodKey && receipt?.status === 'DELIVERED',
    )
    if (!schedule.due || delivered) {
      console.log(
        JSON.stringify({
          status: delivered ? 'DAILY_REPORT_ALREADY_DELIVERED' : 'DAILY_REPORT_NOT_DUE',
          snapshot: 'UPDATED',
          periodKey: schedule.periodKey,
          nextReportAt: schedule.nextReportAt,
        }),
      )
      return
    }
    const message = formatFeishuDailyReport(snapshot, schedule.periodKey)
    const response = await sendFeishu(message)
    const receipt = {
      schemaVersion: 1,
      status: 'DELIVERED',
      periodKey: schedule.periodKey,
      sentAt: new Date().toISOString(),
      reportSha256: crypto.createHash('sha256').update(message).digest('hex'),
      responseCode: response.code,
      responseMessage: response.message,
    }
    appendDeliveryReceipt(receipt)
    delivery = { lastSuccessAt: receipt.sentAt, lastPeriodKey: receipt.periodKey }
    writeJsonAtomic(DELIVERY_STATE_PATH, delivery, 0o600)
    snapshot = await currentBusinessSnapshot(delivery)
    writePublicSnapshots(snapshot)
    console.log(
      JSON.stringify({ status: 'DAILY_REPORT_DELIVERED', periodKey: receipt.periodKey, sentAt: receipt.sentAt }),
    )
  } finally {
    release()
  }
}

async function preview() {
  const snapshot = await currentBusinessSnapshot()
  const schedule = dailyReportSchedule(new Date(), REPORT_HOUR, REPORT_MINUTE)
  console.log(formatFeishuDailyReport(snapshot, schedule.periodKey))
}

const command = process.argv[2] || 'tick'
if (command === 'tick') await tick()
else if (command === 'preview') await preview()
else if (command === 'status') console.log(JSON.stringify(readPublicBusinessSnapshot(SNAPSHOT_PATH), null, 2))
else throw new Error(`unknown business report command: ${command}`)
