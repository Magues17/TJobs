// Free self-serve employer accounts and pay-per-post job listings.
//
// Signup: POST /api/employer-auth/signup creates a 'pay_per_post' employer in
// access_status 'pending' and emails a single-use 48-hour verification link.
// The reply is the same whether or not the email already has an account; an
// existing address gets a "you already have an account" email instead.
//
// Posting (server.js POST /api/employer/jobs calls newPostStatus and
// afterPayPerPostCreated for employers without the $49 plan):
//   - the first post is free but held as 'pending_review' until an admin
//     approves it (open for PAID_POST_DAYS) or rejects it with a reason;
//   - every later post starts as 'awaiting_payment' with a Square quick-pay
//     link (note "job_post:<token>"); the signed webhook publishes it once
//     Square reports a COMPLETED USD payment covering the price;
//   - an expired/closed post can be reposted through a new paid order.
// Unpaid 'awaiting_payment' posts are never public (the public queries only
// show 'open') and are deleted after UNPAID_POST_TTL_DAYS.
//
// AI job description drafts (Haiku) are only for verified employers: paying
// employers get AI_DRAFTS_PER_DAY_PAID a day, a free-first-post employer
// AI_DRAFTS_TOTAL_FREE in total, so nobody burns tokens without paying.
import crypto from 'crypto'
import { generateJobDescription } from './aiService.js'

export const JOB_POST_PRICE_CENTS = Math.max(
  100,
  Number.parseInt(process.env.JOB_POST_PRICE_CENTS || '2900', 10) || 2900
)
export const PAID_POST_DAYS = 30
export const UNPAID_POST_TTL_DAYS = 14
export const AI_DRAFTS_PER_DAY_PAID = 10
export const AI_DRAFTS_TOTAL_FREE = 2
export const JOB_POST_NOTE_PREFIX = 'job_post:'
const VERIFY_TOKEN_TTL_MS = 48 * 60 * 60 * 1000
const NEW_JOB_STATUSES = ['pending_review', 'awaiting_payment', 'rejected']
const REPOSTABLE_STATUSES = ['expired', 'closed', 'filled']
const SIGNUP_RESPONSE = {
  success: true,
  message: 'Check your email for a link to confirm your account.',
}

function addDaysFromNow(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000)
}

// Statuses a pay-per-post employer may set on their own job. Going live only
// happens through admin review or a paid order, never through this.
export function resolvePayPerPostStatus(currentStatus, requestedStatus) {
  const requested = String(requestedStatus || '').trim().toLowerCase() || currentStatus
  if (requested === currentStatus) return { status: currentStatus }
  if (['closed', 'filled'].includes(requested) && !NEW_JOB_STATUSES.includes(currentStatus)) {
    return { status: requested }
  }
  return {
    error:
      requested === 'open'
        ? `Pay-per-post jobs go live after review or payment. Use "Pay $${JOB_POST_PRICE_CENTS / 100} to publish" or "Repost for $${JOB_POST_PRICE_CENTS / 100}" in My Jobs.`
        : 'That status change is not available for this job.',
  }
}

