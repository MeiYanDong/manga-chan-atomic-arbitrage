import fs from 'node:fs'
import httpServer from 'node:http'
import path from 'node:path'
import { AsyncLocalStorage } from 'node:async_hooks'
import { fileURLToPath } from 'node:url'
import {
  createPublicClient,
  defineChain,
  encodePacked,
  formatUnits,
  getAddress,
  http,
  keccak256,
  parseAbi,
  parseEther,
  parseUnits,
  toHex,
} from 'viem'
import {
  AsyncConcurrencyGate,
  CandidateWakeQueue,
  FixedBlockPromiseCache,
  ShadowWakeSource,
  applyPoolMirrorEvent,
  buildShadowDependencyIndex,
  catalogMaintenancePolicy,
  capEventWaitForReconciliation,
  coalesceLatestSwapPerPool,
  initializeIngestNeedsCatalogRefresh,
  nextHotPollDelay,
  planHotLogRange,
  quoteCyclePolicy,
  recoverStaleHotCursor,
  reconcileHotCursorAnchor,
  retryReadOnly,
  rotatingSlice,
  runRequiredWithOptional,
  routeShadowEvent,
  selectRpcRetryPolicy,
  selectPeriodicShadowCandidates,
  shouldPreemptPeriodicQuote,
} from '../src/event-driven-shadow.mjs'
import {
  BoardStatus,
  CandidateWakePriority,
  appendEvents,
  buildBoardSnapshot,
  candidateWakePriority,
  catalogIsComplete,
  chooseBestBaseOpportunity,
  compactExecutionBoardSnapshot,
  nextCycleDelay,
  normalizePairCandidate,
  normalizePersistedBoardSnapshot,
  publicError,
  reconcileOpportunityEpisodes,
  screenRoundTrip,
  screenedPositiveObservationCount,
  screenWethRoundTrip,
  usdg,
  writeExecutionBoardSnapshot,
  writeJsonAtomic,
  writeStableJsonAtomic,
} from '../src/opportunity-board.mjs'
import {
  OFFICIAL_PAIR_HOOK,
  PoolAdmission,
  PoolEvidence,
  ROBINHOOD_CHAIN_ID,
  V3_SWAP_TOPIC,
  V4_INITIALIZE_TOPIC,
  V4_POOL_MANAGER,
  V4_QUOTER,
  V4_SWAP_TOPIC,
  decodePoolManagerLog,
  decodeV3SwapLog,
  inferPairLaunchPools,
  mergeChainPools,
} from '../src/pair-catalog.mjs'
import {
  DEFAULT_AMOUNT_GRID_USDG,
  DEFAULT_PROBE_AMOUNTS_USDG,
  chooseBestAmountQuote,
  equivalentWethAmountGrid,
  eventProbeNeedsExpansion,
  formatAmountGrid,
  parseUsdgAmountGrid,
  planEventProbeAmounts,
  refinementAmounts,
  selectEventProbeAmounts,
  selectEventV4RoutePairs,
  selectV4RoutePairs,
  shouldExpandAmountGrid,
} from '../src/route-optimizer.mjs'
import { isMalformedRpcBatchResponse, isTransientRpcError } from '../src/policy.mjs'
import { readWithBoundedMulticall } from '../src/rpc-multicall.mjs'
import {
  DailyHotRpcBudget,
  HotRpcLaneDecision,
  jsonRpcCallCount,
  jsonRpcOperationLabels,
  latencyPercentiles,
  selectHotRpcLane,
  validateManagedHotRpcUrl,
} from '../src/hot-rpc-lane.mjs'
import {
  V3ShortlistCache,
  seedV3ShortlistsFromObservations,
  selectEventV3Routes,
  selectV3BootstrapRoutes,
  v3DirectionKey,
} from '../src/v3-shortlist-cache.mjs'
import { BoardStore } from '../src/board-store.mjs'
import { readPublicBusinessSnapshot } from '../src/business-operations.mjs'
import {
  buildDashboardModel,
  dashboardApiNeedsOpportunityDetails,
  dashboardApiNeedsOpportunityProjection,
  routeDashboardApi,
} from '../src/dashboard-projection.mjs'
import { resolveDashboardAsset } from '../src/dashboard-static.mjs'
import {
  AdapterRunStatus,
  DOPPLER_CREATE_TOPIC,
  LONG_LAUNCH_CREATED_TOPIC,
  SOURCE_CATALOG_RUNTIME_PROJECTION,
  SOURCE_CATALOG_SCHEMA_VERSION,
  adaptPoolManagerInitialize,
  adaptRobinhoodAssets,
  assertCompactSourceCatalogProjection,
  boundSourceCatalogPools,
  compactSourceCatalogProjectionInPlace,
  compactSourceFact,
  countVisibleDopplerLaunches,
  decodeDopplerCreateLog,
  decodeLongLauncherLog,
  markAdapterAttempt,
  markAdapterError,
  markAdapterSuccess,
  mergeDopplerTargetFacts,
  mergeSourceFacts,
  isCompactSourceCatalogProjection,
  planSourceTargetPoolRange,
  retainPoolsForSourceTargets,
  restoreAdapterStates,
  sourceTargetAddresses,
} from '../src/source-adapters.mjs'
import { SOURCE_CONTRACT_REGISTRY, SOURCE_REGISTRY_VERSION, stablePayloadHash } from '../src/source-provenance.mjs'
import { buildSourceStrategyCatalog } from '../src/source-strategy-catalog.mjs'

const CHAIN_ID = ROBINHOOD_CHAIN_ID
const PAIR_TOKENS_API = 'https://pair.fund/api/tokens'
const PAIR_STOCK_TOKENS_API = 'https://pair.fund/api/stock-tokens'
const ROBINHOOD_ASSETS_API = 'https://api.robinhood.com/rhj/assets'
const PAIR_CATALOG_PAGE_SIZE = 1_000

class PeriodicCyclePreempted extends Error {
  constructor() {
    super('periodic reconciliation yielded to a fresh pool event')
    this.name = 'PeriodicCyclePreempted'
  }
}

const USDG = getAddress('0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168')
const WETH = getAddress('0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73')
const V3_FACTORY = getAddress('0x1f7d7550B1b028f7571E69A784071F0205FD2EfA')
const V3_QUOTER = getAddress('0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7')
const MULTICALL3 = getAddress('0xcA11bde05977b3631167028862bE2a173976CA11')
const MULTICALL3_RUNTIME_CODE_HASH = '0xd5c15df687b16f2ff992fc8d767b4216323184a2bbc6ee2f9c398c318e770891'
const POOL_MANAGER = V4_POOL_MANAGER
const LONG_LAUNCHER = getAddress('0x22e99278308b393ea1260859b181ad7e78f5eeed')
const DOPPLER_AIRLOCK = getAddress('0xeb7c034704ef8dcd2d32324c1545f62fb4ad0862')
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
const V3_FEES = [100, 500, 3_000, 10_000]
const BASE_ASSETS = Object.freeze({
  USDG: Object.freeze({ symbol: 'USDG', token: USDG, bridgeToken: WETH, decimals: 6 }),
  WETH: Object.freeze({ symbol: 'WETH', token: WETH, bridgeToken: USDG, decimals: 18 }),
})
const INITIAL_PRIORITY = [
  '0x7aAd9Faa5Ee27bDEeb17D5A8c1870278824C4C59', // SIGMA
  '0x2FAa763726C4a1D0D9E6a768899D147aC4c42183', // FUND
  '0xdEc8Fb367BCC8f354e4a9E93E2816A9bd671F45c', // ASS
  '0xaCc78003fecb10e41896903DCE9BD08e49E9de0B', // PC
  '0x3363Cd5019Aa1F3E50C73086d5F5dCab3D90f558', // SPX
  '0x2a4eF4747640eba831f6EbA0d96185192DC01b3b', // CHIP
  '0xc28068cb109Dd0a0d5C6C6a925B048fEA00E31a6', // MANGA
].map((address) => address.toLowerCase())

const FACTORY_ABI = parseAbi(['function getPool(address tokenA,address tokenB,uint24 fee) view returns (address pool)'])
const V3_QUOTER_ABI = [
  {
    type: 'function',
    name: 'quoteExactInput',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'path', type: 'bytes' },
      { name: 'amountIn', type: 'uint256' },
    ],
    outputs: [
      { name: 'amountOut', type: 'uint256' },
      { name: 'sqrtPriceX96AfterList', type: 'uint160[]' },
      { name: 'initializedTicksCrossedList', type: 'uint32[]' },
      { name: 'gasEstimate', type: 'uint256' },
    ],
  },
]
const V4_QUOTER_ABI = [
  {
    type: 'function',
    name: 'quoteExactInputSingle',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          {
            name: 'poolKey',
            type: 'tuple',
            components: [
              { name: 'currency0', type: 'address' },
              { name: 'currency1', type: 'address' },
              { name: 'fee', type: 'uint24' },
              { name: 'tickSpacing', type: 'int24' },
              { name: 'hooks', type: 'address' },
            ],
          },
          { name: 'zeroForOne', type: 'bool' },
          { name: 'exactAmount', type: 'uint128' },
          { name: 'hookData', type: 'bytes' },
        ],
      },
    ],
    outputs: [
      { name: 'amountOut', type: 'uint256' },
      { name: 'gasEstimate', type: 'uint256' },
    ],
  },
]

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** @param {string | undefined} value @param {number} fallback @param {number} minimum */
function integer(value, fallback, minimum = 1) {
  if (value === undefined || value === '') return fallback
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < minimum) throw new Error(`invalid positive integer: ${value}`)
  return parsed
}

/** @param {string | undefined} value @param {number} fallback */
function numberValue(value, fallback) {
  if (value === undefined || value === '') return fallback
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`invalid non-negative number: ${value}`)
  return parsed
}

/** @param {string | undefined} value @param {boolean} fallback */
function booleanFlag(value, fallback) {
  if (value === undefined || value === '') return fallback
  if (value === '1') return true
  if (value === '0') return false
  throw new Error(`invalid boolean flag: ${value}`)
}

function loadConfig() {
  const runDir = path.resolve(process.env.MANGA_BOARD_RUN_DIR || path.join(ROOT, 'runs', 'opportunity-board'))
  const executionSnapshotPath = path.resolve(
    process.env.MANGA_BOARD_EXECUTION_SNAPSHOT || path.join(runDir, 'execution-snapshot.json'),
  )
  const businessSnapshotPath = path.resolve(
    process.env.MANGA_BOARD_BUSINESS_SNAPSHOT || path.join(runDir, 'business-snapshot.json'),
  )
  const host = process.env.MANGA_BOARD_HOST || '127.0.0.1'
  if (!['127.0.0.1', '::1'].includes(host)) throw new Error('opportunity board must bind to loopback')
  const amountGrid = parseUsdgAmountGrid(process.env.MANGA_BOARD_AMOUNT_GRID_USDG, DEFAULT_AMOUNT_GRID_USDG)
  const legacyProbe = process.env.MANGA_BOARD_AMOUNT_USDG
  const probeAmounts = parseUsdgAmountGrid(
    process.env.MANGA_BOARD_PROBE_AMOUNTS_USDG || legacyProbe,
    DEFAULT_PROBE_AMOUNTS_USDG,
  )
  const readModel = process.env.MANGA_BOARD_READ_MODEL || 'sqlite'
  if (!['sqlite', 'legacy'].includes(readModel)) throw new Error('MANGA_BOARD_READ_MODEL must be sqlite or legacy')
  const rpcUrl = process.env.MANGA_BOARD_RPC_URL || null
  const hotRpcUrl = process.env.MANGA_BOARD_HOT_RPC_URL || null
  const hotRpcEnabled = booleanFlag(process.env.MANGA_BOARD_HOT_RPC_ENABLED, false)
  validateManagedHotRpcUrl({ enabled: hotRpcEnabled, hotRpcUrl, publicRpcUrl: rpcUrl })
  return {
    rpcUrl,
    providerLabel: process.env.MANGA_BOARD_PROVIDER_LABEL || 'read-only-provider',
    hotRpcUrl,
    hotRpcEnabled,
    hotProviderLabel: process.env.MANGA_BOARD_HOT_PROVIDER_LABEL || 'managed-event-hot',
    hotRpcDailyEventCandidateCap: integer(process.env.MANGA_BOARD_HOT_RPC_DAILY_EVENT_CANDIDATES, 200),
    hotRpcDailyLogicalCallCap: integer(process.env.MANGA_BOARD_HOT_RPC_DAILY_LOGICAL_CALLS, 4_000),
    hotRpcHttpConcurrency: integer(process.env.MANGA_BOARD_HOT_RPC_HTTP_CONCURRENCY, 4),
    runDir,
    executionSnapshotPath,
    businessSnapshotPath,
    host,
    port: integer(process.env.MANGA_BOARD_PORT, 8_788),
    readModel,
    scanIntervalMs: integer(process.env.MANGA_BOARD_SCAN_INTERVAL_MS, 30_000, 5_000),
    minimumCyclePauseMs: integer(process.env.MANGA_BOARD_MIN_CYCLE_PAUSE_MS, 30_000, 0),
    catalogIntervalMs: integer(process.env.MANGA_BOARD_CATALOG_INTERVAL_MS, 300_000, 30_000),
    staleMs: integer(process.env.MANGA_BOARD_STALE_MS, 180_000, 30_000),
    batchSize: integer(process.env.MANGA_BOARD_BATCH_SIZE, 4),
    cycleMaxCandidates: integer(process.env.MANGA_BOARD_CYCLE_MAX_CANDIDATES, 4),
    protectedPeriodicCandidates: integer(process.env.MANGA_BOARD_PROTECTED_PERIODIC_CANDIDATES, 1),
    periodicV4PairLimit: integer(process.env.MANGA_BOARD_PERIODIC_V4_PAIR_LIMIT, 1),
    periodicAmountLimit: integer(process.env.MANGA_BOARD_PERIODIC_AMOUNT_LIMIT, 1),
    periodicV3RouteLimit: integer(process.env.MANGA_BOARD_PERIODIC_V3_ROUTE_LIMIT, 1),
    maxPoolsPerTarget: integer(process.env.MANGA_BOARD_MAX_POOLS_PER_TARGET, 8),
    priorityRefreshSize: integer(process.env.MANGA_BOARD_PRIORITY_REFRESH_SIZE, 2),
    topRefreshSize: integer(process.env.MANGA_BOARD_TOP_REFRESH_SIZE, 4),
    quoteConcurrency: integer(process.env.MANGA_BOARD_QUOTE_CONCURRENCY, 2),
    legConcurrency: integer(process.env.MANGA_BOARD_LEG_CONCURRENCY, 5),
    catalogConcurrency: integer(process.env.MANGA_BOARD_CATALOG_CONCURRENCY, 6),
    amountQuoteConcurrency: integer(process.env.MANGA_BOARD_AMOUNT_QUOTE_CONCURRENCY, 1),
    v3ShortlistSize: integer(process.env.MANGA_BOARD_V3_SHORTLIST_SIZE, 3),
    v3BootstrapMaxRoutes: integer(process.env.MANGA_BOARD_V3_BOOTSTRAP_MAX_ROUTES, 8),
    v4ShortlistSize: integer(process.env.MANGA_BOARD_V4_SHORTLIST_SIZE, 3),
    v3ShortlistRefreshMs: integer(process.env.MANGA_BOARD_V3_SHORTLIST_REFRESH_MS, 300_000, 30_000),
    v3ShortlistRefreshesPerCycle: integer(process.env.MANGA_BOARD_V3_SHORTLIST_REFRESHES_PER_CYCLE, 2, 0),
    fullGridEveryCycles: integer(process.env.MANGA_BOARD_FULL_GRID_EVERY_CYCLES, 0, 0),
    fullGridRefreshMs: integer(process.env.MANGA_BOARD_FULL_GRID_REFRESH_MS, 300_000),
    blockLag: BigInt(integer(process.env.MANGA_BOARD_BLOCK_LAG, 1, 0)),
    minDepthUsd: numberValue(process.env.MANGA_BOARD_MIN_DEPTH_USD, 100),
    wethBaseEnabled: booleanFlag(process.env.MANGA_BOARD_ENABLE_WETH_BASE, false),
    amountGrid,
    probeAmounts,
    overheadGas: BigInt(integer(process.env.MANGA_BOARD_OVERHEAD_GAS, 100_000, 0)),
    requestTimeoutMs: integer(process.env.MANGA_BOARD_REQUEST_TIMEOUT_MS, 15_000, 1_000),
    rpcBatchSize: integer(process.env.MANGA_BOARD_RPC_BATCH_SIZE, 20),
    rpcBatchWaitMs: integer(process.env.MANGA_BOARD_RPC_BATCH_WAIT_MS, 10, 0),
    rpcHttpConcurrency: integer(process.env.MANGA_BOARD_RPC_HTTP_CONCURRENCY, 2),
    rpcLogicalAttempts: integer(process.env.MANGA_BOARD_RPC_LOGICAL_ATTEMPTS, 3),
    rpcRetryDelayMs: integer(process.env.MANGA_BOARD_RPC_RETRY_DELAY_MS, 200, 0),
    multicallMaxCalls: integer(process.env.MANGA_BOARD_MULTICALL_MAX_CALLS, 4),
    eventPollMs: integer(process.env.MANGA_BOARD_EVENT_POLL_MS, 4_000, 1_000),
    eventConfirmations: BigInt(integer(process.env.MANGA_BOARD_EVENT_CONFIRMATIONS, 2, 0)),
    eventMaxBlockRange: BigInt(integer(process.env.MANGA_BOARD_EVENT_MAX_BLOCK_RANGE, 200)),
    eventMaxLagBlocks: BigInt(integer(process.env.MANGA_BOARD_EVENT_MAX_LAG_BLOCKS, 500)),
    eventWakeMaxCandidates: integer(process.env.MANGA_BOARD_EVENT_WAKE_MAX_CANDIDATES, 1),
    eventWakeMaxAgeMs: integer(process.env.MANGA_BOARD_EVENT_WAKE_MAX_AGE_MS, 20_000, 1_000),
    eventV4PairLimit: integer(process.env.MANGA_BOARD_EVENT_V4_PAIR_LIMIT, 1),
    eventAmountLimit: integer(process.env.MANGA_BOARD_EVENT_AMOUNT_LIMIT, 2),
    eventV3ShortlistSize: integer(process.env.MANGA_BOARD_EVENT_V3_SHORTLIST_SIZE, 1),
    eventRpcLogicalAttempts: integer(process.env.MANGA_BOARD_EVENT_RPC_LOGICAL_ATTEMPTS, 2),
    eventRpcRetryDelayMs: integer(process.env.MANGA_BOARD_EVENT_RPC_RETRY_DELAY_MS, 200, 0),
    eventV3MaxAddresses: integer(process.env.MANGA_BOARD_EVENT_V3_MAX_ADDRESSES, 200),
    eventReorgLookback: BigInt(integer(process.env.MANGA_BOARD_EVENT_REORG_LOOKBACK, 12)),
    chainCatalogStartBlock: BigInt(integer(process.env.MANGA_BOARD_CHAIN_CATALOG_START_BLOCK, 45_000_000, 0)),
    chainCatalogBlockRange: BigInt(integer(process.env.MANGA_BOARD_CHAIN_CATALOG_BLOCK_RANGE, 50_000)),
    chainCatalogBatchesPerCycle: integer(process.env.MANGA_BOARD_CHAIN_CATALOG_BATCHES_PER_CYCLE, 1),
    sourceCatalogStartBlock: BigInt(integer(process.env.MANGA_BOARD_SOURCE_CATALOG_START_BLOCK, 45_000_000, 0)),
    sourceCatalogBlockRange: BigInt(integer(process.env.MANGA_BOARD_SOURCE_CATALOG_BLOCK_RANGE, 50_000)),
    sourceCatalogBatchesPerCycle: integer(process.env.MANGA_BOARD_SOURCE_CATALOG_BATCHES_PER_CYCLE, 1),
  }
}

/** @param {number} concurrency @param {any[]} values @param {(value: any, index: number) => Promise<any>} operation */
async function mapLimit(concurrency, values, operation) {
  const output = new Array(values.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor
      cursor += 1
      output[index] = await operation(values[index], index)
    }
  })
  await Promise.all(workers)
  return output
}

/** @param {string} url @param {number} timeoutMs */
async function fetchJson(url, timeoutMs) {
  let lastError = null
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { accept: 'application/json', 'user-agent': 'manga-opportunity-board/0.2' },
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!response.ok) throw new Error(`metadata HTTP ${response.status}`)
      return await response.json()
    } catch (error) {
      lastError = error
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt))
    }
  }
  throw lastError
}

/** @param {string} left @param {string} right */
function addressBefore(left, right) {
  return BigInt(left) < BigInt(right)
}

/** @param {string} tokenIn @param {number} fee @param {string} tokenOut */
function v3Path(tokens, fees) {
  if (tokens.length !== fees.length + 1 || fees.length === 0) throw new Error('invalid V3 path shape')
  const types = ['address']
  const values = [tokens[0]]
  for (let index = 0; index < fees.length; index += 1) {
    types.push('uint24', 'address')
    values.push(fees[index], tokens[index + 1])
  }
  return encodePacked(types, values)
}

