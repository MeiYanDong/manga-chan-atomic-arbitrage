import fs from 'node:fs'
import { createPublicClient, defineChain, formatUnits, getAddress, http, isAddress } from 'viem'

export const PORTFOLIO_SNAPSHOT_SCHEMA_VERSION = 1
export const BASE_PUBLIC_HEARTBEAT_MODE = 'READ_ONLY_SANITIZED_BASE_RUNTIME'
const MAX_PUBLIC_HEARTBEAT_BYTES = 64_000
const BASE_PUBLIC_HEARTBEAT_KEYS = Object.freeze([
  'schemaVersion',
  'mode',
  'generatedAt',
  'runtimeStatus',
  'operator',
  'executor',
  'routesChecked',
  'positiveGrossCandidates',
  'broadcastAttempted',
  'confirmedProfitTransactions',
  'confirmedRevertedTransactions',
  'verifiedNetEth',
  'failedGasEth',
  'latestObservedBlock',
])

const ROBINHOOD_OPERATOR = getAddress('0x77f771E83f118C32547A1291dda438a757B4b91B')
const BASE_OPERATOR = getAddress('0xb756c304B5411B6dC3e7A6CBCD512Fad8eB6Dca7')

const NETWORKS = Object.freeze({
  ROBINHOOD: {
    id: 'ROBINHOOD',
    chainId: 4663,
    label: 'Robinhood Chain',
    explorerAddressPrefix: 'https://robinhoodchain.blockscout.com/address/',
    nativeSymbol: 'ETH',
    tokens: [
      { symbol: 'USDG', address: getAddress('0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168'), decimals: 6 },
      { symbol: 'WETH', address: getAddress('0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73'), decimals: 18 },
    ],
  },
  BASE: {
    id: 'BASE',
    chainId: 8453,
    label: 'Base',
    explorerAddressPrefix: 'https://basescan.org/address/',
    nativeSymbol: 'ETH',
    tokens: [{ symbol: 'WETH', address: getAddress('0x4200000000000000000000000000000000000006'), decimals: 18 }],
  },
})

export const MONITORED_ACCOUNTS = Object.freeze([
  {
    id: 'base-operator',
    networkId: 'BASE',
    label: 'Base Gas 钱包',
    kind: 'WALLET',
    monitoringState: 'ACTIVE',
    primaryAsset: 'ETH',
    address: BASE_OPERATOR,
  },
  {
    id: 'base-executor',
    networkId: 'BASE',
    label: 'Base WETH 执行合约',
    kind: 'CONTRACT',
    monitoringState: 'ACTIVE',
    primaryAsset: 'WETH',
    address: getAddress('0x5EA444843137c1d38D459a4862f3A3d798B49EeA'),
    expectedOperator: BASE_OPERATOR,
  },
  {
    id: 'robinhood-operator',
    networkId: 'ROBINHOOD',
    label: 'Robinhood Gas 钱包',
    kind: 'WALLET',
    monitoringState: 'ACTIVE',
    primaryAsset: 'ETH',
    address: ROBINHOOD_OPERATOR,
  },
  {
    id: 'robinhood-usdg-executor',
    networkId: 'ROBINHOOD',
    label: 'USDG 执行合约',
    kind: 'CONTRACT',
    monitoringState: 'ACTIVE',
    primaryAsset: 'USDG',
    address: getAddress('0x3f3A60A2da9E8D9811F41c6093280D7a90685aDD'),
    expectedOperator: ROBINHOOD_OPERATOR,
  },
  {
    id: 'robinhood-weth-executor',
    networkId: 'ROBINHOOD',
    label: 'WETH 执行合约',
    kind: 'CONTRACT',
    monitoringState: 'ACTIVE',
    primaryAsset: 'WETH',
    address: getAddress('0xeC6BB0511Eb7a348ad1879535F66320a51a3eDfc'),
    expectedOperator: ROBINHOOD_OPERATOR,
  },
  {
    id: 'robinhood-legacy-manga',
    networkId: 'ROBINHOOD',
    label: '旧 MANGA 合约',
    kind: 'CONTRACT',
    monitoringState: 'PARKED',
    primaryAsset: 'USDG',
    address: getAddress('0x725B7B29679dF1de5A89B2A48CA7CED178bfa506'),
    expectedOperator: ROBINHOOD_OPERATOR,
  },
  {
    id: 'robinhood-legacy-spx',
    networkId: 'ROBINHOOD',
    label: '旧 SPX 合约',
    kind: 'CONTRACT',
    monitoringState: 'PARKED',
    primaryAsset: 'USDG',
    address: getAddress('0x5eA86EAFB0F918557E1cE76E68F407568Dc2bCcd'),
    expectedOperator: ROBINHOOD_OPERATOR,
  },
])

