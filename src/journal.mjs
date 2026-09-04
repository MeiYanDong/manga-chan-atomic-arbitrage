import fs from 'node:fs'
import path from 'node:path'
import { keccak256, toHex } from 'viem'

/** @param {unknown} value */
export function stableStringify(value) {
  const normalize = (item) => {
    if (typeof item === 'bigint') return item.toString()
    if (Array.isArray(item)) return item.map(normalize)
    if (item && typeof item === 'object') {
      return Object.fromEntries(
        Object.keys(item)
          .sort()
          .map((key) => [key, normalize(item[key])]),
      )
    }
    return item
  }
  return JSON.stringify(normalize(value))
}

/** @param {string} kind @param {Record<string, unknown>} fields @param {string} [createdAt] */
export function buildMutationPlan(kind, fields, createdAt = new Date().toISOString()) {
  const plan = { schemaVersion: 1, kind, createdAt, ...fields }
  const planHash = keccak256(toHex(stableStringify(plan)))
  const intentId = keccak256(toHex(stableStringify({ kind, createdAt, planHash })))
  return { ...plan, planHash, intentId }
}

/** @param {string} directory @param {string} hash @param {string} serializedTransaction */
export function persistSignedRaw(directory, hash, serializedTransaction) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  fs.chmodSync(directory, 0o700)
  const file = path.join(directory, `${hash}.raw`)
  try {
    fs.writeFileSync(file, `${serializedTransaction}\n`, { flag: 'wx', mode: 0o600 })
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error
    if (fs.readFileSync(file, 'utf8').trim() !== serializedTransaction) {
      throw new Error('同一交易哈希的持久化 raw 不一致')
    }
  }
  fs.chmodSync(file, 0o600)
  return file
}

/**
 * systemd exposes service credentials as immutable 0440 root:root files inside
 * the unit-specific credentials directory. That group-readable bit is safe only
 * inside the mount namespace managed by systemd, never for an ordinary file.
 *
 * @param {string} file
 * @param {{mode: number, uid: number, gid: number}} stat
 * @param {string | undefined} credentialDirectory
 */
export function isSecureSystemdCredential(file, stat, credentialDirectory) {
  if (!credentialDirectory) return false
  return (
    path.dirname(path.resolve(file)) === path.resolve(credentialDirectory) &&
    stat.uid === 0 &&
    stat.gid === 0 &&
    (stat.mode & 0o777) === 0o440
  )
}

/** @param {string} file */
export function assertPrivateFile(file) {
  const stat = fs.lstatSync(file)
  if (!stat.isFile()) throw new Error(`签名凭据不是普通文件：${file}`)
  if ((stat.mode & 0o077) !== 0 && !isSecureSystemdCredential(file, stat, process.env.CREDENTIALS_DIRECTORY)) {
    throw new Error(`签名凭据必须为普通私有文件，或受 systemd credentials 隔离的 0440 root:root 文件：${file}`)
  }
}