// Square webhook, COMPLETED payment on a subscription checkout that carries
// employer_id: the pay-per-post employer bought the $49/month plan. Converts
// them in place and opens the jobs the $29 gate was holding. Applied once per
// checkout row (row-locked, checkout_status 'created' -> 'upgraded'); a replay
// is a no-op. Throws on database errors so the webhook can answer 500 and
// Square retries.
export async function applyPlanUpgrade(pool, { checkout, payment, postDays }) {
  const paidCents = Number(payment?.amount_money?.amount) || 0
  const paidCurrency = String(payment?.amount_money?.currency || '').toUpperCase()
  const orderMismatch = checkout.square_order_id && payment?.order_id && checkout.square_order_id !== payment.order_id
  if (
    String(payment?.status || '').toLowerCase() !== 'completed' ||
    paidCents < Number(checkout.amount_cents) ||
    paidCurrency !== String(checkout.currency || '').toUpperCase() ||
    orderMismatch
  ) {
    console.error(
      `[plan-upgrade] checkout ${checkout.checkout_ref}: payment ${payment?.id} of ${paidCents} ${paidCurrency} (Square order ${payment?.order_id}) does not match ${checkout.amount_cents} ${checkout.currency} (Square order ${checkout.square_order_id}); employer not upgraded`
    )
    return { applied: false, reason: 'payment_mismatch' }
  }

  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [[locked]] = await connection.query(
      `SELECT checkout_status FROM employer_pending_checkouts WHERE id = ? FOR UPDATE`,
      [checkout.id]
    )
    if (!locked || locked.checkout_status !== 'created') {
      await connection.commit()
      return { applied: false, reason: 'already_applied' }
    }

    const [[employer]] = await connection.query(`SELECT id, plan FROM employers WHERE id = ? FOR UPDATE`, [checkout.employer_id])
    if (employer?.plan !== 'pay_per_post') {
      console.error(
        `[plan-upgrade] checkout ${checkout.checkout_ref}: employer ${checkout.employer_id} ${employer ? 'is already on the monthly plan' : 'no longer exists'} but payment ${payment.id} was taken; refund it in Square if it is a duplicate.`
      )
      await connection.query(`UPDATE employer_pending_checkouts SET checkout_status = 'duplicate', completed_at = CURRENT_TIMESTAMP WHERE id = ?`, [checkout.id])
      await connection.commit()
      return { applied: false, reason: 'not_upgradable' }
    }

    // access_status is left alone: an admin deactivation must survive a payment.
    await connection.query(
      `
      UPDATE employers
      SET plan = 'subscription',
        square_customer_id = COALESCE(?, square_customer_id),
        square_subscription_id = COALESCE(?, square_subscription_id),
        subscription_status = 'active',
        subscription_synced_at = NULL,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
      `,
      [payment.customer_id || null, checkout.square_subscription_id || null, employer.id]
    )
    // Jobs held by the $29 gate or the free-post review go live for the monthly-plan lifetime.
    const [published] = await connection.query(
      `
      UPDATE job_posts
      SET status = 'open', published_at = ?, expires_at = ?, expired_at = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE employer_id = ? AND source_url IS NULL AND status IN ('awaiting_payment', 'pending_review')
      `,
      [new Date(), addDaysFromNow(postDays), employer.id]
    )
    await connection.query(`UPDATE employer_pending_checkouts SET checkout_status = 'upgraded', completed_at = CURRENT_TIMESTAMP WHERE id = ?`, [checkout.id])
    await connection.commit()
    return { applied: true, published: published.affectedRows }
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export function registerEmployerSelfServe({
  app,
  pool,
  bcrypt,
  createAuthToken,
  safeTrim,
  normalizeEmail,
  isValidEmail,
  toNullableString,
  sha256,
  createIpRateLimiter,
  rateLimitByIp,
  requireAdminAuth,
  requireEmployerAuth,
  requireEligibleEmployer,
  hasSubscriptionFeatures,
  getMailer,
  getMailFrom,
  escapeHtml,
  createSquareQuickPayLink,
  tableColumnExists,
  APP_BASE_URL,
  ADMIN_EMAILS,
  DB_NAME,
}) {
  const consumeSignupRate = createIpRateLimiter(60 * 60 * 1000, 5)
  const consumeVerifyRate = createIpRateLimiter(15 * 60 * 1000, 20)
  const base = String(APP_BASE_URL || '').replace(/\/+$/, '')
  const appUrl = (params) => (base ? `${base}/?${new URLSearchParams(params)}` : null)

  async function sendMail({ to, subject, lines, link, linkLabel }) {
    const transporter = getMailer()
    if (!transporter || !to) {
      console.error(`[self-serve] email "${subject}" not sent: mail is not configured.`)
      return false
    }
    const text = [...lines, ...(link ? ['', `${linkLabel}: ${link}`] : [])].join('\n')
    const html = [
      ...lines.filter(Boolean).map((line) => `<p>${escapeHtml(line)}</p>`),
      ...(link ? [`<p><a href="${escapeHtml(link)}">${escapeHtml(linkLabel)}</a></p>`] : []),
    ].join('\n')
    await transporter.sendMail({ from: getMailFrom(), to, subject, text, html })
    return true
  }

  function mailInBackground(message) {
    sendMail(message).catch((error) => console.error(`[self-serve] email "${message.subject}" failed:`, error?.message || error))
  }

  // ── schema ─────────────────────────────────────────────────────────────────
  async function addColumn(table, column, sql) {
    if (!(await tableColumnExists(table, column))) await pool.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${sql}`)
  }

  // job_posts.status may be an ENUM or a short VARCHAR on the live DB; widen
  // it so the new statuses fit, keeping its NULL/DEFAULT as they are.
  async function ensureJobStatusCapacity() {
    const [rows] = await pool.query(
      `
      SELECT COLUMN_TYPE AS column_type, IS_NULLABLE AS is_nullable, COLUMN_DEFAULT AS column_default
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = COALESCE(NULLIF(?, ''), DATABASE())
        AND TABLE_NAME = 'job_posts'
        AND COLUMN_NAME = 'status'
      LIMIT 1
      `,
      [DB_NAME]
    )
    const row = rows[0]
    const type = String(row?.column_type || '').toLowerCase()
    let nextType = null
    const enumMatch = type.match(/^enum\((.*)\)$/)
    if (enumMatch) {
      const values = [...enumMatch[1].matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1].replace(/''/g, "'"))
      const missing = NEW_JOB_STATUSES.filter((value) => !values.includes(value))
      if (missing.length) nextType = `ENUM(${[...values, ...missing].map((v) => `'${v.replace(/'/g, "''")}'`).join(',')})`
    } else {
      const charMatch = type.match(/^(?:var)?char\((\d+)\)$/)
      if (charMatch && Number(charMatch[1]) < 32) nextType = 'VARCHAR(32)'
    }
    if (!nextType) return
    const rawDefault = row.column_default
    const defaultValue =
      rawDefault === null || rawDefault === undefined || rawDefault === 'NULL' ? null : String(rawDefault).replace(/^'(.*)'$/, '$1')
    await pool.query(
      `ALTER TABLE job_posts MODIFY COLUMN status ${nextType} ${row.is_nullable === 'YES' ? 'NULL' : 'NOT NULL'}${
        defaultValue !== null ? ` DEFAULT '${defaultValue.replace(/'/g, "''")}'` : ''
      }`
    )
    console.log(`STARTUP: job_posts.status widened from ${type} to ${nextType}`)
  }

  // A failed step is logged and skipped: only the self-serve routes need these.
  // If employers.plan cannot be added, employer session queries select the
  // missing column and error, so employer sign-in fails closed.
  async function ensureSchema() {
    const steps = [
      () => addColumn('employers', 'plan', `VARCHAR(32) NOT NULL DEFAULT 'subscription'`),
      () => addColumn('employers', 'free_post_used_at', 'DATETIME NULL DEFAULT NULL'),
      () => addColumn('job_posts', 'review_note', 'TEXT NULL'),
      ensureJobStatusCapacity,
      () => pool.query(`
        CREATE TABLE IF NOT EXISTS employer_email_verifications (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          employer_id BIGINT UNSIGNED NOT NULL,
          employer_user_id BIGINT UNSIGNED NOT NULL,
          token_hash CHAR(64) NOT NULL,
          expires_at DATETIME NOT NULL,
          used_at DATETIME NULL DEFAULT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          UNIQUE KEY uq_employer_email_verifications_hash (token_hash),
          KEY idx_employer_email_verifications_employer (employer_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `),
      () => pool.query(`
        CREATE TABLE IF NOT EXISTS job_post_orders (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          token VARCHAR(64) NOT NULL,
          job_id BIGINT UNSIGNED NOT NULL,
          employer_id BIGINT UNSIGNED NOT NULL,
          kind VARCHAR(16) NOT NULL DEFAULT 'post',
          price_cents INT NOT NULL,
          currency VARCHAR(12) NOT NULL DEFAULT 'USD',
          payment_status VARCHAR(32) NOT NULL DEFAULT 'pending',
          square_checkout_url TEXT NULL,
          square_order_id VARCHAR(255) NULL DEFAULT NULL,
          square_payment_id VARCHAR(255) NULL DEFAULT NULL,
          paid_at DATETIME NULL DEFAULT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          UNIQUE KEY uq_job_post_orders_token (token),
          KEY idx_job_post_orders_job (job_id),
          KEY idx_job_post_orders_employer (employer_id, payment_status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `),
      () => pool.query(`
        CREATE TABLE IF NOT EXISTS ai_job_drafts (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          employer_id BIGINT UNSIGNED NOT NULL,
          input_tokens INT NOT NULL DEFAULT 0,
          output_tokens INT NOT NULL DEFAULT 0,
          cost_cents DECIMAL(10,4) NOT NULL DEFAULT 0,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          KEY idx_ai_job_drafts_employer (employer_id, created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `),
    ]
    for (const step of steps) {
      try {
        await step()
      } catch (error) {
        console.error('STARTUP: employer self-serve schema step failed; self-serve signup/posting may fail:', error?.message || error)
      }
    }
  }

  // ── signup + email verification ────────────────────────────────────────────
  async function sendVerificationEmail({ email, employerId, employerUserId, lines }) {
    const rawToken = crypto.randomBytes(32).toString('hex')
    const link = appUrl({ page: 'employer-verify', token: rawToken })
    if (!link) {
      console.error('[self-serve] verification email not sent: APP_BASE_URL is not configured.')
      return
    }
    await pool.query(
      `INSERT INTO employer_email_verifications (employer_id, employer_user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)`,
      [employerId, employerUserId, sha256(rawToken), new Date(Date.now() + VERIFY_TOKEN_TTL_MS)]
    )
    await sendMail({ to: email, subject: 'Confirm your TarboroJobs employer account', lines, link, linkLabel: 'Confirm your account' })
  }

  async function handleSignup(fields) {
    const { email } = fields
    const [existing] = await pool.query(
      `
      SELECT eu.id AS user_id, e.id AS employer_id, e.business_name, e.plan, e.access_status, e.onboarding_completed
      FROM employer_users eu
      INNER JOIN employers e ON e.id = eu.employer_id
      WHERE LOWER(eu.email) = ?
      UNION ALL
      SELECT NULL AS user_id, e.id AS employer_id, e.business_name, e.plan, e.access_status, e.onboarding_completed
      FROM employers e
      WHERE LOWER(e.email) = ?
      LIMIT 1
      `,
      [email, email]
    )

    if (existing.length) {
      const account = existing[0]
      // An unverified self-serve account gets a fresh link (its first
      // password stands); everyone else is pointed at password reset.
      // Nothing about the account is changed from here.
      if (account.user_id && account.plan === 'pay_per_post' && account.access_status === 'pending' && !account.onboarding_completed) {
        await sendVerificationEmail({
          email,
          employerId: account.employer_id,
          employerUserId: account.user_id,
          lines: [
            `Hi ${account.business_name || 'there'},`,
            '',
            'Someone (hopefully you) tried to sign up again with this email. Your account is still waiting for confirmation.',
            'Confirm it with the link below, then sign in with the password you chose the first time (or reset it from the sign-in page).',
            'This link expires in 48 hours.',
          ],
        })
        return
      }
      await sendMail({
        to: email,
        subject: 'You already have a TarboroJobs employer account',
        lines: [
          `Hi ${account.business_name || 'there'},`,
          '',
          'Someone (hopefully you) tried to create a new TarboroJobs employer account with this email, but you already have one.',
          'Sign in with your existing password. If you forgot it, you can reset it from the employer sign-in page.',
          'If this was not you, you can ignore this email; nothing was changed.',
        ],
        link: appUrl({ page: 'employer-forgot-password' }),
        linkLabel: 'Reset your password',
      })
      return
    }

    const connection = await pool.getConnection()
    let employerId
    let employerUserId
    try {
      await connection.beginTransaction()
      const [insertEmployer] = await connection.query(
        `
        INSERT INTO employers
        (business_name, contact_name, email, phone, website, plan, subscription_status, access_status, onboarding_completed, status)
        VALUES (?, ?, ?, ?, ?, 'pay_per_post', 'active', 'pending', 0, 'active')
        `,
        [fields.businessName, fields.contactName, email, fields.phone, fields.website]
      )
      employerId = insertEmployer.insertId
      const [insertUser] = await connection.query(
        `INSERT INTO employer_users (employer_id, email, password_hash, is_active) VALUES (?, ?, ?, 1)`,
        [employerId, email, fields.passwordHash]
      )
      employerUserId = insertUser.insertId
      await connection.commit()
    } catch (error) {
      await connection.rollback()
      throw error
    } finally {
      connection.release()
    }

    await sendVerificationEmail({
      email,
      employerId,
      employerUserId,
      lines: [
        `Hi ${fields.contactName || fields.businessName},`,
        '',
        `Thanks for signing up ${fields.businessName} on TarboroJobs. Confirm your email to start posting jobs.`,
        'Your first job post is free. This link expires in 48 hours.',
      ],
    })
  }

  app.post(
    '/api/employer-auth/signup',
    rateLimitByIp(consumeSignupRate, 'Too many signup attempts. Please try again later.'),
    async (req, res) => {
      const businessName = safeTrim(req.body.business_name, 255)
      const contactName = safeTrim(req.body.contact_name, 255)
      const email = normalizeEmail(req.body.email)
      const password = String(req.body.password || '')
      const phone = toNullableString(req.body.phone, 50)
      const website = toNullableString(req.body.website, 255)

      if (!businessName || !contactName || !email) {
        return res.status(400).json({ success: false, error: 'Business name, contact name, and email are required.' })
      }
      if (!isValidEmail(email)) {
        return res.status(400).json({ success: false, error: 'A valid email address is required.' })
      }
      if (password.length < 8 || password.length > 200) {
        return res.status(400).json({ success: false, error: 'Password must be at least 8 characters.' })
      }

      // Same reply, sent after the same bcrypt work and before any lookup, so
      // neither the body nor the timing reveals whether the email has an
      // account. Failures are only logged.
      let passwordHash
      try {
        passwordHash = await bcrypt.hash(password, 10)
      } catch (error) {
        console.error('POST /api/employer-auth/signup hash error:', error)
        return res.status(500).json({ success: false, error: 'Internal server error.' })
      }
      res.json(SIGNUP_RESPONSE)

      // ponytail: two simultaneous signups for one new email can both insert;
      // add a UNIQUE key on employer_users.email if that ever happens.
      handleSignup({ businessName, contactName, email, phone, website, passwordHash }).catch((error) =>
        console.error('POST /api/employer-auth/signup error:', error)
      )
    }
  )

  // Always the same reply: it never says whether the email has an account.
  app.post(
    '/api/employer/resend-verification',
    rateLimitByIp(consumeSignupRate, 'Too many attempts. Please try again later.'),
    (req, res) => {
      const email = normalizeEmail(req.body.email)
      res.json({ success: true })
      if (!isValidEmail(email)) return
      pool
        .query(
          `
          SELECT eu.id AS user_id, e.id AS employer_id, e.business_name
          FROM employer_users eu
          INNER JOIN employers e ON e.id = eu.employer_id
          WHERE LOWER(eu.email) = ? AND e.plan = 'pay_per_post' AND e.access_status = 'pending' AND e.onboarding_completed = 0
          LIMIT 1
          `,
          [email]
        )
        .then(([rows]) => {
          if (!rows.length) return
          return sendVerificationEmail({
            email,
            employerId: rows[0].employer_id,
            employerUserId: rows[0].user_id,
            lines: [
              `Hi ${rows[0].business_name || 'there'},`,
              '',
              'Here is a new link to confirm your TarboroJobs employer account. It expires in 48 hours.',
            ],
          })
        })
        .catch((error) => console.error('POST /api/employer/resend-verification error:', error))
    }
  )

  app.post(
    '/api/employer-auth/verify-email',
    rateLimitByIp(consumeVerifyRate, 'Too many attempts. Please try again later.'),
    async (req, res) => {
      const invalid = () =>
        res.status(400).json({ success: false, error: 'This confirmation link is invalid or has expired. Sign up again to get a new one.' })
      try {
        const token = safeTrim(req.body.token, 128)
        if (!/^[a-f0-9]{64}$/.test(token)) return invalid()

        const [rows] = await pool.query(
          `
          SELECT id, employer_id, employer_user_id, expires_at, used_at
          FROM employer_email_verifications
          WHERE token_hash = ?
          LIMIT 1
          `,
          [sha256(token)]
        )
        const row = rows[0]
        if (!row || row.used_at || new Date(row.expires_at).getTime() <= Date.now()) return invalid()

        const [claimed] = await pool.query(
          `UPDATE employer_email_verifications SET used_at = CURRENT_TIMESTAMP WHERE id = ? AND used_at IS NULL`,
          [row.id]
        )
        if (claimed.affectedRows !== 1) return invalid()

        // Only a still-pending self-serve account is activated; a deactivated
        // one stays deactivated.
        await pool.query(
          `
          UPDATE employers
          SET access_status = 'active', onboarding_completed = 1, updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND plan = 'pay_per_post' AND access_status = 'pending'
          `,
          [row.employer_id]
        )

        const [users] = await pool.query(
          `
          SELECT eu.id, eu.employer_id, eu.email, eu.token_version, eu.is_active, e.access_status
          FROM employer_users eu
          INNER JOIN employers e ON e.id = eu.employer_id
          WHERE eu.id = ? AND eu.employer_id = ?
          LIMIT 1
          `,
          [row.employer_user_id, row.employer_id]
        )
        const user = users[0]
        if (!user || !user.is_active || user.access_status !== 'active') {
          return res.status(403).json({ success: false, error: 'This employer account is not active. Please contact TarboroJobs.' })
        }

        res.json({
          success: true,
          auth_token: createAuthToken(user),
          message: 'Your email is confirmed. Your first job post is free.',
        })
      } catch (error) {
        console.error('POST /api/employer-auth/verify-email error:', error)
        res.status(500).json({ success: false, error: 'Internal server error.' })
      }
    }
  )

  // ── pay-per-post posting ───────────────────────────────────────────────────
  // ponytail: two posts submitted at the same instant can both get the free
  // slot; the admin review catches it.
  async function newPostStatus(employerId) {
    const [rows] = await pool.query(
      `
      SELECT
        e.free_post_used_at,
        (SELECT COUNT(*) FROM job_posts jp WHERE jp.employer_id = e.id AND jp.status = 'pending_review') AS pending_reviews
      FROM employers e
      WHERE e.id = ?
      LIMIT 1
      `,
      [employerId]
    )
    const row = rows[0]
    return row && !row.free_post_used_at && !Number(row.pending_reviews) ? 'pending_review' : 'awaiting_payment'
  }

  async function createJobPostOrder({ jobId, employerId, jobTitle, kind }) {
    const token = `jp_${crypto.randomBytes(18).toString('hex')}`
    const [insert] = await pool.query(
      `INSERT INTO job_post_orders (token, job_id, employer_id, kind, price_cents, currency) VALUES (?, ?, ?, ?, ?, 'USD')`,
      [token, jobId, employerId, kind, JOB_POST_PRICE_CENTS]
    )
    const link = await createSquareQuickPayLink({
      name: `TarboroJobs ${kind === 'repost' ? 'repost' : 'job post'}: ${String(jobTitle || 'Job').slice(0, 180)}`,
      priceCents: JOB_POST_PRICE_CENTS,
      currency: 'USD',
      note: `${JOB_POST_NOTE_PREFIX}${token}`,
      redirectUrl: appUrl({ page: 'employer-job-paid' }) || undefined,
    })
    await pool.query(`UPDATE job_post_orders SET square_checkout_url = ?, square_order_id = ? WHERE id = ?`, [
      link.checkoutUrl,
      link.orderId,
      insert.insertId,
    ])
    return link.checkoutUrl
  }

  // Called right after server.js inserted a pay-per-post job. Never throws:
  // the job is saved either way, and "Pay $29 to publish" retries the link.
  async function afterPayPerPostCreated({ jobId, employerId, status, jobTitle, businessName }) {
    if (status === 'pending_review') {
      const admins = (ADMIN_EMAILS || []).join(', ')
      if (admins) {
        mailInBackground({
          to: admins,
          subject: `Job post waiting for review: ${String(jobTitle).slice(0, 120)}`,
          lines: [
            `${businessName || `Employer #${employerId}`} posted their free first job "${jobTitle}" (job #${jobId}).`,
            'It stays hidden until you approve or reject it in the admin dashboard review queue.',
          ],
          link: appUrl({ page: 'admin-dashboard' }),
          linkLabel: 'Open the review queue',
        })
      }
      return { checkout_url: null }
    }
    try {
      return { checkout_url: await createJobPostOrder({ jobId, employerId, jobTitle, kind: 'post' }) }
    } catch (error) {
      console.error(`[job-post] could not create the Square link for job ${jobId}:`, error?.message || error)
      return { checkout_url: null }
    }
  }

  app.post('/api/employer/jobs/:id/pay', requireEmployerAuth, requireEligibleEmployer, async (req, res) => {
    try {
      const jobId = Number(req.params.id)
      const employerId = req.auth.employer_id
      const [rows] = await pool.query(`SELECT id, employer_id, job_title, status, source_url FROM job_posts WHERE id = ? LIMIT 1`, [jobId])
      const job = rows[0]
      // Scraped jobs (claimed employers) follow their source site; never reopen them.
      if (!job || Number(job.employer_id) !== Number(employerId) || job.source_url) {
        return res.status(404).json({ success: false, error: 'Job not found.' })
      }
      if (hasSubscriptionFeatures({ ...req.auth.employer, ...req.auth.billing })) {
        return res.status(400).json({ success: false, error: 'Your plan includes unlimited posts. Renew the job from My Jobs instead.' })
      }
      const kind = job.status === 'awaiting_payment' ? 'post' : REPOSTABLE_STATUSES.includes(job.status) ? 'repost' : null
      if (!kind) {
        return res.status(400).json({ success: false, error: 'This job does not need a payment right now.' })
      }

      // Reuse the open link for this job instead of opening a second payment.
      const [orders] = await pool.query(
        `
        SELECT square_checkout_url
        FROM job_post_orders
        WHERE job_id = ? AND employer_id = ? AND kind = ? AND payment_status = 'pending'
          AND square_checkout_url IS NOT NULL
          AND created_at > ?
        ORDER BY id DESC
        LIMIT 1
        `,
        [jobId, employerId, kind, addDaysFromNow(-(UNPAID_POST_TTL_DAYS - 1))]
      )
      const checkoutUrl =
        orders[0]?.square_checkout_url || (await createJobPostOrder({ jobId, employerId, jobTitle: job.job_title, kind }))
      res.json({ success: true, checkout_url: checkoutUrl, price_cents: JOB_POST_PRICE_CENTS })
    } catch (error) {
      console.error('POST /api/employer/jobs/:id/pay error:', error)
      res.status(500).json({ success: false, error: 'Could not start the payment. Please try again.' })
    }
  })

  // Called by the Square webhook with a payment fetched from the Square API.
  // Returns 'job_post' when the note belongs to a job post order. The order
  // is only paid when Square says COMPLETED for at least its price in USD,
  // and (when both are known) for the Square order its link created.
  async function tryHandleJobPostPayment(payment) {
    const note = safeTrim(payment?.note, 500)
    if (!note.startsWith(JOB_POST_NOTE_PREFIX)) return null
    const token = note.slice(JOB_POST_NOTE_PREFIX.length).trim()
    if (!token) return null

    const [rows] = await pool.query(`SELECT * FROM job_post_orders WHERE token = ? LIMIT 1`, [token])
    const order = rows[0]
    if (!order || order.payment_status === 'paid') return 'job_post'
    if (String(payment.status || '').toLowerCase() !== 'completed') return 'job_post'

    const paidCents = Number(payment.amount_money?.amount) || 0
    const paidCurrency = String(payment.amount_money?.currency || '').toUpperCase()
    const priceCents = Number(order.price_cents) || JOB_POST_PRICE_CENTS
    const orderMismatch = order.square_order_id && payment.order_id && order.square_order_id !== payment.order_id
    if (paidCents < priceCents || paidCurrency !== 'USD' || orderMismatch) {
      console.error(
        `[job-post] order ${order.id}: payment ${payment.id} of ${paidCents} ${paidCurrency} (Square order ${payment.order_id}) does not match ${priceCents} USD (Square order ${order.square_order_id}); not marking paid`
      )
      return 'job_post'
    }

    const [marked] = await pool.query(
      `
      UPDATE job_post_orders
      SET payment_status = 'paid', paid_at = CURRENT_TIMESTAMP, square_payment_id = ?, square_order_id = COALESCE(square_order_id, ?)
      WHERE id = ? AND payment_status <> 'paid'
      `,
      [payment.id || null, payment.order_id || null, order.id]
    )
    if (marked.affectedRows !== 1) return 'job_post'

    const [published] = await pool.query(
      `
      UPDATE job_posts
      SET status = 'open', published_at = ?, expires_at = ?, expired_at = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND employer_id = ? AND source_url IS NULL AND status IN ('awaiting_payment', 'expired', 'closed', 'filled')
      `,
      [new Date(), addDaysFromNow(PAID_POST_DAYS), order.job_id, order.employer_id]
    )
    if (published.affectedRows !== 1) {
      console.error(
        `[job-post] order ${order.id} is paid but job ${order.job_id} could not be published (deleted or already open); check it and refund in Square if needed.`
      )
    }
    return 'job_post'
  }

  // Hourly: unpaid new posts are deleted after UNPAID_POST_TTL_DAYS, and
  // their (and stale repost) orders are marked expired. A late payment on an
  // expired order is still recorded by the webhook.
  async function cleanupUnpaidJobPosts() {
    const cutoff = addDaysFromNow(-UNPAID_POST_TTL_DAYS)
    await pool.query(`DELETE FROM job_posts WHERE status = 'awaiting_payment' AND created_at < ?`, [cutoff])
    await pool.query(`UPDATE job_post_orders SET payment_status = 'expired' WHERE payment_status = 'pending' AND created_at < ?`, [cutoff])
  }

  // ── AI job description drafts ──────────────────────────────────────────────
  app.post('/api/employer/jobs/ai-draft', requireEmployerAuth, requireEligibleEmployer, async (req, res) => {
    const employerId = req.auth.employer_id
    const title = safeTrim(req.body.title, 255)
    const notes = safeTrim(req.body.notes, 4000)
    if (!title) return res.status(400).json({ success: false, error: 'Enter a job title first.' })

    let draftId = null
    try {
      let paid = hasSubscriptionFeatures({ ...req.auth.employer, ...req.auth.billing })
      if (!paid) {
        const [orders] = await pool.query(
          `SELECT COUNT(*) AS paid_orders FROM job_post_orders WHERE employer_id = ? AND payment_status = 'paid'`,
          [employerId]
        )
        paid = Number(orders[0]?.paid_orders) > 0
      }
      const limit = paid ? AI_DRAFTS_PER_DAY_PAID : AI_DRAFTS_TOTAL_FREE

      // Reserve a slot first, then count including it, so parallel requests
      // cannot all slip under the limit.
      const [reserved] = await pool.query(`INSERT INTO ai_job_drafts (employer_id) VALUES (?)`, [employerId])
      draftId = reserved.insertId
      const [counts] = await pool.query(
        `SELECT COUNT(*) AS used FROM ai_job_drafts WHERE employer_id = ?${paid ? ' AND created_at >= CURDATE()' : ''}`,
        [employerId]
      )
      const used = Number(counts[0]?.used) || 0
      if (used > limit) {
        await pool.query(`DELETE FROM ai_job_drafts WHERE id = ?`, [draftId])
        draftId = null
        return res.status(429).json({
          success: false,
          error: paid
            ? `You have used today's ${limit} AI drafts. Try again tomorrow.`
            : `Free accounts get ${limit} AI drafts. Publish a paid post or choose the monthly plan for ${AI_DRAFTS_PER_DAY_PAID} a day.`,
        })
      }

      let result
      try {
        result = await generateJobDescription({
          jobTitle: title,
          notes,
          businessName: req.auth.employer.business_name,
          city: req.auth.employer.city,
        })
      } catch (error) {
        if (error?.usage) {
          await pool.query(`UPDATE ai_job_drafts SET input_tokens = ?, output_tokens = ?, cost_cents = ? WHERE id = ?`, [
            error.usage.inputTokens,
            error.usage.outputTokens,
            error.usage.costCents,
            draftId,
          ])
        } else {
          await pool.query(`DELETE FROM ai_job_drafts WHERE id = ?`, [draftId])
        }
        draftId = null
        console.error(`[ai-draft] employer ${employerId} draft failed:`, error?.message || error)
        return res.status(502).json({ success: false, error: 'The writer is busy right now. Please try again in a minute.' })
      }

      await pool.query(`UPDATE ai_job_drafts SET input_tokens = ?, output_tokens = ?, cost_cents = ? WHERE id = ?`, [
        result.usage.inputTokens,
        result.usage.outputTokens,
        result.usage.costCents,
        draftId,
      ])
      res.json({ success: true, description: result.description, remaining: Math.max(0, limit - used), per_day: paid })
    } catch (error) {
      console.error('POST /api/employer/jobs/ai-draft error:', error)
      if (draftId) pool.query(`DELETE FROM ai_job_drafts WHERE id = ?`, [draftId]).catch(() => {})
      res.status(500).json({ success: false, error: 'Could not write a draft. Please try again.' })
    }
  })

  async function getJobDraftCosts(monthStart) {
    const [rows] = await pool.query(
      `
      SELECT
        COUNT(*) AS drafts,
        COALESCE(SUM(cost_cents), 0) AS ai_cost_cents,
        SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS month_drafts,
        COALESCE(SUM(CASE WHEN created_at >= ? THEN cost_cents ELSE 0 END), 0) AS month_ai_cost_cents
      FROM ai_job_drafts
      `,
      [monthStart, monthStart]
    )
    const row = rows[0] || {}
    const cents = (value) => Math.round((Number(value) || 0) * 10000) / 10000
    return {
      all_time: { drafts: Number(row.drafts) || 0, ai_cost_cents: cents(row.ai_cost_cents) },
      this_month: { drafts: Number(row.month_drafts) || 0, ai_cost_cents: cents(row.month_ai_cost_cents) },
    }
  }

  // ── admin review queue ─────────────────────────────────────────────────────
  app.get('/api/admin/review-queue', requireAdminAuth, async (req, res) => {
    try {
      const [[jobs], [employers], [orders]] = await Promise.all([
        pool.query(
          `
          SELECT jp.id, jp.employer_id, jp.job_title, jp.job_description, jp.city, jp.pay_min, jp.pay_max, jp.pay_type,
            jp.employment_type, jp.created_at, e.business_name, e.email AS employer_email, e.website AS employer_website
          FROM job_posts jp
          INNER JOIN employers e ON e.id = jp.employer_id
          WHERE jp.status = 'pending_review'
          ORDER BY jp.created_at ASC
          LIMIT 100
          `
        ),
        pool.query(
          `
          SELECT id, business_name, contact_name, email, phone, website, access_status, onboarding_completed, free_post_used_at, created_at
          FROM employers
          WHERE plan = 'pay_per_post'
          ORDER BY created_at DESC, id DESC
          LIMIT 50
          `
        ),
        pool.query(
          `
          SELECT o.id, o.job_id, o.employer_id, o.kind, o.price_cents, o.payment_status, o.paid_at, o.created_at,
            jp.job_title, e.business_name
          FROM job_post_orders o
          LEFT JOIN job_posts jp ON jp.id = o.job_id
          LEFT JOIN employers e ON e.id = o.employer_id
          ORDER BY o.id DESC
          LIMIT 25
          `
        ),
      ])
      res.json({
        success: true,
        price_cents: JOB_POST_PRICE_CENTS,
        jobs,
        employers: employers.map((row) => ({
          ...row,
          onboarding_completed: !!row.onboarding_completed,
          verified: row.access_status === 'active' && !!row.onboarding_completed,
        })),
        orders,
      })
    } catch (error) {
      console.error('GET /api/admin/review-queue error:', error)
      res.status(500).json({ success: false, error: 'Failed to load the review queue.' })
    }
  })

  async function loadReviewJob(jobId) {
    const [rows] = await pool.query(
      `
      SELECT jp.id, jp.employer_id, jp.job_title, jp.status, e.email AS employer_email, e.business_name
      FROM job_posts jp
      INNER JOIN employers e ON e.id = jp.employer_id
      WHERE jp.id = ?
      LIMIT 1
      `,
      [jobId]
    )
    return rows[0] || null
  }

  app.post('/api/admin/jobs/:id/approve', requireAdminAuth, async (req, res) => {
    try {
      const job = await loadReviewJob(Number(req.params.id))
      if (!job) return res.status(404).json({ success: false, error: 'Job not found.' })
      const [updated] = await pool.query(
        `
        UPDATE job_posts
        SET status = 'open', published_at = ?, expires_at = ?, expired_at = NULL, review_note = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status = 'pending_review'
        `,
        [new Date(), addDaysFromNow(PAID_POST_DAYS), job.id]
      )
      if (updated.affectedRows !== 1) {
        return res.status(409).json({ success: false, error: 'This job is no longer waiting for review.' })
      }
      await pool.query(`UPDATE employers SET free_post_used_at = COALESCE(free_post_used_at, CURRENT_TIMESTAMP) WHERE id = ?`, [
        job.employer_id,
      ])
      mailInBackground({
        to: job.employer_email,
        subject: `Your job post is live: ${String(job.job_title).slice(0, 120)}`,
        lines: [
          `Hi ${job.business_name || 'there'},`,
          '',
          `Your free job post "${job.job_title}" was approved and is live on TarboroJobs for ${PAID_POST_DAYS} days.`,
          `Each new post after this one is $${(JOB_POST_PRICE_CENTS / 100).toFixed(2)}.`,
        ],
        link: appUrl({ page: 'employer-login' }),
        linkLabel: 'Open your dashboard',
      })
      res.json({ success: true, message: `Job approved and live for ${PAID_POST_DAYS} days.` })
    } catch (error) {
      console.error('POST /api/admin/jobs/:id/approve error:', error)
      res.status(500).json({ success: false, error: 'Failed to approve the job.' })
    }
  })

  app.post('/api/admin/jobs/:id/reject', requireAdminAuth, async (req, res) => {
    try {
      const reason = safeTrim(req.body.reason, 1000)
      if (!reason) return res.status(400).json({ success: false, error: 'A reason is required; it is emailed to the employer.' })
      const job = await loadReviewJob(Number(req.params.id))
      if (!job) return res.status(404).json({ success: false, error: 'Job not found.' })
      const [updated] = await pool.query(
        `UPDATE job_posts SET status = 'rejected', review_note = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending_review'`,
        [reason, job.id]
      )
      if (updated.affectedRows !== 1) {
        return res.status(409).json({ success: false, error: 'This job is no longer waiting for review.' })
      }
      let emailed = false
      try {
        emailed = await sendMail({
          to: job.employer_email,
          subject: `Your job post needs changes: ${String(job.job_title).slice(0, 120)}`,
          lines: [
            `Hi ${job.business_name || 'there'},`,
            '',
            `We could not publish your job post "${job.job_title}". The reason:`,
            reason,
            '',
            'Your free post is still available: post the job again with the changes and we will review it.',
          ],
          link: appUrl({ page: 'employer-login' }),
          linkLabel: 'Open your dashboard',
        })
      } catch (mailError) {
        console.error('POST /api/admin/jobs/:id/reject email error:', mailError?.message || mailError)
      }
      res.json({
        success: true,
        emailed,
        message: emailed ? 'Job rejected and the employer was emailed.' : 'Job rejected, but the email could not be sent.',
      })
    } catch (error) {
      console.error('POST /api/admin/jobs/:id/reject error:', error)
      res.status(500).json({ success: false, error: 'Failed to reject the job.' })
    }
  })

  return {
    ensureSchema,
    newPostStatus,
    afterPayPerPostCreated,
    tryHandleJobPostPayment,
    cleanupUnpaidJobPosts,
    getJobDraftCosts,
  }
}
