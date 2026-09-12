import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const app = fs.readFileSync(new URL('../ui/src/App.jsx', import.meta.url), 'utf8')
const html = fs.readFileSync(new URL('../ui/index.html', import.meta.url), 'utf8')
const styles = fs.readFileSync(new URL('../ui/src/styles.css', import.meta.url), 'utf8')

test('primary dashboard is a Chinese-first data product without presentation copy', () => {
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
  assert.match(app, /套利经营面板/)
  assert.match(app, /经营概览/)
  assert.match(app, /项目经营结果/)
  assert.match(app, /交易记录/)
  assert.match(app, /钱包与合约/)
  assert.match(app, /只读/)
  assert.match(app, /可以执行/)
  assert.match(app, /接近门槛/)
  assert.match(app, /继续观察/)
  assert.match(app, /verifiedExecutionNetEth/)
  assert.match(app, /Earn 本轮已确认/)
  assert.doesNotMatch(app, /你转入的 0\.01 ETH|Base 首笔入金|BASE_BOOTSTRAP_RECEIPT/)
})

test('addresses and technical evidence stay behind explicit disclosures', () => {
  const disclosure = app.indexOf('<details className="technical-details">')
  const rawAddress = app.indexOf('item.target?.address')
  assert.ok(disclosure >= 0)
  assert.ok(rawAddress > disclosure)
  assert.match(app, /技术信息与完整证据/)
})

test('route changes dismiss every open detail drawer', () => {
  assert.match(app, /const update = \(\) => \{\s*closeDrawers\(\)\s*setPage\(currentPage\(window\.location\.hash\)\)/)
  assert.match(app, /\}, \[closeDrawers\]\)/)
})

test('document and stylesheet enforce a restrained light operations interface', () => {
  assert.match(html, /lang="zh-CN"/)
  assert.match(html, /name="color-scheme" content="light"/)
  assert.match(html, /<title>套利经营面板<\/title>/)
  assert.match(styles, /-apple-system, BlinkMacSystemFont, ['"]PingFang SC['"], ['"]Microsoft YaHei['"]/)
  assert.doesNotMatch(styles, /Songti|Georgia|gradient|box-shadow|animation:/i)
})
