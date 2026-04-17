import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import nodemailer from 'nodemailer'
import { fileURLToPath } from 'url'
import pool from './db.js'

dotenv.config()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()

const PORT = Number(process.env.PORT || 3000)
const JOB_POST_EXPIRATION_DAYS = 14
const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-secret-change-this'
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || process.env.ADMIN_BEARER_TOKEN || ''
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || ''
const APP_BASE_URL =
  process.env.APP_BASE_URL ||
  process.env.PUBLIC_APP_URL ||
  process.env.FRONTEND_URL ||
  ''
const EMPLOYER_ONBOARDING_BASE_URL =
  process.env.EMPLOYER_ONBOARDING_BASE_URL ||
  APP_BASE_URL
const EMPLOYER_PASSWORD_RESET_BASE_URL =
  process.env.EMPLOYER_PASSWORD_RESET_BASE_URL ||
  APP_BASE_URL
const DB_NAME = process.env.DB_NAME || ''

const projectRoot = path.resolve(__dirname, '..')
const frontendDistDir = path.join(projectRoot, 'dist')
const frontendIndexFile = path.join(frontendDistDir, 'index.html')

const uploadsRoot = path.join(__dirname, 'uploads')
const resumesDir = path.join(uploadsRoot, 'resumes')

const ALLOWED_CANDIDATE_STATUSES = new Set([
  'saved',
  'archived',
  'contacted',
  'interviewing',
  'hired',
  'rejected',
])

const ALLOWED_JOB_STATUSES = new Set(['draft', 'open', 'closed', 'filled', 'expired'])
const ALLOWED_PAY_TYPES = new Set(['hourly', 'salary', 'daily', 'weekly', 'monthly'])
const ALLOWED_EMPLOYMENT_TYPES = new Set(['full-time', 'part-time', 'temporary', 'contract'])

const BLOCKED_JOB_POSTING_PATTERNS = [
  { label: 'men only / male only', regex: /\b(?:men|male)s?\s+only\b/i },
  { label: 'women only / female only', regex: /\b(?:women|female)s?\s+only\b/i },
  { label: 'young candidate language', regex: /\byoung\s+(?:man|woman|person|people|candidate|applicant|worker|professional)\b/i },
  { label: 'age limit language', regex: /\b(?:must\s+be\s+under|under)\s+\d{2}\b/i },
  { label: 'U.S. citizens only', regex: /\bu\.?s\.?\s+citizens?\s+only\b/i },
  { label: 'citizens only', regex: /\bcitizens?\s+only\b/i },
  { label: 'green card only', regex: /\bgreen\s+card\s+only\b/i },
  { label: 'H-1B only', regex: /\bh-?1b\s+only\b/i },
  { label: 'native English only', regex: /\bnative\s+english\s+(?:speaker|speakers)\s+only\b/i },
  { label: 'pregnancy exclusion', regex: /\bno\s+pregnant\s+(?:applicants|people|women)\b/i },
  { label: 'disability exclusion', regex: /\b(?:no\s+disabled\s+applicants|able-bodied\s+only)\b/i },
  { label: 'religion-only hiring language', regex: /\b(?:christian|muslim|jewish|hindu)\s+only\b/i },
  { label: 'applicant fee language', regex: /\b(?:application|training|starter\s+kit|equipment)\s+fee\b/i },
  { label: 'bank account request', regex: /\bbank\s+account\b/i },
  { label: 'social security number request', regex: /\b(?:social\s+security\s+number|ssn)\b/i },
  { label: 'Telegram recruiting', regex: /\btelegram\b/i },
  { label: 'WhatsApp recruiting', regex: /\bwhatsapp\b/i },
  { label: 'crypto payment language', regex: /\b(?:crypto|bitcoin|usdt)\b/i },
]
const ATS_STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'for', 'from', 'has', 'have',
  'in', 'into', 'is', 'it', 'its', 'of', 'on', 'or', 'our', 'that', 'the', 'their',
  'this', 'to', 'we', 'will', 'with', 'you', 'your', 'years', 'year', 'plus', 'using',
  'use', 'used', 'ability', 'able', 'preferred', 'required', 'requirements', 'responsibilities',
  'experience', 'including', 'within', 'across', 'through', 'about', 'other', 'must', 'can', 'may'
])


ensureDir(uploadsRoot)
ensureDir(resumesDir)

const corsOptions = {
  origin(origin, callback) {
    if (!FRONTEND_ORIGIN) {
      callback(null, true)
      return
    }

    const allowedOrigins = FRONTEND_ORIGIN
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)

    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true)
      return
    }

    callback(new Error('Not allowed by CORS'))
  },
  credentials: true,
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, resumesDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase() || '.pdf'
    const base =
      path
        .basename(file.originalname || 'resume', ext)
        .replace(/[^a-zA-Z0-9_-]/g, '-')
        .replace(/-{2,}/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 80) || 'resume'

    cb(null, `${Date.now()}-${base}${ext}`)
  },
})

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 1,
  },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase()
    const mime = String(file.mimetype || '').toLowerCase()
    const isPdf = ext === '.pdf' && (mime.includes('pdf') || mime === 'application/octet-stream')

    if (!isPdf) {
      cb(new Error('Only PDF resume files are allowed.'))
      return
    }

    cb(null, true)
  },
})

app.disable('x-powered-by')
app.use(cors(corsOptions))
app.use(express.json({ limit: '2mb' }))
app.use(express.urlencoded({ extended: true }))
app.use('/uploads', express.static(uploadsRoot))

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true })
  }
}

function safeTrim(value, maxLength = null) {
  if (value === undefined || value === null) return ''
  let normalized = String(value).trim()
  if (maxLength && normalized.length > maxLength) {
    normalized = normalized.slice(0, maxLength)
  }
  return normalized
}

function toNullableString(value, maxLength = null) {
  const normalized = safeTrim(value, maxLength)
  return normalized || null
}

function normalizeEmail(value) {
  return safeTrim(value, 255).toLowerCase()
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim())
}

function parseBoolean(value) {
  if (typeof value === 'boolean') return value
  const normalized = String(value || '').trim().toLowerCase()
  return ['1', 'true', 'yes', 'on'].includes(normalized)
}

function parseDateOrNull(value) {
  if (value === undefined || value === null || value === '') return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function parseMoney(value) {
  if (value === undefined || value === null || value === '') return null
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return null
  return Math.round(numeric * 100) / 100
}

function normalizeEnum(value, allowedValues, fallback = null) {
  const normalized = safeTrim(value).toLowerCase()
  if (!normalized) return fallback
  return allowedValues.has(normalized) ? normalized : fallback
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex')
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex')
}

function addDays(days) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d
}

function addDaysToDate(dateValue, days) {
  const base = dateValue ? new Date(dateValue) : new Date()
  if (Number.isNaN(base.getTime())) {
    const fallback = new Date()
    fallback.setDate(fallback.getDate() + days)
    return fallback
  }
  base.setDate(base.getDate() + days)
  return base
}

function parseDateValue(value) {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function getBlockedJobPostingTerms(values = []) {
  const combined = values
    .filter((value) => value !== undefined && value !== null)
    .map((value) => String(value))
    .join('\n')

  if (!combined) return []

  const matches = []

  BLOCKED_JOB_POSTING_PATTERNS.forEach((pattern) => {
    if (pattern.regex.test(combined)) {
      matches.push(pattern.label)
    }
  })

  return [...new Set(matches)]
}

function resolveJobLifecycleFields(requestedStatus, existingJob = null) {
  const now = new Date()
  let status = requestedStatus || 'open'
  let publishedAt = parseDateValue(existingJob?.published_at)
  let expiresAt = parseDateValue(existingJob?.expires_at)
  let expiredAt = parseDateValue(existingJob?.expired_at)

  if (status === 'open') {
    const existingExpiry = parseDateValue(existingJob?.expires_at)
    const needsFreshWindow =
      !existingJob ||
      existingJob.status !== 'open' ||
      !existingExpiry ||
      existingExpiry.getTime() <= now.getTime()

    if (needsFreshWindow) {
      publishedAt = now
      expiresAt = addDaysToDate(now, JOB_POST_EXPIRATION_DAYS)
    }

    expiredAt = null
  } else if (status === 'draft') {
    publishedAt = null
    expiresAt = null
    expiredAt = null
  } else if (status === 'expired') {
    if (!publishedAt) publishedAt = existingJob?.created_at ? parseDateValue(existingJob.created_at) : now
    if (!expiresAt) expiresAt = now
    expiredAt = now
  } else {
    expiredAt = null
  }

  return {
    status,
    publishedAt,
    expiresAt,
    expiredAt,
  }
}


function tokenizeAtsText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9+#./\s-]/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
    .filter((token) => !ATS_STOP_WORDS.has(token))
}

function buildRankedKeywordList(values, limit = 16) {
  const counts = new Map()

  values
    .filter(Boolean)
    .flatMap((value) => tokenizeAtsText(value))
    .forEach((token) => {
      counts.set(token, (counts.get(token) || 0) + 1)
    })

  return [...counts.entries()]
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1]
      return a[0].localeCompare(b[0])
    })
    .map(([token]) => token)
    .slice(0, limit)
}

function buildAtsAssessment(job, application) {
  const titleKeywords = buildRankedKeywordList([job.job_title], 6)
  const jobKeywords = buildRankedKeywordList(
    [job.job_title, job.job_description, job.experience_level, job.city, job.employment_type],
    14
  )

  const combinedApplicantText = [
    application.desired_job_title,
    application.skills,
    application.resume_text,
    application.resume_pdf_text,
  ]
    .filter(Boolean)
    .join('\n')

  const applicantTokenSet = new Set(tokenizeAtsText(combinedApplicantText))
  const matchedTitleKeywords = titleKeywords.filter((token) => applicantTokenSet.has(token))
  const matchedKeywords = jobKeywords.filter((token) => applicantTokenSet.has(token))
  const missingKeywords = jobKeywords.filter((token) => !applicantTokenSet.has(token))

  const titleCoverage = titleKeywords.length ? matchedTitleKeywords.length / titleKeywords.length : 0
  const keywordCoverage = jobKeywords.length ? matchedKeywords.length / jobKeywords.length : 0
  const employmentTypeMatches =
    !job.employment_type ||
    !application.employment_type ||
    application.employment_type === 'any' ||
    application.employment_type === job.employment_type

  let score = Math.round(keywordCoverage * 65 + titleCoverage * 25 + (employmentTypeMatches ? 10 : 0))

  if (!combinedApplicantText.trim()) {
    score = 0
  }

  let recommendation = 'needs_review'

  if (score >= 70) {
    recommendation = 'strong_match'
  } else if (score >= 45) {
    recommendation = 'possible_match'
  } else if (score > 0) {
    recommendation = 'low_match'
  }

  const summaryParts = []

  if (matchedKeywords.length > 0) {
    summaryParts.push(`Matched keywords: ${matchedKeywords.slice(0, 6).join(', ')}`)
  }

  if (missingKeywords.length > 0) {
    summaryParts.push(`Missing signals: ${missingKeywords.slice(0, 6).join(', ')}`)
  }

  if (matchedTitleKeywords.length > 0) {
    summaryParts.push('The resume language overlaps with the job title.')
  }

  if (!summaryParts.length) {
    summaryParts.push('Not enough overlap was found between the posting and the submitted resume text.')
  }

  return {
    score,
    recommendation,
    summary: summaryParts.join(' '),
    matched_keywords: matchedKeywords,
    missing_keywords: missingKeywords.slice(0, 8),
    title_match: matchedTitleKeywords.length > 0,
  }
}

