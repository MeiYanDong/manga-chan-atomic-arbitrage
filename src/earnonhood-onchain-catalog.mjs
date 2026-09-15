import { encodeFunctionData, getAddress, keccak256 } from 'viem'

import { normalizeEarnOnHoodCatalog } from './earnonhood-graph.mjs'
import {
  EARN_OMNIPOOL_FACTORY,
  EARN_REVIEWED_LEGACY_OMNIPOOLS,
  EARN_ROUTE_DISCOVERY_POLICY,
  EARN_VAULT,
  EARN_WETH,
} from './earnonhood-routes.mjs'
import { RpcErrorClass, classifyRpcError } from './policy.mjs'

const EXPECTED_STATIC_SWAP_FEE = 3_000_000_000_000_000n
const NORMALIZED_WEIGHT_ONE = 1_000_000_000_000_000_000n
const MULTICALL3 = getAddress('0xcA11bde05977b3631167028862bE2a173976CA11')
const MULTICALL3_RUNTIME_CODE_HASH = '0xd5c15df687b16f2ff992fc8d767b4216323184a2bbc6ee2f9c398c318e770891'
const MULTICALL_SUBCALL_LIMIT = 12
const PERMIT2 = getAddress('0x000000000022D473030F116dDEE9F6B43aC78BA3')
export const EARN_PARTIAL_CATALOG_RETENTION_POLICY = Object.freeze({
  version: 'FAILED_TRANSIENT_POOL_READ_LAST_VERIFIED_V1',
  maximumAgeMs: 6 * 60 * 60 * 1_000,
})

const factoryAbi = [
  {
    type: 'function',
    name: 'getPools',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: 'pools', type: 'address[]' }],
  },
  {
    type: 'function',
    name: 'getVault',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: 'vault', type: 'address' }],
  },
  {
    type: 'function',
    name: 'isDisabled',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: 'disabled', type: 'bool' }],
  },
]

const weightedPoolAbi = [
  {
    type: 'function',
    name: 'getWeightedPoolImmutableData',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      {
        name: 'data',
        type: 'tuple',
        components: [
          { name: 'tokens', type: 'address[]' },
          { name: 'decimalScalingFactors', type: 'uint256[]' },
          { name: 'normalizedWeights', type: 'uint256[]' },
          { name: 'minTokenBalances', type: 'uint256[]' },
        ],
      },
    ],
  },
  {
    type: 'function',
    name: 'getWeightedPoolDynamicData',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      {
        name: 'data',
        type: 'tuple',
        components: [
          { name: 'balancesLiveScaled18', type: 'uint256[]' },
          { name: 'tokenRates', type: 'uint256[]' },
          { name: 'staticSwapFeePercentage', type: 'uint256' },
          { name: 'totalSupply', type: 'uint256' },
          { name: 'isPoolInitialized', type: 'bool' },
          { name: 'isPoolPaused', type: 'bool' },
          { name: 'isPoolInRecoveryMode', type: 'bool' },
        ],
      },
    ],
  },
]

const metadataAbi = [
  {
    type: 'function',
    name: 'symbol',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: 'symbol', type: 'string' }],
  },
]
const approvalAbi = [
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: 'approved', type: 'bool' }],
  },
]

function key(address) {
  return String(address).toLowerCase()
}

function shortAddress(address) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

async function mapWithConcurrency(items, concurrency, task) {
  const output = new Array(items.length)
  let cursor = 0
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      for (;;) {
        const index = cursor++
        if (index >= items.length) return
        output[index] = await task(items[index], index)
      }
    }),
  )
  return output
}

async function boundedMulticall(client, contracts, blockNumber) {
  const chunks = []
  for (let offset = 0; offset < contracts.length; offset += MULTICALL_SUBCALL_LIMIT) {
    chunks.push(contracts.slice(offset, offset + MULTICALL_SUBCALL_LIMIT))
  }
  const groups = await mapWithConcurrency(chunks, 2, async (chunk) => {
    try {
      return await client.multicall({
        contracts: chunk,
        multicallAddress: MULTICALL3,
        allowFailure: true,
        batchSize: 0,
        blockNumber,
      })
    } catch (error) {
      return chunk.map(() => ({ status: 'failure', error }))
    }
  })
  return groups.flat()
}

