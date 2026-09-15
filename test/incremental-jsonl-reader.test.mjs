import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { IncrementalJsonlEventReader } from '../src/incremental-jsonl-reader.mjs'

function fixture(context) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'manga-jsonl-reader-'))
  const file = path.join(directory, 'audit.jsonl')
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  return { directory, file }
}

test('reads only selected events and incrementally consumes appended bytes', (context) => {
  const { file } = fixture(context)
  fs.writeFileSync(
    file,
    `${JSON.stringify({ event: 'diagnostic', details: 'ignored' })}\n${JSON.stringify({ event: 'mutation_signed', hash: '0x01' })}\n`,
  )
  const reader = new IncrementalJsonlEventReader(file, {
    events: ['mutation_signed', 'mutation_effect'],
    chunkBytes: 7,
  })
  const first = reader.read()
  assert.deepEqual(first, [{ event: 'mutation_signed', hash: '0x01' }])
  assert.equal(reader.read(), first)

  fs.appendFileSync(file, `${JSON.stringify({ event: 'mutation_effect', hash: '0x01' })}\n`)
  assert.deepEqual(reader.read(), [
    { event: 'mutation_signed', hash: '0x01' },
    { event: 'mutation_effect', hash: '0x01' },
  ])
})

test('projects selected records before retaining them and may discard a selected record', (context) => {
  const { file } = fixture(context)
  fs.writeFileSync(
    file,
    `${JSON.stringify({ event: 'mutation_signed', hash: '0x01', large: 'x'.repeat(64 * 1024) })}\n${JSON.stringify({ event: 'mutation_effect', hash: '0x02' })}\n`,
  )
  const reader = new IncrementalJsonlEventReader(file, {
    events: ['mutation_signed', 'mutation_effect'],
    projectRecord: (record) => (record.event === 'mutation_signed' ? { event: record.event, hash: record.hash } : null),
  })

  assert.deepEqual(reader.read(), [{ event: 'mutation_signed', hash: '0x01' }])
  assert.equal(JSON.stringify(reader.records).includes('large'), false)
  assert.throws(
    () =>
      new IncrementalJsonlEventReader(file, {
        // @ts-expect-error Exercise the runtime boundary for untyped callers.
        projectRecord: 'invalid',
      }),
    /record projector must be a function/,
  )
})

test('holds an incomplete tail until its newline arrives', (context) => {
  const { file } = fixture(context)
  fs.writeFileSync(file, '{"event":"mutation_signed","hash":"0x02"')
  const reader = new IncrementalJsonlEventReader(file, { events: ['mutation_signed'], chunkBytes: 5 })
  assert.deepEqual(reader.read(), [])
  fs.appendFileSync(file, '}\n')
  assert.deepEqual(reader.read(), [{ event: 'mutation_signed', hash: '0x02' }])
})

test('resets safely after truncation and inode rotation', (context) => {
  const { directory, file } = fixture(context)
  fs.writeFileSync(file, '{"event":"mutation_signed","hash":"0x03"}\n')
  const reader = new IncrementalJsonlEventReader(file, { events: ['mutation_signed'] })
  assert.equal(reader.read()[0].hash, '0x03')

  fs.truncateSync(file, 0)
  assert.deepEqual(reader.read(), [])
  fs.appendFileSync(file, '{"event":"mutation_signed","hash":"0x04"}\n')
  assert.equal(reader.read()[0].hash, '0x04')

  const rotated = path.join(directory, 'rotated.jsonl')
  fs.writeFileSync(rotated, '{"event":"mutation_signed","hash":"0x05"}\n')
  fs.renameSync(rotated, file)
  assert.equal(reader.read()[0].hash, '0x05')
})

test('fails closed for malformed selected records', (context) => {
  const { file } = fixture(context)
  fs.writeFileSync(file, '{"event":"mutation_signed",oops}\n')
  const reader = new IncrementalJsonlEventReader(file, { events: ['mutation_signed'] })
  assert.throws(() => reader.read(), /safety JSONL record is malformed/)
})