async function extractPdfTextFromFile(filePath) {
  if (!filePath) return ''

  try {
    const pdfParseModule = await import('pdf-parse')
    const pdfParse = pdfParseModule.default || pdfParseModule
    const fileBuffer = await fs.promises.readFile(filePath)
    const parsed = await pdfParse(fileBuffer)
    return safeTrim(parsed?.text || '', 50000)
  } catch (error) {
    console.warn('PDF text extraction unavailable or failed:', error?.message || error)
    return ''
  }
}

async function findPublicJobPostById(jobId) {
  const [rows] = await pool.query(
    `
    SELECT
      jp.id,
      jp.employer_id,
      jp.job_title,
      jp.job_description,
      jp.city,
      jp.pay_min,
      jp.pay_max,
      jp.pay_type,
      jp.employment_type,
      jp.experience_level,
      jp.status,
      jp.created_at,
      jp.published_at,
      jp.expires_at,
      e.business_name,
      e.industry
    FROM job_posts jp
    INNER JOIN employers e ON e.id = jp.employer_id
    WHERE jp.id = ?
      AND jp.status = 'open'
      AND (jp.expires_at IS NULL OR jp.expires_at > CURRENT_TIMESTAMP)
      AND e.access_status = 'active'
      AND e.onboarding_completed = 1
    LIMIT 1
    `,
    [jobId]
  )

  return rows.length ? rows[0] : null
}

function createAuthToken(user) {
  return jwt.sign(
    {
      user_id: Number(user.id),
      employer_id: Number(user.employer_id),
      email: user.email,
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  )
}

function isEmployerEligible(employer) {
  if (!employer) return false
  if (employer.access_status !== 'active') return false
  if (!['active', 'canceled'].includes(employer.subscription_status || 'active')) return false
  return true
}

function formatPayDisplay(payMin, payMax, payType) {
  if (payMin !== null && payMin !== undefined && payMax !== null && payMax !== undefined) {
    return `$${Number(payMin).toLocaleString()} - $${Number(payMax).toLocaleString()}/${payType || 'hourly'}`
  }

  if (payMin !== null && payMin !== undefined) {
    return `$${Number(payMin).toLocaleString()}/${payType || 'hourly'}`
  }

  return null
}

function buildOnboardingUrl(token) {
  if (!EMPLOYER_ONBOARDING_BASE_URL) return null
  const separator = EMPLOYER_ONBOARDING_BASE_URL.includes('?') ? '&' : '?'
  return `${EMPLOYER_ONBOARDING_BASE_URL}${separator}token=${encodeURIComponent(token)}`
}

function buildEmployerPasswordResetUrl(token) {
  if (!EMPLOYER_PASSWORD_RESET_BASE_URL) return null
  const separator = EMPLOYER_PASSWORD_RESET_BASE_URL.includes('?') ? '&' : '?'
  return `${EMPLOYER_PASSWORD_RESET_BASE_URL}${separator}page=employer-reset-password&token=${encodeURIComponent(token)}`
}

function getMailFrom() {
  return (
    safeTrim(process.env.MAIL_FROM) ||
    safeTrim(process.env.SMTP_FROM) ||
    safeTrim(process.env.SMTP_USER)
  )
}

function getAdminKeyFromRequest(req) {
  const authHeader = req.headers.authorization || ''
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim()
  }

  return safeTrim(req.headers['x-admin-key'])
}

function getMailer() {
  const host = safeTrim(process.env.SMTP_HOST)
  const port = Number(process.env.SMTP_PORT || 587)
  const user = safeTrim(process.env.SMTP_USER)
  const pass = process.env.SMTP_PASS || ''

  if (!host || !user || !pass) {
    return null
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: {
      user,
      pass,
    },
  })
}

async function sendOnboardingEmail({ email, businessName, token }) {
  const transporter = getMailer()
  const onboardingUrl = buildOnboardingUrl(token)

  if (!transporter || !onboardingUrl) {
    return false
  }

  const from = getMailFrom()
  const displayName = businessName || 'your business'

  await transporter.sendMail({
    from,
    to: email,
    subject: 'Complete your employer onboarding',
    text: [
      `Hi ${displayName},`,
      '',
      'Your employer account is ready for onboarding.',
      `Complete setup here: ${onboardingUrl}`,
      '',
      'This link expires in 7 days.',
    ].join('\n'),
    html: `
      <p>Hi ${escapeHtml(displayName)},</p>
      <p>Your employer account is ready for onboarding.</p>
      <p><a href="${escapeHtml(onboardingUrl)}">Complete setup</a></p>
      <p>This link expires in 7 days.</p>
    `,
  })

  return true
}

async function sendEmployerPasswordResetEmail({ email, businessName, token }) {
  const transporter = getMailer()
  const resetUrl = buildEmployerPasswordResetUrl(token)

  if (!transporter || !resetUrl) {
    return false
  }

  const from = getMailFrom()
  const displayName = businessName || 'there'

  await transporter.sendMail({
    from,
    to: email,
    subject: 'Reset your TarboroJobs employer password',
    text: [
      `Hi ${displayName},`,
      '',
      'We received a request to reset your employer password.',
      `Reset it here: ${resetUrl}`,
      '',
      'This link expires in 1 hour.',
      'If you did not request this, you can safely ignore this email.',
    ].join('\n'),
    html: `
      <p>Hi ${escapeHtml(displayName)},</p>
      <p>We received a request to reset your employer password.</p>
      <p><a href="${escapeHtml(resetUrl)}">Reset your password</a></p>
      <p>This link expires in 1 hour.</p>
      <p>If you did not request this, you can safely ignore this email.</p>
    `,
  })

  return true
}

async function ensureEmployerPasswordResetTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS employer_password_reset_tokens (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      employer_user_id BIGINT UNSIGNED NOT NULL,
      token_hash CHAR(64) NOT NULL,
      expires_at DATETIME NOT NULL,
      used_at DATETIME NULL DEFAULT NULL,
      revoked_at DATETIME NULL DEFAULT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_employer_password_reset_token_hash (token_hash),
      KEY idx_employer_password_reset_user (employer_user_id),
      KEY idx_employer_password_reset_expires (expires_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)
}

async function jobPostsColumnExists(columnName) {
  const [rows] = await pool.query(
    `
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = COALESCE(NULLIF(?, ''), DATABASE())
      AND TABLE_NAME = 'job_posts'
      AND COLUMN_NAME = ?
    LIMIT 1
    `,
    [DB_NAME, columnName]
  )

  return rows.length > 0
}

async function ensureJobPostingComplianceColumns() {
  const columns = [
    {
      name: 'published_at',
      sql: 'ADD COLUMN published_at DATETIME NULL DEFAULT NULL AFTER status',
    },
    {
      name: 'expires_at',
      sql: 'ADD COLUMN expires_at DATETIME NULL DEFAULT NULL AFTER published_at',
    },
    {
      name: 'expired_at',
      sql: 'ADD COLUMN expired_at DATETIME NULL DEFAULT NULL AFTER expires_at',
    },
    {
      name: 'posting_guidelines_accepted',
      sql: 'ADD COLUMN posting_guidelines_accepted TINYINT(1) NOT NULL DEFAULT 0 AFTER expired_at',
    },
    {
      name: 'posting_guidelines_accepted_at',
      sql: 'ADD COLUMN posting_guidelines_accepted_at DATETIME NULL DEFAULT NULL AFTER posting_guidelines_accepted',
    },
  ]

  for (const column of columns) {
    const exists = await jobPostsColumnExists(column.name)
    if (!exists) {
      await pool.query(`ALTER TABLE job_posts ${column.sql}`)
    }
  }
}


async function jobSeekersColumnExists(columnName) {
  const [rows] = await pool.query(
    `
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = COALESCE(NULLIF(?, ''), DATABASE())
      AND TABLE_NAME = 'job_seekers'
      AND COLUMN_NAME = ?
    LIMIT 1
    `,
    [DB_NAME, columnName]
  )

  return rows.length > 0
}

async function ensureJobSeekerApplicationColumns() {
  const columns = [
    {
      name: 'employer_id',
      sql: 'ADD COLUMN employer_id BIGINT UNSIGNED NULL DEFAULT NULL AFTER resume_file_url',
    },
    {
      name: 'job_post_id',
      sql: 'ADD COLUMN job_post_id BIGINT UNSIGNED NULL DEFAULT NULL AFTER employer_id',
    },
    {
      name: 'ats_score',
      sql: 'ADD COLUMN ats_score DECIMAL(5,2) NULL DEFAULT NULL AFTER job_post_id',
    },
    {
      name: 'ats_recommendation',
      sql: 'ADD COLUMN ats_recommendation VARCHAR(50) NULL DEFAULT NULL AFTER ats_score',
    },
    {
      name: 'ats_summary',
      sql: 'ADD COLUMN ats_summary TEXT NULL AFTER ats_recommendation',
    },
    {
      name: 'ats_keywords_matched',
      sql: 'ADD COLUMN ats_keywords_matched TEXT NULL AFTER ats_summary',
    },
    {
      name: 'ats_keywords_missing',
      sql: 'ADD COLUMN ats_keywords_missing TEXT NULL AFTER ats_keywords_matched',
    },
    {
      name: 'ats_title_match',
      sql: 'ADD COLUMN ats_title_match TINYINT(1) NOT NULL DEFAULT 0 AFTER ats_keywords_missing',
    },
  ]

  for (const column of columns) {
    const exists = await jobSeekersColumnExists(column.name)
    if (!exists) {
      await pool.query(`ALTER TABLE job_seekers ${column.sql}`)
    }
  }
}

async function expireOpenJobs() {
  await pool.query(
    `
    UPDATE job_posts
    SET
      status = 'expired',
      expired_at = COALESCE(expired_at, CURRENT_TIMESTAMP),
      updated_at = CURRENT_TIMESTAMP
    WHERE status = 'open'
      AND expires_at IS NOT NULL
      AND expires_at <= CURRENT_TIMESTAMP
    `
  )
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function requireAdminAuth(req, res, next) {
  if (!ADMIN_API_KEY) {
    return res.status(503).json({
      success: false,
      error: 'Admin API key is not configured on the server.',
    })
  }

  const providedKey = getAdminKeyFromRequest(req)

  if (!providedKey || providedKey !== ADMIN_API_KEY) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized admin request.',
    })
  }

  next()
}