function publicError(error) {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/https?:\/\/[^\s]+/gi, '[endpoint]').slice(0, 240)
}

function successfulOptionalBoolean(data) {
  if (!data || data === '0x') return true
  return /^0x[0-9a-f]{64}$/i.test(data) && BigInt(data) === 1n
}

/**
 * Convert canonical onchain weighted-pool state into the discovery model.
 * Balances are deliberately kept in the Vault's common scaled-18 domain. The
 * approximation only ranks routes; exact BatchRouter quotes remain the source
 * of truth for every economic and signing decision.
 */
export function buildEarnOnHoodCatalogFromOnchain({ records, blockNumber, factoryDisabled = false }) {
  if (!Array.isArray(records)) throw new Error('onchain Earn catalog records must be an array')
  const sourcePools = []
  const rejected = []
  for (const record of records) {
    if (record?.error) {
      const rpcClass = record.rpcClass || RpcErrorClass.INVARIANT
      rejected.push({
        address: record.address || null,
        name: record.name || 'UNKNOWN',
        reason: `PUBLIC_RPC_${rpcClass}`,
        rpcClass,
        phase: record.phase || 'UNKNOWN',
      })
      continue
    }
    try {
      const address = getAddress(record.address)
      const immutableData = record.immutableData
      const dynamicData = record.dynamicData
      const tokens = immutableData?.tokens || []
      const weights = immutableData?.normalizedWeights || []
      const balances = dynamicData?.balancesLiveScaled18 || []
      if (tokens.length < 2 || tokens.length > EARN_ROUTE_DISCOVERY_POLICY.maximumTokensPerPool) {
        throw new Error('invalid onchain token count')
      }
      if (tokens.length !== weights.length || tokens.length !== balances.length) {
        throw new Error('onchain pool arrays have inconsistent lengths')
      }
      if (weights.reduce((total, weight) => total + BigInt(weight), 0n) !== NORMALIZED_WEIGHT_ONE) {
        throw new Error('onchain normalized weights do not sum to one')
      }
      if (BigInt(dynamicData.staticSwapFeePercentage) !== EXPECTED_STATIC_SWAP_FEE) {
        throw new Error('unexpected onchain swap fee')
      }
      const sourceTokens = tokens.map((token, index) => {
        const tokenAddress = getAddress(token)
        const permit2Record = record.tokenPermit2Compatibility?.[key(tokenAddress)]
        return {
          address: tokenAddress,
          symbol: record.tokenSymbols?.[key(tokenAddress)] || shortAddress(tokenAddress),
          decimals: 18,
          balance: BigInt(balances[index]).toString(),
          weight: Number(BigInt(weights[index])) / 1e16,
          priceUsd: null,
          permit2Compatible: permit2Record ? permit2Record.compatible === true : true,
        }
      })
      const blockedInputs = sourceTokens.filter((token) => !token.permit2Compatible)
      sourcePools.push({
        address,
        name: record.name || shortAddress(address),
        initialized: dynamicData.isPoolInitialized === true,
        paused: dynamicData.isPoolPaused === true,
        recoveryMode: dynamicData.isPoolInRecoveryMode === true,
        tvlUsd: 0,
        swapFee: Number(BigInt(dynamicData.staticSwapFeePercentage)) / 1e16,
        tokens: sourceTokens,
        addLiquidityExecutable: blockedInputs.length === 0,
        addLiquidityReason:
          blockedInputs.length === 0
            ? null
            : `canonical Permit2 approval rejected by ${blockedInputs.map((token) => token.symbol).join(', ')}`,
      })
    } catch (error) {
      rejected.push({
        address: record?.address || null,
        name: record?.name || 'UNKNOWN',
        reason: publicError(error),
        rpcClass: RpcErrorClass.INVARIANT,
        phase: 'NORMALIZATION',
      })
    }
  }
  const normalized = normalizeEarnOnHoodCatalog({
    ready: true,
    calculatedAt: new Date().toISOString(),
    pools: sourcePools,
  })
  return {
    ...normalized,
    rejected: [...rejected, ...normalized.rejected],
    source: 'CANONICAL_FACTORY_AND_POOL_STATE_ONCHAIN',
    blockNumber: BigInt(blockNumber).toString(),
    factory: EARN_OMNIPOOL_FACTORY,
    factoryDisabled,
  }
}

