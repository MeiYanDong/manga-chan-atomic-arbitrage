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
  'MANGA_ALLOW_PUBLIC_EXECUTION_RPC',
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
  'MANGA_GENERIC_WATCH_AUTO_RENEW',
  'MANGA_GENERIC_WATCH_UNTIL_REVOKED',
  'MANGA_GENERIC_WATCH_RENEW_BEFORE_HOURS',
  'MANGA_GENERIC_WATCH_MAX_ATTEMPTS',
  'MANGA_GENERIC_WATCH_MAX_EXECUTIONS',
  'MANGA_GENERIC_WATCH_MAX_PREFLIGHTS',
  'MANGA_GENERIC_WATCH_MIN_SCREENED_NET_USDG',
  'MANGA_GENERIC_WATCH_MAX_CONSECUTIVE_ERRORS',
  'MANGA_WETH_SEED_ETH',
  'MANGA_WETH_MAX_AMOUNT_WETH',
  'MANGA_WETH_MIN_GROSS_PROFIT_WETH',
  'EARN_LIVE_AMOUNT_CANDIDATES',
  'EARN_LIVE_MIN_NET_WETH',
  'EARN_LIVE_MIN_HEADROOM_WETH',
  'EARN_LIVE_MAX_FAILED_GAS_WETH',
  'EARN_LIVE_WALLET_RESERVE_WETH',
  'EARN_LIVE_PROBE_POINTS',
  'EARN_WATCH_ENABLED',
  'EARN_WATCH_EVENT_POLL_MS',
  'EARN_WATCH_PERIODIC_MS',
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
  const maxAttempts = positiveInteger(value('MANGA_MAX_ATTEMPTS'), 5)
  const genericWatchArmHours = boundedPositiveInteger(value('MANGA_GENERIC_WATCH_ARM_HOURS'), 24, 168)
  const genericWatchAutoRenew = strictBoolean(value('MANGA_GENERIC_WATCH_AUTO_RENEW'), false)
  const genericWatchUntilRevoked = strictBoolean(value('MANGA_GENERIC_WATCH_UNTIL_REVOKED'), false)
  const genericWatchRenewBeforeHours = boundedPositiveInteger(value('MANGA_GENERIC_WATCH_RENEW_BEFORE_HOURS'), 6, 167)
  if (genericWatchAutoRenew && genericWatchUntilRevoked) {
    throw new Error('MANGA_GENERIC_WATCH_AUTO_RENEW 与 MANGA_GENERIC_WATCH_UNTIL_REVOKED 不能同时启用')
  }
  if (genericWatchAutoRenew && genericWatchRenewBeforeHours >= genericWatchArmHours) {
    throw new Error('MANGA_GENERIC_WATCH_RENEW_BEFORE_HOURS 必须小于 MANGA_GENERIC_WATCH_ARM_HOURS')
  }

  return {
    configPath,
    rpcUrl,
    wsUrl,
    readRpcUrl: readRpcUrl && readRpcUrl !== rpcUrl ? readRpcUrl : null,
    keychainService: value('MANGA_KEYCHAIN_SERVICE') || 'codex-rh-manga-chan-20260904',
    privateKeyFile: value('MANGA_PRIVATE_KEY_FILE'),
    runDir: value('MANGA_RUN_DIR'),
    allowPollingOnly: value('MANGA_ALLOW_POLLING_ONLY') === '1',
    allowPublicExecutionRpc: strictBoolean(value('MANGA_ALLOW_PUBLIC_EXECUTION_RPC'), false),
    finalityConfirmations: positiveInteger(value('MANGA_FINALITY_CONFIRMATIONS'), 3),
    maxAttempts,
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
    genericWatchArmHours,
    genericWatchAutoRenew,
    genericWatchUntilRevoked,
    genericWatchRenewBeforeHours,
    genericWatchMaxAttempts: positiveIntegerOrUnlimited(value('MANGA_GENERIC_WATCH_MAX_ATTEMPTS'), maxAttempts),
    genericWatchMaxExecutions: boundedPositiveIntegerOrUnlimited(value('MANGA_GENERIC_WATCH_MAX_EXECUTIONS'), 5, 20),
    genericWatchMaxPreflights: boundedPositiveIntegerOrUnlimited(
      value('MANGA_GENERIC_WATCH_MAX_PREFLIGHTS'),
      24,
      1_000,
    ),
    genericWatchMinScreenedNetUsdg: value('MANGA_GENERIC_WATCH_MIN_SCREENED_NET_USDG'),
    genericWatchMaxConsecutiveErrors: boundedPositiveInteger(
      value('MANGA_GENERIC_WATCH_MAX_CONSECUTIVE_ERRORS'),
      10,
      100,
    ),
    wethSeedEth: value('MANGA_WETH_SEED_ETH') || '0',
    wethMaxAmountWeth: value('MANGA_WETH_MAX_AMOUNT_WETH') || '1',
    wethMinGrossProfitWeth: value('MANGA_WETH_MIN_GROSS_PROFIT_WETH') || '0.000001',
    earnLiveAmountCandidates: value('EARN_LIVE_AMOUNT_CANDIDATES') || '0.0005,0.001,0.0015,0.002',
    earnLiveMinNetWeth: value('EARN_LIVE_MIN_NET_WETH') || '0.000000000000000001',
    earnLiveMinHeadroomWeth: value('EARN_LIVE_MIN_HEADROOM_WETH') || '0',
    earnLiveMaxFailedGasWeth: value('EARN_LIVE_MAX_FAILED_GAS_WETH') || '0.00012',
    earnLiveWalletReserveWeth: value('EARN_LIVE_WALLET_RESERVE_WETH') || '0.00025',
    earnLiveProbePoints: boundedInteger(value('EARN_LIVE_PROBE_POINTS'), 24, 4, 64),
    earnWatchEnabled: strictBoolean(value('EARN_WATCH_ENABLED'), false),
    earnWatchEventPollMs: boundedInteger(value('EARN_WATCH_EVENT_POLL_MS'), 4_000, 1_000, 60_000),
    earnWatchPeriodicMs: boundedInteger(value('EARN_WATCH_PERIODIC_MS'), 300_000, 30_000, 3_600_000),
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

/** @param {string | null} value @param {number | null} fallback */
function positiveIntegerOrUnlimited(value, fallback) {
  if (value === null) return fallback
  if (String(value).trim().toLowerCase() === 'unlimited') return null
  return positiveInteger(value, fallback ?? 1)
}

/** @param {string | null} value @param {number | null} fallback @param {number} maximum */
function boundedPositiveIntegerOrUnlimited(value, fallback, maximum) {
  const parsed = positiveIntegerOrUnlimited(value, fallback)
  if (parsed === null) return null
  if (parsed > maximum) throw new Error(`配置值必须是 unlimited 或在 1..${maximum}：${value}`)
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

/** @param {string | null} value @param {boolean} fallback */
function strictBoolean(value, fallback) {
  if (value === null) return fallback
  if (value === '1') return true
  if (value === '0') return false
  throw new Error(`配置值必须是 0 或 1：${value}`)
}

/**
 * Live signing must not silently fall back to a public endpoint. The explicit
 * exception exists for a reviewed outage response and remains off by default.
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
  if (rpc.hostname === 'rpc.mainnet.chain.robinhood.com' && !config.allowPublicExecutionRpc) {
    throw new Error('官方公共 RPC 仅允许只读观察板使用；实盘精确模拟与广播必须使用策略专用 RPC')
  }
  if (requireWss && !config.wsUrl && !config.allowPollingOnly) {
    throw new Error('watch 模式必须配置 MANGA_WS_URL；仅恢复演练可显式设置 MANGA_ALLOW_POLLING_ONLY=1')
  }
}