async function loadEmployerSessionByUserId(userId) {
  const [rows] = await pool.query(
    `
    SELECT
      eu.id,
      eu.employer_id,
      eu.email,
      eu.password_hash,
      eu.is_active,
      e.business_name,
      e.industry,
      e.contact_name,
      e.email AS employer_email,
      e.phone,
      e.website,
      e.address,
      e.city,
      e.notes,
      e.status,
      e.subscription_status,
      e.access_status,
      e.current_period_end,
      e.onboarding_completed
    FROM employer_users eu
    INNER JOIN employers e ON e.id = eu.employer_id
    WHERE eu.id = ?
    LIMIT 1
    `,
    [userId]
  )

  return rows.length ? rows[0] : null
}

async function getEmployerAccess(employerId) {
  const [rows] = await pool.query(
    `
    SELECT id, access_status, subscription_status, onboarding_completed
    FROM employers
    WHERE id = ?
    LIMIT 1
    `,
    [employerId]
  )

  return rows.length ? rows[0] : null
}

async function requireEmployerAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : ''

    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Missing authorization token.',
      })
    }

    const decoded = jwt.verify(token, JWT_SECRET)
    const session = await loadEmployerSessionByUserId(decoded.user_id)

    if (!session) {
      return res.status(401).json({
        success: false,
        error: 'Employer session not found.',
      })
    }

    if (Number(session.employer_id) !== Number(decoded.employer_id)) {
      return res.status(401).json({
        success: false,
        error: 'Employer session mismatch.',
      })
    }

    if (!session.is_active) {
      return res.status(403).json({
        success: false,
        error: 'This employer login is inactive.',
      })
    }

    req.auth = {
      token,
      user_id: Number(session.id),
      employer_id: Number(session.employer_id),
      email: session.email,
      employer_user: {
        id: Number(session.id),
        employer_id: Number(session.employer_id),
        email: session.email,
        is_active: !!session.is_active,
      },
      employer: {
        business_name: session.business_name,
        industry: session.industry,
        contact_name: session.contact_name,
        email: session.employer_email || session.email,
        phone: session.phone,
        website: session.website,
        address: session.address,
        city: session.city,
        notes: session.notes,
        status: session.status,
        subscription_status: session.subscription_status,
        access_status: session.access_status,
        current_period_end: session.current_period_end,
        onboarding_completed: !!session.onboarding_completed,
      },
    }

    next()
  } catch (error) {
    return res.status(401).json({
      success: false,
      error: 'Invalid or expired authorization token.',
    })
  }
}

function requireEligibleEmployer(req, res, next) {
  if (!req.auth?.employer) {
    return res.status(401).json({
      success: false,
      error: 'Employer session not loaded.',
    })
  }

  if (!req.auth.employer.onboarding_completed) {
    return res.status(403).json({
      success: false,
      error: 'Employer onboarding has not been completed.',
    })
  }

  if (!isEmployerEligible(req.auth.employer)) {
    return res.status(403).json({
      success: false,
      error: 'Your employer account is not eligible for this action.',
    })
  }

  next()
}

function normalizeCandidateStatus(status) {
  if (status === undefined || status === null || status === '') return null
  return String(status).trim().toLowerCase()
}

function normalizeDateTime(value) {
  return parseDateOrNull(value)
}

function formatCandidateActionRow(row) {
  return {
    id: row.id,
    employer_id: row.employer_id,
    job_seeker_id: row.job_seeker_id,
    status: row.status,
    notes: row.notes || '',
    contacted_at: row.contacted_at,
    interview_at: row.interview_at,
    hired_at: row.hired_at,
    rejected_at: row.rejected_at,
    next_follow_up_at: row.next_follow_up_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

async function fetchCandidateActionById(id) {
  const [rows] = await pool.query(
    `
    SELECT
      id,
      employer_id,
      job_seeker_id,
      status,
      notes,
      contacted_at,
      interview_at,
      hired_at,
      rejected_at,
      next_follow_up_at,
      created_at,
      updated_at
    FROM employer_candidate_actions
    WHERE id = ?
    LIMIT 1
    `,
    [id]
  )

  return rows.length ? formatCandidateActionRow(rows[0]) : null
}

async function findJobOwnedByEmployer(jobId, employerId) {
  const [rows] = await pool.query(
    `
    SELECT
      id,
      employer_id,
      status,
      created_at,
      published_at,
      expires_at,
      expired_at,
      posting_guidelines_accepted,
      posting_guidelines_accepted_at
    FROM job_posts
    WHERE id = ?
    LIMIT 1
    `,
    [jobId]
  )

  if (!rows.length) return null
  if (Number(rows[0].employer_id) !== Number(employerId)) return false
  return rows[0]
}

async function revokePendingTokensForEmployer(db, employerId) {
  await db.query(
    `
    UPDATE employer_onboarding_tokens
    SET status = 'revoked'
    WHERE employer_id = ?
      AND status = 'pending'
    `,
    [employerId]
  )
}

app.get('/api/health', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT 1 AS ok')
    res.json({
      success: true,
      db: rows[0],
      timestamp: new Date(),
    })
  } catch (error) {
    console.error('GET /api/health error:', error)
    res.status(500).json({
      success: false,
      error: error?.message || 'Health check failed.',
    })
  }
})

app.post('/api/jobseekers', upload.single('resume_file'), async (req, res) => {
  try {
    const fullName = safeTrim(req.body.full_name, 255)
    const email = normalizeEmail(req.body.email)
    const phone = toNullableString(req.body.phone, 50)
    const city = toNullableString(req.body.city, 255)
    const desiredJobTitle = toNullableString(req.body.desired_job_title, 255)
    const employmentType = toNullableString(req.body.employment_type, 50) || 'any'
    const skills = toNullableString(req.body.skills, 5000)
    const resumeText = toNullableString(req.body.resume_text, 50000)

    if (!fullName || !email) {
      return res.status(400).json({
        success: false,
        error: 'Full name and email are required.',
      })
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({
        success: false,
        error: 'A valid email address is required.',
      })
    }

    const resumeFileUrl = req.file ? `/uploads/resumes/${req.file.filename}` : null

    const [result] = await pool.query(
      `
      INSERT INTO job_seekers
      (
        full_name,
        email,
        phone,
        city,
        desired_job_title,
        employment_type,
        skills,
        resume_text,
        resume_file_url
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        fullName,
        email,
        phone,
        city,
        desiredJobTitle,
        employmentType,
        skills,
        resumeText,
        resumeFileUrl,
      ]
    )

    res.json({
      success: true,
      id: result.insertId,
      resume_file_url: resumeFileUrl,
      message: 'Resume submitted successfully.',
    })
  } catch (error) {
    console.error('POST /api/jobseekers error:', error)
    res.status(500).json({
      success: false,
      error: error?.message || 'Failed to submit resume.',
<<<<<<< HEAD
=======
    })
  }
})


app.get('/api/jobposts/:id', async (req, res) => {
  try {
    await expireOpenJobs()
    const jobId = Number(req.params.id)

    if (!jobId) {
      return res.status(400).json({
        success: false,
        error: 'A valid job ID is required.',
      })
    }

    const row = await findPublicJobPostById(jobId)

    if (!row) {
      return res.status(404).json({
        success: false,
        error: 'Job not found or no longer accepting applications.',
      })
    }

    res.json({
      success: true,
      job: {
        id: row.id,
        employer_id: row.employer_id,
        title: row.job_title,
        company: row.business_name,
        city: row.city,
        pay: formatPayDisplay(row.pay_min, row.pay_max, row.pay_type),
        pay_min: row.pay_min,
        pay_max: row.pay_max,
        pay_type: row.pay_type,
        type: row.employment_type,
        industry: row.industry,
        experience_level: row.experience_level,
        description: row.job_description,
        status: row.status,
        posted: row.published_at || row.created_at,
        expires_at: row.expires_at,
      },
    })
  } catch (error) {
    console.error('GET /api/jobposts/:id error:', error)
    res.status(500).json({
      success: false,
      error: error?.message || 'Failed to fetch job posting.',
    })
  }
})

app.post('/api/jobposts/:id/apply', upload.single('resume_file'), async (req, res) => {
  try {
    await expireOpenJobs()
    const jobId = Number(req.params.id)

    if (!jobId) {
      return res.status(400).json({
        success: false,
        error: 'A valid job ID is required.',
      })
    }

    const job = await findPublicJobPostById(jobId)

    if (!job) {
      return res.status(404).json({
        success: false,
        error: 'This job is no longer accepting applications.',
      })
    }

    const fullName = safeTrim(req.body.full_name, 255)
    const email = normalizeEmail(req.body.email)
    const phone = toNullableString(req.body.phone, 50)
    const city = toNullableString(req.body.city, 255)
    const desiredJobTitle = toNullableString(req.body.desired_job_title, 255) || job.job_title
    const employmentType = toNullableString(req.body.employment_type, 50) || job.employment_type || 'any'
    const skills = toNullableString(req.body.skills, 5000)
    const applicantNote = toNullableString(req.body.resume_text, 10000)

    if (!fullName || !email) {
      return res.status(400).json({
        success: false,
        error: 'Full name and email are required.',
      })
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({
        success: false,
        error: 'A valid email address is required.',
      })
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'A PDF resume is required to apply for this job.',
      })
    }

    const pdfResumeText = await extractPdfTextFromFile(req.file.path)
    const combinedResumeText = safeTrim(
      [applicantNote, pdfResumeText].filter(Boolean).join('\n\n'),
      50000
    )
    const ats = buildAtsAssessment(job, {
      desired_job_title: desiredJobTitle,
      employment_type: employmentType,
      skills,
      resume_text: applicantNote,
      resume_pdf_text: pdfResumeText,
    })
    const resumeFileUrl = `/uploads/resumes/${req.file.filename}`

    const [result] = await pool.query(
      `
      INSERT INTO job_seekers
      (
        full_name,
        email,
        phone,
        city,
        desired_job_title,
        employment_type,
        skills,
        resume_text,
        resume_file_url,
        employer_id,
        job_post_id,
        ats_score,
        ats_recommendation,
        ats_summary,
        ats_keywords_matched,
        ats_keywords_missing,
        ats_title_match
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        fullName,
        email,
        phone,
        city,
        desiredJobTitle,
        employmentType,
        skills,
        combinedResumeText,
        resumeFileUrl,
        job.employer_id,
        job.id,
        ats.score,
        ats.recommendation,
        ats.summary,
        ats.matched_keywords.join(', '),
        ats.missing_keywords.join(', '),
        ats.title_match ? 1 : 0,
      ]
    )

    res.json({
      success: true,
      id: result.insertId,
      resume_file_url: resumeFileUrl,
      ats: {
        score: ats.score,
        recommendation: ats.recommendation,
      },
      message: 'Application submitted successfully.',
    })
  } catch (error) {
    console.error('POST /api/jobposts/:id/apply error:', error)
    res.status(500).json({
      success: false,
      error: error?.message || 'Failed to submit application.',
>>>>>>> a7ef58f (Add job detail pages, apply flow, employer scoping, and ATS scoring)
    })
  }
})

