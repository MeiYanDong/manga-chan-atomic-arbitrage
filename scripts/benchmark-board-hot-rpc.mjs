import fs from 'node:fs'
import path from 'node:path'
import { createPublicClient, defineChain, getAddress, http } from 'viem'
import { CandidateWakePriority, candidateWakePriority } from '../src/opportunity-board.mjs'
import { isExecutorPoolKeyShape, PoolAdmission, ROBINHOOD_CHAIN_ID, V4_QUOTER } from '../src/pair-catalog.mjs'

const publicRpcUrl = process.env.MANGA_BOARD_RPC_URL || null
const managedRpcUrl = process.env.MANGA_BOARD_HOT_RPC_URL || null
if (!publicRpcUrl || !managedRpcUrl) {
  throw new Error('board public and managed RPC endpoints are required')
}

const samples = Number(process.env.MANGA_BENCHMARK_SAMPLES || 10)
if (!Number.isSafeInteger(samples) || samples < 5 || samples > 20) {
  throw new Error('MANGA_BENCHMARK_SAMPLES must be 5..20')
}
const runDir = path.resolve(process.env.MANGA_BOARD_RUN_DIR || path.join(process.cwd(), 'runs', 'opportunity-board'))
const snapshotPath = path.resolve(process.env.MANGA_BOARD_SNAPSHOT || path.join(runDir, 'snapshot.json'))
const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'))

const candidates = (snapshot.items || [])
  .filter((candidate) => candidateWakePriority(candidate) >= CandidateWakePriority.EXECUTOR_SHAPE)
  .sort((left, right) => candidateWakePriority(right) - candidateWakePriority(left))
const candidate = candidates.find((item) => (item.pools || []).some(isExecutorPoolKeyShape))
const pool =
  candidate?.pools?.find((item) => item.executionAdmission === PoolAdmission.EXECUTOR_COMPATIBLE) ||
  candidate?.pools?.find(isExecutorPoolKeyShape)
if (!candidate || !pool) throw new Error('no executor-shaped pool is available for a read-only Quoter benchmark')

const chain = defineChain({
  id: ROBINHOOD_CHAIN_ID,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [publicRpcUrl] } },
})
const makeClient = (rpcUrl) =>
  createPublicClient({ chain, transport: http(rpcUrl, { timeout: 15_000, retryCount: 0 }) })
const clients = {
  public: makeClient(publicRpcUrl),
  managed: makeClient(managedRpcUrl),
}
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

const tokenAddress = getAddress(candidate.tokenAddress)
const quoteAddress = getAddress(pool.quoteAddress)
const currency0 = BigInt(tokenAddress) < BigInt(quoteAddress) ? tokenAddress : quoteAddress
const currency1 = currency0 === tokenAddress ? quoteAddress : tokenAddress
const exactAmount = 10n ** BigInt(Number(pool.quoteDecimals ?? 18))

function percentile(values, quantile) {
  if (values.length === 0) return null
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)]
}

async function measure(label, client, blockNumber) {
  const latencyMs = []
  const outputs = []
  let failures = 0
  for (let index = 0; index < samples; index += 1) {
    const startedAt = performance.now()
    try {
      const { result } = await client.simulateContract({
        account: '0x0000000000000000000000000000000000000000',
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
            zeroForOne: quoteAddress.toLowerCase() === currency0.toLowerCase(),
            exactAmount,
            hookData: '0x',
          },
        ],
        blockNumber,
      })
      latencyMs.push(performance.now() - startedAt)
      outputs.push(result[0].toString())
    } catch {
      failures += 1
    }
  }
  return {
    label,
    samples,
    successes: latencyMs.length,
    failures,
    p50Ms: percentile(latencyMs, 0.5)?.toFixed(2) || null,
    p95Ms: percentile(latencyMs, 0.95)?.toFixed(2) || null,
    p99Ms: percentile(latencyMs, 0.99)?.toFixed(2) || null,
    maxMs: latencyMs.length > 0 ? Math.max(...latencyMs).toFixed(2) : null,
    outputConsensus: new Set(outputs).size <= 1,
    output: outputs[0] || null,
  }
}

const [publicChainId, managedChainId, publicHead, managedHead] = await Promise.all([
  clients.public.getChainId(),
  clients.managed.getChainId(),
  clients.public.getBlockNumber({ cacheTime: 0 }),
  clients.managed.getBlockNumber({ cacheTime: 0 }),
])
if (publicChainId !== ROBINHOOD_CHAIN_ID || managedChainId !== ROBINHOOD_CHAIN_ID) {
  throw new Error('board RPC benchmark observed the wrong chain id')
}
const minimumHead = publicHead < managedHead ? publicHead : managedHead
const blockNumber = minimumHead > 0n ? minimumHead - 1n : minimumHead
const [publicBlock, managedBlock] = await Promise.all([
  clients.public.getBlock({ blockNumber }),
  clients.managed.getBlock({ blockNumber }),
])
if (publicBlock.hash !== managedBlock.hash) throw new Error('board RPC benchmark observed different fixed-block hashes')

const [publicResult, managedResult] = await Promise.all([
  measure('PUBLIC_FIXED_BLOCK_V4_QUOTER', clients.public, blockNumber),
  measure('MANAGED_FIXED_BLOCK_V4_QUOTER', clients.managed, blockNumber),
])
const matchingOutput =
  publicResult.output !== null && managedResult.output !== null && publicResult.output === managedResult.output
const passed =
  publicResult.failures === 0 &&
  managedResult.failures === 0 &&
  publicResult.outputConsensus &&
  managedResult.outputConsensus &&
  matchingOutput

console.log(
  JSON.stringify(
    {
      status: passed ? 'FIXED_BLOCK_QUOTER_BENCHMARK_PASSED' : 'FIXED_BLOCK_QUOTER_BENCHMARK_FAILED',
      measuredAt: new Date().toISOString(),
      vantage: process.env.MANGA_BENCHMARK_VANTAGE || 'unspecified',
      managedProviderLabel: process.env.MANGA_BOARD_HOT_PROVIDER_LABEL || 'managed-event-hot',
      candidate: candidate.symbol,
      priority: candidateWakePriority(candidate),
      blockNumber: blockNumber.toString(),
      headDistance: (publicHead > managedHead ? publicHead - managedHead : managedHead - publicHead).toString(),
      matchingOutput,
      logicalCalls: 6 + samples * 2,
      transports: [publicResult, managedResult].map(({ output: _output, ...result }) => result),
    },
    null,
    2,
  ),
)
if (!passed) process.exitCode = 1