/** @param {bigint} amountWei @param {Record<string, any>} fixed */
function normalizeWethToUsdg(amountWei, fixed) {
  if (amountWei < 0n) {
    const absolute = -amountWei
    return -((absolute * fixed.nativeMark.amountOut + fixed.nativeMarkIn - 1n) / fixed.nativeMarkIn)
  }
  return (amountWei * fixed.nativeMark.amountOut) / fixed.nativeMarkIn
}

/** @param {bigint | null | undefined} value @param {number} decimals */
function formatBaseAmount(value, decimals) {
  return value === null || value === undefined ? null : formatUnits(value, decimals)
}

/** @param {Record<string, any>} lane */
function legacyUsdgLane(lane) {
  return {
    status: lane.status,
    quotedAt: lane.quotedAt,
    blockNumber: lane.blockNumber,
    blockHash: lane.blockHash,
    route: lane.route,
    routeKey: lane.routeKey,
    amountInUsdg: lane.amountInBase,
    amountOutUsdg: lane.amountOutBase,
    grossProfitUsdg: lane.grossProfitBase,
    gasCostProxyUsdg: lane.gasCostProxyBase,
    screenedNetUsdg: lane.screenedNetBase,
    gasPriceWei: lane.gasPriceWei,
    gasUnitsProxy: lane.gasUnitsProxy,
    quoterGasUnits: lane.quoterGasUnits,
    minimumRouteDepthUsd: lane.minimumRouteDepthUsd,
    routeExecutionAdmission: lane.routeExecutionAdmission,
    amountQuotes: (lane.amountQuotes || []).map((quote) => ({
      ...quote,
      amountInUsdg: quote.amountInBase,
      amountOutUsdg: quote.amountOutBase,
      grossProfitUsdg: quote.grossProfitBase,
      gasCostProxyUsdg: quote.gasCostProxyBase,
      screenedNetUsdg: quote.screenedNetBase,
    })),
    amountGridUsdg: lane.amountGridBase,
    optimizationMode: lane.optimizationMode,
    fullGridAt: lane.fullGridAt,
    entryV3Path: lane.entryV3Path,
    exitV3Path: lane.exitV3Path,
    entryV3Tokens: lane.entryV3Tokens,
    exitV3Tokens: lane.exitV3Tokens,
    entryV3Pools: lane.entryV3Pools,
    exitV3Pools: lane.exitV3Pools,
    entryV3Fees: lane.entryV3Fees,
    exitV3Fees: lane.exitV3Fees,
    legs: lane.legs,
    failures: lane.failures,
    v3RoutePolicy: lane.v3RoutePolicy,
    evidenceLevel: lane.evidenceLevel,
    executionEstimate: lane.executionEstimate,
    receiptEvidence: lane.receiptEvidence,
  }
}