app.post('/api/employer-onboarding-token', requireAdminAuth, async (req, res) => {
  const connection = await pool.getConnection()

  try {
    await connection.beginTransaction()

    const email = normalizeEmail(req.body.email)
    const businessName = toNullableString(req.body.business_name, 255)
    const squareCustomerId = toNullableString(req.body.square_customer_id, 255)
    const squareSubscriptionId = toNullableString(req.body.square_subscription_id, 255)
    const currentPeriodEnd = parseDateOrNull(req.body.current_period_end)
    const shouldSendEmail = req.body.send_email === undefined ? true : parseBoolean(req.body.send_email)

    if (!email) {
      await connection.rollback()
      return res.status(400).json({
        success: false,
        error: 'Email is required to create onboarding token.',
      })
    }

    if (!isValidEmail(email)) {
      await connection.rollback()
      return res.status(400).json({
        success: false,
        error: 'A valid email address is required.',
      })
    }

    let employerId = null

    const [existingEmployers] = await connection.query(
      `
      SELECT id
      FROM employers
      WHERE email = ?
      ORDER BY id DESC
      LIMIT 1
      `,
      [email]
    )

    if (existingEmployers.length > 0) {
      employerId = existingEmployers[0].id

      await connection.query(
        `
        UPDATE employers
        SET
          business_name = COALESCE(?, business_name),
          square_customer_id = COALESCE(?, square_customer_id),
          square_subscription_id = COALESCE(?, square_subscription_id),
          subscription_status = 'active',
          access_status = 'pending',
          current_period_end = COALESCE(?, current_period_end),
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        `,
        [businessName, squareCustomerId, squareSubscriptionId, currentPeriodEnd, employerId]
      )
    } else {
      const [insertEmployer] = await connection.query(
        `
        INSERT INTO employers
        (
          business_name,
          email,
          square_customer_id,
          square_subscription_id,
          subscription_status,
          access_status,
          current_period_end,
          onboarding_completed,
          status
        )
        VALUES (?, ?, ?, ?, 'active', 'pending', ?, 0, 'new')
        `,
        [businessName, email, squareCustomerId, squareSubscriptionId, currentPeriodEnd]
      )

      employerId = insertEmployer.insertId
    }

    await revokePendingTokensForEmployer(connection, employerId)

    const token = generateToken()
    const expiresAt = addDays(7)

    const [insertToken] = await connection.query(
      `
      INSERT INTO employer_onboarding_tokens
      (
        employer_id,
        token,
        email,
        square_customer_id,
        square_subscription_id,
        status,
        expires_at
      )
      VALUES (?, ?, ?, ?, ?, 'pending', ?)
      `,
      [employerId, token, email, squareCustomerId, squareSubscriptionId, expiresAt]
    )

    await connection.commit()

    let emailSent = false
    if (shouldSendEmail) {
      try {
        emailSent = await sendOnboardingEmail({
          email,
          businessName,
          token,
        })
      } catch (mailError) {
        console.error('Employer onboarding email error:', mailError)
      }
    }

    res.json({
      success: true,
      token,
      token_id: insertToken.insertId,
      employer_id: employerId,
      expires_at: expiresAt,
      onboarding_url: buildOnboardingUrl(token),
      email_sent: emailSent,
      message: 'Onboarding token created successfully.',
    })
  } catch (error) {
    await connection.rollback()
    console.error('POST /api/employer-onboarding-token error:', error)
    res.status(500).json({
      success: false,
      error: error?.message || 'Failed to create onboarding token.',
    })
  } finally {
    connection.release()
  }
})

app.get('/api/employer-onboarding/validate', async (req, res) => {
  try {
    const token = safeTrim(req.query.token, 128)

    if (!token) {
      return res.status(400).json({
        success: false,
        error: 'Token is required.',
      })
    }

    const [rows] = await pool.query(
      `
      SELECT
        t.id,
        t.token,
        t.email,
        t.status,
        t.expires_at,
        t.used_at,
        t.employer_id,
        e.business_name,
        e.email AS employer_email,
        e.subscription_status,
        e.access_status,
        e.onboarding_completed
      FROM employer_onboarding_tokens t
      LEFT JOIN employers e ON e.id = t.employer_id
      WHERE t.token = ?
      LIMIT 1
      `,
      [token]
    )

    if (!rows.length) {
      return res.status(404).json({
        success: false,
        error: 'Invalid onboarding token.',
      })
    }

    const row = rows[0]
    const now = new Date()
    const expiresAt = row.expires_at ? new Date(row.expires_at) : null

    if (row.status !== 'pending') {
      return res.status(403).json({
        success: false,
        error: `This onboarding token is ${row.status}.`,
      })
    }

    if (expiresAt && expiresAt < now) {
      await pool.query(
        `
        UPDATE employer_onboarding_tokens
        SET status = 'expired'
        WHERE id = ?
        `,
        [row.id]
      )

      return res.status(403).json({
        success: false,
        error: 'This onboarding token has expired.',
      })
    }

    if (row.subscription_status && !['active', 'canceled'].includes(row.subscription_status)) {
      return res.status(403).json({
        success: false,
        error: 'This subscription is not currently eligible for onboarding.',
      })
    }

    res.json({
      success: true,
      employer: {
        id: row.employer_id,
        business_name: row.business_name,
        email: row.employer_email || row.email,
        subscription_status: row.subscription_status,
        access_status: row.access_status,
        onboarding_completed: !!row.onboarding_completed,
      },
      token: {
        token: row.token,
        expires_at: row.expires_at,
      },
    })
  } catch (error) {
    console.error('GET /api/employer-onboarding/validate error:', error)
    res.status(500).json({
      success: false,
      error: error?.message || 'Failed to validate onboarding token.',
    })
  }
})

app.post('/api/employer-onboarding/complete', async (req, res) => {
  const connection = await pool.getConnection()

  try {
    await connection.beginTransaction()

    const token = safeTrim(req.body.token, 128)
    const businessName = safeTrim(req.body.business_name, 255)
    const industry = toNullableString(req.body.industry, 255)
    const contactName = safeTrim(req.body.contact_name, 255)
    const email = normalizeEmail(req.body.email)
    const phone = toNullableString(req.body.phone, 50)
    const website = toNullableString(req.body.website, 255)
    const address = toNullableString(req.body.address, 255)
    const city = toNullableString(req.body.city, 255)
    const notes = toNullableString(req.body.notes, 5000)
    const isHiring = parseBoolean(req.body.is_hiring)
    const password = String(req.body.password || '')

    if (!token) {
      await connection.rollback()
      return res.status(400).json({
        success: false,
        error: 'Onboarding token is required.',
      })
    }

    if (!businessName || !contactName || !email) {
      await connection.rollback()
      return res.status(400).json({
        success: false,
        error: 'Business name, contact name, and email are required.',
      })
    }

    if (!isValidEmail(email)) {
      await connection.rollback()
      return res.status(400).json({
        success: false,
        error: 'A valid email address is required.',
      })
    }

    if (password.length < 8) {
      await connection.rollback()
      return res.status(400).json({
        success: false,
        error: 'Password is required and must be at least 8 characters.',
      })
    }

    const [tokenRows] = await connection.query(
      `
      SELECT
        t.id,
        t.status,
        t.expires_at,
        t.employer_id
      FROM employer_onboarding_tokens t
      WHERE t.token = ?
      LIMIT 1
      `,
      [token]
    )

    if (!tokenRows.length) {
      await connection.rollback()
      return res.status(404).json({
        success: false,
        error: 'Invalid onboarding token.',
      })
    }

    const tokenRow = tokenRows[0]
    const now = new Date()
    const expiresAt = tokenRow.expires_at ? new Date(tokenRow.expires_at) : null

    if (tokenRow.status !== 'pending') {
      await connection.rollback()
      return res.status(403).json({
        success: false,
        error: `This onboarding token is ${tokenRow.status}.`,
      })
    }

    if (expiresAt && expiresAt < now) {
      await connection.query(
        `
        UPDATE employer_onboarding_tokens
        SET status = 'expired'
        WHERE id = ?
        `,
        [tokenRow.id]
      )

      await connection.commit()

      return res.status(403).json({
        success: false,
        error: 'This onboarding token has expired.',
      })
    }

    const employerId = Number(tokenRow.employer_id)

    if (!employerId) {
      await connection.rollback()
      return res.status(400).json({
        success: false,
        error: 'This token is not linked to an employer record.',
      })
    }

    const [emailConflicts] = await connection.query(
      `
      SELECT id, employer_id
      FROM employer_users
      WHERE email = ?
      LIMIT 1
      `,
      [email]
    )

    if (emailConflicts.length > 0 && Number(emailConflicts[0].employer_id) !== employerId) {
      await connection.rollback()
      return res.status(409).json({
        success: false,
        error: 'That email address is already being used by another employer login.',
      })
    }

    await connection.query(
      `
      UPDATE employers
      SET
        business_name = ?,
        industry = ?,
        contact_name = ?,
        email = ?,
        phone = ?,
        website = ?,
        address = ?,
        city = ?,
        notes = ?,
        onboarding_completed = 1,
        subscription_status = 'active',
        access_status = 'active',
        status = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
      `,
      [
        businessName,
        industry,
        contactName,
        email,
        phone,
        website,
        address,
        city,
        notes,
        isHiring ? 'active' : 'new',
        employerId,
      ]
    )

    const passwordHash = await bcrypt.hash(password, 10)

    const [existingUsers] = await connection.query(
      `
      SELECT id
      FROM employer_users
      WHERE employer_id = ?
      LIMIT 1
      `,
      [employerId]
    )

    let employerUserId = null

    if (existingUsers.length > 0) {
      employerUserId = existingUsers[0].id

      await connection.query(
        `
        UPDATE employer_users
        SET
          email = ?,
          password_hash = ?,
          is_active = 1,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        `,
        [email, passwordHash, employerUserId]
      )
    } else {
      const [insertUser] = await connection.query(
        `
        INSERT INTO employer_users
        (
          employer_id,
          email,
          password_hash,
          is_active
        )
        VALUES (?, ?, ?, 1)
        `,
        [employerId, email, passwordHash]
      )

      employerUserId = insertUser.insertId
    }

    await connection.query(
      `
      UPDATE employer_onboarding_tokens
      SET
        status = CASE WHEN id = ? THEN 'used' ELSE 'revoked' END,
        used_at = CASE WHEN id = ? THEN NOW() ELSE used_at END
      WHERE employer_id = ?
        AND status = 'pending'
      `,
      [tokenRow.id, tokenRow.id, employerId]
    )

    await connection.commit()

    const authToken = createAuthToken({
      id: employerUserId,
      employer_id: employerId,
      email,
    })

    res.json({
      success: true,
      employer_id: employerId,
      employer_user_id: employerUserId,
      auth_token: authToken,
      message: 'Employer onboarding completed successfully.',
    })
  } catch (error) {
    await connection.rollback()
    console.error('POST /api/employer-onboarding/complete error:', error)
    res.status(500).json({
      success: false,
      error: error?.message || 'Failed to complete employer onboarding.',
    })
  } finally {
    connection.release()
  }
})

