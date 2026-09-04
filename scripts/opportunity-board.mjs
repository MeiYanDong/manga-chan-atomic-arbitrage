import fs from 'node:fs'
import httpServer from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPublicClient, defineChain, encodePacked, getAddress, http, parseAbi, parseEther, parseUnits } from 'viem'
import {
  BoardStatus,
  appendEvents,
  buildBoardSnapshot,
  materialEvents,
  normalizePairCandidate,
  publicError,
  screenRoundTrip,
  usdg,
  writeJsonAtomic,
} from '../src/opportunity-board.mjs'

const CHAIN_ID = 4663
const PAIR_TOKENS_API = 'https://pair.fund/api/tokens'
const PAIR_STOCK_TOKENS_API = 'https://pair.fund/api/stock-tokens'
const ROBINHOOD_ASSETS_API = 'https://api.robinhood.com/rhj/assets'
const USDG = getAddress('0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168')
const WETH = getAddress('0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73')
const V3_FACTORY = getAddress('0x1f7d7550B1b028f7571E69A784071F0205FD2EfA')
const V3_QUOTER = getAddress('0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7')
const V4_QUOTER = getAddress('0x8Dc178eFB8111BB0973Dd9d722ebeFF267c98F94')
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
const V3_FEES = [100, 500, 3_000, 10_000]
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