const OPERATOR_ABI = [
  {
    type: 'function',
    name: 'operator',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
]

const ERC20_BALANCE_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
]

function publicChain(network, rpcUrl) {
  return defineChain({
    id: network.chainId,
    name: network.label,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  })
}

export function createPortfolioClients({ robinhoodRpcUrl, baseRpcUrl }) {
  return {
    ROBINHOOD: createPublicClient({
      chain: publicChain(NETWORKS.ROBINHOOD, robinhoodRpcUrl),
      transport: http(robinhoodRpcUrl, { retryCount: 1, timeout: 5_000 }),
    }),
    BASE: createPublicClient({
      chain: publicChain(NETWORKS.BASE, baseRpcUrl),
      transport: http(baseRpcUrl, { retryCount: 1, timeout: 5_000 }),
    }),
  }
}

async function optionalRead(work) {
  try {
    return await work()
  } catch {
    return null
  }
}

async function mapConcurrent(items, concurrency, mapper) {
  const output = new Array(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      output[index] = await mapper(items[index])
    }
  })
  await Promise.all(workers)
  return output
}

function hasRuntimeCode(code) {
  if (code === null) return null
  return typeof code === 'string' && code !== '0x'
}

function formattedBalance(value, decimals) {
  return typeof value === 'bigint' ? formatUnits(value, decimals) : null
}

async function collectAccount(client, network, account, blockNumber) {
  if (blockNumber === null) return unavailableAccount(network, account)
  const [nativeBalance, code, tokenBalances, latestNonce, pendingNonce, observedOperator] = await Promise.all([
    optionalRead(() => client.getBalance({ address: account.address, blockNumber })),
    optionalRead(() => client.getCode({ address: account.address, blockNumber })),
    Promise.all(
      network.tokens.map((token) =>
        optionalRead(() =>
          client.readContract({
            address: token.address,
            abi: ERC20_BALANCE_ABI,
            functionName: 'balanceOf',
            args: [account.address],
            blockNumber,
          }),
        ),
      ),
    ),
    account.kind === 'WALLET'
      ? optionalRead(() => client.getTransactionCount({ address: account.address, blockNumber }))
      : Promise.resolve(null),
    account.kind === 'WALLET'
      ? optionalRead(() => client.getTransactionCount({ address: account.address, blockTag: 'pending' }))
      : Promise.resolve(null),
    account.kind === 'CONTRACT'
      ? optionalRead(() =>
          client.readContract({
            address: account.address,
            abi: OPERATOR_ABI,
            functionName: 'operator',
            blockNumber,
          }),
        )
      : Promise.resolve(null),
  ])
  const codePresent = hasRuntimeCode(code)
  const operatorMatches =
    account.kind === 'CONTRACT'
      ? typeof observedOperator === 'string' && isAddress(observedOperator)
        ? getAddress(observedOperator) === account.expectedOperator
        : null
      : null
  const assets = [
    { symbol: network.nativeSymbol, amount: formattedBalance(nativeBalance, 18), raw: nativeBalance },
    ...network.tokens.map((token, index) => ({
      symbol: token.symbol,
      amount: formattedBalance(tokenBalances[index], token.decimals),
      raw: tokenBalances[index],
    })),
  ]
  const pendingTransactions =
    typeof latestNonce === 'number' && typeof pendingNonce === 'number' ? Math.max(0, pendingNonce - latestNonce) : null
  const incomplete =
    codePresent === null ||
    assets.some((asset) => asset.raw === null) ||
    (account.kind === 'WALLET' && pendingTransactions === null) ||
    (account.kind === 'CONTRACT' && operatorMatches === null)
  const mismatch =
    (account.kind === 'CONTRACT' && (codePresent === false || operatorMatches === false)) ||
    (account.kind === 'WALLET' && codePresent === true)
  const status = mismatch ? 'ALERT' : incomplete ? 'PARTIAL' : pendingTransactions > 0 ? 'PENDING' : 'VERIFIED'
  return {
    ...account,
    network: network.label,
    chainId: network.chainId,
    explorerUrl: `${network.explorerAddressPrefix}${account.address}`,
    status,
    pendingTransactions,
    assets: assets.map(({ symbol, amount }) => ({ symbol, amount })),
    checks: {
      identity: mismatch ? 'MISMATCH' : incomplete ? 'PARTIAL' : 'VERIFIED',
      codePresent,
      operatorMatches,
    },
    _rawAssets: Object.fromEntries(assets.map((asset) => [asset.symbol, asset.raw])),
  }
}

