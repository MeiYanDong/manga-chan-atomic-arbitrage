import fs from 'node:fs'
import path from 'node:path'

const CONTENT_TYPES = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
})

export function resolveDashboardAsset(root, pathname) {
  if (!['/', '/dashboard', '/dashboard/'].includes(pathname) && !pathname.startsWith('/dashboard/')) return null
  let relative
  try {
    relative = ['/', '/dashboard', '/dashboard/'].includes(pathname)
      ? 'index.html'
      : decodeURIComponent(pathname.slice('/dashboard/'.length))
  } catch {
    return { status: 400, error: 'invalid asset path' }
  }
  if (!relative || relative.includes('\0')) return { status: 400, error: 'invalid asset path' }
  const absoluteRoot = path.resolve(root)
  const candidate = path.resolve(absoluteRoot, relative)
  if (candidate !== absoluteRoot && !candidate.startsWith(`${absoluteRoot}${path.sep}`)) {
    return { status: 404, error: 'asset not found' }
  }
  if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) return { status: 404, error: 'asset not found' }
  const realRoot = fs.realpathSync(absoluteRoot)
  const realCandidate = fs.realpathSync(candidate)
  if (realCandidate !== realRoot && !realCandidate.startsWith(`${realRoot}${path.sep}`)) {
    return { status: 404, error: 'asset not found' }
  }
  const extension = path.extname(realCandidate).toLowerCase()
  return {
    status: 200,
    path: realCandidate,
    contentType: CONTENT_TYPES[extension] || 'application/octet-stream',
    cacheControl: extension === '.html' ? 'no-store' : 'private, max-age=31536000, immutable',
  }
}