function loadConfig() {
  const runDir = path.resolve(process.env.MANGA_BOARD_RUN_DIR || path.join(ROOT, 'runs', 'opportunity-board'))
  const host = process.env.MANGA_BOARD_HOST || '127.0.0.1'
  if (!['127.0.0.1', '::1'].includes(host)) throw new Error('opportunity board must bind to loopback')
  return {
    rpcUrl: process.env.MANGA_BOARD_RPC_URL || null,
    providerLabel: process.env.MANGA_BOARD_PROVIDER_LABEL || 'read-only-provider',
    runDir,
    host,
    port: integer(process.env.MANGA_BOARD_PORT, 8_788),
    scanIntervalMs: integer(process.env.MANGA_BOARD_SCAN_INTERVAL_MS, 30_000, 5_000),
    catalogIntervalMs: integer(process.env.MANGA_BOARD_CATALOG_INTERVAL_MS, 300_000, 30_000),
    staleMs: integer(process.env.MANGA_BOARD_STALE_MS, 180_000, 30_000),
    batchSize: integer(process.env.MANGA_BOARD_BATCH_SIZE, 8),
    topRefreshSize: integer(process.env.MANGA_BOARD_TOP_REFRESH_SIZE, 8),
    quoteConcurrency: integer(process.env.MANGA_BOARD_QUOTE_CONCURRENCY, 2),
    catalogConcurrency: integer(process.env.MANGA_BOARD_CATALOG_CONCURRENCY, 6),
    blockLag: BigInt(integer(process.env.MANGA_BOARD_BLOCK_LAG, 1, 0)),
    minDepthUsd: numberValue(process.env.MANGA_BOARD_MIN_DEPTH_USD, 100),
    amountIn: parseUnits(process.env.MANGA_BOARD_AMOUNT_USDG || '10', 6),
    overheadGas: BigInt(integer(process.env.MANGA_BOARD_OVERHEAD_GAS, 50_000, 0)),
    requestTimeoutMs: integer(process.env.MANGA_BOARD_REQUEST_TIMEOUT_MS, 15_000, 1_000),
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
function v3Path(tokenIn, fee, tokenOut) {
  return encodePacked(['address', 'uint24', 'address'], [tokenIn, fee, tokenOut])
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
    'failures',
    'evidenceLevel',
    'executionEstimate',
    'receiptEvidence',
  ]
  return Object.fromEntries(keys.filter((key) => item[key] !== undefined).map((key) => [key, item[key]]))
}

class OpportunityBoard {
  /** @param {ReturnType<typeof loadConfig>} config */
  constructor(config) {
    this.config = config
    this.startedAt = new Date().toISOString()
    this.snapshotPath = path.join(config.runDir, 'snapshot.json')
    this.eventsPath = path.join(config.runDir, 'events.jsonl')
    this.statePath = path.join(config.runDir, 'state.json')
    this.html = fs.readFileSync(path.join(ROOT, 'public', 'opportunity-board.html'), 'utf8')
    this.previousSnapshot = readJson(this.snapshotPath)
    this.snapshot = this.previousSnapshot
    this.observations = new Map(
      (this.previousSnapshot?.items || [])
        .filter((item) => item.quotedAt)
        .map((item) => [item.id, observationFromItem(item)]),
    )
    this.rawTokens = new Map()
    this.catalog = []
    this.stockAddresses = new Set()
    this.feeCache = new Map()
    this.cursor = Number(readJson(this.statePath)?.cursor || 0)
    this.cycleNumber = Number(readJson(this.statePath)?.cycleNumber || 0)
    this.lastCatalogAt = null
    this.lastFullCatalogAt = null
    this.lastCycleAt = null
    this.lastQuoteAt = null
    this.consecutiveErrors = 0
    this.lastError = null
    this.inCycle = false
    this.stopping = false
    this.server = null
    this.sleepTimer = null
    this.sleepResolve = null
    this.client = null
    if (config.rpcUrl) {
      const chain = defineChain({
        id: CHAIN_ID,
        name: 'Robinhood Chain',
        nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
        rpcUrls: { default: { http: [config.rpcUrl] } },
      })
      this.client = createPublicClient({
        chain,
        transport: http(config.rpcUrl, { timeout: 20_000, retryCount: 1 }),
      })
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
    }
  }

  sourceState() {
    return {
      discovery: 'PAIR_FIRST_PARTY_API',
      canonicalAssets: 'ROBINHOOD_ASSETS_API_PLUS_PAIR_STOCK_TOKENS',
      quoteRpc: this.config.providerLabel,
      discoveredTokens: this.rawTokens.size,
      catalogComplete: this.catalogComplete ?? false,
      catalogExpectedTokens: this.catalogExpectedTokens ?? null,
      catalogObservedAt: this.lastCatalogAt,
      fullCatalogObservedAt: this.lastFullCatalogAt,
    }
  }

  async refreshCatalog({ full }) {
    if (full || this.stockAddresses.size === 0) {
      const stockPayload = await fetchJson(PAIR_STOCK_TOKENS_API, this.config.requestTimeoutMs)
      const robinhoodPayload = await fetchJson(ROBINHOOD_ASSETS_API, this.config.requestTimeoutMs)
      const stockAddresses = new Set(
        (Array.isArray(stockPayload) ? stockPayload : []).map((item) => item?.address?.toLowerCase()).filter(Boolean),
      )
      for (const asset of robinhoodPayload?.assets || []) {
        if (asset?.status !== 'ASSET_STATUS_ACTIVE') continue
        for (const deployment of asset.deployments || []) {
          if (Number(deployment.chainId) === CHAIN_ID && deployment.contractAddress) {
            stockAddresses.add(deployment.contractAddress.toLowerCase())
          }
        }
      }
      this.stockAddresses = stockAddresses
    }

    if (full) {
      const first = await fetchJson(`${PAIR_TOKENS_API}?page=1&limit=50&sort=market_cap`, this.config.requestTimeoutMs)
      const pages = Math.max(1, Math.ceil(Number(first.total || 0) / Number(first.limit || 50)))
      const rest = await mapLimit(
        this.config.catalogConcurrency,
        Array.from({ length: Math.max(0, pages - 1) }, (_, index) => index + 2),
        (page) => fetchJson(`${PAIR_TOKENS_API}?page=${page}&limit=50&sort=market_cap`, this.config.requestTimeoutMs),
      )
      this.rawTokens.clear()
      for (const payload of [first, ...rest]) {
        for (const token of payload.items || []) {
          if (token?.address) this.rawTokens.set(token.address.toLowerCase(), token)
        }
      }
      this.catalogExpectedTokens = Number(first.total || this.rawTokens.size)
      this.catalogComplete = this.rawTokens.size >= this.catalogExpectedTokens
      this.lastFullCatalogAt = new Date().toISOString()
    }

    const newest = await fetchJson(`${PAIR_TOKENS_API}?page=1&limit=50&sort=newest`, this.config.requestTimeoutMs)
    for (const token of newest.items || []) {
      if (token?.address) this.rawTokens.set(token.address.toLowerCase(), token)
    }

    this.catalog = [...this.rawTokens.values()]
      .map((token) =>
        normalizePairCandidate(token, { minDepthUsd: this.config.minDepthUsd, stockAddresses: this.stockAddresses }),
      )
      .filter(Boolean)
    this.lastCatalogAt = new Date().toISOString()
  }

  /** @param {string} token @param {bigint} blockNumber */
  async availableV3Fees(token, blockNumber) {
    if (token.toLowerCase() === USDG.toLowerCase()) return [0]
    const key = token.toLowerCase()
    const cached = this.feeCache.get(key)
    if (cached && (cached.fees.length > 0 || Date.now() - cached.at < this.config.catalogIntervalMs)) {
      return cached.fees
    }
    const pools = await Promise.all(
      V3_FEES.map(async (fee) => {
        try {
          const pool = await this.client.readContract({
            address: V3_FACTORY,
            abi: FACTORY_ABI,
            functionName: 'getPool',
            args: [USDG, token, fee],
            blockNumber,
          })
          return pool !== ZERO_ADDRESS ? fee : null
        } catch {
          return null
        }
      }),
    )
    const fees = pools.filter((fee) => fee !== null)
    this.feeCache.set(key, { fees, at: Date.now() })
    return fees
  }

  /** @param {string} tokenIn @param {string} tokenOut @param {bigint} amountIn @param {bigint} blockNumber */
  async quoteBestV3(tokenIn, tokenOut, amountIn, blockNumber) {
    if (tokenIn.toLowerCase() === tokenOut.toLowerCase()) {
      return { amountOut: amountIn, gasEstimate: 0n, fee: 0 }
    }
    const nonUsdg = tokenIn.toLowerCase() === USDG.toLowerCase() ? tokenOut : tokenIn
    const fees = await this.availableV3Fees(nonUsdg, blockNumber)
    const quotes = await Promise.all(
      fees.map(async (fee) => {
        try {
          const { result } = await this.client.simulateContract({
            account: ZERO_ADDRESS,
            address: V3_QUOTER,
            abi: V3_QUOTER_ABI,
            functionName: 'quoteExactInput',
            args: [v3Path(tokenIn, fee, tokenOut), amountIn],
            blockNumber,
          })
          return { amountOut: result[0], gasEstimate: result[3], fee }
        } catch {
          return null
        }
      }),
    )
    const successful = quotes.filter(Boolean).sort((left, right) => (left.amountOut > right.amountOut ? -1 : 1))
    if (successful.length === 0) throw new Error('no quotable USDG V3 anchor pool')
    return successful[0]
  }

  /** @param {Record<string, any>} pool @param {string} tokenIn @param {bigint} amountIn @param {bigint} blockNumber */
  async quoteV4(pool, tokenIn, amountIn, blockNumber) {
    const currency0 = addressBefore(pool.tokenAddress, pool.quoteAddress) ? pool.tokenAddress : pool.quoteAddress
    const currency1 = currency0 === pool.tokenAddress ? pool.quoteAddress : pool.tokenAddress
    if (![currency0.toLowerCase(), currency1.toLowerCase()].includes(tokenIn.toLowerCase())) {
      throw new Error('token is not part of V4 pool key')
    }
    const { result } = await this.client.simulateContract({
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
    })
    return { amountOut: result[0], gasEstimate: result[1] }
  }

  /** @param {Record<string, any>} candidate @param {Record<string, any>} fixed */
  async quoteCandidate(candidate, fixed) {
    const failures = []
    const entries = (
      await mapLimit(Math.min(3, this.config.quoteConcurrency), candidate.pools, async (pool) => {
        try {
          const anchor = await this.quoteBestV3(USDG, pool.quoteAddress, this.config.amountIn, fixed.blockNumber)
          const tokenQuote = await this.quoteV4(pool, pool.quoteAddress, anchor.amountOut, fixed.blockNumber)
          return { pool, anchor, tokenQuote }
        } catch (error) {
          failures.push({ leg: `USDG_TO_${pool.quoteSymbol}_TO_TOKEN`, reason: publicError(error) })
          return null
        }
      })
    )
      .filter(Boolean)
      .sort((left, right) => (left.tokenQuote.amountOut > right.tokenQuote.amountOut ? -1 : 1))

    const routes = []
    for (const entry of entries.slice(0, 2)) {
      const exits = candidate.pools.filter((pool) => pool.poolId !== entry.pool.poolId)
      const quotedExits = await mapLimit(Math.min(3, this.config.quoteConcurrency), exits, async (pool) => {
        try {
          const quoteAsset = await this.quoteV4(
            pool,
            candidate.tokenAddress,
            entry.tokenQuote.amountOut,
            fixed.blockNumber,
          )
          const anchor = await this.quoteBestV3(pool.quoteAddress, USDG, quoteAsset.amountOut, fixed.blockNumber)
          const screening = screenRoundTrip({
            amountIn: this.config.amountIn,
            amountOut: anchor.amountOut,
            quoterGas: [
              entry.anchor.gasEstimate,
              entry.tokenQuote.gasEstimate,
              quoteAsset.gasEstimate,
              anchor.gasEstimate,
            ],
            overheadGas: this.config.overheadGas,
            gasPriceWei: fixed.gasPrice,
            nativeMarkInWei: fixed.nativeMarkIn,
            nativeMarkOutUsdg: fixed.nativeMark.amountOut,
          })
          return { entry, exitPool: pool, quoteAsset, exitAnchor: anchor, screening }
        } catch (error) {
          failures.push({ leg: `TOKEN_TO_${pool.quoteSymbol}_TO_USDG`, reason: publicError(error) })
          return null
        }
      })
      routes.push(...quotedExits.filter(Boolean))
    }

    if (routes.length === 0) {
      return {
        status: BoardStatus.UNQUOTABLE,
        quotedAt: new Date().toISOString(),
        blockNumber: fixed.blockNumber.toString(),
        blockHash: fixed.block.hash,
        route: null,
        amountInUsdg: usdg(this.config.amountIn),
        amountOutUsdg: null,
        grossProfitUsdg: null,
        gasCostProxyUsdg: null,
        screenedNetUsdg: null,
        failures: failures.slice(0, 12),
        evidenceLevel: 'FIXED_BLOCK_QUOTE_FAILED',
        executionEstimate: 'NOT_RUN',
        receiptEvidence: 'NONE',
      }
    }

    routes.sort((left, right) => (left.screening.screenedNetUsdg > right.screening.screenedNetUsdg ? -1 : 1))
    const best = routes[0]
    return {
      status: best.screening.status,
      quotedAt: new Date().toISOString(),
      blockNumber: fixed.blockNumber.toString(),
      blockHash: fixed.block.hash,
      route: `${best.entry.pool.quoteSymbol} → ${candidate.symbol} → ${best.exitPool.quoteSymbol}`,
      routeKey: `${best.entry.pool.poolId}:${best.exitPool.poolId}`,
      amountInUsdg: usdg(this.config.amountIn),
      amountOutUsdg: usdg(best.exitAnchor.amountOut),
      grossProfitUsdg: usdg(best.screening.grossProfitUsdg),
      gasCostProxyUsdg: usdg(best.screening.gasCostUsdg),
      screenedNetUsdg: usdg(best.screening.screenedNetUsdg),
      gasPriceWei: fixed.gasPrice.toString(),
      gasUnitsProxy: best.screening.gasUnitsProxy.toString(),
      quoterGasUnits: best.screening.routeGas.toString(),
      minimumRouteDepthUsd: Math.min(best.entry.pool.depthUsd, best.exitPool.depthUsd),
      legs: {
        entryV3Fee: best.entry.anchor.fee,
        entryPoolId: best.entry.pool.poolId,
        entryV4Fee: best.entry.pool.fee,
        exitPoolId: best.exitPool.poolId,
        exitV4Fee: best.exitPool.fee,
        exitV3Fee: best.exitAnchor.fee,
      },
      failures: failures.slice(0, 12),
      evidenceLevel: 'FIXED_BLOCK_QUOTER_SCREEN',
      executionEstimate: 'NOT_RUN_GENERIC_EXECUTOR_NOT_DEPLOYED',
      receiptEvidence: 'NONE',
    }
  }

  selectCandidates() {
    const byId = new Map(this.catalog.map((candidate) => [candidate.id, candidate]))
    const selected = []
    const seen = new Set()
    const add = (candidate) => {
      if (!candidate || seen.has(candidate.id)) return
      seen.add(candidate.id)
      selected.push(candidate)
    }

    for (const id of INITIAL_PRIORITY) add(byId.get(id))
    const currentPositive = [...this.observations.entries()]
      .filter(([, observation]) => observation.status === BoardStatus.SCREENED_POSITIVE)
      .sort((left, right) => Number(right[1].screenedNetUsdg) - Number(left[1].screenedNetUsdg))
      .slice(0, this.config.topRefreshSize)
    for (const [id] of currentPositive) add(byId.get(id))

    const targetSize = INITIAL_PRIORITY.length + this.config.topRefreshSize + this.config.batchSize
    for (const candidate of this.catalog) {
      if (selected.length >= targetSize) break
      if (!this.observations.has(candidate.id)) add(candidate)
    }
    if (this.catalog.length > 0) {
      for (let offset = 0; offset < this.config.batchSize && selected.length < targetSize; offset += 1) {
        add(this.catalog[(this.cursor + offset) % this.catalog.length])
      }
      this.cursor = (this.cursor + this.config.batchSize) % this.catalog.length
    }
    return selected
  }

  async fixedBlock() {
    const chainId = await this.client.getChainId()
    if (chainId !== CHAIN_ID) throw new Error(`wrong chain id ${chainId}`)
    const head = await this.client.getBlockNumber()
    const blockNumber = head > this.config.blockLag ? head - this.config.blockLag : head
    const [block, gasPrice] = await Promise.all([this.client.getBlock({ blockNumber }), this.client.getGasPrice()])
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
    const events = materialEvents(this.previousSnapshot, snapshot)
    writeJsonAtomic(this.snapshotPath, snapshot)
    appendEvents(this.eventsPath, events)
    writeJsonAtomic(this.statePath, { cursor: this.cursor, cycleNumber: this.cycleNumber, updatedAt: generatedAt })
    this.previousSnapshot = snapshot
    this.snapshot = snapshot
    return { snapshot, events }
  }

  async cycle({ forceCatalog = false } = {}) {
    if (this.inCycle) return null
    this.inCycle = true
    try {
      const catalogDue =
        forceCatalog ||
        !this.lastFullCatalogAt ||
        Date.now() - Date.parse(this.lastFullCatalogAt) >= this.config.catalogIntervalMs
      await this.refreshCatalog({ full: catalogDue })
      this.publish('SCANNING')
      const selected = this.selectCandidates()
      const fixed = await this.fixedBlock()
      await mapLimit(this.config.quoteConcurrency, selected, async (candidate) => {
        try {
          this.observations.set(candidate.id, await this.quoteCandidate(candidate, fixed))
        } catch (error) {
          this.observations.set(candidate.id, {
            status: BoardStatus.UNQUOTABLE,
            quotedAt: new Date().toISOString(),
            blockNumber: fixed.blockNumber.toString(),
            blockHash: fixed.block.hash,
            failures: [{ leg: 'CANDIDATE', reason: publicError(error) }],
            evidenceLevel: 'FIXED_BLOCK_QUOTE_FAILED',
            executionEstimate: 'NOT_RUN',
            receiptEvidence: 'NONE',
          })
        }
      })
      this.lastCycleAt = new Date().toISOString()
      this.lastQuoteAt = this.lastCycleAt
      this.cycleNumber += 1
      this.consecutiveErrors = 0
      this.lastError = null
      return this.publish(this.catalogComplete ? 'RUNNING' : 'DEGRADED_PARTIAL_CATALOG')
    } catch (error) {
      this.lastCycleAt = new Date().toISOString()
      this.cycleNumber += 1
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

  respondJson(response, status, payload) {
    response.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    })
    response.end(`${JSON.stringify(payload)}\n`)
  }

  startHttp() {
    this.server = httpServer.createServer((request, response) => {
      if (request.method !== 'GET') return this.respondJson(response, 405, { error: 'method not allowed' })
      const requestUrl = new URL(request.url || '/', `http://${this.config.host}:${this.config.port}`)
      if (requestUrl.pathname === '/api/snapshot') {
        return this.respondJson(response, this.snapshot ? 200 : 503, this.snapshot || { status: 'STARTING' })
      }
      if (requestUrl.pathname === '/api/events') return this.respondJson(response, 200, this.recentEvents())
      if (requestUrl.pathname === '/healthz') {
        const age = this.lastCycleAt ? Date.now() - Date.parse(this.lastCycleAt) : Number.POSITIVE_INFINITY
        const healthyStatus = ['RUNNING', 'SCANNING'].includes(this.snapshot?.health?.status)
        const healthy = Boolean(
          this.snapshot && healthyStatus && age <= Math.max(this.config.staleMs * 2, this.config.scanIntervalMs * 4),
        )
        return this.respondJson(response, healthy ? 200 : 503, {
          status: healthy ? 'HEALTHY' : 'NOT_READY',
          lastCycleAt: this.lastCycleAt,
          candidateTokens: this.snapshot?.coverage?.candidateTokens ?? 0,
          screenedPositive: this.snapshot?.coverage?.counts?.[BoardStatus.SCREENED_POSITIVE] ?? 0,
        })
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
    await this.startHttp()
    console.log(
      JSON.stringify({
        status: 'BOARD_HTTP_READY',
        listen: `${this.config.host}:${this.config.port}`,
        mode: 'READ_ONLY_NO_SIGNING_NO_BROADCAST',
      }),
    )
    while (!this.stopping) {
      const started = Date.now()
      const result = await this.cycle({ forceCatalog: this.catalog.length === 0 })
      if (result) {
        console.log(
          JSON.stringify({
            status: result.snapshot.health.status,
            generatedAt: result.snapshot.generatedAt,
            candidates: result.snapshot.coverage.candidateTokens,
            freshQuoted: result.snapshot.coverage.freshQuotedTokens,
            screenedPositive: result.snapshot.coverage.counts[BoardStatus.SCREENED_POSITIVE] || 0,
            events: result.events.length,
          }),
        )
      }
      const remaining = Math.max(0, this.config.scanIntervalMs - (Date.now() - started))
      if (remaining > 0) {
        await new Promise((resolve) => {
          this.sleepResolve = resolve
          this.sleepTimer = setTimeout(resolve, remaining)
        })
        this.sleepResolve = null
        this.sleepTimer = null
      }
    }
  }

  async stop() {
    this.stopping = true
    if (this.sleepTimer) clearTimeout(this.sleepTimer)
    if (this.sleepResolve) this.sleepResolve()
    if (this.server) await new Promise((resolve) => this.server.close(resolve))
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
