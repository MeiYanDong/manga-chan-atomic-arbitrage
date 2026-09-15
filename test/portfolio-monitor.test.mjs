import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { getAddress, parseEther } from 'viem'

import {
  BASE_PUBLIC_HEARTBEAT_MODE,
  MONITORED_ACCOUNTS,
  collectPortfolioSnapshot,
  readBasePublicHeartbeat,
} from '../src/portfolio-monitor.mjs'

const baseOperator = getAddress('0xb756c304B5411B6dC3e7A6CBCD512Fad8eB6Dca7')
const baseExecutor = getAddress('0x002ccD95D1304C6fB88f67183DC1e7d1b90A577F')
const robinhoodOperator = getAddress('0x77f771E83f118C32547A1291dda438a757B4b91B')
const robinhoodUsdg = getAddress('0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168')
const robinhoodWeth = getAddress('0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73')
const robinhoodUniversal = getAddress('0xC167e650e8E3279a61d0650d963F65F768B031dA')
const baseWeth = getAddress('0x4200000000000000000000000000000000000006')

function keyed(entries) {
  return new Map(entries.map(([key, value]) => [key.toLowerCase(), value]))
}

function mockClient({ native = [], tokens = [], operators = [], failBalanceFor = null, failTokenFor = null }) {
  const nativeBalances = keyed(native)
  const tokenBalances = new Map(tokens.map(([token, account, value]) => [`${token}:${account}`.toLowerCase(), value]))
  const operatorByContract = keyed(operators)
  return {
    async getBlockNumber() {
      return 12345678n
    },
    async getBalance({ address }) {
      if (address.toLowerCase() === failBalanceFor?.toLowerCase()) throw new Error('bounded mock failure')
      return nativeBalances.get(address.toLowerCase()) ?? 0n
    },
    async getCode({ address }) {
      const account = MONITORED_ACCOUNTS.find((item) => item.address === address)
      return account?.kind === 'CONTRACT' ? '0x60016000' : undefined
    },
    async getTransactionCount() {
      return 2
    },
    async readContract({ address, functionName, args }) {
      if (functionName === 'operator') return operatorByContract.get(address.toLowerCase())
      if (functionName === 'balanceOf') {
        if (args[0].toLowerCase() === failTokenFor?.toLowerCase()) throw new Error('bounded mock token failure')
        return tokenBalances.get(`${address}:${args[0]}`.toLowerCase()) ?? 0n
      }
      throw new Error('unexpected mock contract call')
    },
  }
}

function fixtureClients({ failTokenFor = null } = {}) {
  const robinhoodContracts = MONITORED_ACCOUNTS.filter(
    (account) => account.networkId === 'ROBINHOOD' && account.kind === 'CONTRACT',
  )
  return {
    BASE: mockClient({
      native: [[baseOperator, parseEther('0.006987074636027231')]],
      tokens: [[baseWeth, baseExecutor, parseEther('0.003')]],
      operators: [[baseExecutor, baseOperator]],
    }),
    ROBINHOOD: mockClient({
      native: [[robinhoodOperator, parseEther('0.00262778655474')]],
      tokens: [
        [robinhoodUsdg, getAddress('0x3f3A60A2da9E8D9811F41c6093280D7a90685aDD'), 35_344_393n],
        [robinhoodWeth, getAddress('0xeC6BB0511Eb7a348ad1879535F66320a51a3eDfc'), parseEther('0.0032')],
        [robinhoodWeth, robinhoodUniversal, parseEther('0.0004')],
        [robinhoodUsdg, getAddress('0x725B7B29679dF1de5A89B2A48CA7CED178bfa506'), 10_045_402n],
        [robinhoodUsdg, getAddress('0x5eA86EAFB0F918557E1cE76E68F407568Dc2bCcd'), 5_631_216n],
      ],
      operators: robinhoodContracts.map((account) => [account.address, robinhoodOperator]),
      failTokenFor,
    }),
  }
}

