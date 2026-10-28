// Daily email to the admin address(es): a usage pulse (visitors, jobs, people) plus the same roundup
// text the Facebook Page gets (copy-paste into a Facebook group by hand) and a one-click Facebook
// share link per job. Independent of the Facebook Page: needs only working mail. Once per
// America/New_York day, from 09:00 ET, even when there are no new jobs (the pulse is the point).
import { buildRoundup, etParts, SEND_HOUR_ET } from './facebook.js'

const LOCK_NAME = 'tarborojobs_share_pack'
const HOUR_MS = 60 * 60 * 1000

// Plain numbers for the daily email; any query that fails becomes '?' so the email still goes out.
export async function buildPulse(pool, now = new Date()) {
  const q = (sql, params = []) => pool.query(sql, params).then(([rows]) => rows, () => null)
  const num = (v) => (v == null || Number.isNaN(Number(v)) ? '?' : Number(v))
  const first = async (sql, params, ...keys) => {
    const row = (await q(sql, params))?.[0]
    return keys.map((k) => num(row?.[k]))
  }
  const named = (rows, key) => (rows ? rows.map((r) => ({ name: String(r[key]), n: Number(r.n) })) : '?')
  // ET midnight as a UTC instant (ET offsets are whole hours, so walk back hour by hour).
  const dayStart = (t) => {
    const day = etParts(t).day
    let s = new Date(Math.floor(t.getTime() / HOUR_MS) * HOUR_MS)
    while (etParts(new Date(s.getTime() - HOUR_MS)).day === day) s = new Date(s.getTime() - HOUR_MS)
    return s
  }
  const todayStart = dayStart(now)
  const yStart = dayStart(new Date(todayStart.getTime() - HOUR_MS))
  const yesterday = [yStart, todayStart]
  const dayAgo = new Date(now.getTime() - 24 * HOUR_MS)
  const traffic = async (from, to) => {
    const [visitors, pageViews, jobViews, applies, shares, signups, mobile] = await first(
      `SELECT COUNT(DISTINCT visitor_id) AS a,
              COALESCE(SUM(event_type = 'page_view'), 0) AS b,
              COALESCE(SUM(event_type = 'job_view'), 0) AS c,
              COALESCE(SUM(event_type IN ('apply_start', 'apply_submit', 'outbound_apply_click')), 0) AS d,
              COALESCE(SUM(event_type = 'share'), 0) AS e,
              COALESCE(SUM(event_type = 'alert_signup'), 0) AS f,
              COALESCE(SUM(event_type = 'page_view' AND device = 'mobile'), 0) AS g
       FROM analytics_events WHERE created_at >= ? AND created_at < ?`,
      [from, to],
      'a', 'b', 'c', 'd', 'e', 'f', 'g'
    )
    const mobilePct = pageViews === '?' || mobile === '?' ? '?' : pageViews ? Math.round((mobile / pageViews) * 100) : 0
    return { visitors, pageViews, jobViews, applies, shares, signups, mobilePct }
  }
  const sources = await q(
    `SELECT COALESCE(NULLIF(utm_source, ''), NULLIF(referrer_host, ''), 'direct') AS src, COUNT(DISTINCT visitor_id) AS n
     FROM analytics_events WHERE event_type = 'page_view' AND created_at >= ? AND created_at < ?
     GROUP BY src ORDER BY n DESC LIMIT 3`,
    yesterday
  )
  const openNow = `status = 'open' AND (expires_at IS NULL OR expires_at > ?)`
  const bySource = await q(`SELECT source, COUNT(*) AS n FROM job_posts WHERE source IS NOT NULL AND ${openNow} GROUP BY source ORDER BY n DESC`, [now])
  const [open] = await first(`SELECT COUNT(*) AS a FROM job_posts WHERE ${openNow}`, [now], 'a')
  const [newJobs] = await first(`SELECT COUNT(*) AS a FROM job_posts WHERE status = 'open' AND COALESCE(published_at, created_at) > ?`, [dayAgo], 'a')
  const [closedJobs] = await first(`SELECT COUNT(*) AS a FROM job_posts WHERE status IN ('closed', 'expired') AND updated_at > ?`, [dayAgo], 'a')
  const [subscribers, newSubscribers] = await first(
    `SELECT COUNT(*) AS a, COALESCE(SUM(confirmed_at >= ? AND confirmed_at < ?), 0) AS b
     FROM job_alert_subscriptions WHERE confirmed_at IS NOT NULL AND unsubscribed_at IS NULL`,
    yesterday,
    'a', 'b'
  )
  // Scraped listings hang off auto-created employers (listings+<slug>@...): not real sign-ups.
  const [employers, newEmployers] = await first(
    `SELECT COUNT(*) AS a, COALESCE(SUM(created_at >= ? AND created_at < ?), 0) AS b
     FROM employers WHERE email NOT LIKE 'listings+%@tarborojobs.com'`,
    yesterday,
    'a', 'b'
  )
  const [resumes] = await first('SELECT COUNT(*) AS a FROM resume_checks WHERE created_at >= ? AND created_at < ?', yesterday, 'a')
  const [applications] = await first('SELECT COUNT(*) AS a FROM job_seekers WHERE created_at >= ? AND created_at < ?', yesterday, 'a')
  return {
    yesterdayDay: etParts(yStart).day,
    yesterday: { ...(await traffic(...yesterday)), sources: named(sources, 'src') },
    week: await traffic(new Date(now.getTime() - 7 * 24 * HOUR_MS), now),
    jobs: { open, newJobs, closedJobs, bySource: named(bySource, 'source') },
    people: { subscribers, newSubscribers, employers, newEmployers, resumes, applications },
  }
}