app.post('/api/employer-auth/login', async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email)
    const password = String(req.body.password || '')

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Email and password are required.',
      })
    }

    const [rows] = await pool.query(
      `
      SELECT
        eu.id,
        eu.employer_id,
        eu.email,
        eu.password_hash,
        eu.is_active,
        e.business_name,
        e.subscription_status,
        e.access_status,
        e.onboarding_completed
      FROM employer_users eu
      INNER JOIN employers e ON e.id = eu.employer_id
      WHERE LOWER(eu.email) = ?
      LIMIT 1
      `,
      [email]
    )

    if (!rows.length) {
      return res.status(401).json({
        success: false,
        error: 'Invalid email or password.',
      })
    }

    const user = rows[0]

    if (!user.is_active) {
      return res.status(403).json({
        success: false,
        error: 'This employer login is inactive.',
      })
    }

    if (!user.onboarding_completed) {
      return res.status(403).json({
        success: false,
        error: 'Employer onboarding is not complete yet.',
      })
    }

    if (!isEmployerEligible(user)) {
      return res.status(403).json({
        success: false,
        error: 'This employer account is not eligible for login.',
      })
    }

    const passwordMatches = await bcrypt.compare(password, user.password_hash || '')

    if (!passwordMatches) {
      return res.status(401).json({
        success: false,
        error: 'Invalid email or password.',
      })
    }

    const authToken = createAuthToken(user)

    res.json({
      success: true,
      auth_token: authToken,
      employer: {
        employer_id: user.employer_id,
        business_name: user.business_name,
        email: user.email,
        subscription_status: user.subscription_status,
        access_status: user.access_status,
        onboarding_completed: !!user.onboarding_completed,
      },
      message: 'Login successful.',
    })
  } catch (error) {
    console.error('POST /api/employer-auth/login error:', error)
    res.status(500).json({
      success: false,
      error: error?.message || 'Internal server error.',
    })
  }
})

app.post('/api/employer-auth/forgot-password', async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email)
    const genericMessage = 'If that email exists, a password reset link has been sent.'

    if (!email || !isValidEmail(email)) {
      return res.json({
        success: true,
        message: genericMessage,
      })
    }

    const [rows] = await pool.query(
      `
      SELECT
        eu.id,
        eu.email,
        eu.is_active,
        e.business_name,
        e.onboarding_completed,
        e.subscription_status,
        e.access_status
      FROM employer_users eu
      INNER JOIN employers e ON e.id = eu.employer_id
      WHERE LOWER(eu.email) = ?
      LIMIT 1
      `,
      [email]
    )

    if (!rows.length) {
      return res.json({
        success: true,
        message: genericMessage,
      })
    }

    const user = rows[0]

    if (!user.is_active || !user.onboarding_completed || !isEmployerEligible(user)) {
      return res.json({
        success: true,
        message: genericMessage,
      })
    }

    await pool.query(
      `
      UPDATE employer_password_reset_tokens
      SET revoked_at = NOW()
      WHERE employer_user_id = ?
        AND used_at IS NULL
        AND revoked_at IS NULL
      `,
      [user.id]
    )

    const rawToken = generateToken()
    const tokenHash = sha256(rawToken)

    await pool.query(
      `
      INSERT INTO employer_password_reset_tokens
      (
        employer_user_id,
        token_hash,
        expires_at
      )
      VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 1 HOUR))
      `,
      [user.id, tokenHash]
    )

    const emailSent = await sendEmployerPasswordResetEmail({
      email: user.email,
      businessName: user.business_name,
      token: rawToken,
    })

    if (!emailSent) {
      return res.status(503).json({
        success: false,
        error: 'Password reset email is not configured on the server yet.',
      })
    }

    res.json({
      success: true,
      message: genericMessage,
    })
  } catch (error) {
    console.error('POST /api/employer-auth/forgot-password error:', error)
    res.status(500).json({
      success: false,
      error: error?.message || 'Failed to send password reset email.',
    })
  }
})

app.get('/api/employer-auth/reset-password/validate', async (req, res) => {
  try {
    const token = safeTrim(req.query.token, 255)

    if (!token) {
      return res.status(400).json({
        success: false,
        error: 'Reset token is required.',
      })
    }

    const tokenHash = sha256(token)

    const [rows] = await pool.query(
      `
      SELECT
        prt.id,
        prt.expires_at,
        prt.used_at,
        prt.revoked_at,
        eu.id AS employer_user_id,
        eu.email,
        eu.is_active,
        e.business_name,
        e.onboarding_completed,
        e.subscription_status,
        e.access_status
      FROM employer_password_reset_tokens prt
      INNER JOIN employer_users eu ON eu.id = prt.employer_user_id
      INNER JOIN employers e ON e.id = eu.employer_id
      WHERE prt.token_hash = ?
      LIMIT 1
      `,
      [tokenHash]
    )

    if (!rows.length) {
      return res.status(404).json({
        success: false,
        error: 'This password reset link is invalid or expired.',
      })
    }

    const row = rows[0]
    const expiresAt = row.expires_at ? new Date(row.expires_at) : null
    const now = new Date()

    if (row.used_at || row.revoked_at || (expiresAt && expiresAt < now)) {
      return res.status(403).json({
        success: false,
        error: 'This password reset link is invalid or expired.',
      })
    }

    if (!row.is_active || !row.onboarding_completed || !isEmployerEligible(row)) {
      return res.status(403).json({
        success: false,
        error: 'This employer account is not eligible for password reset.',
      })
    }

    res.json({
      success: true,
      email: row.email,
      business_name: row.business_name,
      expires_at: row.expires_at,
    })
  } catch (error) {
    console.error('GET /api/employer-auth/reset-password/validate error:', error)
    res.status(500).json({
      success: false,
      error: error?.message || 'Failed to validate password reset token.',
    })
  }
})

app.post('/api/employer-auth/reset-password', async (req, res) => {
  const connection = await pool.getConnection()

  try {
    await connection.beginTransaction()

    const token = safeTrim(req.body.token, 255)
    const password = String(req.body.password || '')

    if (!token || !password) {
      await connection.rollback()
      return res.status(400).json({
        success: false,
        error: 'Reset token and new password are required.',
      })
    }

    if (password.length < 8) {
      await connection.rollback()
      return res.status(400).json({
        success: false,
        error: 'Password must be at least 8 characters.',
      })
    }

    const tokenHash = sha256(token)

    const [rows] = await connection.query(
      `
      SELECT
        prt.id,
        prt.employer_user_id,
        prt.expires_at,
        prt.used_at,
        prt.revoked_at,
        eu.email,
        eu.is_active,
        e.business_name,
        e.onboarding_completed,
        e.subscription_status,
        e.access_status
      FROM employer_password_reset_tokens prt
      INNER JOIN employer_users eu ON eu.id = prt.employer_user_id
      INNER JOIN employers e ON e.id = eu.employer_id
      WHERE prt.token_hash = ?
      LIMIT 1
      FOR UPDATE
      `,
      [tokenHash]
    )

    if (!rows.length) {
      await connection.rollback()
      return res.status(404).json({
        success: false,
        error: 'This password reset link is invalid or expired.',
      })
    }

    const row = rows[0]
    const expiresAt = row.expires_at ? new Date(row.expires_at) : null
    const now = new Date()

    if (row.used_at || row.revoked_at || (expiresAt && expiresAt < now)) {
      await connection.rollback()
      return res.status(403).json({
        success: false,
        error: 'This password reset link is invalid or expired.',
      })
    }

    if (!row.is_active || !row.onboarding_completed || !isEmployerEligible(row)) {
      await connection.rollback()
      return res.status(403).json({
        success: false,
        error: 'This employer account is not eligible for password reset.',
      })
    }

    const passwordHash = await bcrypt.hash(password, 10)

    await connection.query(
      `
      UPDATE employer_users
      SET
        password_hash = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
      `,
      [passwordHash, row.employer_user_id]
    )

    await connection.query(
      `
      UPDATE employer_password_reset_tokens
      SET used_at = NOW(), revoked_at = NULL
      WHERE id = ?
      `,
      [row.id]
    )

    await connection.query(
      `
      UPDATE employer_password_reset_tokens
      SET revoked_at = NOW()
      WHERE employer_user_id = ?
        AND id <> ?
        AND used_at IS NULL
        AND revoked_at IS NULL
      `,
      [row.employer_user_id, row.id]
    )

    await connection.commit()

    res.json({
      success: true,
      message: 'Your password has been reset successfully. You can log in now.',
    })
  } catch (error) {
    await connection.rollback()
    console.error('POST /api/employer-auth/reset-password error:', error)
    res.status(500).json({
      success: false,
      error: error?.message || 'Failed to reset password.',
    })
  } finally {
    connection.release()
  }
})

app.get('/api/employer-auth/me', requireEmployerAuth, async (req, res) => {
  res.json({
    success: true,
    employer_user: req.auth.employer_user,
    employer: req.auth.employer,
  })
})

app.patch('/api/employer/account', requireEmployerAuth, async (req, res) => {
  try {
    const employerId = req.auth.employer_id
    const employerUserId = req.auth.user_id
    const businessName = safeTrim(req.body.business_name, 255)
    const industry = toNullableString(req.body.industry, 255)
    const contactName = toNullableString(req.body.contact_name, 255)
    const email = normalizeEmail(req.body.email)
    const phone = toNullableString(req.body.phone, 100)
    const website = toNullableString(req.body.website, 255)
    const address = toNullableString(req.body.address, 255)
    const city = toNullableString(req.body.city, 255)
    const notes = toNullableString(req.body.notes, 5000)
    const isHiring = parseBoolean(req.body.is_hiring)

    if (!businessName) {
      return res.status(400).json({
        success: false,
        error: 'Business name is required.',
      })
    }

    if (!email || !isValidEmail(email)) {
      return res.status(400).json({
        success: false,
        error: 'A valid email address is required.',
      })
    }

    const [emailConflicts] = await pool.query(
      `
      SELECT id
      FROM employer_users
      WHERE email = ? AND id <> ?
      LIMIT 1
      `,
      [email, employerUserId]
    )

    if (emailConflicts.length > 0) {
      return res.status(409).json({
        success: false,
        error: 'That email address is already being used by another employer login.',
      })
    }

    await pool.query(
      `
      UPDATE employers
      SET
        business_name = ?,
        industry = ?,
        contact_name = ?,
        email = ?,
        phone = ?,
        website = ?,
        address = ?,
        city = ?,
        notes = ?,
        status = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
      `,
      [
        businessName,
        industry,
        contactName,
        email,
        phone,
        website,
        address,
        city,
        notes,
        isHiring ? 'active' : 'new',
        employerId,
      ]
    )

    await pool.query(
      `
      UPDATE employer_users
      SET
        email = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
      `,
      [email, employerUserId]
    )

    const refreshedSession = await loadEmployerSessionByUserId(employerUserId)

    res.json({
      success: true,
      message: 'Employer account updated successfully.',
      employer_user: {
        id: Number(refreshedSession.id),
        employer_id: Number(refreshedSession.employer_id),
        email: refreshedSession.email,
        is_active: !!refreshedSession.is_active,
      },
      employer: {
        business_name: refreshedSession.business_name,
        industry: refreshedSession.industry,
        contact_name: refreshedSession.contact_name,
        email: refreshedSession.employer_email || refreshedSession.email,
        phone: refreshedSession.phone,
        website: refreshedSession.website,
        address: refreshedSession.address,
        city: refreshedSession.city,
        notes: refreshedSession.notes,
        status: refreshedSession.status,
        subscription_status: refreshedSession.subscription_status,
        access_status: refreshedSession.access_status,
        current_period_end: refreshedSession.current_period_end,
        onboarding_completed: !!refreshedSession.onboarding_completed,
      },
    })
  } catch (error) {
    console.error('PATCH /api/employer/account error:', error)
    res.status(500).json({
      success: false,
      error: error?.message || 'Failed to update employer account.',
    })
  }
})

