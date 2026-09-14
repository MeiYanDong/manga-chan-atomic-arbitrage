import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const app = fs.readFileSync(new URL('../ui/src/App.jsx', import.meta.url), 'utf8')
const html = fs.readFileSync(new URL('../ui/index.html', import.meta.url), 'utf8')
const styles = fs.readFileSync(new URL('../ui/src/styles.css', import.meta.url), 'utf8')
const viewModel = fs.readFileSync(new URL('../ui/src/view-model.mjs', import.meta.url), 'utf8')

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
  assert.match(app, /机会漏斗/)
  assert.match(app + viewModel, /错过与未知/)
  assert.match(app, /市场竞争/)
  assert.match(app, /竞争者排行/)
  assert.match(app, /策略与路径/)
  assert.match(app, /我们的执行漏斗/)
  assert.match(app, /从事件到结论/)
  assert.match(app, /被竞争者抢走/)
  assert.match(app, /净利润待同区块估值/)
  assert.match(app, /未知不会被写成零机会/)
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

test('global polling does not materialize the heavy opportunity projection', () => {
  const start = app.indexOf('function useOperationsData()')
  const end = app.indexOf('function useStrategyOpportunities', start)
  const globalPoller = app.slice(start, end)
  assert.doesNotMatch(globalPoller, /\/api\/v1\/opportunities(?:['"?])/)
  assert.match(app.slice(end), /\/api\/v1\/opportunities\?limit=12/)
})

test('document and stylesheet enforce a restrained light operations interface', () => {
  assert.match(html, /lang="zh-CN"/)
  assert.match(html, /name="color-scheme" content="light"/)
  assert.match(html, /<title>套利经营面板<\/title>/)
  assert.match(styles, /-apple-system, BlinkMacSystemFont, ['"]PingFang SC['"], ['"]Microsoft YaHei['"]/)
  assert.doesNotMatch(styles, /Songti|Georgia|gradient|box-shadow|animation:/i)
})
