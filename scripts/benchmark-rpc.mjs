import { createPublicClient, defineChain, http, webSocket } from 'viem'
import { assertLiveTransport, loadRuntimeConfig } from '../src/config.mjs'

const config = loadRuntimeConfig()
assertLiveTransport(config, { requireWss: true })

const chain = defineChain({
  id: 4663,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [config.rpcUrl] } },
})
const httpClient = createPublicClient({ chain, transport: http(config.rpcUrl, { timeout: 10_000, retryCount: 0 }) })
const wsClient = createPublicClient({
  chain,
  transport: webSocket(config.wsUrl, { timeout: 10_000, retryCount: 0, keepAlive: false, reconnect: false }),
})
const samples = Number(process.env.MANGA_BENCHMARK_SAMPLES || 40)
if (!Number.isSafeInteger(samples) || samples < 10 || samples > 500)
  throw new Error('MANGA_BENCHMARK_SAMPLES must be 10..500')

function percentile(values, quantile) {
  if (values.length === 0) return null
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)]
}

async function measure(label, operation) {
  const latencyMs = []
  const failures = []
  let lastHead = null
  for (let index = 0; index < samples; index += 1) {
    const started = performance.now()
    try {
      lastHead = await operation()
      latencyMs.push(performance.now() - started)
    } catch (error) {
      failures.push(error?.shortMessage || error?.message || 'UNKNOWN')
    }
  }
  return {
    label,
    samples,
    success: latencyMs.length,
    failures: failures.length,
    p50Ms: percentile(latencyMs, 0.5)?.toFixed(2) || null,
    p95Ms: percentile(latencyMs, 0.95)?.toFixed(2) || null,
    p99Ms: percentile(latencyMs, 0.99)?.toFixed(2) || null,
    maxMs: latencyMs.length > 0 ? Math.max(...latencyMs).toFixed(2) : null,
    lastHead: lastHead?.toString() || null,
    failureClasses: [...new Set(failures.map((message) => message.split('\n')[0].slice(0, 120)))],
  }
}

async function closeWs() {
  try {
    const rpcClient = await wsClient.transport.getRpcClient()
    rpcClient.close()
  } catch {}
}

try {
  const [httpResult, wsResult] = await Promise.all([
    measure('HTTP_eth_blockNumber', () => httpClient.getBlockNumber({ cacheTime: 0 })),
    measure('WSS_eth_blockNumber', () => wsClient.getBlockNumber({ cacheTime: 0 })),
  ])
  const headDistance =
    httpResult.lastHead && wsResult.lastHead
      ? (BigInt(httpResult.lastHead) > BigInt(wsResult.lastHead)
          ? BigInt(httpResult.lastHead) - BigInt(wsResult.lastHead)
          : BigInt(wsResult.lastHead) - BigInt(httpResult.lastHead)
        ).toString()
      : null
  console.log(
    JSON.stringify(
      {
        status: httpResult.failures === 0 && wsResult.failures === 0 ? 'BENCHMARK_COMPLETE' : 'BENCHMARK_WITH_FAILURES',
        providerLabel: config.providerLabel,
        vantage: process.env.MANGA_BENCHMARK_VANTAGE || 'unspecified',
        measuredAt: new Date().toISOString(),
        headDistance,
        transports: [httpResult, wsResult],
      },
      null,
      2,
    ),
  )
} finally {
  await closeWs()
}
