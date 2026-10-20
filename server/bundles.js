// Job Seeker Kit: one Resume Check + one Cover Letter + one Interview Prep for one price.
//
// Buying the kit creates a bundle_orders row (paid only by a verified Square
// webhook, like every other order here). The buyer then spends one credit per
// tool: redeeming marks that tool's own order paid through the same function
// the Square webhook uses, so generation, result pages and cost tracking behave
// identically. Nothing here calls an AI; no credit, no tokens.
//
// registerBundles returns { ensureTables, tryHandlePayment }. server.js calls
// tryHandlePayment from the Square webhook dispatcher.
import crypto from 'crypto'

export const BUNDLE_NOTE_PREFIX = 'bundle:'
export const BUNDLE_PRODUCT_NAME = 'TarboroJobs Job Seeker Kit'
// product -> credit column. Whitelist: column names never come from the client.
export const CREDIT_COLUMNS = {
  resume_check: 'credits_resume',
  cover_letter: 'credits_cover_letter',
  interview_prep: 'credits_interview_prep',
}
const TOKEN_RE = /^kit_[A-Za-z0-9_-]{8,64}$/
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]+$/
// Tables that get a paid_via column ('credit' when a kit credit paid for it).
const PAID_VIA_TABLES = ['resume_checks', 'cover_letter_requests', 'interview_prep_requests']

