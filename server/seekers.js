// Job seeker accounts: passwordless sign-in by emailed link, a saved profile
// and resume, one-click apply to employer-posted jobs, and saved jobs.
//
// Sign-in: POST /api/seeker/login always answers the same way and mails a
// single-use link (15 min). Nothing is looked up, so the answer never reveals
// whether an account exists; the account is created on the first verified
// login. GET /api/seeker/verify trades the link token for a session JWT.
//
// Session tokens use the site JWT secret but always carry aud=SEEKER_AUDIENCE
// and typ='seeker'. They are verified with that audience here, and
// verifyEmployerJwt in server.js refuses any token with an aud or typ, so a
// seeker token never works as an employer/admin token or the other way round.
//
// Saved resumes live in the private resumes folder like application resumes.
// They are never served to employers or admins: sendResumeFile only finds
// files referenced by job_seekers (applications). One-click apply copies the
// saved file to a new name for that application.
//
// Times written here come from the injected clock as JS Dates (see alerts.js).
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import jwt from 'jsonwebtoken'

export const SEEKER_AUDIENCE = 'tarborojobs:seeker'
const LOGIN_TOKEN_TTL_MS = 15 * 60 * 1000
const SESSION_TTL = '30d'
const TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/
const GENERIC_LOGIN_RESPONSE = {
  success: true,
  message: 'Check your email. If the address can receive mail, a sign-in link is on its way. It works once, for 15 minutes.',
}
// What a job seeker sees for the employer's candidate status (never the notes).
const STATUS_LABELS = {
  new: 'Sent',
  reviewed: 'Viewed by employer',
  interview: 'Interview',
  hired: 'Hired',
  rejected: 'Not selected',
}

function clean(value, maxLength) {
  const text = String(value ?? '').trim()
  return text.slice(0, maxLength) || null
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex')
}

function isClosed(row, now) {
  if (!row.job_title) return true
  if (row.status !== 'open') return true
  if (row.expires_at && new Date(row.expires_at) <= now) return true
  return row.access_status !== 'active' || !Number(row.onboarding_completed)
}

