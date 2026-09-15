import { getAddress, keccak256 } from 'viem'

import { RpcErrorClass, classifyRpcError } from './policy.mjs'

const MULTICALL3 = getAddress('0xcA11bde05977b3631167028862bE2a173976CA11')
const MULTICALL3_RUNTIME_CODE_HASH = '0xd5c15df687b16f2ff992fc8d767b4216323184a2bbc6ee2f9c398c318e770891'

export const ROBINHOOD_UNISWAP_V2_FACTORY = getAddress('0x8bcEaA40B9AcdfAedF85AdF4FF01F5Ad6517937f')
export const ROBINHOOD_UNISWAP_V3_FACTORY = getAddress('0x1f7d7550B1b028f7571E69A784071F0205FD2EfA')
export const ROBINHOOD_UNISWAP_V4_POOL_MANAGER = getAddress('0x8366a39CC670B4001A1121B8F6A443A643e40951')
export const ROBINHOOD_USDG = getAddress('0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168')
export const ROBINHOOD_WETH = getAddress('0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73')
export const ROBINHOOD_PARTIAL_CATALOG_RETENTION_POLICY = Object.freeze({
  version: 'FAILED_TRANSIENT_QUERY_LAST_VERIFIED_V1',
  maximumAgeMs: 6 * 60 * 60 * 1_000,
})
export const ROBINHOOD_CATALOG_MULTICALL_POLICY = Object.freeze({
  version: 'CANONICAL_MULTICALL3_FIXED_BLOCK_NORMALIZED_RETRY_V3',
  maximumSubcallsPerRequest: 12,
  concurrency: 1,
  maximumAttempts: 3,
  minimumRequestIntervalMs: 250,
  retryBaseDelayMs: 750,
  runtimeCodeHash: MULTICALL3_RUNTIME_CODE_HASH,
})

const ZERO = getAddress('0x0000000000000000000000000000000000000000')
const V3_FEES = [100, 500, 3_000, 10_000]
const v2FactoryAbi = [
  {
    type: 'function',
    name: 'getPair',
    stateMutability: 'view',
    inputs: [
      { name: 'tokenA', type: 'address' },
      { name: 'tokenB', type: 'address' },
    ],
    outputs: [{ name: 'pair', type: 'address' }],
  },
]
const v3FactoryAbi = [
  {
    type: 'function',
    name: 'getPool',
    stateMutability: 'view',
    inputs: [
      { name: 'tokenA', type: 'address' },
      { name: 'tokenB', type: 'address' },
      { name: 'fee', type: 'uint24' },
    ],
    outputs: [{ name: 'pool', type: 'address' }],
  },
]
const v2PairAbi = [
  {
    type: 'function',
    name: 'getReserves',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'reserve0', type: 'uint112' },
      { name: 'reserve1', type: 'uint112' },
      { name: 'blockTimestampLast', type: 'uint32' },
    ],
  },
]
const v3PoolAbi = [
  {
    type: 'function',
    name: 'liquidity',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: 'liquidity', type: 'uint128' }],
  },
]

/**
 * Old V4 pools cannot be reconstructed from a recent rolling log window. These
 * records are canonical Initialize-event fixtures recovered from chain history;
 * their pool state is still revalidated by the exact execution call.
 */