function baseHeartbeat() {
  return {
    schemaVersion: 2,
    mode: BASE_PUBLIC_HEARTBEAT_MODE,
    generatedAt: '2026-09-11T15:00:00.000Z',
    runtimeStatus: 'RUNNING',
    operator: baseOperator,
    executor: baseExecutor,
    routesChecked: 350,
    positiveGrossCandidates: 2,
    bestGrossProfitEth: '0.0000003',
    fullLiveGateCandidates: 0,
    primaryBlockReason: '毛利低于合约利润底线',
    broadcastAttempted: false,
    confirmedProfitTransactions: 0,
    confirmedRevertedTransactions: 0,
    verifiedNetEth: '0',
    failedGasEth: '0',
    latestObservedBlock: '12345678',
  }
}

test('tracks six active and two parked accounts without hiding universal or parked capital', async () => {
  const snapshot = await collectPortfolioSnapshot({
    clients: fixtureClients(),
    now: new Date('2026-09-11T15:01:00.000Z'),
    robinhoodServiceStatus: 'RUNNING',
    baseUnitStatus: 'RUNNING',
    baseHeartbeat: baseHeartbeat(),
  })

  assert.equal(snapshot.status, 'VERIFIED')
  assert.deepEqual(snapshot.summary, {
    watchedObjects: 8,
    activeObjects: 6,
    parkedObjects: 2,
    parkedUsdg: '15.676618',
  })
  assert.equal(snapshot.networks.find((network) => network.id === 'ROBINHOOD').all.USDG, '51.021011')
  assert.equal(snapshot.networks.find((network) => network.id === 'ROBINHOOD').all.WETH, '0.0036')
  assert.equal(snapshot.accounts.find((account) => account.id === 'robinhood-universal-executor').status, 'VERIFIED')
  assert.equal(snapshot.networks.find((network) => network.id === 'BASE').all.WETH, '0.003')
  assert.equal(snapshot.services.find((service) => service.id === 'base-live').routesChecked, 350)
  assert.equal(snapshot.services.find((service) => service.id === 'base-live').positiveGrossCandidates, 2)
  assert.equal(snapshot.services.find((service) => service.id === 'base-live').fullLiveGateCandidates, 0)
  assert.equal(
    snapshot.services.find((service) => service.id === 'base-live').primaryBlockReason,
    '毛利低于合约利润底线',
  )
  assert.equal(JSON.stringify(snapshot).includes('expectedOperator'), false)
})

test('keeps partial chain reads explicit instead of publishing a false complete total', async () => {
  const failedAccount = MONITORED_ACCOUNTS.find((account) => account.id === 'robinhood-legacy-manga')
  const clients = fixtureClients({ failTokenFor: failedAccount.address })
  const snapshot = await collectPortfolioSnapshot({
    clients,
    now: new Date('2026-09-11T15:01:00.000Z'),
    robinhoodServiceStatus: 'RUNNING',
    baseUnitStatus: 'RUNNING',
    baseHeartbeat: baseHeartbeat(),
  })

  assert.equal(snapshot.status, 'PARTIAL')
  assert.equal(snapshot.summary.parkedUsdg, null)
  assert.equal(snapshot.accounts.find((account) => account.id === failedAccount.id).status, 'PARTIAL')
})

test('accepts only fresh non-writable sanitized Base heartbeat files', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'manga-base-heartbeat-'))
  const file = path.join(directory, 'heartbeat.json')
  try {
    fs.writeFileSync(file, JSON.stringify(baseHeartbeat()), { mode: 0o640 })
    fs.chmodSync(file, 0o640)
    assert.equal(
      readBasePublicHeartbeat(file, { now: Date.parse('2026-09-11T15:01:00.000Z') }).runtimeStatus,
      'RUNNING',
    )
    assert.throws(() => readBasePublicHeartbeat(file, { now: Date.parse('2026-09-11T15:04:00.001Z') }), /stale/)
    fs.writeFileSync(file, JSON.stringify({ ...baseHeartbeat(), note: 'not allowlisted' }), { mode: 0o640 })
    assert.throws(() => readBasePublicHeartbeat(file), /identity is invalid/)
    fs.writeFileSync(file, JSON.stringify(baseHeartbeat()), { mode: 0o640 })
    fs.chmodSync(file, 0o660)
    assert.throws(() => readBasePublicHeartbeat(file), /must not be writable/)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