export function register({
  app,
  pool,
  jwtSecret,
  getMailer,
  getMailFrom,
  createIpRateLimiter,
  getRequestIp,
  escapeHtml,
  upload,
  discardUploadOnError,
  resumesDir,
  newResumeFileName,
  expireOpenJobs,
  findPublicJobPostById,
  createJobApplication,
  normalizeCandidateStatus,
  APP_BASE_URL,
  now: clock = () => new Date(),
}) {
  const base = String(APP_BASE_URL || '').replace(/\/+$/, '')
  const consumeLoginIp = createIpRateLimiter(60 * 60 * 1000, 10)
  // Per address, so nobody can flood one inbox from many IPs. Over the limit the
  // answer is unchanged and no mail is sent.
  const consumeLoginEmail = createIpRateLimiter(60 * 60 * 1000, 3)
  const consumeVerify = createIpRateLimiter(15 * 60 * 1000, 20)
  const consumeUpload = createIpRateLimiter(60 * 60 * 1000, 10)
  const consumeApply = createIpRateLimiter(60 * 60 * 1000, 20)

  const limit = (consume, error) => (req, res, next) =>
    consume(getRequestIp(req)) ? next() : res.status(429).json({ success: false, error })

  async function ensureTables() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS job_seeker_accounts (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        email VARCHAR(255) NOT NULL,
        full_name VARCHAR(255) NULL,
        phone VARCHAR(50) NULL,
        town VARCHAR(255) NULL,
        desired_job_title VARCHAR(255) NULL,
        summary TEXT NULL,
        resume_file_url VARCHAR(255) NULL,
        resume_file_name VARCHAR(255) NULL,
        resume_uploaded_at DATETIME NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_login_at DATETIME NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uniq_job_seeker_accounts_email (email)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS seeker_login_tokens (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        email VARCHAR(255) NOT NULL,
        token_hash CHAR(64) NOT NULL,
        expires_at DATETIME NOT NULL,
        used_at DATETIME NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uniq_seeker_login_tokens_hash (token_hash),
        KEY idx_seeker_login_tokens_email (email)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS seeker_saved_jobs (
        seeker_id BIGINT UNSIGNED NOT NULL,
        job_post_id BIGINT UNSIGNED NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (seeker_id, job_post_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `)
    // One row per one-click apply; the primary key stops a double submit from
    // creating two applications. job_seeker_id is the application it created.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS seeker_applications (
        seeker_id BIGINT UNSIGNED NOT NULL,
        job_post_id BIGINT UNSIGNED NOT NULL,
        job_seeker_id BIGINT UNSIGNED NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (seeker_id, job_post_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `)
  }

  function resumePath(url) {
    const name = path.basename(String(url || ''))
    return name ? path.join(resumesDir, name) : null
  }

  function removeFile(url) {
    const filePath = resumePath(url)
    return filePath ? fs.promises.unlink(filePath).catch(() => {}) : Promise.resolve()
  }

  function issueSession(seekerId) {
    return jwt.sign({ typ: 'seeker', sid: Number(seekerId) }, jwtSecret, {
      audience: SEEKER_AUDIENCE,
      expiresIn: SESSION_TTL,
    })
  }

  async function requireSeeker(req, res, next) {
    const header = req.headers.authorization || ''
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
    try {
      const decoded = jwt.verify(token, jwtSecret, { audience: SEEKER_AUDIENCE })
      if (decoded.typ !== 'seeker' || !Number(decoded.sid)) throw new Error('Not a seeker token.')
      const [rows] = await pool.query('SELECT * FROM job_seeker_accounts WHERE id = ? LIMIT 1', [Number(decoded.sid)])
      if (!rows.length) throw new Error('Account not found.')
      req.seeker = rows[0]
      next()
    } catch {
      res.status(401).json({ success: false, error: 'Please sign in again.' })
    }
  }

  function publicProfile(row) {
    return {
      email: row.email,
      full_name: row.full_name || '',
      phone: row.phone || '',
      town: row.town || '',
      desired_job_title: row.desired_job_title || '',
      summary: row.summary || '',
      has_resume: !!row.resume_file_url,
      resume_file_name: row.resume_file_url ? row.resume_file_name || 'resume.pdf' : null,
      resume_uploaded_at: row.resume_uploaded_at || null,
    }
  }

  async function sendLoginLink(email, token) {
    const transporter = getMailer()
    if (!transporter || !base) {
      console.error('[seekers] sign-in email not sent; mail or APP_BASE_URL is not configured.')
      return
    }
    const url = `${base}/?page=seeker-verify&token=${encodeURIComponent(token)}`
    const reason = 'You got this email because someone entered this address on TarboroJobs.com. If it was not you, ignore it; nothing happens unless the link is used.'
    await transporter.sendMail({
      from: getMailFrom(),
      to: email,
      subject: 'Your TarboroJobs sign-in link',
      text: ['Sign in to TarboroJobs:', url, '', 'This link works once and expires in 15 minutes.', '', reason].join('\n'),
      html: `<!doctype html><html><body style="margin:0;padding:0;background:#f8fafc">
<div style="max-width:600px;margin:0 auto;padding:20px 16px;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
<h1 style="font-size:20px;margin:0 0 12px">Sign in to TarboroJobs</h1>
<p><a href="${escapeHtml(url)}" style="display:inline-block;background:#22d3ee;color:#020617;font-weight:bold;text-decoration:none;padding:12px 20px;border-radius:12px">Sign in</a></p>
<p style="font-size:13px;color:#475569">This link works once and expires in 15 minutes.</p>
<p style="font-size:12px;color:#64748b">${escapeHtml(reason)}</p>
</div></body></html>`,
    })
  }

  app.post('/api/seeker/login', limit(consumeLoginIp, 'Too many sign-in requests. Please try again later.'), async (req, res) => {
    const email = String(req.body?.email ?? '').trim().toLowerCase().slice(0, 255)
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, error: 'Enter a valid email address.' })
    }
    try {
      if (consumeLoginEmail(email)) {
        const token = crypto.randomBytes(32).toString('base64url')
        await pool.query(
          'INSERT INTO seeker_login_tokens (email, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?)',
          [email, sha256(token), new Date(clock().getTime() + LOGIN_TOKEN_TTL_MS), clock()]
        )
        // Not awaited: the answer must not depend on the mail server.
        sendLoginLink(email, token).catch((error) => console.error('[seekers] sign-in email failed:', error?.message || error))
      }
      res.json(GENERIC_LOGIN_RESPONSE)
    } catch (error) {
      console.error('POST /api/seeker/login error:', error)
      res.status(500).json({ success: false, error: 'Could not send a sign-in link. Please try again.' })
    }
  })

  app.get('/api/seeker/verify', limit(consumeVerify, 'Too many attempts. Please try again later.'), async (req, res) => {
    const invalid = () => res.status(400).json({ success: false, error: 'This sign-in link is invalid, expired or already used. Request a new one.' })
    const token = String(req.query.token || '')
    if (!TOKEN_RE.test(token)) return invalid()
    try {
      const [rows] = await pool.query(
        'SELECT id, email, expires_at, used_at FROM seeker_login_tokens WHERE token_hash = ? LIMIT 1',
        [sha256(token)]
      )
      const row = rows[0]
      if (!row || row.used_at || new Date(row.expires_at) <= clock()) return invalid()
      // Single use, even if two requests race: only one UPDATE matches.
      const [used] = await pool.query('UPDATE seeker_login_tokens SET used_at = ? WHERE id = ? AND used_at IS NULL', [clock(), row.id])
      if (!used.affectedRows) return invalid()

      await pool.query('INSERT IGNORE INTO job_seeker_accounts (email, created_at) VALUES (?, ?)', [row.email, clock()])
      await pool.query('UPDATE job_seeker_accounts SET last_login_at = ? WHERE email = ?', [clock(), row.email])
      const [accounts] = await pool.query('SELECT * FROM job_seeker_accounts WHERE email = ? LIMIT 1', [row.email])
      if (!accounts.length) throw new Error('account row missing after insert')
      res.json({ success: true, token: issueSession(accounts[0].id), profile: publicProfile(accounts[0]) })
    } catch (error) {
      console.error('GET /api/seeker/verify error:', error)
      res.status(500).json({ success: false, error: 'Could not sign you in. Please try again.' })
    }
  })

  // Profile plus the job ids the UI needs to mark saved/applied jobs.
  app.get('/api/seeker/profile', requireSeeker, async (req, res) => {
    try {
      const [saved] = await pool.query('SELECT job_post_id FROM seeker_saved_jobs WHERE seeker_id = ?', [req.seeker.id])
      const [applied] = await pool.query(
        'SELECT DISTINCT job_post_id FROM job_seekers WHERE email = ? AND job_post_id IS NOT NULL',
        [req.seeker.email]
      )
      res.json({
        success: true,
        profile: publicProfile(req.seeker),
        saved_job_ids: saved.map((row) => Number(row.job_post_id)),
        applied_job_ids: applied.map((row) => Number(row.job_post_id)),
      })
    } catch (error) {
      console.error('GET /api/seeker/profile error:', error)
      res.status(500).json({ success: false, error: 'Could not load your profile.' })
    }
  })

  app.put('/api/seeker/profile', requireSeeker, async (req, res) => {
    const body = req.body || {}
    const fields = {
      full_name: clean(body.full_name, 255),
      phone: clean(body.phone, 50),
      town: clean(body.town, 255),
      desired_job_title: clean(body.desired_job_title, 255),
      summary: clean(body.summary, 2000),
    }
    try {
      await pool.query(
        'UPDATE job_seeker_accounts SET full_name = ?, phone = ?, town = ?, desired_job_title = ?, summary = ? WHERE id = ?',
        [fields.full_name, fields.phone, fields.town, fields.desired_job_title, fields.summary, req.seeker.id]
      )
      res.json({ success: true, profile: publicProfile({ ...req.seeker, ...fields }) })
    } catch (error) {
      console.error('PUT /api/seeker/profile error:', error)
      res.status(500).json({ success: false, error: 'Could not save your profile.' })
    }
  })

  // Same multer setup, PDF filter, size cap and cleanup as application uploads.
  app.post(
    '/api/seeker/resume',
    discardUploadOnError,
    upload.single('resume_file'),
    limit(consumeUpload, 'Too many uploads. Please try again later.'),
    requireSeeker,
    async (req, res) => {
      if (!req.file) return res.status(400).json({ success: false, error: 'Choose a PDF resume to upload.' })
      try {
        const url = `/uploads/resumes/${req.file.filename}`
        const name = clean(path.basename(String(req.file.originalname || '')), 255) || 'resume.pdf'
        const uploadedAt = clock()
        await pool.query(
          'UPDATE job_seeker_accounts SET resume_file_url = ?, resume_file_name = ?, resume_uploaded_at = ? WHERE id = ?',
          [url, name, uploadedAt, req.seeker.id]
        )
        req.keepUpload = true
        if (req.seeker.resume_file_url && req.seeker.resume_file_url !== url) await removeFile(req.seeker.resume_file_url)
        res.json({
          success: true,
          profile: publicProfile({ ...req.seeker, resume_file_url: url, resume_file_name: name, resume_uploaded_at: uploadedAt }),
        })
      } catch (error) {
        console.error('POST /api/seeker/resume error:', error)
        res.status(500).json({ success: false, error: 'Could not save your resume.' })
      }
    }
  )

  // The signed-in seeker's own saved resume, for checking what will be sent.
  app.get('/api/seeker/resume', requireSeeker, (req, res) => {
    const filePath = resumePath(req.seeker.resume_file_url)
    if (!filePath || !fs.existsSync(filePath)) return res.status(404).json({ success: false, error: 'No saved resume.' })
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="resume.pdf"',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    })
    res.sendFile(path.basename(filePath), { root: resumesDir })
  })

  app.post('/api/seeker/apply/:jobId', limit(consumeApply, 'Too many applications. Please try again later.'), requireSeeker, async (req, res) => {
    const seeker = req.seeker
    const jobId = Number(req.params.jobId)
    if (!jobId) return res.status(400).json({ success: false, error: 'A valid job ID is required.' })
    if (!seeker.full_name) return res.status(400).json({ success: false, error: 'Add your name to your profile first.' })
    if (!seeker.resume_file_url) return res.status(400).json({ success: false, error: 'Upload a resume to your profile first.' })

    let claimed = false
    let copyName = null
    let saved = false
    try {
      await expireOpenJobs()
      const job = await findPublicJobPostById(jobId)
      if (!job) return res.status(404).json({ success: false, error: 'This job is no longer accepting applications.' })
      if (job.source_url) {
        return res.status(400).json({ success: false, error: 'This job accepts applications on the employer\'s official site, not through TarboroJobs.' })
      }

      // Also catches an earlier guest application sent with the same address.
      const [earlier] = await pool.query(
        'SELECT id FROM job_seekers WHERE job_post_id = ? AND email = ? LIMIT 1',
        [job.id, seeker.email]
      )
      if (earlier.length) return res.status(409).json({ success: false, error: 'You already applied to this job.' })
      try {
        await pool.query('INSERT INTO seeker_applications (seeker_id, job_post_id, created_at) VALUES (?, ?, ?)', [seeker.id, job.id, clock()])
        claimed = true
      } catch (error) {
        if (error?.code === 'ER_DUP_ENTRY') return res.status(409).json({ success: false, error: 'You already applied to this job.' })
        throw error
      }

      const source = resumePath(seeker.resume_file_url)
      if (!source || !fs.existsSync(source)) {
        return res.status(400).json({ success: false, error: 'Your saved resume is missing. Please upload it again.' })
      }
      copyName = newResumeFileName()
      const copyPath = path.join(resumesDir, copyName)
      await fs.promises.copyFile(source, copyPath, fs.constants.COPYFILE_EXCL)

      const { id } = await createJobApplication(
        job,
        {
          fullName: seeker.full_name,
          email: seeker.email,
          phone: seeker.phone,
          city: seeker.town,
          desiredJobTitle: job.job_title,
          employmentType: job.employment_type || 'any',
          skills: null,
          applicantNote: seeker.summary,
        },
        { path: copyPath, filename: copyName },
        () => { saved = true }
      )
      await pool.query(
        'UPDATE seeker_applications SET job_seeker_id = ? WHERE seeker_id = ? AND job_post_id = ?',
        [id, seeker.id, job.id]
      )
      res.json({ success: true, id, message: 'Application sent with your profile.' })
    } catch (error) {
      console.error('POST /api/seeker/apply/:jobId error:', error)
      res.status(500).json({ success: false, error: 'Failed to submit application.' })
    } finally {
      // Undo the claim and the copied file unless an application now uses them.
      if (!saved && res.statusCode >= 400) {
        if (copyName) removeFile(copyName)
        if (claimed) {
          pool.query('DELETE FROM seeker_applications WHERE seeker_id = ? AND job_post_id = ?', [seeker.id, jobId])
            .catch((error) => console.error('[seekers] could not release apply claim:', error?.message || error))
        }
      }
    }
  })

  app.get('/api/seeker/applications', requireSeeker, async (req, res) => {
    try {
      const [rows] = await pool.query(
        `SELECT js.id, js.job_post_id, js.created_at, jp.job_title, e.business_name, eca.status AS candidate_status
         FROM job_seekers js
         LEFT JOIN job_posts jp ON jp.id = js.job_post_id
         LEFT JOIN employers e ON e.id = jp.employer_id
         LEFT JOIN employer_candidate_actions eca ON eca.job_seeker_id = js.id AND eca.employer_id = js.employer_id
         WHERE js.email = ? AND js.job_post_id IS NOT NULL
         ORDER BY js.created_at DESC
         LIMIT 200`,
        [req.seeker.email]
      )
      res.json({
        success: true,
        applications: rows.map((row) => ({
          id: Number(row.id),
          job_id: Number(row.job_post_id),
          job_title: row.job_title || 'Job no longer listed',
          company: row.business_name || '',
          applied_at: row.created_at,
          status: STATUS_LABELS[normalizeCandidateStatus(row.candidate_status) || 'new'] || STATUS_LABELS.new,
        })),
      })
    } catch (error) {
      console.error('GET /api/seeker/applications error:', error)
      res.status(500).json({ success: false, error: 'Could not load your applications.' })
    }
  })

  app.get('/api/seeker/saved-jobs', requireSeeker, async (req, res) => {
    try {
      const [rows] = await pool.query(
        `SELECT s.job_post_id, s.created_at AS saved_at, jp.job_title, jp.city, jp.status, jp.expires_at, jp.source_url,
                e.business_name, e.access_status, e.onboarding_completed
         FROM seeker_saved_jobs s
         LEFT JOIN job_posts jp ON jp.id = s.job_post_id
         LEFT JOIN employers e ON e.id = jp.employer_id
         WHERE s.seeker_id = ?
         ORDER BY s.created_at DESC`,
        [req.seeker.id]
      )
      const now = clock()
      res.json({
        success: true,
        jobs: rows.map((row) => ({
          job_id: Number(row.job_post_id),
          title: row.job_title || 'Job no longer listed',
          company: row.business_name || '',
          city: row.city || '',
          external: !!row.source_url,
          saved_at: row.saved_at,
          closed: isClosed(row, now),
        })),
      })
    } catch (error) {
      console.error('GET /api/seeker/saved-jobs error:', error)
      res.status(500).json({ success: false, error: 'Could not load your saved jobs.' })
    }
  })

  // Any public job can be saved, including scraped ones that apply off-site.
  app.post('/api/seeker/saved-jobs/:jobId', requireSeeker, async (req, res) => {
    try {
      const job = await findPublicJobPostById(Number(req.params.jobId) || 0)
      if (!job) return res.status(404).json({ success: false, error: 'Job not found.' })
      await pool.query(
        'INSERT IGNORE INTO seeker_saved_jobs (seeker_id, job_post_id, created_at) VALUES (?, ?, ?)',
        [req.seeker.id, job.id, clock()]
      )
      res.json({ success: true, saved: true })
    } catch (error) {
      console.error('POST /api/seeker/saved-jobs error:', error)
      res.status(500).json({ success: false, error: 'Could not save this job.' })
    }
  })

  app.delete('/api/seeker/saved-jobs/:jobId', requireSeeker, async (req, res) => {
    try {
      await pool.query('DELETE FROM seeker_saved_jobs WHERE seeker_id = ? AND job_post_id = ?', [req.seeker.id, Number(req.params.jobId) || 0])
      res.json({ success: true, saved: false })
    } catch (error) {
      console.error('DELETE /api/seeker/saved-jobs error:', error)
      res.status(500).json({ success: false, error: 'Could not remove this job.' })
    }
  })

  // Applications already sent stay with those employers (they are the
  // employer's records); everything kept for the account itself goes.
  app.delete('/api/seeker/account', requireSeeker, async (req, res) => {
    const seeker = req.seeker
    try {
      await pool.query('DELETE FROM seeker_saved_jobs WHERE seeker_id = ?', [seeker.id])
      await pool.query('DELETE FROM seeker_applications WHERE seeker_id = ?', [seeker.id])
      await pool.query('DELETE FROM seeker_login_tokens WHERE email = ?', [seeker.email])
      await pool.query('DELETE FROM job_seeker_accounts WHERE id = ?', [seeker.id])
      if (seeker.resume_file_url) await removeFile(seeker.resume_file_url)
      res.json({
        success: true,
        message: 'Your profile, saved resume and saved jobs are deleted. Applications you already sent stay with those employers; contact them to remove them.',
      })
    } catch (error) {
      console.error('DELETE /api/seeker/account error:', error)
      res.status(500).json({ success: false, error: 'Could not delete your account. Please try again.' })
    }
  })

  return { ensureTables, requireSeeker }
}