export const ROBINHOOD_REVIEWED_V4_BOOTSTRAP = Object.freeze([
  {
    poolId: '0x1fb9a45079b017a6661016ba7dea29e1c4864b0874c21f63e137a52e71c3395b',
    token0: getAddress('0x117cc2133c37b721f49de2a7a74833232b3b4c0c'),
    token1: getAddress('0xA3b6AEe90017b72c0812dC1e013De70eB2917ba3'),
    fee: 8_388_608,
    tickSpacing: 200,
    hooks: getAddress('0x4e3468951d49f2eea976ed0d6e75ffcb44a9a544'),
  },
  {
    poolId: '0x8674c1c5544f3c9563565b5d4bd5916701d90b3559b072acf7cef5b4fc5b8dcd',
    token0: getAddress('0x117cc2133c37b721f49de2a7a74833232b3b4c0c'),
    token1: ROBINHOOD_USDG,
    fee: 8_388_608,
    tickSpacing: 10,
    hooks: getAddress('0xa0e8fbff13e24af2b5e61a72800e08a161bde080'),
  },
  {
    poolId: '0xc59eaeda6d1a6f031bc7e1d039772f2d675e7b4de2c8668610f4471bd60b3802',
    token0: ROBINHOOD_USDG,
    token1: getAddress('0x894E1EC2D74FFE5AEF8Dc8A9e84686acCB964F2A'),
    fee: 1_500,
    tickSpacing: 15,
    hooks: ZERO,
  },
  {
    poolId: '0xc690fa02422c7418e4f96cba915015cf87f2dda80e723b432414114a2120fd39',
    token0: getAddress('0x070F0Bcf458c2A836cF68c986df3BA86586e64FD'),
    token1: ROBINHOOD_USDG,
    fee: 9_000,
    tickSpacing: 90,
    hooks: ZERO,
  },
  {
    poolId: '0xdf5c0bcd967d54774c139a4ef803ec994779736346fb4c21b50ed241b1fd2682',
    token0: ROBINHOOD_USDG,
    token1: getAddress('0xd0601CE157Db5BDc3162BbaC2A2c8Af5320D9EEc'),
    fee: 375,
    tickSpacing: 4,
    hooks: ZERO,
  },
])

function key(value) {
  return String(value).toLowerCase()
}

function uniqueAddresses(values) {
  return [...new Map(values.map((value) => [key(getAddress(value)), getAddress(value)])).values()]
}

function rpcFailure(error) {
  const rpcClass = classifyRpcError(error)
  return { error: `PUBLIC_RPC_${rpcClass}`, rpcClass }
}

function normalizedTransientAggregateError(results) {
  if (results.length === 0 || !results.every((result) => result?.status === 'failure')) return null
  const classes = results.map((result) => classifyRpcError(result.error))
  const transientClasses = [RpcErrorClass.NETWORK, RpcErrorClass.THROTTLED, RpcErrorClass.STATE_NOT_READY]
  if (!classes.every((rpcClass) => transientClasses.includes(rpcClass))) return null
  const rpcClass = classes.includes(RpcErrorClass.THROTTLED)
    ? RpcErrorClass.THROTTLED
    : classes.includes(RpcErrorClass.STATE_NOT_READY)
      ? RpcErrorClass.STATE_NOT_READY
      : RpcErrorClass.NETWORK
  return Object.assign(new Error('canonical Multicall3 returned an all-transient failure array'), {
    rpcClass,
    multicallFailureShape: 'ALL_SUBCALLS_TRANSIENT',
  })
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function multicallRuntimePolicy(options) {
  const policy = {
    maximumAttempts: ROBINHOOD_CATALOG_MULTICALL_POLICY.maximumAttempts,
    minimumRequestIntervalMs: ROBINHOOD_CATALOG_MULTICALL_POLICY.minimumRequestIntervalMs,
    retryBaseDelayMs: ROBINHOOD_CATALOG_MULTICALL_POLICY.retryBaseDelayMs,
    sleep: options.multicallSleep || sleep,
    lastRequestStartedAt: 0,
  }
  if (!Number.isSafeInteger(policy.maximumAttempts) || policy.maximumAttempts < 1) {
    throw new Error('Multicall maximum attempts must be a positive safe integer')
  }
  for (const value of [policy.minimumRequestIntervalMs, policy.retryBaseDelayMs]) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error('Multicall timing must use non-negative safe integers')
    }
  }
  if (typeof policy.sleep !== 'function') throw new Error('Multicall sleep must be a function')
  return policy
}

