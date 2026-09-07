import { createHash } from 'node:crypto'
import { getAddress } from 'viem'

export const SOURCE_SCHEMA_VERSION = 4
export const SOURCE_REGISTRY_VERSION = '2026-09-07.1'

export const AttributionStatus = Object.freeze({
  UNKNOWN: 'UNKNOWN',
  CHAIN_ATTESTED: 'CHAIN_ATTESTED',
  FIRST_PARTY_ATTESTED: 'FIRST_PARTY_ATTESTED',
  CORROBORATED: 'CORROBORATED',
  CONFLICTED: 'CONFLICTED',
})

export const PlatformId = Object.freeze({
  LONG_ROUTE: 'LONG_ROUTE',
  PAIR: 'PAIR',
  UNATTRIBUTED_CHAIN: 'UNATTRIBUTED_CHAIN',
})

export const ProtocolId = Object.freeze({
  DOPPLER: 'DOPPLER',
  UNKNOWN: 'UNKNOWN',
})

export const VenueId = Object.freeze({
  UNISWAP_V4: 'UNISWAP_V4',
  UNKNOWN: 'UNKNOWN',
})

export const AssetClass = Object.freeze({
  RH_STOCK_TOKEN: 'RH_STOCK_TOKEN',
  CUSTOM_TOKEN: 'CUSTOM_TOKEN',
  UNKNOWN: 'UNKNOWN',
})

export const EvidenceKind = Object.freeze({
  TRANSACTION: 'TRANSACTION',
  RECEIPT_LOG: 'RECEIPT_LOG',
  SOURCE_RESPONSE: 'SOURCE_RESPONSE',
  REGISTRY_SNAPSHOT: 'REGISTRY_SNAPSHOT',
})

export const ContractRole = Object.freeze({
  UNIQUE_PLATFORM_ENTRY: 'UNIQUE_PLATFORM_ENTRY',
  SHARED_PROTOCOL_ROOT: 'SHARED_PROTOCOL_ROOT',
  TOKEN_FACTORY: 'TOKEN_FACTORY',
  TOKEN_IMPLEMENTATION: 'TOKEN_IMPLEMENTATION',
  POOL_HOOK: 'POOL_HOOK',
  POOL_MANAGER: 'POOL_MANAGER',
  PLATFORM_LIQUIDITY_HOOK: 'PLATFORM_LIQUIDITY_HOOK',
})

const address = (value) => getAddress(value)

export const SOURCE_CONTRACT_REGISTRY = Object.freeze({
  version: SOURCE_REGISTRY_VERSION,
  chainId: 4663,
  entries: Object.freeze([
    Object.freeze({
      registryId: 'robinhood.long.launcher.v1',
      address: address('0x22e99278308b393ea1260859b181ad7e78f5eeed'),
      role: ContractRole.UNIQUE_PLATFORM_ENTRY,
      platformId: PlatformId.LONG_ROUTE,
      eventTopic: '0xadc6f1f726f7c710f77ec06adc75f3bb964e5be19581b072c67f7b9b4039267b',
      validFromBlock: '45879015',
      validToBlock: null,
      evidencePath: 'docs/evidence/2026-09-07-ninecat-source-attribution-correction.md',
    }),
    Object.freeze({
      registryId: 'robinhood.doppler.airlock',
      address: address('0xeb7c034704ef8dcd2d32324c1545f62fb4ad0862'),
      role: ContractRole.SHARED_PROTOCOL_ROOT,
      protocolId: ProtocolId.DOPPLER,
      validFromBlock: '0',
      validToBlock: null,
      evidencePath: 'docs/evidence/2026-09-07-ninecat-source-attribution-correction.md',
    }),
    Object.freeze({
      registryId: 'robinhood.doppler.erc20.factory.v1',
      address: address('0x1b37d3a72082029c44b35b604ea473617580b69a'),
      role: ContractRole.TOKEN_FACTORY,
      protocolId: ProtocolId.DOPPLER,
      validFromBlock: '0',
      validToBlock: null,
      evidencePath: 'docs/evidence/2026-09-07-ninecat-source-attribution-correction.md',
    }),
    Object.freeze({
      registryId: 'robinhood.doppler.erc20.implementation.v1',
      address: address('0x3be8b97fd0e713b5abe0649fa830223b6b4bc599'),
      role: ContractRole.TOKEN_IMPLEMENTATION,
      protocolId: ProtocolId.DOPPLER,
      validFromBlock: '0',
      validToBlock: null,
      evidencePath: 'docs/evidence/2026-09-07-ninecat-source-attribution-correction.md',
    }),
    Object.freeze({
      registryId: 'robinhood.doppler.hook.ninecat-observed',
      address: address('0x4e3468951d49f2eea976ed0d6e75ffcb44a9a544'),
      role: ContractRole.POOL_HOOK,
      protocolId: ProtocolId.DOPPLER,
      validFromBlock: '45879015',
      validToBlock: null,
      evidencePath: 'docs/evidence/2026-09-07-ninecat-source-attribution-correction.md',
    }),
    Object.freeze({
      registryId: 'robinhood.uniswap-v4.pool-manager',
      address: address('0x8366a39cc670b4001a1121b8f6a443a643e40951'),
      role: ContractRole.POOL_MANAGER,
      venueId: VenueId.UNISWAP_V4,
      validFromBlock: '0',
      validToBlock: null,
      evidencePath: 'src/pair-catalog.mjs',
    }),
    Object.freeze({
      registryId: 'robinhood.pair.hook.official',
      address: address('0x16D1560630Ce74af4478d9b8AD46548A092A2000'),
      role: ContractRole.PLATFORM_LIQUIDITY_HOOK,
      platformId: PlatformId.PAIR,
      validFromBlock: '0',
      validToBlock: null,
      evidencePath: 'src/pair-catalog.mjs',
    }),
    Object.freeze({
      registryId: 'robinhood.pair.hook.launch-v2-observed',
      address: address('0xD2F759A1Cf13c30127C551c3aEe04629Aea200c0'),
      role: ContractRole.PLATFORM_LIQUIDITY_HOOK,
      platformId: PlatformId.PAIR,
      validFromBlock: '0',
      validToBlock: null,
      evidencePath: 'src/pair-catalog.mjs',
    }),
  ]),
})

