// Free email job alerts: double opt-in subscribe, confirm, one-click
// unsubscribe, and the daily/weekly digest run from the hourly scheduler.
//
// One subscription row per email address (UNIQUE email). Subscribing again
// replaces the criteria, clears confirmed_at and sends a fresh confirmation,
// so nobody can change (or restart) someone else's alerts without access to
// that inbox. The unsubscribe token is kept so links in older digests work.
//
// Times written here come from the injected clock as JS Dates. Like the rest
// of server.js this assumes MySQL and Node share a timezone; if they differ,
// the "published since last send" window is off by that offset.
import crypto from 'crypto'

const ALERT_TIME_ZONE = 'America/New_York'
const SEND_HOUR_ET = 8
const CONFIRM_THROTTLE_MS = 10 * 60 * 1000
const CONFIRM_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000
const FIRST_SEND_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000
const MAX_LOOKBACK_MS = 31 * 24 * 60 * 60 * 1000
const MAX_JOBS_PER_EMAIL = 15
const MAX_KEYWORDS = 5
const EMPLOYMENT_TYPES = new Set(['full-time', 'part-time', 'temporary', 'contract'])
const FREQUENCIES = new Set(['daily', 'weekly'])
const TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/
const GENERIC_SUBSCRIBE_RESPONSE = {
  success: true,
  message: 'Check your email to confirm your job alert.',
}

function clean(value, maxLength) {
  const text = String(value ?? '').trim()
  return text.slice(0, maxLength)
}

function newToken() {
  return crypto.randomBytes(32).toString('base64url')
}

// Comma list -> "a, b" (max 5 terms, 40 chars each), or null.
export function parseKeywords(value) {
  const terms = String(value ?? '')
    .split(',')
    .map((term) => term.trim().replace(/\s+/g, ' ').slice(0, 40))
    .filter(Boolean)
  if (terms.length > MAX_KEYWORDS) return { error: `Use at most ${MAX_KEYWORDS} keywords.` }
  return { value: terms.length ? terms.join(', ') : null }
}

function etParts(date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: ALERT_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
      weekday: 'short',
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value])
  )
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour), weekday: parts.weekday }
}

// Daily: once per ET calendar day, from 8:00 ET. Weekly: Mondays from 8:00 ET.
export function isDue(subscription, now) {
  const today = etParts(now)
  if (today.hour < SEND_HOUR_ET) return false
  if (subscription.frequency === 'weekly' && today.weekday !== 'Mon') return false
  if (!subscription.last_sent_at) return true
  return etParts(new Date(subscription.last_sent_at)).day < today.day
}

export function jobMatches(subscription, job) {
  const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase()
  if (subscription.town && !same(subscription.town, job.city)) return false
  if (subscription.category && !same(subscription.category, job.industry)) return false
  if (subscription.employment_type && !same(subscription.employment_type, job.employment_type)) return false
  if (!subscription.keywords) return true
  const haystack = `${job.job_title || ''}\n${job.job_description || ''}`.toLowerCase()
  return subscription.keywords
    .split(',')
    .map((term) => term.trim().toLowerCase())
    .some((term) => term && haystack.includes(term))
}