async function boundedFixedBlockMulticall(client, contracts, blockNumber, options) {
  const results = []
  let requests = 0
  let retries = 0
  let transientFailures = 0
  let embeddedTransientBatches = 0
  for (
    let offset = 0;
    offset < contracts.length;
    offset += ROBINHOOD_CATALOG_MULTICALL_POLICY.maximumSubcallsPerRequest
  ) {
    const chunk = contracts.slice(offset, offset + ROBINHOOD_CATALOG_MULTICALL_POLICY.maximumSubcallsPerRequest)
    let resolved = null
    for (let attempt = 1; attempt <= options.maximumAttempts; attempt += 1) {
      const pacingDelay = Math.max(0, options.lastRequestStartedAt + options.minimumRequestIntervalMs - Date.now())
      if (pacingDelay > 0) await options.sleep(pacingDelay)
      options.lastRequestStartedAt = Date.now()
      requests += 1
      try {
        const chunkResults = await client.multicall({
          contracts: chunk,
          multicallAddress: MULTICALL3,
          allowFailure: true,
          batchSize: 0,
          blockNumber,
        })
        if (!Array.isArray(chunkResults) || chunkResults.length !== chunk.length) {
          throw new Error('canonical Multicall3 result count mismatch')
        }
        const normalizedError = normalizedTransientAggregateError(chunkResults)
        if (normalizedError) throw normalizedError
        resolved = chunkResults
        break
      } catch (error) {
        const transient = [RpcErrorClass.NETWORK, RpcErrorClass.THROTTLED, RpcErrorClass.STATE_NOT_READY].includes(
          classifyRpcError(error),
        )
        if (transient) transientFailures += 1
        if (error?.multicallFailureShape === 'ALL_SUBCALLS_TRANSIENT') embeddedTransientBatches += 1
        if (!transient || attempt === options.maximumAttempts) {
          resolved = chunk.map(() => ({ status: 'failure', error }))
          break
        }
        retries += 1
        const retryDelay = options.retryBaseDelayMs * 2 ** (attempt - 1)
        if (retryDelay > 0) await options.sleep(retryDelay)
      }
    }
    results.push(...resolved)
  }
  return { results, requests, retries, transientFailures, embeddedTransientBatches }
}

async function verifiedMulticallCodeHash(client, blockNumber, options) {
  const expected =
    options.expectedMulticallCodeHash === undefined ? MULTICALL3_RUNTIME_CODE_HASH : options.expectedMulticallCodeHash
  if (expected === null) return null
  const prior = options.verifiedMulticallCodeHash
  if (prior !== undefined) {
    if (prior !== expected) throw new Error('canonical Multicall3 prior verification mismatch')
    return prior
  }
  const code = await client.getCode({ address: MULTICALL3, blockNumber })
  if (!code || code === '0x') throw new Error('canonical Multicall3 has no bytecode')
  const observed = keccak256(code)
  if (observed !== expected) throw new Error('canonical Multicall3 bytecode mismatch')
  return observed
}

function pairQueryKey(source) {
  try {
    return [key(getAddress(source.token0)), key(getAddress(source.token1))].sort().join(':')
  } catch {
    return null
  }
}

function v3QueryKey(source) {
  const pair = pairQueryKey(source)
  const fee = Number(source?.fee)
  return pair && Number.isSafeInteger(fee) && V3_FEES.includes(fee) ? `${pair}:${fee}` : null
}

function retainedPool(pool, previousGeneratedAt, generatedAt) {
  const lastVerifiedAt = String(pool?.lastVerifiedAt || previousGeneratedAt || '')
  const verifiedAt = Date.parse(lastVerifiedAt)
  const currentAt = Date.parse(generatedAt)
  if (
    !Number.isFinite(verifiedAt) ||
    !Number.isFinite(currentAt) ||
    currentAt - verifiedAt < -60_000 ||
    currentAt - verifiedAt > ROBINHOOD_PARTIAL_CATALOG_RETENTION_POLICY.maximumAgeMs
  ) {
    return null
  }
  try {
    return {
      ...pool,
      address: getAddress(pool.address),
      token0: getAddress(pool.token0),
      token1: getAddress(pool.token1),
      lastVerifiedAt,
      catalogObservation: 'RETAINED_AFTER_CURRENT_TRANSIENT_QUERY_FAILURE',
    }
  } catch {
    return null
  }
}

