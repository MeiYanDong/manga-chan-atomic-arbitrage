import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { getHeapStatistics } from 'node:v8'
import {
  assertCompactSourceCatalogProjection,
  compactSourceCatalogProjectionInPlace,
  isCompactSourceCatalogProjection,
} from '../src/source-adapters.mjs'
import { writeStableJsonAtomic } from '../src/opportunity-board.mjs'
import { stablePayloadHash } from '../src/source-provenance.mjs'

function parseArguments(argv) {
  const command = argv[0] || 'verify'
  const options = {}
  for (let index = 1; index < argv.length; index += 1) {
    const flag = argv[index]
    if (!['--file', '--backup', '--sqlite'].includes(flag)) throw new Error(`unknown argument: ${flag}`)
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`)
    options[flag.slice(2)] = path.resolve(value)
    index += 1
  }
  if (!['compact', 'verify'].includes(command)) throw new Error(`unknown command: ${command}`)
  if (!options.file) throw new Error('--file is required')
  if (command === 'compact' && !options.backup) throw new Error('--backup is required for a recoverable compaction')
  if (command === 'compact' && !options.sqlite) throw new Error('--sqlite is required to verify immutable evidence')
  if (options.file === options.backup) throw new Error('--backup must differ from --file')
  return { command, ...options }
}

function regularFileMetadata(file) {
  const metadata = fs.lstatSync(file)
  if (metadata.isSymbolicLink() || !metadata.isFile()) throw new Error(`${file} must be a regular file, not a symlink`)
  return metadata
}

function sha256File(file) {
  const descriptor = fs.openSync(file, 'r')
  const digest = createHash('sha256')
  const buffer = Buffer.allocUnsafe(1024 * 1024)
  try {
    while (true) {
      const bytes = fs.readSync(descriptor, buffer, 0, buffer.length, null)
      if (bytes === 0) break
      digest.update(buffer.subarray(0, bytes))
    }
  } finally {
    fs.closeSync(descriptor)
  }
  return `sha256:${digest.digest('hex')}`
}

function parseCatalog(file) {
  let source = fs.readFileSync(file, 'utf8')
  const catalog = JSON.parse(source)
  source = ''
  if (globalThis.gc) globalThis.gc()
  return catalog
}

function reportBase(file, metadata, verification) {
  return {
    file,
    bytes: metadata.size,
    mode: (metadata.mode & 0o777).toString(8).padStart(4, '0'),
    sha256: sha256File(file),
    ...verification,
    heapLimitBytes: getHeapStatistics().heap_size_limit,
  }
}

function factCollections(catalog) {
  return [
    ['longLaunches', catalog.longLaunches || [], ['asset', 'numeraire', 'normalizedTicker', 'blockNumber']],
    ['dopplerLaunches', catalog.dopplerLaunches || [], ['asset', 'numeraire', 'blockNumber']],
    ['dopplerTargetIndex', catalog.dopplerTargetIndex || [], ['asset', 'numeraire', 'blockNumber']],
    ['pools', catalog.pools || [], ['poolId', 'currency0', 'currency1', 'fee', 'tickSpacing', 'hooks', 'blockNumber']],
  ]
}

function verifyEvidenceCoverage(catalog, sqliteFile) {
  regularFileMetadata(sqliteFile)
  const database = new DatabaseSync(sqliteFile, { readOnly: true })
  database.exec('PRAGMA query_only = ON')
  const lookup = database.prepare(
    `SELECT kind, status, payload_hash, payload_json
     FROM evidence
     WHERE evidence_id = ?`,
  )
  const verified = new Set()
  let referencedFacts = 0
  try {
    for (const [collection, facts, comparedFields] of factCollections(catalog)) {
      for (const fact of facts) {
        referencedFacts += 1
        const evidenceId = fact.evidenceId || fact.evidence?.evidenceId
        if (!evidenceId) throw new Error(`${collection} fact has no evidenceId`)
        const row = lookup.get(evidenceId)
        if (!row || row.kind !== 'RECEIPT_LOG' || row.status !== 'OBSERVED' || !row.payload_json) {
          throw new Error(`immutable receipt evidence is unavailable: ${evidenceId}`)
        }
        const payload = JSON.parse(String(row.payload_json))
        if (stablePayloadHash(payload) !== row.payload_hash) {
          throw new Error(`immutable receipt evidence hash mismatch: ${evidenceId}`)
        }
        verified.add(evidenceId)
        for (const field of comparedFields) {
          if (fact[field] === undefined) continue
          if (String(payload[field]) !== String(fact[field])) {
            throw new Error(`immutable evidence does not match ${collection}.${field}: ${evidenceId}`)
          }
        }
      }
    }
  } finally {
    database.close()
  }
  return { referencedFacts, uniqueEvidenceVerified: verified.size, sqliteFile }
}

function verify(file, sqliteFile = null) {
  const metadata = regularFileMetadata(file)
  const catalog = parseCatalog(file)
  const verification = assertCompactSourceCatalogProjection(catalog)
  const evidence = sqliteFile ? verifyEvidenceCoverage(catalog, sqliteFile) : null
  return { ...reportBase(file, metadata, verification), evidence }
}

function compact(file, backup, sqliteFile) {
  const sourceMetadata = regularFileMetadata(file)
  const beforeHash = sha256File(file)
  const catalog = parseCatalog(file)
  const evidence = verifyEvidenceCoverage(catalog, sqliteFile)
  if (isCompactSourceCatalogProjection(catalog)) {
    const verification = assertCompactSourceCatalogProjection(catalog)
    return {
      status: 'SOURCE_CATALOG_ALREADY_CURRENT',
      ...reportBase(file, sourceMetadata, verification),
      backup: null,
      evidence,
    }
  }
  const result = compactSourceCatalogProjectionInPlace(catalog)
  fs.copyFileSync(file, backup, fs.constants.COPYFILE_EXCL)
  fs.chmodSync(backup, sourceMetadata.mode & 0o777)
  const backupHash = sha256File(backup)
  if (backupHash !== beforeHash) throw new Error('source catalog backup hash mismatch')

  const persisted = writeStableJsonAtomic(file, result.sourceCatalog)
  const outputMetadata = regularFileMetadata(file)
  if (persisted.bytes !== outputMetadata.size) throw new Error('compacted source catalog byte count mismatch')
  return {
    status: 'SOURCE_CATALOG_COMPACTED',
    file,
    beforeBytes: sourceMetadata.size,
    afterBytes: outputMetadata.size,
    beforeSha256: beforeHash,
    afterSha256: persisted.hash,
    backup,
    backupSha256: backupHash,
    mode: (outputMetadata.mode & 0o777).toString(8).padStart(4, '0'),
    heapLimitBytes: getHeapStatistics().heap_size_limit,
    evidence,
    ...result.stats,
  }
}

function main() {
  const options = parseArguments(process.argv.slice(2))
  const result =
    options.command === 'compact'
      ? compact(options.file, options.backup, options.sqlite)
      : { status: 'SOURCE_CATALOG_VERIFIED', ...verify(options.file, options.sqlite) }
  console.log(JSON.stringify(result, null, 2))
}

try {
  main()
} catch (error) {
  console.error(
    JSON.stringify({
      status: 'SOURCE_CATALOG_OPERATION_FAILED',
      error: String(error?.message || error),
    }),
  )
  process.exitCode = 1
}
