/**
 * Keep the webhook boundary dependency-free so the minimum-necessary health
 * checker does not need to load the trading/business dependency graph.
 *
 * @param {unknown} value
 */
export function assertFeishuWebhookUrl(value) {
  const url = new URL(String(value || '').trim())
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'open.feishu.cn' ||
    !/^\/open-apis\/bot\/v2\/hook\/[A-Za-z0-9_-]{20,}$/.test(url.pathname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error('invalid Feishu custom-bot webhook')
  }
  return url.toString()
}