function stableValue(value) {
  if (Array.isArray(value)) return value.map((item) => stableValue(item))
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)]),
    )
  }
  return value
}

export function stablePayloadHash(payload) {
  return `sha256:${createHash('sha256')
    .update(JSON.stringify(stableValue(payload ?? null)))
    .digest('hex')}`
}

function normalizeOptionalAddress(value, field) {
  if (value === null || value === undefined) return null
  try {
    return address(value)
  } catch {
    throw new Error(`invalid ${field} address`)
  }
}

function normalizeOptionalHash(value, field) {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string' || !/^0x[0-9a-f]{64}$/i.test(value)) throw new Error(`invalid ${field} hash`)
  return value.toLowerCase()
}

function payloadAddress(payload, ...fields) {
  for (const field of fields) {
    const value = payload?.[field]
    if (!value) continue
    try {
      return address(value)
    } catch {
      return null
    }
  }
  return null
}

export function normalizeEvidenceEnvelope(envelope) {
  if (!envelope || typeof envelope !== 'object') throw new Error('evidence envelope must be an object')
  if (typeof envelope.evidenceId !== 'string' || envelope.evidenceId.length < 3) {
    throw new Error('evidenceId is required')
  }
  if (!Object.values(EvidenceKind).includes(envelope.kind))
    throw new Error(`unsupported evidence kind: ${envelope.kind}`)
  if (typeof envelope.producer !== 'string' || envelope.producer.length === 0)
    throw new Error('evidence producer is required')
  if (!Number.isFinite(Date.parse(envelope.observedAt))) throw new Error('evidence observedAt must be an ISO timestamp')
  if (!Number.isSafeInteger(envelope.chainId) || envelope.chainId <= 0) throw new Error('evidence chainId is required')
  const payloadHash = envelope.payloadHash || stablePayloadHash(envelope.payload)
  if (!/^sha256:[0-9a-f]{64}$/.test(payloadHash)) throw new Error('evidence payloadHash must be sha256 hex')
  return {
    evidenceId: envelope.evidenceId,
    kind: envelope.kind,
    producer: envelope.producer,
    observedAt: new Date(envelope.observedAt).toISOString(),
    chainId: envelope.chainId,
    blockNumber:
      envelope.blockNumber === null || envelope.blockNumber === undefined ? null : String(envelope.blockNumber),
    blockHash: normalizeOptionalHash(envelope.blockHash, 'block'),
    transactionHash: normalizeOptionalHash(envelope.transactionHash, 'transaction'),
    payloadHash,
    status: envelope.status || 'OBSERVED',
    payload: envelope.payload ?? null,
  }
}

function registryEntries(registry, chainId, role) {
  if (registry.chainId !== chainId) return []
  return registry.entries.filter((entry) => entry.role === role)
}