function unavailableAccount(network, account) {
  return {
    ...account,
    network: network.label,
    chainId: network.chainId,
    explorerUrl: `${network.explorerAddressPrefix}${account.address}`,
    status: 'PARTIAL',
    pendingTransactions: null,
    assets: [network.nativeSymbol, ...network.tokens.map((token) => token.symbol)].map((symbol) => ({
      symbol,
      amount: null,
    })),
    checks: { identity: 'PARTIAL', codePresent: null, operatorMatches: null },
    _rawAssets: Object.fromEntries(
      [network.nativeSymbol, ...network.tokens.map((token) => token.symbol)].map((symbol) => [symbol, null]),
    ),
  }
}

function summarizeAssets(accounts, symbols) {
  return Object.fromEntries(
    symbols.map((symbol) => {
      const balances = accounts.map((account) => account._rawAssets[symbol]).filter((value) => value !== undefined)
      if (balances.length === 0 || balances.some((value) => typeof value !== 'bigint')) return [symbol, null]
      const decimals = symbol === 'USDG' ? 6 : 18
      return [
        symbol,
        formatUnits(
          balances.reduce((sum, value) => sum + value, 0n),
          decimals,
        ),
      ]
    }),
  )
}

function networkSummary(network, accounts, blockNumber) {
  const symbols = [network.nativeSymbol, ...network.tokens.map((token) => token.symbol)]
  const active = accounts.filter((account) => account.monitoringState === 'ACTIVE')
  const parked = accounts.filter((account) => account.monitoringState === 'PARKED')
  return {
    id: network.id,
    label: network.label,
    status: accounts.some((account) => account.status === 'ALERT')
      ? 'ALERT'
      : blockNumber === null || accounts.some((account) => account.status === 'PARTIAL')
        ? 'PARTIAL'
        : 'VERIFIED',
    blockNumber: blockNumber?.toString() || null,
    active: summarizeAssets(active, symbols),
    parked: summarizeAssets(parked, symbols),
    all: summarizeAssets(accounts, symbols),
  }
}

function sanitizedAccount(account) {
  return {
    id: account.id,
    networkId: account.networkId,
    network: account.network,
    chainId: account.chainId,
    label: account.label,
    kind: account.kind,
    monitoringState: account.monitoringState,
    primaryAsset: account.primaryAsset,
    address: account.address,
    explorerUrl: account.explorerUrl,
    status: account.status,
    pendingTransactions: account.pendingTransactions,
    assets: account.assets,
    checks: account.checks,
  }
}

