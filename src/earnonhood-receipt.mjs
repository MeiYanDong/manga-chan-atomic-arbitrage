import { decodeEventLog } from 'viem'
import { EARN_VAULT } from './earnonhood-routes.mjs'

export const EARN_SWAP_ABI = [
  {
    type: 'event',
    name: 'Swap',
    inputs: [
      { name: 'pool', type: 'address', indexed: true },
      { name: 'tokenIn', type: 'address', indexed: true },
      { name: 'tokenOut', type: 'address', indexed: true },
      { name: 'amountIn', type: 'uint256', indexed: false },
      { name: 'amountOut', type: 'uint256', indexed: false },
      { name: 'swapFeePercentage', type: 'uint256', indexed: false },
      { name: 'swapFeeAmount', type: 'uint256', indexed: false },
    ],
  },
]

/**
 * @param {{logs: Array<Record<string, any>>}} receipt
 * @param {{steps: Array<{pool: string, tokenIn: string, tokenOut: string}>}} route
 * @param {bigint} amountIn
 */
export function decodeEarnOnHoodReceiptRoute(receipt, route, amountIn) {
  const swaps = receipt.logs
    .filter((log) => log.address.toLowerCase() === EARN_VAULT.toLowerCase())
    .map((log) => {
      try {
        const topics = /** @type {[`0x${string}`, ...`0x${string}`[]]} */ ([...log.topics])
        const decoded = decodeEventLog({ abi: EARN_SWAP_ABI, data: log.data, topics })
        return decoded.eventName === 'Swap' ? /** @type {Record<string, any>} */ (decoded.args) : null
      } catch {
        return null
      }
    })
    .filter(Boolean)
  if (swaps.length !== route.steps.length) throw new Error('receipt does not contain the exact reviewed Earn swap path')
  let expectedAmountIn = amountIn
  for (let index = 0; index < route.steps.length; index += 1) {
    const step = route.steps[index]
    const swap = swaps[index]
    const swapAmountIn = BigInt(swap.amountIn)
    const swapAmountOut = BigInt(swap.amountOut)
    if (
      swap.pool.toLowerCase() !== step.pool.toLowerCase() ||
      swap.tokenIn.toLowerCase() !== step.tokenIn.toLowerCase() ||
      swap.tokenOut.toLowerCase() !== step.tokenOut.toLowerCase() ||
      swapAmountIn !== expectedAmountIn ||
      swapAmountOut <= 0n
    ) {
      throw new Error('receipt Swap evidence differs from the reviewed Earn route')
    }
    expectedAmountIn = swapAmountOut
  }
  return { swaps, finalAmountOutWei: expectedAmountIn }
}