function humanizeType(value) {
  return String(value || '')
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function describeCriteria(subscription) {
  const parts = []
  if (subscription.keywords) parts.push(`"${subscription.keywords}"`)
  if (subscription.employment_type) parts.push(humanizeType(subscription.employment_type))
  if (subscription.category) parts.push(subscription.category)
  if (subscription.town) parts.push(`in ${subscription.town}`)
  return parts.length ? parts.join(' · ') : 'all new local jobs'
}

export function register({
  app,
  pool,
  getMailer,
  getMailFrom,
  createIpRateLimiter,
  getRequestIp,
  requireAdminAuth,
  escapeHtml,
  formatPay = () => '',
  APP_BASE_URL,
  ipHashSecret = '',
  now: clock = () => new Date(),
  maxPerRun = 200,
  sendDelayMs = 1500,
}) {
  const base = String(APP_BASE_URL || '').replace(/\/+$/, '')
  const consumeSubscribeRate = createIpRateLimiter(60 * 60 * 1000, 5)
  const sleep = (ms) => (ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve())
  let digestRunning = false

  async function ensureTables() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS job_alert_subscriptions (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        email VARCHAR(255) NOT NULL,
        keywords VARCHAR(255) NULL,
        town VARCHAR(120) NULL,
        category VARCHAR(120) NULL,
        employment_type VARCHAR(32) NULL,
        frequency VARCHAR(10) NOT NULL DEFAULT 'weekly',
        confirm_token VARCHAR(64) NULL,
        unsubscribe_token VARCHAR(64) NOT NULL,
        confirm_sent_at DATETIME NULL,
        confirmed_at DATETIME NULL,
        unsubscribed_at DATETIME NULL,
        last_sent_at DATETIME NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_ip_hash CHAR(64) NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uniq_job_alert_email (email),
        UNIQUE KEY uniq_job_alert_confirm_token (confirm_token),
        UNIQUE KEY uniq_job_alert_unsubscribe_token (unsubscribe_token)
      )
    `)
    // One row per digest run (hourly), for the admin summary.
    // ponytail: never pruned; ~9k tiny rows a year.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS job_alert_runs (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        started_at DATETIME NOT NULL,
        due INT NOT NULL DEFAULT 0,
        sent INT NOT NULL DEFAULT 0,
        failed INT NOT NULL DEFAULT 0,
        PRIMARY KEY (id),
        KEY idx_job_alert_runs_started (started_at)
      )
    `)
  }

  function footer(subscription, reason) {
    const manageUrl = `${base}/?page=alerts-unsubscribe&token=${encodeURIComponent(subscription.unsubscribe_token)}`
    const postal = clean(process.env.ALERTS_POSTAL_ADDRESS, 300)
    return {
      text: ['--', reason, `Unsubscribe: ${manageUrl}`, postal].filter(Boolean).join('\n'),
      html: `
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0 12px">
        <p style="font-size:12px;color:#64748b;line-height:1.5;margin:0">
          ${escapeHtml(reason)}<br>
          <a href="${escapeHtml(manageUrl)}" style="color:#0891b2">Unsubscribe</a>${postal ? `<br>${escapeHtml(postal)}` : ''}
        </p>`,
    }
  }

  function wrapHtml(inner) {
    return `<!doctype html><html><body style="margin:0;padding:0;background:#f8fafc">
<div style="max-width:600px;margin:0 auto;padding:20px 16px;font-family:Arial,Helvetica,sans-serif;color:#0f172a">${inner}</div>
</body></html>`
  }

  async function sendConfirmation(subscription) {
    const transporter = getMailer()
    if (!transporter || !base) {
      console.error('[alerts] confirmation email not sent; mail or APP_BASE_URL is not configured.')
      return
    }
    const confirmUrl = `${base}/?page=alerts-confirm&token=${encodeURIComponent(subscription.confirm_token)}`
    const criteria = describeCriteria(subscription)
    const reason = 'You got this email because someone entered this address on TarboroJobs.com. If it was not you, ignore it and nothing more will be sent.'
    await transporter.sendMail({
      from: getMailFrom(),
      to: subscription.email,
      subject: 'Confirm your TarboroJobs job alert',
      text: [
        `Confirm your ${subscription.frequency} job alert for ${criteria}:`,
        confirmUrl,
        '',
        'This link expires in 7 days.',
        '',
        reason,
      ].join('\n'),
      html: wrapHtml(`
        <h1 style="font-size:20px;margin:0 0 12px">Confirm your job alert</h1>
        <p style="font-size:15px;line-height:1.5">You asked for a ${escapeHtml(subscription.frequency)} email of new jobs: <strong>${escapeHtml(criteria)}</strong>.</p>
        <p><a href="${escapeHtml(confirmUrl)}" style="display:inline-block;background:#22d3ee;color:#020617;font-weight:bold;text-decoration:none;padding:12px 20px;border-radius:12px">Confirm my alert</a></p>
        <p style="font-size:13px;color:#475569">This link expires in 7 days.</p>
        <p style="font-size:12px;color:#64748b">${escapeHtml(reason)}</p>`),
    })
  }

  function buildDigest(subscription, jobs, totalMatches) {
    const campaign = subscription.frequency === 'daily' ? 'daily' : 'weekly'
    const utm = `utm_source=alerts&utm_medium=email&utm_campaign=${campaign}`
    const allUrl = `${base}/?${utm}`
    const criteria = describeCriteria(subscription)
    const count = `${totalMatches} new job${totalMatches === 1 ? '' : 's'}`
    const reason = `You get this ${campaign} email because you confirmed a TarboroJobs job alert for ${criteria}.`
    const foot = footer(subscription, reason)

    const lines = jobs.map((job) => {
      const url = `${base}/jobs/${job.id}?${utm}`
      const pay = formatPay(job.pay_min, job.pay_max, job.pay_type)
      const meta = [job.business_name, job.city, pay, job.employment_type ? humanizeType(job.employment_type) : '']
        .filter(Boolean)
      return { job, url, meta }
    })

    const text = [
      `${count} for ${criteria}`,
      '',
      ...lines.flatMap(({ job, url, meta }) => [job.job_title, meta.join(' | '), url, '']),
      totalMatches > jobs.length ? `See all ${totalMatches} and more: ${allUrl}` : `See all jobs: ${allUrl}`,
      '',
      foot.text,
    ].join('\n')

    const html = wrapHtml(`
      <h1 style="font-size:20px;margin:0 0 4px">${escapeHtml(count)} near Tarboro</h1>
      <p style="font-size:13px;color:#475569;margin:0 0 16px">${escapeHtml(criteria)}</p>
      ${lines
        .map(
          ({ job, url, meta }) => `
      <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;padding:14px 16px;margin:0 0 10px">
        <a href="${escapeHtml(url)}" style="font-size:16px;font-weight:bold;color:#0e7490;text-decoration:none">${escapeHtml(job.job_title)}</a>
        <div style="font-size:13px;color:#475569;margin-top:4px">${meta.map((part) => escapeHtml(part)).join(' &middot; ')}</div>
      </div>`
        )
        .join('')}
      <p style="margin:16px 0"><a href="${escapeHtml(allUrl)}" style="color:#0891b2;font-weight:bold">See all jobs on TarboroJobs</a></p>
      ${foot.html}`)

    const unsubscribeUrl = `${base}/api/alerts/unsubscribe?token=${encodeURIComponent(subscription.unsubscribe_token)}`
    return {
      from: getMailFrom(),
      to: subscription.email,
      subject: `${count} for ${criteria} | TarboroJobs`,
      text,
      html,
      headers: {
        'List-Unsubscribe': `<${unsubscribeUrl}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    }
  }

  // Returns { skipped }, { busy: true } or { due, sent, failed }.
  async function runDigests({ trigger = 'schedule' } = {}) {
    const now = clock()
    if (etParts(now).hour < SEND_HOUR_ET) return { skipped: 'before_send_hour' }
    if (!clean(process.env.ALERTS_POSTAL_ADDRESS, 300)) {
      console.warn('[alerts] ALERTS_POSTAL_ADDRESS is not set; job alert digests are NOT sent (CAN-SPAM requires a postal address in commercial email).')
      return { skipped: 'no_postal_address' }
    }
    const transporter = getMailer()
    if (!transporter || !base) {
      console.warn('[alerts] mail or APP_BASE_URL is not configured; job alert digests are not sent.')
      return { skipped: 'mail_not_configured' }
    }
    if (digestRunning) return { busy: true }
    digestRunning = true
    let connection = null
    try {
      connection = await pool.getConnection()
      const [lockRows] = await connection.query(`SELECT GET_LOCK('tarborojobs_job_alerts', 0) AS got`)
      if (Number(lockRows[0]?.got) !== 1) return { busy: true }

      try {
        const [subscriptions] = await pool.query(
          `SELECT * FROM job_alert_subscriptions
           WHERE confirmed_at IS NOT NULL AND unsubscribed_at IS NULL
           ORDER BY id`
        )
        const due = subscriptions.filter((subscription) => isDue(subscription, now))
        const result = { due: due.length, sent: 0, failed: 0 }
        if (due.length) {
          const windowStart = (subscription) =>
            Math.max(
              subscription.last_sent_at ? new Date(subscription.last_sent_at).getTime() : now.getTime() - FIRST_SEND_LOOKBACK_MS,
              now.getTime() - MAX_LOOKBACK_MS
            )
          const since = new Date(Math.min(...due.map(windowStart)))
          // Same visibility rules as GET /api/jobposts. featured_until is
          // added at startup by featured.js; featured matches go first.
          const [jobs] = await pool.query(
            `SELECT jp.id, jp.job_title, jp.job_description, jp.city,
                    COALESCE(jp.industry, e.industry) AS industry,
                    jp.pay_min, jp.pay_max, jp.pay_type, jp.employment_type,
                    COALESCE(jp.published_at, jp.created_at) AS published_at,
                    jp.featured_until, e.business_name
             FROM job_posts jp
             INNER JOIN employers e ON e.id = jp.employer_id
             WHERE jp.status = 'open'
               AND (jp.expires_at IS NULL OR jp.expires_at > ?)
               AND e.access_status = 'active'
               AND e.onboarding_completed = 1
               AND COALESCE(jp.published_at, jp.created_at) > ?
             ORDER BY COALESCE(jp.published_at, jp.created_at) DESC`,
            [now, since]
          )

          for (const subscription of due) {
            if (result.sent + result.failed >= maxPerRun) break
            const start = windowStart(subscription)
            const isFeatured = (job) => !!job.featured_until && new Date(job.featured_until) > now
            const fresh = jobs.filter(
              (job) => new Date(job.published_at).getTime() > start && jobMatches(subscription, job)
            )
            const matches = [...fresh.filter(isFeatured), ...fresh.filter((job) => !isFeatured(job))]
            if (!matches.length) continue // nothing new: send nothing, advance nothing

            if (result.sent + result.failed > 0) await sleep(sendDelayMs)
            try {
              await transporter.sendMail(buildDigest(subscription, matches.slice(0, MAX_JOBS_PER_EMAIL), matches.length))
              await pool.query('UPDATE job_alert_subscriptions SET last_sent_at = ? WHERE id = ?', [now, subscription.id])
              result.sent += 1
            } catch (error) {
              result.failed += 1
              console.error(`[alerts] digest to subscription ${subscription.id} failed; retrying next run:`, error?.message || error)
            }
          }
        }
        await pool
          .query('INSERT INTO job_alert_runs (started_at, due, sent, failed) VALUES (?, ?, ?, ?)', [now, result.due, result.sent, result.failed])
          .catch((error) => console.error('[alerts] could not record run:', error?.message || error))
        if (result.sent || result.failed) {
          console.log(`[alerts] digests (${trigger}): due ${result.due}, sent ${result.sent}, failed ${result.failed}`)
        }
        return result
      } finally {
        await connection.query(`SELECT RELEASE_LOCK('tarborojobs_job_alerts')`).catch(() => {})
      }
    } finally {
      connection?.release()
      digestRunning = false
    }
  }

  app.post('/api/alerts/subscribe', async (req, res) => {
    const body = req.body || {}
    const email = clean(body.email, 255).toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, error: 'Enter a valid email address.' })
    }
    const keywords = parseKeywords(clean(body.keywords, 300))
    if (keywords.error) return res.status(400).json({ success: false, error: keywords.error })
    const employmentType = clean(body.employmentType, 32).toLowerCase() || null
    if (employmentType && !EMPLOYMENT_TYPES.has(employmentType)) {
      return res.status(400).json({ success: false, error: 'Unknown job type.' })
    }
    const frequency = clean(body.frequency, 10).toLowerCase() || 'weekly'
    if (!FREQUENCIES.has(frequency)) {
      return res.status(400).json({ success: false, error: 'Frequency must be daily or weekly.' })
    }
    const subscription = {
      email,
      keywords: keywords.value,
      town: clean(body.town, 120) || null,
      category: clean(body.category, 120) || null,
      employment_type: employmentType,
      frequency,
    }

    // Same answer whether the address is new, known, throttled or rate
    // limited, so the endpoint cannot be used to learn who subscribed.
    const ip = getRequestIp(req)
    if (!consumeSubscribeRate(ip)) return res.json(GENERIC_SUBSCRIBE_RESPONSE)

    try {
      const now = clock()
      const [rows] = await pool.query(
        'SELECT id, confirm_sent_at, unsubscribe_token FROM job_alert_subscriptions WHERE email = ?',
        [email]
      )
      const existing = rows[0]
      if (existing?.confirm_sent_at && now.getTime() - new Date(existing.confirm_sent_at).getTime() < CONFIRM_THROTTLE_MS) {
        return res.json(GENERIC_SUBSCRIBE_RESPONSE)
      }
      subscription.confirm_token = newToken()
      subscription.unsubscribe_token = existing?.unsubscribe_token || newToken()
      const ipHash = ip ? crypto.createHash('sha256').update(`${ip}|${ipHashSecret}`).digest('hex') : null
      // ponytail: two simultaneous requests for one address can both pass the
      // throttle check; worst case is two confirmation emails.
      await pool.query(
        `INSERT INTO job_alert_subscriptions
           (email, keywords, town, category, employment_type, frequency, confirm_token, unsubscribe_token, confirm_sent_at, created_at, created_ip_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           keywords = VALUES(keywords), town = VALUES(town), category = VALUES(category),
           employment_type = VALUES(employment_type), frequency = VALUES(frequency),
           confirm_token = VALUES(confirm_token), confirm_sent_at = VALUES(confirm_sent_at),
           confirmed_at = NULL, unsubscribed_at = NULL`,
        [
          email,
          subscription.keywords,
          subscription.town,
          subscription.category,
          subscription.employment_type,
          frequency,
          subscription.confirm_token,
          subscription.unsubscribe_token,
          now,
          now,
          ipHash,
        ]
      )
      res.json(GENERIC_SUBSCRIBE_RESPONSE)
      // Sent after responding so the response time does not reveal anything.
      sendConfirmation(subscription).catch((error) =>
        console.error('[alerts] confirmation email failed:', error?.message || error)
      )
    } catch (error) {
      console.error('POST /api/alerts/subscribe error:', error)
      res.status(500).json({ success: false, error: 'Could not save your alert. Please try again.' })
    }
  })

  app.get('/api/alerts/confirm', async (req, res) => {
    const token = String(req.query.token || '')
    try {
      const now = clock()
      const [result] = TOKEN_RE.test(token)
        ? await pool.query(
            `UPDATE job_alert_subscriptions SET confirmed_at = ?, confirm_token = NULL
             WHERE confirm_token = ? AND confirm_sent_at > ? AND unsubscribed_at IS NULL`,
            [now, token, new Date(now.getTime() - CONFIRM_TOKEN_TTL_MS)]
          )
        : [{ affectedRows: 0 }]
      if (!result.affectedRows) {
        return res.status(400).json({ success: false, error: 'This confirmation link is invalid, expired, or already used.' })
      }
      res.json({ success: true, message: 'Your job alert is confirmed.' })
    } catch (error) {
      console.error('GET /api/alerts/confirm error:', error)
      res.status(500).json({ success: false, error: 'Could not confirm your alert. Please try again.' })
    }
  })

  // GET for plain links, POST for RFC 8058 one-click (mail providers POST
  // "List-Unsubscribe=One-Click" to the List-Unsubscribe URL). Idempotent.
  async function unsubscribe(req, res) {
    const token = String(req.query.token || req.body?.token || '')
    try {
      const [result] = TOKEN_RE.test(token)
        ? await pool.query(
            `UPDATE job_alert_subscriptions SET unsubscribed_at = COALESCE(unsubscribed_at, ?), confirm_token = NULL
             WHERE unsubscribe_token = ?`,
            [clock(), token]
          )
        : [{ affectedRows: 0 }]
      if (!result.affectedRows) {
        return res.status(400).json({ success: false, error: 'This unsubscribe link is invalid.' })
      }
      res.json({ success: true, message: 'You are unsubscribed from TarboroJobs job alerts.' })
    } catch (error) {
      console.error(`${req.method} /api/alerts/unsubscribe error:`, error)
      res.status(500).json({ success: false, error: 'Could not unsubscribe. Please try again.' })
    }
  }
  app.get('/api/alerts/unsubscribe', unsubscribe)
  app.post('/api/alerts/unsubscribe', unsubscribe)

  app.get('/api/admin/alerts', requireAdminAuth, async (req, res) => {
    try {
      const weekAgo = new Date(clock().getTime() - 7 * 24 * 60 * 60 * 1000)
      const [[counts]] = await pool.query(
        `SELECT
           COALESCE(SUM(confirmed_at IS NULL AND unsubscribed_at IS NULL), 0) AS pending,
           COALESCE(SUM(confirmed_at IS NOT NULL AND unsubscribed_at IS NULL), 0) AS confirmed,
           COALESCE(SUM(unsubscribed_at IS NOT NULL), 0) AS unsubscribed
         FROM job_alert_subscriptions`
      )
      const [[runs]] = await pool.query(
        `SELECT MAX(started_at) AS last_run_at,
                COALESCE(SUM(CASE WHEN started_at > ? THEN sent ELSE 0 END), 0) AS sent_last_7_days
         FROM job_alert_runs`,
        [weekAgo]
      )
      res.json({
        success: true,
        pending: Number(counts.pending),
        confirmed: Number(counts.confirmed),
        unsubscribed: Number(counts.unsubscribed),
        last_run_at: runs.last_run_at || null,
        sent_last_7_days: Number(runs.sent_last_7_days),
        postal_address_set: Boolean(clean(process.env.ALERTS_POSTAL_ADDRESS, 300)),
      })
    } catch (error) {
      console.error('GET /api/admin/alerts error:', error)
      res.status(500).json({ success: false, error: 'Failed to load job alert stats.' })
    }
  })

  return { ensureTables, runDigests }
}
