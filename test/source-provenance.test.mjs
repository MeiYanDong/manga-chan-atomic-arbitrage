import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  AssetClass,
  AttributionStatus,
  ContractRole,
  PlatformId,
  ProtocolId,
  SOURCE_CONTRACT_REGISTRY,
  VenueId,
  buildSourceAwareOpportunity,
} from '../src/source-provenance.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const fixture = JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'ninecat-source.json'), 'utf8'))
const cloneFixture = () => JSON.parse(JSON.stringify(fixture))

test('NINECAT resolves to LONG route, Doppler and Uniswap v4 without inventing a front-end', () => {
  const result = buildSourceAwareOpportunity(fixture)
  assert.equal(result.schemaVersion, 4)
  assert.equal(result.provenance.platformAttribution.platformId, PlatformId.LONG_ROUTE)
  assert.equal(result.provenance.platformAttribution.status, AttributionStatus.CHAIN_ATTESTED)
  assert.equal(result.provenance.launchFrontend.value, null)
  assert.equal(result.provenance.launchFrontend.status, AttributionStatus.UNKNOWN)
  assert.equal(result.provenance.launchProtocol.protocolId, ProtocolId.DOPPLER)
  assert.equal(result.provenance.launchProtocol.status, AttributionStatus.CHAIN_ATTESTED)
  assert.equal(result.route.liquidityVenues[0].protocolId, VenueId.UNISWAP_V4)
  assert.equal(result.target.classification.value, AssetClass.CUSTOM_TOKEN)
  assert.equal(result.quoteAsset.classification.value, AssetClass.CUSTOM_TOKEN)
  assert.equal(result.pairClass, 'CUSTOM_TOKEN/CUSTOM_TOKEN')
  assert.equal(result.quote.state, 'UNQUOTED')
  assert.equal(result.execution.state, 'NONE')
})

test('a PAIR listing remains listing evidence and cannot overwrite NINECAT platform attribution', () => {
  const input = cloneFixture()
  const evidenceId = 'pair-api:future-observation:ninecat'
  input.evidence.push({
    evidenceId,
    kind: 'SOURCE_RESPONSE',
    producer: 'PAIR_CATALOG_API',
    observedAt: '2026-09-08T00:00:00.000Z',
    chainId: 4663,
    status: 'OBSERVED',
    payload: { address: fixture.target.address, listed: true },
  })
  input.listings.push({
    adapterId: 'PAIR_CATALOG',
    platformId: PlatformId.PAIR,
    observedAt: '2026-09-08T00:00:00.000Z',
    evidenceIds: [evidenceId],
  })
  const result = buildSourceAwareOpportunity(input)
  assert.equal(result.provenance.listings[0].platformId, PlatformId.PAIR)
  assert.equal(result.provenance.platformAttribution.platformId, PlatformId.LONG_ROUTE)
})

test('shared Doppler contracts prove protocol but cannot identify a platform route', () => {
  const input = cloneFixture()
  input.launchObservations = []
  const result = buildSourceAwareOpportunity(input)
  assert.equal(result.provenance.platformAttribution.platformId, null)
  assert.equal(result.provenance.platformAttribution.status, AttributionStatus.UNKNOWN)
  assert.equal(result.provenance.launchProtocol.protocolId, ProtocolId.DOPPLER)
})

test('stock-looking symbols stay custom without an exact canonical address match', () => {
  const input = cloneFixture()
  input.target.symbol = 'NVDA'
  input.target.name = 'NVIDIA'
  const result = buildSourceAwareOpportunity(input)
  assert.equal(result.target.classification.value, AssetClass.CUSTOM_TOKEN)
})

test('unregistered launch entries remain visible as unattributed chain evidence', () => {
  const input = cloneFixture()
  input.launchObservations[0].entryContract = '0x1111111111111111111111111111111111111111'
  input.launchObservations[0].eventContract = '0x1111111111111111111111111111111111111111'
  const result = buildSourceAwareOpportunity(input)
  assert.equal(result.provenance.platformAttribution.platformId, PlatformId.UNATTRIBUTED_CHAIN)
  assert.equal(result.provenance.platformAttribution.status, AttributionStatus.UNKNOWN)
  assert.equal(result.admission.executionEligible, false)
})

test('registered addresses cannot attest a platform when the referenced payload does not bind the call and event', () => {
  const input = cloneFixture()
  const event = input.evidence.find((item) => item.evidenceId.endsWith(':87'))
  event.payload.address = '0x1111111111111111111111111111111111111111'
  const result = buildSourceAwareOpportunity(input)
  assert.equal(result.provenance.platformAttribution.platformId, PlatformId.UNATTRIBUTED_CHAIN)
  assert.equal(result.provenance.platformAttribution.status, AttributionStatus.UNKNOWN)
})

