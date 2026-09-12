import { createPublicClient, defineChain, formatUnits, getAddress, http, parseUnits } from 'viem'
import { errorText } from '../src/policy.mjs'

const CHAIN_ID = 4_663
const RPC_URL = process.env.EARN_RESEARCH_RPC_URL || 'https://rpc.mainnet.chain.robinhood.com'
const POOLS_URL = 'https://earnonhood.com/api/omni/pools'
const VAULT = getAddress('0x28082618Ba2073E602230188E4F4C46e9b2169EB')
const BATCH_ROUTER = getAddress('0x2d6DD5A990a643A8B11CD06554FBC290a1a82bA6')
const WETH = getAddress('0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73')
const USDG = getAddress('0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168')
const QUERY_SENDER = getAddress('0x77f771E83f118c32547A1291dda438a757B4b91B')
const GAS_ACCOUNT = getAddress('0x75741D131AbdD3973d6bA00f09948C15D138059d')
const MIN_TVL_USD = Number(process.env.EARN_RESEARCH_MIN_TVL_USD || 25)
const EXACT_QUERY_LIMIT = Number(process.env.EARN_RESEARCH_QUERY_LIMIT || 240)
const GAS_SAMPLE_LIMIT = Number(process.env.EARN_RESEARCH_GAS_LIMIT || 12)

const pathComponents = [
  { name: 'tokenIn', type: 'address' },
  {
    name: 'steps',
    type: 'tuple[]',
    components: [
      { name: 'pool', type: 'address' },
      { name: 'tokenOut', type: 'address' },
      { name: 'isBuffer', type: 'bool' },
    ],
  },
  { name: 'exactAmountIn', type: 'uint256' },
  { name: 'minAmountOut', type: 'uint256' },
]

const batchRouterAbi = [
  {
    type: 'function',
    name: 'querySwapExactIn',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'paths', type: 'tuple[]', components: pathComponents },
      { name: 'sender', type: 'address' },
      { name: 'userData', type: 'bytes' },
    ],
    outputs: [
      { name: 'pathAmountsOut', type: 'uint256[]' },
      { name: 'tokensOut', type: 'address[]' },
      { name: 'amountsOut', type: 'uint256[]' },
    ],
  },
  {
    type: 'function',
    name: 'swapExactIn',
    stateMutability: 'payable',
    inputs: [
      { name: 'paths', type: 'tuple[]', components: pathComponents },
      { name: 'deadline', type: 'uint256' },
      { name: 'wethIsEth', type: 'bool' },
      { name: 'userData', type: 'bytes' },
    ],
    outputs: [
      { name: 'pathAmountsOut', type: 'uint256[]' },
      { name: 'tokensOut', type: 'address[]' },
      { name: 'amountsOut', type: 'uint256[]' },
    ],
  },
]

