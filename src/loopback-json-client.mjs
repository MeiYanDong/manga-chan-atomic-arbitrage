const LOOPBACK_HOSTS = new Set(['127.0.0.1', '[::1]', 'localhost'])
const ATTEMPTS = 2
const TIMEOUT_MS = 8_000
const RETRY_DELAY_MS = 500

function defaultWait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

/**
 * Read one sanitized board endpoint without turning a busy event-loop window
 * into a durable UNKNOWN business snapshot. Both attempts remain loopback-only.
 * @param {string} pathname
 * @param {{
 *   baseUrl: string,
 *   fetchImpl?: typeof fetch,
 *   timeoutSignal?: (milliseconds: number) => AbortSignal,
 *   waitImpl?: (milliseconds: number) => Promise<void>,
 * }} options
 */
export async function requestLoopbackJson(
  pathname,
  {
    baseUrl,
    fetchImpl = globalThis.fetch,
    timeoutSignal = (milliseconds) => AbortSignal.timeout(milliseconds),
    waitImpl = defaultWait,
  },
) {
  let url
  try {
    url = new URL(pathname, baseUrl)
  } catch {
    return null
  }
  if (!LOOPBACK_HOSTS.has(url.hostname)) return null

  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        headers: { accept: 'application/json' },
        signal: timeoutSignal(TIMEOUT_MS),
      })
      if (response.ok) return await response.json()
    } catch {}
    if (attempt < ATTEMPTS) await waitImpl(RETRY_DELAY_MS)
  }
  return null
}
