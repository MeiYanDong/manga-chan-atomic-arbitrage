#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'

import { createPublicClient, http } from 'viem'

import {
  assertEarnCompetitorSnapshot,
  buildEarnCompetitorSnapshot,
  reviewedReceiptRecord,
} from '../src/earn-competitor-census.mjs'
import { EARN_SWAP_ABI } from '../src/earnonhood-receipt.mjs'
import { EARN_POOL_ADDRESSES, EARN_VAULT } from '../src/earnonhood-routes.mjs'

const RPC_URL = process.env.MANGA_COMPETITOR_RPC_URL || 'https://rpc.mainnet.chain.robinhood.com'
const DATA_DIR = process.env.MANGA_COMPETITOR_DATA_DIR || '/var/lib/manga-opportunity-census'
const BUSINESS_SNAPSHOT =
  process.env.MANGA_COMPETITOR_BUSINESS_SNAPSHOT || '/var/lib/manga-business-report/business-snapshot.json'
const RETENTION_DAYS = boundedInteger(process.env.MANGA_COMPETITOR_RETENTION_DAYS, 7, 1, 31, 'retention days')
const CHUNK_BLOCKS = boundedInteger(process.env.MANGA_COMPETITOR_CHUNK_BLOCKS, 20_000, 100, 50_000, 'chunk blocks')
const SAFE_LAG_BLOCKS = boundedInteger(process.env.MANGA_COMPETITOR_SAFE_LAG_BLOCKS, 5, 2, 100, 'safe lag blocks')
const POLL_MS = boundedInteger(process.env.MANGA_COMPETITOR_POLL_MS, 15_000, 5_000, 300_000, 'poll interval')
const STATE_PATH = path.join(DATA_DIR, 'state.json')
const EVENTS_PATH = path.join(DATA_DIR, 'reviewed-cycles.jsonl')
const PUBLIC_PATH = path.join(DATA_DIR, 'public.json')

if (!path.isAbsolute(DATA_DIR) || !path.isAbsolute(BUSINESS_SNAPSHOT)) {
  throw new Error('competitor census paths must be absolute')
}

function boundedInteger(value, fallback, minimum, maximum, label) {
  const parsed = value === undefined || value === '' ? fallback : Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new RangeError(`${label} must be an integer in [${minimum}, ${maximum}]`)
  }
  return parsed
}

function readJson(file, fallback = null) {
  try {
    const descriptor = fs.openSync(file, 'r')
    try {
      const metadata = fs.fstatSync(descriptor)
      if (!metadata.isFile() || metadata.size > 5_000_000) return fallback
      return JSON.parse(fs.readFileSync(descriptor, 'utf8'))
    } finally {
      fs.closeSync(descriptor)
    }
  } catch {
    return fallback
  }
}

function writeAtomic(file, contents, mode) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o755 })
  const temporary = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temporary, contents, { encoding: 'utf8', mode })
  fs.chmodSync(temporary, mode)
  fs.renameSync(temporary, file)
  fs.chmodSync(file, mode)
}

function writeJson(file, value, mode) {
  writeAtomic(file, `${JSON.stringify(value, null, 2)}\n`, mode)
}

function readRecords() {
  if (!fs.existsSync(EVENTS_PATH)) return []
  const metadata = fs.statSync(EVENTS_PATH)
  if (!metadata.isFile() || metadata.size > 50_000_000) throw new Error('competitor evidence ledger is invalid')
  return fs
    .readFileSync(EVENTS_PATH, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

function appendRecord(record) {
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o755 })
  fs.appendFileSync(EVENTS_PATH, `${JSON.stringify(record)}\n`, { encoding: 'utf8', mode: 0o600 })
  fs.chmodSync(EVENTS_PATH, 0o600)
}

