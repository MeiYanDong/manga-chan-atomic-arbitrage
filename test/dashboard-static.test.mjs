import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { resolveDashboardAsset } from '../src/dashboard-static.mjs'

test('dashboard static resolver serves only files inside its build root', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'manga-dashboard-static-'))
  const root = path.join(parent, 'dashboard')
  fs.mkdirSync(path.join(root, 'assets'), { recursive: true })
  fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html>')
  fs.writeFileSync(path.join(root, 'assets', 'app.js'), 'export {}')
  fs.writeFileSync(path.join(parent, 'secret.txt'), 'not public')

  const index = resolveDashboardAsset(root, '/')
  assert.equal(index.status, 200)
  assert.equal(index.contentType, 'text/html; charset=utf-8')
  assert.equal(index.cacheControl, 'no-store')
  const asset = resolveDashboardAsset(root, '/dashboard/assets/app.js')
  assert.equal(asset.status, 200)
  assert.equal(asset.contentType, 'text/javascript; charset=utf-8')
  assert.equal(resolveDashboardAsset(root, '/dashboard/../secret.txt').status, 404)
  assert.equal(resolveDashboardAsset(root, '/dashboard/%2e%2e/secret.txt').status, 404)
  assert.equal(resolveDashboardAsset(root, '/api/v1/overview'), null)
})