function retainEarnPool(pool, previousGeneratedAt, generatedAt) {
  const lastVerifiedAt = String(pool?.lastVerifiedAt || previousGeneratedAt || '')
  const verifiedAt = Date.parse(lastVerifiedAt)
  const currentAt = Date.parse(generatedAt)
  if (
    !Number.isFinite(verifiedAt) ||
    !Number.isFinite(currentAt) ||
    currentAt - verifiedAt < -60_000 ||
    currentAt - verifiedAt > EARN_PARTIAL_CATALOG_RETENTION_POLICY.maximumAgeMs ||
    !Array.isArray(pool?.tokens) ||
    pool.tokens.length < 2 ||
    pool.tokens.length > EARN_ROUTE_DISCOVERY_POLICY.maximumTokensPerPool
  ) {
    return null
  }
  try {
    return {
      ...pool,
      address: getAddress(pool.address),
      tokens: pool.tokens.map((token) => ({ ...token, address: getAddress(token.address) })),
      lastVerifiedAt,
      catalogObservation: 'RETAINED_AFTER_CURRENT_TRANSIENT_POOL_READ_FAILURE',
    }
  } catch {
    return null
  }
}

/**
 * Retain only a previously verified Earn pool whose exact current pool-state
 * read failed transiently. Factory membership and every execution quote stay
 * current-state; deterministic pool rejection removes the old topology.
 */
export function mergeEarnOnHoodPartialCatalog(current, previous, options = {}) {
  if (!current || !Array.isArray(current.pools) || !Array.isArray(current.rejected)) {
    throw new Error('current Earn catalog is invalid')
  }
  const generatedAt = String(options.generatedAt || new Date().toISOString())
  if (!Number.isFinite(Date.parse(generatedAt))) throw new Error('Earn catalog merge timestamp is invalid')
  const previousGeneratedAt = String(options.previousGeneratedAt || '')
  const transientClasses = new Set([RpcErrorClass.NETWORK, RpcErrorClass.THROTTLED, RpcErrorClass.STATE_NOT_READY])
  const failedPoolAddresses = new Set(
    current.rejected
      .filter(
        (item) =>
          item?.phase === 'POOL_STATE' && transientClasses.has(item.rpcClass) && typeof item.address === 'string',
      )
      .map((item) => key(item.address)),
  )
  const pools = current.pools.map((pool) => ({
    ...pool,
    lastVerifiedAt: generatedAt,
    catalogObservation: 'CURRENT_FIXED_BLOCK_POOL_READ',
  }))
  const seen = new Set(pools.map((pool) => key(pool.address)))
  let retainedPools = 0
  let expiredPools = 0
  if (previous?.source === current.source) {
    for (const pool of Array.isArray(previous.pools) ? previous.pools : []) {
      const address = key(pool?.address)
      if (!failedPoolAddresses.has(address) || seen.has(address)) continue
      const retained = retainEarnPool(pool, previousGeneratedAt, generatedAt)
      if (retained) {
        pools.push(retained)
        seen.add(address)
        retainedPools += 1
      } else expiredPools += 1
    }
  }
  return {
    ...current,
    pools,
    readEvidence: {
      ...(current.readEvidence || {}),
      topologyRetention: {
        policy: EARN_PARTIAL_CATALOG_RETENTION_POLICY.version,
        previousCatalogBlock: previous?.blockNumber ? String(previous.blockNumber) : null,
        freshPools: current.pools.length,
        retainedPools,
        expiredPools,
      },
    },
  }
}

/**
 * Read the current factory membership and the full weighted-pool state at one
 * fixed block. A broken permissionless pool is quarantined instead of taking
 * every unrelated route offline.
 */