/** @param {string} file */
function readJson(file) {
  if (!fs.existsSync(file)) return null
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

/** @param {Record<string, any>} item */
function observationFromItem(item) {
  const keys = [
    'status',
    'underlyingStatus',
    'quotedAt',
    'blockNumber',
    'blockHash',
    'route',
    'routeKey',
    'amountInUsdg',
    'amountOutUsdg',
    'grossProfitUsdg',
    'gasCostProxyUsdg',
    'screenedNetUsdg',
    'gasPriceWei',
    'gasUnitsProxy',
    'quoterGasUnits',
    'minimumRouteDepthUsd',
    'legs',
    'amountQuotes',
    'amountGridUsdg',
    'optimizationMode',
    'fullGridAt',
    'entryV3Path',
    'exitV3Path',
    'entryV3Tokens',
    'exitV3Tokens',
    'entryV3Pools',
    'exitV3Pools',
    'entryV3Fees',
    'exitV3Fees',
    'failures',
    'evidenceLevel',
    'executionEstimate',
    'receiptEvidence',
    'quoteTrigger',
    'routeExecutionAdmission',
    'v3RoutePolicy',
    'baseOpportunities',
    'preferredBaseAsset',
    'preferredNormalizedScreenedNetUsdg',
  ]
  return Object.fromEntries(keys.filter((key) => item[key] !== undefined).map((key) => [key, item[key]]))
}

/** @param {unknown} error */
function quoteTransportIsIncomplete(error) {
  return isTransientRpcError(error)
}

/** @param {string} message @param {unknown} cause */
function incompleteRpcError(message, cause) {
  const error = new Error(message)
  error.cause = cause
  return error
}

class OpportunityBoard {
  /** @param {ReturnType<typeof loadConfig>} config */
  constructor(config) {
    this.config = config
    this.startedAt = new Date().toISOString()
    this.snapshotPath = path.join(config.runDir, 'snapshot.json')
    this.executionSnapshotPath = config.executionSnapshotPath
    this.eventsPath = path.join(config.runDir, 'events.jsonl')
    this.statePath = path.join(config.runDir, 'state.json')
    this.hotRpcBudgetPath = path.join(config.runDir, 'hot-rpc-budget.json')
    this.chainCatalogPath = path.join(config.runDir, 'chain-catalog.json')
    this.sourceCatalogPath = path.join(config.runDir, 'source-catalog.json')
    this.poolMirrorPath = path.join(config.runDir, 'pool-mirror.json')
    this.dashboardRoot = path.join(ROOT, 'public', 'dashboard')
    const dashboardIndex = path.join(this.dashboardRoot, 'index.html')
    this.html = fs.readFileSync(
      fs.existsSync(dashboardIndex) ? dashboardIndex : path.join(ROOT, 'public', 'opportunity-board.html'),
      'utf8',
    )
    const persistedState = readJson(this.statePath) || {}
    const persistedChainCatalog = readJson(this.chainCatalogPath) || {}
    let persistedSourceCatalog = readJson(this.sourceCatalogPath) || {}
    const compactedStartupCatalog = isCompactSourceCatalogProjection(persistedSourceCatalog)
      ? { sourceCatalog: persistedSourceCatalog, changed: false }
      : compactSourceCatalogProjectionInPlace(persistedSourceCatalog)
    persistedSourceCatalog = compactedStartupCatalog.sourceCatalog
    const boundedStartupCatalog = boundSourceCatalogPools(persistedSourceCatalog)
    persistedSourceCatalog = boundedStartupCatalog.sourceCatalog
    const startupRetention = boundedStartupCatalog.retention
    if (compactedStartupCatalog.changed || boundedStartupCatalog.changed) {
      writeStableJsonAtomic(this.sourceCatalogPath, persistedSourceCatalog)
    }
    assertCompactSourceCatalogProjection(persistedSourceCatalog)
    this.store = new BoardStore({
      runDir: config.runDir,
      legacySnapshotPath: this.snapshotPath,
      sourceCatalogPath: this.sourceCatalogPath,
    })
    this.persistenceState = { ...this.store.health(), lastCommitAt: null, lastError: null, parity: null }
    this.previousSnapshot = normalizePersistedBoardSnapshot(
      this.store.readCurrentSnapshot() || readJson(this.snapshotPath),
    )
    this.snapshot = this.previousSnapshot
    this.observations = new Map(
      (this.previousSnapshot?.items || [])
        .filter((item) => item.quotedAt)
        .map((item) => [item.id, observationFromItem(item)]),
    )
    this.rawTokens = new Map()
    this.catalog = []
    this.stockAddresses = new Set()
    this.pairStockAddresses = new Set()
    this.robinhoodStockAddresses = new Set(persistedSourceCatalog.assetRegistry?.addresses || [])
    this.stockAddresses = new Set(this.robinhoodStockAddresses)
    this.quoteAssets = new Map()
    this.chainPools = Array.isArray(persistedChainCatalog.pools) ? persistedChainCatalog.pools : []
    this.chainAmbiguities = Array.isArray(persistedChainCatalog.ambiguities) ? persistedChainCatalog.ambiguities : []
    this.chainCatalogNextBlock = BigInt(
      persistedState.chainCatalogNextBlock || config.chainCatalogStartBlock.toString(),
    )
    if (this.chainCatalogNextBlock < config.chainCatalogStartBlock) {
      this.chainCatalogNextBlock = config.chainCatalogStartBlock
    }
    this.chainCatalogSafeHead = persistedChainCatalog.coverage?.safeHead || null
    this.chainCatalogComplete = persistedChainCatalog.coverage?.status === 'COMPLETE_FROM_CONFIGURED_START'
    this.chainCatalogLastError = null
    this.longLaunches = Array.isArray(persistedSourceCatalog.longLaunches) ? persistedSourceCatalog.longLaunches : []
    this.dopplerTargetIndex = Array.isArray(persistedSourceCatalog.dopplerTargetIndex)
      ? persistedSourceCatalog.dopplerTargetIndex
      : []
    this.dopplerLaunches = []
    this.visibleDopplerLaunchCount = 0
    this.pairListings = Array.isArray(persistedSourceCatalog.pairListings) ? persistedSourceCatalog.pairListings : []
    const persistedGenericPools = Array.isArray(persistedSourceCatalog.pools) ? persistedSourceCatalog.pools : []
    this.genericPools = retainPoolsForSourceTargets(
      persistedGenericPools,
      sourceTargetAddresses({
        pairListings: this.pairListings,
        longLaunches: this.longLaunches,
        dopplerLaunches: this.dopplerLaunches,
        dopplerTargetIndex: this.dopplerTargetIndex,
      }),
    )
    this.sourcePoolRetention = startupRetention
    this.sourceEvidence = Array.isArray(persistedSourceCatalog.evidence) ? persistedSourceCatalog.evidence : []
    this.sourceAdapterCursors = {
      'long.launcher.v1': BigInt(
        persistedState.sourceAdapterCursors?.['long.launcher.v1'] || config.sourceCatalogStartBlock.toString(),
      ),
      'doppler.registry.v1': BigInt(
        persistedState.sourceAdapterCursors?.['doppler.registry.v1'] || config.sourceCatalogStartBlock.toString(),
      ),
      'uniswap-v4.pool-manager.v1': BigInt(
        persistedState.sourceAdapterCursors?.['uniswap-v4.pool-manager.v1'] ||
          config.sourceCatalogStartBlock.toString(),
      ),
    }
    for (const adapterId of Object.keys(this.sourceAdapterCursors)) {
      if (this.sourceAdapterCursors[adapterId] < config.sourceCatalogStartBlock) {
        this.sourceAdapterCursors[adapterId] = config.sourceCatalogStartBlock
      }
    }
    const adapterStateOptions = { configuredStartBlock: config.sourceCatalogStartBlock }
    const baselineAdapterStates = restoreAdapterStates({}, adapterStateOptions)
    this.adapterStates = restoreAdapterStates(persistedSourceCatalog.adapters, adapterStateOptions)
    if (
      !persistedSourceCatalog.adapters?.['pair.chain-catalog.v1'] &&
      persistedSourceCatalog.adapters?.['uniswap-v4.pool-manager.v1']
    ) {
      this.adapterStates['pair.chain-catalog.v1'] = {
        ...baselineAdapterStates['pair.chain-catalog.v1'],
        ...persistedSourceCatalog.adapters['uniswap-v4.pool-manager.v1'],
        adapterId: baselineAdapterStates['pair.chain-catalog.v1'].adapterId,
        label: baselineAdapterStates['pair.chain-catalog.v1'].label,
        claimScope: baselineAdapterStates['pair.chain-catalog.v1'].claimScope,
        capabilities: baselineAdapterStates['pair.chain-catalog.v1'].capabilities,
      }
    }
    if (!persistedState.sourceAdapterCursors?.['uniswap-v4.pool-manager.v1']) {
      this.adapterStates['uniswap-v4.pool-manager.v1'] = baselineAdapterStates['uniswap-v4.pool-manager.v1']
    }
    const launchCoverageCursor =
      this.sourceAdapterCursors['long.launcher.v1'] < this.sourceAdapterCursors['doppler.registry.v1']
        ? this.sourceAdapterCursors['long.launcher.v1']
        : this.sourceAdapterCursors['doppler.registry.v1']
    if (this.sourceAdapterCursors['uniswap-v4.pool-manager.v1'] > launchCoverageCursor) {
      this.sourceAdapterCursors['uniswap-v4.pool-manager.v1'] = launchCoverageCursor
    }
    this.refreshDopplerVisibility()
    this.sourceCatalogSafeHead = persistedSourceCatalog.safeHead || null
    this.chainAttestations = new Map()
    this.feeCache = new Map()
    this.v3PoolDiscoveryCache = new FixedBlockPromiseCache()
    this.v3RouteShortlistCache = new FixedBlockPromiseCache()
    this.v3QuoteCache = new FixedBlockPromiseCache()
    this.v4QuoteCache = new FixedBlockPromiseCache()
    this.v4RouteShortlistCache = new FixedBlockPromiseCache()
    this.v3PersistentShortlists = new V3ShortlistCache({
      maxRoutes: config.v3ShortlistSize,
      refreshMs: config.v3ShortlistRefreshMs,
    })
    this.v3PersistentSeededRoutes = seedV3ShortlistsFromObservations(this.v3PersistentShortlists, this.observations, {
      USDG,
      WETH,
    })
    this.v3ShortlistRefreshBudget = 0
    this.cursor = Number(persistedState.cursor || 0)
    this.cycleNumber = Number(persistedState.cycleNumber || 0)
    this.hotCursor = persistedState.hotCursor || {
      nextBlock: null,
      lastProcessedBlock: null,
      lastProcessedBlockHash: null,
      reorgCount: 0,
    }
    this.eventQueue = new CandidateWakeQueue()
    this.dependencyIndex = buildShadowDependencyIndex([], this.observations)
    this.poolMirror = readJson(this.poolMirrorPath) || {}
    this.eventMetrics = {
      mode:
        config.hotRpcEnabled && config.hotRpcUrl
          ? 'PUBLIC_HTTP_LOG_POLLING_WITH_MANAGED_EVENT_QUOTES'
          : 'PUBLIC_HTTP_BOUNDED_LOG_POLLING',
      scheduler: 'INDEPENDENT_HOT_POLL_PLUS_PROTECTED_RECONCILIATION',
      startedAt: this.startedAt,
      polls: 0,
      rpcLogCalls: 0,
      logsSeen: 0,
      logsCoalesced: 0,
      relevantLogs: 0,
      dedupedLogs: 0,
      candidateWakes: 0,
      eventQuoteCandidates: 0,
      eventLiveCompatibleCandidatesSelected: 0,
      eventExecutorShapeCandidatesSelected: 0,
      eventShadowOnlyCandidatesSelected: 0,
      lastSelectedWakeTier: null,
      eventFastPathCandidates: 0,
      eventFastPathAmounts: 0,
      eventFastPathPairs: 0,
      eventFastPathMisses: 0,
      periodicProbeCandidates: 0,
      periodicProbeAmounts: 0,
      periodicProbePairs: 0,
      staleEventCandidateDrops: 0,
      deferredInitializeCatalogRefreshes: 0,
      lastDeferredInitializeCatalogRefreshAt: null,
      periodicPreemptions: 0,
      lastPeriodicPreemptedAt: null,
      lastPeriodicPreemptQuoterCalls: 0,
      lastPollAt: null,
      lastEventAt: null,
      lastEventToQuoteMs: null,
      lastError: null,
      consecutiveErrors: 0,
      lastCycleTrigger: null,
      lastCycleCandidateCount: 0,
      lastCycleQuoterCalls: 0,
      lastPeriodicCycleAt: null,
      nextPeriodicCycleAt: null,
      headLagBlocks: null,
      cursorFastForwards: Number(this.hotCursor.fastForwardCount || 0),
      skippedRealtimeBlocks: BigInt(this.hotCursor.skippedRealtimeBlocks || 0).toString(),
      lastCoverageGap: this.hotCursor.lastCoverageGap || null,
      eventDrivenQuoterCalls: 0,
      reconciliationQuoterCalls: 0,
      executionFeedCheckpoints: 0,
      lastExecutionFeedCheckpointAt: null,
      lastExecutionFeedCheckpointCandidateCount: 0,
      managedEventQuoteCycles: 0,
      publicEventQuoteCycles: 0,
      hotRpcBudgetFallbackCycles: 0,
      hotRpcTransientFallbackCycles: 0,
      lastEventQuoteRpcRole: null,
      lastEventQuoteRpcFallbackReason: null,
      eventAdaptiveProbeExpansions: 0,
      eventDeferredAmountQuotesAvoided: 0,
      eventParallelBaseCycles: 0,
      lastPollTiming: null,
      lastRelevantPollTiming: null,
      eventCycleLatency: {
        semantics: 'PUBLIC_LOG_POLL_START_TO_FIXED_BLOCK_QUOTE_COMPLETION',
        latest: null,
        phases: {},
      },
    }
    this.quoteRpcMetrics = {
      rpcHttpPosts: 0,
      rpcHttpPeakConcurrency: 0,
      rpcLogicalRetries: 0,
      v3FactoryReads: 0,
      v3FactoryCacheHits: 0,
      v3QuoterCalls: 0,
      v3QuoterCacheHits: 0,
      v3ShortlistDiscoveries: 0,
      v3ShortlistHits: 0,
      v3PersistentShortlistHits: 0,
      v3PersistentShortlistStaleUses: 0,
      v3PersistentShortlistRefreshes: 0,
      v3PersistentShortlistRebuilds: 0,
      v3PersistentShortlistInvalidations: 0,
      v3PersistentSeededRoutes: this.v3PersistentSeededRoutes,
      eventV3RoutesQuoted: 0,
      eventV3TopologyMisses: 0,
      eventRpcLogicalRetries: 0,
      v3BoundedBootstraps: 0,
      v3BoundedBootstrapRoutes: 0,
      v3BoundedBootstrapMisses: 0,
      v4QuoterCalls: 0,
      v4QuoterCacheHits: 0,
      v4ShortlistDiscoveries: 0,
      v4ShortlistHits: 0,
      v4ShortlistRebuilds: 0,
      multicallRpcBatches: 0,
      multicallSubcalls: 0,
      multicallFailures: 0,
      multicallFailedSubcalls: 0,
      multicallDirectFallbacks: 0,
      multicallDirectRecoveries: 0,
      multicallTransientStops: 0,
      multicallCodeHash: null,
      rpcBatchFallbacks: 0,
    }
    this.hotRpcTransportMetrics = {
      httpPosts: 0,
      logicalCalls: 0,
      httpFailures: 0,
      publicFallbackPosts: 0,
      publicFallbackLogicalCalls: 0,
      lastUsedAt: null,
      lastFailureAt: null,
      lastFallbackAt: null,
      lastFallbackReason: null,
    }
    this.hotRpcLatencySamples = []
    this.hotRpcOperationLatencySamples = new Map()
    this.hotRpcOperationCounts = new Map()
    this.eventCycleLatencySamples = new Map()
    this.catalogRefreshRequested = false
    this.rpcHttpGate = new AsyncConcurrencyGate(config.rpcHttpConcurrency)
    this.hotRpcHttpGate = new AsyncConcurrencyGate(config.hotRpcHttpConcurrency)
    this.eventLedgerEpoch = persistedState.eventLedgerEpoch || null
    this.lastCatalogAt = null
    this.lastFullCatalogAt = null
    this.lastCycleAt = null
    this.lastQuoteAt = null
    this.consecutiveErrors = 0
    this.lastError = null
    this.cycleRpcFailure = null
    this.inCycle = false
    this.stopping = false
    this.server = null
    this.dashboardCache = null
    this.sleepTimer = null
    this.sleepResolve = null
    this.hotPollSleepTimer = null
    this.hotPollSleepResolve = null
    this.hotPollTask = null
    this.rpcCallContext = new AsyncLocalStorage()
    this.client = null
    this.unbatchedClient = null
    this.hotClient = null
    this.multicallVerifiedAtBlock = null
    this.rpcTransportMode = config.rpcBatchSize > 1 ? 'BATCH' : 'INDIVIDUAL'
    this.rpcBatchFallbackAt = null
    this.rpcBatchFallbackReason = null
    this.strategyGraph = null
    this.rebuildCatalogFromSources()
    this.latestSourceCatalog = this.sourceCatalogProjection(
      this.sourceCatalogSafeHead,
      persistedSourceCatalog.generatedAt || this.startedAt,
    )
    const persistedCatalog = writeStableJsonAtomic(this.sourceCatalogPath, this.latestSourceCatalog)
    this.latestSourceCatalogHash = persistedCatalog.hash
    this.latestSourceCatalogBytes = persistedCatalog.bytes
    this.hotRpcBudget = new DailyHotRpcBudget({
      dailyEventCandidateCap: config.hotRpcDailyEventCandidateCap,
      dailyLogicalCallCap: config.hotRpcDailyLogicalCallCap,
      persisted: readJson(this.hotRpcBudgetPath),
      onChange: (state) => {
        if (fs.existsSync(config.runDir)) writeJsonAtomic(this.hotRpcBudgetPath, state)
      },
    })
    if (config.rpcUrl) {
      const chain = defineChain({
        id: CHAIN_ID,
        name: 'Robinhood Chain',
        nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
        rpcUrls: { default: { http: [config.rpcUrl] } },
      })
      const publicFetch = (...args) =>
        this.rpcHttpGate.run(async () => {
          this.throwIfPeriodicPreempted()
          this.quoteRpcMetrics.rpcHttpPosts += 1
          this.quoteRpcMetrics.rpcHttpPeakConcurrency = Math.max(
            this.quoteRpcMetrics.rpcHttpPeakConcurrency,
            this.rpcHttpGate.active,
          )
          return fetch(...args)
        })
      const transportOptions = (useBatch) => ({
        ...(useBatch ? { batch: { batchSize: config.rpcBatchSize, wait: config.rpcBatchWaitMs } } : {}),
        fetchFn: publicFetch,
        timeout: 20_000,
        retryCount: 1,
      })
      const rpcClient = (useBatch) =>
        createPublicClient({
          chain,
          transport: http(config.rpcUrl, transportOptions(useBatch)),
        })
      this.unbatchedClient = rpcClient(false)
      this.client = config.rpcBatchSize > 1 ? rpcClient(true) : this.unbatchedClient
      if (config.hotRpcEnabled && config.hotRpcUrl) {
        this.hotClient = createPublicClient({
          chain,
          transport: http(config.hotRpcUrl, {
            fetchFn: async (_input, init) => {
              this.throwIfPeriodicPreempted()
              const logicalCalls = jsonRpcCallCount(init?.body)
              const operationLabels = jsonRpcOperationLabels(init?.body, {
                [V3_QUOTER]: 'V3_QUOTER',
                [V4_QUOTER]: 'V4_QUOTER',
                [MULTICALL3]: 'MULTICALL3',
              })
              const debit = this.hotRpcBudget.consumeLogicalCalls(logicalCalls)
              if (!debit.consumed) {
                const context = this.rpcCallContext.getStore()
                if (context?.hotRpcRouting) {
                  context.hotRpcRouting.active = false
                  context.hotRpcRouting.fallbackReason = debit.reason
                }
                this.hotRpcTransportMetrics.publicFallbackPosts += 1
                this.hotRpcTransportMetrics.publicFallbackLogicalCalls += logicalCalls
                this.hotRpcTransportMetrics.lastFallbackAt = new Date().toISOString()
                this.hotRpcTransportMetrics.lastFallbackReason = debit.reason
                return publicFetch(config.rpcUrl, init)
              }
              const startedAt = performance.now()
              this.hotRpcTransportMetrics.httpPosts += 1
              this.hotRpcTransportMetrics.logicalCalls += logicalCalls
              this.hotRpcTransportMetrics.lastUsedAt = new Date().toISOString()
              try {
                const response = await this.hotRpcHttpGate.run(() => fetch(config.hotRpcUrl, init))
                if (!response.ok) {
                  this.hotRpcTransportMetrics.httpFailures += 1
                  this.hotRpcTransportMetrics.lastFailureAt = new Date().toISOString()
                }
                return response
              } catch (error) {
                this.hotRpcTransportMetrics.httpFailures += 1
                this.hotRpcTransportMetrics.lastFailureAt = new Date().toISOString()
                throw error
              } finally {
                const elapsedMs = performance.now() - startedAt
                this.hotRpcLatencySamples.push(elapsedMs)
                if (this.hotRpcLatencySamples.length > 512) this.hotRpcLatencySamples.shift()
                this.recordHotRpcOperationLatency(operationLabels, elapsedMs)
              }
            },
            timeout: config.requestTimeoutMs,
            retryCount: 0,
          }),
        })
      }
    }
  }

  quoteClient() {
    return this.rpcCallContext.getStore()?.hotRpcRouting?.active === true && this.hotClient
      ? this.hotClient
      : this.client
  }

  /** @param {string} reason */
  fallBackFromHotRpc(reason) {
    const context = this.rpcCallContext.getStore()
    if (!context?.hotRpcRouting?.active) return false
    context.hotRpcRouting.active = false
    context.hotRpcRouting.fallbackReason = reason
    this.hotRpcTransportMetrics.lastFallbackAt = new Date().toISOString()
    this.hotRpcTransportMetrics.lastFallbackReason = reason
    return true
  }

  eventQuoteRpcRole() {
    const context = this.rpcCallContext.getStore()
    if (!context?.eventHotPath) return 'PUBLIC_PERIODIC'
    if (!context.hotRpcRouting?.selected) return context.hotRpcRouting?.decision || 'PUBLIC_EVENT'
    return context.hotRpcRouting.fallbackReason ? 'MANAGED_THEN_PUBLIC_FALLBACK' : HotRpcLaneDecision.MANAGED
  }

  /** @param {string[]} labels @param {number} elapsedMs */
  recordHotRpcOperationLatency(labels, elapsedMs) {
    for (const label of labels) {
      this.hotRpcOperationCounts.set(label, (this.hotRpcOperationCounts.get(label) || 0) + 1)
      const samples = this.hotRpcOperationLatencySamples.get(label) || []
      samples.push(elapsedMs)
      if (samples.length > 128) samples.shift()
      this.hotRpcOperationLatencySamples.set(label, samples)
    }
  }

  /** @param {Record<string, number>} timing */
  recordEventCycleLatency(timing) {
    for (const [phase, elapsedMs] of Object.entries(timing)) {
      if (!Number.isFinite(elapsedMs) || elapsedMs < 0) continue
      const samples = this.eventCycleLatencySamples.get(phase) || []
      samples.push(elapsedMs)
      if (samples.length > 128) samples.shift()
      this.eventCycleLatencySamples.set(phase, samples)
    }
    this.eventMetrics.eventCycleLatency = {
      semantics: 'PUBLIC_LOG_POLL_START_TO_FIXED_BLOCK_QUOTE_COMPLETION',
      latest: timing,
      phases: Object.fromEntries(
        [...this.eventCycleLatencySamples.entries()]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([phase, samples]) => [phase, latencyPercentiles(samples)]),
      ),
    }
  }

  hotRpcState() {
    return {
      enabled: this.config.hotRpcEnabled,
      endpointConfigured: Boolean(this.config.hotRpcUrl),
      providerLabel: this.config.hotProviderLabel,
      selectionPolicy: 'EVENT_ONLY_EXECUTOR_COMPATIBLE_OR_EXECUTOR_SHAPE',
      fallbackProviderLabel: this.config.providerLabel,
      fallbackPolicy: 'PUBLIC_ON_DAILY_CAP_OR_TRANSIENT_FAILURE',
      expansionPolicy: 'MANUAL_ONLY_AFTER_CANONICAL_RECEIPT_NET_AND_PROVIDER_COST_REVIEW',
      budget: this.hotRpcBudget.snapshot(),
      transport: {
        ...this.hotRpcTransportMetrics,
        peakConcurrency: this.hotRpcHttpGate.peak,
        configuredConcurrency: this.config.hotRpcHttpConcurrency,
        latency: latencyPercentiles(this.hotRpcLatencySamples),
        operations: Object.fromEntries(
          [...this.hotRpcOperationLatencySamples.entries()]
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([label, samples]) => [
              label,
              { logicalCalls: this.hotRpcOperationCounts.get(label) || 0, latency: latencyPercentiles(samples) },
            ]),
        ),
        metricCaveat: 'logical calls are JSON-RPC operations, not provider request units or USD cost',
      },
    }
  }

  serviceState(status = this.catalog.length > 0 ? 'RUNNING' : 'STARTING') {
    return {
      status,
      startedAt: this.startedAt,
      lastCycleAt: this.lastCycleAt,
      lastCatalogAt: this.lastCatalogAt,
      lastQuoteAt: this.lastQuoteAt,
      cycleNumber: this.cycleNumber,
      consecutiveErrors: this.consecutiveErrors,
      lastError: this.lastError,
      pid: process.pid,
      listen: `${this.config.host}:${this.config.port}`,
      signerLoaded: false,
      persistence: this.persistenceState,
      eventDrivenShadow: {
        ...this.eventMetrics,
        rpcTransport: {
          mode: 'BOUNDED_HTTP_JSON_RPC_BATCH',
          batchSize: this.config.rpcBatchSize,
          batchWaitMs: this.config.rpcBatchWaitMs,
          maxHttpConcurrency: this.config.rpcHttpConcurrency,
          multicallMaxCalls: this.config.multicallMaxCalls,
          v3BootstrapMaxRoutes: this.config.v3BootstrapMaxRoutes,
          v4ShortlistSize: this.config.v4ShortlistSize,
          activeMode: this.rpcTransportMode,
          fallbackAt: this.rpcBatchFallbackAt,
          fallbackReason: this.rpcBatchFallbackReason,
          metricCaveat: 'rpcHttpPosts are transport requests, not provider billing units',
        },
        pendingCandidates: this.eventQueue.size,
        eventQuoteRpc: this.hotRpcState(),
        nextBlock: this.hotCursor.nextBlock,
        reorgCount: Number(this.hotCursor.reorgCount || 0),
        limits: {
          eventWakeMaxCandidates: this.config.eventWakeMaxCandidates,
          eventWakeMaxAgeMs: this.config.eventWakeMaxAgeMs,
          eventV4PairLimit: this.config.eventV4PairLimit,
          eventAmountLimit: this.config.eventAmountLimit,
          eventV3ShortlistSize: this.config.eventV3ShortlistSize,
          eventRpcLogicalAttempts: this.config.eventRpcLogicalAttempts,
          eventRpcRetryDelayMs: this.config.eventRpcRetryDelayMs,
          cycleMaxCandidates: this.config.cycleMaxCandidates,
          protectedPeriodicCandidates: this.config.protectedPeriodicCandidates,
          periodicV4PairLimit: this.config.periodicV4PairLimit,
          periodicAmountLimit: this.config.periodicAmountLimit,
          periodicV3RouteLimit: this.config.periodicV3RouteLimit,
          maxPoolsPerTarget: this.config.maxPoolsPerTarget,
          eventMaxBlockRange: this.config.eventMaxBlockRange.toString(),
          eventMaxLagBlocks: this.config.eventMaxLagBlocks.toString(),
          quoteConcurrency: this.config.quoteConcurrency,
          legConcurrency: this.config.legConcurrency,
          amountQuoteConcurrency: this.config.amountQuoteConcurrency,
          rpcLogicalAttempts: this.config.rpcLogicalAttempts,
          rpcRetryDelayMs: this.config.rpcRetryDelayMs,
          multicallMaxCalls: this.config.multicallMaxCalls,
          v3ShortlistRefreshMs: this.config.v3ShortlistRefreshMs,
          v3ShortlistRefreshesPerCycle: this.config.v3ShortlistRefreshesPerCycle,
        },
        quoteRpcTotals: { ...this.quoteRpcMetrics, v3PersistentShortlists: this.v3PersistentShortlists.size },
      },
    }
  }

  sourceState() {
    return {
      schemaVersion: SOURCE_CATALOG_SCHEMA_VERSION,
      registryVersion: SOURCE_REGISTRY_VERSION,
      discovery: 'INDEPENDENT_PAIR_LONG_DOPPLER_POOL_MANAGER_AND_ROBINHOOD_ASSET_ADAPTERS',
      canonicalAssets: 'ROBINHOOD_ASSETS_API_ONLY',
      quoteAdmissionMetadata: 'PAIR_STOCK_TOKENS_API_PLUS_ROBINHOOD_ASSETS_API',
      quoteRpc: this.config.providerLabel,
      discoveredTokens: this.rawTokens.size,
      catalogComplete: this.catalogComplete ?? false,
      catalogExpectedTokens: this.catalogExpectedTokens ?? null,
      catalogObservedAt: this.lastCatalogAt,
      fullCatalogObservedAt: this.lastFullCatalogAt,
      adapters: Object.values(this.adapterStates),
      sourceCatalog: {
        status:
          this.adapterStates['long.launcher.v1'].status === AdapterRunStatus.COMPLETE_FROM_CONFIGURED_START &&
          this.adapterStates['doppler.registry.v1'].status === AdapterRunStatus.COMPLETE_FROM_CONFIGURED_START &&
          this.adapterStates['uniswap-v4.pool-manager.v1'].status === AdapterRunStatus.COMPLETE_FROM_CONFIGURED_START
            ? 'COMPLETE_FROM_CONFIGURED_START'
            : 'BACKFILL_PARTIAL',
        configuredStartBlock: this.config.sourceCatalogStartBlock.toString(),
        safeHead: this.sourceCatalogSafeHead,
        longLaunches: this.longLaunches.length,
        dopplerLaunches: this.visibleDopplerLaunchCount,
        dopplerTargetsDiscovered: this.dopplerTargetIndex.length,
        genericPools: this.genericPools.length,
        projectionBytes: this.latestSourceCatalogBytes ?? null,
        poolRetention: this.sourcePoolRetention,
        strategyGraph: this.strategyGraph,
        scopeWarning: 'each adapter reports its own bounded coverage; no cross-adapter completeness promotion',
      },
      chainCatalog: {
        evidence: 'POOL_MANAGER_INITIALIZE_LOGS',
        configuredStartBlock: this.config.chainCatalogStartBlock.toString(),
        nextBlock: this.chainCatalogNextBlock.toString(),
        safeHead: this.chainCatalogSafeHead,
        status: this.chainCatalogComplete ? 'COMPLETE_FROM_CONFIGURED_START' : 'BACKFILL_PARTIAL',
        poolCount: this.chainPools.length,
        ambiguousLaunchCount: this.chainAmbiguities.length,
        lastError: this.chainCatalogLastError,
        scopeWarning: 'not a claim of completeness before configuredStartBlock',
      },
    }
  }

  persistState(updatedAt = new Date().toISOString()) {
    writeJsonAtomic(this.statePath, {
      cursor: this.cursor,
      cycleNumber: this.cycleNumber,
      chainCatalogNextBlock: this.chainCatalogNextBlock.toString(),
      hotCursor: this.hotCursor,
      eventLedgerEpoch: this.eventLedgerEpoch,
      sourceAdapterCursors: Object.fromEntries(
        Object.entries(this.sourceAdapterCursors).map(([adapterId, cursor]) => [adapterId, cursor.toString()]),
      ),
      updatedAt,
    })
  }

  sourceCatalogProjection(safeHead = this.sourceCatalogSafeHead, generatedAt = new Date().toISOString()) {
    const normalizedSafeHead = safeHead === null ? null : String(safeHead)
    return {
      schemaVersion: SOURCE_CATALOG_SCHEMA_VERSION,
      registryVersion: SOURCE_CONTRACT_REGISTRY.version,
      mode: 'READ_ONLY_NO_SIGNING_NO_BROADCAST',
      generatedAt,
      safeHead: normalizedSafeHead,
      summary: {
        pairListings: this.pairListings.length,
        longLaunches: this.longLaunches.length,
        dopplerLaunches: this.visibleDopplerLaunchCount,
        dopplerTargetsDiscovered: this.dopplerTargetIndex.length,
        persistedDopplerLaunchDetails: 0,
        genericPools: this.genericPools.length,
        poolRetention: this.sourcePoolRetention,
        strategyGraph: this.strategyGraph,
      },
      adapters: this.adapterStates,
      runtimeProjection: { ...SOURCE_CATALOG_RUNTIME_PROJECTION },
      sourceAdapterCursors: Object.fromEntries(
        Object.entries(this.sourceAdapterCursors).map(([adapterId, cursor]) => [adapterId, cursor.toString()]),
      ),
      evidence: this.sourceEvidence,
      pairListings: this.pairListings,
      assetRegistry: {
        adapterId: 'robinhood.assets.v1',
        addresses: [...this.robinhoodStockAddresses].sort(),
        evidenceIds: this.sourceEvidence
          .filter((item) => item.producer === 'ROBINHOOD_ASSETS_API')
          .map((item) => item.evidenceId),
      },
      longLaunches: this.longLaunches,
      dopplerTargetIndex: this.dopplerTargetIndex,
      pools: this.genericPools,
    }
  }

  writeSourceCatalog(safeHead = this.sourceCatalogSafeHead) {
    this.sourceCatalogSafeHead = safeHead === null ? null : String(safeHead)
    const catalog = this.sourceCatalogProjection(this.sourceCatalogSafeHead)
    const persisted = writeStableJsonAtomic(this.sourceCatalogPath, catalog)
    this.latestSourceCatalog = catalog
    this.latestSourceCatalogHash = persisted.hash
    this.latestSourceCatalogBytes = persisted.bytes
    return catalog
  }

  async refreshCatalog({ full }) {
    const pairAttemptAt = new Date().toISOString()
    this.adapterStates['pair.catalog.v1'] = markAdapterAttempt(this.adapterStates['pair.catalog.v1'], pairAttemptAt)
    let pairSupplementError = null
    if (full || this.stockAddresses.size === 0) {
      try {
        const stockPayload = await fetchJson(PAIR_STOCK_TOKENS_API, this.config.requestTimeoutMs)
        this.pairStockAddresses = new Set(
          (Array.isArray(stockPayload) ? stockPayload : []).map((item) => item?.address?.toLowerCase()).filter(Boolean),
        )
        for (const item of Array.isArray(stockPayload) ? stockPayload : []) {
          if (item?.address) this.quoteAssets.set(item.address.toLowerCase(), { ...item })
        }
      } catch (error) {
        pairSupplementError = error
      }

      const robinhoodAttemptAt = new Date().toISOString()
      this.adapterStates['robinhood.assets.v1'] = markAdapterAttempt(
        this.adapterStates['robinhood.assets.v1'],
        robinhoodAttemptAt,
      )
      try {
        const robinhoodPayload = await fetchJson(ROBINHOOD_ASSETS_API, this.config.requestTimeoutMs)
        const adapted = adaptRobinhoodAssets(robinhoodPayload, {
          chainId: CHAIN_ID,
          evidenceId: `robinhood-assets:${robinhoodAttemptAt}`,
          observedAt: robinhoodAttemptAt,
        })
        this.robinhoodStockAddresses = new Set(adapted.addresses.map((item) => item.toLowerCase()))
        const registryPayload = {
          observedAt: robinhoodAttemptAt,
          coverage: 'ALL_ACTIVE_DEPLOYMENTS_FOR_CHAIN',
          chainId: CHAIN_ID,
          addresses: adapted.addresses,
        }
        const registryPayloadHash = stablePayloadHash(registryPayload)
        this.sourceEvidence = [
          ...this.sourceEvidence.filter((item) => item.producer !== 'ROBINHOOD_ASSETS_API'),
          {
            evidenceId: `robinhood-assets:${registryPayloadHash.slice('sha256:'.length)}`,
            kind: 'REGISTRY_SNAPSHOT',
            producer: 'ROBINHOOD_ASSETS_API',
            observedAt: robinhoodAttemptAt,
            chainId: CHAIN_ID,
            blockNumber: null,
            blockHash: null,
            transactionHash: null,
            payloadHash: registryPayloadHash,
            status: 'OBSERVED',
            payload: registryPayload,
          },
        ]
        for (const asset of robinhoodPayload?.assets || []) {
          if (asset?.status !== 'ASSET_STATUS_ACTIVE') continue
          for (const deployment of asset.deployments || []) {
            if (Number(deployment.chainId) !== CHAIN_ID || !deployment.contractAddress) continue
            if (!this.quoteAssets.has(deployment.contractAddress.toLowerCase())) {
              this.quoteAssets.set(deployment.contractAddress.toLowerCase(), {
                address: deployment.contractAddress,
                symbol: asset.symbol || asset.ticker || 'ROBINHOOD_ASSET',
                decimals: 18,
                enabled: true,
              })
            }
          }
        }
        this.adapterStates['robinhood.assets.v1'] = markAdapterSuccess(
          this.adapterStates['robinhood.assets.v1'],
          { status: AdapterRunStatus.CURRENT, observations: adapted.addresses.length },
          robinhoodAttemptAt,
        )
      } catch (error) {
        this.adapterStates['robinhood.assets.v1'] = markAdapterError(
          this.adapterStates['robinhood.assets.v1'],
          error,
          robinhoodAttemptAt,
        )
      }
      this.stockAddresses = new Set([...this.pairStockAddresses, ...this.robinhoodStockAddresses])
    }

    try {
      if (full) {
        const first = await fetchJson(
          `${PAIR_TOKENS_API}?page=1&limit=${PAIR_CATALOG_PAGE_SIZE}&sort=newest`,
          this.config.requestTimeoutMs,
        )
        const pages = Math.max(1, Math.ceil(Number(first.total || 0) / Number(first.limit || PAIR_CATALOG_PAGE_SIZE)))
        const rest = await mapLimit(
          this.config.catalogConcurrency,
          Array.from({ length: Math.max(0, pages - 1) }, (_, index) => index + 2),
          (page) =>
            fetchJson(
              `${PAIR_TOKENS_API}?page=${page}&limit=${PAIR_CATALOG_PAGE_SIZE}&sort=newest`,
              this.config.requestTimeoutMs,
            ),
        )
        this.rawTokens.clear()
        for (const payload of [first, ...rest]) {
          for (const token of payload.items || []) {
            if (token?.address) this.rawTokens.set(token.address.toLowerCase(), token)
          }
        }
        this.catalogExpectedTokens = Number(first.total || this.rawTokens.size)
        this.lastFullCatalogAt = new Date().toISOString()
      }

      const newest = await fetchJson(`${PAIR_TOKENS_API}?page=1&limit=50&sort=newest`, this.config.requestTimeoutMs)
      for (const token of newest.items || []) {
        if (token?.address) this.rawTokens.set(token.address.toLowerCase(), token)
      }
      if (full) this.catalogComplete = catalogIsComplete(this.rawTokens.size, this.catalogExpectedTokens)
      this.adapterStates['pair.catalog.v1'] = markAdapterSuccess(
        this.adapterStates['pair.catalog.v1'],
        {
          status: pairSupplementError ? AdapterRunStatus.PARTIAL : AdapterRunStatus.CURRENT,
          observations: this.rawTokens.size,
        },
        pairAttemptAt,
      )
      if (pairSupplementError) {
        this.adapterStates['pair.catalog.v1'].lastError = publicError(pairSupplementError)
      }
      const catalogPayload = {
        observedAt: pairAttemptAt,
        expectedTokens: this.catalogExpectedTokens || null,
        addresses: [...this.rawTokens.keys()].sort(),
      }
      const catalogPayloadHash = stablePayloadHash(catalogPayload)
      const catalogEvidenceId = `pair-catalog:${catalogPayloadHash.slice('sha256:'.length)}`
      this.sourceEvidence = [
        ...this.sourceEvidence.filter((item) => item.producer !== 'PAIR_CATALOG_API'),
        {
          evidenceId: catalogEvidenceId,
          kind: 'SOURCE_RESPONSE',
          producer: 'PAIR_CATALOG_API',
          observedAt: pairAttemptAt,
          chainId: CHAIN_ID,
          blockNumber: null,
          blockHash: null,
          transactionHash: null,
          payloadHash: catalogPayloadHash,
          status: 'OBSERVED',
          payload: catalogPayload,
        },
      ]
      this.pairListings = [...this.rawTokens.values()].map((token) => ({
        adapterId: 'pair.catalog.v1',
        claim: 'LISTED_BY_PAIR_API',
        platformId: 'PAIR',
        targetAddress: getAddress(token.address),
        symbol: String(token.symbol || 'UNKNOWN'),
        name: String(token.name || token.symbol || 'Unknown token'),
        observedAt: pairAttemptAt,
        evidenceIds: [catalogEvidenceId],
      }))
    } catch (error) {
      this.adapterStates['pair.catalog.v1'] = markAdapterError(
        this.adapterStates['pair.catalog.v1'],
        error,
        pairAttemptAt,
      )
      if (this.rawTokens.size === 0) throw error
    }

    for (const token of this.rawTokens.values()) {
      for (const pair of token.pairs || []) {
        if (pair?.quoteToken?.address && !this.quoteAssets.has(pair.quoteToken.address.toLowerCase())) {
          this.quoteAssets.set(pair.quoteToken.address.toLowerCase(), { ...pair.quoteToken })
        }
      }
    }
    const sourceTargets = sourceTargetAddresses({
      pairListings: this.pairListings,
      longLaunches: this.longLaunches,
      dopplerLaunches: this.dopplerLaunches,
      dopplerTargetIndex: this.dopplerTargetIndex,
    })
    const poolsBeforeRetention = this.genericPools.length
    this.genericPools = retainPoolsForSourceTargets(this.genericPools, sourceTargets)
    this.sourcePoolRetention = {
      policy: 'SOURCE_TARGET_CURRENCY_ONLY',
      sourceTargets: sourceTargets.size,
      retainedPools: this.genericPools.length,
      prunedPools: poolsBeforeRetention - this.genericPools.length,
      reason: 'PAIR_CATALOG_REFRESH',
    }
    this.refreshDopplerVisibility()
    this.rebuildCatalogFromSources()
    this.lastCatalogAt = new Date().toISOString()
    this.writeSourceCatalog()
  }

  rebuildCatalogFromSources() {
    const graph = buildSourceStrategyCatalog({
      apiTokens: [...this.rawTokens.values()],
      chainPools: this.chainPools,
      quoteAssets: this.quoteAssets,
      pairListings: this.pairListings,
      longLaunches: this.longLaunches,
      dopplerTargetIndex: this.dopplerTargetIndex,
      genericPools: this.genericPools,
      maxPoolsPerTarget: this.config.maxPoolsPerTarget,
    })
    this.catalog = graph.tokens
      .map((token) =>
        normalizePairCandidate(token, {
          minDepthUsd: this.config.minDepthUsd,
          quoteAssetAddresses: this.stockAddresses,
          chainAttestations: this.chainAttestations,
        }),
      )
      .filter(Boolean)
    this.strategyGraph = {
      ...graph.summary,
      admittedCandidates: this.catalog.length,
      admittedCandidatePools: this.catalog.reduce((sum, candidate) => sum + candidate.pools.length, 0),
      executorCompatibleCandidates: this.catalog.filter((candidate) => candidate.liveCompatiblePoolCount >= 2).length,
      executionBoundary: 'CURRENT_EXECUTOR_POOLKEY_ONLY',
    }
    this.dependencyIndex = buildShadowDependencyIndex(this.catalog, this.observations)
  }

  refreshDopplerVisibility() {
    this.visibleDopplerLaunchCount = countVisibleDopplerLaunches({
      dopplerTargetIndex: this.dopplerTargetIndex,
      pools: this.genericPools,
      pairListings: this.pairListings,
      longLaunches: this.longLaunches,
      poolCursor: this.sourceAdapterCursors?.['uniswap-v4.pool-manager.v1'] || this.config.sourceCatalogStartBlock,
    })
    this.dopplerLaunches = []
  }

  /** @param {Record<string, any>} filter */
  async rpcLogs(filter) {
    const logs = await this.retryRpc(() =>
      this.client.request(
        /** @type {any} */ ({
          method: 'eth_getLogs',
          params: [filter],
        }),
      ),
    )
    if (!Array.isArray(logs)) throw new Error('eth_getLogs did not return an array')
    return logs
  }

  /** @param {Record<string, any>[]} initializeEvents */
  ingestInitializeEvents(initializeEvents) {
    const allGenericFacts = initializeEvents.map((event) => adaptPoolManagerInitialize(event)).filter(Boolean)
    const sourceTargets = sourceTargetAddresses({
      pairListings: this.pairListings,
      longLaunches: this.longLaunches,
      dopplerLaunches: this.dopplerLaunches,
      dopplerTargetIndex: this.dopplerTargetIndex,
    })
    const genericFacts = retainPoolsForSourceTargets(allGenericFacts, sourceTargets)
    if (genericFacts.length > 0) this.store.ingest(genericFacts.map((fact) => fact.evidence))
    const compactGenericFacts = genericFacts.map((fact) => compactSourceFact(fact))
    const genericBeforeCount = this.genericPools.length
    if (compactGenericFacts.length > 0) {
      this.genericPools = retainPoolsForSourceTargets(
        mergeSourceFacts(this.genericPools, compactGenericFacts, (item) => item.poolId.toLowerCase()),
        sourceTargets,
      )
    }
    this.sourcePoolRetention = {
      policy: 'SOURCE_TARGET_CURRENCY_ONLY',
      sourceTargets: sourceTargets.size,
      scannedInitializeEvents: allGenericFacts.length,
      retainedInitializeEvents: genericFacts.length,
      retainedPools: this.genericPools.length,
      prunedInitializeEvents: allGenericFacts.length - genericFacts.length,
    }
    const inferred = inferPairLaunchPools(initializeEvents, new Set(this.quoteAssets.keys()))
    const beforeCount = this.chainPools.length
    this.chainPools = mergeChainPools(this.chainPools, inferred.pools)
    const ambiguityMap = new Map(
      this.chainAmbiguities.map((item) => [`${item.launchTxHash}:${(item.poolIds || []).join(',')}`, item]),
    )
    for (const item of inferred.ambiguities) {
      ambiguityMap.set(`${item.launchTxHash}:${item.poolIds.join(',')}`, item)
    }
    this.chainAmbiguities = [...ambiguityMap.values()]
    return {
      discoveredPools: this.chainPools.length - beforeCount,
      discoveredGenericPools: this.genericPools.length - genericBeforeCount,
      retainedGenericPoolObservations: genericFacts.length,
      ambiguities: inferred.ambiguities.length,
    }
  }

  writeChainCatalog(safeHead, lastBatch = null) {
    const byTarget = new Map()
    for (const pool of this.chainPools) {
      const key = pool.targetAddress.toLowerCase()
      if (!byTarget.has(key)) byTarget.set(key, [])
      byTarget.get(key).push(pool)
    }
    this.chainCatalogSafeHead = safeHead.toString()
    this.chainCatalogComplete = this.chainCatalogNextBlock > safeHead
    writeJsonAtomic(this.chainCatalogPath, {
      schemaVersion: 1,
      mode: 'READ_ONLY_NO_SIGNING_NO_BROADCAST',
      generatedAt: new Date().toISOString(),
      coverage: {
        status: this.chainCatalogComplete ? 'COMPLETE_FROM_CONFIGURED_START' : 'BACKFILL_PARTIAL',
        configuredStartBlock: this.config.chainCatalogStartBlock.toString(),
        scannedThroughBlock:
          this.chainCatalogNextBlock > this.config.chainCatalogStartBlock
            ? (this.chainCatalogNextBlock - 1n).toString()
            : null,
        nextBlock: this.chainCatalogNextBlock.toString(),
        safeHead: safeHead.toString(),
        scopeWarning: 'blocks before configuredStartBlock are not covered',
      },
      summary: {
        pools: this.chainPools.length,
        attributedTargets: byTarget.size,
        multiPoolTargets: [...byTarget.values()].filter((pools) => pools.length >= 2).length,
        singlePoolTargets: [...byTarget.values()].filter((pools) => pools.length === 1).length,
        ambiguousLaunches: this.chainAmbiguities.length,
      },
      lastBatch,
      targets: [...byTarget.entries()]
        .map(([targetAddress, pools]) => ({
          targetAddress,
          poolCount: pools.length,
          strategyEligibility: pools.length >= 2 ? 'MULTI_POOL_SHADOW_CANDIDATE' : 'SINGLE_POOL_NO_INTERNAL_CYCLE',
          poolIds: pools.map((pool) => pool.poolId),
          quoteAddresses: pools.map((pool) => pool.quoteAddress),
        }))
        .sort(
          (left, right) => right.poolCount - left.poolCount || left.targetAddress.localeCompare(right.targetAddress),
        ),
      pools: this.chainPools,
      ambiguities: this.chainAmbiguities,
    })
  }

  /** @param {bigint} safeHead */
  async advanceChainCatalog(safeHead) {
    const adapterId = 'pair.chain-catalog.v1'
    const attemptAt = new Date().toISOString()
    this.adapterStates[adapterId] = markAdapterAttempt(this.adapterStates[adapterId], attemptAt)
    let batches = 0
    let logsSeen = 0
    let discoveredPools = 0
    let discoveredGenericPools = 0
    let ambiguities = 0
    let lastFromBlock = null
    let lastToBlock = null
    while (batches < this.config.chainCatalogBatchesPerCycle && this.chainCatalogNextBlock <= safeHead) {
      const fromBlock = this.chainCatalogNextBlock
      const maximumTo = fromBlock + this.config.chainCatalogBlockRange - 1n
      const toBlock = maximumTo < safeHead ? maximumTo : safeHead
      const logs = await this.rpcLogs({
        address: POOL_MANAGER,
        fromBlock: toHex(fromBlock),
        toBlock: toHex(toBlock),
        topics: [V4_INITIALIZE_TOPIC],
      })
      const events = logs.map((log) => decodePoolManagerLog(log))
      const ingested = this.ingestInitializeEvents(events)
      logsSeen += logs.length
      discoveredPools += ingested.discoveredPools
      discoveredGenericPools += ingested.discoveredGenericPools
      ambiguities += ingested.ambiguities
      batches += 1
      lastFromBlock = fromBlock
      lastToBlock = toBlock
      this.chainCatalogNextBlock = toBlock + 1n
    }
    const lastBatch = {
      at: new Date().toISOString(),
      batches,
      logsSeen,
      discoveredPools,
      discoveredGenericPools,
      ambiguities,
      fromBlock: lastFromBlock?.toString() || null,
      toBlock: lastToBlock?.toString() || null,
    }
    this.writeChainCatalog(safeHead, lastBatch)
    this.adapterStates[adapterId] = markAdapterSuccess(
      this.adapterStates[adapterId],
      {
        status: this.chainCatalogComplete
          ? AdapterRunStatus.COMPLETE_FROM_CONFIGURED_START
          : AdapterRunStatus.BACKFILL_PARTIAL,
        safeHead,
        scannedThroughBlock:
          this.chainCatalogNextBlock > this.config.chainCatalogStartBlock ? this.chainCatalogNextBlock - 1n : null,
        observations: logsSeen,
      },
      attemptAt,
    )
    if (discoveredGenericPools > 0) this.refreshDopplerVisibility()
    this.writeSourceCatalog(safeHead)
    if (discoveredPools > 0) this.rebuildCatalogFromSources()
    this.persistState(lastBatch.at)
    return lastBatch
  }

  async advanceLaunchSourceCatalog(safeHead) {
    const definitions = [
      {
        adapterId: 'long.launcher.v1',
        address: LONG_LAUNCHER,
        topic: LONG_LAUNCH_CREATED_TOPIC,
        decode: (log) => decodeLongLauncherLog(log),
        current: () => this.longLaunches,
        assign: (value) => {
          this.longLaunches = value
        },
      },
      {
        adapterId: 'doppler.registry.v1',
        address: DOPPLER_AIRLOCK,
        topic: DOPPLER_CREATE_TOPIC,
        decode: (log) => decodeDopplerCreateLog(log),
      },
    ]
    let rpcLogCalls = 0
    let logsSeen = 0
    let observations = 0
    let visibilityChanged = false

    for (let batch = 0; batch < this.config.sourceCatalogBatchesPerCycle; batch += 1) {
      const maximumLaunchCursor =
        this.sourceAdapterCursors['uniswap-v4.pool-manager.v1'] +
        this.config.sourceCatalogBlockRange * BigInt(this.config.sourceCatalogBatchesPerCycle)
      const active = definitions.filter(
        (definition) =>
          this.sourceAdapterCursors[definition.adapterId] <= safeHead &&
          this.sourceAdapterCursors[definition.adapterId] < maximumLaunchCursor,
      )
      if (active.length === 0) break
      const grouped = new Map()
      for (const definition of active) {
        const cursor = this.sourceAdapterCursors[definition.adapterId]
        const key = cursor.toString()
        if (!grouped.has(key)) grouped.set(key, [])
        grouped.get(key).push(definition)
      }

      for (const [cursor, group] of grouped) {
        const fromBlock = BigInt(cursor)
        const maximumTo = fromBlock + this.config.sourceCatalogBlockRange - 1n
        const toBlock = maximumTo < safeHead ? maximumTo : safeHead
        const attemptAt = new Date().toISOString()
        for (const definition of group) {
          this.adapterStates[definition.adapterId] = markAdapterAttempt(
            this.adapterStates[definition.adapterId],
            attemptAt,
          )
        }

        let logs
        try {
          logs = await this.rpcLogs({
            address: group.length === 1 ? group[0].address : group.map((definition) => definition.address),
            fromBlock: toHex(fromBlock),
            toBlock: toHex(toBlock),
            topics: [group.length === 1 ? group[0].topic : group.map((definition) => definition.topic)],
          })
          rpcLogCalls += 1
          logsSeen += logs.length
        } catch (error) {
          for (const definition of group) {
            this.adapterStates[definition.adapterId] = markAdapterError(
              this.adapterStates[definition.adapterId],
              error,
              attemptAt,
            )
          }
          throw error
        }

        for (const definition of group) {
          try {
            const matching = logs.filter(
              (log) =>
                String(log.address).toLowerCase() === definition.address.toLowerCase() &&
                String(log.topics?.[0] || '').toLowerCase() === definition.topic,
            )
            const decoded = matching.map((log) => definition.decode(log)).filter(Boolean)
            if (decoded.length > 0) {
              this.store.ingest(decoded.map((fact) => fact.evidence))
              visibilityChanged = true
              if (definition.adapterId === 'doppler.registry.v1') {
                this.dopplerTargetIndex = mergeDopplerTargetFacts(this.dopplerTargetIndex, decoded)
              } else {
                const compactDecoded = decoded.map((fact) => compactSourceFact(fact))
                definition.assign(
                  mergeSourceFacts(
                    definition.current(),
                    compactDecoded,
                    (item) => `${item.transactionHash || item.evidenceId}:${item.logIndex || 0}`,
                  ),
                )
              }
            }
            observations += decoded.length
            this.sourceAdapterCursors[definition.adapterId] = toBlock + 1n
            const complete = this.sourceAdapterCursors[definition.adapterId] > safeHead
            this.adapterStates[definition.adapterId] = markAdapterSuccess(
              this.adapterStates[definition.adapterId],
              {
                status: complete ? AdapterRunStatus.COMPLETE_FROM_CONFIGURED_START : AdapterRunStatus.BACKFILL_PARTIAL,
                safeHead,
                scannedThroughBlock: toBlock,
                observations: decoded.length,
              },
              attemptAt,
            )
          } catch (error) {
            this.adapterStates[definition.adapterId] = markAdapterError(
              this.adapterStates[definition.adapterId],
              error,
              attemptAt,
            )
          }
        }
      }
    }

    if (visibilityChanged) this.refreshDopplerVisibility()
    this.writeSourceCatalog(safeHead)
    this.persistState()
    return { rpcLogCalls, logsSeen, observations, safeHead: safeHead.toString() }
  }

  /** @param {bigint} safeHead */
  async advanceSourcePoolCatalog(safeHead) {
    const adapterId = 'uniswap-v4.pool-manager.v1'
    let rpcLogCalls = 0
    let logsSeen = 0
    let retainedObservations = 0
    let discoveredPools = 0
    let lastFromBlock = null
    let lastToBlock = null

    for (let batch = 0; batch < this.config.sourceCatalogBatchesPerCycle; batch += 1) {
      const planned = planSourceTargetPoolRange({
        cursor: this.sourceAdapterCursors[adapterId],
        longCursor: this.sourceAdapterCursors['long.launcher.v1'],
        dopplerCursor: this.sourceAdapterCursors['doppler.registry.v1'],
        safeHead,
        blockRange: this.config.sourceCatalogBlockRange,
      })
      if (!planned) break
      const { fromBlock, toBlock } = planned
      const attemptAt = new Date().toISOString()
      this.adapterStates[adapterId] = markAdapterAttempt(this.adapterStates[adapterId], attemptAt)

      let logs
      try {
        logs = await this.rpcLogs({
          address: POOL_MANAGER,
          fromBlock: toHex(fromBlock),
          toBlock: toHex(toBlock),
          topics: [V4_INITIALIZE_TOPIC],
        })
      } catch (error) {
        this.adapterStates[adapterId] = markAdapterError(this.adapterStates[adapterId], error, attemptAt)
        throw error
      }

      const initializeEvents = logs.map((log) => decodePoolManagerLog(log))
      const ingested = this.ingestInitializeEvents(initializeEvents)
      rpcLogCalls += 1
      logsSeen += logs.length
      retainedObservations += ingested.retainedGenericPoolObservations
      discoveredPools += ingested.discoveredGenericPools
      lastFromBlock = fromBlock
      lastToBlock = toBlock
      this.sourceAdapterCursors[adapterId] = toBlock + 1n
      const complete = this.sourceAdapterCursors[adapterId] > safeHead
      this.adapterStates[adapterId] = markAdapterSuccess(
        this.adapterStates[adapterId],
        {
          status: complete ? AdapterRunStatus.COMPLETE_FROM_CONFIGURED_START : AdapterRunStatus.BACKFILL_PARTIAL,
          safeHead,
          scannedThroughBlock: toBlock,
          observations: ingested.retainedGenericPoolObservations,
        },
        attemptAt,
      )
    }

    const result = {
      rpcLogCalls,
      logsSeen,
      retainedObservations,
      discoveredPools,
      fromBlock: lastFromBlock?.toString() || null,
      toBlock: lastToBlock?.toString() || null,
      nextBlock: this.sourceAdapterCursors[adapterId].toString(),
      safeHead: safeHead.toString(),
    }
    this.refreshDopplerVisibility()
    this.writeSourceCatalog(safeHead)
    if (discoveredPools > 0) this.rebuildCatalogFromSources()
    this.persistState()
    return result
  }

  v3WatchAddresses() {
    return [...this.dependencyIndex.v3PoolToCandidates.keys()].sort().slice(0, this.config.eventV3MaxAddresses)
  }

  async pollHotEvents() {
    const observedAtMs = Date.now()
    const pollStartedAt = performance.now()
    let phaseStartedAt = pollStartedAt
    const pollTiming = { observedAt: new Date(observedAtMs).toISOString() }
    const markPhase = (name) => {
      const now = performance.now()
      pollTiming[name] = Number((now - phaseStartedAt).toFixed(2))
      phaseStartedAt = now
    }
    const completePollTiming = (outcome, details = {}) => {
      const completed = {
        ...pollTiming,
        ...details,
        outcome,
        totalMs: Number((performance.now() - pollStartedAt).toFixed(2)),
      }
      this.eventMetrics.lastPollTiming = completed
      if (Number(details.relevantLogs || 0) > 0) this.eventMetrics.lastRelevantPollTiming = completed
    }
    const head = await this.retryRpc(() => this.client.getBlockNumber())
    markPhase('headReadMs')
    this.eventMetrics.lastError = null
    this.eventMetrics.consecutiveErrors = 0
    let nextBlock = this.hotCursor.nextBlock === null ? null : BigInt(this.hotCursor.nextBlock)
    const recovered = recoverStaleHotCursor(this.hotCursor, head, {
      confirmations: this.config.eventConfirmations,
      maxLagBlocks: this.config.eventMaxLagBlocks,
      reorgLookback: this.config.eventReorgLookback,
      observedAt: new Date(observedAtMs).toISOString(),
    })
    if (recovered.fastForwarded) {
      this.hotCursor = recovered.cursor
      this.eventQueue = new CandidateWakeQueue()
      nextBlock = BigInt(recovered.cursor.nextBlock)
      this.eventMetrics.cursorFastForwards = recovered.cursor.fastForwardCount
      this.eventMetrics.skippedRealtimeBlocks = recovered.cursor.skippedRealtimeBlocks
      this.eventMetrics.lastCoverageGap = recovered.gap
    }
    let planned = planHotLogRange(nextBlock, head, {
      confirmations: this.config.eventConfirmations,
      maxBlockRange: this.config.eventMaxBlockRange,
    })
    this.eventMetrics.headLagBlocks =
      nextBlock !== null && nextBlock <= planned.safeHead ? (planned.safeHead - nextBlock + 1n).toString() : '0'
    this.eventMetrics.polls += 1
    this.eventMetrics.lastPollAt = new Date(observedAtMs).toISOString()

    if (nextBlock === null) {
      this.hotCursor = {
        ...this.hotCursor,
        nextBlock: planned.initializedNextBlock.toString(),
      }
      this.persistState()
      markPhase('persistMs')
      completePollTiming('CURSOR_INITIALIZED')
      return {
        candidateIds: [],
        catalogRefresh: false,
        initialized: true,
        pendingCandidates: this.eventQueue.size,
      }
    }
    if (!planned.range) {
      this.persistState()
      markPhase('persistMs')
      completePollTiming('NO_CONFIRMED_RANGE')
      return {
        candidateIds: [],
        catalogRefresh: false,
        initialized: false,
        pendingCandidates: this.eventQueue.size,
      }
    }

    if (this.hotCursor.lastProcessedBlock) {
      const anchorBlock = await this.retryRpc(() =>
        this.client.getBlock({ blockNumber: BigInt(this.hotCursor.lastProcessedBlock) }),
      )
      const reconciled = reconcileHotCursorAnchor(this.hotCursor, anchorBlock.hash, {
        startBlock: this.config.chainCatalogStartBlock,
        reorgLookback: this.config.eventReorgLookback,
      })
      if (reconciled.reorgDetected) {
        this.hotCursor = reconciled
        this.eventQueue = new CandidateWakeQueue()
        nextBlock = BigInt(reconciled.nextBlock)
        planned = planHotLogRange(nextBlock, head, {
          confirmations: this.config.eventConfirmations,
          maxBlockRange: this.config.eventMaxBlockRange,
        })
      }
    }
    markPhase('reorgCheckMs')
    if (!planned.range) {
      completePollTiming('REORG_REPLAN_EMPTY')
      return {
        candidateIds: [],
        catalogRefresh: false,
        initialized: false,
        pendingCandidates: this.eventQueue.size,
      }
    }

    const { fromBlock, toBlock } = planned.range
    const v4Logs = await this.rpcLogs({
      address: POOL_MANAGER,
      fromBlock: toHex(fromBlock),
      toBlock: toHex(toBlock),
      topics: [[V4_SWAP_TOPIC, V4_INITIALIZE_TOPIC]],
    })
    this.eventMetrics.rpcLogCalls += 1
    markPhase('v4LogsMs')

    const v3Logs = []
    const addresses = this.v3WatchAddresses()
    for (let index = 0; index < addresses.length; index += 100) {
      const addressChunk = addresses.slice(index, index + 100)
      v3Logs.push(
        ...(await this.rpcLogs({
          address: addressChunk.length === 1 ? addressChunk[0] : addressChunk,
          fromBlock: toHex(fromBlock),
          toBlock: toHex(toBlock),
          topics: [V3_SWAP_TOPIC],
        })),
      )
      this.eventMetrics.rpcLogCalls += 1
    }
    markPhase('v3LogsMs')

    const decodedEvents = [
      ...v4Logs.map((log) => decodePoolManagerLog(log)),
      ...v3Logs.map((log) => decodeV3SwapLog(log)),
    ].filter(Boolean)
    const events = coalesceLatestSwapPerPool(decodedEvents)
    for (const event of events) {
      if (event.type !== 'V3_SWAP' || !event.poolAddress) continue
      this.quoteRpcMetrics.v3PersistentShortlistInvalidations += this.v3PersistentShortlists.invalidateByPool(
        event.poolAddress,
      )
    }
    const initializeEvents = events.filter((event) => event.type === 'V4_INITIALIZE')
    const initializeResult = this.ingestInitializeEvents(initializeEvents)
    // The independent hot cursor durably ingests the relevant Initialize
    // evidence and advances its own state, but large catalog projections stay
    // on the protected periodic lane. Source and chain backfill cursors do not
    // advance here, so a crash before that periodic checkpoint re-observes the
    // same facts idempotently instead of losing them.

    let relevantLogs = 0
    let candidateWakes = 0
    // Initialize logs are common across the entire PoolManager. Ingestion has
    // already classified them against the source registry, so an unrelated
    // pool must not force a full PAIR/source rebuild on the next quote cycle.
    // Relevant PAIR or retained source pools still request that rebuild.
    let catalogRefresh = initializeIngestNeedsCatalogRefresh(initializeResult)
    if (catalogRefresh) {
      this.eventMetrics.deferredInitializeCatalogRefreshes += 1
      this.eventMetrics.lastDeferredInitializeCatalogRefreshAt = new Date(observedAtMs).toISOString()
    }
    for (const event of events) {
      const routed = routeShadowEvent(event, this.dependencyIndex)
      if (event.type !== ShadowWakeSource.V4_INITIALIZE) catalogRefresh ||= routed.catalogRefresh
      if (routed.candidateIds.length === 0) continue
      const offered = this.eventQueue.offer(event, routed.candidateIds, observedAtMs)
      if (!offered.accepted) continue
      relevantLogs += 1
      candidateWakes += offered.candidateCount
      this.poolMirror = applyPoolMirrorEvent(this.poolMirror, event)
    }
    markPhase('decodeRouteMs')
    const anchor = await this.retryRpc(() => this.client.getBlock({ blockNumber: toBlock }))
    markPhase('finalAnchorMs')
    this.hotCursor = {
      ...this.hotCursor,
      nextBlock: (toBlock + 1n).toString(),
      lastProcessedBlock: toBlock.toString(),
      lastProcessedBlockHash: anchor.hash,
      lastProcessedAt: new Date().toISOString(),
    }
    this.eventMetrics.logsSeen += decodedEvents.length
    this.eventMetrics.logsCoalesced += decodedEvents.length - events.length
    this.eventMetrics.relevantLogs += relevantLogs
    this.eventMetrics.candidateWakes += candidateWakes
    this.eventMetrics.dedupedLogs = this.eventQueue.dedupedEvents
    this.eventMetrics.lastEventAt =
      events.length > 0 ? new Date(observedAtMs).toISOString() : this.eventMetrics.lastEventAt
    this.eventMetrics.lastError = null
    this.eventMetrics.consecutiveErrors = 0
    if (relevantLogs > 0) writeJsonAtomic(this.poolMirrorPath, this.poolMirror)
    this.persistState()
    markPhase('persistMs')
    completePollTiming(relevantLogs > 0 ? 'RELEVANT_EVENTS_QUEUED' : 'RANGE_SCANNED', {
      fromBlock: fromBlock.toString(),
      toBlock: toBlock.toString(),
      v3WatchAddresses: addresses.length,
      v3LogCalls: Math.ceil(addresses.length / 100),
      decodedEvents: decodedEvents.length,
      relevantLogs,
      candidateWakes,
    })
    return {
      candidateIds: [],
      catalogRefresh,
      initialized: false,
      pendingCandidates: this.eventQueue.size,
    }
  }

  async runHotPollLoop() {
    while (!this.stopping) {
      const startedAtMs = Date.now()
      try {
        const result = await this.pollHotEvents()
        if (result.catalogRefresh) this.catalogRefreshRequested = true
        if (result.pendingCandidates > 0 && this.sleepResolve) {
          const resolve = this.sleepResolve
          if (this.sleepTimer) clearTimeout(this.sleepTimer)
          this.sleepTimer = null
          this.sleepResolve = null
          resolve()
        }
      } catch (error) {
        this.eventMetrics.lastError = publicError(error)
        this.eventMetrics.consecutiveErrors += 1
      }
      if (this.stopping) break
      const remaining = nextHotPollDelay(
        this.config.eventPollMs,
        this.eventMetrics.consecutiveErrors,
        Date.now() - startedAtMs,
      )
      await new Promise((resolve) => {
        this.hotPollSleepResolve = resolve
        this.hotPollSleepTimer = setTimeout(resolve, remaining)
      })
      this.hotPollSleepResolve = null
      this.hotPollSleepTimer = null
    }
  }

  /** @param {number} timeoutMs */
  async waitForEventWake(timeoutMs) {
    const deadline = Date.now() + timeoutMs
    while (!this.stopping && Date.now() < deadline) {
      if (this.eventQueue.size > 0) {
        const candidatesById = new Map(this.catalog.map((candidate) => [candidate.id, candidate]))
        const wake = this.eventQueue.take(this.config.eventWakeMaxCandidates, {
          nowMs: Date.now(),
          maxAgeMs: this.config.eventWakeMaxAgeMs,
          newestFirst: true,
          priorityForCandidate: (candidateId) => candidateWakePriority(candidatesById.get(candidateId)),
        })
        this.eventMetrics.staleEventCandidateDrops += wake.staleDropped
        if (wake.candidateIds.length > 0) {
          for (const priority of wake.candidatePriorities) {
            if (priority === CandidateWakePriority.EXECUTOR_COMPATIBLE) {
              this.eventMetrics.eventLiveCompatibleCandidatesSelected += 1
            } else if (priority === CandidateWakePriority.EXECUTOR_SHAPE) {
              this.eventMetrics.eventExecutorShapeCandidatesSelected += 1
            } else {
              this.eventMetrics.eventShadowOnlyCandidatesSelected += 1
            }
          }
          const highestPriority = Math.max(...wake.candidatePriorities)
          this.eventMetrics.lastSelectedWakeTier =
            highestPriority === CandidateWakePriority.EXECUTOR_COMPATIBLE
              ? 'EXECUTOR_COMPATIBLE'
              : highestPriority === CandidateWakePriority.EXECUTOR_SHAPE
                ? 'EXECUTOR_SHAPE'
                : 'SHADOW_ONLY'
          return { ...wake, observedAtMs: wake.newestObservedAtMs }
        }
      }

      const remaining = deadline - Date.now()
      if (remaining <= 0) break
      await new Promise((resolve) => {
        this.sleepResolve = resolve
        this.sleepTimer = setTimeout(resolve, Math.min(this.config.eventPollMs, remaining))
      })
      this.sleepResolve = null
      this.sleepTimer = null
    }
    return null
  }

  /** @param {string} tokenA @param {string} tokenB @param {bigint} blockNumber */
  async availableV3Pools(tokenA, tokenB, blockNumber) {
    if (tokenA.toLowerCase() === tokenB.toLowerCase()) return []
    const key = [tokenA.toLowerCase(), tokenB.toLowerCase()].sort().join(':')
    const fixedBlock = this.v3PoolDiscoveryCache.getOrCreate(
      blockNumber,
      key,
      () => this.availableV3PoolsUncached(tokenA, tokenB, blockNumber, key),
      { evictRejected: false },
    )
    if (fixedBlock.hit) this.quoteRpcMetrics.v3FactoryCacheHits += 1
    return fixedBlock.promise
  }

  /** @param {string} tokenA @param {string} tokenB @param {bigint} blockNumber @param {string} key */
  async availableV3PoolsUncached(tokenA, tokenB, blockNumber, key) {
    const cached = this.feeCache.get(key)
    if (cached && (cached.pools.length > 0 || Date.now() - cached.at < this.config.catalogIntervalMs)) {
      return cached.pools
    }
    this.quoteRpcMetrics.v3FactoryReads += V3_FEES.length
    const reads = await this.readMulticall(
      V3_FEES.map((fee) => ({
        address: V3_FACTORY,
        abi: FACTORY_ABI,
        functionName: 'getPool',
        args: [tokenA, tokenB, fee],
      })),
      blockNumber,
      (contract) =>
        this.retryRpc(
          () => this.quoteClient().readContract({ ...contract, blockNumber }),
          () => true,
        ),
    )
    const rejected = reads.filter((result) => result.status === 'failure')
    if (rejected.length > 0) {
      const failure = incompleteRpcError(
        `V3 factory evidence incomplete (${rejected.length}/${V3_FEES.length} reads failed)`,
        rejected[0].error,
      )
      this.recordCycleRpcFailure(failure)
      throw failure
    }
    const available = reads
      .map((result, index) =>
        result.status === 'success' && result.result !== ZERO_ADDRESS
          ? { fee: V3_FEES[index], address: getAddress(result.result) }
          : null,
      )
      .filter((pool) => pool !== null)
    this.feeCache.set(key, { pools: available, at: Date.now() })
    return available
  }

  throwIfPeriodicPreempted() {
    const context = this.rpcCallContext.getStore()
    if (shouldPreemptPeriodicQuote(context, this.eventQueue.acceptedEvents)) {
      context.preempted = true
      throw new PeriodicCyclePreempted()
    }
  }

  /** @param {unknown} failure */
  recordCycleRpcFailure(failure) {
    if (this.rpcCallContext.getStore()?.optionalBaseLane) return
    this.cycleRpcFailure ||= failure
  }

  /** @param {unknown} error */
  isPeriodicPreemption(error) {
    return (
      error instanceof PeriodicCyclePreempted ||
      shouldPreemptPeriodicQuote(this.rpcCallContext.getStore(), this.eventQueue.acceptedEvents)
    )
  }

  /** @param {() => Promise<any>} operation @param {(error: unknown) => boolean} [shouldRetry] */
  retryRpc(operation, shouldRetry = quoteTransportIsIncomplete) {
    const policy = selectRpcRetryPolicy(this.rpcCallContext.getStore(), {
      periodic: { attempts: this.config.rpcLogicalAttempts, delayMs: this.config.rpcRetryDelayMs },
      event: { attempts: this.config.eventRpcLogicalAttempts, delayMs: this.config.eventRpcRetryDelayMs },
    })
    return retryReadOnly(operation, {
      attempts: policy.attempts,
      delayMs: policy.delayMs,
      shouldRetry,
      onRetry: (error) => {
        this.quoteRpcMetrics.rpcLogicalRetries += 1
        if (policy.eventHotPath) {
          this.quoteRpcMetrics.eventRpcLogicalRetries += 1
          this.fallBackFromHotRpc(HotRpcLaneDecision.PUBLIC_TRANSIENT_FALLBACK)
        }
        this.activateUnbatchedTransport(error)
      },
    })
  }

  /** @param {bigint} blockNumber */
  async ensureReadMulticall(blockNumber) {
    if (this.multicallVerifiedAtBlock !== null) return
    const code = await this.retryRpc(() => this.quoteClient().getCode({ address: MULTICALL3, blockNumber }))
    if (!code || code === '0x') throw new Error('canonical Multicall3 code is missing')
    const codeHash = keccak256(code)
    if (codeHash !== MULTICALL3_RUNTIME_CODE_HASH) {
      throw new Error(`canonical Multicall3 code hash mismatch: ${codeHash}`)
    }
    this.multicallVerifiedAtBlock = blockNumber
    this.quoteRpcMetrics.multicallCodeHash = codeHash
  }

  /** @param {Record<string, any>[]} contracts @param {bigint} blockNumber @param {(contract: Record<string, any>) => Promise<any>} readDirect */
  async readMulticall(contracts, blockNumber, readDirect) {
    if (contracts.length === 0) return []
    await this.ensureReadMulticall(blockNumber)
    const { results, stats } = await readWithBoundedMulticall({
      contracts,
      maxCalls: this.config.multicallMaxCalls,
      isTransient: quoteTransportIsIncomplete,
      readBatch: (chunk) =>
        this.retryRpc(() =>
          this.quoteClient().multicall({
            contracts: chunk,
            multicallAddress: MULTICALL3,
            allowFailure: true,
            batchSize: 0,
            blockNumber,
          }),
        ),
      readDirect,
    })
    this.quoteRpcMetrics.multicallRpcBatches += stats.batchRequests
    this.quoteRpcMetrics.multicallSubcalls += stats.batchedSubcalls
    this.quoteRpcMetrics.multicallFailures += stats.aggregateFailures
    this.quoteRpcMetrics.multicallFailedSubcalls += stats.failedSubcalls
    this.quoteRpcMetrics.multicallDirectFallbacks += stats.directFallbacks
    this.quoteRpcMetrics.multicallDirectRecoveries += stats.directRecoveries
    this.quoteRpcMetrics.multicallTransientStops += stats.transientStops
    return results
  }

  /** @param {unknown} error */
  activateUnbatchedTransport(error) {
    if (this.rpcTransportMode !== 'BATCH' || !isMalformedRpcBatchResponse(error)) return false
    this.client = this.unbatchedClient
    this.rpcTransportMode = 'INDIVIDUAL_FALLBACK'
    this.rpcBatchFallbackAt = new Date().toISOString()
    this.rpcBatchFallbackReason = publicError(error)
    this.quoteRpcMetrics.rpcBatchFallbacks += 1
    return true
  }

  /** @param {string} tokenIn @param {string} tokenOut @param {bigint} amountIn @param {bigint} blockNumber @param {string} [bridgeToken] */
  async quoteBestV3(tokenIn, tokenOut, amountIn, blockNumber, bridgeToken = WETH) {
    const cacheKey = `${tokenIn.toLowerCase()}:${tokenOut.toLowerCase()}:${bridgeToken.toLowerCase()}:${amountIn.toString()}`
    const cached = this.v3QuoteCache.getOrCreate(blockNumber, cacheKey, () =>
      this.quoteBestV3Uncached(tokenIn, tokenOut, amountIn, blockNumber, bridgeToken),
    )
    if (cached.hit) this.quoteRpcMetrics.v3QuoterCacheHits += 1
    return cached.promise
  }

  /** @param {string} tokenIn @param {string} tokenOut @param {bigint} amountIn @param {bigint} blockNumber @param {string} bridgeToken */
  async quoteBestV3Uncached(tokenIn, tokenOut, amountIn, blockNumber, bridgeToken) {
    if (tokenIn.toLowerCase() === tokenOut.toLowerCase()) {
      return { amountOut: amountIn, gasEstimate: 0n, fees: [], tokens: [tokenIn], poolAddresses: [], path: '0x' }
    }
    const directionKey = v3DirectionKey(tokenIn, tokenOut, bridgeToken)
    const shortlist = this.v3RouteShortlistCache.getOrCreate(blockNumber, directionKey, () =>
      this.discoverV3Shortlist(tokenIn, tokenOut, amountIn, blockNumber, bridgeToken),
    )
    if (shortlist.hit) this.quoteRpcMetrics.v3ShortlistHits += 1
    const discovery = await shortlist.promise
    if (discovery.amountIn === amountIn) return discovery.best
    const successful = await this.quoteV3Routes(discovery.routes, amountIn, blockNumber)
    if (successful.length === 0) throw new Error('no quotable shortlisted V3 anchor route')
    return successful[0]
  }

  /** @param {string} tokenIn @param {string} tokenOut @param {bigint} amountIn @param {bigint} blockNumber @param {string} bridgeToken */
  async discoverV3Shortlist(tokenIn, tokenOut, amountIn, blockNumber, bridgeToken) {
    const directionKey = v3DirectionKey(tokenIn, tokenOut, bridgeToken)
    const persistent = this.v3PersistentShortlists.get(directionKey)
    const callContext = this.rpcCallContext.getStore()
    const eventHotPath = callContext?.eventHotPath === true
    const coverageProbe = callContext?.probe?.mode === 'BOUNDED_COVERAGE_SAMPLE'
    const boundedV3RouteLimit = callContext?.probe?.v3RouteLimit || this.config.eventV3ShortlistSize
    const refreshPersistent = !coverageProbe && (!persistent || persistent.stale) && this.v3ShortlistRefreshBudget > 0
    if (persistent && !refreshPersistent) {
      const routes =
        eventHotPath || coverageProbe ? selectEventV3Routes(persistent.routes, boundedV3RouteLimit) : persistent.routes
      if (eventHotPath) this.quoteRpcMetrics.eventV3RoutesQuoted += routes.length
      const successful = await this.quoteV3Routes(routes, amountIn, blockNumber)
      if (successful.length > 0) {
        const retainedRoutes = successful.slice(0, this.config.v3ShortlistSize).map((result) => ({
          tokens: result.tokens,
          fees: result.fees,
          poolAddresses: result.poolAddresses,
          path: result.path,
        }))
        // Do not write the old freshness timestamp back here: the independent
        // hot poller may have invalidated this entry while the quote awaited
        // the RPC. The next periodic cycle must retain that refresh request.
        this.quoteRpcMetrics.v3PersistentShortlistHits += 1
        if (persistent.stale) this.quoteRpcMetrics.v3PersistentShortlistStaleUses += 1
        return { amountIn, best: successful[0], routes: retainedRoutes }
      }
      if (eventHotPath) {
        this.quoteRpcMetrics.eventV3TopologyMisses += 1
        throw new Error('event V3 shortlist did not quote; periodic discovery required')
      }
      this.v3PersistentShortlists.delete(directionKey)
      this.quoteRpcMetrics.v3PersistentShortlistRebuilds += 1
    }
    if (eventHotPath) {
      this.quoteRpcMetrics.eventV3TopologyMisses += 1
      throw new Error('event V3 topology unavailable; periodic discovery required')
    }
    if (refreshPersistent) {
      this.v3ShortlistRefreshBudget -= 1
      this.quoteRpcMetrics.v3PersistentShortlistRefreshes += 1
    }

    this.quoteRpcMetrics.v3ShortlistDiscoveries += 1
    const candidates = []
    const directPools = await this.availableV3Pools(tokenIn, tokenOut, blockNumber)
    for (const pool of directPools) {
      candidates.push({
        tokens: [tokenIn, tokenOut],
        fees: [pool.fee],
        poolAddresses: [pool.address],
        path: v3Path([tokenIn, tokenOut], [pool.fee]),
      })
    }

    if (tokenIn.toLowerCase() !== bridgeToken.toLowerCase() && tokenOut.toLowerCase() !== bridgeToken.toLowerCase()) {
      const [entryPools, exitPools] = await Promise.all([
        this.availableV3Pools(tokenIn, bridgeToken, blockNumber),
        this.availableV3Pools(bridgeToken, tokenOut, blockNumber),
      ])
      for (const entryPool of entryPools) {
        for (const exitPool of exitPools) {
          const tokens = [tokenIn, bridgeToken, tokenOut]
          const fees = [entryPool.fee, exitPool.fee]
          candidates.push({
            tokens,
            fees,
            poolAddresses: [entryPool.address, exitPool.address],
            path: v3Path(tokens, fees),
          })
        }
      }
    }

    const attemptedRoutes = refreshPersistent
      ? candidates
      : selectV3BootstrapRoutes(candidates, coverageProbe ? boundedV3RouteLimit : this.config.v3BootstrapMaxRoutes)
    if (!refreshPersistent) {
      this.quoteRpcMetrics.v3BoundedBootstraps += 1
      this.quoteRpcMetrics.v3BoundedBootstrapRoutes += attemptedRoutes.length
    }
    const successful = await this.quoteV3Routes(attemptedRoutes, amountIn, blockNumber)
    if (successful.length === 0) {
      if (!refreshPersistent) this.quoteRpcMetrics.v3BoundedBootstrapMisses += 1
      throw new Error(
        refreshPersistent
          ? 'no quotable direct-or-approved-bridge V3 anchor route'
          : 'no quotable route in bounded V3 bootstrap set',
      )
    }
    const routes = successful
      .slice(0, coverageProbe ? boundedV3RouteLimit : this.config.v3ShortlistSize)
      .map((result) => ({
        tokens: result.tokens,
        fees: result.fees,
        poolAddresses: result.poolAddresses,
        path: result.path,
      }))
    if (refreshPersistent) this.v3PersistentShortlists.set(directionKey, routes)
    else this.v3PersistentShortlists.seed(directionKey, routes)
    return { amountIn, best: successful[0], routes }
  }

  /** @param {Record<string, any>[]} candidates @param {bigint} amountIn @param {bigint} blockNumber */
  async quoteV3Routes(candidates, amountIn, blockNumber) {
    this.quoteRpcMetrics.v3QuoterCalls += candidates.length
    const multicallResults = await this.readMulticall(
      candidates.map((candidate) => ({
        address: V3_QUOTER,
        abi: V3_QUOTER_ABI,
        functionName: 'quoteExactInput',
        args: [candidate.path, amountIn],
      })),
      blockNumber,
      (contract) =>
        this.retryRpc(async () => {
          const { result } = await this.quoteClient().simulateContract({
            account: ZERO_ADDRESS,
            ...contract,
            blockNumber,
          })
          return result
        }),
    )
    const quoteResults = multicallResults.map((item, index) =>
      item.status === 'success'
        ? { amountOut: item.result[0], gasEstimate: item.result[3], ...candidates[index] }
        : { error: item.error },
    )
    const incomplete = quoteResults.find((result) => result?.error && quoteTransportIsIncomplete(result.error))
    if (incomplete) {
      const failure = incompleteRpcError('V3 quote evidence incomplete', incomplete.error)
      this.recordCycleRpcFailure(failure)
      throw failure
    }
    const successful = quoteResults
      .filter((result) => result?.amountOut !== undefined)
      .sort((left, right) => (left.amountOut > right.amountOut ? -1 : 1))
    return successful
  }

  /** @param {Record<string, any>} pool @param {string} tokenIn @param {bigint} amountIn @param {bigint} blockNumber @param {string} blockHash */
  async quoteV4(pool, tokenIn, amountIn, blockNumber, blockHash) {
    const currency0 = addressBefore(pool.tokenAddress, pool.quoteAddress) ? pool.tokenAddress : pool.quoteAddress
    const currency1 = currency0 === pool.tokenAddress ? pool.quoteAddress : pool.tokenAddress
    if (![currency0.toLowerCase(), currency1.toLowerCase()].includes(tokenIn.toLowerCase())) {
      throw new Error('token is not part of V4 pool key')
    }
    const key = `${pool.poolId.toLowerCase()}:${tokenIn.toLowerCase()}:${amountIn.toString()}`
    const cached = this.v4QuoteCache.getOrCreate(blockNumber, key, () => {
      this.quoteRpcMetrics.v4QuoterCalls += 1
      return this.retryRpc(() =>
        this.quoteClient().simulateContract({
          account: ZERO_ADDRESS,
          address: V4_QUOTER,
          abi: V4_QUOTER_ABI,
          functionName: 'quoteExactInputSingle',
          args: [
            {
              poolKey: {
                currency0,
                currency1,
                fee: pool.fee,
                tickSpacing: pool.tickSpacing,
                hooks: pool.hookAddress,
              },
              zeroForOne: tokenIn.toLowerCase() === currency0.toLowerCase(),
              exactAmount: amountIn,
              hookData: '0x',
            },
          ],
          blockNumber,
        }),
      )
    })
    if (cached.hit) this.quoteRpcMetrics.v4QuoterCacheHits += 1
    const { result } = await cached.promise
    const chainAttestation = {
      status: PoolEvidence.INITIALIZED_QUOTER_CONFIRMED,
      blockNumber: blockNumber.toString(),
      blockHash,
      evidence: 'SUCCESSFUL_V4_QUOTER_CALL_AT_FIXED_BLOCK',
    }
    this.chainAttestations.set(pool.poolId, chainAttestation)
    pool.chainAttestation = chainAttestation
    if (
      pool.poolIdEvidence === PoolEvidence.POOL_KEY_MATCHED &&
      pool.hookAddress === OFFICIAL_PAIR_HOOK &&
      pool.launchEnabled === true &&
      (pool.depthStatus === 'ADEQUATE' || pool.chainSourceAttested === true)
    ) {
      pool.executionAdmission = PoolAdmission.EXECUTOR_COMPATIBLE
      pool.amountDepthEvidence = 'SUCCESSFUL_QUOTE_FOR_REQUESTED_INPUT_AT_FIXED_BLOCK'
    }
    return { amountOut: result[0], gasEstimate: result[1] }
  }

  /** @param {bigint} amountIn @param {Record<string, any>} fixed @param {{symbol: string}} base @param {Record<string, any>} entry @param {Record<string, any>} exitPool @param {Record<string, any>} quoteAsset @param {Record<string, any>} exitAnchor */
  screenCandidateRoute(amountIn, fixed, base, entry, exitPool, quoteAsset, exitAnchor) {
    const screeningInput = {
      amountIn,
      amountOut: exitAnchor.amountOut,
      quoterGas: [
        entry.anchor.gasEstimate,
        entry.tokenQuote.gasEstimate,
        quoteAsset.gasEstimate,
        exitAnchor.gasEstimate,
      ],
      overheadGas: this.config.overheadGas,
      gasPriceWei: fixed.gasPrice,
      nativeMarkInWei: fixed.nativeMarkIn,
      nativeMarkOutUsdg: fixed.nativeMark.amountOut,
    }
    const screening = base.symbol === 'USDG' ? screenRoundTrip(screeningInput) : screenWethRoundTrip(screeningInput)
    return { entry, exitPool, quoteAsset, exitAnchor, screening }
  }

  /** @param {Record<string, any>} best @param {bigint} amountIn @param {{symbol: string}} base @param {Record<string, any>[]} failures */
  candidateBaseAmountResult(best, amountIn, base, failures) {
    const normalizedGrossProfitUsdg = best.screening.normalizedGrossProfitUsdg ?? best.screening.grossProfitUsdg
    const normalizedGasCostUsdg = best.screening.normalizedGasCostUsdg ?? best.screening.gasCostUsdg
    const normalizedScreenedNetUsdg = best.screening.normalizedScreenedNetUsdg ?? best.screening.screenedNetUsdg
    return {
      ...best,
      amountIn,
      baseAsset: base.symbol,
      normalizedGrossProfitUsdg,
      normalizedGasCostUsdg,
      normalizedScreenedNetUsdg,
      ...(base.symbol === 'USDG'
        ? {
            grossProfitUsdg: best.screening.grossProfitUsdg,
            screenedNetUsdg: best.screening.screenedNetUsdg,
          }
        : {
            grossProfitWei: best.screening.grossProfitWei,
            screenedNetWei: best.screening.screenedNetWei,
          }),
      failures: failures.slice(0, 12),
    }
  }

  /** @param {Record<string, any>} candidate @param {Record<string, any>} fixed @param {bigint} amountIn @param {{symbol: string, token: string, bridgeToken: string, decimals: number}} base */
  async discoverCandidateV4Shortlist(candidate, fixed, amountIn, base) {
    this.quoteRpcMetrics.v4ShortlistDiscoveries += 1
    if (this.cycleRpcFailure) throw this.cycleRpcFailure
    const failures = []
    const entries = (
      await mapLimit(this.config.legConcurrency, candidate.pools, async (pool) => {
        try {
          const anchor = await this.quoteBestV3(
            base.token,
            pool.quoteAddress,
            amountIn,
            fixed.blockNumber,
            base.bridgeToken,
          )
          const tokenQuote = await this.quoteV4(
            pool,
            pool.quoteAddress,
            anchor.amountOut,
            fixed.blockNumber,
            fixed.block.hash,
          )
          return { pool, anchor, tokenQuote }
        } catch (error) {
          if (quoteTransportIsIncomplete(error))
            this.recordCycleRpcFailure(incompleteRpcError('V4 quote evidence incomplete', error))
          failures.push({ leg: `${base.symbol}_TO_${pool.quoteSymbol}_TO_TOKEN`, reason: publicError(error) })
          return null
        }
      })
    )
      .filter(Boolean)
      .sort((left, right) => (left.tokenQuote.amountOut > right.tokenQuote.amountOut ? -1 : 1))

    if (this.cycleRpcFailure) throw this.cycleRpcFailure

    const routes = []
    for (const entry of entries.slice(0, 2)) {
      const exits = candidate.pools.filter((pool) => pool.poolId !== entry.pool.poolId)
      const quotedExits = await mapLimit(this.config.legConcurrency, exits, async (pool) => {
        try {
          const quoteAsset = await this.quoteV4(
            pool,
            candidate.tokenAddress,
            entry.tokenQuote.amountOut,
            fixed.blockNumber,
            fixed.block.hash,
          )
          const anchor = await this.quoteBestV3(
            pool.quoteAddress,
            base.token,
            quoteAsset.amountOut,
            fixed.blockNumber,
            base.bridgeToken,
          )
          return this.screenCandidateRoute(amountIn, fixed, base, entry, pool, quoteAsset, anchor)
        } catch (error) {
          if (quoteTransportIsIncomplete(error))
            this.recordCycleRpcFailure(incompleteRpcError('V4 quote evidence incomplete', error))
          failures.push({ leg: `TOKEN_TO_${pool.quoteSymbol}_TO_${base.symbol}`, reason: publicError(error) })
          return null
        }
      })
      routes.push(...quotedExits.filter(Boolean))
      if (this.cycleRpcFailure) throw this.cycleRpcFailure
    }

    if (routes.length === 0) {
      return {
        amountIn,
        best: { amountIn, error: 'UNQUOTABLE', failures: failures.slice(0, 12) },
        pairs: [],
      }
    }

    routes.sort((left, right) => {
      const leftNet = left.screening.normalizedScreenedNetUsdg ?? left.screening.screenedNetUsdg
      const rightNet = right.screening.normalizedScreenedNetUsdg ?? right.screening.screenedNetUsdg
      return leftNet > rightNet ? -1 : 1
    })
    const best = routes[0]
    return {
      amountIn,
      best: this.candidateBaseAmountResult(best, amountIn, base, failures),
      pairs: selectV4RoutePairs(routes, this.config.v4ShortlistSize),
    }
  }

  /** @param {Record<string, any>} candidate @param {Record<string, any>} fixed @param {bigint} amountIn @param {{symbol: string, token: string, bridgeToken: string, decimals: number}} base @param {{entryPoolId: string, exitPoolId: string}[]} pairs @param {{rebuildOnFailure?: boolean}} [options] */
  async quoteCandidateV4Pairs(candidate, fixed, amountIn, base, pairs, options = {}) {
    const byPoolId = new Map(candidate.pools.map((pool) => [pool.poolId.toLowerCase(), pool]))
    const failures = []
    const routes = await mapLimit(this.config.legConcurrency, pairs, async (pair) => {
      const entryPool = byPoolId.get(pair.entryPoolId)
      const exitPool = byPoolId.get(pair.exitPoolId)
      if (!entryPool || !exitPool || entryPool.poolId === exitPool.poolId) return null
      try {
        const anchor = await this.quoteBestV3(
          base.token,
          entryPool.quoteAddress,
          amountIn,
          fixed.blockNumber,
          base.bridgeToken,
        )
        const tokenQuote = await this.quoteV4(
          entryPool,
          entryPool.quoteAddress,
          anchor.amountOut,
          fixed.blockNumber,
          fixed.block.hash,
        )
        const entry = { pool: entryPool, anchor, tokenQuote }
        const quoteAsset = await this.quoteV4(
          exitPool,
          candidate.tokenAddress,
          tokenQuote.amountOut,
          fixed.blockNumber,
          fixed.block.hash,
        )
        const exitAnchor = await this.quoteBestV3(
          exitPool.quoteAddress,
          base.token,
          quoteAsset.amountOut,
          fixed.blockNumber,
          base.bridgeToken,
        )
        return this.screenCandidateRoute(amountIn, fixed, base, entry, exitPool, quoteAsset, exitAnchor)
      } catch (error) {
        if (quoteTransportIsIncomplete(error)) {
          this.recordCycleRpcFailure(incompleteRpcError('V4 quote evidence incomplete', error))
        }
        failures.push({
          leg: `${base.symbol}_${entryPool.quoteSymbol}_TOKEN_${exitPool.quoteSymbol}_${base.symbol}`,
          reason: publicError(error),
        })
        return null
      }
    })
    if (this.cycleRpcFailure) throw this.cycleRpcFailure
    const successful = routes.filter(Boolean).sort((left, right) => {
      const leftNet = left.screening.normalizedScreenedNetUsdg ?? left.screening.screenedNetUsdg
      const rightNet = right.screening.normalizedScreenedNetUsdg ?? right.screening.screenedNetUsdg
      return leftNet > rightNet ? -1 : 1
    })
    if (successful.length > 0) {
      return this.candidateBaseAmountResult(successful[0], amountIn, base, failures)
    }
    if (options.rebuildOnFailure === false) {
      return { amountIn, error: 'UNQUOTABLE', failures: failures.slice(0, 12) }
    }
    this.quoteRpcMetrics.v4ShortlistRebuilds += 1
    return (await this.discoverCandidateV4Shortlist(candidate, fixed, amountIn, base)).best
  }

  /** @param {Record<string, any>} candidate @param {Record<string, any>} fixed @param {bigint} amountIn @param {{symbol: string, token: string, bridgeToken: string, decimals: number}} base */
  async quoteCandidateBaseAmount(candidate, fixed, amountIn, base) {
    const key = `${candidate.id.toLowerCase()}:${base.symbol}`
    const shortlist = this.v4RouteShortlistCache.getOrCreate(fixed.blockNumber, key, () =>
      this.discoverCandidateV4Shortlist(candidate, fixed, amountIn, base),
    )
    if (shortlist.hit) this.quoteRpcMetrics.v4ShortlistHits += 1
    const discovery = await shortlist.promise
    if (discovery.amountIn === amountIn) return discovery.best
    if (discovery.pairs.length === 0) {
      this.quoteRpcMetrics.v4ShortlistRebuilds += 1
      return (await this.discoverCandidateV4Shortlist(candidate, fixed, amountIn, base)).best
    }
    return this.quoteCandidateV4Pairs(candidate, fixed, amountIn, base, discovery.pairs)
  }

  /** @param {Record<string, any>} candidate @param {Record<string, any>} fixed @param {bigint} amountIn */
  quoteCandidateAmount(candidate, fixed, amountIn) {
    return this.quoteCandidateBaseAmount(candidate, fixed, amountIn, BASE_ASSETS.USDG)
  }

  /** @param {Record<string, any>} candidate @param {Record<string, any>} fixed @param {{symbol: string, token: string, bridgeToken: string, decimals: number}} base @param {{eventTrigger?: Record<string, any> | null}} [options] */
  async quoteCandidateLane(candidate, fixed, base, options = {}) {
    if (this.cycleRpcFailure) throw this.cycleRpcFailure
    const amountGrid =
      base.symbol === 'USDG'
        ? this.config.amountGrid
        : equivalentWethAmountGrid(this.config.amountGrid, fixed.nativeMarkIn, fixed.nativeMark.amountOut)
    const configuredProbes =
      base.symbol === 'USDG'
        ? this.config.probeAmounts
        : equivalentWethAmountGrid(this.config.probeAmounts, fixed.nativeMarkIn, fixed.nativeMark.amountOut)
    const previousObservation = this.observations.get(candidate.id) || null
    const previousLane =
      previousObservation?.baseOpportunities?.[base.symbol] || (base.symbol === 'USDG' ? previousObservation : null)
    const eventFastPath = Boolean(options.eventTrigger)
    const cycleProbe = this.rpcCallContext.getStore()?.probe || null
    const coverageProbe = !eventFastPath && cycleProbe?.mode === 'BOUNDED_COVERAGE_SAMPLE'
    const boundedProbe = eventFastPath || coverageProbe
    const probePairs = boundedProbe
      ? selectEventV4RoutePairs(
          candidate.pools,
          previousLane,
          options.eventTrigger?.poolKeys || [],
          cycleProbe?.v4PairLimit || this.config.eventV4PairLimit,
        )
      : []
    let previousAmount = null
    if (boundedProbe && previousLane?.amountInBase) {
      try {
        previousAmount = parseUnits(String(previousLane.amountInBase), base.decimals)
      } catch {
        previousAmount = null
      }
    }
    const previousActionable = [BoardStatus.SCREENED_POSITIVE, BoardStatus.GROSS_POSITIVE].includes(
      previousLane?.status,
    )
    const eventProbePlan = eventFastPath
      ? planEventProbeAmounts(
          configuredProbes,
          previousAmount,
          amountGrid[amountGrid.length - 1],
          cycleProbe?.amountLimit || this.config.eventAmountLimit,
          previousActionable,
        )
      : null
    const probeAmounts = eventFastPath
      ? eventProbePlan.initial
      : coverageProbe
        ? selectEventProbeAmounts(
            configuredProbes,
            previousAmount,
            amountGrid[amountGrid.length - 1],
            cycleProbe?.amountLimit || this.config.eventAmountLimit,
          )
        : [...new Set(configuredProbes.map((amount) => amount.toString()))].map((amount) => BigInt(amount))
    if (eventFastPath) {
      this.eventMetrics.eventFastPathAmounts += probeAmounts.length
      this.eventMetrics.eventFastPathPairs += probePairs.length
      if (probePairs.length === 0) this.eventMetrics.eventFastPathMisses += 1
    } else if (coverageProbe) {
      this.eventMetrics.periodicProbeAmounts += probeAmounts.length
      this.eventMetrics.periodicProbePairs += probePairs.length
    }
    const evaluate = (amounts) =>
      mapLimit(this.config.amountQuoteConcurrency, amounts, (amount) => {
        this.throwIfPeriodicPreempted()
        return boundedProbe
          ? this.quoteCandidateV4Pairs(candidate, fixed, amount, base, probePairs, { rebuildOnFailure: false })
          : this.quoteCandidateBaseAmount(candidate, fixed, amount, base)
      })
    const evaluated = await evaluate(probeAmounts)
    if (eventFastPath && eventProbePlan.deferred.length > 0) {
      if (eventProbeNeedsExpansion(evaluated)) {
        this.eventMetrics.eventAdaptiveProbeExpansions += 1
        this.eventMetrics.eventFastPathAmounts += eventProbePlan.deferred.length
        evaluated.push(...(await evaluate(eventProbePlan.deferred)))
      } else {
        this.eventMetrics.eventDeferredAmountQuotesAvoided += eventProbePlan.deferred.length
      }
    }
    this.throwIfPeriodicPreempted()
    const expandGrid =
      !boundedProbe &&
      shouldExpandAmountGrid({
        probeQuotes: evaluated,
        previousStatus: previousLane?.status || null,
        previousFullGridAt: previousLane?.fullGridAt || null,
        priority: false,
        cycleNumber: this.cycleNumber,
        fullGridEveryCycles: this.config.fullGridEveryCycles,
        fullGridRefreshMs: this.config.fullGridRefreshMs,
      })
    if (expandGrid) {
      const evaluatedAmounts = new Set(evaluated.map((quote) => quote.amountIn.toString()))
      const remaining = amountGrid.filter((amount) => !evaluatedAmounts.has(amount.toString()))
      evaluated.push(...(await evaluate(remaining)))
      this.throwIfPeriodicPreempted()
    }

    let best = chooseBestAmountQuote(evaluated)
    let refinements = []
    if (expandGrid && best) {
      const evaluatedAmounts = new Set(evaluated.map((quote) => quote.amountIn.toString()))
      refinements = refinementAmounts(amountGrid, best.amountIn).filter(
        (amount) => !evaluatedAmounts.has(amount.toString()),
      )
      evaluated.push(...(await evaluate(refinements)))
      this.throwIfPeriodicPreempted()
      best = chooseBestAmountQuote(evaluated)
    }

    const normalizedAmount = (value) => (base.symbol === 'USDG' ? value : normalizeWethToUsdg(value, fixed))
    const formatQuote = (quote) => {
      if (quote.error) {
        return {
          baseAsset: base.symbol,
          amountInBase: formatBaseAmount(quote.amountIn, base.decimals),
          normalizedAmountInUsdg: usdg(normalizedAmount(quote.amountIn)),
          status: BoardStatus.UNQUOTABLE,
          amountOutBase: null,
          grossProfitBase: null,
          gasCostProxyBase: null,
          screenedNetBase: null,
          normalizedGrossProfitUsdg: null,
          normalizedGasCostProxyUsdg: null,
          normalizedScreenedNetUsdg: null,
        }
      }
      const screening = quote.screening
      const grossBase = base.symbol === 'USDG' ? screening.grossProfitUsdg : screening.grossProfitWei
      const gasBase = base.symbol === 'USDG' ? screening.gasCostUsdg : screening.gasCostWei
      const netBase = base.symbol === 'USDG' ? screening.screenedNetUsdg : screening.screenedNetWei
      return {
        baseAsset: base.symbol,
        amountInBase: formatBaseAmount(quote.amountIn, base.decimals),
        amountOutBase: formatBaseAmount(quote.exitAnchor.amountOut, base.decimals),
        grossProfitBase: formatBaseAmount(grossBase, base.decimals),
        gasCostProxyBase: formatBaseAmount(gasBase, base.decimals),
        screenedNetBase: formatBaseAmount(netBase, base.decimals),
        normalizedAmountInUsdg: usdg(normalizedAmount(quote.amountIn)),
        normalizedAmountOutUsdg: usdg(normalizedAmount(quote.exitAnchor.amountOut)),
        normalizedGrossProfitUsdg: usdg(quote.normalizedGrossProfitUsdg),
        normalizedGasCostProxyUsdg: usdg(quote.normalizedGasCostUsdg),
        normalizedScreenedNetUsdg: usdg(quote.normalizedScreenedNetUsdg),
        status: screening.status,
        route: `${quote.entry.pool.quoteSymbol} → ${candidate.symbol} → ${quote.exitPool.quoteSymbol}`,
        routeKey: `${quote.entry.pool.poolId}:${quote.exitPool.poolId}`,
        gasUnitsProxy: screening.gasUnitsProxy.toString(),
        quoterGasUnits: screening.routeGas.toString(),
        entryV3Path: quote.entry.anchor.path,
        exitV3Path: quote.exitAnchor.path,
        entryV3Tokens: quote.entry.anchor.tokens,
        exitV3Tokens: quote.exitAnchor.tokens,
        entryV3Pools: quote.entry.anchor.poolAddresses,
        exitV3Pools: quote.exitAnchor.poolAddresses,
        legs: {
          entryPoolId: quote.entry.pool.poolId,
          entryV3Fees: quote.entry.anchor.fees,
          entryV3Hops: quote.entry.anchor.fees.length,
          exitPoolId: quote.exitPool.poolId,
          exitV3Fees: quote.exitAnchor.fees,
          exitV3Hops: quote.exitAnchor.fees.length,
        },
      }
    }

    evaluated.sort((left, right) => (left.amountIn < right.amountIn ? -1 : 1))
    const amountQuotes = evaluated.map(formatQuote)
    const failures = evaluated.flatMap((quote) => quote.failures || []).slice(0, 12)
    const optimizationMode = eventFastPath
      ? 'EVENT_KNOWN_ROUTE_PROBE'
      : coverageProbe
        ? 'BOUNDED_COVERAGE_SAMPLE'
        : expandGrid
          ? refinements.length > 0
            ? 'ADAPTIVE_GRID_REFINED'
            : 'ADAPTIVE_GRID'
          : 'PROBE_ONLY'
    const fullGridAt = expandGrid ? new Date().toISOString() : previousLane?.fullGridAt || null
    const shared = {
      baseAsset: base.symbol,
      baseToken: base.token,
      baseDecimals: base.decimals,
      quotedAt: new Date().toISOString(),
      blockNumber: fixed.blockNumber.toString(),
      blockHash: fixed.block.hash,
      amountQuotes,
      amountGridBase: formatAmountGrid(amountGrid, base.decimals),
      optimizationMode,
      fullGridAt,
      failures,
      v3RoutePolicy: `DIRECT_OR_ONE_${base.bridgeToken === WETH ? 'WETH' : 'USDG'}_BRIDGE_TOP_${this.config.v3ShortlistSize}`,
      receiptEvidence: 'NONE',
    }
    if (!best) {
      return {
        ...shared,
        status: BoardStatus.UNQUOTABLE,
        route: null,
        routeKey: null,
        amountInBase: null,
        amountOutBase: null,
        grossProfitBase: null,
        gasCostProxyBase: null,
        screenedNetBase: null,
        normalizedAmountInUsdg: null,
        normalizedAmountOutUsdg: null,
        normalizedGrossProfitUsdg: null,
        normalizedGasCostProxyUsdg: null,
        normalizedScreenedNetUsdg: null,
        evidenceLevel: 'FIXED_BLOCK_QUOTE_FAILED',
        executionEstimate: 'NOT_RUN',
      }
    }

    const formattedBest = formatQuote(best)
    const routeDepths = [best.entry.pool.depthUsd, best.exitPool.depthUsd]
    const minimumRouteDepthUsd = routeDepths.every((value) => Number.isFinite(value)) ? Math.min(...routeDepths) : null
    const routeExecutionAdmission = [best.entry.pool, best.exitPool].every(
      (pool) => pool.executionAdmission === PoolAdmission.EXECUTOR_COMPATIBLE,
    )
      ? PoolAdmission.EXECUTOR_COMPATIBLE
      : 'SHADOW_ONLY'
    return {
      ...shared,
      ...formattedBest,
      gasPriceWei: fixed.gasPrice.toString(),
      minimumRouteDepthUsd,
      routeExecutionAdmission,
      entryV3Fees: best.entry.anchor.fees,
      exitV3Fees: best.exitAnchor.fees,
      legs: {
        ...formattedBest.legs,
        entryV3Fee: best.entry.anchor.fees.length === 1 ? best.entry.anchor.fees[0] : null,
        entryV3Pools: best.entry.anchor.poolAddresses,
        entryV4Fee: best.entry.pool.fee,
        exitV4Fee: best.exitPool.fee,
        exitV3Fee: best.exitAnchor.fees.length === 1 ? best.exitAnchor.fees[0] : null,
        exitV3Pools: best.exitAnchor.poolAddresses,
      },
      evidenceLevel: 'FIXED_BLOCK_QUOTER_SCREEN_WITH_POOL_ATTESTATION_AND_V3_SHORTLIST',
      executionEstimate: 'NOT_RUN_EXACT_EXECUTOR_PREFLIGHT_REQUIRED',
    }
  }

  /** @param {Record<string, any>} candidate @param {Record<string, any>} fixed @param {{eventTrigger?: Record<string, any> | null}} [options] */
  async quoteCandidate(candidate, fixed, options = {}) {
    if (options.eventTrigger) this.eventMetrics.eventFastPathCandidates += 1
    else if (this.rpcCallContext.getStore()?.probe?.mode === 'BOUNDED_COVERAGE_SAMPLE') {
      this.eventMetrics.periodicProbeCandidates += 1
    }
    const failedWethLane = (error) => ({
      baseAsset: 'WETH',
      baseToken: WETH,
      baseDecimals: 18,
      status: BoardStatus.UNQUOTABLE,
      quotedAt: new Date().toISOString(),
      blockNumber: fixed.blockNumber.toString(),
      blockHash: fixed.block.hash,
      route: null,
      normalizedScreenedNetUsdg: null,
      evidenceLevel: 'WETH_LANE_FIXED_BLOCK_QUOTE_INCOMPLETE',
      executionEstimate: 'NOT_RUN',
      receiptEvidence: 'NONE',
      failures: [{ leg: 'WETH_LANE', reason: publicError(error) }],
    })
    const quoteWethLane = () => {
      const parentContext = this.rpcCallContext.getStore()
      return this.rpcCallContext.run({ ...parentContext, optionalBaseLane: true }, () =>
        this.quoteCandidateLane(candidate, fixed, BASE_ASSETS.WETH, options),
      )
    }
    let usdgLane
    let wethLane = null
    if (this.config.wethBaseEnabled && options.eventTrigger) {
      this.eventMetrics.eventParallelBaseCycles += 1
      const lanes = await runRequiredWithOptional(
        () => this.quoteCandidateLane(candidate, fixed, BASE_ASSETS.USDG, options),
        quoteWethLane,
      )
      usdgLane = lanes.required
      wethLane = lanes.optional
      if (lanes.optionalError) {
        if (this.isPeriodicPreemption(lanes.optionalError)) throw new PeriodicCyclePreempted()
        wethLane = failedWethLane(lanes.optionalError)
      }
    } else {
      usdgLane = await this.quoteCandidateLane(candidate, fixed, BASE_ASSETS.USDG, options)
      this.throwIfPeriodicPreempted()
    }
    if (this.config.wethBaseEnabled && !options.eventTrigger) {
      try {
        wethLane = await quoteWethLane()
      } catch (error) {
        if (this.isPeriodicPreemption(error)) throw new PeriodicCyclePreempted()
        wethLane = failedWethLane(error)
      }
    }
    const baseOpportunities = { USDG: usdgLane, ...(wethLane ? { WETH: wethLane } : {}) }
    const preferred = chooseBestBaseOpportunity(
      Object.values(baseOpportunities).map((lane) => ({ ...lane, fresh: true })),
    )
    return {
      ...legacyUsdgLane(usdgLane),
      baseOpportunities,
      preferredBaseAsset: preferred?.baseAsset || null,
      preferredNormalizedScreenedNetUsdg: preferred?.normalizedScreenedNetUsdg || null,
    }
  }

  /** @param {string[]} [wakeCandidateIds] @param {number | null} [periodicMaxCandidates] */
  selectCandidates(wakeCandidateIds = [], periodicMaxCandidates = null) {
    const byId = new Map(this.catalog.map((candidate) => [candidate.id, candidate]))

    if (wakeCandidateIds.length > 0) {
      const selected = []
      const seen = new Set()
      for (const id of wakeCandidateIds.slice(0, this.config.eventWakeMaxCandidates)) {
        const candidate = byId.get(id.toLowerCase())
        if (candidate && !seen.has(candidate.id)) {
          seen.add(candidate.id)
          selected.push(candidate)
        }
      }
      return selected
    }

    const result = selectPeriodicShadowCandidates(this.catalog, this.observations, {
      priorityIds: rotatingSlice(
        INITIAL_PRIORITY,
        this.cycleNumber * this.config.priorityRefreshSize,
        this.config.priorityRefreshSize,
      ),
      positiveStatuses: [BoardStatus.SCREENED_POSITIVE, BoardStatus.GROSS_POSITIVE],
      topRefreshSize: this.config.topRefreshSize,
      batchSize: this.config.batchSize,
      cursor: this.cursor,
      maxCandidates: periodicMaxCandidates ?? this.config.cycleMaxCandidates,
    })
    this.cursor = result.nextCursor
    return result.selected
  }

  async fixedBlock() {
    const chainId = await this.retryRpc(() => this.quoteClient().getChainId())
    if (chainId !== CHAIN_ID) throw new Error(`wrong chain id ${chainId}`)
    const head = await this.retryRpc(() => this.quoteClient().getBlockNumber())
    const blockNumber = head > this.config.blockLag ? head - this.config.blockLag : head
    const [block, gasPrice] = await Promise.all([
      this.retryRpc(() => this.quoteClient().getBlock({ blockNumber })),
      this.retryRpc(() => this.quoteClient().getGasPrice()),
    ])
    await this.ensureReadMulticall(blockNumber)
    const nativeMarkIn = parseEther('0.004')
    const nativeMark = await this.quoteBestV3(WETH, USDG, nativeMarkIn, blockNumber)
    return { blockNumber, block, gasPrice, nativeMarkIn, nativeMark }
  }

  publish(status) {
    const generatedAt = new Date().toISOString()
    const snapshot = buildBoardSnapshot({
      generatedAt,
      catalog: this.catalog,
      observations: this.observations,
      staleMs: this.config.staleMs,
      sourceState: this.sourceState(),
      serviceState: this.serviceState(status),
    })
    const reconciled = reconcileOpportunityEpisodes(this.previousSnapshot, snapshot)
    if (!this.eventLedgerEpoch) {
      this.eventLedgerEpoch = generatedAt
      reconciled.events.unshift({
        schemaVersion: 2,
        type: 'EVENT_LEDGER_EPOCH_STARTED',
        at: generatedAt,
        semantics: 'ECONOMIC_EPISODES_V2',
        legacyHistoryBefore: generatedAt,
      })
    }
    reconciled.snapshot.eventLedger.epochStartedAt = this.eventLedgerEpoch
    reconciled.snapshot.health.persistence = this.persistenceState
    // The admitted graph can contain thousands of candidates. Stream the
    // durable compatibility snapshot so publication never allocates a second
    // snapshot-sized pretty-JSON string inside the board cgroup.
    writeStableJsonAtomic(this.snapshotPath, reconciled.snapshot)
    writeExecutionBoardSnapshot(this.executionSnapshotPath, reconciled.snapshot)
    appendEvents(this.eventsPath, reconciled.events)
    try {
      const committed = this.store.persistProjection({
        snapshot: reconciled.snapshot,
        sourceCatalog: null,
        sourceCatalogHash: this.latestSourceCatalogHash,
        events: reconciled.events,
      })
      this.persistenceState = {
        ...this.store.health(),
        lastCommitAt: generatedAt,
        lastError: null,
        parity: committed.parity,
        sourceCatalogProjection: 'ATOMIC_HASHED_FILE',
        sourceCatalogHash: this.latestSourceCatalogHash,
      }
    } catch (error) {
      this.persistenceState = {
        ...this.persistenceState,
        status: 'DEGRADED',
        lastCommitAt: this.persistenceState.lastCommitAt,
        lastError: publicError(error),
        parity: false,
      }
    }
    this.persistState(generatedAt)
    this.previousSnapshot = reconciled.snapshot
    this.snapshot = reconciled.snapshot
    return reconciled
  }

  /** @param {{forceCatalog?: boolean, eventWake?: Record<string, any> | null}} [options] */
  async cycle(options = {}) {
    const eventWake = options.eventWake ?? null
    const policy = quoteCyclePolicy({
      eventWake: eventWake !== null,
      cycleMaxCandidates: this.config.cycleMaxCandidates,
      protectedPeriodicCandidates: this.config.protectedPeriodicCandidates,
      eventV4PairLimit: this.config.eventV4PairLimit,
      eventAmountLimit: this.config.eventAmountLimit,
      eventV3RouteLimit: this.config.eventV3ShortlistSize,
      periodicV4PairLimit: this.config.periodicV4PairLimit,
      periodicAmountLimit: this.config.periodicAmountLimit,
      periodicV3RouteLimit: this.config.periodicV3RouteLimit,
    })
    const hotRpcSelection = selectHotRpcLane({
      enabled: this.config.hotRpcEnabled,
      endpointConfigured: Boolean(this.hotClient),
      candidatePriorities: eventWake?.candidatePriorities || [],
      minimumPriority: CandidateWakePriority.EXECUTOR_SHAPE,
    })
    let hotRpcActive = false
    let hotRpcDecision = hotRpcSelection.reason
    if (eventWake && hotRpcSelection.selected) {
      const admission = this.hotRpcBudget.admitEventCandidates(eventWake.candidateIds?.length || 1)
      hotRpcActive = admission.admitted
      hotRpcDecision = admission.reason
    }
    const callContext = {
      cyclePolicy: policy.mode,
      preemptible: policy.preemptible,
      maxCandidates: policy.maxCandidates,
      // Coverage limits start only after the fixed-block native Gas mark is
      // established. Event limits remain active for the whole hot cycle.
      probe: eventWake === null ? null : policy.probe,
      candidateProbe: policy.probe,
      eventHotPath: eventWake !== null,
      hotRpcRouting: {
        selected: hotRpcActive,
        active: hotRpcActive,
        decision: hotRpcDecision,
        fallbackReason: null,
      },
      acceptedEventsAtStart: this.eventQueue.acceptedEvents,
      preempted: false,
    }
    return this.rpcCallContext.run(callContext, async () => {
      const result = await this.runCycle(options)
      if (eventWake) {
        const role = this.eventQuoteRpcRole()
        this.eventMetrics.lastEventQuoteRpcRole = role
        this.eventMetrics.lastEventQuoteRpcFallbackReason = callContext.hotRpcRouting.fallbackReason
        if (callContext.hotRpcRouting.selected) this.eventMetrics.managedEventQuoteCycles += 1
        else this.eventMetrics.publicEventQuoteCycles += 1
        if (
          [
            HotRpcLaneDecision.PUBLIC_EVENT_BUDGET_EXHAUSTED,
            HotRpcLaneDecision.PUBLIC_LOGICAL_BUDGET_EXHAUSTED,
          ].includes(callContext.hotRpcRouting.decision) ||
          callContext.hotRpcRouting.fallbackReason === HotRpcLaneDecision.PUBLIC_LOGICAL_BUDGET_EXHAUSTED
        ) {
          this.eventMetrics.hotRpcBudgetFallbackCycles += 1
        }
        if (callContext.hotRpcRouting.fallbackReason === HotRpcLaneDecision.PUBLIC_TRANSIENT_FALLBACK) {
          this.eventMetrics.hotRpcTransientFallbackCycles += 1
        }
      }
      return result
    })
  }

  /** @param {{forceCatalog?: boolean, eventWake?: Record<string, any> | null}} [options] */
  async runCycle(options = {}) {
    const { forceCatalog = false, eventWake = null } = options
    if (this.inCycle) return null
    const cycleStartedAtMs = Date.now()
    let eventPhaseStartedAt = performance.now()
    const eventTiming = eventWake
      ? {
          detectedToCycleStartMs: eventWake.observedAtMs ? Math.max(0, cycleStartedAtMs - eventWake.observedAtMs) : 0,
        }
      : null
    const markEventPhase = (name) => {
      if (!eventTiming) return
      const now = performance.now()
      eventTiming[name] = Number((now - eventPhaseStartedAt).toFixed(2))
      eventPhaseStartedAt = now
    }
    this.inCycle = true
    this.cycleRpcFailure = null
    this.v3ShortlistRefreshBudget = eventWake ? 0 : this.config.v3ShortlistRefreshesPerCycle
    const quoterCallsBefore = this.quoteRpcMetrics.v3QuoterCalls + this.quoteRpcMetrics.v4QuoterCalls
    let selectedCount = 0
    try {
      // Event wakes must never perform network catalog fetches, full graph
      // rebuilds or large projection writes before their fixed-block quote.
      // The next protected periodic lane consumes every deferred refresh.
      const { fullCatalogDue, metadataDue } = catalogMaintenancePolicy({
        eventWake: eventWake !== null,
        forceCatalog,
        catalogRefreshRequested: this.catalogRefreshRequested,
        lastFullCatalogAt: this.lastFullCatalogAt,
        lastCatalogAt: this.lastCatalogAt,
        catalogIntervalMs: this.config.catalogIntervalMs,
      })
      if (metadataDue) {
        await this.refreshCatalog({ full: fullCatalogDue })
        this.catalogRefreshRequested = false
      }
      // Periodic work may change catalog metadata before quoting, so it
      // refreshes routing and publishes SCANNING. Event work cannot change the
      // catalog here and already starts from the dependency index committed by
      // the previous cycle. Do not serialize a multi-thousand-row projection
      // ahead of the latency-sensitive fixed-block quote.
      if (!eventWake) {
        this.dependencyIndex = buildShadowDependencyIndex(this.catalog, this.observations)
        this.publish('SCANNING')
      }
      markEventPhase('preFixedBlockMs')
      const fixed = await this.fixedBlock()
      markEventPhase('fixedBlockMs')
      this.throwIfPeriodicPreempted()
      if (this.hotCursor.nextBlock === null) {
        this.hotCursor = {
          ...this.hotCursor,
          nextBlock: (fixed.blockNumber + 1n).toString(),
          lastProcessedBlock: fixed.blockNumber.toString(),
          lastProcessedBlockHash: fixed.block.hash,
          initializedFrom: 'INITIAL_FIXED_BLOCK_RECONCILIATION',
        }
        this.persistState()
      }
      const cyclePolicy = this.rpcCallContext.getStore()
      const selected = this.selectCandidates(
        eventWake?.candidateIds || [],
        eventWake ? null : cyclePolicy?.maxCandidates || this.config.protectedPeriodicCandidates,
      )
      selectedCount = selected.length
      const triggerByCandidate = new Map((eventWake?.triggers || []).map((trigger) => [trigger.candidateId, trigger]))
      markEventPhase('candidateSelectionMs')
      await mapLimit(this.config.quoteConcurrency, selected, async (candidate) => {
        try {
          const trigger = triggerByCandidate.get(candidate.id)
          const parentContext = this.rpcCallContext.getStore()
          const observation = await this.rpcCallContext.run(
            { ...parentContext, probe: parentContext?.candidateProbe || null },
            () => this.quoteCandidate(candidate, fixed, { eventTrigger: trigger || null }),
          )
          if (trigger) {
            observation.quoteTrigger = {
              mode: 'EVENT_DRIVEN_HTTP_LOG_WAKE',
              rpcRole: this.eventQuoteRpcRole(),
              sources: trigger.sources,
              eventCount: trigger.eventCount,
              minBlock: trigger.minBlock.toString(),
              maxBlock: trigger.maxBlock.toString(),
              observedLogToQuoteMs: Date.now() - trigger.lastObservedAtMs,
            }
          } else {
            observation.quoteTrigger = { mode: 'PERIODIC_RECONCILIATION' }
          }
          this.observations.set(candidate.id, observation)
        } catch (error) {
          if (this.isPeriodicPreemption(error)) throw new PeriodicCyclePreempted()
          this.observations.set(candidate.id, {
            status: BoardStatus.UNQUOTABLE,
            quotedAt: new Date().toISOString(),
            blockNumber: fixed.blockNumber.toString(),
            blockHash: fixed.block.hash,
            failures: [{ leg: 'CANDIDATE', reason: publicError(error) }],
            evidenceLevel: 'FIXED_BLOCK_QUOTE_FAILED',
            executionEstimate: 'NOT_RUN',
            receiptEvidence: 'NONE',
            quoteTrigger: triggerByCandidate.has(candidate.id)
              ? { mode: 'EVENT_DRIVEN_HTTP_LOG_WAKE', failed: true }
              : { mode: 'PERIODIC_RECONCILIATION', failed: true },
          })
        }
      })
      markEventPhase('candidateQuoteMs')
      if (this.cycleRpcFailure) throw this.cycleRpcFailure
      const quotesCompletedAt = new Date().toISOString()
      this.lastQuoteAt = quotesCompletedAt
      if (eventTiming) {
        eventTiming.observedToQuoteCompleteMs = eventWake.observedAtMs
          ? Math.max(0, Date.now() - eventWake.observedAtMs)
          : eventTiming.preFixedBlockMs +
            eventTiming.fixedBlockMs +
            eventTiming.candidateSelectionMs +
            eventTiming.candidateQuoteMs
      }
      const executionCheckpointCandidateCount = screenedPositiveObservationCount(
        selected.map((candidate) => this.observations.get(candidate.id)),
      )
      if (executionCheckpointCandidateCount > 0) {
        this.eventMetrics.executionFeedCheckpoints += 1
        this.eventMetrics.lastExecutionFeedCheckpointAt = quotesCompletedAt
        this.eventMetrics.lastExecutionFeedCheckpointCandidateCount = executionCheckpointCandidateCount
        // Keep this checkpoint before all catalog maintenance. A valid screen
        // must reach the signer feed while its fixed-block quote is still
        // inside the watcher's execution-freshness horizon.
        this.publish('SCANNING')
      }
      if (!eventWake) {
        try {
          await this.advanceLaunchSourceCatalog(fixed.blockNumber)
        } catch {
          this.writeSourceCatalog(fixed.blockNumber)
        }
        this.throwIfPeriodicPreempted()
        try {
          await this.advanceSourcePoolCatalog(fixed.blockNumber)
        } catch {
          this.writeSourceCatalog(fixed.blockNumber)
        }
        this.throwIfPeriodicPreempted()
        try {
          await this.advanceChainCatalog(fixed.blockNumber)
          this.chainCatalogLastError = null
        } catch (error) {
          this.chainCatalogLastError = publicError(error)
          this.adapterStates['pair.chain-catalog.v1'] = markAdapterError(
            this.adapterStates['pair.chain-catalog.v1'],
            error,
          )
          this.writeSourceCatalog(fixed.blockNumber)
        }
        this.throwIfPeriodicPreempted()
      }
      this.dependencyIndex = buildShadowDependencyIndex(this.catalog, this.observations)
      markEventPhase('postQuoteBookkeepingMs')
      const cycleQuoterCalls =
        this.quoteRpcMetrics.v3QuoterCalls + this.quoteRpcMetrics.v4QuoterCalls - quoterCallsBefore
      this.eventMetrics.lastCycleTrigger = eventWake ? 'POOL_EVENT' : 'PERIODIC_RECONCILIATION'
      this.eventMetrics.lastCycleCandidateCount = selected.length
      this.eventMetrics.lastCycleQuoterCalls = cycleQuoterCalls
      if (eventWake) {
        this.eventMetrics.eventQuoteCandidates += selected.length
        this.eventMetrics.eventDrivenQuoterCalls += cycleQuoterCalls
        this.eventMetrics.lastEventToQuoteMs = eventTiming.observedToQuoteCompleteMs
        this.recordEventCycleLatency(eventTiming)
      } else {
        this.eventMetrics.reconciliationQuoterCalls += cycleQuoterCalls
      }
      this.lastCycleAt = new Date().toISOString()
      if (!eventWake) this.eventMetrics.lastPeriodicCycleAt = this.lastCycleAt
      this.cycleNumber += 1
      this.consecutiveErrors = 0
      this.lastError = null
      return this.publish(this.catalogComplete ? 'RUNNING' : 'DEGRADED_PARTIAL_CATALOG')
    } catch (error) {
      this.lastCycleAt = new Date().toISOString()
      this.cycleNumber += 1
      if (this.isPeriodicPreemption(error)) {
        const cycleQuoterCalls =
          this.quoteRpcMetrics.v3QuoterCalls + this.quoteRpcMetrics.v4QuoterCalls - quoterCallsBefore
        this.eventMetrics.periodicPreemptions += 1
        this.eventMetrics.lastPeriodicPreemptedAt = this.lastCycleAt
        this.eventMetrics.lastPeriodicPreemptQuoterCalls = cycleQuoterCalls
        this.eventMetrics.lastCycleTrigger = 'PERIODIC_PREEMPTED'
        this.eventMetrics.lastCycleCandidateCount = selectedCount
        this.eventMetrics.lastCycleQuoterCalls = cycleQuoterCalls
        this.eventMetrics.reconciliationQuoterCalls += cycleQuoterCalls
        this.lastError = null
        return this.publish('SCANNING')
      }
      this.consecutiveErrors += 1
      this.lastError = publicError(error)
      return this.publish('DEGRADED')
    } finally {
      this.inCycle = false
    }
  }

  recentEvents(limit = 100) {
    if (!fs.existsSync(this.eventsPath)) return []
    return fs
      .readFileSync(this.eventsPath, 'utf8')
      .trim()
      .split('\n')
      .slice(-limit)
      .map((line) => {
        try {
          return JSON.parse(line)
        } catch {
          return null
        }
      })
      .filter(Boolean)
      .reverse()
  }

  dashboardModel({ includeOpportunities = false, includeOpportunityDetails = false, opportunityId = null } = {}) {
    const sqlite = this.config.readModel === 'sqlite'
    const snapshot = sqlite ? this.store.readCurrentSnapshot({ fallback: false }) : this.snapshot
    if (!snapshot) return null
    const sourceCatalog = this.latestSourceCatalog || readJson(this.sourceCatalogPath)
    const projectionMode = includeOpportunities
      ? includeOpportunityDetails
        ? `OPPORTUNITY_DETAIL:${opportunityId || 'UNKNOWN'}`
        : 'ADMITTED_OPPORTUNITY_SUMMARIES'
      : 'CONTROL_PLANE_ONLY'
    const projectedSnapshot = opportunityId
      ? {
          ...snapshot,
          items: (snapshot.items || []).filter((item) => item.id === opportunityId),
        }
      : snapshot
    const cacheKey = [
      projectionMode,
      this.config.readModel,
      sqlite ? this.store.currentRevision() : snapshot.generatedAt,
      sourceCatalog?.generatedAt || 'NO_SOURCE_CATALOG',
      this.persistenceState.status,
      this.persistenceState.parity,
      this.persistenceState.lastError,
      process.env.MANGA_RELEASE_SHA || 'UNKNOWN_RELEASE',
    ].join('|')
    if (this.dashboardCache?.key === cacheKey) return this.dashboardCache.model
    const model = buildDashboardModel({
      snapshot: projectedSnapshot,
      sourceCatalog,
      episodes: this.store.listEpisodes(),
      executions: this.store.listExecutions(),
      persistence: this.persistenceState,
      release: process.env.MANGA_RELEASE_SHA || null,
      readModel: this.config.readModel,
      includeOpportunities,
      includeSourceOnly: false,
      includeOpportunityDetails,
    })
    this.dashboardCache = { key: cacheKey, model }
    return model
  }

  respondJson(response, status, payload) {
    response.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    })
    response.end(`${JSON.stringify(payload)}\n`)
  }

  respondJsonFile(response, file) {
    let descriptor = null
    try {
      descriptor = fs.openSync(file, 'r')
      const metadata = fs.fstatSync(descriptor)
      if (!metadata.isFile()) throw new Error('JSON projection is not a regular file')
      response.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': metadata.size,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      })
      const stream = fs.createReadStream(file, { fd: descriptor, autoClose: true })
      descriptor = null
      stream.on('error', () => response.destroy())
      stream.pipe(response)
    } catch {
      if (descriptor !== null) fs.closeSync(descriptor)
      this.respondJson(response, 503, { status: 'BACKFILL_NOT_STARTED' })
    }
  }

  startHttp() {
    this.server = httpServer.createServer((request, response) => {
      if (request.method !== 'GET') return this.respondJson(response, 405, { error: 'method not allowed' })
      const requestUrl = new URL(request.url || '/', `http://${this.config.host}:${this.config.port}`)
      if (requestUrl.pathname === '/api/snapshot') {
        const payload =
          requestUrl.searchParams.get('view') === 'execution'
            ? compactExecutionBoardSnapshot(this.snapshot)
            : this.snapshot
        return this.respondJson(response, payload ? 200 : 503, payload || { status: 'STARTING' })
      }
      if (requestUrl.pathname === '/api/events') return this.respondJson(response, 200, this.recentEvents())
      if (requestUrl.pathname === '/api/chain-catalog') {
        const catalog = readJson(this.chainCatalogPath)
        return this.respondJson(response, catalog ? 200 : 503, catalog || { status: 'BACKFILL_NOT_STARTED' })
      }
      if (requestUrl.pathname === '/api/source-catalog') {
        return this.respondJsonFile(response, this.sourceCatalogPath)
      }
      if (requestUrl.pathname === '/api/event-metrics') {
        return this.respondJson(response, 200, this.serviceState().eventDrivenShadow)
      }
      if (requestUrl.pathname === '/api/v1/business') {
        try {
          return this.respondJson(
            response,
            200,
            readPublicBusinessSnapshot(this.config.businessSnapshotPath, { maxAgeMs: 15 * 60 * 1_000 }),
          )
        } catch {
          return this.respondJson(response, 503, { status: 'BUSINESS_SNAPSHOT_NOT_READY' })
        }
      }
      if (requestUrl.pathname.startsWith('/api/v1/')) {
        const includeOpportunities = dashboardApiNeedsOpportunityProjection(requestUrl.pathname)
        const includeOpportunityDetails = dashboardApiNeedsOpportunityDetails(requestUrl.pathname)
        let opportunityId = null
        if (includeOpportunityDetails) {
          try {
            opportunityId = decodeURIComponent(requestUrl.pathname.slice('/api/v1/opportunities/'.length))
          } catch {
            return this.respondJson(response, 400, { error: 'invalid opportunity id' })
          }
        }
        const routed = routeDashboardApi(
          requestUrl.pathname,
          requestUrl.searchParams,
          this.dashboardModel({ includeOpportunities, includeOpportunityDetails, opportunityId }),
        )
        return this.respondJson(response, routed.status, routed.payload)
      }
      if (requestUrl.pathname === '/healthz') {
        const age = this.lastCycleAt ? Date.now() - Date.parse(this.lastCycleAt) : Number.POSITIVE_INFINITY
        const healthyStatus = ['RUNNING', 'SCANNING'].includes(this.snapshot?.health?.status)
        const persistenceHealthy =
          this.config.readModel !== 'sqlite' ||
          (this.persistenceState.status === 'HEALTHY' && this.persistenceState.parity !== false)
        const healthy = Boolean(
          this.snapshot &&
          healthyStatus &&
          persistenceHealthy &&
          age <= Math.max(this.config.staleMs * 2, this.config.scanIntervalMs * 4),
        )
        return this.respondJson(response, healthy ? 200 : 503, {
          status: healthy ? 'HEALTHY' : 'NOT_READY',
          lastCycleAt: this.lastCycleAt,
          candidateTokens: this.snapshot?.coverage?.candidateTokens ?? 0,
          screenedPositive: this.snapshot?.coverage?.counts?.[BoardStatus.SCREENED_POSITIVE] ?? 0,
          eventLastPollAt: this.eventMetrics.lastPollAt,
          chainCatalogStatus: this.chainCatalogComplete ? 'COMPLETE_FROM_CONFIGURED_START' : 'BACKFILL_PARTIAL',
          sourceCatalogStatus: this.sourceState().sourceCatalog.status,
          readModel: this.config.readModel,
          persistenceStatus: this.persistenceState.status,
          persistenceParity: this.persistenceState.parity,
        })
      }
      const dashboardAsset = resolveDashboardAsset(this.dashboardRoot, requestUrl.pathname)
      if (dashboardAsset?.status === 200) {
        response.writeHead(200, {
          'content-type': dashboardAsset.contentType,
          'cache-control': dashboardAsset.cacheControl,
          'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'",
          'x-content-type-options': 'nosniff',
          'x-frame-options': 'DENY',
          'referrer-policy': 'no-referrer',
        })
        response.end(fs.readFileSync(dashboardAsset.path))
        return
      }
      if (dashboardAsset && requestUrl.pathname !== '/') {
        return this.respondJson(response, dashboardAsset.status, { error: dashboardAsset.error })
      }
      if (requestUrl.pathname !== '/') return this.respondJson(response, 404, { error: 'not found' })
      response.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'content-security-policy':
          "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'",
        'x-content-type-options': 'nosniff',
        'x-frame-options': 'DENY',
        'referrer-policy': 'no-referrer',
      })
      response.end(this.html)
    })
    return new Promise((resolve, reject) => {
      this.server.once('error', reject)
      this.server.listen(this.config.port, this.config.host, () => resolve())
    })
  }

  async watch() {
    if (!this.client) throw new Error('MANGA_BOARD_RPC_URL is required for watch mode')
    fs.mkdirSync(this.config.runDir, { recursive: true, mode: 0o700 })
    if (this.snapshot) writeExecutionBoardSnapshot(this.executionSnapshotPath, this.snapshot)
    await this.startHttp()
    console.log(
      JSON.stringify({
        status: 'BOARD_HTTP_READY',
        listen: `${this.config.host}:${this.config.port}`,
        mode: 'READ_ONLY_NO_SIGNING_NO_BROADCAST',
      }),
    )
    this.hotPollTask = this.runHotPollLoop()
    let eventWake = null
    let nextPeriodicAtMs = 0
    try {
      while (!this.stopping) {
        const started = Date.now()
        const periodicCycle = eventWake === null
        const result = await this.cycle({ forceCatalog: this.catalog.length === 0, eventWake })
        if (result) {
          console.log(
            JSON.stringify({
              status: result.snapshot.health.status,
              generatedAt: result.snapshot.generatedAt,
              candidates: result.snapshot.coverage.candidateTokens,
              freshQuoted: result.snapshot.coverage.freshQuotedTokens,
              screenedPositive: result.snapshot.coverage.counts[BoardStatus.SCREENED_POSITIVE] || 0,
              events: result.events.length,
              trigger: eventWake ? 'POOL_EVENT' : 'PERIODIC_RECONCILIATION',
              eventCandidateCount: eventWake?.candidateIds?.length || 0,
            }),
          )
        }
        const remaining = nextCycleDelay({
          scanIntervalMs: this.config.scanIntervalMs,
          cycleDurationMs: Date.now() - started,
          minimumPauseMs: this.config.minimumCyclePauseMs,
        })
        if (periodicCycle) nextPeriodicAtMs = Date.now() + remaining
        this.eventMetrics.nextPeriodicCycleAt = new Date(nextPeriodicAtMs).toISOString()
        const eventWaitMs = capEventWaitForReconciliation(remaining, Date.now(), nextPeriodicAtMs)
        eventWake = eventWaitMs > 0 ? await this.waitForEventWake(eventWaitMs) : null
      }
    } finally {
      this.stopping = true
      if (this.hotPollSleepTimer) clearTimeout(this.hotPollSleepTimer)
      if (this.hotPollSleepResolve) this.hotPollSleepResolve()
      await this.hotPollTask
      this.hotPollTask = null
      this.store.close()
    }
  }

  async stop() {
    this.stopping = true
    if (this.sleepTimer) clearTimeout(this.sleepTimer)
    if (this.sleepResolve) this.sleepResolve()
    if (this.hotPollSleepTimer) clearTimeout(this.hotPollSleepTimer)
    if (this.hotPollSleepResolve) this.hotPollSleepResolve()
    if (this.server) await new Promise((resolve) => this.server.close(resolve))
    this.server = null
  }
}

