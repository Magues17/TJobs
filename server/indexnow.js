// IndexNow (https://www.indexnow.org/documentation): tells Bing, Yandex and the
// other participating engines which URLs changed. Google does not use it.
// register() serves the key file and returns { notify, notifyChanged, status }.
import crypto from 'crypto'
import { landingPages } from '../shared/landingPages.js'

const ENDPOINT = 'https://api.indexnow.org/indexnow'
const MAX_URLS = 10000
const TIMEOUT_MS = 15000
const DAILY_MS = 24 * 60 * 60 * 1000
const KEY_RE = /^[A-Za-z0-9-]{8,128}$/

export function register({ app, pool, APP_BASE_URL, jwtSecret = process.env.JWT_SECRET || '', getSiteUrls }) {
  const base = String(APP_BASE_URL || '').trim().replace(/\/+$/, '')
  let host = ''
  let isPublicHttps = false
  try {
    const u = new URL(base)
    host = u.host
    // A real https site: not localhost and not a bare IP, so dev never pings.
    isPublicHttps = u.protocol === 'https:' && /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(u.hostname) && !/^\d+(\.\d+){3}$/.test(u.hostname)
  } catch { /* no usable base URL: stays inactive */ }

  const envKey = (process.env.INDEXNOW_KEY || '').trim()
  if (envKey && !KEY_RE.test(envKey)) console.warn('[indexnow] INDEXNOW_KEY must be 8-128 letters, digits or dashes; using the derived key instead.')
  const key = KEY_RE.test(envKey) ? envKey : crypto.createHash('sha256').update(`${jwtSecret}:indexnow`).digest('hex').slice(0, 32)
  const keyLocation = `${base}/${key}.txt`

  // The key-location proof: the engines fetch this to confirm we own the site.
  app.get(`/${key}.txt`, (req, res) => res.type('text/plain').send(key))

  let last = null // { at, count, status } of the most recent submission
  let lastBulkAt = 0
  let skippedLogged = false

  async function notify(urls) {
    try {
      if (!isPublicHttps) {
        if (!skippedLogged) console.log('[indexnow] skipped: APP_BASE_URL is not a public https site')
        skippedLogged = true
        return null
      }
      const urlList = [...new Set((urls || []).filter((u) => typeof u === 'string' && (u === base || u.startsWith(`${base}/`))))].slice(0, MAX_URLS)
      if (!urlList.length) return null
      let status
      try {
        const response = await fetch(ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
          body: JSON.stringify({ host, key, keyLocation, urlList }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        })
        status = response.status
      } catch (error) {
        status = `error: ${error?.message || error}`
      }
      last = { at: new Date().toISOString(), count: urlList.length, status }
      console.log(`[indexnow] submitted ${urlList.length} urls → ${status}`)
      return last
    } catch (error) {
      console.error('[indexnow] notify failed:', error?.message || error)
      return null
    }
  }

  // Home, every open job, the landing pages and the sitemap. ifDue limits it to
  // one submission per day per process (IndexNow dedupes across processes).
  async function notifyChanged({ ifDue = false } = {}) {
    try {
      if (ifDue && Date.now() - lastBulkAt < DAILY_MS) return null
      lastBulkAt = Date.now()
      let jobUrls
      if (getSiteUrls) {
        jobUrls = await getSiteUrls()
      } else {
        const [rows] = await pool.query(
          `SELECT id FROM job_posts WHERE status = 'open' AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP) ORDER BY id`
        )
        jobUrls = rows.map((row) => `${base}/jobs/${row.id}`)
      }
      return await notify([`${base}/`, ...landingPages.map((page) => `${base}${page.path}`), `${base}/sitemap.xml`, ...jobUrls])
    } catch (error) {
      console.error('[indexnow] notifyChanged failed:', error?.message || error)
      return null
    }
  }

  return { notify, notifyChanged, status: () => ({ active: isPublicHttps, keyLocation, last }) }
}