function inValidityWindow(entry, blockNumber) {
  if (blockNumber === null || blockNumber === undefined) return false
  const block = BigInt(blockNumber)
  if (block < BigInt(entry.validFromBlock)) return false
  return entry.validToBlock === null || block <= BigInt(entry.validToBlock)
}

function evidenceMap(envelopes) {
  const output = new Map()
  for (const raw of envelopes || []) {
    const normalized = normalizeEvidenceEnvelope(raw)
    const previous = output.get(normalized.evidenceId)
    if (previous && previous.payloadHash !== normalized.payloadHash) {
      throw new Error(`evidence collision: ${normalized.evidenceId}`)
    }
    output.set(normalized.evidenceId, normalized)
  }
  return output
}

/**
 * @param {string[]} ids
 * @param {Map<string, Record<string, any>>} evidence
 * @param {(item: Record<string, any>) => boolean} [predicate]
 */
function referencedEvidence(ids, evidence, predicate = () => true) {
  return (ids || []).map((id) => {
    const item = evidence.get(id)
    if (!item) throw new Error(`unknown evidence reference: ${id}`)
    if (!predicate(item)) throw new Error(`invalid evidence reference for claim: ${id}`)
    return item
  })
}

function chainEvidence(ids, evidence, chainId) {
  return referencedEvidence(
    ids,
    evidence,
    (item) =>
      item.chainId === chainId &&
      item.status === 'OBSERVED' &&
      [EvidenceKind.TRANSACTION, EvidenceKind.RECEIPT_LOG].includes(item.kind) &&
      item.blockNumber !== null &&
      item.blockHash !== null,
  )
}

function evidenceBindsPlatformClaim(claimEvidence, observation, entry) {
  const transaction = claimEvidence.find(
    (item) =>
      item.kind === EvidenceKind.TRANSACTION &&
      payloadAddress(item.payload, 'to') === entry.address &&
      item.transactionHash,
  )
  const event = claimEvidence.find(
    (item) =>
      item.kind === EvidenceKind.RECEIPT_LOG &&
      payloadAddress(item.payload, 'address', 'entryContract') === entry.address &&
      String(item.payload?.topic0 || item.payload?.eventTopic || '').toLowerCase() ===
        String(observation.eventTopic).toLowerCase() &&
      item.transactionHash,
  )
  return Boolean(transaction && event && transaction.transactionHash === event.transactionHash)
}

function resolvePlatformAttribution(input, evidence, registry) {
  const matched = []
  let sawUnrecognizedChainEntry = false
  for (const observation of input.launchObservations || []) {
    const claimEvidence = chainEvidence(observation.evidenceIds, evidence, input.chainId)
    const entryContract = normalizeOptionalAddress(observation.entryContract, 'launch entry contract')
    const eventContract = normalizeOptionalAddress(observation.eventContract, 'launch event contract')
    const entry = registryEntries(registry, input.chainId, ContractRole.UNIQUE_PLATFORM_ENTRY).find(
      (candidate) =>
        candidate.address === entryContract &&
        candidate.address === eventContract &&
        String(candidate.eventTopic).toLowerCase() === String(observation.eventTopic).toLowerCase() &&
        claimEvidence.every((item) => inValidityWindow(candidate, item.blockNumber)) &&
        evidenceBindsPlatformClaim(claimEvidence, observation, candidate),
    )
    if (entry) {
      matched.push({ entry, evidenceIds: observation.evidenceIds })
    } else {
      sawUnrecognizedChainEntry = true
    }
  }

  const platformIds = [...new Set(matched.map((item) => item.entry.platformId))]
  if (platformIds.length > 1) {
    return {
      platformId: null,
      status: AttributionStatus.CONFLICTED,
      entryContract: null,
      registryVersion: registry.version,
      evidenceIds: [...new Set(matched.flatMap((item) => item.evidenceIds))],
    }
  }
  if (platformIds.length === 1) {
    const winner = matched[0]
    return {
      platformId: winner.entry.platformId,
      status: AttributionStatus.CHAIN_ATTESTED,
      entryContract: winner.entry.address,
      registryVersion: registry.version,
      evidenceIds: [...new Set(matched.flatMap((item) => item.evidenceIds))],
    }
  }
  return {
    platformId: sawUnrecognizedChainEntry ? PlatformId.UNATTRIBUTED_CHAIN : null,
    status: AttributionStatus.UNKNOWN,
    entryContract: null,
    registryVersion: registry.version,
    evidenceIds: [],
  }
}