const vaultAbi = [
  {
    type: 'function',
    name: 'isPoolInitialized',
    stateMutability: 'view',
    inputs: [{ name: 'pool', type: 'address' }],
    outputs: [{ name: 'initialized', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'isPoolPaused',
    stateMutability: 'view',
    inputs: [{ name: 'pool', type: 'address' }],
    outputs: [{ name: 'paused', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'isPoolInRecoveryMode',
    stateMutability: 'view',
    inputs: [{ name: 'pool', type: 'address' }],
    outputs: [{ name: 'recoveryMode', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'getPoolTokens',
    stateMutability: 'view',
    inputs: [{ name: 'pool', type: 'address' }],
    outputs: [{ name: 'tokens', type: 'address[]' }],
  },
]

const chain = defineChain({
  id: CHAIN_ID,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
})
const client = createPublicClient({
  chain,
  transport: http(RPC_URL, { timeout: 30_000, retryCount: 2 }),
})

function stringify(value) {
  return JSON.stringify(value, (_, item) => (typeof item === 'bigint' ? item.toString() : item), 2)
}

function addressKey(value) {
  return value.toLowerCase()
}

function sameAddresses(left, right) {
  if (left.length !== right.length) return false
  const a = left.map(addressKey).sort()
  const b = right.map(addressKey).sort()
  return a.every((value, index) => value === b[index])
}

function weightedOut(pool, tokenInAddress, tokenOutAddress, amountInRaw) {
  const tokenIn = pool.tokens.find((token) => addressKey(token.address) === addressKey(tokenInAddress))
  const tokenOut = pool.tokens.find((token) => addressKey(token.address) === addressKey(tokenOutAddress))
  if (!tokenIn || !tokenOut) return null
  const amountIn = Number(formatUnits(amountInRaw, tokenIn.decimals))
  const balanceIn = Number(formatUnits(BigInt(tokenIn.balance), tokenIn.decimals))
  const balanceOut = Number(formatUnits(BigInt(tokenOut.balance), tokenOut.decimals))
  if (![amountIn, balanceIn, balanceOut].every(Number.isFinite) || amountIn <= 0 || balanceIn <= 0) return null
  const afterFee = amountIn * (1 - Number(pool.swapFee || 0.3) / 100)
  const ratio = balanceIn / (balanceIn + afterFee)
  const out = balanceOut * (1 - ratio ** (Number(tokenIn.weight) / Number(tokenOut.weight)))
  if (!Number.isFinite(out) || out <= 0) return null
  return parseUnits(out.toFixed(Math.min(tokenOut.decimals, 18)), tokenOut.decimals)
}

function enumerateCycles(pools, baseToken, maxHops = 4) {
  const cycles = []
  const walk = (current, steps, usedPools, usedTokens) => {
    if (steps.length >= maxHops) return
    for (const pool of pools) {
      if (usedPools.has(addressKey(pool.address))) continue
      if (!pool.tokens.some((token) => addressKey(token.address) === addressKey(current))) continue
      for (const tokenOut of pool.tokens) {
        const next = getAddress(tokenOut.address)
        if (addressKey(next) === addressKey(current)) continue
        const nextSteps = [...steps, { pool, tokenOut: next }]
        if (addressKey(next) === addressKey(baseToken)) {
          if (nextSteps.length >= 2) cycles.push(nextSteps)
          continue
        }
        if (usedTokens.has(addressKey(next))) continue
        walk(
          next,
          nextSteps,
          new Set([...usedPools, addressKey(pool.address)]),
          new Set([...usedTokens, addressKey(next)]),
        )
      }
    }
  }
  walk(baseToken, [], new Set(), new Set([addressKey(baseToken)]))
  return cycles
}

function approximateCycle(base, steps, amountIn) {
  let amount = amountIn
  let current = base.address
  for (const step of steps) {
    amount = weightedOut(step.pool, current, step.tokenOut, amount)
    if (amount === null) return null
    current = step.tokenOut
  }
  return amount
}

function routeLabel(base, steps) {
  const symbols = [base.symbol]
  const pools = []
  for (const step of steps) {
    symbols.push(
      step.pool.tokens.find((token) => addressKey(token.address) === addressKey(step.tokenOut))?.symbol ||
        step.tokenOut,
    )
    pools.push(step.pool.name)
  }
  return { symbols, pools }
}

function asPath(base, steps, amountIn, minAmountOut = 0n) {
  return {
    tokenIn: base.address,
    steps: steps.map((step) => ({ pool: step.pool.address, tokenOut: step.tokenOut, isBuffer: false })),
    exactAmountIn: amountIn,
    minAmountOut,
  }
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

async function main() {
  const response = await fetch(POOLS_URL, {
    headers: {
      accept: 'application/json',
      'user-agent': 'manga-chan-atomic-arbitrage/0.11 (+https://github.com/MeiYanDong/manga-chan-atomic-arbitrage)',
    },
  })
  if (!response.ok) throw new Error(`EarnOnHood pools API returned HTTP ${response.status}`)
  const snapshot = await response.json()
  if (!snapshot.ready || !Array.isArray(snapshot.pools)) throw new Error('EarnOnHood pools API is not ready')

  const blockNumber = await client.getBlockNumber()
  const block = await client.getBlock({ blockNumber })
  const apiPools = snapshot.pools
    .filter((pool) => pool.initialized && Number(pool.tvlUsd || 0) >= MIN_TVL_USD)
    .map((pool) => ({
      ...pool,
      address: getAddress(pool.address),
      tokens: pool.tokens.map((token) => ({ ...token, address: getAddress(token.address) })),
    }))

  const poolChecks = await mapWithConcurrency(apiPools, 6, async (pool) => {
    try {
      const [initialized, paused, recoveryMode, tokens] = await Promise.all([
        client.readContract({
          address: VAULT,
          abi: vaultAbi,
          functionName: 'isPoolInitialized',
          args: [pool.address],
          blockNumber,
        }),
        client.readContract({
          address: VAULT,
          abi: vaultAbi,
          functionName: 'isPoolPaused',
          args: [pool.address],
          blockNumber,
        }),
        client.readContract({
          address: VAULT,
          abi: vaultAbi,
          functionName: 'isPoolInRecoveryMode',
          args: [pool.address],
          blockNumber,
        }),
        client.readContract({
          address: VAULT,
          abi: vaultAbi,
          functionName: 'getPoolTokens',
          args: [pool.address],
          blockNumber,
        }),
      ])
      return {
        pool,
        initialized,
        paused,
        recoveryMode,
        tokenSetMatches: sameAddresses(
          tokens,
          pool.tokens.map((token) => token.address),
        ),
        error: null,
      }
    } catch (error) {
      return {
        pool,
        initialized: false,
        paused: null,
        recoveryMode: null,
        tokenSetMatches: false,
        error: errorText(error),
      }
    }
  })

  const eligiblePools = poolChecks
    .filter((check) => check.initialized && !check.paused && !check.recoveryMode && check.tokenSetMatches)
    .map((check) => check.pool)
  const tokenByAddress = new Map()
  for (const pool of eligiblePools) {
    for (const token of pool.tokens) tokenByAddress.set(addressKey(token.address), token)
  }

  const bases = [
    {
      symbol: 'WETH',
      address: WETH,
      decimals: 18,
      amounts: ['0.00005', '0.0001', '0.00025', '0.0005', '0.001', '0.0015', '0.002', '0.0025', '0.0032'],
    },
    { symbol: 'USDG', address: USDG, decimals: 6, amounts: ['1', '2.5', '5', '10', '15', '20', '25', '35'] },
  ]
  const wethPriceUsd = Number(
    apiPools.flatMap((pool) => pool.tokens).find((token) => addressKey(token.address) === addressKey(WETH))?.priceUsd ||
      0,
  )

  const approximations = []
  let routeSignatureCount = 0
  for (const base of bases) {
    const cycles = enumerateCycles(eligiblePools, base.address)
    routeSignatureCount += cycles.length
    for (const steps of cycles) {
      for (const amountText of base.amounts) {
        const amountIn = parseUnits(amountText, base.decimals)
        const amountOut = approximateCycle(base, steps, amountIn)
        if (amountOut === null) continue
        const gross = amountOut - amountIn
        const grossUsd = Number(formatUnits(gross, base.decimals)) * (base.symbol === 'WETH' ? wethPriceUsd : 1)
        approximations.push({ base, steps, amountIn, approximateAmountOut: amountOut, approximateGrossUsd: grossUsd })
      }
    }
  }
  approximations.sort((left, right) => right.approximateGrossUsd - left.approximateGrossUsd)
  const shortlist = approximations.slice(0, EXACT_QUERY_LIMIT)

  const exactResults = await mapWithConcurrency(shortlist, 6, async (candidate) => {
    try {
      const result = await client.readContract({
        address: BATCH_ROUTER,
        abi: batchRouterAbi,
        functionName: 'querySwapExactIn',
        args: [[asPath(candidate.base, candidate.steps, candidate.amountIn)], QUERY_SENDER, '0x'],
        blockNumber,
      })
      const amountOut = result[0][0]
      const gross = amountOut - candidate.amountIn
      const grossUsd =
        Number(formatUnits(gross, candidate.base.decimals)) * (candidate.base.symbol === 'WETH' ? wethPriceUsd : 1)
      return { ...candidate, amountOut, gross, grossUsd, queryError: null }
    } catch (error) {
      return {
        ...candidate,
        amountOut: null,
        gross: null,
        grossUsd: null,
        queryError: errorText(error),
      }
    }
  })
  const positiveGross = exactResults
    .filter((item) => item.gross > 0n)
    .sort((left, right) => right.grossUsd - left.grossUsd)
  const feeEstimate = await client.estimateFeesPerGas()
  const maxFeePerGas = feeEstimate.maxFeePerGas || feeEstimate.gasPrice

  const gasSamples = await mapWithConcurrency(
    positiveGross.filter((item) => item.base.symbol === 'WETH').slice(0, GAS_SAMPLE_LIMIT),
    3,
    async (candidate) => {
      try {
        const path = asPath(candidate.base, candidate.steps, candidate.amountIn, candidate.amountIn + 1n)
        const gas = await client.estimateContractGas({
          account: GAS_ACCOUNT,
          address: BATCH_ROUTER,
          abi: batchRouterAbi,
          functionName: 'swapExactIn',
          args: [[path], block.timestamp + 600n, true, '0x'],
          value: candidate.amountIn,
          blockNumber,
        })
        const bufferedGas = (gas * 115n + 99n) / 100n
        const swapGasCost = bufferedGas * maxFeePerGas
        return { candidate, gas, bufferedGas, swapGasCost, swapOnlyNet: candidate.gross - swapGasCost, gasError: null }
      } catch (error) {
        return {
          candidate,
          gas: null,
          bufferedGas: null,
          swapGasCost: null,
          swapOnlyNet: null,
          gasError: errorText(error),
        }
      }
    },
  )

  const renderCandidate = (candidate) => {
    const label = routeLabel(candidate.base, candidate.steps)
    return {
      base: candidate.base.symbol,
      amountIn: formatUnits(candidate.amountIn, candidate.base.decimals),
      amountOut: candidate.amountOut === null ? null : formatUnits(candidate.amountOut, candidate.base.decimals),
      gross: candidate.gross === null ? null : formatUnits(candidate.gross, candidate.base.decimals),
      grossUsd: candidate.grossUsd,
      symbols: label.symbols,
      pools: label.pools,
      poolAddresses: candidate.steps.map((step) => step.pool.address),
      tokenOutAddresses: candidate.steps.map((step) => step.tokenOut),
      queryError: candidate.queryError,
    }
  }

  console.log(
    stringify({
      observedAt: new Date().toISOString(),
      apiCalculatedAt: snapshot.calculatedAt,
      blockNumber,
      blockTimestamp: block.timestamp,
      wethPriceUsd,
      maxFeePerGas,
      apiPoolCount: snapshot.pools.length,
      apiPoolsAboveFloor: apiPools.length,
      eligiblePoolCount: eligiblePools.length,
      rejectedPools: poolChecks
        .filter((check) => !check.initialized || check.paused || check.recoveryMode || !check.tokenSetMatches)
        .map((check) => ({
          address: check.pool.address,
          name: check.pool.name,
          initialized: check.initialized,
          paused: check.paused,
          recoveryMode: check.recoveryMode,
          tokenSetMatches: check.tokenSetMatches,
          error: check.error,
        })),
      routeSignatureCount,
      amountSizedCandidateCount: approximations.length,
      exactQueryCount: exactResults.length,
      exactQueryErrors: exactResults.filter((item) => item.queryError).length,
      positiveGrossExactCount: positiveGross.length,
      topExact: positiveGross.slice(0, 20).map(renderCandidate),
      positiveAfterBufferedGasSampleCount: gasSamples.filter((sample) => sample.swapOnlyNet > 0n).length,
      gasSamples: gasSamples.map((sample) => ({
        ...renderCandidate(sample.candidate),
        gas: sample.gas,
        bufferedGas: sample.bufferedGas,
        swapGasCost: sample.swapGasCost === null ? null : formatUnits(sample.swapGasCost, 18),
        swapOnlyNet: sample.swapOnlyNet === null ? null : formatUnits(sample.swapOnlyNet, 18),
        gasError: sample.gasError,
      })),
    }),
  )
}

try {
  await main()
} catch (error) {
  console.error(stringify({ status: 'FAILED_CLOSED', error: errorText(error) }))
  process.exitCode = 1
}
