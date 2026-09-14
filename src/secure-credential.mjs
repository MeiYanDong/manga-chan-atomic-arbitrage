import path from 'node:path'

/**
 * systemd exposes service credentials as immutable 0440 root:root files inside
 * the unit-specific credentials directory. Keep this check dependency-free so
 * read-only health processes do not load the signing journal or viem.
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