async function main() {
  const command = process.argv[2] || 'watch'
  const config = loadConfig()
  if (command === 'status') {
    const snapshot = readJson(path.join(config.runDir, 'snapshot.json'))
    if (!snapshot) throw new Error('opportunity board snapshot not found')
    const payload = process.argv.includes('--json')
      ? snapshot
      : {
          status: snapshot.health?.status,
          mode: snapshot.mode,
          generatedAt: snapshot.generatedAt,
          candidateTokens: snapshot.coverage?.candidateTokens,
          freshQuotedTokens: snapshot.coverage?.freshQuotedTokens,
          screenedPositive: snapshot.coverage?.counts?.[BoardStatus.SCREENED_POSITIVE] || 0,
          catalogComplete: snapshot.source?.catalogComplete,
        }
    console.log(JSON.stringify(payload, null, 2))
    return
  }
  if (!['once', 'watch'].includes(command)) throw new Error(`unknown board command: ${command}`)
  if (!config.rpcUrl) throw new Error('MANGA_BOARD_RPC_URL is required')
  const board = new OpportunityBoard(config)
  const shutdown = async () => {
    await board.stop()
  }
  process.once('SIGTERM', shutdown)
  process.once('SIGINT', shutdown)
  if (command === 'once') {
    const result = await board.cycle({ forceCatalog: true })
    console.log(JSON.stringify(result.snapshot, null, 2))
    return
  }
  await board.watch()
}

main().catch((error) => {
  console.error(publicError(error))
  process.exitCode = 1
})
