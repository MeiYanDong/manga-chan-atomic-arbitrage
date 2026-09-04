import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const CONFIG_KEYS = new Set([
  'MANGA_RPC_URL',
  'MANGA_WS_URL',
  'MANGA_READ_RPC_URL',
  'MANGA_KEYCHAIN_SERVICE',
  'MANGA_PRIVATE_KEY_FILE',
  'MANGA_RUN_DIR',
  'MANGA_ALLOW_POLLING_ONLY',
  'MANGA_FINALITY_CONFIRMATIONS',
  'MANGA_MAX_ATTEMPTS',
  'MANGA_MAX_FAILED_GAS_WEI',
  'MANGA_PROVIDER_LABEL',
])

/** @param {string} file */
export function readConfigFile(file) {
  if (!file || !fs.existsSync(file)) return {}
  /** @type {Record<string, string>} */
  const values = {}
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (!match || !CONFIG_KEYS.has(match[1])) continue
    const raw = match[2].trim()
    values[match[1]] =
      (raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'")) ? raw.slice(1, -1) : raw
  }
  return values
}

/** @param {NodeJS.ProcessEnv} [environment] */
export function loadRuntimeConfig(environment = process.env) {
  const configPath =
    environment.MANGA_CONFIG_FILE || path.join(os.homedir(), '.config', 'manga-chan-arbitrage', 'live.env')
  const fromFile = readConfigFile(configPath)
  const value = (name) => environment[name] || fromFile[name] || null
  const rpcUrl = value('MANGA_RPC_URL')
  const wsUrl = value('MANGA_WS_URL')
  const readRpcUrl = value('MANGA_READ_RPC_URL')

  return {
    configPath,
    rpcUrl,
    wsUrl,
    readRpcUrl: readRpcUrl && readRpcUrl !== rpcUrl ? readRpcUrl : null,
    keychainService: value('MANGA_KEYCHAIN_SERVICE') || 'codex-rh-manga-chan-20260904',
    privateKeyFile: value('MANGA_PRIVATE_KEY_FILE'),
    runDir: value('MANGA_RUN_DIR'),
    allowPollingOnly: value('MANGA_ALLOW_POLLING_ONLY') === '1',
    finalityConfirmations: positiveInteger(value('MANGA_FINALITY_CONFIRMATIONS'), 3),
    maxAttempts: positiveInteger(value('MANGA_MAX_ATTEMPTS'), 5),
    maxFailedGasWei: nonNegativeBigInt(value('MANGA_MAX_FAILED_GAS_WEI'), 1_000_000_000_000_000n),
    providerLabel: value('MANGA_PROVIDER_LABEL') || 'managed-provider',
    rpcSource: environment.MANGA_RPC_URL ? 'environment' : rpcUrl ? 'strategy_config' : 'public_read_only_fallback',
  }
}

/** @param {string | null} value @param {number} fallback */
function positiveInteger(value, fallback) {
  if (value === null) return fallback
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`配置值必须是正整数：${value}`)
  return parsed
}

/** @param {string | null} value @param {bigint} fallback */
function nonNegativeBigInt(value, fallback) {
  if (value === null) return fallback
  if (!/^\d+$/.test(value)) throw new Error('MANGA_MAX_FAILED_GAS_WEI 必须是非负整数字符串')
  return BigInt(value)
}

/**
 * Live signing must not silently fall back to a public endpoint.
 * @param {ReturnType<typeof loadRuntimeConfig>} config
 * @param {{ requireWss?: boolean }} [options]
 */
export function assertLiveTransport(config, { requireWss = false } = {}) {
  if (!config.rpcUrl) throw new Error('实盘命令必须配置策略专用 MANGA_RPC_URL')
  if (requireWss && !config.wsUrl && !config.allowPollingOnly) {
    throw new Error('watch 模式必须配置 MANGA_WS_URL；仅恢复演练可显式设置 MANGA_ALLOW_POLLING_ONLY=1')
  }
}
