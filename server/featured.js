// Featured listings ($19/week via Square quick pay) and "claim this listing"
// for the auto-created employers behind scraped jobs.
// register() wires the routes and returns { ensureTables, tryHandlePayment,
// isClaimable } for server.js startup, the Square webhook and job detail.
import crypto from 'crypto'
import bcrypt from 'bcryptjs'

export const FEATURED_NOTE_PREFIX = 'featured:'
export const MAX_FEATURED_SLOTS = 5
const MAX_WEEKS = 4
const SET_PASSWORD_HOURS = 72

// Rows from listPublicJobPostRows carry is_featured, computed by MySQL
// (featured_until > CURRENT_TIMESTAMP) so the app and DB clocks never disagree.
export function isFeatured(row) {
  return Number(row?.is_featured) === 1
}

// Featured jobs first, then everything else in the incoming (newest-first)
// order. With more than MAX_FEATURED_SLOTS featured, a random MAX_FEATURED_SLOTS
// of them take the top each call; the rest stay badged in date order.
export function orderFeaturedFirst(rows, random = Math.random) {
  const featured = rows.filter(isFeatured)
  if (!featured.length) return rows
  if (featured.length > MAX_FEATURED_SLOTS) {
    for (let i = featured.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1))
      ;[featured[i], featured[j]] = [featured[j], featured[i]]
    }
    featured.length = MAX_FEATURED_SLOTS
  }
  const top = new Set(featured)
  return [...featured, ...rows.filter((row) => !top.has(row))]
}

function hostOf(value) {
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
}

// True when the email's domain is, contains, or sits under one of the URLs'
// hosts (a@ecuhealth.org matches jobs.ecuhealth.org). A hint for the admin only.
export function emailDomainMatches(email, urls) {
  const domain = String(email || '').toLowerCase().split('@')[1] || ''
  if (!domain) return false
  return urls.map(hostOf).some((host) => host && (host === domain || host.endsWith(`.${domain}`) || domain.endsWith(`.${host}`)))
}

const clean = (value, max) => String(value ?? '').trim().slice(0, max)