function knownOwnTransactions() {
  const snapshot = readJson(BUSINESS_SNAPSHOT, {})
  return new Set(
    (snapshot?.activities || [])
      .filter((item) => item?.networkId === 'ROBINHOOD' && item?.type === 'ARBITRAGE' && item?.transactionHash)
      .map((item) => item.transactionHash.toLowerCase()),
  )
}

function classifyKnownOwnRecords(records) {
  const own = knownOwnTransactions()
  return records.map((record) =>
    own.has(String(record.transactionHash).toLowerCase())
      ? { ...record, actorClass: 'OWN', actorAlias: '本策略' }
      : record,
  )
}

function publish(state, records) {
  const snapshot = buildEarnCompetitorSnapshot({
    state,
    records: classifyKnownOwnRecords(records),
    retentionDays: RETENTION_DAYS,
  })
  assertEarnCompetitorSnapshot(snapshot)
  writeJson(PUBLIC_PATH, snapshot, 0o644)
}

async function findRetentionStart(client, head, cutoffTimestamp) {
  let low = 0n
  let high = head
  while (low < high) {
    const middle = (low + high) / 2n
    const block = await client.getBlock({ blockNumber: middle })
    if (block.timestamp < cutoffTimestamp) low = middle + 1n
    else high = middle
  }
  return low
}

async function initialState(client) {
  const head = await client.getBlockNumber()
  const safeHead = head > BigInt(SAFE_LAG_BLOCKS) ? head - BigInt(SAFE_LAG_BLOCKS) : 0n
  const cutoffTimestamp = BigInt(Math.floor(Date.now() / 1_000) - RETENTION_DAYS * 86_400)
  const start = await findRetentionStart(client, safeHead, cutoffTimestamp)
  return {
    schemaVersion: 1,
    status: 'BACKFILLING',
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    startBlock: start.toString(),
    nextBlock: start.toString(),
    cursorBlock: null,
    cursorBlockHash: null,
    safeHeadBlock: safeHead.toString(),
    currentChunkBlocks: CHUNK_BLOCKS,
    transactionsReviewed: 0,
    lastError: null,
  }
}

async function verifyCursor(client, state, records) {
  if (!state.cursorBlock || !state.cursorBlockHash) return { state, records }
  const block = await client.getBlock({ blockNumber: BigInt(state.cursorBlock) })
  if (String(block.hash).toLowerCase() === String(state.cursorBlockHash).toLowerCase()) {
    return { state, records }
  }
  const start = BigInt(state.startBlock)
  const rewind = BigInt(state.cursorBlock) > 20n ? BigInt(state.cursorBlock) - 20n : start
  const nextBlock = rewind > start ? rewind : start
  const retained = records.filter((record) => BigInt(record.blockNumber) < nextBlock)
  writeAtomic(
    EVENTS_PATH,
    retained.map((record) => JSON.stringify(record)).join('\n') + (retained.length ? '\n' : ''),
    0o600,
  )
  return {
    records: retained,
    state: {
      ...state,
      status: 'PARTIAL',
      nextBlock: nextBlock.toString(),
      cursorBlock: null,
      cursorBlockHash: null,
      lastError: 'CANONICAL_REWIND',
      updatedAt: new Date().toISOString(),
    },
  }
}

