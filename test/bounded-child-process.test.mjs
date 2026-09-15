import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ChildProcessDeadlineError,
  ChildProcessFailedError,
  isChildProcessDeadlineError,
  runBoundedProcess,
} from '../src/bounded-child-process.mjs'

test('bounded child converts its own deadline into a typed recoverable error', async () => {
  const startedAt = Date.now()
  await assert.rejects(
    runBoundedProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      cwd: process.cwd(),
      env: process.env,
      timeoutMs: 75,
      killGraceMs: 100,
      label: 'test child',
    }),
    (error) => {
      assert.ok(error instanceof ChildProcessDeadlineError)
      assert.equal(isChildProcessDeadlineError(error), true)
      assert.equal(error.timeoutMs, 75)
      assert.doesNotMatch(error.message, /stdout|secret/i)
      return true
    },
  )
  assert.ok(Date.now() - startedAt < 2_000)
})

test('bounded child retains a bounded diagnostic for an ordinary non-zero exit', async () => {
  await assert.rejects(
    runBoundedProcess(process.execPath, ['-e', "process.stderr.write('failed safely'); process.exit(2)"], {
      cwd: process.cwd(),
      env: process.env,
      timeoutMs: 2_000,
      label: 'test child',
    }),
    (error) => {
      assert.ok(error instanceof ChildProcessFailedError)
      assert.equal(error.code, 'CHILD_PROCESS_FAILED')
      assert.match(error.message, /failed safely/)
      assert.equal(isChildProcessDeadlineError(error), false)
      return true
    },
  )
})

test('bounded child can deliver a size-limited structured stdin handoff', async () => {
  const result = await runBoundedProcess(
    process.execPath,
    [
      '-e',
      "let value=''; process.stdin.setEncoding('utf8'); process.stdin.on('data', chunk => value += chunk); process.stdin.on('end', () => process.stdout.write(value))",
    ],
    {
      cwd: process.cwd(),
      env: process.env,
      timeoutMs: 5_000,
      label: 'stdin handoff',
      input: '{"candidate":"bounded"}',
      maximumInputBytes: 64,
    },
  )
  assert.equal(result.stdout, '{"candidate":"bounded"}')
  assert.throws(
    () =>
      runBoundedProcess(process.execPath, ['-e', ''], {
        cwd: process.cwd(),
        env: process.env,
        timeoutMs: 5_000,
        label: 'oversize stdin handoff',
        input: 'x'.repeat(65),
        maximumInputBytes: 64,
      }),
    /input exceeds its bound/,
  )
})
