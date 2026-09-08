import assert from 'node:assert/strict'
import test from 'node:test'
import { deriveExecutionEconomics, deriveWethExecutionEconomics } from '../src/execution-economics.mjs'

const base = {
  simulatedGrossProfit: 1_000_000n,
  estimatedGas: 500_000n,
  gasPriceWei: 400_000_000n,
  nativeMarkInWei: 1_000_000_000_000_000n,
  nativeMarkOutUsdg: 2_500_000n,
  minimumGrossProfit: 50_000n,
  minimumNetProfit: 100_000n,
  profitRetentionBps: 9_000n,
}

test('execution economics binds gross retention, exact gas and worst-case net profit', () => {
  const result = deriveExecutionEconomics(base)
  assert.equal(result.estimatedGasCostUsdg, 500_000n)
  assert.equal(result.expectedNetProfitUsdg, 500_000n)
  assert.equal(result.minimumProfit, 900_000n)
  assert.equal(result.gasLimit, 555_000n)
  assert.ok(result.maxFeePerGas >= base.gasPriceWei)
  assert.ok(result.minimumProfit >= result.maximumGasCostUsdg + base.minimumNetProfit)
})

test('execution economics fails closed when exact gas consumes the edge', () => {
  assert.throws(
    () => deriveExecutionEconomics({ ...base, simulatedGrossProfit: 550_000n, minimumNetProfit: 100_001n }),
    /net floor/,
  )
  assert.throws(() => deriveExecutionEconomics({ ...base, profitRetentionBps: 10_001n }), /invalid/)
})

test('WETH execution economics protects net profit in the same unit as native Gas', () => {
  const economics = deriveWethExecutionEconomics({
    simulatedGrossProfit: 500_000_000_000_000n,
    estimatedGas: 200_000n,
    gasPriceWei: 1_000_000_000n,
    minimumGrossProfit: 10_000_000_000_000n,
    minimumNetProfit: 100_000_000_000_000n,
    profitRetentionBps: 9_000n,
  })

  assert.equal(economics.estimatedGasCostWei, 200_000_000_000_000n)
  assert.equal(economics.expectedNetProfitWei, 300_000_000_000_000n)
  assert.equal(economics.minimumProfit, 450_000_000_000_000n)
  assert.ok(economics.minimumProfit >= economics.maximumGasCostWei + 100_000_000_000_000n)
})

test('WETH execution economics rejects a gross edge that cannot pay Gas and the net floor', () => {
  assert.throws(
    () =>
      deriveWethExecutionEconomics({
        simulatedGrossProfit: 250_000_000_000_000n,
        estimatedGas: 200_000n,
        gasPriceWei: 1_000_000_000n,
        minimumGrossProfit: 10_000_000_000_000n,
        minimumNetProfit: 100_000_000_000_000n,
        profitRetentionBps: 9_500n,
      }),
    /net floor/,
  )
})