export async function loadEarnOnHoodOnchainCatalog(client, blockNumber, options = {}) {
  const expectedMulticallCodeHash =
    options.expectedMulticallCodeHash === undefined ? MULTICALL3_RUNTIME_CODE_HASH : options.expectedMulticallCodeHash
  const [factoryCode, multicallCode, factoryVault, factoryDisabled, factoryPools] = await Promise.all([
    client.getCode({ address: EARN_OMNIPOOL_FACTORY, blockNumber }),
    client.getCode({ address: MULTICALL3, blockNumber }),
    client.readContract({
      address: EARN_OMNIPOOL_FACTORY,
      abi: factoryAbi,
      functionName: 'getVault',
      blockNumber,
    }),
    client.readContract({
      address: EARN_OMNIPOOL_FACTORY,
      abi: factoryAbi,
      functionName: 'isDisabled',
      blockNumber,
    }),
    client.readContract({
      address: EARN_OMNIPOOL_FACTORY,
      abi: factoryAbi,
      functionName: 'getPools',
      blockNumber,
    }),
  ])
  if (!factoryCode || factoryCode === '0x') throw new Error('canonical EarnOnHood factory has no bytecode')
  if (!multicallCode || multicallCode === '0x') throw new Error('canonical Multicall3 has no bytecode')
  if (expectedMulticallCodeHash && keccak256(multicallCode) !== expectedMulticallCodeHash) {
    throw new Error('canonical Multicall3 bytecode mismatch')
  }
  if (key(factoryVault) !== key(EARN_VAULT)) throw new Error('canonical EarnOnHood factory Vault mismatch')

  const addresses = [
    ...new Map(
      [...factoryPools, ...EARN_REVIEWED_LEGACY_OMNIPOOLS].map((address) => {
        const canonical = getAddress(address)
        return [key(canonical), canonical]
      }),
    ).values(),
  ]
  if (addresses.length > EARN_ROUTE_DISCOVERY_POLICY.maximumCatalogPools) {
    throw new Error('onchain EarnOnHood pool catalog exceeds the reviewed bound')
  }

  const poolContracts = addresses.flatMap((address) => [
    { address, abi: weightedPoolAbi, functionName: 'getWeightedPoolImmutableData' },
    { address, abi: weightedPoolAbi, functionName: 'getWeightedPoolDynamicData' },
    { address, abi: metadataAbi, functionName: 'symbol' },
  ])
  const poolResults = await boundedMulticall(client, poolContracts, blockNumber)
  const poolReads = addresses.map((address, index) => {
    const [immutableResult, dynamicResult, nameResult] = poolResults.slice(index * 3, index * 3 + 3)
    const failed = [immutableResult, dynamicResult].find((result) => result?.status !== 'success')
    if (failed) {
      const error = failed.error || 'weighted pool read failed'
      const rpcClass = classifyRpcError(error)
      return {
        address,
        error: `PUBLIC_RPC_${rpcClass}`,
        rpcClass,
        phase: 'POOL_STATE',
      }
    }
    return {
      address,
      immutableData: immutableResult.result,
      dynamicData: dynamicResult.result,
      name: nameResult?.status === 'success' ? nameResult.result : shortAddress(address),
    }
  })

  const tokenAddresses = [
    ...new Map(
      poolReads
        .filter((record) => !record.error)
        .flatMap((record) => record.immutableData.tokens)
        .map((address) => {
          const canonical = getAddress(address)
          return [key(canonical), canonical]
        }),
    ).values(),
  ]
  const tokenResults = await boundedMulticall(
    client,
    tokenAddresses.map((address) => ({ address, abi: metadataAbi, functionName: 'symbol' })),
    blockNumber,
  )
  const tokenLabels = new Map(
    tokenAddresses.map((address, index) => [
      key(address),
      key(address) === key(EARN_WETH)
        ? 'WETH'
        : tokenResults[index]?.status === 'success'
          ? tokenResults[index].result
          : shortAddress(address),
    ]),
  )
  const approvalData = encodeFunctionData({ abi: approvalAbi, functionName: 'approve', args: [PERMIT2, 0n] })
  const permit2Checks = await mapWithConcurrency(tokenAddresses, 4, async (address) => {
    try {
      const result = await client.call({ account: EARN_VAULT, to: address, data: approvalData, blockNumber })
      return {
        compatible: successfulOptionalBoolean(result?.data),
        evidence: 'FIXED_BLOCK_ETH_CALL_APPROVE_ZERO_TO_CANONICAL_PERMIT2',
      }
    } catch (error) {
      return {
        compatible: false,
        evidence: 'FIXED_BLOCK_ETH_CALL_REVERTED',
        reason: publicError(error),
      }
    }
  })
  const tokenPermit2Compatibility = Object.fromEntries(
    tokenAddresses.map((address, index) => [key(address), permit2Checks[index]]),
  )
  const records = poolReads.map((record) =>
    record.error
      ? record
      : {
          ...record,
          tokenSymbols: Object.fromEntries(tokenLabels),
          tokenPermit2Compatibility,
        },
  )
  const catalog = buildEarnOnHoodCatalogFromOnchain({ records, blockNumber, factoryDisabled })
  return {
    ...catalog,
    discoveredFactoryPools: factoryPools.length,
    reviewedLegacyPools: EARN_REVIEWED_LEGACY_OMNIPOOLS.length,
    multicallCodeHash: keccak256(multicallCode),
  }
}