function resolveLaunchProtocol(input, evidence, registry) {
  const matched = []
  for (const observation of input.protocolObservations || []) {
    const claimEvidence = chainEvidence(observation.evidenceIds, evidence, input.chainId)
    const observedAddress = normalizeOptionalAddress(observation.address, 'protocol contract')
    const entry = registry.entries.find(
      (candidate) =>
        registry.chainId === input.chainId &&
        candidate.address === observedAddress &&
        candidate.protocolId &&
        claimEvidence.every((item) => inValidityWindow(candidate, item.blockNumber)) &&
        claimEvidence.some(
          (item) =>
            payloadAddress(item.payload, 'address', 'protocolRoot') === candidate.address ||
            (item.kind === EvidenceKind.TRANSACTION && payloadAddress(item.payload, 'to') === candidate.address),
        ),
    )
    if (entry) matched.push({ entry, evidenceIds: observation.evidenceIds })
  }
  const protocolIds = [...new Set(matched.map((item) => item.entry.protocolId))]
  if (protocolIds.length > 1) {
    return { protocolId: null, status: AttributionStatus.CONFLICTED, contracts: [], evidenceIds: [] }
  }
  if (protocolIds.length === 0) {
    return { protocolId: ProtocolId.UNKNOWN, status: AttributionStatus.UNKNOWN, contracts: [], evidenceIds: [] }
  }
  return {
    protocolId: protocolIds[0],
    status: AttributionStatus.CHAIN_ATTESTED,
    contracts: [...new Set(matched.map((item) => item.entry.address))],
    evidenceIds: [...new Set(matched.flatMap((item) => item.evidenceIds))],
  }
}

function classifyAsset(assetInput, registrySnapshot, evidence) {
  const assetAddress = normalizeOptionalAddress(assetInput.address, 'asset')
  if (!assetAddress) {
    return { value: AssetClass.UNKNOWN, status: AttributionStatus.UNKNOWN, evidenceIds: [] }
  }
  if (!registrySnapshot?.evidenceId || !Array.isArray(registrySnapshot.addresses)) {
    return { value: AssetClass.UNKNOWN, status: AttributionStatus.UNKNOWN, evidenceIds: [] }
  }
  const [registryEvidence] = referencedEvidence(
    [registrySnapshot.evidenceId],
    evidence,
    (item) => item.kind === EvidenceKind.REGISTRY_SNAPSHOT && item.status === 'OBSERVED',
  )
  const evidenceAddresses = registryEvidence.payload?.addresses ?? registryEvidence.payload?.matches
  if (!Array.isArray(evidenceAddresses)) throw new Error('registry evidence must contain canonical addresses')
  const canonical = new Set(evidenceAddresses.map((item) => address(item.address || item).toLowerCase()))
  const supplied = new Set(registrySnapshot.addresses.map((item) => address(item).toLowerCase()))
  if (canonical.size !== supplied.size || [...canonical].some((item) => !supplied.has(item))) {
    throw new Error('registry snapshot addresses do not match evidence payload')
  }
  return {
    value: canonical.has(assetAddress.toLowerCase()) ? AssetClass.RH_STOCK_TOKEN : AssetClass.CUSTOM_TOKEN,
    status: 'REGISTRY_CHECKED',
    evidenceIds: [registrySnapshot.evidenceId],
  }
}

function resolveLiquidityVenues(input, evidence, registry) {
  return (input.liquidityPools || []).map((pool) => {
    const claimEvidence = chainEvidence(pool.evidenceIds, evidence, input.chainId)
    const manager = normalizeOptionalAddress(pool.poolManager, 'pool manager')
    const entry = registryEntries(registry, input.chainId, ContractRole.POOL_MANAGER).find(
      (candidate) =>
        candidate.address === manager &&
        claimEvidence.every((item) => inValidityWindow(candidate, item.blockNumber)) &&
        claimEvidence.some(
          (item) =>
            item.kind === EvidenceKind.RECEIPT_LOG &&
            payloadAddress(item.payload, 'address', 'poolManager') === candidate.address &&
            String(item.payload?.poolId || '').toLowerCase() === String(pool.poolId || '').toLowerCase(),
        ),
    )
    return {
      protocolId: entry?.venueId || VenueId.UNKNOWN,
      status: entry ? AttributionStatus.CHAIN_ATTESTED : AttributionStatus.UNKNOWN,
      poolManager: manager,
      poolId: pool.poolId,
      baseAsset: pool.baseAsset,
      quoteAsset: pool.quoteAsset,
      evidenceIds: [...pool.evidenceIds],
    }
  })
}

