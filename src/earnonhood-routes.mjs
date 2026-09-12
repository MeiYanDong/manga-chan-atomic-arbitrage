import { getAddress, keccak256, toHex } from 'viem'
import { stableStringify } from './journal.mjs'

export const EARN_VAULT = getAddress('0x28082618Ba2073E602230188E4F4C46e9b2169EB')
export const EARN_BATCH_ROUTER = getAddress('0x2d6DD5A990a643A8B11CD06554FBC290a1a82bA6')
export const EARN_WETH = getAddress('0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73')
export const EARN_AI = getAddress('0x2E8c31162b855A2ffa90F6F8634643Ad6F111e18')
export const EARN_MOO = getAddress('0xD9dB30BB0D2b8d2eae3826A1372117E058791e18')

export const EARN_HOOD_ECOSYSTEM_POOL = getAddress('0x4188656eAFdD7634d35Ca3f98ddfBf4b403A41fA')
export const EARN_STOCK_MEMES_POOL = getAddress('0x00e7B76d0C0F0370C28A07aA9d9fDF92736238A6')
export const EARN_LONG_ECO_POOL = getAddress('0xcDe242535A75F8ccB5D4b14686e312c196B28855')

export const EARN_ROUTES = [
  {
    id: 'WETH_AI_WETH_STOCK_LONG',
    symbols: ['WETH', 'AI', 'WETH'],
    steps: [
      { pool: EARN_STOCK_MEMES_POOL, tokenIn: EARN_WETH, tokenOut: EARN_AI },
      { pool: EARN_LONG_ECO_POOL, tokenIn: EARN_AI, tokenOut: EARN_WETH },
    ],
  },
  {
    id: 'WETH_AI_WETH_LONG_STOCK',
    symbols: ['WETH', 'AI', 'WETH'],
    steps: [
      { pool: EARN_LONG_ECO_POOL, tokenIn: EARN_WETH, tokenOut: EARN_AI },
      { pool: EARN_STOCK_MEMES_POOL, tokenIn: EARN_AI, tokenOut: EARN_WETH },
    ],
  },
  {
    id: 'WETH_AI_MOO_WETH',
    symbols: ['WETH', 'AI', 'MOO', 'WETH'],
    steps: [
      { pool: EARN_HOOD_ECOSYSTEM_POOL, tokenIn: EARN_WETH, tokenOut: EARN_AI },
      { pool: EARN_STOCK_MEMES_POOL, tokenIn: EARN_AI, tokenOut: EARN_MOO },
      { pool: EARN_LONG_ECO_POOL, tokenIn: EARN_MOO, tokenOut: EARN_WETH },
    ],
  },
  {
    id: 'WETH_MOO_AI_WETH',
    symbols: ['WETH', 'MOO', 'AI', 'WETH'],
    steps: [
      { pool: EARN_LONG_ECO_POOL, tokenIn: EARN_WETH, tokenOut: EARN_MOO },
      { pool: EARN_STOCK_MEMES_POOL, tokenIn: EARN_MOO, tokenOut: EARN_AI },
      { pool: EARN_HOOD_ECOSYSTEM_POOL, tokenIn: EARN_AI, tokenOut: EARN_WETH },
    ],
  },
]

export const EARN_ROUTE_STEPS = [
  ...new Map(
    EARN_ROUTES.flatMap((route) => route.steps).map((step) => [
      `${step.pool.toLowerCase()}:${step.tokenIn.toLowerCase()}:${step.tokenOut.toLowerCase()}`,
      step,
    ]),
  ).values(),
]
export const EARN_POOL_ADDRESSES = [
  ...new Map(EARN_ROUTE_STEPS.map((step) => [step.pool.toLowerCase(), step.pool])).values(),
]
export const EARN_ROUTE_COMMITMENT = keccak256(
  toHex(
    stableStringify({
      vault: EARN_VAULT,
      batchRouter: EARN_BATCH_ROUTER,
      routes: EARN_ROUTES,
    }),
  ),
)

// Balancer-v3 Vault event used only as a wake signal. Exact quotes and the
// final protected call remain the economic source of truth.
export const EARN_SWAP_EVENT_SIGNATURE = 'Swap(address,address,address,uint256,uint256,uint256,uint256)'
export const EARN_SWAP_EVENT_TOPIC = keccak256(toHex(EARN_SWAP_EVENT_SIGNATURE))

/** @param {string | undefined} topic */
export function earnPoolFromTopic(topic) {
  if (typeof topic !== 'string' || !/^0x[0-9a-f]{64}$/i.test(topic)) return null
  try {
    return getAddress(`0x${topic.slice(-40)}`)
  } catch {
    return null
  }
}

/** @param {{topics?: readonly string[]}} log */
export function isEarnOnHoodRouteSwap(log) {
  if (log.topics?.[0]?.toLowerCase() !== EARN_SWAP_EVENT_TOPIC.toLowerCase()) return false
  const pool = earnPoolFromTopic(log.topics?.[1])
  return pool ? EARN_POOL_ADDRESSES.some((address) => address.toLowerCase() === pool.toLowerCase()) : false
}