function freshPool(pool, generatedAt) {
  return {
    ...pool,
    lastVerifiedAt: generatedAt,
    catalogObservation: 'CURRENT_FIXED_BLOCK_READ',
  }
}

function stablePoolOrder(queryKey) {
  return (left, right) =>
    String(queryKey(left) || '').localeCompare(String(queryKey(right) || '')) ||
    String(left.address).localeCompare(String(right.address))
}

/**
 * A partial public-RPC refresh may replace only queries that produced current
 * evidence. Previously verified topology is retained solely for the exact
 * pair/fee queries that failed transiently, and only inside the catalog age
 * bound. Exact execution still revalidates current pool state.
 */
export function mergeRobinhoodPartialCatalog(current, previous, options = {}) {
  if (
    !current ||
    !Array.isArray(current.v2Pools) ||
    !Array.isArray(current.v3Pools) ||
    !Array.isArray(current.rejected) ||
    typeof current.readEvidence !== 'object'
  ) {
    throw new Error('current Robinhood catalog is invalid')
  }
  const generatedAt = String(options.generatedAt || new Date().toISOString())
  if (!Number.isFinite(Date.parse(generatedAt))) throw new Error('catalog merge timestamp is invalid')
  const previousGeneratedAt = String(options.previousGeneratedAt || '')
  const transientClasses = new Set([RpcErrorClass.NETWORK, RpcErrorClass.THROTTLED, RpcErrorClass.STATE_NOT_READY])
  const failedV2 = new Set(
    current.rejected
      .filter((item) => item?.venue === 'UNISWAP_V2' && item.error && transientClasses.has(item.rpcClass))
      .map(pairQueryKey)
      .filter(Boolean),
  )
  const failedV3 = new Set(
    current.rejected
      .filter((item) => item?.venue === 'UNISWAP_V3' && item.error && transientClasses.has(item.rpcClass))
      .map(v3QueryKey)
      .filter(Boolean),
  )
  const freshV2 = current.v2Pools.map((pool) => freshPool(pool, generatedAt))
  const freshV3 = current.v3Pools.map((pool) => freshPool(pool, generatedAt))
  const freshV2Keys = new Set(freshV2.map(pairQueryKey).filter(Boolean))
  const freshV3Keys = new Set(freshV3.map(v3QueryKey).filter(Boolean))
  const retainedV2 = []
  const retainedV3 = []
  let expiredV2 = 0
  let expiredV3 = 0

  for (const pool of Array.isArray(previous?.v2Pools) ? previous.v2Pools : []) {
    const query = pairQueryKey(pool)
    if (!query || !failedV2.has(query) || freshV2Keys.has(query)) continue
    const retained = retainedPool(pool, previousGeneratedAt, generatedAt)
    if (retained) {
      retainedV2.push(retained)
      freshV2Keys.add(query)
    } else expiredV2 += 1
  }
  for (const pool of Array.isArray(previous?.v3Pools) ? previous.v3Pools : []) {
    const query = v3QueryKey(pool)
    if (!query || !failedV3.has(query) || freshV3Keys.has(query)) continue
    const retained = retainedPool(pool, previousGeneratedAt, generatedAt)
    if (retained) {
      retainedV3.push(retained)
      freshV3Keys.add(query)
    } else expiredV3 += 1
  }

  const v2Pools = [...freshV2, ...retainedV2].sort(stablePoolOrder(pairQueryKey))
  const v3Pools = [...freshV3, ...retainedV3].sort(stablePoolOrder(v3QueryKey))
  return {
    ...current,
    v2Pools,
    v3Pools,
    readEvidence: {
      ...current.readEvidence,
      topologyRetention: {
        policy: ROBINHOOD_PARTIAL_CATALOG_RETENTION_POLICY.version,
        previousCatalogBlock: previous?.blockNumber ? String(previous.blockNumber) : null,
        freshV2Pools: freshV2.length,
        freshV3Pools: freshV3.length,
        retainedV2Pools: retainedV2.length,
        retainedV3Pools: retainedV3.length,
        expiredV2Pools: expiredV2,
        expiredV3Pools: expiredV3,
      },
    },
  }
}