const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

export function register({
  app,
  pool,
  getMailer,
  getMailFrom,
  requireAdminAuth,
  formatPay,
  APP_BASE_URL,
  adminEmails = [],
  now: clock = () => new Date(),
}) {
  const base = String(APP_BASE_URL || '').replace(/\/+$/, '')
  // SHARE_PACK_TO: who gets the daily email (comma list). Lets a helper with a
  // working Facebook account post for the owner without being made a site admin.
  const recipients = String(process.env.SHARE_PACK_TO || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
  if (!recipients.length) recipients.push(...adminEmails)
  // ponytail: in-memory guard only covers a failed bookkeeping write; the table + GET_LOCK cover processes.
  const state = { running: false, lastSentDay: '' }

  async function ensureTable() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS share_pack_runs (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        sent_at DATETIME NOT NULL,
        job_count INT NOT NULL DEFAULT 0,
        featured_count INT NOT NULL DEFAULT 0,
        recipients VARCHAR(500) NULL DEFAULT NULL,
        PRIMARY KEY (id),
        KEY idx_share_pack_sent (sent_at)
      )
    `)
  }

  async function lastRun() {
    const [rows] = await pool.query('SELECT sent_at, job_count FROM share_pack_runs ORDER BY sent_at DESC LIMIT 1')
    return rows[0] ? { at: new Date(rows[0].sent_at), jobCount: Number(rows[0].job_count) || 0 } : null
  }

  function pulseSections(pulse) {
    const { yesterday: y, week: w, jobs: j, people: p } = pulse
    const traffic = (t) =>
      `Visitors ${t.visitors} · Page views ${t.pageViews} · Job views ${t.jobViews} · Apply clicks ${t.applies} · Shares ${t.shares} · Alert signups ${t.signups}`
    const list = (items) => (Array.isArray(items) ? items.map((s) => `${s.name} ${s.n}`).join(' · ') || 'none' : items)
    return [
      [`Yesterday (${pulse.yesterdayDay})`, [traffic(y), `Top sources: ${list(y.sources)}`, `Mobile: ${y.mobilePct}% of page views`]],
      ['Last 7 days', [traffic(w)]],
      ['Jobs', [`Open now ${j.open} · New in last 24h ${j.newJobs} · Closed/expired in last 24h ${j.closedJobs}`, `By source: ${list(j.bySource)}`]],
      [
        'People',
        [
          `Alert subscribers ${p.subscribers} (+${p.newSubscribers} yesterday) · Employers ${p.employers} (+${p.newEmployers} yesterday)`,
          `Resume checks yesterday ${p.resumes} · Job applications yesterday ${p.applications}`,
        ],
      ],
    ]
  }

  function buildPack(roundup, pulse) {
    const n = roundup.jobs.length
    const sections = pulseSections(pulse)
    const items = roundup.jobs.map((job) => {
      const url = `${base}/jobs/${job.id}`
      const share = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(`${url}?utm_source=share&utm_medium=facebook`)}`
      return { job, url, share }
    })
    const note = `${roundup.featuredCount} of these ${n} job${n === 1 ? ' is' : 's are'} featured (paid).`
    const shareText = n
      ? [
          "Today's jobs to share",
          '',
          '1) Copy and paste this into your Facebook groups:',
          '',
          roundup.text,
          '',
          '2) Or share each job on its own:',
          '',
          ...items.flatMap(({ job, url, share }) => [`• ${job.job_title}`, `  Share this job to Facebook: ${share}`, `  Job page: ${url}`, '']),
          note,
        ]
      : ['No new jobs to share today.']
    const text = ['TarboroJobs daily', '', ...sections.flatMap(([title, lines]) => [title.toUpperCase(), ...lines, '']), ...shareText].join('\n')
    const pulseHtml = sections
      .map(
        ([title, lines]) => `<h2 style="font-size:15px;margin:16px 0 4px">${esc(title)}</h2>
${lines.map((l) => `<p style="font-size:14px;margin:0 0 4px">${esc(l)}</p>`).join('\n')}`
      )
      .join('\n')
    const shareHtml = n
      ? `<h2 style="font-size:17px;margin:24px 0 12px">Today's jobs to share</h2>
<p style="font-size:14px;margin:0 0 8px"><strong>1) Copy and paste this into your Facebook groups:</strong></p>
<pre style="font-family:Consolas,Menlo,monospace;font-size:13px;line-height:1.5;background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;padding:12px;white-space:pre-wrap;word-break:break-word">${esc(roundup.text)}</pre>
<p style="font-size:14px;margin:20px 0 8px"><strong>2) Or share each job on its own:</strong></p>
${items
  .map(
    ({ job, url, share }) => `<div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;padding:10px 12px;margin:0 0 8px">