app.patch('/api/employer/account/password', requireEmployerAuth, async (req, res) => {
  try {
    const employerUserId = req.auth.user_id
    const currentPassword = String(req.body.current_password || '')
    const newPassword = String(req.body.new_password || '')
    const confirmPassword = String(req.body.confirm_password || '')

    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({
        success: false,
        error: 'Current password, new password, and confirmation are required.',
      })
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({
        success: false,
        error: 'New password and confirm password do not match.',
      })
    }

    if (newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        error: 'New password must be at least 8 characters long.',
      })
    }

    const [rows] = await pool.query(
      `
      SELECT password_hash
      FROM employer_users
      WHERE id = ?
      LIMIT 1
      `,
      [employerUserId]
    )

    if (!rows.length) {
      return res.status(404).json({
        success: false,
        error: 'Employer login not found.',
      })
    }

    const matches = await bcrypt.compare(currentPassword, rows[0].password_hash)

    if (!matches) {
      return res.status(400).json({
        success: false,
        error: 'Current password is incorrect.',
      })
    }

    const passwordHash = await bcrypt.hash(newPassword, 10)

    await pool.query(
      `
      UPDATE employer_users
      SET
        password_hash = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
      `,
      [passwordHash, employerUserId]
    )

    res.json({
      success: true,
      message: 'Password updated successfully.',
    })
  } catch (error) {
    console.error('PATCH /api/employer/account/password error:', error)
    res.status(500).json({
      success: false,
      error: error?.message || 'Failed to update employer password.',
    })
  }
})

app.get('/api/employer/jobs', requireEmployerAuth, requireEligibleEmployer, async (req, res) => {
  try {
    await expireOpenJobs()
    const employerId = req.auth.employer_id

    const [rows] = await pool.query(
      `
      SELECT
        id,
        job_title,
        job_description,
        city,
        pay_min,
        pay_max,
        pay_type,
        employment_type,
        experience_level,
        status,
        created_at,
        published_at,
        expires_at,
        expired_at,
        posting_guidelines_accepted,
        posting_guidelines_accepted_at,
        updated_at
      FROM job_posts
      WHERE employer_id = ?
      ORDER BY COALESCE(published_at, created_at) DESC
      `,
      [employerId]
    )

    const jobs = rows.map((row) => ({
      ...row,
      posting_guidelines_accepted: !!row.posting_guidelines_accepted,
      pay_display: formatPayDisplay(row.pay_min, row.pay_max, row.pay_type),
    }))

    res.json({
      success: true,
      jobs,
    })
  } catch (error) {
    console.error('GET /api/employer/jobs error:', error)
    res.status(500).json({
      success: false,
      error: error?.message || 'Failed to fetch jobs.',
    })
  }
})