export function registerBundles({
  app, pool, safeTrim, createIpRateLimiter, getRequestIp, requireAdminAuth,
  createSquareQuickPayLink, APP_BASE_URL, devBypass = false, priceCents = 1299,
  // product -> { find(orderToken), markPaid(row) -> boolean, resultUrl(orderToken) }
  targets,
}) {
  const consumeCheckout = createIpRateLimiter(10 * 60 * 1000, 10)
  const consumeRedeem = createIpRateLimiter(10 * 60 * 1000, 30)
  const base = () => String(APP_BASE_URL || '').replace(/\/+$/, '')
  const resultUrl = (token) => `${base()}/?page=bundle&token=${encodeURIComponent(token)}`

  async function ensureTables() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS bundle_orders (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        public_token VARCHAR(64) NOT NULL,
        email VARCHAR(255) NULL DEFAULT NULL,
        price_cents INT NOT NULL,
        status VARCHAR(32) NOT NULL DEFAULT 'pending',
        square_order_id VARCHAR(255) NULL DEFAULT NULL,
        square_payment_id VARCHAR(255) NULL DEFAULT NULL,
        square_checkout_url TEXT NULL,
        paid_at DATETIME NULL DEFAULT NULL,
        credits_resume INT NOT NULL DEFAULT 0,
        credits_cover_letter INT NOT NULL DEFAULT 0,
        credits_interview_prep INT NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_bundle_orders_token (public_token),
        KEY idx_bundle_orders_square_order (square_order_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `)
    // One tool order can be paid by at most one credit, ever.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS bundle_redemptions (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        bundle_id BIGINT UNSIGNED NOT NULL,
        product VARCHAR(32) NOT NULL,
        order_token VARCHAR(128) NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_bundle_redemption (product, order_token),
        KEY idx_bundle_redemptions_bundle (bundle_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `)
    for (const table of PAID_VIA_TABLES) {
      try {
        const [rows] = await pool.query(`SHOW COLUMNS FROM ${table} LIKE 'paid_via'`)
        if (!rows.length) await pool.query(`ALTER TABLE ${table} ADD COLUMN paid_via VARCHAR(16) NULL DEFAULT NULL`)
      } catch (error) {
        console.error(`STARTUP: could not add ${table}.paid_via; admin and analytics revenue may be off:`, error?.message || error)
      }
    }
  }

  async function findKit(token) {
    if (!TOKEN_RE.test(token || '')) return null
    const [rows] = await pool.query('SELECT * FROM bundle_orders WHERE public_token = ? LIMIT 1', [token])
    return rows[0] || null
  }

  const credits = (row) => ({
    resume_check: Number(row.credits_resume) || 0,
    cover_letter: Number(row.credits_cover_letter) || 0,
    interview_prep: Number(row.credits_interview_prep) || 0,
  })

  // The only place a kit becomes paid. Idempotent: credits are granted only on
  // the pending -> paid transition, so a replayed webhook never refills them.
  async function markKitPaid(row, { paymentId = null, squareOrderId = null } = {}) {
    const [result] = await pool.query(
      `UPDATE bundle_orders
       SET status = 'paid', paid_at = COALESCE(paid_at, CURRENT_TIMESTAMP),
           square_payment_id = COALESCE(square_payment_id, ?), square_order_id = COALESCE(square_order_id, ?),
           credits_resume = 1, credits_cover_letter = 1, credits_interview_prep = 1
       WHERE id = ? AND status <> 'paid'`,
      [paymentId, squareOrderId, row.id]
    )
    return result?.affectedRows === 1
  }

  // Called by the Square webhook. Returns 'bundle' when the note is ours (even if
  // nothing was marked), null otherwise so other handlers still run.
  async function tryHandlePayment(payment) {
    const note = safeTrim(payment?.note, 500)
    if (!note.startsWith(BUNDLE_NOTE_PREFIX)) return null
    const token = note.slice(BUNDLE_NOTE_PREFIX.length).trim()
    const row = await findKit(token)
    if (!row) return 'bundle'
    if (String(payment.status || '').toLowerCase() !== 'completed') return 'bundle'

    const paidCents = Number(payment.amount_money?.amount) || 0
    const currency = String(payment.amount_money?.currency || '').toUpperCase()
    if (paidCents < (Number(row.price_cents) || priceCents) || currency !== 'USD') {
      console.error(`[bundle] ${token}: payment ${payment.id} of ${paidCents} ${currency} does not cover the kit; not marking paid`)
      return 'bundle'
    }
    await markKitPaid(row, { paymentId: payment.id || null, squareOrderId: payment.order_id || null })
    return 'bundle'
  }

  app.post('/api/bundle/checkout', async (req, res) => {
    try {
      if (!consumeCheckout(getRequestIp(req))) {
        return res.status(429).json({ success: false, error: 'Too many requests. Please try again later.' })
      }
      const email = safeTrim(req.body?.email, 255).toLowerCase()
      if (email && !EMAIL_RE.test(email)) {
        return res.status(400).json({ success: false, error: 'A valid email address is required.' })
      }

      // Repeat click: reuse the order and its Square link so the webhook always
      // matches the link that was paid.
      const existingToken = safeTrim(req.body?.token, 80)
      let row = existingToken ? await findKit(existingToken) : null
      if (row?.status === 'paid') {
        return res.json({ success: true, alreadyPaid: true, token: row.public_token, checkoutUrl: resultUrl(row.public_token) })
      }

      if (!row) {
        const token = `kit_${crypto.randomBytes(18).toString('base64url')}`
        const [inserted] = await pool.query(
          'INSERT INTO bundle_orders (public_token, email, price_cents, status) VALUES (?, ?, ?, ?)',
          [token, email || null, priceCents, 'pending']
        )
        row = { id: inserted?.insertId, public_token: token, price_cents: priceCents, status: 'pending', square_checkout_url: null }
      }

      if (devBypass) {
        await markKitPaid(row, { paymentId: 'dev-bypass' })
        return res.json({ success: true, devBypass: true, token: row.public_token, checkoutUrl: resultUrl(row.public_token) })
      }

      if (row.square_checkout_url) {
        return res.json({ success: true, token: row.public_token, checkoutUrl: row.square_checkout_url, priceCents: Number(row.price_cents) })
      }

      const { checkoutUrl, orderId } = await createSquareQuickPayLink({
        name: BUNDLE_PRODUCT_NAME,
        priceCents: Number(row.price_cents) || priceCents,
        currency: 'USD',
        note: `${BUNDLE_NOTE_PREFIX}${row.public_token}`,
        redirectUrl: resultUrl(row.public_token),
      })
      await pool.query(
        'UPDATE bundle_orders SET square_checkout_url = ?, square_order_id = COALESCE(?, square_order_id) WHERE id = ?',
        [checkoutUrl, orderId, row.id]
      )
      return res.json({ success: true, token: row.public_token, checkoutUrl, priceCents: Number(row.price_cents) || priceCents })
    } catch (error) {
      console.error('POST /api/bundle/checkout error:', error)
      return res.status(500).json({ success: false, error: 'Failed to create checkout.' })
    }
  })

  app.get('/api/bundle/:token', async (req, res) => {
    try {
      const row = await findKit(safeTrim(req.params.token, 80))
      if (!row) return res.status(404).json({ success: false, error: 'Kit not found.' })
      const paid = row.status === 'paid'
      return res.json({
        success: true,
        status: paid ? 'paid' : 'awaiting_payment',
        priceCents: Number(row.price_cents),
        credits: paid ? credits(row) : { resume_check: 0, cover_letter: 0, interview_prep: 0 },
      })
    } catch (error) {
      console.error('GET /api/bundle/:token error:', error)
      return res.status(500).json({ success: false, error: 'Failed to load kit.' })
    }
  })

  app.post('/api/bundle/:token/redeem', async (req, res) => {
    try {
      if (!consumeRedeem(getRequestIp(req))) {
        return res.status(429).json({ success: false, error: 'Too many requests. Please try again later.' })
      }
      const product = safeTrim(req.body?.product, 32)
      const orderToken = safeTrim(req.body?.orderToken, 128)
      const column = Object.hasOwn(CREDIT_COLUMNS, product) ? CREDIT_COLUMNS[product] : null
      if (!column || !orderToken) {
        return res.status(400).json({ success: false, error: 'A product and orderToken are required.' })
      }

      const kit = await findKit(safeTrim(req.params.token, 80))
      if (!kit) return res.status(404).json({ success: false, error: 'Kit not found.' })
      if (kit.status !== 'paid') return res.status(402).json({ success: false, error: 'This kit has not been paid for yet.' })

      const target = targets[product]
      const order = await target.find(orderToken)
      if (!order) return res.status(404).json({ success: false, error: 'Order not found.' })
      if (order.payment_status === 'paid') {
        return res.status(409).json({ success: false, error: 'That order is already paid.' })
      }

      // Take the credit first: the conditional UPDATE is the only gate, so two
      // simultaneous redeems can never both spend the last credit.
      const [taken] = await pool.query(
        `UPDATE bundle_orders SET ${column} = ${column} - 1 WHERE id = ? AND status = 'paid' AND ${column} > 0`,
        [kit.id]
      )
      if (taken?.affectedRows !== 1) {
        return res.status(409).json({ success: false, error: 'No credit left for that tool.' })
      }

      const giveBack = () =>
        pool.query(`UPDATE bundle_orders SET ${column} = ${column} + 1 WHERE id = ?`, [kit.id]).catch((error) =>
          console.error(`[bundle] CREDIT LOST: could not restore ${column} on kit ${kit.id}:`, error?.message || error)
        )

      let marked = false
      try {
        marked = await target.markPaid(order)
      } catch (error) {
        console.error(`[bundle] redeem ${product} ${orderToken} failed:`, error?.message || error)
        await giveBack()
        return res.status(500).json({ success: false, error: 'Could not apply the credit. It was not used.' })
      }
      if (!marked) {
        await giveBack()
        return res.status(409).json({ success: false, error: 'That order is already paid.' })
      }

      await pool.query(
        'INSERT INTO bundle_redemptions (bundle_id, product, order_token) VALUES (?, ?, ?)',
        [kit.id, product, orderToken]
      ).catch((error) => console.error(`[bundle] could not record redemption of ${product} ${orderToken}:`, error?.message || error))

      const fresh = (await findKit(kit.public_token)) || kit
      return res.json({ success: true, resultUrl: target.resultUrl(orderToken), remaining: credits(fresh) })
    } catch (error) {
      console.error('POST /api/bundle/:token/redeem error:', error)
      return res.status(500).json({ success: false, error: 'Failed to redeem.' })
    }
  })

  app.get('/api/admin/bundles', requireAdminAuth, async (req, res) => {
    try {
      const [[totals], [recent], [redemptions]] = await Promise.all([
        pool.query(
          `SELECT COUNT(*) AS paid_orders, COALESCE(SUM(price_cents), 0) AS sales_cents,
             COALESCE(SUM(credits_resume + credits_cover_letter + credits_interview_prep), 0) AS credits_left
           FROM bundle_orders WHERE status = 'paid'`
        ),
        pool.query(
          `SELECT id, email, price_cents, status, credits_resume, credits_cover_letter, credits_interview_prep, created_at, paid_at
           FROM bundle_orders ORDER BY id DESC LIMIT 25`
        ),
        pool.query('SELECT bundle_id, product, order_token, created_at FROM bundle_redemptions ORDER BY id DESC LIMIT 25'),
      ])
      const t = totals[0] || {}
      return res.json({
        success: true,
        paid_orders: Number(t.paid_orders) || 0,
        sales_cents: Number(t.sales_cents) || 0,
        credits_left: Number(t.credits_left) || 0,
        recent_orders: recent.map((r) => ({
          id: r.id, email: r.email, price_cents: Number(r.price_cents), status: r.status,
          credits: { resume_check: Number(r.credits_resume), cover_letter: Number(r.credits_cover_letter), interview_prep: Number(r.credits_interview_prep) },
          created_at: r.created_at, paid_at: r.paid_at,
        })),
        recent_redemptions: redemptions,
      })
    } catch (error) {
      console.error('GET /api/admin/bundles error:', error)
      return res.status(500).json({ success: false, error: 'Failed to load kit orders.' })
    }
  })

  return { ensureTables, tryHandlePayment, markKitPaid }
}