test('does not parse or retain large unrelated diagnostics', (context) => {
  const { file } = fixture(context)
  fs.writeFileSync(
    file,
    `${JSON.stringify({ event: 'rpc_error', body: '<html>' + 'x'.repeat(512 * 1024) })}\n${JSON.stringify({ event: 'mutation_signed', hash: '0x06' })}\n`,
  )
  const reader = new IncrementalJsonlEventReader(file, {
    events: ['mutation_signed'],
    chunkBytes: 8 * 1024,
    maxLineBytes: 1024 * 1024,
  })
  assert.deepEqual(reader.read(), [{ event: 'mutation_signed', hash: '0x06' }])
  assert.equal(JSON.stringify(reader.records).includes('<html>'), false)
})

test('streams past the one known oversized legacy global wake without retaining it', (context) => {
  const { file } = fixture(context)
  const wake = {
    at: '2026-09-14T22:02:38.791Z',
    lane: 'dual-v3',
    event: 'global_watch_wake',
    classificationReason: 'NON_HUB_ASSET_PATH_MATCH+'.repeat(275_000),
  }
  fs.writeFileSync(file, `${JSON.stringify(wake)}\n${JSON.stringify({ event: 'mutation_signed', hash: '0xlegacy' })}\n`)
  const reader = new IncrementalJsonlEventReader(file, {
    events: ['mutation_signed'],
    chunkBytes: 64 * 1024,
    maxLineBytes: 2 * 1024 * 1024,
  })
  assert.deepEqual(reader.read(), [{ event: 'mutation_signed', hash: '0xlegacy' }])
  assert.equal(reader.skippingOversize, false)
  assert.equal(reader.pending.length, 0)
})

test('does not let an oversized legacy wake conceal a later safety event marker', (context) => {
  const { file } = fixture(context)
  fs.writeFileSync(
    file,
    `{"at":"2026-09-14T22:02:38.791Z","lane":"dual-v3","event":"global_watch_wake","pad":"${'x'.repeat(768)}","event":"mutation_signed"}\n`,
  )
  const reader = new IncrementalJsonlEventReader(file, {
    events: ['mutation_signed'],
    chunkBytes: 67,
    maxLineBytes: 256,
  })
  assert.throws(() => reader.read(), /oversized diagnostic JSONL record contains a safety event/)
})

test('fails closed for an oversized unknown diagnostic event', (context) => {
  const { file } = fixture(context)
  fs.writeFileSync(
    file,
    `${JSON.stringify({ at: new Date(0).toISOString(), lane: 'dual-v3', event: 'rpc_error', body: 'x'.repeat(1024) })}\n`,
  )
  const reader = new IncrementalJsonlEventReader(file, {
    events: ['mutation_signed'],
    chunkBytes: 64,
    maxLineBytes: 256,
  })
  assert.throws(() => reader.read(), /safety JSONL record exceeds/)
})

test('repeated safety checks do not reparse a production-sized diagnostic history', (context) => {
  const { file } = fixture(context)
  const diagnostic = `${JSON.stringify({ event: 'rpc_error', body: '<html>' + 'x'.repeat(256 * 1024) })}\n`
  fs.writeFileSync(file, `${diagnostic.repeat(64)}${JSON.stringify({ event: 'mutation_signed', hash: '0x07' })}\n`)
  const reader = new IncrementalJsonlEventReader(file, { events: ['mutation_signed'] })
  const records = reader.read()
  assert.equal(records.length, 1)
  const offset = reader.offset
  for (let index = 0; index < 1_000; index += 1) assert.equal(reader.read(), records)
  assert.equal(reader.offset, offset)
  assert.equal(reader.records.length, 1)
})

test('fails closed for an overlarge unterminated line', (context) => {
  const { file } = fixture(context)
  fs.writeFileSync(file, '{"event":"mutation_signed","body":"' + 'x'.repeat(1024))
  const reader = new IncrementalJsonlEventReader(file, {
    events: ['mutation_signed'],
    chunkBytes: 64,
    maxLineBytes: 256,
  })
  assert.throws(() => reader.read(), /unterminated safety JSONL record exceeds/)
})