/**
 * Refresh only the mutable weighted-pool state from a previously canonical,
 * protected catalog. Factory membership, immutable tokens/weights, labels and
 * Permit2 probes are reused; a selected route is still checked against the
 * canonical Vault again on the managed signing path. This keeps public event
 * wakes to bounded multicalls instead of repeating every static metadata read.
 */
export async function refreshEarnOnHoodCachedDynamicCatalog(client, cached, blockNumber) {
  if (
    cached?.source !== EARN_ROUTE_DISCOVERY_POLICY.catalogSource ||
    !Array.isArray(cached.pools) ||
    cached.pools.length === 0 ||
    cached.pools.length > EARN_ROUTE_DISCOVERY_POLICY.maximumCatalogPools
  ) {
    throw new Error('cached EarnOnHood catalog is absent or outside policy')
  }
  const dynamicResults = await boundedMulticall(
    client,
    cached.pools.map((pool) => ({
      address: getAddress(pool.address),
      abi: weightedPoolAbi,
      functionName: 'getWeightedPoolDynamicData',
    })),
    blockNumber,
  )
  const sourcePools = []
  const refreshRejected = []
  for (let index = 0; index < cached.pools.length; index += 1) {
    const pool = cached.pools[index]
    const result = dynamicResults[index]
    if (result?.status !== 'success') {
      const rpcClass = classifyRpcError(result?.error || 'dynamic weighted pool read failed')
      refreshRejected.push({
        address: pool.address,
        name: pool.name || shortAddress(pool.address),
        reason: `PUBLIC_RPC_${rpcClass}`,
        rpcClass,
        phase: 'POOL_STATE',
      })
      continue
    }
    const dynamicData = result.result
    const balances = dynamicData?.balancesLiveScaled18 || []
    if (!Array.isArray(pool.tokens) || balances.length !== pool.tokens.length) {
      refreshRejected.push({
        address: pool.address,
        name: pool.name || shortAddress(pool.address),
        reason: 'cached token list and current balances differ',
      })
      continue
    }
    sourcePools.push({
      ...pool,
      initialized: dynamicData.isPoolInitialized === true,
      paused: dynamicData.isPoolPaused === true,
      recoveryMode: dynamicData.isPoolInRecoveryMode === true,
      swapFee: Number(BigInt(dynamicData.staticSwapFeePercentage)) / 1e16,
      tokens: pool.tokens.map((token, tokenIndex) => ({
        ...token,
        balance: BigInt(balances[tokenIndex]).toString(),
      })),
    })
  }
  const normalized = normalizeEarnOnHoodCatalog({
    ready: true,
    calculatedAt: new Date().toISOString(),
    pools: sourcePools,
  })
  return {
    ...cached,
    ...normalized,
    rejected: [...refreshRejected, ...normalized.rejected],
    source: EARN_ROUTE_DISCOVERY_POLICY.catalogSource,
    blockNumber: BigInt(blockNumber).toString(),
    refreshMode: 'PROTECTED_CANONICAL_STATIC_CACHE_PLUS_FIXED_BLOCK_DYNAMIC_MULTICALL',
  }
}