app.post('/api/employer/jobs', requireEmployerAuth, requireEligibleEmployer, async (req, res) => {
  try {
    await expireOpenJobs()
    const employerId = req.auth.employer_id
    const jobTitle = safeTrim(req.body.job_title, 255)
    const jobDescription = safeTrim(req.body.job_description, 20000)
    const city = toNullableString(req.body.city, 255)
    const payMin = parseMoney(req.body.pay_min)
    const payMax = parseMoney(req.body.pay_max)
    const payType = normalizeEnum(req.body.pay_type, ALLOWED_PAY_TYPES, 'hourly')
    const employmentType = normalizeEnum(
      req.body.employment_type,
      ALLOWED_EMPLOYMENT_TYPES,
      'full-time'
    )
    const experienceLevel = toNullableString(req.body.experience_level, 255)
    const status = normalizeEnum(req.body.status, ALLOWED_JOB_STATUSES, 'open')
    const complianceCertified = parseBoolean(req.body.compliance_certified)
    const blockedTerms = getBlockedJobPostingTerms([jobTitle, jobDescription])

    if (!jobTitle || !jobDescription) {
      return res.status(400).json({
        success: false,
        error: 'Job title and job description are required.',
      })
    }

    if (!complianceCertified) {
      return res.status(400).json({
        success: false,
        error: 'You must certify that the posting follows TarboroJobs job posting guidelines before publishing.',
      })
    }

    if (blockedTerms.length > 0) {
      return res.status(400).json({
        success: false,
        error: `This job post includes language TarboroJobs does not allow: ${blockedTerms.join(', ')}. Please remove it and try again.`,
      })
    }

    if (payMin !== null && payMax !== null && payMax < payMin) {
      return res.status(400).json({
        success: false,
        error: 'pay_max cannot be less than pay_min.',
      })
    }

    const lifecycle = resolveJobLifecycleFields(status)
    const guidelinesAcceptedAt = complianceCertified ? new Date() : null

    const [result] = await pool.query(
      `
      INSERT INTO job_posts
      (
        employer_id,
        job_title,
        job_description,
        city,
        pay_min,
        pay_max,
        pay_type,
        employment_type,
        experience_level,
        status,
        published_at,
        expires_at,
        expired_at,
        posting_guidelines_accepted,
        posting_guidelines_accepted_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        employerId,
        jobTitle,
        jobDescription,
        city,
        payMin,
        payMax,
        payType,
        employmentType,
        experienceLevel,
        lifecycle.status,
        lifecycle.publishedAt,
        lifecycle.expiresAt,
        lifecycle.expiredAt,
        complianceCertified ? 1 : 0,
        guidelinesAcceptedAt,
      ]
    )

    res.json({
      success: true,
      id: result.insertId,
      message:
        lifecycle.status === 'open'
          ? `Job created successfully. It will expire automatically in ${JOB_POST_EXPIRATION_DAYS} days.`
          : 'Job created successfully.',
    })
  } catch (error) {
    console.error('POST /api/employer/jobs error:', error)
    res.status(500).json({
      success: false,
      error: error?.message || 'Failed to create job.',
    })
  }
})

app.patch('/api/employer/jobs/:id', requireEmployerAuth, requireEligibleEmployer, async (req, res) => {
  try {
    await expireOpenJobs()
    const employerId = req.auth.employer_id
    const jobId = Number(req.params.id)

    if (!jobId) {
      return res.status(400).json({
        success: false,
        error: 'A valid job ID is required.',
      })
    }

    const ownedJob = await findJobOwnedByEmployer(jobId, employerId)

    if (ownedJob === null) {
      return res.status(404).json({
        success: false,
        error: 'Job not found.',
      })
    }

    if (ownedJob === false) {
      return res.status(403).json({
        success: false,
        error: 'You do not have permission to edit this job.',
      })
    }

    const jobTitle = safeTrim(req.body.job_title, 255)
    const jobDescription = safeTrim(req.body.job_description, 20000)
    const city = toNullableString(req.body.city, 255)
    const payMin = parseMoney(req.body.pay_min)
    const payMax = parseMoney(req.body.pay_max)
    const payType = normalizeEnum(req.body.pay_type, ALLOWED_PAY_TYPES, 'hourly')
    const employmentType = normalizeEnum(
      req.body.employment_type,
      ALLOWED_EMPLOYMENT_TYPES,
      'full-time'
    )
    const experienceLevel = toNullableString(req.body.experience_level, 255)
    const status = normalizeEnum(req.body.status, ALLOWED_JOB_STATUSES, 'open')
    const complianceCertified = parseBoolean(req.body.compliance_certified)
    const blockedTerms = getBlockedJobPostingTerms([jobTitle, jobDescription])

    if (!jobTitle || !jobDescription) {
      return res.status(400).json({
        success: false,
        error: 'Job title and job description are required.',
      })
    }

    if (!complianceCertified) {
      return res.status(400).json({
        success: false,
        error: 'You must certify that the posting follows TarboroJobs job posting guidelines before saving.',
      })
    }

    if (blockedTerms.length > 0) {
      return res.status(400).json({
        success: false,
        error: `This job post includes language TarboroJobs does not allow: ${blockedTerms.join(', ')}. Please remove it and try again.`,
      })
    }

    if (payMin !== null && payMax !== null && payMax < payMin) {
      return res.status(400).json({
        success: false,
        error: 'pay_max cannot be less than pay_min.',
      })
    }

    const lifecycle = resolveJobLifecycleFields(status, ownedJob)
    const guidelinesAcceptedAt = complianceCertified ? new Date() : null

    await pool.query(
      `
      UPDATE job_posts
      SET
        job_title = ?,
        job_description = ?,
        city = ?,
        pay_min = ?,
        pay_max = ?,
        pay_type = ?,
        employment_type = ?,
        experience_level = ?,
        status = ?,
        published_at = ?,
        expires_at = ?,
        expired_at = ?,
        posting_guidelines_accepted = ?,
        posting_guidelines_accepted_at = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
      `,
      [
        jobTitle,
        jobDescription,
        city,
        payMin,
        payMax,
        payType,
        employmentType,
        experienceLevel,
        lifecycle.status,
        lifecycle.publishedAt,
        lifecycle.expiresAt,
        lifecycle.expiredAt,
        complianceCertified ? 1 : 0,
        guidelinesAcceptedAt,
        jobId,
      ]
    )

    res.json({
      success: true,
      message:
        lifecycle.status === 'open' && ownedJob.status !== 'open'
          ? `Job updated successfully and renewed for ${JOB_POST_EXPIRATION_DAYS} days.`
          : 'Job updated successfully.',
    })
  } catch (error) {
    console.error('PATCH /api/employer/jobs/:id error:', error)
    res.status(500).json({
      success: false,
      error: error?.message || 'Failed to update job.',
    })
  }
})

app.patch(
  '/api/employer/jobs/:id/status',
  requireEmployerAuth,
  requireEligibleEmployer,
  async (req, res) => {
    try {
      await expireOpenJobs()
      const employerId = req.auth.employer_id
      const jobId = Number(req.params.id)
      const status = normalizeEnum(req.body.status, ALLOWED_JOB_STATUSES, null)

      if (!jobId) {
        return res.status(400).json({
          success: false,
          error: 'A valid job ID is required.',
        })
      }

      if (!status) {
        return res.status(400).json({
          success: false,
          error: 'Invalid status.',
        })
      }

      const ownedJob = await findJobOwnedByEmployer(jobId, employerId)

      if (ownedJob === null) {
        return res.status(404).json({
          success: false,
          error: 'Job not found.',
        })
      }

      if (ownedJob === false) {
        return res.status(403).json({
          success: false,
          error: 'You do not have permission to modify this job.',
        })
      }

      if (status === 'open' && !ownedJob.posting_guidelines_accepted) {
        return res.status(400).json({
          success: false,
          error: 'Please edit this job and certify the posting guidelines before reopening it.',
        })
      }

      const lifecycle = resolveJobLifecycleFields(status, ownedJob)

      await pool.query(
        `
        UPDATE job_posts
        SET
          status = ?,
          published_at = ?,
          expires_at = ?,
          expired_at = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        `,
        [lifecycle.status, lifecycle.publishedAt, lifecycle.expiresAt, lifecycle.expiredAt, jobId]
      )

      res.json({
        success: true,
        message:
          lifecycle.status === 'open'
            ? `Job status updated successfully. This listing is now live for ${JOB_POST_EXPIRATION_DAYS} days.`
            : 'Job status updated successfully.',
      })
    } catch (error) {
      console.error('PATCH /api/employer/jobs/:id/status error:', error)
      res.status(500).json({
        success: false,
        error: error?.message || 'Failed to update job status.',
      })
    }
  }
)

app.delete('/api/employer/jobs/:id', requireEmployerAuth, requireEligibleEmployer, async (req, res) => {
  try {
    const employerId = req.auth.employer_id
    const jobId = Number(req.params.id)

    if (!jobId) {
      return res.status(400).json({
        success: false,
        error: 'A valid job ID is required.',
      })
    }

    const ownedJob = await findJobOwnedByEmployer(jobId, employerId)

    if (ownedJob === null) {
      return res.status(404).json({
        success: false,
        error: 'Job not found.',
      })
    }

    if (ownedJob === false) {
      return res.status(403).json({
        success: false,
        error: 'You do not have permission to delete this job.',
      })
    }

    await pool.query(
      `
      DELETE FROM job_posts
      WHERE id = ?
      `,
      [jobId]
    )

    res.json({
      success: true,
      message: 'Job deleted successfully.',
    })
  } catch (error) {
    console.error('DELETE /api/employer/jobs/:id error:', error)
    res.status(500).json({
      success: false,
      error: error?.message || 'Failed to delete job.',
    })
  }
})

app.get('/api/employer/stats', requireEmployerAuth, requireEligibleEmployer, async (req, res) => {
  try {
    await expireOpenJobs()
    const employerId = req.auth.employer_id
    const now = new Date()

    const [openJobsRows] = await pool.query(
      `
      SELECT COUNT(*) AS total
      FROM job_posts
      WHERE employer_id = ?
        AND status = 'open'
      `,
      [employerId]
    )

    const [resumeRows] = await pool.query(
      `
      SELECT
        COUNT(js.id) AS total_resumes,
        SUM(CASE WHEN eca.status = 'saved' THEN 1 ELSE 0 END) AS saved_candidates,
        SUM(CASE WHEN eca.interview_at IS NOT NULL THEN 1 ELSE 0 END) AS interviews_scheduled,
        SUM(
          CASE
            WHEN eca.next_follow_up_at IS NOT NULL
             AND eca.next_follow_up_at <= ?
            THEN 1
            ELSE 0
          END
        ) AS follow_ups_due
      FROM job_seekers js
      LEFT JOIN employer_candidate_actions eca
        ON eca.job_seeker_id = js.id
       AND eca.employer_id = ?
<<<<<<< HEAD
=======
      WHERE js.employer_id = ?
>>>>>>> a7ef58f (Add job detail pages, apply flow, employer scoping, and ATS scoring)
      `,
      [now, employerId]
    )

    res.json({
      success: true,
      stats: {
        open_jobs: Number(openJobsRows[0]?.total || 0),
        total_resumes: Number(resumeRows[0]?.total_resumes || 0),
        saved_candidates: Number(resumeRows[0]?.saved_candidates || 0),
        interviews_scheduled: Number(resumeRows[0]?.interviews_scheduled || 0),
        follow_ups_due: Number(resumeRows[0]?.follow_ups_due || 0),
      },
      generated_at: now,
    })
  } catch (error) {
    console.error('GET /api/employer/stats error:', error)
    res.status(500).json({
      success: false,
      error: error?.message || 'Failed to fetch employer stats.',
    })
  }
})

app.get('/api/employer/resumes', requireEmployerAuth, requireEligibleEmployer, async (req, res) => {
  try {
    const employerId = req.auth.employer_id
    const page = Math.max(parseInt(req.query.page || '1', 10), 1)
    const limit = Math.min(Math.max(parseInt(req.query.limit || '25', 10), 1), 100)
    const offset = (page - 1) * limit

    const search = safeTrim(req.query.search, 255)
    const city = safeTrim(req.query.city, 255)
    const employmentType = safeTrim(req.query.employment_type, 50)
    const candidateStatus = normalizeCandidateStatus(req.query.candidate_status)

    if (candidateStatus && !ALLOWED_CANDIDATE_STATUSES.has(candidateStatus)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid candidate status filter.',
      })
    }

<<<<<<< HEAD
    const whereParts = []
    const params = []
=======
    const whereParts = ['js.employer_id = ?']
    const params = [employerId]
>>>>>>> a7ef58f (Add job detail pages, apply flow, employer scoping, and ATS scoring)

    if (search) {
      whereParts.push(`
        (
          js.full_name LIKE ?
          OR js.email LIKE ?
          OR js.desired_job_title LIKE ?
          OR js.skills LIKE ?
          OR js.resume_text LIKE ?
        )
      `)
      const like = `%${search}%`
      params.push(like, like, like, like, like)
    }

    if (city) {
      whereParts.push('js.city LIKE ?')
      params.push(`%${city}%`)
    }

    if (employmentType) {
      whereParts.push('js.employment_type = ?')
      params.push(employmentType)
    }

    if (candidateStatus) {
      whereParts.push('eca.status = ?')
      params.push(candidateStatus)
    }

    const whereSql = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : ''

    const [countRows] = await pool.query(
      `
      SELECT COUNT(*) AS total
      FROM job_seekers js
      LEFT JOIN employer_candidate_actions eca
        ON eca.job_seeker_id = js.id
       AND eca.employer_id = ?
      LEFT JOIN job_posts jp ON jp.id = js.job_post_id
      ${whereSql}
      `,
      [employerId, ...params]
    )

    const total = Number(countRows[0]?.total || 0)

    const [rows] = await pool.query(
      `
      SELECT
        js.id,
        js.full_name,
        js.email,
        js.phone,
        js.city,
        js.desired_job_title,
        js.employment_type,
        js.skills,
        js.resume_text,
        js.resume_file_url,
        js.job_post_id,
        js.ats_score,
        js.ats_recommendation,
        js.ats_summary,
        js.ats_keywords_matched,
        js.ats_keywords_missing,
        js.ats_title_match,
        js.created_at,
        js.updated_at,
        jp.job_title,
        eca.id AS action_id,
        eca.status AS candidate_status,
        eca.notes AS candidate_notes,
        eca.contacted_at,
        eca.interview_at,
        eca.hired_at,
        eca.rejected_at,
        eca.next_follow_up_at,
        eca.updated_at AS candidate_updated_at
      FROM job_seekers js
      LEFT JOIN employer_candidate_actions eca
        ON eca.job_seeker_id = js.id
       AND eca.employer_id = ?
      LEFT JOIN job_posts jp ON jp.id = js.job_post_id
      ${whereSql}
      ORDER BY js.created_at DESC
      LIMIT ? OFFSET ?
      `,
      [employerId, ...params, limit, offset]
    )

    const resumes = rows.map((row) => ({
      id: row.id,
      full_name: row.full_name,
      email: row.email,
      phone: row.phone,
      city: row.city,
      desired_job_title: row.desired_job_title,
      employment_type: row.employment_type,
      skills: row.skills,
      resume_text: row.resume_text,
      resume_file_url: row.resume_file_url,
      job_post_id: row.job_post_id,
      job_title: row.job_title,
      ats_score: row.ats_score !== null && row.ats_score !== undefined ? Number(row.ats_score) : null,
      ats_recommendation: row.ats_recommendation,
      ats_summary: row.ats_summary,
      ats_keywords_matched: row.ats_keywords_matched
        ? String(row.ats_keywords_matched)
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean)
        : [],
      ats_keywords_missing: row.ats_keywords_missing
        ? String(row.ats_keywords_missing)
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean)
        : [],
      ats_title_match: !!row.ats_title_match,
      created_at: row.created_at,
      updated_at: row.updated_at,
      candidate_action: row.action_id
        ? {
            id: row.action_id,
            status: row.candidate_status,
            notes: row.candidate_notes || '',
            contacted_at: row.contacted_at,
            interview_at: row.interview_at,
            hired_at: row.hired_at,
            rejected_at: row.rejected_at,
            next_follow_up_at: row.next_follow_up_at,
            updated_at: row.candidate_updated_at,
          }
        : null,
    }))

    res.json({
      success: true,
      resumes,
      pagination: {
        page,
        limit,
        total,
        total_pages: Math.max(Math.ceil(total / limit), 1),
        has_next: page * limit < total,
        has_prev: page > 1,
      },
<<<<<<< HEAD
      filters: {
        search,
        city,
        employment_type: employmentType,
        candidate_status: candidateStatus || '',
      },
=======
>>>>>>> a7ef58f (Add job detail pages, apply flow, employer scoping, and ATS scoring)
    })
  } catch (error) {
    console.error('GET /api/employer/resumes error:', error)
    res.status(500).json({
      success: false,
      error: error?.message || 'Failed to fetch resumes.',
    })
  }
})

app.post(
  '/api/employer/candidate-actions',
  requireEmployerAuth,
  requireEligibleEmployer,
  async (req, res) => {
    try {
      const employerId = req.auth.employer_id
      const jobSeekerId = Number(req.body.job_seeker_id)
      const normalizedStatus = normalizeCandidateStatus(req.body.status)
      const notes =
        req.body.notes !== undefined && req.body.notes !== null
          ? safeTrim(req.body.notes, 5000)
          : null

      const contactedAt = normalizeDateTime(req.body.contacted_at)
      const interviewAt = normalizeDateTime(req.body.interview_at)
      const hiredAt = normalizeDateTime(req.body.hired_at)
      const rejectedAt = normalizeDateTime(req.body.rejected_at)
      const nextFollowUpAt = normalizeDateTime(req.body.next_follow_up_at)

      if (!jobSeekerId) {
        return res.status(400).json({
          success: false,
          error: 'job_seeker_id is required.',
        })
      }

      if (normalizedStatus && !ALLOWED_CANDIDATE_STATUSES.has(normalizedStatus)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid candidate status.',
        })
      }

      const [jobSeekers] = await pool.query(
        `
        SELECT id
        FROM job_seekers
        WHERE id = ?
        LIMIT 1
        `,
        [jobSeekerId]
      )

      if (!jobSeekers.length) {
        return res.status(404).json({
          success: false,
          error: 'Candidate not found.',
        })
      }

      const [existing] = await pool.query(
        `
        SELECT id
        FROM employer_candidate_actions
        WHERE employer_id = ? AND job_seeker_id = ?
        LIMIT 1
        `,
        [employerId, jobSeekerId]
      )

      if (existing.length > 0) {
        await pool.query(
          `
          UPDATE employer_candidate_actions
          SET
            status = ?,
            notes = ?,
            contacted_at = ?,
            interview_at = ?,
            hired_at = ?,
            rejected_at = ?,
            next_follow_up_at = ?,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
          `,
          [
            normalizedStatus,
            notes || null,
            contactedAt,
            interviewAt,
            hiredAt,
            rejectedAt,
            nextFollowUpAt,
            existing[0].id,
          ]
        )

        const action = await fetchCandidateActionById(existing[0].id)

        return res.json({
          success: true,
          action_id: existing[0].id,
          action,
          message: 'Candidate action updated successfully.',
        })
      }

      const [result] = await pool.query(
        `
        INSERT INTO employer_candidate_actions
        (
          employer_id,
          job_seeker_id,
          status,
          notes,
          contacted_at,
          interview_at,
          hired_at,
          rejected_at,
          next_follow_up_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          employerId,
          jobSeekerId,
          normalizedStatus,
          notes || null,
          contactedAt,
          interviewAt,
          hiredAt,
          rejectedAt,
          nextFollowUpAt,
        ]
      )

      const action = await fetchCandidateActionById(result.insertId)

      res.json({
        success: true,
        action_id: result.insertId,
        action,
        message: 'Candidate action created successfully.',
      })
    } catch (error) {
      console.error('POST /api/employer/candidate-actions error:', error)
      res.status(500).json({
        success: false,
        error: error?.message || 'Failed to save candidate action.',
      })
    }
  }
)

