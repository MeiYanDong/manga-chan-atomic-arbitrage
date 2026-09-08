import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const app = fs.readFileSync(new URL('../ui/src/App.jsx', import.meta.url), 'utf8')
const html = fs.readFileSync(new URL('../ui/index.html', import.meta.url), 'utf8')

test('primary dashboard copy is Chinese-first and removes the engineering-console vocabulary', () => {
  for (const banned of [
    'MANGA RADAR',
    'PROVENANCE CONSOLE',
    'Evidence ladder',
    'Opportunity filters',
    'Radar pages',
    'Open detail',
    'Safety mode',
  ]) {
    assert.doesNotMatch(app + html, new RegExp(banned, 'i'))
  }
  assert.match(app, /套利经营台/)
  assert.match(app, /businessHeadline/)
  assert.match(app, /可以执行/)
  assert.match(app, /接近门槛/)
  assert.match(app, /继续观察/)
})

test('addresses and technical evidence are hidden behind an explicit disclosure', () => {
  const disclosure = app.indexOf('<details className="technical-details drawer-technical">')
  const rawAddress = app.indexOf('{item.target.address}')
  assert.ok(disclosure >= 0)
  assert.ok(rawAddress > disclosure)
  assert.equal(app.includes('compactAddress(item.target.address)'), false)
  assert.match(app, /查看技术信息与完整证据/)
})

test('route changes dismiss an open evidence drawer', () => {
  assert.match(app, /const update = \(\) => \{\s*closeDrawer\(\)\s*setPage\(currentPage\(window\.location\.hash\)\)/)
  assert.match(app, /\}, \[closeDrawer\]\)/)
})

test('the default document declares a light Chinese operations product', () => {
  assert.match(html, /lang="zh-CN"/)
  assert.match(html, /name="color-scheme" content="light"/)
  assert.match(html, /<title>MANGA 套利经营台<\/title>/)
})
