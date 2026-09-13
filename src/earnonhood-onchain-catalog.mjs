import { getAddress, keccak256 } from 'viem'

import { normalizeEarnOnHoodCatalog } from './earnonhood-graph.mjs'
import {
  EARN_OMNIPOOL_FACTORY,
  EARN_REVIEWED_LEGACY_OMNIPOOLS,
  EARN_ROUTE_DISCOVERY_POLICY,
  EARN_VAULT,
  EARN_WETH,
} from './earnonhood-routes.mjs'

const EXPECTED_STATIC_SWAP_FEE = 3_000_000_000_000_000n
const NORMALIZED_WEIGHT_ONE = 1_000_000_000_000_000_000n
const MULTICALL3 = getAddress('0xcA11bde05977b3631167028862bE2a173976CA11')
const MULTICALL3_RUNTIME_CODE_HASH = '0xd5c15df687b16f2ff992fc8d767b4216323184a2bbc6ee2f9c398c318e770891'
const MULTICALL_SUBCALL_LIMIT = 12

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
    try {
      if (record?.error) throw new Error(record.error)
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
      sourcePools.push({
        address,
        name: record.name || shortAddress(address),
        initialized: dynamicData.isPoolInitialized === true,
        paused: dynamicData.isPoolPaused === true,
        recoveryMode: dynamicData.isPoolInRecoveryMode === true,
        tvlUsd: 0,
        swapFee: Number(BigInt(dynamicData.staticSwapFeePercentage)) / 1e16,
        tokens: tokens.map((token, index) => {
          const tokenAddress = getAddress(token)
          return {
            address: tokenAddress,
            symbol: record.tokenSymbols?.[key(tokenAddress)] || shortAddress(tokenAddress),
            decimals: 18,
            balance: BigInt(balances[index]).toString(),
            weight: Number(BigInt(weights[index])) / 1e16,
            priceUsd: null,
          }
        }),
      })
    } catch (error) {
      rejected.push({
        address: record?.address || null,
        name: record?.name || 'UNKNOWN',
        reason: publicError(error),
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
    if (failed) return { address, error: publicError(failed.error || 'weighted pool read failed') }
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
  const records = poolReads.map((record) =>
    record.error ? record : { ...record, tokenSymbols: Object.fromEntries(tokenLabels) },
  )
  const catalog = buildEarnOnHoodCatalogFromOnchain({ records, blockNumber, factoryDisabled })
  return {
    ...catalog,
    discoveredFactoryPools: factoryPools.length,
    reviewedLegacyPools: EARN_REVIEWED_LEGACY_OMNIPOOLS.length,
  }
}