export function assertSourceProjection(projection) {
  const platform = projection.provenance.platformAttribution
  if (platform.status === AttributionStatus.CHAIN_ATTESTED) {
    if (!platform.platformId || !platform.entryContract || platform.evidenceIds.length === 0) {
      throw new Error('chain-attested platform attribution requires entry contract and evidence')
    }
  }
  if (projection.target.classification.value === AssetClass.RH_STOCK_TOKEN) {
    if (projection.target.classification.status !== 'REGISTRY_CHECKED') {
      throw new Error('stock classification requires canonical registry evidence')
    }
  }
  if (
    platform.status === AttributionStatus.CONFLICTED ||
    projection.provenance.launchProtocol.status === AttributionStatus.CONFLICTED
  ) {
    if (projection.admission.executionEligible !== false) throw new Error('conflicted attribution must fail closed')
  }
  if (projection.quote.state === 'FRESH_PROXY_POSITIVE') {
    if (
      !projection.quote.blockNumber ||
      !projection.quote.blockHash ||
      !projection.quote.gasProxyMethod ||
      projection.quote.evidenceIds.length === 0
    ) {
      throw new Error('fresh proxy quote requires fixed-block and gas-proxy evidence')
    }
  }
  if (projection.execution.state === 'CONFIRMED' && !projection.execution.receiptEvidenceId) {
    throw new Error('confirmed execution requires receipt evidence')
  }
  return projection
}

export function buildSourceAwareOpportunity(input, options = {}) {
  if (!Number.isSafeInteger(input.chainId)) throw new Error('opportunity chainId is required')
  const registry = options.registry || SOURCE_CONTRACT_REGISTRY
  const evidence = evidenceMap(input.evidence)
  const platformAttribution = resolvePlatformAttribution(input, evidence, registry)
  const launchProtocol = resolveLaunchProtocol(input, evidence, registry)
  const targetClassification = classifyAsset(input.target, input.robinhoodAssetRegistry, evidence)
  const quoteClassification = classifyAsset(input.quoteAsset, input.robinhoodAssetRegistry, evidence)
  const liquidityVenues = resolveLiquidityVenues(input, evidence, registry)
  for (const listing of input.listings || []) referencedEvidence(listing.evidenceIds, evidence)
  for (const discovery of input.discovery || []) referencedEvidence(discovery.evidenceIds, evidence)

  const conflicted =
    platformAttribution.status === AttributionStatus.CONFLICTED ||
    launchProtocol.status === AttributionStatus.CONFLICTED ||
    liquidityVenues.some((venue) => venue.status === AttributionStatus.CONFLICTED)
  const projection = {
    schemaVersion: SOURCE_SCHEMA_VERSION,
    opportunityId: input.opportunityId,
    chainId: input.chainId,
    target: {
      address: address(input.target.address),
      symbol: input.target.symbol || 'UNKNOWN',
      name: input.target.name || input.target.symbol || 'Unknown token',
      classification: targetClassification,
    },
    quoteAsset: {
      address: address(input.quoteAsset.address),
      symbol: input.quoteAsset.symbol || 'UNKNOWN',
      name: input.quoteAsset.name || input.quoteAsset.symbol || 'Unknown token',
      classification: quoteClassification,
    },
    pairClass: `${targetClassification.value}/${quoteClassification.value}`,
    provenance: {
      discovery: [...(input.discovery || [])],
      listings: [...(input.listings || [])],
      platformAttribution,
      launchFrontend: { value: null, status: AttributionStatus.UNKNOWN, evidenceIds: [] },
      launchProtocol,
    },
    route: {
      inputAsset: input.route?.inputAsset || null,
      legs: [...(input.route?.legs || [])],
      liquidityVenues,
      historicalReference: input.route?.historicalReference || null,
    },
    quote: {
      state: 'UNQUOTED',
      blockNumber: null,
      blockHash: null,
      amountInUsdg: null,
      grossProfitUsdg: null,
      gasCostProxyUsdg: null,
      screenedNetUsdg: null,
      gasProxyMethod: null,
      evidenceIds: [],
      ...(input.quote || {}),
    },
    exactPreflight: { state: 'NOT_RUN', evidenceIds: [], ...(input.exactPreflight || {}) },
    execution: {
      state: 'NONE',
      transactionHash: null,
      receiptEvidenceId: null,
      realizedGrossUsdg: null,
      realizedGasUsdg: null,
      realizedNetUsdg: null,
      evidenceIds: [],
      ...(input.execution || {}),
    },
    economics: { state: 'UNPROVEN', evidenceIds: [], ...(input.economics || {}) },
    admission: {
      executionEligible: false,
      reason: conflicted ? 'CONFLICTED_SOURCE_EVIDENCE' : 'READ_ONLY_PROJECTION',
    },
    evidence: [...evidence.values()],
  }
  return assertSourceProjection(projection)
}
