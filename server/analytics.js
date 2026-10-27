// First-party, cookie-free, IP-free usage analytics.
// registerAnalytics wires POST /api/events and GET /api/admin/analytics and
// returns { ensureTable, purgeOldEvents } for server.js startup / the hourly tick.
import express from 'express'

export const EVENT_TYPES = new Set([
  'page_view', 'job_view', 'apply_start', 'apply_submit', 'outbound_apply_click',
  'alert_signup', 'checkout_start', 'tool_start', 'share',
])
export const PRODUCTS = ['resume_check', 'cover_letter', 'interview_prep', 'employer_plan', 'job_post', 'featured', 'bundle']
const DEVICES = new Set(['mobile', 'desktop', 'tablet'])
const BOT_RE = /bot|crawl|spider|slurp|headless|lighthouse|pingdom|uptime|monitor|facebookexternalhit|preview|python-requests|curl\/|wget|axios|node-fetch|go-http|java\//i
const RETENTION_DAYS = 400
const MAX_BATCH = 20

const cap = (v, n) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null)

// Returns a row array for the INSERT, or null when the event is not storable.
export function normalizeEvent(e) {
  if (!e || typeof e !== 'object' || !EVENT_TYPES.has(e.type)) return null
  const visitor = typeof e.visitor_id === 'string' && /^[A-Za-z0-9]{26}$/.test(e.visitor_id) ? e.visitor_id : null
  const session = typeof e.session_id === 'string' && /^[\w-]{1,32}$/.test(e.session_id) ? e.session_id : null
  if (!visitor || !session) return null
  const path = cap(e.path, 200)
  const jobId = Number.parseInt(e.job_id, 10)
  const product = PRODUCTS.includes(e.product) ? e.product : null
  return [
    e.type,
    path && path.startsWith('/') ? path.split(/[?#]/)[0] : '/',
    Number.isInteger(jobId) && jobId > 0 ? jobId : null,
    cap(e.referrer_host, 100),
    cap(e.utm_source, 100), cap(e.utm_medium, 100), cap(e.utm_campaign, 100),
    DEVICES.has(e.device) ? e.device : 'desktop',
    visitor, session, product,
  ]
}

export function parseEvents(body) {
  let data = body
  if (typeof data === 'string') {
    try { data = JSON.parse(data) } catch { return [] }
  }
  const list = Array.isArray(data) ? data : data && typeof data === 'object' ? (Array.isArray(data.events) ? data.events : [data]) : []
  return list.slice(0, MAX_BATCH).map(normalizeEvent).filter(Boolean)
}

export function registerAnalytics({ app, pool, createIpRateLimiter, getRequestIp, requireAdminAuth, prices = {} }) {
  const consume = createIpRateLimiter(60 * 1000, 120)

  async function ensureTable() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS analytics_events (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        event_type VARCHAR(32) NOT NULL,
        path VARCHAR(200) NOT NULL,
        job_id INT NULL DEFAULT NULL,
        referrer_host VARCHAR(100) NULL DEFAULT NULL,
        utm_source VARCHAR(100) NULL DEFAULT NULL,
        utm_medium VARCHAR(100) NULL DEFAULT NULL,
        utm_campaign VARCHAR(100) NULL DEFAULT NULL,
        device ENUM('mobile','desktop','tablet') NOT NULL DEFAULT 'desktop',
        visitor_id CHAR(26) NOT NULL,
        session_id VARCHAR(32) NOT NULL,
        product VARCHAR(32) NULL DEFAULT NULL,
        PRIMARY KEY (id),
        KEY idx_analytics_created (created_at),
        KEY idx_analytics_type_created (event_type, created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `)
  }

  async function purgeOldEvents() {
    await pool.query(`DELETE FROM analytics_events WHERE created_at < NOW() - INTERVAL ${RETENTION_DAYS} DAY LIMIT 20000`)
  }

  // sendBeacon posts text/plain; the global express.json ignores it, so parse here.
  app.post('/api/events', express.text({ type: () => true, limit: '16kb' }), (req, res) => {
    res.status(204).end()
    try {
      if (BOT_RE.test(req.headers['user-agent'] || '')) return
      if (!consume(getRequestIp(req))) return
      const rows = parseEvents(req.body)
      if (!rows.length) return
      Promise.resolve(pool.query(
        `INSERT INTO analytics_events (event_type, path, job_id, referrer_host, utm_source, utm_medium, utm_campaign, device, visitor_id, session_id, product) VALUES ?`,
        [rows]
      )).catch((error) => console.error('[analytics] insert failed:', error?.message || error))
    } catch (error) {
      console.error('[analytics] event handling failed:', error?.message || error)
    }
  })

  app.get('/api/admin/analytics', requireAdminAuth, async (req, res) => {
    try {
      const days = Math.min(365, Math.max(1, Number.parseInt(req.query.days, 10) || 30))
      const span = Math.max(days, 8)
      const q = async (sql) => (await pool.query(sql))[0]
      const since = `created_at >= CURDATE() - INTERVAL ${span - 1} DAY`
      const sinceDays = `created_at >= CURDATE() - INTERVAL ${days - 1} DAY`
      const paidSince = `COALESCE(paid_at, created_at) >= CURDATE() - INTERVAL ${days - 1} DAY`
      // Orders paid with a Job Seeker Kit credit are revenue of the kit, not of the tool.
      const notCredit = `COALESCE(paid_via, '') <> 'credit'`
      const num = (v) => Number(v) || 0

      const [today, daily, pages, jobs, referrers, campaigns, devices, types, checkouts, resume, cover, prep, employer, jobPost, bundle, featured] = await Promise.all([
        q(`SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS today`),
        q(`SELECT DATE_FORMAT(created_at, '%Y-%m-%d') AS day, COUNT(DISTINCT visitor_id) AS visitors, SUM(event_type = 'page_view') AS page_views
           FROM analytics_events WHERE ${since} GROUP BY day ORDER BY day`),
        q(`SELECT path, COUNT(*) AS views FROM analytics_events WHERE event_type = 'page_view' AND ${sinceDays} GROUP BY path ORDER BY views DESC LIMIT 15`),
        q(`SELECT a.job_id, jp.job_title, COUNT(*) AS views, COUNT(DISTINCT a.visitor_id) AS visitors, COALESCE(s.shares, 0) AS shares
           FROM analytics_events a LEFT JOIN job_posts jp ON jp.id = a.job_id
           LEFT JOIN (SELECT job_id, COUNT(*) AS shares FROM analytics_events
                      WHERE event_type = 'share' AND job_id IS NOT NULL AND ${sinceDays} GROUP BY job_id) s ON s.job_id = a.job_id
           WHERE a.event_type = 'job_view' AND a.job_id IS NOT NULL AND a.${sinceDays} GROUP BY a.job_id, jp.job_title, s.shares ORDER BY views DESC LIMIT 10`),
        q(`SELECT referrer_host, COUNT(DISTINCT visitor_id) AS visitors FROM analytics_events
           WHERE referrer_host IS NOT NULL AND ${sinceDays} GROUP BY referrer_host ORDER BY visitors DESC LIMIT 10`),
        q(`SELECT utm_campaign, utm_source, utm_medium, COUNT(DISTINCT visitor_id) AS visitors FROM analytics_events
           WHERE utm_campaign IS NOT NULL AND ${sinceDays} GROUP BY utm_campaign, utm_source, utm_medium ORDER BY visitors DESC LIMIT 10`),
        q(`SELECT device, COUNT(DISTINCT visitor_id) AS visitors FROM analytics_events WHERE ${sinceDays} GROUP BY device`),
        q(`SELECT event_type, COUNT(*) AS events, COUNT(DISTINCT session_id) AS sessions FROM analytics_events WHERE ${sinceDays} GROUP BY event_type`),
        q(`SELECT product, COUNT(*) AS starts FROM analytics_events WHERE event_type = 'checkout_start' AND ${sinceDays} GROUP BY product`),
        q(`SELECT COUNT(*) AS orders FROM resume_checks WHERE payment_status = 'paid' AND ${notCredit} AND ${paidSince}`),
        q(`SELECT COUNT(*) AS orders, COALESCE(SUM(price_cents), 0) AS cents FROM cover_letter_requests WHERE payment_status = 'paid' AND ${notCredit} AND ${paidSince}`),
        q(`SELECT COUNT(*) AS orders, COALESCE(SUM(price_cents), 0) AS cents FROM interview_prep_requests WHERE payment_status = 'paid' AND ${notCredit} AND ${paidSince}`),
        q(`SELECT COUNT(*) AS orders, COALESCE(SUM(amount_cents), 0) AS cents FROM employer_pending_checkouts WHERE payment_status = 'paid' AND ${paidSince}`),
        q(`SELECT COUNT(*) AS orders, COALESCE(SUM(price_cents), 0) AS cents FROM job_post_orders WHERE payment_status = 'paid' AND ${paidSince}`),
        q(`SELECT COUNT(*) AS orders, COALESCE(SUM(price_cents), 0) AS cents FROM bundle_orders WHERE status = 'paid' AND ${paidSince}`),
        q(`SELECT COUNT(*) AS orders, COALESCE(SUM(price_cents), 0) AS cents FROM featured_orders WHERE status = 'paid' AND ${paidSince}`),
      ])

      const byType = Object.fromEntries(types.map((r) => [r.event_type, { events: num(r.events), sessions: num(r.sessions) }]))
      const sessions = (t) => byType[t]?.sessions || 0
      const dailyAll = daily.map((r) => ({ day: r.day, visitors: num(r.visitors), page_views: num(r.page_views) }))
      const todayKey = today[0]?.today
      const todayRow = dailyAll.find((d) => d.day === todayKey) || { visitors: 0, page_views: 0 }
      const prior = dailyAll.filter((d) => d.day !== todayKey).slice(-7)
      const avg = (k) => Math.round((prior.reduce((s, d) => s + d[k], 0) / 7) * 10) / 10

      const starts = Object.fromEntries(checkouts.map((r) => [r.product, num(r.starts)]))
      const paid = {
        resume_check: { orders: num(resume[0]?.orders), cents: num(resume[0]?.orders) * num(prices.resume_check) },
        cover_letter: { orders: num(cover[0]?.orders), cents: num(cover[0]?.cents) },
        interview_prep: { orders: num(prep[0]?.orders), cents: num(prep[0]?.cents) },
        employer_plan: { orders: num(employer[0]?.orders), cents: num(employer[0]?.cents) },
        job_post: { orders: num(jobPost[0]?.orders), cents: num(jobPost[0]?.cents) },
        bundle: { orders: num(bundle[0]?.orders), cents: num(bundle[0]?.cents) },
        featured: { orders: num(featured[0]?.orders), cents: num(featured[0]?.cents) },
      }
      const products = PRODUCTS.map((product) => ({
        product,
        checkout_starts: starts[product] || 0,
        purchases: paid[product]?.orders || 0,
        revenue_cents: paid[product]?.cents || 0,
      }))

      res.json({
        success: true,
        days,
        summary: {
          today_visitors: todayRow.visitors,
          today_page_views: todayRow.page_views,
          avg7_visitors: avg('visitors'),
          avg7_page_views: avg('page_views'),
          alert_signups: byType.alert_signup?.events || 0,
          shares: byType.share?.events || 0,
          revenue_cents: products.reduce((s, p) => s + p.revenue_cents, 0),
        },
        daily: dailyAll.slice(-days),
        top_pages: pages.map((r) => ({ path: r.path, views: num(r.views) })),
        top_jobs: jobs.map((r) => ({ job_id: r.job_id, title: r.job_title || null, views: num(r.views), visitors: num(r.visitors), shares: num(r.shares) })),
        referrers: referrers.map((r) => ({ host: r.referrer_host, visitors: num(r.visitors) })),
        campaigns: campaigns.map((r) => ({ campaign: r.utm_campaign, source: r.utm_source, medium: r.utm_medium, visitors: num(r.visitors) })),
        devices: devices.map((r) => ({ device: r.device, visitors: num(r.visitors) })),
        funnel: {
          job_view: sessions('job_view'),
          apply_start: sessions('apply_start'),
          outbound_apply_click: sessions('outbound_apply_click'),
          apply_submit: sessions('apply_submit'),
        },
        products,
      })
    } catch (error) {
      console.error('[analytics] report failed:', error)
      res.status(500).json({ success: false, error: 'Could not load analytics.' })
    }
  })

  return { ensureTable, purgeOldEvents }
}