/**
 * Discover canonical V2/V3 pools only for asset-to-hub pairs. This bounded
 * coverage connects every Earn asset/BPT to USDG and WETH without the O(n^2)
 * paid-RPC fanout of querying every possible pair.
 */
export async function loadRobinhoodHubUniswapCatalog(client, assetAddresses, blockNumber, options = {}) {
  const bulkReadPolicy = multicallRuntimePolicy(options)
  const hubs = uniqueAddresses(options.hubs || [ROBINHOOD_USDG, ROBINHOOD_WETH])
  const assets = uniqueAddresses([...assetAddresses, ...hubs])
  const pairs = []
  const seen = new Set()
  for (const asset of assets) {
    for (const hub of hubs) {
      if (key(asset) === key(hub)) continue
      const pairKey = [key(asset), key(hub)].sort().join(':')
      if (seen.has(pairKey)) continue
      seen.add(pairKey)
      pairs.push({ token0: asset < hub ? asset : hub, token1: asset < hub ? hub : asset })
    }
  }

  const multicallCodeHash = await verifiedMulticallCodeHash(client, blockNumber, options)
  const v2FactoryRead = await boundedFixedBlockMulticall(
    client,
    pairs.map((pair) => ({
      address: ROBINHOOD_UNISWAP_V2_FACTORY,
      abi: v2FactoryAbi,
      functionName: 'getPair',
      args: [pair.token0, pair.token1],
    })),
    blockNumber,
    bulkReadPolicy,
  )
  const v2Results = new Array(pairs.length)
  const v2Candidates = []
  for (let index = 0; index < pairs.length; index += 1) {
    const pair = pairs[index]
    const result = v2FactoryRead.results[index]
    if (result?.status !== 'success') {
      v2Results[index] = { ...rpcFailure(result?.error || 'V2 factory read failed'), phase: 'FACTORY', ...pair }
      continue
    }
    try {
      const pool = getAddress(result.result)
      if (key(pool) === key(ZERO)) {
        v2Results[index] = null
        continue
      }
      v2Candidates.push({ index, address: pool, ...pair })
    } catch (error) {
      v2Results[index] = { ...rpcFailure(error), phase: 'FACTORY_RESULT', ...pair }
    }
  }
  const v2StateRead = await boundedFixedBlockMulticall(
    client,
    v2Candidates.map((candidate) => ({
      address: candidate.address,
      abi: v2PairAbi,
      functionName: 'getReserves',
    })),
    blockNumber,
    bulkReadPolicy,
  )
  for (let index = 0; index < v2Candidates.length; index += 1) {
    const candidate = v2Candidates[index]
    const result = v2StateRead.results[index]
    if (result?.status !== 'success') {
      v2Results[candidate.index] = {
        ...rpcFailure(result?.error || 'V2 pool-state read failed'),
        phase: 'POOL_STATE',
        address: candidate.address,
        token0: candidate.token0,
        token1: candidate.token1,
      }
      continue
    }
    try {
      const reserves = result.result
      if (BigInt(reserves[0]) === 0n || BigInt(reserves[1]) === 0n) {
        v2Results[candidate.index] = {
          rejected: true,
          reason: 'zero reserve',
          address: candidate.address,
          token0: candidate.token0,
          token1: candidate.token1,
        }
        continue
      }
      v2Results[candidate.index] = {
        address: candidate.address,
        token0: candidate.token0,
        token1: candidate.token1,
        reserve0: BigInt(reserves[0]).toString(),
        reserve1: BigInt(reserves[1]).toString(),
        source: 'CANONICAL_UNISWAP_V2_FACTORY_GET_PAIR_WITH_NONZERO_RESERVES',
      }
    } catch (error) {
      v2Results[candidate.index] = {
        ...rpcFailure(error),
        phase: 'POOL_STATE_RESULT',
        address: candidate.address,
        token0: candidate.token0,
        token1: candidate.token1,
      }
    }
  }

  const v3Queries = pairs.flatMap((pair) => V3_FEES.map((fee) => ({ ...pair, fee })))
  const v3FactoryRead = await boundedFixedBlockMulticall(
    client,
    v3Queries.map((query) => ({
      address: ROBINHOOD_UNISWAP_V3_FACTORY,
      abi: v3FactoryAbi,
      functionName: 'getPool',
      args: [query.token0, query.token1, query.fee],
    })),
    blockNumber,
    bulkReadPolicy,
  )
  const v3Results = new Array(v3Queries.length)
  const v3Candidates = []
  for (let index = 0; index < v3Queries.length; index += 1) {
    const query = v3Queries[index]
    const result = v3FactoryRead.results[index]
    if (result?.status !== 'success') {
      v3Results[index] = { ...rpcFailure(result?.error || 'V3 factory read failed'), phase: 'FACTORY', ...query }
      continue
    }
    try {
      const pool = getAddress(result.result)
      if (key(pool) === key(ZERO)) {
        v3Results[index] = null
        continue
      }
      v3Candidates.push({ index, address: pool, ...query })
    } catch (error) {
      v3Results[index] = { ...rpcFailure(error), phase: 'FACTORY_RESULT', ...query }
    }
  }
  const v3StateRead = await boundedFixedBlockMulticall(
    client,
    v3Candidates.map((candidate) => ({
      address: candidate.address,
      abi: v3PoolAbi,
      functionName: 'liquidity',
    })),
    blockNumber,
    bulkReadPolicy,
  )
  for (let index = 0; index < v3Candidates.length; index += 1) {
    const candidate = v3Candidates[index]
    const result = v3StateRead.results[index]
    if (result?.status !== 'success') {
      v3Results[candidate.index] = {
        ...rpcFailure(result?.error || 'V3 pool-state read failed'),
        phase: 'POOL_STATE',
        address: candidate.address,
        token0: candidate.token0,
        token1: candidate.token1,
        fee: candidate.fee,
      }
      continue
    }
    try {
      const liquidity = BigInt(result.result)
      if (liquidity === 0n) {
        v3Results[candidate.index] = {
          rejected: true,
          reason: 'zero active liquidity',
          address: candidate.address,
          token0: candidate.token0,
          token1: candidate.token1,
          fee: candidate.fee,
        }
        continue
      }
      v3Results[candidate.index] = {
        address: candidate.address,
        token0: candidate.token0,
        token1: candidate.token1,
        fee: candidate.fee,
        liquidity: liquidity.toString(),
        source: 'CANONICAL_UNISWAP_V3_FACTORY_GET_POOL_WITH_ACTIVE_LIQUIDITY',
      }
    } catch (error) {
      v3Results[candidate.index] = {
        ...rpcFailure(error),
        phase: 'POOL_STATE_RESULT',
        address: candidate.address,
        token0: candidate.token0,
        token1: candidate.token1,
        fee: candidate.fee,
      }
    }
  }

  const rejected = [
    ...v2Results.filter((item) => item?.error || item?.rejected).map((item) => ({ venue: 'UNISWAP_V2', ...item })),
    ...v3Results.filter((item) => item?.error || item?.rejected).map((item) => ({ venue: 'UNISWAP_V3', ...item })),
  ]
  const v2TransportErrors = v2Results.filter((item) => item?.error).length
  const v3TransportErrors = v3Results.filter((item) => item?.error).length
  const admittedAssets = new Set(assets.map(key))
  const v4ByPoolId = new Map()
  for (const source of [...ROBINHOOD_REVIEWED_V4_BOOTSTRAP, ...(options.additionalV4Pools || [])]) {
    try {
      const token0 = getAddress(source.token0 || source.currency0 || source.poolKey?.currency0)
      const token1 = getAddress(source.token1 || source.currency1 || source.poolKey?.currency1)
      const poolId = String(source.poolId || '')
      const fee = Number(source.fee ?? source.poolKey?.fee)
      const tickSpacing = Number(source.tickSpacing ?? source.poolKey?.tickSpacing)
      const hooks = getAddress(source.hooks || source.hookAddress || source.poolKey?.hooks || ZERO)
      if (
        !admittedAssets.has(key(token0)) ||
        !admittedAssets.has(key(token1)) ||
        !/^0x[0-9a-f]{64}$/i.test(poolId) ||
        !Number.isSafeInteger(fee) ||
        fee < 0 ||
        !Number.isSafeInteger(tickSpacing) ||
        tickSpacing <= 0
      ) {
        continue
      }
      v4ByPoolId.set(poolId.toLowerCase(), {
        address: ROBINHOOD_UNISWAP_V4_POOL_MANAGER,
        poolId: poolId.toLowerCase(),
        token0,
        token1,
        fee,
        tickSpacing,
        hooks,
        source: source.source || source.adapterId || 'PERSISTED_POOL_MANAGER_INITIALIZE_EVENT',
      })
    } catch {}
  }
  return {
    blockNumber: BigInt(blockNumber).toString(),
    coverage: 'ALL_EARN_ASSETS_AND_BPTS_TO_SETTLEMENT_HUBS_PLUS_REVIEWED_V4_BOOTSTRAP',
    readEvidence: {
      status: v2TransportErrors + v3TransportErrors === 0 ? 'COMPLETE' : 'PARTIAL',
      complete: v2TransportErrors + v3TransportErrors === 0,
      requestedPairs: pairs.length,
      requestedV3FeeQueries: v3Queries.length,
      v2TransportErrors,
      v3TransportErrors,
      bulkRead: {
        policy: ROBINHOOD_CATALOG_MULTICALL_POLICY.version,
        multicallCodeHash,
        maximumAttempts: bulkReadPolicy.maximumAttempts,
        minimumRequestIntervalMs: bulkReadPolicy.minimumRequestIntervalMs,
        retryBaseDelayMs: bulkReadPolicy.retryBaseDelayMs,
        rpcRequests: v2FactoryRead.requests + v2StateRead.requests + v3FactoryRead.requests + v3StateRead.requests,
        retries: v2FactoryRead.retries + v2StateRead.retries + v3FactoryRead.retries + v3StateRead.retries,
        transientFailures:
          v2FactoryRead.transientFailures +
          v2StateRead.transientFailures +
          v3FactoryRead.transientFailures +
          v3StateRead.transientFailures,
        embeddedTransientBatches:
          v2FactoryRead.embeddedTransientBatches +
          v2StateRead.embeddedTransientBatches +
          v3FactoryRead.embeddedTransientBatches +
          v3StateRead.embeddedTransientBatches,
        subcalls: pairs.length + v2Candidates.length + v3Queries.length + v3Candidates.length,
      },
    },
    assets,
    hubs,
    v2Pools: v2Results.filter((item) => item && !item.error && !item.rejected),
    v3Pools: v3Results.filter((item) => item && !item.error && !item.rejected),
    v4Pools: [...v4ByPoolId.values()],
    rejected,
  }
}
