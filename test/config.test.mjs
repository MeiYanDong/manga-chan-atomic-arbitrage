import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { assertLiveTransport, loadRuntimeConfig, readConfigFile } from '../src/config.mjs'

test('strategy config reads only explicit MANGA keys', (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'manga-config-'))
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const file = path.join(directory, 'live.env')
  fs.writeFileSync(
    file,
    [
      'MANGA_RPC_URL=https://primary.invalid',
      'MANGA_WS_URL=wss://primary.invalid',
      'MANGA_ALLOW_PUBLIC_EXECUTION_RPC=0',
      'RH_RPC_URL=https://must-not-be-read.invalid',
      'MANGA_MAX_ATTEMPTS=3',
      'MANGA_GENERIC_BOARD_URL=http://127.0.0.1:8788/api/snapshot',
      'MANGA_GENERIC_MIN_NET_USDG=0.2',
      'MANGA_GENERIC_PROFIT_RETENTION_BPS=9400',
      'MANGA_GENERIC_WATCH_POLL_MS=750',
      'MANGA_GENERIC_WATCH_ARM_HOURS=168',
      'MANGA_GENERIC_WATCH_AUTO_RENEW=1',
      'MANGA_GENERIC_WATCH_UNTIL_REVOKED=0',
      'MANGA_GENERIC_WATCH_RENEW_BEFORE_HOURS=24',
      'MANGA_GENERIC_WATCH_MAX_ATTEMPTS=unlimited',
      'MANGA_GENERIC_WATCH_MAX_EXECUTIONS=unlimited',
      'MANGA_GENERIC_WATCH_MAX_PREFLIGHTS=unlimited',
      'MANGA_GENERIC_WATCH_MIN_SCREENED_NET_USDG=0.25',
      'MANGA_WETH_SEED_ETH=0.001',
      'MANGA_WETH_MAX_AMOUNT_WETH=0.5',
      'MANGA_WETH_MIN_GROSS_PROFIT_WETH=0.000002',
      'EARN_LIVE_AMOUNT_CANDIDATES=0.0004,0.0008',
      'EARN_LIVE_MIN_NET_WETH=0.00003',
      'EARN_LIVE_MIN_HEADROOM_WETH=0.00002',
      'EARN_LIVE_MAX_FAILED_GAS_WETH=0.0001',
      'EARN_LIVE_WALLET_RESERVE_WETH=0.0003',
    ].join('\n'),
    { mode: 0o600 },
  )
  const parsed = readConfigFile(file)
  assert.equal(parsed.RH_RPC_URL, undefined)
  const config = loadRuntimeConfig({ MANGA_CONFIG_FILE: file })
  assert.equal(config.rpcUrl, 'https://primary.invalid')
  assert.equal(config.wsUrl, 'wss://primary.invalid')
  assert.equal(config.allowPublicExecutionRpc, false)
  assert.equal(config.maxAttempts, 3)
  assert.equal(config.genericMinNetUsdg, '0.2')
  assert.equal(config.genericProfitRetentionBps, 9_400)
  assert.equal(config.genericPreflightCandidates, 6)
  assert.equal(config.genericWatchPollMs, 750)
  assert.equal(config.genericWatchArmHours, 168)
  assert.equal(config.genericWatchAutoRenew, true)
  assert.equal(config.genericWatchUntilRevoked, false)
  assert.equal(config.genericWatchRenewBeforeHours, 24)
  assert.equal(config.genericWatchMaxAttempts, null)
  assert.equal(config.genericWatchMaxExecutions, null)
  assert.equal(config.genericWatchMaxPreflights, null)
  assert.equal(config.genericWatchMinScreenedNetUsdg, '0.25')
  assert.equal(config.wethSeedEth, '0.001')
  assert.equal(config.wethMaxAmountWeth, '0.5')
  assert.equal(config.wethMinGrossProfitWeth, '0.000002')
  assert.equal(config.earnLiveAmountCandidates, '0.0004,0.0008')
  assert.equal(config.earnLiveMinNetWeth, '0.00003')
  assert.equal(config.earnLiveMinHeadroomWeth, '0.00002')
  assert.equal(config.earnLiveMaxFailedGasWeth, '0.0001')
  assert.equal(config.earnLiveWalletReserveWeth, '0.0003')
  assert.doesNotThrow(() => assertLiveTransport(config, { requireWss: true }))
})

test('live watch refuses public fallback and silent polling-only mode', () => {
  const missing = loadRuntimeConfig({ MANGA_CONFIG_FILE: '/definitely/missing' })
  assert.throws(() => assertLiveTransport(missing), /MANGA_RPC_URL/)
  assert.throws(
    () => assertLiveTransport({ ...missing, rpcUrl: 'https://primary.invalid' }, { requireWss: true }),
    /MANGA_WS_URL/,
  )
  assert.throws(
    () =>
      assertLiveTransport({
        ...missing,
        rpcUrl: 'https://rpc.mainnet.chain.robinhood.com',
      }),
    /公共 RPC.*只读观察板/,
  )
  assert.doesNotThrow(() =>
    assertLiveTransport({
      ...missing,
      rpcUrl: 'https://rpc.mainnet.chain.robinhood.com',
      allowPublicExecutionRpc: true,
    }),
  )
  assert.throws(() => loadRuntimeConfig({ MANGA_ALLOW_PUBLIC_EXECUTION_RPC: 'yes' }), /0 或 1/)
})

test('generic exact-preflight candidate count is bounded at configuration load', () => {
  const finite = loadRuntimeConfig({
    MANGA_CONFIG_FILE: '/definitely/missing',
    MANGA_MAX_ATTEMPTS: '7',
  })
  assert.equal(finite.genericWatchMaxAttempts, 7)
  assert.throws(() => loadRuntimeConfig({ MANGA_GENERIC_PREFLIGHT_CANDIDATES: '33' }), /1\.\.32/)
  assert.throws(() => loadRuntimeConfig({ MANGA_GENERIC_WATCH_POLL_MS: '100' }), /250\.\.60000/)
  assert.throws(() => loadRuntimeConfig({ MANGA_GENERIC_WATCH_MAX_EXECUTIONS: '21' }), /1\.\.20/)
  assert.throws(() => loadRuntimeConfig({ MANGA_GENERIC_WATCH_MAX_ATTEMPTS: '0' }), /正整数/)
  assert.throws(() => loadRuntimeConfig({ MANGA_GENERIC_WATCH_MAX_PREFLIGHTS: '0' }), /正整数/)
  assert.throws(() => loadRuntimeConfig({ MANGA_GENERIC_WATCH_AUTO_RENEW: 'yes' }), /0 或 1/)
  assert.throws(() => loadRuntimeConfig({ MANGA_GENERIC_WATCH_UNTIL_REVOKED: 'yes' }), /0 或 1/)
  assert.throws(
    () =>
      loadRuntimeConfig({
        MANGA_GENERIC_WATCH_AUTO_RENEW: '1',
        MANGA_GENERIC_WATCH_UNTIL_REVOKED: '1',
      }),
    /不能同时启用/,
  )
  assert.throws(
    () =>
      loadRuntimeConfig({
        MANGA_GENERIC_WATCH_ARM_HOURS: '24',
        MANGA_GENERIC_WATCH_AUTO_RENEW: '1',
        MANGA_GENERIC_WATCH_RENEW_BEFORE_HOURS: '24',
      }),
    /必须小于/,
  )
})