app.patch(
  '/api/employer/candidate-actions/:id',
  requireEmployerAuth,
  requireEligibleEmployer,
  async (req, res) => {
    try {
      const employerId = req.auth.employer_id
      const actionId = Number(req.params.id)
      const normalizedStatus = normalizeCandidateStatus(req.body.status)

      const notesProvided = Object.prototype.hasOwnProperty.call(req.body, 'notes')
      const statusProvided = Object.prototype.hasOwnProperty.call(req.body, 'status')
      const contactedProvided = Object.prototype.hasOwnProperty.call(req.body, 'contacted_at')
      const interviewProvided = Object.prototype.hasOwnProperty.call(req.body, 'interview_at')
      const hiredProvided = Object.prototype.hasOwnProperty.call(req.body, 'hired_at')
      const rejectedProvided = Object.prototype.hasOwnProperty.call(req.body, 'rejected_at')
      const followUpProvided = Object.prototype.hasOwnProperty.call(req.body, 'next_follow_up_at')

      if (!actionId) {
        return res.status(400).json({
          success: false,
          error: 'A valid candidate action ID is required.',
        })
      }

      const [rows] = await pool.query(
        `
        SELECT id, employer_id
        FROM employer_candidate_actions
        WHERE id = ?
        LIMIT 1
        `,
        [actionId]
      )

      if (!rows.length) {
        return res.status(404).json({
          success: false,
          error: 'Candidate action not found.',
        })
      }

      if (Number(rows[0].employer_id) !== Number(employerId)) {
        return res.status(403).json({
          success: false,
          error: 'You do not have permission to modify this candidate action.',
        })
      }

      const updateFields = []
      const updateParams = []

      if (statusProvided) {
        if (normalizedStatus && !ALLOWED_CANDIDATE_STATUSES.has(normalizedStatus)) {
          return res.status(400).json({
            success: false,
            error: 'Invalid candidate status.',
          })
        }

        updateFields.push('status = ?')
        updateParams.push(normalizedStatus)
      }

      if (notesProvided) {
        const normalizedNotes =
          req.body.notes !== undefined && req.body.notes !== null
            ? safeTrim(req.body.notes, 5000)
            : null

        updateFields.push('notes = ?')
        updateParams.push(normalizedNotes || null)
      }

      if (contactedProvided) {
        updateFields.push('contacted_at = ?')
        updateParams.push(normalizeDateTime(req.body.contacted_at))
      }

      if (interviewProvided) {
        updateFields.push('interview_at = ?')
        updateParams.push(normalizeDateTime(req.body.interview_at))
      }

      if (hiredProvided) {
        updateFields.push('hired_at = ?')
        updateParams.push(normalizeDateTime(req.body.hired_at))
      }

      if (rejectedProvided) {
        updateFields.push('rejected_at = ?')
        updateParams.push(normalizeDateTime(req.body.rejected_at))
      }

      if (followUpProvided) {
        updateFields.push('next_follow_up_at = ?')
        updateParams.push(normalizeDateTime(req.body.next_follow_up_at))
      }

      if (!updateFields.length) {
        return res.status(400).json({
          success: false,
          error: 'Nothing to update.',
        })
      }

      updateFields.push('updated_at = CURRENT_TIMESTAMP')

      await pool.query(
        `
        UPDATE employer_candidate_actions
        SET ${updateFields.join(', ')}
        WHERE id = ?
        `,
        [...updateParams, actionId]
      )

      const action = await fetchCandidateActionById(actionId)

      res.json({
        success: true,
        action,
        message: 'Candidate action updated successfully.',
      })
    } catch (error) {
      console.error('PATCH /api/employer/candidate-actions/:id error:', error)
      res.status(500).json({
        success: false,
        error: error?.message || 'Failed to update candidate action.',
      })
    }
  }
)

app.get('/api/employers', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `
      SELECT
        id,
        business_name,
        industry,
        contact_name,
        email,
        phone,
        website,
        address,
        city,
        notes,
        status,
        subscription_status,
        access_status,
        current_period_end,
        onboarding_completed,
        created_at,
        updated_at
      FROM employers
      WHERE access_status = 'active'
        AND onboarding_completed = 1
      ORDER BY created_at DESC
      `
    )

    const businesses = rows.map((row) => ({
      id: row.id,
      name: row.business_name,
      industry: row.industry,
      contact_name: row.contact_name,
      email: row.email,
      phone: row.phone,
      website: row.website,
      address: row.address,
      city: row.city,
      description: row.notes,
      status: row.status,
      subscription_status: row.subscription_status,
      access_status: row.access_status,
      current_period_end: row.current_period_end,
      onboarding_completed: !!row.onboarding_completed,
      hiring: row.status === 'active',
      created_at: row.created_at,
      updated_at: row.updated_at,
    }))

    res.json({
      success: true,
      businesses,
    })
  } catch (error) {
    console.error('GET /api/employers error:', error)
    res.status(500).json({
      success: false,
      error: error?.message || 'Failed to fetch employers.',
    })
  }
})

app.get('/api/jobposts', async (req, res) => {
  try {
    await expireOpenJobs()
    const [rows] = await pool.query(
      `
      SELECT
        jp.id,
        jp.job_title,
        jp.job_description,
        jp.city,
        jp.pay_min,
        jp.pay_max,
        jp.pay_type,
        jp.employment_type,
        jp.experience_level,
        jp.status,
        jp.created_at,
        jp.published_at,
        jp.expires_at,
        e.business_name,
        e.industry
      FROM job_posts jp
      INNER JOIN employers e ON e.id = jp.employer_id
      WHERE jp.status = 'open'
        AND (jp.expires_at IS NULL OR jp.expires_at > CURRENT_TIMESTAMP)
        AND e.access_status = 'active'
        AND e.onboarding_completed = 1
      ORDER BY COALESCE(jp.published_at, jp.created_at) DESC
      `
    )

    const jobs = rows.map((row) => ({
      id: row.id,
      title: row.job_title,
      company: row.business_name,
      city: row.city,
      pay: formatPayDisplay(row.pay_min, row.pay_max, row.pay_type),
      type: row.employment_type,
      industry: row.industry,
      experience_level: row.experience_level,
      description: row.job_description,
      status: row.status,
      posted: row.published_at || row.created_at,
      expires_at: row.expires_at,
    }))

    res.json({
      success: true,
      jobs,
    })
  } catch (error) {
    console.error('GET /api/jobposts error:', error)
    res.status(500).json({
      success: false,
      error: error?.message || 'Failed to fetch job posts.',
    })
  }
})

app.post('/api/admin/employers/:id/deactivate', requireAdminAuth, async (req, res) => {
  const connection = await pool.getConnection()

  try {
    await connection.beginTransaction()

    const employerId = Number(req.params.id)

    if (!employerId) {
      await connection.rollback()
      return res.status(400).json({
        success: false,
        error: 'A valid employer ID is required.',
      })
    }

    await connection.query(
      `
      UPDATE employers
      SET access_status = 'inactive', updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
      `,
      [employerId]
    )

    await connection.query(
      `
      UPDATE job_posts
      SET status = 'closed', updated_at = CURRENT_TIMESTAMP
      WHERE employer_id = ? AND status = 'open'
      `,
      [employerId]
    )

    await connection.commit()

    res.json({
      success: true,
      message: 'Employer deactivated and open jobs closed.',
    })
  } catch (error) {
    await connection.rollback()
    console.error('POST /api/admin/employers/:id/deactivate error:', error)
    res.status(500).json({
      success: false,
      error: error?.message || 'Failed to deactivate employer.',
    })
  } finally {
    connection.release()
  }
})

app.post('/api/admin/employers/:id/reactivate', requireAdminAuth, async (req, res) => {
  try {
    const employerId = Number(req.params.id)

    if (!employerId) {
      return res.status(400).json({
        success: false,
        error: 'A valid employer ID is required.',
      })
    }

    await pool.query(
      `
      UPDATE employers
      SET access_status = 'active', updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
      `,
      [employerId]
    )

    res.json({
      success: true,
      message: 'Employer reactivated.',
    })
  } catch (error) {
    console.error('POST /api/admin/employers/:id/reactivate error:', error)
    res.status(500).json({
      success: false,
      error: error?.message || 'Failed to reactivate employer.',
    })
  }
})

app.post('/api/admin/tokens/:id/revoke', requireAdminAuth, async (req, res) => {
  try {
    const tokenId = Number(req.params.id)

    if (!tokenId) {
      return res.status(400).json({
        success: false,
        error: 'A valid token ID is required.',
      })
    }

    await pool.query(
      `
      UPDATE employer_onboarding_tokens
      SET status = 'revoked'
      WHERE id = ?
      `,
      [tokenId]
    )

    res.json({
      success: true,
      message: 'Onboarding token revoked.',
    })
  } catch (error) {
    console.error('POST /api/admin/tokens/:id/revoke error:', error)
    res.status(500).json({
      success: false,
      error: error?.message || 'Failed to revoke onboarding token.',
    })
  }
})

if (fs.existsSync(frontendIndexFile)) {
  app.use(express.static(frontendDistDir))

  app.get(/^\/(?!api(?:\/|$)|uploads(?:\/|$)).*/, (req, res, next) => {
    res.sendFile(frontendIndexFile, (error) => {
      if (error) next(error)
    })
  })
} else {
  console.warn(`Frontend build not found at: ${frontendIndexFile}`)
}

app.use('/api', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'API route not found.',
  })
})

app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    return res.status(400).json({
      success: false,
      error: error.message,
    })
  }

  if (error) {
    return res.status(400).json({
      success: false,
      error: error.message || 'Request failed.',
    })
  }

  next()
})

async function startServer() {
  await ensureEmployerPasswordResetTable()
  await ensureJobPostingComplianceColumns()
  await ensureJobSeekerApplicationColumns()
  await expireOpenJobs()

  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`)
  })
}

startServer().catch((error) => {
  console.error('Failed to start server:', error)
  process.exit(1)
})