<div style="font-size:15px;font-weight:bold">${esc(job.job_title)}</div>
<div style="font-size:13px;margin-top:4px"><a href="${esc(share)}" style="color:#0891b2;font-weight:bold">Share this job to Facebook</a> &middot; <a href="${esc(url)}" style="color:#475569">${esc(url)}</a></div>
</div>`
  )
  .join('\n')}
<p style="font-size:13px;color:#475569;margin:16px 0 0">${esc(note)}</p>`
      : '<p style="font-size:14px;margin:20px 0 0">No new jobs to share today.</p>'
    const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f8fafc">
<div style="max-width:640px;margin:0 auto;padding:20px 16px;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
<h1 style="font-size:20px;margin:0 0 12px">TarboroJobs daily</h1>
${pulseHtml}
${shareHtml}
</div></body></html>`
    return { subject: `TarboroJobs daily — ${n} new jobs · ${pulse.yesterday.visitors} visitors yesterday`, text, html }
  }

  // Never throws. Returns { sent, jobCount } or { skipped } / { busy } / { error }.
  async function sendDailyPack({ force = false } = {}) {
    if (state.running) return { skipped: 'busy' }
    const now = clock()
    if (!force && etParts(now).hour < SEND_HOUR_ET) return { skipped: 'before_send_hour' }
    if (!recipients.length) return { skipped: 'no_recipients' }
    const transporter = getMailer()
    if (!transporter || !base) return { skipped: 'mail_not_configured' }
    state.running = true
    let conn
    try {
      conn = await pool.getConnection()
      const [[lock]] = await conn.query('SELECT GET_LOCK(?, 0) AS got', [LOCK_NAME])
      if (Number(lock?.got) !== 1) return { skipped: 'busy' }
      const today = etParts(now).day
      if (!force) {
        const last = await lastRun()
        if (state.lastSentDay === today || (last && etParts(last.at).day === today)) return { skipped: 'already_sent' }
      }
      const roundup = await buildRoundup({ pool, formatPay, APP_BASE_URL, now })
      const pack = buildPack(roundup, await buildPulse(pool, now))
      await transporter.sendMail({ from: getMailFrom(), to: recipients.join(', '), ...pack })
      state.lastSentDay = today
      await pool
        .query('INSERT INTO share_pack_runs (sent_at, job_count, featured_count, recipients) VALUES (?, ?, ?, ?)', [
          now,
          roundup.jobs.length,
          roundup.featuredCount,
          recipients.join(',').slice(0, 500),
        ])
        .catch((error) => console.error('[share-pack] could not record run:', error?.message || error))
      console.log(`[share-pack] sent ${roundup.jobs.length} job(s) to ${recipients.length} address(es)`)
      return { sent: true, jobCount: roundup.jobs.length }
    } catch (error) {
      console.error('[share-pack] failed:', error?.message || error)
      return { error: true }
    } finally {
      if (conn) {
        await conn.query('SELECT RELEASE_LOCK(?)', [LOCK_NAME]).catch(() => {})
        conn.release()
      }
      state.running = false
    }
  }

  // First hour-aligned moment (UTC offsets are whole hours in ET) that is >= 09:00 ET on a day after lastDay.
  function nextRunAfter(lastDay, now) {
    let t = new Date(Math.floor(now.getTime() / HOUR_MS) * HOUR_MS)
    for (let i = 0; i < 72; i += 1, t = new Date(t.getTime() + HOUR_MS)) {
      const p = etParts(t)
      if (p.hour >= SEND_HOUR_ET && p.day > lastDay) return t < now ? now : t
    }
    return now
  }

  app.get('/api/admin/share-pack', requireAdminAuth, async (req, res) => {
    try {
      const last = await lastRun()
      const now = clock()
      res.json({
        success: true,
        lastSentAt: last ? last.at.toISOString() : null,
        lastJobCount: last ? last.jobCount : 0,
        nextRunAfter: nextRunAfter(last ? etParts(last.at).day : '', now).toISOString(),
        recipients: recipients.length,
        pulse: await buildPulse(pool, now),
      })
    } catch (error) {
      console.error('GET /api/admin/share-pack error:', error)
      res.status(500).json({ success: false, error: 'Failed to load share pack status.' })
    }
  })

  app.post('/api/admin/share-pack/send', requireAdminAuth, async (req, res) => {
    const force = String(req.query?.force || '') === '1'
    const result = await sendDailyPack({ force })
    if (result.skipped === 'already_sent' || result.skipped === 'busy') {
      return res.status(409).json({ success: false, error: 'A share pack was already sent today (or one is sending). Add ?force=1 to send again.', result })
    }
    if (result.skipped === 'mail_not_configured' || result.skipped === 'no_recipients' || result.error) {
      return res.status(503).json({ success: false, error: 'Could not send the share pack.', result })
    }
    res.json({ success: true, result })
  })

  return { ensureTable, sendDailyPack, buildPack }
}