async function scanChunk(client, state, records) {
  const head = await client.getBlockNumber()
  const safeHead = head > BigInt(SAFE_LAG_BLOCKS) ? head - BigInt(SAFE_LAG_BLOCKS) : 0n
  const fromBlock = BigInt(state.nextBlock)
  if (fromBlock > safeHead) {
    const current = {
      ...state,
      status: 'CURRENT',
      safeHeadBlock: safeHead.toString(),
      lastError: null,
      updatedAt: new Date().toISOString(),
    }
    return { state: current, records }
  }
  const currentChunkBlocks = boundedInteger(
    state.currentChunkBlocks,
    CHUNK_BLOCKS,
    100,
    CHUNK_BLOCKS,
    'current chunk blocks',
  )
  const maximumToBlock = fromBlock + BigInt(currentChunkBlocks - 1)
  const toBlock = maximumToBlock < safeHead ? maximumToBlock : safeHead
  let logs
  try {
    logs = await client.getLogs({
      address: EARN_VAULT,
      event: EARN_SWAP_ABI[0],
      args: { pool: EARN_POOL_ADDRESSES },
      fromBlock,
      toBlock,
    })
  } catch (error) {
    if (currentChunkBlocks <= 100) throw error
    return {
      records,
      state: {
        ...state,
        status: 'PARTIAL',
        currentChunkBlocks: Math.max(100, Math.floor(currentChunkBlocks / 2)),
        safeHeadBlock: safeHead.toString(),
        lastError: 'LOG_RANGE_REDUCED',
        updatedAt: new Date().toISOString(),
      },
    }
  }
  const transactionHashes = [...new Set(logs.map((log) => log.transactionHash).filter(Boolean))]
  const knownEvidence = new Set(records.map((record) => record.evidenceId))
  const blockTimes = new Map()
  let transactionsReviewed = Number(state.transactionsReviewed || 0)
  for (const transactionHash of transactionHashes) {
    const receipt = await client.getTransactionReceipt({ hash: transactionHash })
    transactionsReviewed += 1
    const blockKey = receipt.blockNumber.toString()
    if (!blockTimes.has(blockKey)) {
      const block = await client.getBlock({ blockNumber: receipt.blockNumber })
      blockTimes.set(blockKey, new Date(Number(block.timestamp) * 1_000).toISOString())
    }
    const record = reviewedReceiptRecord({ receipt, occurredAt: blockTimes.get(blockKey) })
    if (!record || knownEvidence.has(record.evidenceId)) continue
    appendRecord(record)
    records.push(record)
    knownEvidence.add(record.evidenceId)
  }
  const commitment = await client.getBlock({ blockNumber: toBlock })
  return {
    records,
    state: {
      ...state,
      status: toBlock >= safeHead ? 'CURRENT' : 'BACKFILLING',
      nextBlock: (toBlock + 1n).toString(),
      cursorBlock: toBlock.toString(),
      cursorBlockHash: commitment.hash,
      safeHeadBlock: safeHead.toString(),
      currentChunkBlocks: Math.min(CHUNK_BLOCKS, Math.max(100, currentChunkBlocks * 2)),
      transactionsReviewed,
      lastError: null,
      updatedAt: new Date().toISOString(),
    },
  }
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function main() {
  const command = process.argv[2] || 'watch'
  if (!['watch', 'once'].includes(command)) throw new Error('usage: earn-competitor-census.mjs [watch|once]')
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o755 })
  const client = createPublicClient({
    transport: http(RPC_URL, { batch: false, retryCount: 2, retryDelay: 500, timeout: 10_000 }),
  })
  let records = readRecords()
  let state = readJson(STATE_PATH)
  if (fs.existsSync(STATE_PATH) && !state) throw new Error('competitor census state is invalid')
  if (!state || state.schemaVersion !== 1) state = await initialState(client)
  ;({ state, records } = await verifyCursor(client, state, records))
  writeJson(STATE_PATH, state, 0o600)
  publish(state, records)
  let stopping = false
  const stop = () => {
    stopping = true
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
  do {
    try {
      ;({ state, records } = await scanChunk(client, state, records))
    } catch (error) {
      state = {
        ...state,
        status: 'PARTIAL',
        lastError: error instanceof Error ? error.message.slice(0, 500) : 'UNKNOWN_ERROR',
        updatedAt: new Date().toISOString(),
      }
    }
    writeJson(STATE_PATH, state, 0o600)
    publish(state, records)
    if (command === 'once') break
    await wait(state.status === 'CURRENT' ? POLL_MS : 250)
  } while (!stopping)
  process.stdout.write(`${JSON.stringify({ status: state.status, cursorBlock: state.cursorBlock })}\n`)
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'competitor census failed'}\n`)
  process.exitCode = 1
})
