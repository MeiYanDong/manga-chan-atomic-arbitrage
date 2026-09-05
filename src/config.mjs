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
  'MANGA_GENERIC_BOARD_URL',
  'MANGA_GENERIC_BOARD_SNAPSHOT',
  'MANGA_GENERIC_MAX_QUOTE_AGE_MS',
  'MANGA_GENERIC_MIN_NET_USDG',
  'MANGA_GENERIC_SEED_ETH',
  'MANGA_GENERIC_MIN_ETH_RESERVE',
  'MANGA_GENERIC_PROFIT_RETENTION_BPS',
  'MANGA_GENERIC_PREFLIGHT_CANDIDATES',
  'MANGA_GENERIC_WATCH_POLL_MS',
  'MANGA_GENERIC_WATCH_ARM_HOURS',
  'MANGA_GENERIC_WATCH_MAX_EXECUTIONS',
  'MANGA_GENERIC_WATCH_MAX_PREFLIGHTS',
  'MANGA_GENERIC_WATCH_MIN_SCREENED_NET_USDG',
  'MANGA_GENERIC_WATCH_MAX_CONSECUTIVE_ERRORS',
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
    genericBoardUrl: value('MANGA_GENERIC_BOARD_URL') || 'http://127.0.0.1:8788/api/snapshot',
    genericBoardSnapshot: value('MANGA_GENERIC_BOARD_SNAPSHOT'),
    genericMaxQuoteAgeMs: positiveInteger(value('MANGA_GENERIC_MAX_QUOTE_AGE_MS'), 45_000),
    genericMinNetUsdg: value('MANGA_GENERIC_MIN_NET_USDG') || '0.1',
    genericSeedEth: value('MANGA_GENERIC_SEED_ETH') || '0',
    genericMinEthReserve: value('MANGA_GENERIC_MIN_ETH_RESERVE') || '0.002',
    genericProfitRetentionBps: boundedBps(value('MANGA_GENERIC_PROFIT_RETENTION_BPS'), 9_500),
    genericPreflightCandidates: boundedPositiveInteger(value('MANGA_GENERIC_PREFLIGHT_CANDIDATES'), 6, 32),
    genericWatchPollMs: boundedInteger(value('MANGA_GENERIC_WATCH_POLL_MS'), 1_000, 250, 60_000),
    genericWatchArmHours: boundedPositiveInteger(value('MANGA_GENERIC_WATCH_ARM_HOURS'), 24, 168),
    genericWatchMaxExecutions: boundedPositiveInteger(value('MANGA_GENERIC_WATCH_MAX_EXECUTIONS'), 5, 20),
    genericWatchMaxPreflights: boundedPositiveInteger(value('MANGA_GENERIC_WATCH_MAX_PREFLIGHTS'), 24, 1_000),
    genericWatchMinScreenedNetUsdg: value('MANGA_GENERIC_WATCH_MIN_SCREENED_NET_USDG'),
    genericWatchMaxConsecutiveErrors: boundedPositiveInteger(
      value('MANGA_GENERIC_WATCH_MAX_CONSECUTIVE_ERRORS'),
      10,
      100,
    ),
    rpcSource: environment.MANGA_RPC_URL ? 'environment' : rpcUrl ? 'strategy_config' : 'public_read_only_fallback',
  }
}

/** @param {string | null} value @param {number} fallback @param {number} minimum @param {number} maximum */
function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = value === null ? fallback : Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`配置值必须在 ${minimum}..${maximum}：${value}`)
  }
  return parsed
}

/** @param {string | null} value @param {number} fallback */
function positiveInteger(value, fallback) {
  if (value === null) return fallback
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`配置值必须是正整数：${value}`)
  return parsed
}

/** @param {string | null} value @param {number} fallback @param {number} maximum */
function boundedPositiveInteger(value, fallback, maximum) {
  const parsed = positiveInteger(value, fallback)
  if (parsed > maximum) throw new Error(`配置值必须在 1..${maximum}：${value}`)
  return parsed
}

/** @param {string | null} value @param {bigint} fallback */
function nonNegativeBigInt(value, fallback) {
  if (value === null) return fallback
  if (!/^\d+$/.test(value)) throw new Error('MANGA_MAX_FAILED_GAS_WEI 必须是非负整数字符串')
  return BigInt(value)
}

/** @param {string | null} value @param {number} fallback */
function boundedBps(value, fallback) {
  const parsed = positiveInteger(value, fallback)
  if (parsed > 10_000) throw new Error(`配置值必须在 1..10000 bps：${value}`)
  return parsed
}

/**
 * Live signing must not silently fall back to a public endpoint.
 * @param {ReturnType<typeof loadRuntimeConfig>} config
 * @param {{ requireWss?: boolean }} [options]
 */
export function assertLiveTransport(config, { requireWss = false } = {}) {
  if (!config.rpcUrl) throw new Error('实盘命令必须配置策略专用 MANGA_RPC_URL')
  let rpc
  try {
    rpc = new URL(config.rpcUrl)
  } catch {
    throw new Error('MANGA_RPC_URL 不是有效 URL')
  }
  if (rpc.hostname === 'rpc.mainnet.chain.robinhood.com') {
    throw new Error('官方公共 RPC 仅允许只读观察板使用；实盘精确模拟与广播必须使用策略专用 RPC')
  }
  if (requireWss && !config.wsUrl && !config.allowPollingOnly) {
    throw new Error('watch 模式必须配置 MANGA_WS_URL；仅恢复演练可显式设置 MANGA_ALLOW_POLLING_ONLY=1')
  }
}
