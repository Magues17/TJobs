// Auto-post new jobs to the TarboroJobs Facebook Page. OFF and inert until configured.
//
// OWNER SETUP
//  1. Create a Facebook Page named "TarboroJobs" (facebook.com/pages/create).
//  2. At developers.facebook.com create an app (type Business) tied to the Page's business.
//  3. In Graph API Explorer pick the app + the Page, request pages_manage_posts and
//     pages_read_engagement, generate a User token, exchange it for a long-lived token, then
//     GET /me/accounts: the Page entry's access_token is a non-expiring Page token, and its
//     id is the Page ID.
//  4. In hPanel set env vars FACEBOOK_PAGE_ID and FACEBOOK_PAGE_ACCESS_TOKEN, restart the app.
//     (FACEBOOK_AUTOPOST=off pauses posting without removing them.)
//  5. Check Admin dashboard > Facebook; use "Run now" for the first post.
// Posts go at most 5 per run and 1 per 20 minutes; an invalid token (code 190) pauses 24h.

const GRAPH_VERSION = 'v25.0'
const MAX_PER_RUN = 5
const MAX_ATTEMPTS = 3
const SPACING_MS = 20 * 60 * 1000
const PAUSE_MS = 24 * 60 * 60 * 1000
const TIMEOUT_MS = 15000
const LOCK_NAME = 'tarboro_facebook_post'

