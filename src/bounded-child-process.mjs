import { spawn } from 'node:child_process'

export const CHILD_PROCESS_DEADLINE_CODE = 'CHILD_PROCESS_DEADLINE_EXCEEDED'
const DEFAULT_MAXIMUM_OUTPUT_BYTES = 1_000_000
const DEFAULT_KILL_GRACE_MS = 5_000

export class ChildProcessDeadlineError extends Error {
  constructor(label, timeoutMs) {
    super(`${label} exceeded its ${timeoutMs} ms deadline`)
    this.name = 'ChildProcessDeadlineError'
    this.code = CHILD_PROCESS_DEADLINE_CODE
    this.label = label
    this.timeoutMs = timeoutMs
  }
}

export class ChildProcessFailedError extends Error {
  constructor(label, code, signal, diagnostic) {
    super(`${label} failed (${code ?? signal}): ${diagnostic}`)
    this.name = 'ChildProcessFailedError'
    this.code = 'CHILD_PROCESS_FAILED'
    this.exitCode = code
    this.signal = signal
  }
}

/** @param {unknown} error */
export function isChildProcessDeadlineError(error) {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === CHILD_PROCESS_DEADLINE_CODE)
}

/**
 * Run one bounded child without putting child output or transport credentials in
 * the deadline error. A SIGKILL fallback prevents a child that ignores SIGTERM
 * from retaining the single signing lane indefinitely.
 *
 * @param {string} executable
 * @param {string[]} args
 * @param {{cwd: string, env: NodeJS.ProcessEnv, timeoutMs: number, label: string, maximumOutputBytes?: number, killGraceMs?: number}} options
 */
export function runBoundedProcess(executable, args, options) {
  const {
    cwd,
    env,
    timeoutMs,
    label,
    maximumOutputBytes = DEFAULT_MAXIMUM_OUTPUT_BYTES,
    killGraceMs = DEFAULT_KILL_GRACE_MS,
  } = options
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new Error('child timeout must be a positive integer')
  if (!Number.isSafeInteger(killGraceMs) || killGraceMs <= 0) throw new Error('child kill grace must be positive')
  if (!Number.isSafeInteger(maximumOutputBytes) || maximumOutputBytes <= 0) {
    throw new Error('child output bound must be positive')
  }

  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let deadlineExceeded = false
    let settled = false
    let forceKill = null
    const appendBounded = (current, chunk) => `${current}${chunk}`.slice(-maximumOutputBytes)
    child.stdout.on('data', (chunk) => {
      stdout = appendBounded(stdout, chunk)
    })
    child.stderr.on('data', (chunk) => {
      stderr = appendBounded(stderr, chunk)
    })
    const timeout = setTimeout(() => {
      deadlineExceeded = true
      child.kill('SIGTERM')
      forceKill = setTimeout(() => child.kill('SIGKILL'), killGraceMs)
    }, timeoutMs)
    const cleanup = () => {
      clearTimeout(timeout)
      if (forceKill) clearTimeout(forceKill)
    }
    child.once('error', (error) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    })
    child.once('close', (code, signal) => {
      if (settled) return
      settled = true
      cleanup()
      if (deadlineExceeded) {
        reject(new ChildProcessDeadlineError(label, timeoutMs))
        return
      }
      if (code !== 0) {
        reject(new ChildProcessFailedError(label, code, signal, stderr.trim() || stdout.trim()))
        return
      }
      resolve({ stdout, stderr, exitCode: code, signal })
    })
  })
}