function normalizedServiceStatus(value) {
  if (value === 'RUNNING') return 'RUNNING'
  if (['STOPPED', 'HALTED'].includes(value)) return value
  return 'UNKNOWN'
}

function baseService(baseUnitStatus, heartbeat, now) {
  const expectedExecutor = MONITORED_ACCOUNTS.find((account) => account.id === 'base-executor')
  const identityMatches =
    heartbeat && heartbeat.operator === BASE_OPERATOR && heartbeat.executor === expectedExecutor.address
  const heartbeatAgeMs = heartbeat ? Number(now) - Date.parse(heartbeat.generatedAt) : null
  const heartbeatFresh = Number.isFinite(heartbeatAgeMs) && heartbeatAgeMs >= 0 && heartbeatAgeMs <= 180_000
  const unitStatus = normalizedServiceStatus(baseUnitStatus)
  const status =
    identityMatches === false
      ? 'ALERT'
      : unitStatus === 'STOPPED' || unitStatus === 'HALTED'
        ? unitStatus
        : unitStatus === 'RUNNING' && heartbeatFresh && heartbeat.runtimeStatus === 'RUNNING'
          ? 'RUNNING'
          : 'PARTIAL'
  return {
    id: 'base-live',
    label: 'Base 自动套利',
    status,
    heartbeatAt: heartbeat?.generatedAt || null,
    routesChecked: heartbeat?.routesChecked ?? null,
    positiveGrossCandidates: heartbeat?.positiveGrossCandidates ?? null,
    broadcastAttempted: heartbeat?.broadcastAttempted ?? null,
    confirmedProfitTransactions: heartbeat?.confirmedProfitTransactions ?? null,
    confirmedRevertedTransactions: heartbeat?.confirmedRevertedTransactions ?? null,
    verifiedNetEth: heartbeat?.verifiedNetEth ?? null,
    failedGasEth: heartbeat?.failedGasEth ?? null,
  }
}

export async function collectPortfolioSnapshot({
  clients,
  now = new Date(),
  robinhoodServiceStatus = 'UNKNOWN',
  baseUnitStatus = 'UNKNOWN',
  baseHeartbeat = null,
}) {
  const timestamp = now instanceof Date ? now : new Date(now)
  if (!Number.isFinite(timestamp.getTime())) throw new Error('invalid portfolio timestamp')
  const networkEntries = Object.values(NETWORKS)
  const collectedNetworks = await Promise.all(
    networkEntries.map(async (network) => {
      const client = clients?.[network.id]
      const blockNumber = client ? await optionalRead(() => client.getBlockNumber()) : null
      const definitions = MONITORED_ACCOUNTS.filter((account) => account.networkId === network.id)
      const accounts = client
        ? await mapConcurrent(definitions, 2, (account) => collectAccount(client, network, account, blockNumber))
        : definitions.map((account) => unavailableAccount(network, account))
      return { network, blockNumber, accounts }
    }),
  )
  const accounts = collectedNetworks.flatMap((item) => item.accounts)
  const services = [
    {
      id: 'robinhood-live',
      label: 'Robinhood Chain 自动套利',
      status: normalizedServiceStatus(robinhoodServiceStatus),
    },
    baseService(baseUnitStatus, baseHeartbeat, timestamp.getTime()),
  ]
  const status =
    accounts.some((account) => account.status === 'ALERT') || services.some((service) => service.status === 'ALERT')
      ? 'ALERT'
      : accounts.some((account) => account.status === 'PARTIAL') ||
          services.some((service) => ['PARTIAL', 'UNKNOWN'].includes(service.status))
        ? 'PARTIAL'
        : services.some((service) => ['STOPPED', 'HALTED'].includes(service.status))
          ? 'ALERT'
          : 'VERIFIED'
  const parkedAccounts = accounts.filter((account) => account.monitoringState === 'PARKED')
  const parkedUsdg = summarizeAssets(parkedAccounts, ['USDG']).USDG
  return {
    schemaVersion: PORTFOLIO_SNAPSHOT_SCHEMA_VERSION,
    generatedAt: timestamp.toISOString(),
    status,
    summary: {
      watchedObjects: accounts.length,
      activeObjects: accounts.filter((account) => account.monitoringState === 'ACTIVE').length,
      parkedObjects: parkedAccounts.length,
      parkedUsdg,
    },
    services,
    networks: collectedNetworks.map(({ network, accounts: networkAccounts, blockNumber }) =>
      networkSummary(network, networkAccounts, blockNumber),
    ),
    accounts: accounts.map(sanitizedAccount),
  }
}

