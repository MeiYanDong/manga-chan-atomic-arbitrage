import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertFeishuWebhookUrl } from '../src/business-operations.mjs'
import {
  criticalAlertTransition,
  evaluateCriticalTradingHealth,
  formatCriticalAlert,
} from '../src/critical-alert-policy.mjs'
import { isSecureSystemdCredential } from '../src/journal.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const RUN_DIR = path.resolve(process.env.MANGA_RUN_DIR || path.join(ROOT, 'runs'))
const ALERT_DIR = path.resolve(process.env.MANGA_CRITICAL_ALERT_DIR || path.join(RUN_DIR, 'critical-alert'))
const STATE_PATH = path.join(ALERT_DIR, 'state.json')
const WEBHOOK_FILE = process.env.MANGA_CRITICAL_ALERT_WEBHOOK_FILE || null

function readJson(file) {
  try {
    const metadata = fs.statSync(file)
    if (!metadata.isFile() || metadata.size <= 0 || metadata.size > 1_000_000) return null
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function processIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

function readWebhook() {
  if (!WEBHOOK_FILE) throw new Error('critical Feishu webhook credential file is not configured')
  const metadata = fs.lstatSync(WEBHOOK_FILE)
  const privateFile = (metadata.mode & 0o077) === 0
  const systemdCredential = isSecureSystemdCredential(WEBHOOK_FILE, metadata, process.env.CREDENTIALS_DIRECTORY)
  if (!metadata.isFile() || metadata.size <= 0 || metadata.size > 2_048 || (!privateFile && !systemdCredential)) {
    throw new Error('critical Feishu webhook credential permissions are invalid')
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
    throw new Error(`critical Feishu alert rejected with HTTP ${response.status} and code ${code ?? 'UNKNOWN'}`)
  }
  return { code, message: result?.msg || result?.StatusMessage || 'success' }
}

function writeState(value) {
  fs.mkdirSync(ALERT_DIR, { recursive: true, mode: 0o700 })
  fs.chmodSync(ALERT_DIR, 0o700)
  const temporary = `${STATE_PATH}.${process.pid}.tmp`
  const descriptor = fs.openSync(temporary, 'w', 0o600)
  try {
    fs.writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`)
    fs.fsyncSync(descriptor)
  } finally {
    fs.closeSync(descriptor)
  }
  fs.renameSync(temporary, STATE_PATH)
  fs.chmodSync(STATE_PATH, 0o600)
}

async function check() {
  const now = new Date()
  const arm = readJson(path.join(RUN_DIR, 'dual-watch-arm.json'))
  const revocation = readJson(path.join(RUN_DIR, 'dual-watch-revocation.json'))
  const runtime = readJson(path.join(RUN_DIR, 'dual-watch-state.json'))
  const health = evaluateCriticalTradingHealth({
    arm,
    revocation,
    runtime,
    processAlive: processIsAlive(Number(runtime?.pid)),
    nowMs: now.getTime(),
  })
  const previous = readJson(STATE_PATH)
  const transition = criticalAlertTransition(previous, health)
  let delivery = null
  if (transition !== 'NONE') delivery = await sendFeishu(formatCriticalAlert(transition, health, now))
  writeState({
    schemaVersion: 1,
    checkedAt: now.toISOString(),
    health,
    notification: delivery ? 'DELIVERED' : transition === 'NONE' ? previous?.notification || null : 'PENDING',
    lastDeliveryAt: delivery ? now.toISOString() : previous?.lastDeliveryAt || null,
    lastDeliveryKind: delivery ? transition : previous?.lastDeliveryKind || null,
  })
  console.log(
    JSON.stringify({
      status: health.state,
      reasonCode: health.reasonCode,
      notification: transition,
      responseCode: delivery?.code ?? null,
    }),
  )
}

async function testDelivery() {
  const now = new Date()
  const delivery = await sendFeishu(formatCriticalAlert('ACTIVATED', {}, now))
  console.log(JSON.stringify({ status: 'CRITICAL_ALERT_CHANNEL_VERIFIED', responseCode: delivery.code }))
}

const command = process.argv[2] || 'check'
if (command === 'check') await check()
else if (command === 'test') await testDelivery()
else throw new Error(`unknown critical alert command: ${command}`)