test('platform event topics are compared as case-insensitive hex', () => {
  const input = cloneFixture()
  input.launchObservations[0].eventTopic = input.launchObservations[0].eventTopic.toUpperCase()
  const result = buildSourceAwareOpportunity(input)
  assert.equal(result.provenance.platformAttribution.platformId, PlatformId.LONG_ROUTE)
  assert.equal(result.provenance.platformAttribution.status, AttributionStatus.CHAIN_ATTESTED)
})

test('asset classification rejects an address list that is not bound to registry evidence', () => {
  const input = cloneFixture()
  input.robinhoodAssetRegistry.addresses = ['0x1111111111111111111111111111111111111111']
  assert.throws(() => buildSourceAwareOpportunity(input), /do not match evidence payload/)
})

test('pool venue attribution requires evidence for the claimed manager and pool id', () => {
  const input = cloneFixture()
  const poolEvidence = input.evidence.find((item) => item.evidenceId.endsWith(':76'))
  poolEvidence.payload.poolId = `0x${'f'.repeat(64)}`
  const result = buildSourceAwareOpportunity(input)
  assert.equal(result.route.liquidityVenues[0].protocolId, VenueId.UNKNOWN)
  assert.equal(result.route.liquidityVenues[0].status, AttributionStatus.UNKNOWN)
})

test('conflicting unique platform entries fail closed', () => {
  const input = cloneFixture()
  const alternateTransactionHash = `0x${'4'.repeat(64)}`
  const alternateTransactionId = `rh:4663:tx:${alternateTransactionHash}`
  const alternateLogId = `rh:4663:log:${alternateTransactionHash}:1`
  input.evidence.push(
    {
      evidenceId: alternateTransactionId,
      kind: 'TRANSACTION',
      producer: 'ROBINHOOD_PUBLIC_RPC',
      observedAt: '2026-09-07T00:00:00.000Z',
      chainId: 4663,
      blockNumber: '45879015',
      blockHash: `0x${'5'.repeat(64)}`,
      transactionHash: alternateTransactionHash,
      status: 'OBSERVED',
      payload: { to: '0x3333333333333333333333333333333333333333' },
    },
    {
      evidenceId: alternateLogId,
      kind: 'RECEIPT_LOG',
      producer: 'ROBINHOOD_PUBLIC_RPC',
      observedAt: '2026-09-07T00:00:00.000Z',
      chainId: 4663,
      blockNumber: '45879015',
      blockHash: `0x${'5'.repeat(64)}`,
      transactionHash: alternateTransactionHash,
      status: 'OBSERVED',
      payload: {
        address: '0x3333333333333333333333333333333333333333',
        topic0: `0x${'3'.repeat(64)}`,
      },
    },
  )
  input.launchObservations.push({
    entryContract: '0x3333333333333333333333333333333333333333',
    eventContract: '0x3333333333333333333333333333333333333333',
    eventTopic: `0x${'3'.repeat(64)}`,
    evidenceIds: [alternateTransactionId, alternateLogId],
  })
  const registry = {
    ...SOURCE_CONTRACT_REGISTRY,
    entries: [
      ...SOURCE_CONTRACT_REGISTRY.entries,
      {
        registryId: 'test.other.unique-entry',
        address: '0x3333333333333333333333333333333333333333',
        role: ContractRole.UNIQUE_PLATFORM_ENTRY,
        platformId: PlatformId.PAIR,
        eventTopic: `0x${'3'.repeat(64)}`,
        validFromBlock: '0',
        validToBlock: null,
        evidencePath: 'test fixture',
      },
    ],
  }
  const result = buildSourceAwareOpportunity(input, { registry })
  assert.equal(result.provenance.platformAttribution.status, AttributionStatus.CONFLICTED)
  assert.equal(result.provenance.platformAttribution.platformId, null)
  assert.equal(result.admission.executionEligible, false)
  assert.equal(result.admission.reason, 'CONFLICTED_SOURCE_EVIDENCE')
})

test('the reference sale remains historical route evidence, not a current quote or execution', () => {
  const result = buildSourceAwareOpportunity(fixture)
  assert.equal(result.route.historicalReference.state, 'HISTORICAL_ROUTE_ONLY')
  assert.deepEqual(result.route.historicalReference.path, ['NINECAT', 'AI', 'ETH'])
  assert.deepEqual(result.route.historicalReference.poolIds, [
    '0xee0963d99bcafb54879728c57df60df3e652095d3bc24890004d06c87d3ccd26',
    '0x6d6fde80b9914214c7a4e7c22c5e28f9d18881d92dd275301bcd728d65465edd',
  ])
  assert.equal(result.quote.state, 'UNQUOTED')
  assert.equal(result.execution.state, 'NONE')
})