export function register({ app, pool, requireAdminAuth, formatPay, APP_BASE_URL, spacingMs = SPACING_MS }) {
  // ponytail: pause/lastError live in memory; a Passenger restart forgets them (one extra failed call).
  const state = { running: false, pausedUntil: 0, lastError: null }
  const cfg = () => ({
    pageId: process.env.FACEBOOK_PAGE_ID || '',
    token: process.env.FACEBOOK_PAGE_ACCESS_TOKEN || '',
  })
  const enabled = () => {
    const c = cfg()
    return Boolean(c.pageId && c.token) && process.env.FACEBOOK_AUTOPOST !== 'off'
  }

  async function ensureTable() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS facebook_posts (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        job_id INT NOT NULL,
        fb_post_id VARCHAR(100) NULL DEFAULT NULL,
        posted_at DATETIME NULL DEFAULT NULL,
        error VARCHAR(500) NULL DEFAULT NULL,
        attempts INT NOT NULL DEFAULT 0,
        PRIMARY KEY (id),
        UNIQUE KEY uq_facebook_job (job_id)
      )
    `)
  }

  function buildMessage(job) {
    const link = `${String(APP_BASE_URL || '').replace(/\/+$/, '')}/jobs/${job.id}?utm_source=facebook&utm_medium=social`
    const pay = formatPay ? formatPay(job.pay_min, job.pay_max, job.pay_type) : ''
    const parts = [`New job in Tarboro: ${job.job_title} — ${job.business_name}${job.city ? `, ${job.city}` : ''}.`]
    if (pay) parts.push(`${pay}.`)
    parts.push(`Details: ${link}`)
    return { message: parts.join(' '), link }
  }

  async function pickJobs(limit) {
    const [cols] = await pool.query(
      `SELECT 1 FROM information_schema.columns
       WHERE table_schema = DATABASE() AND table_name = 'job_posts' AND column_name = 'featured_until' LIMIT 1`
    )
    const featured = cols.length ? '(jp.featured_until IS NOT NULL AND jp.featured_until > CURRENT_TIMESTAMP) DESC, ' : ''
    const [rows] = await pool.query(
      `SELECT jp.id, jp.job_title, jp.city, jp.pay_min, jp.pay_max, jp.pay_type, e.business_name
       FROM job_posts jp
       INNER JOIN employers e ON e.id = jp.employer_id
       LEFT JOIN facebook_posts fp ON fp.job_id = jp.id
       WHERE jp.status = 'open'
         AND COALESCE(jp.published_at, jp.created_at) > DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 3 DAY)
         AND (jp.expires_at IS NULL OR jp.expires_at > CURRENT_TIMESTAMP)
         AND e.access_status = 'active' AND e.onboarding_completed = 1
         AND (fp.id IS NULL OR (fp.fb_post_id IS NULL AND fp.attempts < ?))
       ORDER BY ${featured}COALESCE(jp.published_at, jp.created_at) ASC
       LIMIT ?`,
      [MAX_ATTEMPTS, limit]
    )
    return rows
  }

  async function msSinceLastPost() {
    const [rows] = await pool.query(
      `SELECT TIMESTAMPDIFF(SECOND, MAX(posted_at), CURRENT_TIMESTAMP) AS secs FROM facebook_posts WHERE fb_post_id IS NOT NULL`
    )
    const secs = rows[0]?.secs
    return secs === null || secs === undefined ? Infinity : Number(secs) * 1000
  }

  async function sendToFacebook(job) {
    const { pageId, token } = cfg()
    const { message, link } = buildMessage(job)
    const res = await globalThis.fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(pageId)}/feed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ message, link, access_token: token }).toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || !data.id) {
      const err = new Error(String(data?.error?.message || `HTTP ${res.status}`).slice(0, 300))
      err.fbCode = data?.error?.code
      throw err
    }
    return data.id
  }

  async function record(jobId, fbId, error) {
    await pool.query(
      `INSERT INTO facebook_posts (job_id, fb_post_id, posted_at, error, attempts)
       VALUES (?, ?, ${fbId ? 'CURRENT_TIMESTAMP' : 'NULL'}, ?, 1)
       ON DUPLICATE KEY UPDATE fb_post_id = VALUES(fb_post_id), posted_at = VALUES(posted_at),
         error = VALUES(error), attempts = attempts + 1`,
      [jobId, fbId || null, error ? String(error).slice(0, 500) : null]
    )
  }

  // Never throws. Returns { skipped } or { posted, failed }.
  async function postNewJobs() {
    if (!enabled()) return { skipped: 'disabled' }
    if (Date.now() < state.pausedUntil) return { skipped: 'paused' }
    if (state.running) return { skipped: 'running' }
    state.running = true
    let conn
    try {
      conn = await pool.getConnection()
      const [[lock]] = await conn.query('SELECT GET_LOCK(?, 0) AS got', [LOCK_NAME])
      if (Number(lock?.got) !== 1) return { skipped: 'locked' }
      let posted = 0
      let failed = 0
      for (const job of await pickJobs(MAX_PER_RUN)) {
        if ((await msSinceLastPost()) < spacingMs) break
        try {
          await record(job.id, await sendToFacebook(job), null)
          posted += 1
        } catch (error) {
          failed += 1
          state.lastError = { at: new Date().toISOString(), message: error.message }
          await record(job.id, null, error.message).catch(() => {})
          if (error.fbCode === 190) {
            state.pausedUntil = Date.now() + PAUSE_MS
            console.error('[facebook] ACCESS TOKEN REJECTED (OAuthException 190). Posting paused 24h; replace FACEBOOK_PAGE_ACCESS_TOKEN.')
          } else {
            console.warn('[facebook] post failed, will retry next run:', error.message)
          }
          break // stop this run on any failure; transient ones retry next tick
        }
      }
      return { posted, failed }
    } catch (error) {
      state.lastError = { at: new Date().toISOString(), message: String(error?.message || error).slice(0, 300) }
      console.error('[facebook] run failed:', state.lastError.message)
      return { error: true }
    } finally {
      if (conn) {
        await conn.query('SELECT RELEASE_LOCK(?)', [LOCK_NAME]).catch(() => {})
        conn.release()
      }
      state.running = false
    }
  }

  app.get('/api/admin/facebook', requireAdminAuth, async (req, res) => {
    let postedLast7Days = 0
    try {
      const [rows] = await pool.query(
        `SELECT COUNT(*) AS n FROM facebook_posts WHERE fb_post_id IS NOT NULL AND posted_at > DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 7 DAY)`
      )
      postedLast7Days = Number(rows[0]?.n) || 0
    } catch { /* table may not exist yet */ }
    const c = cfg()
    res.json({
      success: true,
      enabled: enabled(),
      pageIdSet: Boolean(c.pageId),
      tokenSet: Boolean(c.token),
      pausedUntil: state.pausedUntil > Date.now() ? new Date(state.pausedUntil).toISOString() : null,
      postedLast7Days,
      lastError: state.lastError,
    })
  })

  app.post('/api/admin/facebook/run', requireAdminAuth, async (req, res) => {
    if (state.running) return res.status(409).json({ success: false, error: 'A Facebook run is already in progress.' })
    res.json({ success: true, result: await postNewJobs() })
  })

  return { ensureTable, postNewJobs, buildMessage }
}