export function readBasePublicHeartbeat(file, { now = Date.now(), maxAgeMs = 180_000 } = {}) {
  const metadata = fs.statSync(file)
  if (!metadata.isFile() || metadata.size <= 0 || metadata.size > MAX_PUBLIC_HEARTBEAT_BYTES) {
    throw new Error('Base public heartbeat file is invalid')
  }
  if ((metadata.mode & 0o022) !== 0) throw new Error('Base public heartbeat must not be writable by its readers')
  const heartbeat = JSON.parse(fs.readFileSync(file, 'utf8'))
  const serialized = JSON.stringify(heartbeat)
  if (
    /(?:credential|mnemonic|private.?key|raw.?transaction|rpc.?url|secret|signed.?transaction|webhook)/i.test(
      serialized,
    )
  ) {
    throw new Error('Base public heartbeat contains a forbidden sensitive field')
  }
  const keys = typeof heartbeat === 'object' && heartbeat !== null ? Object.keys(heartbeat) : []
  if (
    keys.length !== BASE_PUBLIC_HEARTBEAT_KEYS.length ||
    keys.some((key) => !BASE_PUBLIC_HEARTBEAT_KEYS.includes(key)) ||
    heartbeat?.schemaVersion !== 1 ||
    heartbeat?.mode !== BASE_PUBLIC_HEARTBEAT_MODE ||
    !Number.isFinite(Date.parse(heartbeat?.generatedAt)) ||
    !['RUNNING', 'STARTING', 'HALTED', 'UNKNOWN'].includes(heartbeat?.runtimeStatus) ||
    ![heartbeat?.operator, heartbeat?.executor].every((address) => typeof address === 'string' && isAddress(address)) ||
    ![
      heartbeat?.routesChecked,
      heartbeat?.positiveGrossCandidates,
      heartbeat?.confirmedProfitTransactions,
      heartbeat?.confirmedRevertedTransactions,
    ].every((count) => count === null || (Number.isSafeInteger(count) && Number(count) >= 0)) ||
    !(heartbeat?.broadcastAttempted === null || typeof heartbeat?.broadcastAttempted === 'boolean') ||
    ![heartbeat?.verifiedNetEth, heartbeat?.failedGasEth].every(
      (amount) => amount === null || (typeof amount === 'string' && /^\d+(?:\.\d+)?$/.test(amount)),
    ) ||
    !(
      heartbeat?.latestObservedBlock === null ||
      (typeof heartbeat?.latestObservedBlock === 'string' && /^\d+$/.test(heartbeat.latestObservedBlock))
    )
  ) {
    throw new Error('Base public heartbeat identity is invalid')
  }
  const age = Number(now) - Date.parse(heartbeat.generatedAt)
  if (!Number.isFinite(age) || age < 0 || age > maxAgeMs) throw new Error('Base public heartbeat is stale')
  return { ...heartbeat, operator: getAddress(heartbeat.operator), executor: getAddress(heartbeat.executor) }
}