export function register({
  app,
  pool,
  requireEmployerAuth,
  requireEligibleEmployer,
  requireAdminAuth,
  createIpRateLimiter,
  rateLimitByIp,
  createSquareQuickPayLink,
  tableColumnExists,
  getMailer,
  getMailFrom,
  escapeHtml,
  adminEmails = [],
  buildPasswordResetUrl,
  sha256,
  APP_BASE_URL = '',
}) {
  const weekPriceCents = () => Math.max(100, Number.parseInt(process.env.FEATURED_PRICE_CENTS, 10) || 1900)
  const base = String(APP_BASE_URL || '').replace(/\/+$/, '')
  const consumeClaimRate = createIpRateLimiter(60 * 60 * 1000, 5)

  async function ensureTables() {
    if (!(await tableColumnExists('job_posts', 'featured_until'))) {
      await pool.query('ALTER TABLE job_posts ADD COLUMN featured_until DATETIME NULL DEFAULT NULL')
    }
    await pool.query(`
      CREATE TABLE IF NOT EXISTS featured_orders (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        token VARCHAR(64) NOT NULL,
        job_id BIGINT UNSIGNED NOT NULL,
        employer_id BIGINT UNSIGNED NOT NULL,
        weeks TINYINT UNSIGNED NOT NULL,
        price_cents INT NOT NULL,
        status VARCHAR(16) NOT NULL DEFAULT 'pending',
        square_order_id VARCHAR(255) NULL DEFAULT NULL,
        square_payment_id VARCHAR(255) NULL DEFAULT NULL,
        square_checkout_url TEXT NULL,
        paid_at DATETIME NULL DEFAULT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_featured_orders_token (token),
        KEY idx_featured_orders_job (job_id, status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS claim_requests (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        job_id BIGINT UNSIGNED NOT NULL,
        employer_id BIGINT UNSIGNED NOT NULL,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL,
        phone VARCHAR(100) NULL DEFAULT NULL,
        organization VARCHAR(255) NULL DEFAULT NULL,
        role VARCHAR(255) NULL DEFAULT NULL,
        message TEXT NULL,
        status VARCHAR(16) NOT NULL DEFAULT 'pending',
        employer_user_id BIGINT UNSIGNED NULL DEFAULT NULL,
        reviewed_at DATETIME NULL DEFAULT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_claim_requests_status (status, id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `)
  }

  async function sendMail(to, subject, lines) {
    const transporter = getMailer()
    if (!transporter || !to || (Array.isArray(to) && !to.length)) return false
    const body = lines.filter(Boolean)
    await transporter.sendMail({
      from: getMailFrom(),
      to,
      subject,
      text: body.join('\n\n'),
      html: body.map((line) => `<p>${escapeHtml(line)}</p>`).join(''),
    })
    return true
  }

  // ── Featured checkout ──────────────────────────────────────────────────────
  app.post('/api/employer/jobs/:id/feature', requireEmployerAuth, requireEligibleEmployer, async (req, res) => {
    try {
      const employerId = req.auth.employer_id
      const jobId = Number.parseInt(req.params.id, 10) || 0
      const weeks = Number(req.body?.weeks)
      if (!Number.isInteger(weeks) || weeks < 1 || weeks > MAX_WEEKS) {
        return res.status(400).json({ success: false, error: `Choose 1 to ${MAX_WEEKS} weeks.` })
      }

      // Another employer's job and a closed job look the same: not found.
      const [jobs] = await pool.query(
        `SELECT id, job_title FROM job_posts
         WHERE id = ? AND employer_id = ? AND status = 'open'
           AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
         LIMIT 1`,
        [jobId, employerId]
      )
      const job = jobs[0]
      if (!job) return res.status(404).json({ success: false, error: 'Job not found or not open.' })

      // Repeat clicks reuse the open link instead of opening a second payment.
      const priceCents = weekPriceCents() * weeks
      const [existing] = await pool.query(
        `SELECT square_checkout_url FROM featured_orders
         WHERE job_id = ? AND employer_id = ? AND weeks = ? AND price_cents = ?
           AND status = 'pending' AND square_checkout_url IS NOT NULL
         ORDER BY id DESC LIMIT 1`,
        [job.id, employerId, weeks, priceCents]
      )
      if (existing[0]) return res.json({ success: true, checkoutUrl: existing[0].square_checkout_url, reused: true })

      const token = `ft_${crypto.randomBytes(18).toString('base64url')}`
      const [inserted] = await pool.query(
        `INSERT INTO featured_orders (token, job_id, employer_id, weeks, price_cents, status) VALUES (?, ?, ?, ?, ?, 'pending')`,
        [token, job.id, employerId, weeks, priceCents]
      )
      const { checkoutUrl, orderId } = await createSquareQuickPayLink({
        name: `Featured job listing, ${weeks} week${weeks > 1 ? 's' : ''}`,
        priceCents,
        currency: 'USD',
        note: `${FEATURED_NOTE_PREFIX}${token}`,
        redirectUrl: `${base}/?page=employer-dashboard&featured=1`,
      })
      await pool.query('UPDATE featured_orders SET square_checkout_url = ?, square_order_id = ? WHERE id = ?', [
        checkoutUrl,
        orderId,
        inserted.insertId,
      ])
      res.json({ success: true, checkoutUrl })
    } catch (error) {
      console.error('[featured] checkout failed:', error?.message || error)
      res.status(502).json({ success: false, error: 'Could not start checkout. Please try again.' })
    }
  })

  // Called by the Square webhook with a payment fetched from the Square API.
  // Returns 'featured' when the note belongs to a featured order. A completed,
  // USD, full-price payment marks the order paid and extends featured_until;
  // both commit together and only the first delivery flips the order, so
  // replays and concurrent deliveries never extend twice.
  async function tryHandlePayment(payment) {
    const note = clean(payment?.note, 500)
    if (!note.startsWith(FEATURED_NOTE_PREFIX)) return null
    const token = note.slice(FEATURED_NOTE_PREFIX.length).trim()
    if (!token) return null

    const [rows] = await pool.query('SELECT * FROM featured_orders WHERE token = ? LIMIT 1', [token])
    const order = rows[0]
    if (!order || order.status === 'paid') return 'featured'
    if (String(payment.status || '').toLowerCase() !== 'completed') return 'featured'

    const paidCents = Number(payment.amount_money?.amount) || 0
    const paidCurrency = String(payment.amount_money?.currency || '').toUpperCase()
    if (paidCents < Number(order.price_cents) || paidCurrency !== 'USD') {
      console.error(`[featured] ${token}: payment ${payment.id} of ${paidCents} ${paidCurrency} does not cover ${order.price_cents} USD; not marking paid`)
      return 'featured'
    }

    const connection = await pool.getConnection()
    try {
      await connection.beginTransaction()
      const [flip] = await connection.query(
        `UPDATE featured_orders
         SET status = 'paid', paid_at = CURRENT_TIMESTAMP, square_payment_id = ?, square_order_id = COALESCE(square_order_id, ?)
         WHERE id = ? AND status <> 'paid'`,
        [payment.id || null, payment.order_id || null, order.id]
      )
      if (Number(flip.affectedRows) !== 1) {
        await connection.rollback()
        return 'featured'
      }
      await connection.query(
        `UPDATE job_posts
         SET featured_until = DATE_ADD(GREATEST(NOW(), COALESCE(featured_until, NOW())), INTERVAL ? WEEK)
         WHERE id = ?`,
        [Number(order.weeks), order.job_id]
      )
      await connection.commit()
    } catch (error) {
      await connection.rollback().catch(() => {})
      throw error // the webhook answers 500 and Square retries
    } finally {
      connection.release()
    }
    return 'featured'
  }

  app.get('/api/admin/featured-orders', requireAdminAuth, async (req, res) => {
    try {
      const [rows] = await pool.query(
        `SELECT fo.id, fo.job_id, fo.employer_id, fo.weeks, fo.price_cents, fo.status, fo.paid_at, fo.created_at,
                fo.square_payment_id, jp.job_title, jp.featured_until, e.business_name
         FROM featured_orders fo
         LEFT JOIN job_posts jp ON jp.id = fo.job_id
         LEFT JOIN employers e ON e.id = fo.employer_id
         ORDER BY fo.id DESC LIMIT 200`
      )
      res.json({ success: true, orders: rows })
    } catch (error) {
      console.error('[featured] admin orders failed:', error)
      res.status(500).json({ success: false, error: 'Could not load featured orders.' })
    }
  })

  // ── Claim this listing ─────────────────────────────────────────────────────
  // A scraped job (source_url set) whose employer has no login can be claimed.
  async function findClaimableJob(jobId) {
    const [rows] = await pool.query(
      `SELECT jp.id, jp.employer_id, jp.job_title, jp.source_url, e.business_name
       FROM job_posts jp
       INNER JOIN employers e ON e.id = jp.employer_id
       WHERE jp.id = ? AND jp.source_url IS NOT NULL AND jp.source_url <> ''
         AND NOT EXISTS (SELECT 1 FROM employer_users eu WHERE eu.employer_id = jp.employer_id)
       LIMIT 1`,
      [jobId]
    )
    return rows[0] || null
  }

  async function isClaimable(jobRow) {
    if (!jobRow?.source_url) return false
    return !!(await findClaimableJob(jobRow.id))
  }

  app.post('/api/jobposts/:id/claim', rateLimitByIp(consumeClaimRate, 'Too many requests. Please try again later.'), async (req, res) => {
    const body = req.body || {}
    const claim = {
      name: clean(body.name, 255),
      email: clean(body.email, 255).toLowerCase(),
      phone: clean(body.phone, 100) || null,
      organization: clean(body.organization, 255) || null,
      role: clean(body.role, 255) || null,
      message: clean(body.message, 3000) || null,
    }
    if (!claim.name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(claim.email)) {
      return res.status(400).json({ success: false, error: 'Your name and a valid work email are required.' })
    }

    // Same reply whether or not the listing is claimable, sent before any
    // lookup, so neither body nor timing reveals which employers have logins.
    res.json({ success: true, message: 'Thanks. We will review your request and email you.' })

    try {
      const job = await findClaimableJob(Number.parseInt(req.params.id, 10) || 0)
      if (!job) return
      const [dupes] = await pool.query(
        `SELECT id FROM claim_requests WHERE employer_id = ? AND email = ? AND status = 'pending' LIMIT 1`,
        [job.employer_id, claim.email]
      )
      if (dupes.length) return
      await pool.query(
        `INSERT INTO claim_requests (job_id, employer_id, name, email, phone, organization, role, message, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
        [job.id, job.employer_id, claim.name, claim.email, claim.phone, claim.organization, claim.role, claim.message]
      )
      await sendMail(adminEmails, `Listing claim: ${job.business_name}`, [
        `${claim.name} <${claim.email}> asks to claim ${job.business_name} (job #${job.id}: ${job.job_title}).`,
        `Organization: ${claim.organization || '-'}; role: ${claim.role || '-'}; phone: ${claim.phone || '-'}`,
        `Email domain matches the listing: ${emailDomainMatches(claim.email, [job.source_url]) ? 'yes' : 'no'}`,
        claim.message ? `Message: ${claim.message}` : '',
        `Review it in the admin dashboard: ${base}/?page=admin-dashboard`,
      ])
    } catch (error) {
      console.error('[claims] claim request failed:', error?.message || error)
    }
  })

  app.get('/api/admin/claims', requireAdminAuth, async (req, res) => {
    try {
      const [rows] = await pool.query(
        `SELECT cr.*, e.business_name, e.website, jp.job_title, jp.source_url,
                (SELECT COUNT(*) FROM employer_users eu WHERE eu.employer_id = cr.employer_id) AS login_count
         FROM claim_requests cr
         LEFT JOIN employers e ON e.id = cr.employer_id
         LEFT JOIN job_posts jp ON jp.id = cr.job_id
         ORDER BY cr.status = 'pending' DESC, cr.id DESC
         LIMIT 200`
      )
      const claims = rows.map((row) => ({
        ...row,
        login_count: Number(row.login_count) || 0,
        domain_match: emailDomainMatches(row.email, [row.website, row.source_url].filter(Boolean)),
      }))
      res.json({ success: true, claims })
    } catch (error) {
      console.error('[claims] admin list failed:', error)
      res.status(500).json({ success: false, error: 'Could not load claim requests.' })
    }
  })

  // Approve: a brand-new, non-admin login for exactly the claimed employer,
  // only while that employer has none and only for an email no login uses,
  // so approving never moves or shares an existing account.
  app.post('/api/admin/claims/:id/approve', requireAdminAuth, async (req, res) => {
    const claimId = Number.parseInt(req.params.id, 10) || 0
    let connection = null
    let claim = null
    let rawToken = null
    try {
      const hasPlanColumn = await tableColumnExists('employers', 'plan')
      connection = await pool.getConnection()
      await connection.beginTransaction()
      const fail = async (status, error) => {
        await connection.rollback()
        res.status(status).json({ success: false, error })
      }
      const [rows] = await connection.query(
        `SELECT cr.*, e.business_name FROM claim_requests cr
         INNER JOIN employers e ON e.id = cr.employer_id
         WHERE cr.id = ? AND cr.status = 'pending' LIMIT 1 FOR UPDATE`,
        [claimId]
      )
      claim = rows[0]
      if (!claim) return await fail(404, 'Pending claim not found.')

      const [logins] = await connection.query('SELECT id FROM employer_users WHERE employer_id = ? LIMIT 1', [claim.employer_id])
      if (logins.length) return await fail(409, 'This employer already has a login. Reject this claim or add the user by hand.')
      const [taken] = await connection.query('SELECT id FROM employer_users WHERE LOWER(email) = ? LIMIT 1', [claim.email])
      if (taken.length) return await fail(409, 'That email already has a login for another employer.')

      // Nobody knows this password; the user sets one through the emailed link.
      const placeholderHash = await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 10)
      const [user] = await connection.query(
        `INSERT INTO employer_users (employer_id, email, password_hash, is_active, is_admin) VALUES (?, ?, ?, 1, 0)`,
        [claim.employer_id, claim.email, placeholderHash]
      )
      if (hasPlanColumn) {
        await connection.query(`UPDATE employers SET plan = 'pay_per_post' WHERE id = ?`, [claim.employer_id])
      }
      rawToken = crypto.randomBytes(32).toString('hex')
      await connection.query(
        `INSERT INTO employer_password_reset_tokens (employer_user_id, token_hash, expires_at)
         VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ${SET_PASSWORD_HOURS} HOUR))`,
        [user.insertId, sha256(rawToken)]
      )
      await connection.query(
        `UPDATE claim_requests SET status = 'approved', employer_user_id = ?, reviewed_at = NOW() WHERE id = ? AND status = 'pending'`,
        [user.insertId, claim.id]
      )
      await connection.commit()
    } catch (error) {
      await connection?.rollback().catch(() => {})
      console.error('[claims] approve failed:', error)
      return res.status(500).json({ success: false, error: 'Could not approve the claim.' })
    } finally {
      connection?.release()
    }

    let emailSent = false
    try {
      const url = buildPasswordResetUrl(rawToken)
      emailSent = !!url && (await sendMail(claim.email, `Your TarboroJobs login for ${claim.business_name}`, [
        `Hi ${claim.name},`,
        `Your claim for ${claim.business_name} on TarboroJobs is approved.`,
        `Set your password here (the link works for ${SET_PASSWORD_HOURS} hours): ${url}`,
        'Your listings are imported nightly from your official site, so their text cannot be edited on TarboroJobs. You can feature them to keep them at the top of the board.',
      ]))
    } catch (error) {
      console.error('[claims] set-password email failed:', error?.message || error)
    }
    res.json({ success: true, email_sent: emailSent })
  })

  app.post('/api/admin/claims/:id/reject', requireAdminAuth, async (req, res) => {
    try {
      const claimId = Number.parseInt(req.params.id, 10) || 0
      const [rows] = await pool.query(
        `SELECT cr.*, e.business_name FROM claim_requests cr LEFT JOIN employers e ON e.id = cr.employer_id
         WHERE cr.id = ? AND cr.status = 'pending' LIMIT 1`,
        [claimId]
      )
      const claim = rows[0]
      if (!claim) return res.status(404).json({ success: false, error: 'Pending claim not found.' })
      const [result] = await pool.query(
        `UPDATE claim_requests SET status = 'rejected', reviewed_at = NOW() WHERE id = ? AND status = 'pending'`,
        [claimId]
      )
      if (Number(result.affectedRows) !== 1) return res.status(404).json({ success: false, error: 'Pending claim not found.' })

      const reason = clean(req.body?.reason, 1000)
      let emailSent = false
      try {
        emailSent = await sendMail(claim.email, `Your TarboroJobs listing claim for ${claim.business_name || 'your organization'}`, [
          `Hi ${claim.name},`,
          `We could not verify your claim for ${claim.business_name || 'this organization'}, so it was not approved.`,
          reason ? `Note from our team: ${reason}` : '',
          'If you think this is a mistake, reply from an email address at your organization.',
        ])
      } catch (error) {
        console.error('[claims] reject email failed:', error?.message || error)
      }
      res.json({ success: true, email_sent: emailSent })
    } catch (error) {
      console.error('[claims] reject failed:', error)
      res.status(500).json({ success: false, error: 'Could not reject the claim.' })
    }
  })

  return { ensureTables, tryHandlePayment, isClaimable }
}
