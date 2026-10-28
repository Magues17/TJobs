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
import { analyzeResume, previewFromFullReport } from './resumeAnalyzer.js'
import { runAllScrapers } from './jobScraper.js'
import { generateCoverLetter, generateInterviewPrep } from './aiService.js'
import { registerAnalytics } from './analytics.js'
import { registerBundles } from './bundles.js'
import { register as registerJobAlerts } from './alerts.js'
import { register as registerFacebook, dedupeJobRows } from './facebook.js'
import { register as registerSharePack } from './sharePack.js'
import { register as registerSeekers } from './seekers.js'
import { register as registerIndexNow } from './indexnow.js'
import { createSeo } from './seo.js'
import { register as registerFeatured, orderFeaturedFirst, isFeatured } from './featured.js'
import { registerEmployerSelfServe, resolvePayPerPostStatus, applyPlanUpgrade, JOB_POST_PRICE_CENTS, PAID_POST_DAYS } from './employerSelfServe.js'

dotenv.config()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()

const PORT = Number(process.env.PORT || 3000)
const JOB_POST_EXPIRATION_DAYS = 14
const JWT_SECRET_CONFIGURED = !!process.env.JWT_SECRET && process.env.JWT_SECRET !== 'dev-only-secret-change-this'
const JWT_SECRET = (() => {
  if (JWT_SECRET_CONFIGURED) return process.env.JWT_SECRET
  // Never sign with a known secret. A random one keeps the site up but signs
  // everyone out on every restart, so set JWT_SECRET in the environment.
  console.error('WARNING: JWT_SECRET is not set (or is the old default). Using a random secret; all sessions reset on restart. Set JWT_SECRET to fix this.')
  return crypto.randomBytes(48).toString('hex')
})()
const ADMIN_API_KEY = (() => {
  const key = process.env.ADMIN_API_KEY || process.env.ADMIN_BEARER_TOKEN || ''
  if (!key) return ''
  // A short or known key gives anyone admin; refuse it rather than run exposed.
  // Admin login via an is_admin employer account keeps working.
  if (key.length < 24 || /^tarboro-admin/i.test(key)) {
    console.error('WARNING: ADMIN_API_KEY is too weak (min 24 random chars); admin API-key auth is disabled until it is replaced.')
    return ''
  }
  return key
})()
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || process.env.ADMIN_EMAIL || 'jobs@tarborojobs.com')
  .split(',')
  .map((value) => normalizeEmail(value))
  .filter(Boolean)
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
const PUBLIC_EMPLOYER_PLAN_CLAIM_ENABLED = (() => {
  const explicit = process.env.PUBLIC_EMPLOYER_PLAN_CLAIM_ENABLED
  if (explicit !== undefined && String(explicit).trim() !== '') {
    return parseBoolean(explicit)
  }

  return /4klabs\.net/i.test(APP_BASE_URL) || /4klabs\.net/i.test(EMPLOYER_ONBOARDING_BASE_URL)
})()

const SQUARE_ACCESS_TOKEN = safeTrim(process.env.SQUARE_ACCESS_TOKEN, 255)
const SQUARE_LOCATION_ID = safeTrim(process.env.SQUARE_LOCATION_ID || process.env.SQUARE_EMPLOYER_LOCATION_ID, 255)
const SQUARE_WEBHOOK_SIGNATURE_KEY = safeTrim(process.env.SQUARE_WEBHOOK_SIGNATURE_KEY || process.env.SQUARE_SIGNATURE_KEY, 255)
const SQUARE_API_BASE_URL =
  safeTrim(process.env.SQUARE_API_BASE_URL, 255) ||
  (parseBoolean(process.env.SQUARE_SANDBOX)
    ? 'https://connect.squareupsandbox.com'
    : 'https://connect.squareup.com')
const SQUARE_EMPLOYER_PLAN_NAME =
  safeTrim(process.env.SQUARE_EMPLOYER_PLAN_NAME, 255) ||
  'TarboroJobs Employer Plan'
const SQUARE_EMPLOYER_PLAN_AMOUNT_CENTS = Math.max(
  100,
  Number.parseInt(process.env.SQUARE_EMPLOYER_PLAN_AMOUNT_CENTS || '4900', 10) || 4900
)
const SQUARE_EMPLOYER_PLAN_CURRENCY =
  safeTrim(process.env.SQUARE_EMPLOYER_PLAN_CURRENCY, 12).toUpperCase() ||
  'USD'
const SQUARE_SUBSCRIPTION_PLAN_ID =
  safeTrim(
    process.env.SQUARE_SUBSCRIPTION_PLAN_ID ||
      process.env.SQUARE_SUBSCRIPTION_PLAN_VARIATION_ID,
    255
  )
const SQUARE_WEBHOOK_NOTIFICATION_URL =
  safeTrim(process.env.SQUARE_WEBHOOK_NOTIFICATION_URL, 2048) ||
  (APP_BASE_URL ? `${APP_BASE_URL.replace(/\/+$/, '')}/api/square/webhook` : '')

const RESUME_CHECKER_PRICE_CENTS = Math.max(
  100,
  Number.parseInt(process.env.RESUME_CHECKER_PRICE_CENTS || '999', 10) || 999
)
const RESUME_CHECKER_PRICE_CURRENCY =
  safeTrim(process.env.RESUME_CHECKER_PRICE_CURRENCY, 12).toUpperCase() || 'USD'
const RESUME_CHECKER_PRODUCT_NAME =
  safeTrim(process.env.RESUME_CHECKER_PRODUCT_NAME, 255) ||
  'TarboroJobs Resume Checker - Full Report'
const RESUME_CHECKER_MAX_UPLOAD_BYTES = 5 * 1024 * 1024
// LOCAL TESTING ONLY. When this env var is truthy, the create-checkout
// endpoint flips the resume_checks row to paid in-process and returns a
// same-origin URL that leads straight to the paid report - bypassing
// Square entirely. Never set this in staging or production.
// Guarded here so every bypass site (resume checker, AI orders) is covered:
// it only takes effect outside NODE_ENV=production AND when APP_BASE_URL
// points at localhost, so a stray env var in production cannot give free orders.
const RESUME_CHECKER_DEV_BYPASS = (() => {
  if (!parseBoolean(process.env.RESUME_CHECKER_DEV_BYPASS)) return false
  let host = ''
  try { host = new URL(APP_BASE_URL).hostname } catch {}
  const local = process.env.NODE_ENV !== 'production' && ['localhost', '127.0.0.1', '[::1]'].includes(host)
  if (!local) console.error('RESUME_CHECKER_DEV_BYPASS ignored: only allowed with a localhost APP_BASE_URL outside production.')
  return local
})()

const projectRoot = path.resolve(__dirname, '..')
const frontendDistDir = path.join(projectRoot, 'dist')
const frontendIndexFile = path.join(frontendDistDir, 'index.html')

const uploadsRoot = path.join(__dirname, 'uploads')
const resumesDir = path.join(uploadsRoot, 'resumes')

const CANDIDATE_STATUS_ALIASES = {
  new: ['new'],
  reviewed: ['reviewed', 'saved', 'contacted', 'archived'],
  interview: ['interview', 'interviewing'],
  rejected: ['rejected'],
  hired: ['hired'],
}

const CANDIDATE_STATUS_SQL_VALUES = {
  new: ['', 'new'],
  reviewed: ['reviewed', 'saved', 'contacted', 'archived'],
  interview: ['interview', 'interviewing'],
  rejected: ['rejected'],
  hired: ['hired'],
}

const ALLOWED_CANDIDATE_STATUSES = new Set(
  Object.values(CANDIDATE_STATUS_ALIASES).flat()
)

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

    callback(clientError('Not allowed by CORS'))
  },
  credentials: true,
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, resumesDir),
  // Unguessable name, nothing from the uploader. Both upload filters only
  // accept .pdf, so the extension is fixed.
  filename: (req, file, cb) => {
    cb(null, newResumeFileName())
  },
})

// Also used for the copy of a saved profile resume sent with a one-click apply.
function newResumeFileName() {
  return `${Date.now()}-${crypto.randomBytes(16).toString('hex')}.pdf`
}

// An error whose message is safe to show the user; the error handler answers
// 400 with it. Anything without a 4xx status is answered with generic text.
function clientError(message) {
  return Object.assign(new Error(message), { status: 400 })
}

// Deletes the uploaded resume when the route answers with an error, so every
// early return (validation, 404, 429, catch blocks) cleans up in one place.
// A route sets req.keepUpload once a saved row points at the file.
function discardUploadOnError(req, res, next) {
  res.on('finish', () => {
    if (req.file?.path && res.statusCode >= 400 && !req.keepUpload) {
      fs.promises.unlink(req.file.path).catch(() => {})
    }
  })
  next()
}

const resumeCheckerUpload = multer({
  storage,
  limits: {
    fileSize: RESUME_CHECKER_MAX_UPLOAD_BYTES,
    files: 1,
  },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase()
    const mime = String(file.mimetype || '').toLowerCase()
    const isPdf = ext === '.pdf' && (mime.includes('pdf') || mime === 'application/octet-stream')

    if (!isPdf) {
      cb(clientError('Only PDF resume files are allowed.'))
      return
    }
    cb(null, true)
  },
})

// Simple in-memory per-IP rate limiter. Each endpoint gets its own buckets
// from createIpRateLimiter: the resume checker upload, and the cover letter
// and interview prep generate endpoints.
// Not distributed - good enough for a single-instance MVP behind Hostinger.
const RESUME_CHECKER_RATE_WINDOW_MS = 10 * 60 * 1000 // 10 minutes
const RESUME_CHECKER_RATE_MAX = 8 // 8 requests per IP per window

function createIpRateLimiter(windowMs = RESUME_CHECKER_RATE_WINDOW_MS, max = RESUME_CHECKER_RATE_MAX) {
  const buckets = new Map()

  return function consume(ip) {
    if (!ip) return true
    const now = Date.now()
    const bucket = buckets.get(ip) || []
    const fresh = bucket.filter((stamp) => now - stamp < windowMs)
    if (fresh.length >= max) {
      buckets.set(ip, fresh)
      return false
    }
    fresh.push(now)
    buckets.set(ip, fresh)

    // Drop idle IPs so the map cannot grow without bound.
    if (buckets.size > 5000) {
      for (const [key, stamps] of buckets) {
        if (!stamps.length || now - stamps[stamps.length - 1] >= windowMs) buckets.delete(key)
      }
    }
    return true
  }
}

const consumeResumeCheckerRate = createIpRateLimiter()
const consumeCoverLetterRate = createIpRateLimiter()
const consumeInterviewPrepRate = createIpRateLimiter()
const consumeLoginRate = createIpRateLimiter(15 * 60 * 1000, 10)
const consumeForgotPasswordRate = createIpRateLimiter(60 * 60 * 1000, 5)
const consumeResetPasswordRate = createIpRateLimiter(15 * 60 * 1000, 10)
const consumeJobSeekerUploadRate = createIpRateLimiter(60 * 60 * 1000, 10)
const consumeApplyUploadRate = createIpRateLimiter(60 * 60 * 1000, 10)

// req.ip honours the 'trust proxy' setting below: it is the address the
// nearest untrusted hop connected from, so a client cannot pick its own
// bucket by sending a fake X-Forwarded-For. If req.ip is missing the socket's
// peer address is used. Only when there is no peer address at all (a Unix
// socket, as Passenger uses) is the last X-Forwarded-For entry used: that is
// the one the local web server appended, never the client-supplied left end.
// /api/admin/diagnostics shows which case production hits.
function getRequestIp(req) {
  if (req.ip) return req.ip
  if (req.socket?.remoteAddress) return req.socket.remoteAddress
  return String(req.headers['x-forwarded-for'] || '').split(',').pop().trim()
}

// Express middleware form for routes that only need a per-IP cap.
function rateLimitByIp(consume, error = 'Too many attempts. Please try again later.') {
  return (req, res, next) => {
    if (!consume(getRequestIp(req))) {
      return res.status(429).json({ success: false, error })
    }
    next()
  }
}

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
      cb(clientError('Only PDF resume files are allowed.'))
      return
    }

    cb(null, true)
  },
})

app.disable('x-powered-by')
// Hostinger puts its reverse proxy in front of the app on the same host /
// private network, so trust only loopback and private-range hops by default.
// If a CDN with public edge IPs sits in front too, set TRUST_PROXY to the
// number of proxy hops (e.g. 2) so req.ip is the visitor, not the edge.
const TRUST_PROXY = safeTrim(process.env.TRUST_PROXY) || 'loopback, linklocal, uniquelocal'
app.set('trust proxy', /^\d+$/.test(TRUST_PROXY) ? Number(TRUST_PROXY) : TRUST_PROXY)
app.use(cors(corsOptions))
app.use(express.json({ limit: '2mb', verify: (req, res, buf) => { req.rawBody = buf.toString('utf8') } }))
app.use(express.urlencoded({ extended: true }))
// Resumes are not served statically; see /api/employer/resume-files/:name.

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
      COALESCE(jp.industry, e.industry) AS industry,
      jp.pay_min,
      jp.pay_max,
      jp.pay_type,
      jp.employment_type,
      jp.experience_level,
      jp.status,
      jp.created_at,
      jp.published_at,
      jp.expires_at,
      jp.source_url,
      jp.featured_until,
      (jp.featured_until IS NOT NULL AND jp.featured_until > CURRENT_TIMESTAMP) AS is_featured,
      e.business_name,
      e.industry AS employer_industry
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

// Every job the public can see, featured first then newest (same visibility
// rules as above); see orderFeaturedFirst in featured.js.
async function listPublicJobPostRows() {
  const [rows] = await pool.query(
    `
    SELECT
      jp.id,
      jp.job_title,
      jp.job_description,
      jp.city,
      COALESCE(jp.industry, e.industry) AS industry,
      jp.pay_min,
      jp.pay_max,
      jp.pay_type,
      jp.employment_type,
      jp.experience_level,
      jp.status,
      jp.created_at,
      jp.published_at,
      jp.updated_at,
      jp.expires_at,
      jp.source_url,
      jp.featured_until,
      (jp.featured_until IS NOT NULL AND jp.featured_until > CURRENT_TIMESTAMP) AS is_featured,
      e.business_name,
      e.industry AS employer_industry
    FROM job_posts jp
    INNER JOIN employers e ON e.id = jp.employer_id
    WHERE jp.status = 'open'
      AND (jp.expires_at IS NULL OR jp.expires_at > CURRENT_TIMESTAMP)
      AND e.access_status = 'active'
      AND e.onboarding_completed = 1
    ORDER BY COALESCE(jp.published_at, jp.created_at) DESC
    `
  )
  return dedupeJobRows(orderFeaturedFirst(rows))
}

function createAuthToken(user) {
  return jwt.sign(
    {
      user_id: Number(user.id),
      employer_id: Number(user.employer_id),
      email: user.email,
      // Bumped on password change/reset so older tokens stop working.
      tv: Number(user.token_version || 0),
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  )
}

// Can sign in and post/manage their own jobs. Verified self-serve
// (pay_per_post) employers always can; everyone else needs a live plan.
function isEmployerEligible(employer) {
  if (employer?.plan === 'pay_per_post' && employer.access_status === 'active') return true
  return hasSubscriptionFeatures(employer)
}

// The $49/month plan: free unlimited posts, applicant search and the
// candidate pipeline. A self-serve employer only has it once they bought the
// plan (which links them to Square).
function hasSubscriptionFeatures(employer) {
  if (!employer) return false
  if (employer.access_status !== 'active') return false
  if (employer.plan === 'pay_per_post' && !isSquareBilledEmployer(employer)) return false
  const status = employer.subscription_status || 'active'
  const periodEnd = parseDateOrNull(employer.current_period_end)
  if (status === 'active') {
    // A failed renewal leaves Square at ACTIVE with an old paid-through date,
    // so a Square-billed plan lapses once that date is past the grace period.
    // Employers with no Square link (scraped listings, comped) never lapse here.
    if (!isSquareBilledEmployer(employer) || !periodEnd) return true
    return periodEnd.getTime() + SUBSCRIPTION_GRACE_MS > Date.now()
  }
  // A canceled plan keeps access only until the period it paid for ends.
  // 'paused' and 'pending' (and anything unknown) have no access.
  if (status !== 'canceled') return false
  return !!periodEnd && periodEnd > new Date()
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

  try {
    const url = new URL(EMPLOYER_ONBOARDING_BASE_URL)

    if (!url.searchParams.get('page')) {
      url.searchParams.set('page', 'employer-onboarding')
    }

    url.searchParams.set('token', token)
    return url.toString()
  } catch {
    const separator = EMPLOYER_ONBOARDING_BASE_URL.includes('?') ? '&' : '?'
    const hasPage = /[?&]page=/.test(EMPLOYER_ONBOARDING_BASE_URL)
    const pagePart = hasPage ? '' : `${separator}page=employer-onboarding`
    const tokenSeparator = EMPLOYER_ONBOARDING_BASE_URL.includes('?') || pagePart ? '&' : '?'
    return `${EMPLOYER_ONBOARDING_BASE_URL}${pagePart}${tokenSeparator}token=${encodeURIComponent(token)}`
  }
}

function buildEmployerPasswordResetUrl(token) {
  if (!EMPLOYER_PASSWORD_RESET_BASE_URL) return null
  const separator = EMPLOYER_PASSWORD_RESET_BASE_URL.includes('?') ? '&' : '?'
  return `${EMPLOYER_PASSWORD_RESET_BASE_URL}${separator}page=employer-reset-password&token=${encodeURIComponent(token)}`
}

function buildEmployerPaymentSuccessUrl(checkoutRef, page = 'employer-payment-success') {
  if (!APP_BASE_URL) return null

  try {
    const url = new URL(APP_BASE_URL)
    url.searchParams.set('page', page)
    url.searchParams.set('checkout_ref', checkoutRef)
    return url.toString()
  } catch {
    const separator = APP_BASE_URL.includes('?') ? '&' : '?'
    return `${APP_BASE_URL}${separator}page=${page}&checkout_ref=${encodeURIComponent(checkoutRef)}`
  }
}

function isSquareCheckoutConfigured() {
  return Boolean(
    SQUARE_ACCESS_TOKEN &&
      SQUARE_LOCATION_ID &&
      SQUARE_WEBHOOK_SIGNATURE_KEY &&
      SQUARE_SUBSCRIPTION_PLAN_ID &&
      APP_BASE_URL
  )
}

function getSquareApiHeaders() {
  return {
    Authorization: `Bearer ${SQUARE_ACCESS_TOKEN}`,
    'Content-Type': 'application/json',
    'Square-Version': '2026-01-22',
  }
}

function parseSquareErrorMessage(data, fallback) {
  const message = Array.isArray(data?.errors)
    ? data.errors
        .map((entry) => entry?.detail || entry?.code || '')
        .filter(Boolean)
        .join('; ')
    : ''

  return message || fallback
}

async function squareApiRequest(endpoint, options = {}) {
  const method = options.method || 'GET'
  const response = await fetch(`${SQUARE_API_BASE_URL}${endpoint}`, {
    method,
    headers: {
      ...getSquareApiHeaders(),
      ...(options.headers || {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })

  const raw = await response.text()
  let data = {}

  if (raw) {
    try {
      data = JSON.parse(raw)
    } catch {
      data = { raw }
    }
  }

  if (!response.ok) {
    const error = new Error(
      parseSquareErrorMessage(data, `Square API request failed with status ${response.status}.`)
    )
    error.status = response.status
    error.data = data
    throw error
  }

  return data
}

let cachedSquareSubscriptionPlanVariationId = null

async function resolveSquareSubscriptionPlanVariationId() {
  if (cachedSquareSubscriptionPlanVariationId) {
    return cachedSquareSubscriptionPlanVariationId
  }

  const configuredId = SQUARE_SUBSCRIPTION_PLAN_ID
  if (!configuredId) {
    throw new Error('SQUARE_SUBSCRIPTION_PLAN_ID is not configured.')
  }

  let object
  try {
    const response = await squareApiRequest(
      `/v2/catalog/object/${encodeURIComponent(configuredId)}`
    )
    object = response?.object
  } catch (error) {
    const detail = error?.data?.errors?.[0]?.detail || error.message
    throw new Error(
      `Square could not find catalog object "${configuredId}". This usually means the ID belongs to a different Square environment (sandbox vs production) than the configured access token, the plan was deleted, or the ID is wrong. Square said: ${detail}`
    )
  }

  if (!object) {
    throw new Error(`Square returned no catalog object for ID "${configuredId}".`)
  }

  if (object.type === 'SUBSCRIPTION_PLAN_VARIATION') {
    cachedSquareSubscriptionPlanVariationId = object.id
    return cachedSquareSubscriptionPlanVariationId
  }

  if (object.type === 'SUBSCRIPTION_PLAN') {
    const variations =
      object.subscription_plan_data?.subscription_plan_variations || []
    const firstUsable = variations.find((variation) => variation?.id) || null
    if (!firstUsable?.id) {
      throw new Error(
        `Square subscription plan "${configuredId}" has no plan variations. Add at least one priced variation to the plan in the Square Dashboard before configuring checkout.`
      )
    }
    cachedSquareSubscriptionPlanVariationId = firstUsable.id
    return cachedSquareSubscriptionPlanVariationId
  }

  throw new Error(
    `Square catalog object "${configuredId}" has type "${object.type}", which is not usable for subscription checkout. Set SQUARE_SUBSCRIPTION_PLAN_ID to a SUBSCRIPTION_PLAN or SUBSCRIPTION_PLAN_VARIATION ID.`
  )
}

async function createSquareEmployerCheckoutLink({ checkoutRef, email, businessName, page }) {
  if (!isSquareCheckoutConfigured()) {
    throw new Error('Square checkout is not configured. Set the Square access token, location ID, subscription plan variation ID, and webhook signature key first.')
  }

  const redirectUrl = buildEmployerPaymentSuccessUrl(checkoutRef, page)
  if (!redirectUrl) {
    throw new Error('Employer payment success URL is not configured.')
  }

  const checkoutOptions = {
    redirect_url: redirectUrl,
    ask_for_shipping_address: false,
  }

  if (SQUARE_SUBSCRIPTION_PLAN_ID) {
    checkoutOptions.subscription_plan_id =
      await resolveSquareSubscriptionPlanVariationId()
  }

  const payload = {
    idempotency_key: crypto.randomUUID(),
    quick_pay: {
      name: businessName || SQUARE_EMPLOYER_PLAN_NAME,
      price_money: {
        amount: SQUARE_EMPLOYER_PLAN_AMOUNT_CENTS,
        currency: SQUARE_EMPLOYER_PLAN_CURRENCY,
      },
      location_id: SQUARE_LOCATION_ID,
    },
    checkout_options: checkoutOptions,
    pre_populated_data: {
      buyer_email: email,
    },
    payment_note: `TarboroJobs employer checkout ref:${checkoutRef}`,
  }

  const response = await squareApiRequest('/v2/online-checkout/payment-links', {
    method: 'POST',
    body: payload,
  })

  return {
    idempotencyKey: payload.idempotency_key,
    redirectUrl,
    paymentLinkId: response?.payment_link?.id || null,
    checkoutUrl: response?.payment_link?.url || null,
    checkoutLongUrl: response?.payment_link?.long_url || null,
    orderId: response?.payment_link?.order_id || null,
  }
}

async function fetchSquarePayment(paymentId) {
  return squareApiRequest(`/v2/payments/${encodeURIComponent(paymentId)}`)
}

// ── Square subscription sync ─────────────────────────────────────────────────
// The webhook only hears about payments, so renewals, failed renewals,
// cancellations and pauses are read back from Square's Subscriptions API:
// right after the first payment, on a full refund, daily for everyone, on
// demand from an employer request, and from the admin Sync button.
const SUBSCRIPTION_GRACE_MS = 3 * 24 * 60 * 60 * 1000
const SUBSCRIPTION_SYNC_MIN_AGE_HOURS = 20
const SUBSCRIPTION_ON_DEMAND_AGE_MS = 24 * 60 * 60 * 1000
const SUBSCRIPTION_ON_DEMAND_THROTTLE_MS = 60 * 60 * 1000
const SQUARE_SUBSCRIPTION_STATUS_MAP = {
  ACTIVE: 'active',
  CANCELED: 'canceled',
  DEACTIVATED: 'canceled',
  PAUSED: 'paused',
  // PENDING is deliberately unmapped: a payment-link subscription can still be
  // PENDING when the first payment lands, and that must not lock out a payer.
}
const SQUARE_LIVE_SUBSCRIPTION_STATUSES = ['ACTIVE', 'PAUSED', 'PENDING']
const EMPLOYER_SUBSCRIPTION_COLUMNS =
  'id, square_customer_id, square_subscription_id, subscription_status, current_period_end, subscription_synced_at'

function isSquareSubscriptionSyncConfigured() {
  return Boolean(SQUARE_ACCESS_TOKEN && SQUARE_SUBSCRIPTION_PLAN_ID)
}

function isSquareBilledEmployer(employer) {
  return Boolean(employer?.square_subscription_id || employer?.square_customer_id)
}

// Square dates are YYYY-MM-DD; a paid-through date covers that whole UTC day.
function squareDateEndOfDayUtc(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? new Date(`${value}T23:59:59.000Z`) : null
}

let cachedSquarePlanVariationIds = null

// Every id a subscription to our plan can carry: the configured id itself
// (when it is a plan variation) plus all variations of it (when it is a plan).
async function getSquarePlanVariationIds() {
  if (cachedSquarePlanVariationIds) return cachedSquarePlanVariationIds
  const response = await squareApiRequest(
    `/v2/catalog/object/${encodeURIComponent(SQUARE_SUBSCRIPTION_PLAN_ID)}`
  )
  const ids = new Set([SQUARE_SUBSCRIPTION_PLAN_ID])
  for (const variation of response?.object?.subscription_plan_data?.subscription_plan_variations || []) {
    if (variation?.id) ids.add(variation.id)
  }
  cachedSquarePlanVariationIds = ids
  return ids
}

// Square's answer for a customer or subscription it has never heard of
// (HTTP 404 / code NOT_FOUND), e.g. a test row with a made-up id. Auth, 5xx
// and transport errors are not this and keep throwing.
function isSquareNotFound(error) {
  return error?.status === 404 || (error?.data?.errors || []).some((entry) => entry?.code === 'NOT_FOUND')
}

// Stores what Square says about one employer's subscription. Any Square or
// network error throws before anything is written, so an outage or a bad
// token never changes anyone's access. Returns { updated, status,
// squareStatus, message } (message set when nothing could be mapped).
async function syncEmployerSubscription(employer) {
  const employerId = Number(employer?.id)
  if (!employerId || !isSquareBilledEmployer(employer)) {
    return { updated: false, message: 'Employer has no Square customer or subscription.' }
  }
  if (!isSquareSubscriptionSyncConfigured()) {
    return { updated: false, message: 'Square subscription sync is not configured.' }
  }

  // Square answered but access stays as-is for the owner to decide; mark it
  // checked so the scheduled run does not retry hourly.
  const leaveAsIs = async (message) => {
    await pool.query(`UPDATE employers SET subscription_synced_at = CURRENT_TIMESTAMP WHERE id = ?`, [employerId])
    console.warn(`[subscriptions] employer ${employerId}: ${message} Access left as-is.`)
    return { updated: false, message }
  }

  let subscriptions
  try {
    if (employer.square_customer_id) {
      const filter = { customer_ids: [employer.square_customer_id] }
      if (SQUARE_LOCATION_ID) filter.location_ids = [SQUARE_LOCATION_ID]
      // ponytail: first page only; one customer has a handful of subscriptions.
      const response = await squareApiRequest('/v2/subscriptions/search', {
        method: 'POST',
        body: { query: { filter } },
      })
      subscriptions = response?.subscriptions || []
    } else {
      const response = await squareApiRequest(
        `/v2/subscriptions/${encodeURIComponent(employer.square_subscription_id)}`
      )
      subscriptions = response?.subscription ? [response.subscription] : []
    }
  } catch (error) {
    if (!isSquareNotFound(error)) throw error
    return leaveAsIs(`Square has no record of this employer's ${employer.square_customer_id ? 'customer' : 'subscription'} (${error.message}).`)
  }

  const planIds = await getSquarePlanVariationIds()
  const isLive = (entry) => (SQUARE_LIVE_SUBSCRIPTION_STATUSES.includes(entry.status) ? 1 : 0)
  const subscription = subscriptions
    .filter((entry) => planIds.has(entry?.plan_variation_id) || planIds.has(entry?.plan_id))
    .sort((a, b) => isLive(b) - isLive(a) || String(b.created_at || '').localeCompare(String(a.created_at || '')))[0]
  const nextStatus = SQUARE_SUBSCRIPTION_STATUS_MAP[subscription?.status]

  if (!subscription || !nextStatus) {
    // Nothing maps.
    return leaveAsIs(
      subscription
        ? `Square subscription ${subscription.id} has unknown status "${subscription.status}".`
        : 'Square has no subscription to our plan for this customer.'
    )
  }

  // An ACTIVE subscription with a future canceled_date stays 'active' until
  // Square flips it to CANCELED; its paid-through date (plus grace) still
  // bounds access if the sync stops running.
  const periodEnd =
    squareDateEndOfDayUtc(subscription.charged_through_date) ||
    (subscription.canceled_date ? parseDateOrNull(`${subscription.canceled_date}T00:00:00.000Z`) : null)
  const subscriptionId = subscription.id || employer.square_subscription_id || null
  const oldPeriodEnd = parseDateOrNull(employer.current_period_end)

  await pool.query(
    `
    UPDATE employers
    SET
      square_subscription_id = ?,
      subscription_status = ?,
      current_period_end = COALESCE(?, current_period_end),
      subscription_synced_at = CURRENT_TIMESTAMP
    WHERE id = ?
    `,
    [subscriptionId, nextStatus, periodEnd, employerId]
  )

  const updated =
    (employer.subscription_status || 'active') !== nextStatus ||
    (employer.square_subscription_id || null) !== subscriptionId ||
    (!!periodEnd && periodEnd.getTime() !== oldPeriodEnd?.getTime())
  if (updated) {
    console.log(`[subscriptions] employer ${employerId}: Square ${subscription.status} -> ${nextStatus}, paid through ${subscription.charged_through_date || 'unknown'}`)
  }
  return { updated, status: nextStatus, squareStatus: subscription.status }
}

// First payment: learn the subscription id and paid-through date right away.
// Called after finalize has committed; the webhook never waits on it.
async function syncEmployerAfterCheckout(checkout, payment) {
  const [rows] = await pool.query(
    `SELECT ${EMPLOYER_SUBSCRIPTION_COLUMNS} FROM employers WHERE email = ? ORDER BY id DESC LIMIT 1`,
    [normalizeEmail(checkout.email)]
  )
  const employer = rows[0]
  if (!employer) return null
  // A returning (already onboarded) employer is not re-finalized, so its
  // customer id is only learned here.
  if (!employer.square_customer_id && payment.customer_id) {
    await pool.query(
      `UPDATE employers SET square_customer_id = ? WHERE id = ? AND (square_customer_id IS NULL OR square_customer_id = '')`,
      [payment.customer_id, employer.id]
    )
    employer.square_customer_id = payment.customer_id
  }
  return syncEmployerSubscription(employer)
}

function isFullyRefundedPayment(payment) {
  const amount = Number(payment?.amount_money?.amount || 0)
  return amount > 0 && Number(payment?.refunded_money?.amount || 0) >= amount
}

// A full refund may mean the owner canceled in Square; re-read the truth.
// Never revokes on its own: a still-ACTIVE subscription is only logged.
async function syncEmployersForRefundedPayment(payment) {
  const [rows] = await pool.query(
    `SELECT ${EMPLOYER_SUBSCRIPTION_COLUMNS} FROM employers WHERE square_customer_id = ?`,
    [payment.customer_id]
  )
  for (const employer of rows) {
    const result = await syncEmployerSubscription(employer)
    if (result.squareStatus === 'ACTIVE') {
      console.warn(`[subscriptions] payment ${payment.id} was fully refunded but employer ${employer.id}'s Square subscription is still ACTIVE; access left as-is for the owner to decide.`)
    }
  }
}

const subscriptionSyncAttempts = new Map()

// Cheap on-demand check from employer requests: never blocks the request,
// at most once per employer per hour.
function maybeSyncEmployerSubscriptionInBackground(employer) {
  const employerId = Number(employer?.id)
  if (!employerId || !isSquareSubscriptionSyncConfigured() || !isSquareBilledEmployer(employer)) return
  const syncedAt = parseDateOrNull(employer.subscription_synced_at)
  const stale = !syncedAt || Date.now() - syncedAt.getTime() > SUBSCRIPTION_ON_DEMAND_AGE_MS
  // Locked-out employers re-check sooner so a fixed card restores access.
  if (!stale && isEmployerEligible(employer)) return
  const lastAttempt = subscriptionSyncAttempts.get(employerId)
  if (lastAttempt && Date.now() - lastAttempt < SUBSCRIPTION_ON_DEMAND_THROTTLE_MS) return
  subscriptionSyncAttempts.set(employerId, Date.now())
  syncEmployerSubscription(employer).catch((error) =>
    console.error(`[subscriptions] on-demand sync for employer ${employerId} failed; access left as-is:`, error?.message || error)
  )
}

function verifySquareWebhookSignature({ signatureHeader, requestBody }) {
  if (!SQUARE_WEBHOOK_SIGNATURE_KEY || !SQUARE_WEBHOOK_NOTIFICATION_URL) {
    return false
  }

  const hmac = crypto.createHmac('sha256', SQUARE_WEBHOOK_SIGNATURE_KEY)
  hmac.update(`${SQUARE_WEBHOOK_NOTIFICATION_URL}${requestBody}`)
  const digest = hmac.digest('base64')

  const actual = Buffer.from(String(signatureHeader || ''), 'utf8')
  const expected = Buffer.from(digest, 'utf8')

  if (actual.length !== expected.length) {
    return false
  }

  return crypto.timingSafeEqual(actual, expected)
}

function extractCheckoutRef(value) {
  const normalized = safeTrim(value, 120)
  if (!normalized) return null

  const match = normalized.match(/checkout\s*ref:([a-zA-Z0-9_-]+)/i)
  if (match?.[1]) return match[1]

  if (/^tj_[a-zA-Z0-9_-]+$/.test(normalized)) {
    return normalized
  }

  return null
}

async function getPendingCheckoutByRef(checkoutRef) {
  const [rows] = await pool.query(
    `
    SELECT *
    FROM employer_pending_checkouts
    WHERE checkout_ref = ?
    LIMIT 1
    `,
    [checkoutRef]
  )

  return rows[0] || null
}

function mapCheckoutStatus(row) {
  if (!row) {
    return {
      success: false,
      status: 'not_found',
      error: 'Checkout session not found.',
    }
  }

  if (row.checkout_status === 'already_onboarded') {
    return {
      success: true,
      status: 'already_onboarded',
      payment_verified: true,
      login_url: '/?page=employer-login',
      message: 'This employer account is already set up. Log in to continue.',
    }
  }

  if (row.onboarding_token) {
    return {
      success: true,
      status: 'ready',
      payment_verified: true,
      onboarding_url: buildOnboardingUrl(row.onboarding_token),
      email_sent: !!row.email_sent,
      message: 'Payment verified. Your onboarding link is ready.',
    }
  }

  if (row.payment_status === 'paid') {
    return {
      success: true,
      status: 'payment_verified',
      payment_verified: true,
      message: 'Payment verified. Finalizing your onboarding link now.',
    }
  }

  if (['failed', 'canceled'].includes(String(row.payment_status || '').toLowerCase())) {
    return {
      success: true,
      status: 'payment_failed',
      payment_verified: false,
      message: 'Square did not confirm a completed payment for this checkout.',
    }
  }

  return {
    success: true,
    status: 'awaiting_payment_confirmation',
    payment_verified: false,
    message: 'We are still waiting for Square to confirm the payment.',
  }
}

async function finalizeVerifiedEmployerCheckoutByRef(checkoutRef) {
  if (!checkoutRef) return null

  const connection = await pool.getConnection()
  let result = null

  try {
    await connection.beginTransaction()

    const [checkoutRows] = await connection.query(
      `
      SELECT *
      FROM employer_pending_checkouts
      WHERE checkout_ref = ?
      LIMIT 1
      FOR UPDATE
      `,
      [checkoutRef]
    )

    const checkout = checkoutRows[0]
    if (!checkout) {
      await connection.rollback()
      return null
    }

    // Plan upgrades of an existing employer are applied by applyPlanUpgrade.
    if (checkout.checkout_status === 'already_onboarded' || checkout.employer_id) {
      await connection.commit()
      return checkout
    }

    if (checkout.onboarding_token) {
      await connection.commit()
      return checkout
    }

    if (checkout.payment_status !== 'paid') {
      await connection.commit()
      return checkout
    }

    const email = normalizeEmail(checkout.email)
    const businessName = toNullableString(checkout.business_name, 255)

    let employerId = null
    const [existingEmployers] = await connection.query(
      `
      SELECT id, onboarding_completed
      FROM employers
      WHERE email = ?
      ORDER BY id DESC
      LIMIT 1
      FOR UPDATE
      `,
      [email]
    )

    if (existingEmployers.length > 0) {
      const employer = existingEmployers[0]
      employerId = employer.id

      if (employer.onboarding_completed) {
        await connection.query(
          `
          UPDATE employer_pending_checkouts
          SET checkout_status = 'already_onboarded', completed_at = CURRENT_TIMESTAMP
          WHERE id = ?
          `,
          [checkout.id]
        )

        await connection.commit()
        return {
          ...checkout,
          checkout_status: 'already_onboarded',
        }
      }

      await connection.query(
        `
        UPDATE employers
        SET
          business_name = COALESCE(?, business_name),
          square_customer_id = COALESCE(?, square_customer_id),
          square_subscription_id = COALESCE(?, square_subscription_id),
          subscription_status = 'active',
          access_status = 'pending',
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        `,
        [businessName, checkout.square_customer_id, checkout.square_subscription_id, employerId]
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
          onboarding_completed,
          status
        )
        VALUES (?, ?, ?, ?, 'active', 'pending', 0, 'new')
        `,
        [businessName, email, checkout.square_customer_id, checkout.square_subscription_id]
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
      [
        employerId,
        token,
        email,
        checkout.square_customer_id,
        checkout.square_subscription_id,
        expiresAt,
      ]
    )

    await connection.query(
      `
      UPDATE employer_pending_checkouts
      SET
        onboarding_token_id = ?,
        onboarding_token = ?,
        onboarding_expires_at = ?,
        checkout_status = 'ready',
        completed_at = CURRENT_TIMESTAMP
      WHERE id = ?
      `,
      [insertToken.insertId, token, expiresAt, checkout.id]
    )

    await connection.commit()

    let emailSent = false
    try {
      emailSent = await sendOnboardingEmail({
        email,
        businessName,
        token,
      })
    } catch (mailError) {
      console.error('Secure employer checkout onboarding email error:', mailError)
    }

    if (emailSent) {
      await pool.query(
        `UPDATE employer_pending_checkouts SET email_sent = 1 WHERE id = ?`,
        [checkout.id]
      )
    }

    result = {
      ...checkout,
      onboarding_token_id: insertToken.insertId,
      onboarding_token: token,
      onboarding_expires_at: expiresAt,
      checkout_status: 'ready',
      email_sent: emailSent ? 1 : checkout.email_sent,
    }
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }

  return result
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
      name: 'industry',
      sql: "ADD COLUMN industry VARCHAR(255) NULL DEFAULT NULL AFTER city",
    },
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

async function ensureResumeChecksTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS resume_checks (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      public_token VARCHAR(128) NOT NULL,
      email VARCHAR(255) NULL DEFAULT NULL,
      full_name VARCHAR(255) NULL DEFAULT NULL,
      target_job_title VARCHAR(255) NULL DEFAULT NULL,
      job_post_id INT NULL DEFAULT NULL,
      original_filename VARCHAR(255) NULL DEFAULT NULL,
      extracted_text MEDIUMTEXT NULL,
      preview_score INT NULL DEFAULT NULL,
      full_score INT NULL DEFAULT NULL,
      preview_report JSON NULL,
      full_report JSON NULL,
      payment_status ENUM('free_preview','pending','paid','failed') NOT NULL DEFAULT 'free_preview',
      square_payment_id VARCHAR(255) NULL DEFAULT NULL,
      square_payment_link_id VARCHAR(255) NULL DEFAULT NULL,
      square_order_id VARCHAR(255) NULL DEFAULT NULL,
      square_checkout_url TEXT NULL,
      paid_at DATETIME NULL DEFAULT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_resume_checks_public_token (public_token),
      KEY idx_resume_checks_email (email),
      KEY idx_resume_checks_status (payment_status),
      KEY idx_resume_checks_order (square_order_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)
}

async function ensureJobScraperColumns() {
  await pool.query(`ALTER TABLE job_posts ADD COLUMN IF NOT EXISTS source VARCHAR(50) DEFAULT 'employer'`).catch(() => {})
  await pool.query(`ALTER TABLE job_posts ADD COLUMN IF NOT EXISTS external_id VARCHAR(255)`).catch(() => {})
  await pool.query(`ALTER TABLE job_posts ADD COLUMN IF NOT EXISTS source_url VARCHAR(500)`).catch(() => {})
  try {
    await pool.query(`ALTER TABLE job_posts ADD UNIQUE KEY uq_job_source (source, external_id)`)
  } catch {}
}

async function tableColumnExists(tableName, columnName) {
  const [rows] = await pool.query(
    `
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = COALESCE(NULLIF(?, ''), DATABASE())
      AND TABLE_NAME = ?
      AND COLUMN_NAME = ?
    LIMIT 1
    `,
    [DB_NAME, tableName, columnName]
  )

  return rows.length > 0
}

// Payment, generation and AI cost columns shared by the paid AI product
// tables (cover_letter_requests, interview_prep_requests).
const AI_ORDER_COLUMNS = [
  { name: 'square_checkout_url', sql: 'ADD COLUMN square_checkout_url TEXT NULL' },
  { name: 'square_payment_id', sql: 'ADD COLUMN square_payment_id VARCHAR(255) NULL DEFAULT NULL' },
  { name: 'paid_at', sql: 'ADD COLUMN paid_at DATETIME NULL DEFAULT NULL' },
  { name: 'ai_status', sql: 'ADD COLUMN ai_status VARCHAR(32) NULL DEFAULT NULL' },
  { name: 'ai_attempts', sql: 'ADD COLUMN ai_attempts INT NOT NULL DEFAULT 0' },
  { name: 'ai_error', sql: 'ADD COLUMN ai_error TEXT NULL' },
  { name: 'ai_started_at', sql: 'ADD COLUMN ai_started_at DATETIME NULL DEFAULT NULL' },
  { name: 'ai_completed_at', sql: 'ADD COLUMN ai_completed_at DATETIME NULL DEFAULT NULL' },
  { name: 'ai_input_tokens', sql: 'ADD COLUMN ai_input_tokens INT NOT NULL DEFAULT 0' },
  { name: 'ai_output_tokens', sql: 'ADD COLUMN ai_output_tokens INT NOT NULL DEFAULT 0' },
  { name: 'ai_cost_cents', sql: 'ADD COLUMN ai_cost_cents DECIMAL(10,4) NOT NULL DEFAULT 0' },
]

// A failed ALTER is logged and skipped rather than stopping startup: only
// the AI order routes need these columns, and they fail on their own.
async function ensureAiOrderColumns(tableName) {
  for (const column of AI_ORDER_COLUMNS) {
    try {
      const exists = await tableColumnExists(tableName, column.name)
      if (!exists) {
        await pool.query(`ALTER TABLE ${tableName} ${column.sql}`)
      }
    } catch (error) {
      console.error(`STARTUP: could not add ${tableName}.${column.name}; AI orders may fail:`, error?.message || error)
    }
  }
}

// is_admin: admin rights are a stored flag, not "email is in ADMIN_EMAILS".
// token_version: bumped on password change/reset to revoke older tokens.
// If either ALTER fails, startup continues but every employer/admin session
// query selects the missing column and errors, so auth fails closed.
async function ensureEmployerUserAuthColumns() {
  try {
    if (!(await tableColumnExists('employer_users', 'token_version'))) {
      await pool.query('ALTER TABLE employer_users ADD COLUMN token_version INT NOT NULL DEFAULT 0')
    }

    if (!(await tableColumnExists('employer_users', 'is_admin'))) {
      await pool.query('ALTER TABLE employer_users ADD COLUMN is_admin TINYINT(1) NOT NULL DEFAULT 0')
      // One-time carry-over, only on the startup that creates the column:
      // whoever holds an ADMIN_EMAILS address right now stays admin. Later
      // email changes never grant admin; set is_admin by hand in the DB.
      if (ADMIN_EMAILS.length) {
        await pool.query('UPDATE employer_users SET is_admin = 1 WHERE LOWER(email) IN (?)', [ADMIN_EMAILS])
      }
    }
  } catch (error) {
    console.error('STARTUP: could not add employer_users auth columns; employer and admin sign-in will fail until fixed:', error?.message || error)
  }
}

// subscription_synced_at: when Square was last asked about this employer's
// subscription. If the ALTER fails, employer session queries select the
// missing column and error, so employer sign-in fails closed.
async function ensureEmployerSubscriptionSyncColumn() {
  try {
    if (!(await tableColumnExists('employers', 'subscription_synced_at'))) {
      await pool.query('ALTER TABLE employers ADD COLUMN subscription_synced_at DATETIME NULL DEFAULT NULL')
    }
  } catch (error) {
    console.error('STARTUP: could not add employers.subscription_synced_at; employer sign-in will fail until fixed:', error?.message || error)
  }
}

async function ensureCoverLetterTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cover_letter_requests (
      id INT AUTO_INCREMENT PRIMARY KEY,
      public_token VARCHAR(64) NOT NULL UNIQUE,
      job_title VARCHAR(255),
      job_description TEXT,
      user_name VARCHAR(255),
      user_background TEXT,
      letter_text LONGTEXT,
      payment_status VARCHAR(32) DEFAULT 'pending',
      square_order_id VARCHAR(255),
      price_cents INT DEFAULT 499,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `)
  await ensureAiOrderColumns('cover_letter_requests')
}

async function ensureInterviewPrepTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS interview_prep_requests (
      id INT AUTO_INCREMENT PRIMARY KEY,
      public_token VARCHAR(64) NOT NULL UNIQUE,
      job_title VARCHAR(255),
      job_description TEXT,
      questions_json LONGTEXT,
      payment_status VARCHAR(32) DEFAULT 'pending',
      square_order_id VARCHAR(255),
      price_cents INT DEFAULT 499,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `)
  await ensureAiOrderColumns('interview_prep_requests')
}

async function ensureEmployerPendingCheckoutsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS employer_pending_checkouts (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      checkout_ref VARCHAR(64) NOT NULL,
      idempotency_key VARCHAR(64) NOT NULL,
      email VARCHAR(255) NOT NULL,
      business_name VARCHAR(255) NULL DEFAULT NULL,
      plan_key VARCHAR(64) NOT NULL DEFAULT 'employer-monthly',
      amount_cents INT NOT NULL,
      currency VARCHAR(12) NOT NULL DEFAULT 'USD',
      square_payment_link_id VARCHAR(255) NULL DEFAULT NULL,
      square_order_id VARCHAR(255) NULL DEFAULT NULL,
      square_checkout_url TEXT NULL,
      square_checkout_long_url TEXT NULL,
      square_payment_id VARCHAR(255) NULL DEFAULT NULL,
      square_customer_id VARCHAR(255) NULL DEFAULT NULL,
      square_subscription_id VARCHAR(255) NULL DEFAULT NULL,
      square_merchant_id VARCHAR(255) NULL DEFAULT NULL,
      square_event_id VARCHAR(255) NULL DEFAULT NULL,
      payment_status VARCHAR(32) NOT NULL DEFAULT 'pending',
      checkout_status VARCHAR(32) NOT NULL DEFAULT 'created',
      email_sent TINYINT(1) NOT NULL DEFAULT 0,
      onboarding_token_id BIGINT UNSIGNED NULL DEFAULT NULL,
      onboarding_token VARCHAR(255) NULL DEFAULT NULL,
      onboarding_expires_at DATETIME NULL DEFAULT NULL,
      paid_at DATETIME NULL DEFAULT NULL,
      completed_at DATETIME NULL DEFAULT NULL,
      expires_at DATETIME NULL DEFAULT NULL,
      last_error TEXT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_employer_pending_checkouts_ref (checkout_ref),
      KEY idx_employer_pending_checkouts_email (email),
      KEY idx_employer_pending_checkouts_status (payment_status, checkout_status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)
  // Set when a signed-in pay-per-post employer buys the monthly plan: the
  // webhook then converts that employer instead of onboarding a new one.
  try {
    if (!(await tableColumnExists('employer_pending_checkouts', 'employer_id'))) {
      await pool.query('ALTER TABLE employer_pending_checkouts ADD COLUMN employer_id BIGINT UNSIGNED NULL DEFAULT NULL')
    }
  } catch (error) {
    console.error('STARTUP: could not add employer_pending_checkouts.employer_id; plan upgrades will fail until fixed:', error?.message || error)
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

// Hashing first gives equal-length buffers, so the compare time does not
// depend on where (or whether) the strings differ.
function timingSafeEqualStrings(a, b) {
  const hashA = crypto.createHash('sha256').update(String(a)).digest()
  const hashB = crypto.createHash('sha256').update(String(b)).digest()
  return crypto.timingSafeEqual(hashA, hashB)
}

async function requireAdminAuth(req, res, next) {
  const providedKey = getAdminKeyFromRequest(req)

  if (ADMIN_API_KEY && providedKey && timingSafeEqualStrings(providedKey, ADMIN_API_KEY)) {
    req.admin = {
      authenticated: true,
      is_admin: true,
      auth_type: 'api_key',
      email: null,
    }
    return next()
  }

  const authHeader = req.headers.authorization || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : ''

  if (token) {
    try {
      const decoded = verifyEmployerJwt(token)
      const session = await loadEmployerSessionByUserId(decoded.user_id)

      // Admin rights come from the stored flag, never from the (editable) email.
      if (
        session &&
        Number(session.employer_id) === Number(decoded.employer_id) &&
        tokenVersionMatches(decoded, session) &&
        session.is_active &&
        session.is_admin
      ) {
        req.admin = {
          authenticated: true,
          is_admin: true,
          auth_type: 'employer_session',
          employer_user_id: Number(session.id),
          employer_id: Number(session.employer_id),
          email: session.email,
          business_name: session.business_name,
        }
        return next()
      }
    } catch (error) {
      // fall through to unauthorized response
    }
  }

  return res.status(401).json({
    success: false,
    error: 'Unauthorized admin request.',
  })
}

// Employer (and admin) tokens carry no audience or type. Job seeker tokens are
// signed with the same secret but always have both (see seekers.js), so they
// are refused here even if someone gets one minted with employer-looking claims.
function verifyEmployerJwt(token) {
  const decoded = jwt.verify(token, JWT_SECRET)
  if (decoded.aud !== undefined || decoded.typ !== undefined) {
    throw new Error('Not an employer token.')
  }
  return decoded
}

function tokenVersionMatches(decoded, session) {
  return (decoded.tv ?? 0) === Number(session.token_version || 0)
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
      eu.is_admin,
      eu.token_version,
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
      e.square_customer_id,
      e.square_subscription_id,
      e.subscription_synced_at,
      e.plan,
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

    const decoded = verifyEmployerJwt(token)
    const session = await loadEmployerSessionByUserId(decoded.user_id)

    if (!session || !tokenVersionMatches(decoded, session)) {
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

    const isAdmin = !!session.is_admin

    req.auth = {
      token,
      user_id: Number(session.id),
      employer_id: Number(session.employer_id),
      email: session.email,
      is_admin: isAdmin,
      employer_user: {
        id: Number(session.id),
        employer_id: Number(session.employer_id),
        email: session.email,
        is_active: !!session.is_active,
        is_admin: isAdmin,
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
        plan: session.plan || 'subscription',
        has_subscription_features: hasSubscriptionFeatures(session),
      },
      // Kept apart from employer, which /me returns to the browser.
      billing: {
        id: Number(session.employer_id),
        square_customer_id: session.square_customer_id,
        square_subscription_id: session.square_subscription_id,
        subscription_synced_at: session.subscription_synced_at,
      },
      admin: {
        authenticated: isAdmin,
        is_admin: isAdmin,
        auth_type: isAdmin ? 'employer_session' : null,
        email: isAdmin ? session.email : null,
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

  const employer = { ...req.auth.employer, ...req.auth.billing }
  maybeSyncEmployerSubscriptionInBackground(employer)

  if (!isEmployerEligible(employer)) {
    return res.status(403).json({
      success: false,
      error: 'Your employer account is not eligible for this action.',
    })
  }

  next()
}

// After requireEligibleEmployer: features only the $49/month plan includes.
function requireSubscriptionEmployer(req, res, next) {
  if (!hasSubscriptionFeatures({ ...req.auth.employer, ...req.auth.billing })) {
    return res.status(403).json({
      success: false,
      error: 'Applicant search and the candidate pipeline are part of the $49/month employer plan.',
      upgrade_required: true,
    })
  }
  next()
}

function normalizeCandidateStatus(status) {
  if (status === undefined || status === null || status === '') return null

  const normalized = String(status).trim().toLowerCase()
  if (!normalized) return null

  for (const [canonical, aliases] of Object.entries(CANDIDATE_STATUS_ALIASES)) {
    if (aliases.includes(normalized)) {
      return canonical
    }
  }

  return normalized
}

function buildCandidateStatusWhereClause(columnName, candidateStatus) {
  const normalized = normalizeCandidateStatus(candidateStatus)

  if (!normalized) {
    return null
  }

  if (normalized === 'new') {
    return {
      clause: `(${columnName} IS NULL OR ${columnName} IN (?, ?))`,
      params: CANDIDATE_STATUS_SQL_VALUES.new,
    }
  }

  const values = CANDIDATE_STATUS_SQL_VALUES[normalized] || [normalized]
  const placeholders = values.map(() => '?').join(', ')

  return {
    clause: `${columnName} IN (${placeholders})`,
    params: values,
  }
}

function normalizeDateTime(value) {
  return parseDateOrNull(value)
}

function formatCandidateActionRow(row) {
  return {
    id: row.id,
    employer_id: row.employer_id,
    job_seeker_id: row.job_seeker_id,
    status: normalizeCandidateStatus(row.status) || 'new',
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
      posting_guidelines_accepted_at,
      source_url
    FROM job_posts
    WHERE id = ?
    LIMIT 1
    `,
    [jobId]
  )

  if (!rows.length) return null
  if (Number(rows[0].employer_id) !== Number(employerId)) return false
  // Scraped jobs (claimed employers) are rewritten by the nightly scraper, so
  // their owner may feature them but never edit, close or delete them.
  if (rows[0].source_url) return false
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
      error: 'Health check failed.',
    })
  }
})

// The limiter runs after multer so a 429 still drains the body; the upload it
// rejected is then deleted by discardUploadOnError.
app.post('/api/jobseekers', discardUploadOnError, upload.single('resume_file'), rateLimitByIp(consumeJobSeekerUploadRate, 'Too many submissions. Please try again later.'), async (req, res) => {
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
      error: 'Failed to submit resume.',
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
        source_url: row.source_url,
        status: row.status,
        posted: row.published_at || row.created_at,
        expires_at: row.expires_at,
        featured: isFeatured(row),
        claimable: await featured.isClaimable(row),
      },
    })
  } catch (error) {
    console.error('GET /api/jobposts/:id error:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to fetch job posting.',
    })
  }
})

app.post('/api/jobposts/:id/apply', discardUploadOnError, upload.single('resume_file'), rateLimitByIp(consumeApplyUploadRate, 'Too many applications. Please try again later.'), async (req, res) => {
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

    if (job.source_url) {
      return res.status(400).json({
        success: false,
        error: 'This job accepts applications on the employer\'s official site, not through TarboroJobs.',
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

    // Same address on the same job (guest or one-click) is one candidate.
    const [earlier] = await pool.query(
      'SELECT id FROM job_seekers WHERE job_post_id = ? AND LOWER(email) = ? LIMIT 1',
      [job.id, email.toLowerCase()]
    )
    if (earlier.length) {
      return res.json({ success: true, duplicate: true, message: "You've already applied to this job." })
    }

    const { id, resumeFileUrl, ats } = await createJobApplication(
      job,
      { fullName, email, phone, city, desiredJobTitle, employmentType, skills, applicantNote },
      { path: req.file.path, filename: req.file.filename },
      // The saved application points at the PDF now; keep it even if a later step fails.
      () => { req.keepUpload = true }
    )

    res.json({
      success: true,
      id,
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
      error: 'Failed to submit application.',
    })
  }
})

// One application to an employer-posted job: the job_seekers row the employer
// dashboard lists plus its 'new' candidate action. The guest apply form and
// job seeker one-click apply (seekers.js) both create applications here, so
// employers see them the same way. onSaved runs as soon as the row points at
// the PDF, before anything that could still fail.
async function createJobApplication(job, applicant, resumeFile, onSaved = () => {}) {
  const { fullName, email, phone, city, desiredJobTitle, employmentType, skills, applicantNote } = applicant
  const pdfResumeText = await extractPdfTextFromFile(resumeFile.path)
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
  const resumeFileUrl = `/uploads/resumes/${resumeFile.filename}`

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
  onSaved()

  await pool.query(
    `
    INSERT INTO employer_candidate_actions
    (
      employer_id,
      job_seeker_id,
      status,
      notes
    )
    VALUES (?, ?, ?, ?)
    `,
    [job.employer_id, result.insertId, 'new', null]
  )

  return { id: result.insertId, resumeFileUrl, ats }
}

// One Square subscription checkout link plus its pending row; shared by
// start-checkout (new employer) and upgrade-checkout (existing employer).
async function createPendingEmployerCheckout({ email, businessName, page }) {
  const checkoutRef = `tj_${crypto.randomBytes(12).toString('hex')}`
  const squareCheckout = await createSquareEmployerCheckoutLink({
    checkoutRef,
    email,
    businessName,
    page,
  })

  if (!squareCheckout.checkoutUrl || !squareCheckout.orderId) return null

  await pool.query(
    `
    INSERT INTO employer_pending_checkouts
    (
      checkout_ref,
      idempotency_key,
      email,
      business_name,
      plan_key,
      amount_cents,
      currency,
      square_payment_link_id,
      square_order_id,
      square_checkout_url,
      square_checkout_long_url,
      payment_status,
      checkout_status,
      expires_at
    )
    VALUES (?, ?, ?, ?, 'employer-monthly', ?, ?, ?, ?, ?, ?, 'pending', 'created', ?)
    `,
    [
      checkoutRef,
      squareCheckout.idempotencyKey,
      email,
      businessName,
      SQUARE_EMPLOYER_PLAN_AMOUNT_CENTS,
      SQUARE_EMPLOYER_PLAN_CURRENCY,
      squareCheckout.paymentLinkId,
      squareCheckout.orderId,
      squareCheckout.checkoutUrl,
      squareCheckout.checkoutLongUrl,
      addDays(2),
    ]
  )

  return { checkoutRef, squareCheckout }
}

app.post('/api/employer-plan/start-checkout', async (req, res) => {
  try {
    if (!isSquareCheckoutConfigured()) {
      return res.status(503).json({
        success: false,
        error: 'Square checkout is not configured. Set the Square access token, location ID, subscription plan variation ID, and webhook signature key first.',
      })
    }

    const email = normalizeEmail(req.body.email)
    const businessName = toNullableString(req.body.business_name, 255)

    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Business email is required to start checkout.',
      })
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({
        success: false,
        error: 'A valid business email is required.',
      })
    }

    const [existingEmployers] = await pool.query(
      `
      SELECT id, onboarding_completed
      FROM employers
      WHERE email = ?
      ORDER BY id DESC
      LIMIT 1
      `,
      [email]
    )

    if (existingEmployers.length > 0 && existingEmployers[0].onboarding_completed) {
      return res.status(409).json({
        success: false,
        error: 'This email already belongs to an employer account. Please log in instead.',
      })
    }

    const created = await createPendingEmployerCheckout({ email, businessName })
    if (!created) {
      return res.status(500).json({
        success: false,
        error: 'Square did not return a valid checkout session.',
      })
    }
    const { checkoutRef, squareCheckout } = created

    res.json({
      success: true,
      checkout_ref: checkoutRef,
      checkout_url: squareCheckout.checkoutUrl,
      checkout_long_url: squareCheckout.checkoutLongUrl,
      redirect_url: squareCheckout.redirectUrl,
      message: 'Secure Square checkout created successfully.',
    })
  } catch (error) {
    console.error('POST /api/employer-plan/start-checkout error:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to start secure employer checkout.',
    })
  }
})

// A signed-in pay-per-post employer switching to the $49/month plan: the same
// Square subscription link as start-checkout, but the pending row carries
// employer_id so the webhook converts this employer (applyPlanUpgrade).
app.post('/api/employer/plan/upgrade-checkout', requireEmployerAuth, async (req, res) => {
  try {
    const employer = { ...req.auth.employer, ...req.auth.billing }
    if (
      employer.plan !== 'pay_per_post' ||
      !employer.onboarding_completed ||
      employer.access_status !== 'active' ||
      hasSubscriptionFeatures(employer)
    ) {
      return res.status(409).json({
        success: false,
        error: 'Only active pay-per-post accounts can switch to the monthly plan.',
      })
    }

    if (!isSquareCheckoutConfigured()) {
      return res.status(503).json({ success: false, error: 'Plan checkout is not available right now.' })
    }

    // Reuse an unpaid link so a double click cannot buy two subscriptions.
    const [open] = await pool.query(
      `
      SELECT square_checkout_url
      FROM employer_pending_checkouts
      WHERE employer_id = ? AND checkout_status = 'created' AND payment_status = 'pending'
        AND expires_at > CURRENT_TIMESTAMP AND square_checkout_url IS NOT NULL
      ORDER BY id DESC
      LIMIT 1
      `,
      [req.auth.employer_id]
    )
    if (open[0]) return res.json({ success: true, checkout_url: open[0].square_checkout_url })

    const created = await createPendingEmployerCheckout({
      email: normalizeEmail(employer.email),
      businessName: employer.business_name,
      page: 'employer-plan-upgraded',
    })
    if (!created) {
      return res.status(500).json({ success: false, error: 'Square did not return a valid checkout session.' })
    }
    await pool.query(`UPDATE employer_pending_checkouts SET employer_id = ? WHERE checkout_ref = ?`, [
      req.auth.employer_id,
      created.checkoutRef,
    ])

    res.json({ success: true, checkout_url: created.squareCheckout.checkoutUrl })
  } catch (error) {
    console.error('POST /api/employer/plan/upgrade-checkout error:', error)
    res.status(500).json({ success: false, error: 'Could not start the plan checkout. Please try again.' })
  }
})

app.get('/api/employer-plan/checkout-status', async (req, res) => {
  try {
    const checkoutRef = safeTrim(req.query.checkout_ref, 64)
    if (!checkoutRef) {
      return res.status(400).json({
        success: false,
        error: 'checkout_ref is required.',
      })
    }

    let checkout = await getPendingCheckoutByRef(checkoutRef)
    if (!checkout) {
      return res.status(404).json({
        success: false,
        error: 'Checkout session not found.',
      })
    }

    if (checkout.payment_status === 'paid' && !checkout.onboarding_token) {
      try {
        checkout = await finalizeVerifiedEmployerCheckoutByRef(checkoutRef)
      } catch (finalizeError) {
        console.error('GET /api/employer-plan/checkout-status finalize error:', finalizeError)
      }
    }

    res.json(mapCheckoutStatus(checkout))
  } catch (error) {
    console.error('GET /api/employer-plan/checkout-status error:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve checkout status.',
    })
  }
})

app.post('/api/square/webhook', async (req, res) => {
  try {
    const signatureHeader = req.headers['x-square-hmacsha256-signature']
    const requestBody = req.rawBody || JSON.stringify(req.body || {})

    if (!verifySquareWebhookSignature({ signatureHeader, requestBody })) {
      return res.status(403).json({
        success: false,
        error: 'Invalid Square webhook signature.',
      })
    }

    const event = req.body || {}
    const eventType = safeTrim(event.type, 120)

    if (!['payment.updated', 'payment.created'].includes(eventType)) {
      return res.status(200).json({ success: true, ignored: true })
    }

    const paymentId = safeTrim(event?.data?.id, 255)
    if (!paymentId) {
      return res.status(200).json({ success: true, ignored: true })
    }

    const paymentResponse = await fetchSquarePayment(paymentId)
    const payment = paymentResponse?.payment
    if (!payment) {
      return res.status(200).json({ success: true, ignored: true })
    }

    // Job Seeker Kit payments ("bundle:<token>" note): grants the credits.
    const bundleType = await bundles.tryHandlePayment(payment)
    if (bundleType) {
      return res.status(200).json({ success: true, type: bundleType })
    }

    // Resume checker webhook routing. Resume check checkouts encode a ref
    // of the form "rc_<token>" in the payment note. We look that up first
    // and short-circuit so it never touches the employer checkout flow.
    const resumeCheckerHandled = await tryHandleResumeCheckerPayment({
      payment,
      eventId: safeTrim(event.event_id, 255),
      merchantId: safeTrim(event.merchant_id, 255),
    })
    if (resumeCheckerHandled) {
      return res.status(200).json({ success: true, type: 'resume_check' })
    }

    // Cover letter and interview prep webhook routing. A completed payment
    // for the full price marks the order paid and starts the AI generation.
    const aiProductType = await tryHandleAiProductPayment(payment)
    if (aiProductType) {
      return res.status(200).json({ success: true, type: aiProductType })
    }

    // Featured listing payments (note "featured:<token>"); see featured.js.
    if (await featured.tryHandlePayment(payment)) {
      return res.status(200).json({ success: true, type: 'featured' })
    }

    // Pay-per-post job listings ("job_post:<token>" notes); see employerSelfServe.js.
    const jobPostType = await selfServe.tryHandleJobPostPayment(payment)
    if (jobPostType) {
      return res.status(200).json({ success: true, type: jobPostType })
    }

    // A full refund of any employer payment (first or renewal) re-reads the
    // subscription from Square; the webhook never waits on it.
    if (eventType === 'payment.updated' && payment.customer_id && isFullyRefundedPayment(payment)) {
      syncEmployersForRefundedPayment(payment).catch((error) =>
        console.error(`[subscriptions] refund sync for payment ${payment.id} failed; access left as-is:`, error?.message || error)
      )
    }

    let checkout = null

    if (payment.order_id) {
      const [rows] = await pool.query(
        `
        SELECT *
        FROM employer_pending_checkouts
        WHERE square_order_id = ?
        ORDER BY id DESC
        LIMIT 1
        `,
        [payment.order_id]
      )
      checkout = rows[0] || null
    }

    if (!checkout) {
      const checkoutRef = extractCheckoutRef(payment.note) || extractCheckoutRef(payment.reference_id)
      if (checkoutRef) {
        checkout = await getPendingCheckoutByRef(checkoutRef)
      }
    }

    if (!checkout) {
      return res.status(200).json({ success: true, ignored: true })
    }

    const paymentStatus = String(payment.status || '').toLowerCase()
    await pool.query(
      `
      UPDATE employer_pending_checkouts
      SET
        square_payment_id = COALESCE(?, square_payment_id),
        square_customer_id = COALESCE(?, square_customer_id),
        square_merchant_id = COALESCE(?, square_merchant_id),
        square_event_id = ?,
        payment_status = ?,
        paid_at = CASE WHEN ? = 'completed' THEN COALESCE(paid_at, CURRENT_TIMESTAMP) ELSE paid_at END,
        last_error = NULL
      WHERE id = ?
      `,
      [
        payment.id || null,
        payment.customer_id || null,
        safeTrim(event.merchant_id, 255) || null,
        safeTrim(event.event_id, 255) || null,
        paymentStatus === 'completed' ? 'paid' : paymentStatus || 'pending',
        paymentStatus,
        checkout.id,
      ]
    )

    // An existing pay-per-post employer bought the monthly plan: convert that
    // employer in place. Errors fall through to the 500 below so Square
    // retries; applyPlanUpgrade is idempotent per checkout row.
    if (paymentStatus === 'completed' && checkout.employer_id) {
      const upgrade = await applyPlanUpgrade(pool, { checkout, payment, postDays: JOB_POST_EXPIRATION_DAYS })
      if (upgrade.applied) {
        if (!payment.customer_id) console.error(`[plan-upgrade] checkout ${checkout.checkout_ref}: payment has no customer_id; employer ${checkout.employer_id} will not lapse until linked to Square by hand.`)
        // Learn the subscription id and paid-through date; never blocks the webhook.
        syncEmployerSubscription({ id: checkout.employer_id, square_customer_id: payment.customer_id || null }).catch((error) =>
          console.error(`[subscriptions] post-upgrade sync for employer ${checkout.employer_id} failed; access left as-is:`, error?.message || error)
        )
      }
    } else if (paymentStatus === 'completed') {
      try {
        await finalizeVerifiedEmployerCheckoutByRef(checkout.checkout_ref)
        syncEmployerAfterCheckout(checkout, payment).catch((error) =>
          console.error(`[subscriptions] post-checkout sync for ${checkout.checkout_ref} failed; access left as-is:`, error?.message || error)
        )
      } catch (finalizeError) {
        console.error('POST /api/square/webhook finalize error:', finalizeError)
      }
    }

    res.status(200).json({ success: true })
  } catch (error) {
    console.error('POST /api/square/webhook error:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to process Square webhook.',
    })
  }
})

// -----------------------------------------------------------------------------
// Resume checker
// -----------------------------------------------------------------------------

function generateResumeCheckerToken() {
  // 24 random bytes → 32 url-safe chars. Used as the public_token in URLs.
  return `rc_${crypto.randomBytes(18).toString('base64url')}`
}

function buildResumeReportUrl(publicToken) {
  if (!APP_BASE_URL) return null
  const base = APP_BASE_URL.replace(/\/+$/, '')
  return `${base}/?page=resume-report&token=${encodeURIComponent(publicToken)}`
}

async function findResumeCheckByToken(publicToken) {
  if (!publicToken) return null
  const [rows] = await pool.query(
    `SELECT * FROM resume_checks WHERE public_token = ? LIMIT 1`,
    [publicToken]
  )
  return rows[0] || null
}

async function findResumeCheckByOrderId(orderId) {
  if (!orderId) return null
  const [rows] = await pool.query(
    `SELECT * FROM resume_checks WHERE square_order_id = ? LIMIT 1`,
    [orderId]
  )
  return rows[0] || null
}

async function createSquareResumeCheckerCheckoutLink({ publicToken, email }) {
  if (!SQUARE_ACCESS_TOKEN || !SQUARE_LOCATION_ID || !APP_BASE_URL) {
    throw new Error('Square checkout is not configured for the resume checker.')
  }

  const redirectUrl = buildResumeReportUrl(publicToken)
  if (!redirectUrl) {
    throw new Error('Resume report URL is not configured.')
  }

  const payload = {
    idempotency_key: crypto.randomUUID(),
    quick_pay: {
      name: RESUME_CHECKER_PRODUCT_NAME,
      price_money: {
        amount: RESUME_CHECKER_PRICE_CENTS,
        currency: RESUME_CHECKER_PRICE_CURRENCY,
      },
      location_id: SQUARE_LOCATION_ID,
    },
    checkout_options: {
      redirect_url: redirectUrl,
      ask_for_shipping_address: false,
    },
    pre_populated_data: email ? { buyer_email: email } : undefined,
    payment_note: `TarboroJobs resume check ref:${publicToken}`,
  }

  const response = await squareApiRequest('/v2/online-checkout/payment-links', {
    method: 'POST',
    body: payload,
  })

  return {
    paymentLinkId: response?.payment_link?.id || null,
    checkoutUrl: response?.payment_link?.url || null,
    orderId: response?.payment_link?.order_id || null,
  }
}

// Matches the note createSquareResumeCheckerCheckoutLink sets
// ("TarboroJobs resume check ref:rc_...") or a bare rc_ token.
function extractResumeCheckRef(value) {
  const match = String(value || '').match(/(?:^|\bref:)(rc_[a-zA-Z0-9_-]+)/)
  return match?.[1] || null
}

async function tryHandleResumeCheckerPayment({ payment, eventId, merchantId }) {
  if (!payment) return false

  let row = null
  if (payment.order_id) {
    row = await findResumeCheckByOrderId(payment.order_id)
  }
  if (!row) {
    const ref = extractResumeCheckRef(payment.note) || extractResumeCheckRef(payment.reference_id)
    if (ref) {
      row = await findResumeCheckByToken(ref)
    }
  }
  if (!row) return false

  let paymentStatus = String(payment.status || '').toLowerCase()
  const paidCents = Number(payment.amount_money?.amount || 0)
  const paidCurrency = String(payment.amount_money?.currency || '').toUpperCase()
  if (
    paymentStatus === 'completed' &&
    (paidCents < RESUME_CHECKER_PRICE_CENTS || paidCurrency !== String(RESUME_CHECKER_PRICE_CURRENCY || 'USD').toUpperCase())
  ) {
    console.warn(`[resume-check] payment ${payment.id} for check ${row.id} is ${paidCents} ${paidCurrency}, expected ${RESUME_CHECKER_PRICE_CENTS}; not unlocking`)
    paymentStatus = 'underpaid'
  }
  const nextStatus = paymentStatus === 'completed' ? 'paid' : (paymentStatus === 'failed' ? 'failed' : 'pending')

  await pool.query(
    `
    UPDATE resume_checks
    SET
      square_payment_id = COALESCE(?, square_payment_id),
      square_order_id = COALESCE(?, square_order_id),
      payment_status = CASE WHEN payment_status = 'paid' THEN 'paid' ELSE ? END,
      paid_at = CASE WHEN ? = 'completed' THEN COALESCE(paid_at, CURRENT_TIMESTAMP) ELSE paid_at END
    WHERE id = ?
    `,
    [
      payment.id || null,
      payment.order_id || null,
      nextStatus,
      paymentStatus,
      row.id,
    ]
  )

  // Touch merchant/event ids in logs only - we don't store them on resume_checks
  // for the MVP. If you later add an audit table, plug it in here.
  if (eventId || merchantId) {
    // intentionally noop - reserved for future audit logging
  }

  return true
}

function parseReportJson(value) {
  if (!value) return null
  if (typeof value === 'object') return value
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

// POST /api/resume-checker/preview
// Accept a PDF upload, parse it, run the rule-based analyzer, store the
// preview + full report, and return the preview shape + the public token.
app.post(
  '/api/resume-checker/preview',
  discardUploadOnError,
  resumeCheckerUpload.single('resume'),
  async (req, res) => {
    let savedFilePath = null
    try {
      // Rate limit per requester IP.
      if (!consumeResumeCheckerRate(getRequestIp(req))) {
        if (req.file?.path) {
          try { await fs.promises.unlink(req.file.path) } catch {}
        }
        return res.status(429).json({
          success: false,
          error: 'Too many uploads in a short window. Please try again later.',
        })
      }

      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: 'A PDF resume is required.',
        })
      }

      savedFilePath = req.file.path

      const consent = parseBoolean(req.body.consent)
      if (!consent) {
        return res.status(400).json({
          success: false,
          error: 'You must agree to the consent statement before submitting your resume.',
        })
      }

      const email = normalizeEmail(req.body.email)
      const fullName = toNullableString(req.body.fullName, 255)
      const targetJobTitle = toNullableString(req.body.targetJobTitle, 255)
      const jobDescription = safeTrim(req.body.jobDescription, 8000)
      const jobPostIdRaw = safeTrim(req.body.jobPostId, 24)
      const jobPostId = jobPostIdRaw && /^\d+$/.test(jobPostIdRaw) ? Number(jobPostIdRaw) : null

      if (email && !isValidEmail(email)) {
        return res.status(400).json({
          success: false,
          error: 'A valid email address is required.',
        })
      }

      const extractedText = await extractPdfTextFromFile(savedFilePath)
      if (!extractedText || extractedText.length < 80) {
        return res.status(400).json({
          success: false,
          error: 'We could not read meaningful text from your PDF. If your resume is scanned or image-based, please export it as a text-based PDF and try again.',
        })
      }

      const fullReport = analyzeResume(extractedText, {
        targetJobTitle,
        jobDescription,
      })

      const publicToken = generateResumeCheckerToken()

      // We keep preview_report null on purpose - the product no longer has
      // a free preview tier. The full report is computed up front so it can
      // be revealed instantly after payment, but it stays sealed behind
      // payment_status='paid' on both the DB row and every API response.
      await pool.query(
        `
        INSERT INTO resume_checks
        (
          public_token,
          email,
          full_name,
          target_job_title,
          job_post_id,
          original_filename,
          extracted_text,
          full_score,
          full_report,
          payment_status
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'free_preview')
        `,
        [
          publicToken,
          email || null,
          fullName,
          targetJobTitle,
          jobPostId,
          safeTrim(req.file.originalname, 255) || null,
          extractedText,
          fullReport.overallScore,
          JSON.stringify(fullReport),
        ]
      )

      // Delete the uploaded PDF - we keep only the extracted text per the
      // privacy section of the spec.
      try { await fs.promises.unlink(savedFilePath) } catch {}
      savedFilePath = null

      // Intentionally NO score/strengths/problems in the response. The score
      // is the paid product.
      return res.json({
        success: true,
        publicToken,
        ready: true,
        priceCents: RESUME_CHECKER_PRICE_CENTS,
        currency: RESUME_CHECKER_PRICE_CURRENCY,
        message: 'Your resume is analyzed and ready. Unlock your score to see the full report.',
      })
    } catch (error) {
      console.error('POST /api/resume-checker/preview error:', error)
      if (savedFilePath) {
        try { await fs.promises.unlink(savedFilePath) } catch {}
      }
      return res.status(500).json({
        success: false,
        error: 'Failed to analyze resume.',
      })
    }
  }
)

// POST /api/resume-checker/create-checkout
// Returns a Square hosted-checkout URL the user can be redirected to to pay
// for the full report. We do NOT flip the resume_check to paid here - that
// only happens via the webhook.
app.post('/api/resume-checker/create-checkout', async (req, res) => {
  try {
    const publicToken = safeTrim(req.body?.publicToken, 128)
    if (!publicToken) {
      return res.status(400).json({ success: false, error: 'publicToken is required.' })
    }

    const row = await findResumeCheckByToken(publicToken)
    if (!row) {
      return res.status(404).json({ success: false, error: 'Resume check not found.' })
    }

    if (row.payment_status === 'paid') {
      return res.json({
        success: true,
        alreadyPaid: true,
        reportUrl: buildResumeReportUrl(publicToken),
      })
    }

    // Dev bypass: flip to paid in-process and short-circuit Square. Only
    // active when RESUME_CHECKER_DEV_BYPASS=1, which should only be set
    // when you are running the server on a developer workstation.
    if (RESUME_CHECKER_DEV_BYPASS) {
      await pool.query(
        `UPDATE resume_checks
         SET payment_status = 'paid',
             paid_at = CURRENT_TIMESTAMP,
             square_payment_id = COALESCE(square_payment_id, 'dev-bypass')
         WHERE id = ?`,
        [row.id]
      )
      const reportUrl = buildResumeReportUrl(publicToken)
      console.warn(`[resume-checker] DEV BYPASS - marked ${publicToken} as paid without Square`)
      return res.json({
        success: true,
        devBypass: true,
        checkoutUrl: reportUrl,
        reportUrl,
      })
    }

    // One Square link per check: clicking Unlock again reuses it, so the
    // order id the webhook matches on never moves away from a paid link.
    if (row.square_checkout_url) {
      return res.json({ success: true, checkoutUrl: row.square_checkout_url })
    }

    const { paymentLinkId, checkoutUrl, orderId } = await createSquareResumeCheckerCheckoutLink({
      publicToken,
      email: row.email || undefined,
    })

    await pool.query(
      `
      UPDATE resume_checks
      SET
        payment_status = CASE WHEN payment_status = 'paid' THEN 'paid' ELSE 'pending' END,
        square_payment_link_id = ?,
        square_order_id = COALESCE(?, square_order_id),
        square_checkout_url = ?
      WHERE id = ?
      `,
      [paymentLinkId, orderId, checkoutUrl, row.id]
    )

    return res.json({
      success: true,
      checkoutUrl,
    })
  } catch (error) {
    console.error('POST /api/resume-checker/create-checkout error:', error)
    return res.status(500).json({
      success: false,
      error: 'Failed to create checkout.',
    })
  }
})

// GET /api/resume-checker/report/:publicToken
// Returns the preview shape when unpaid, the full report when paid. The
// frontend never decides "paid" - only this endpoint does.
app.get('/api/resume-checker/report/:publicToken', async (req, res) => {
  try {
    const publicToken = safeTrim(req.params.publicToken, 128)
    if (!publicToken) {
      return res.status(400).json({ success: false, error: 'publicToken is required.' })
    }

    const row = await findResumeCheckByToken(publicToken)
    if (!row) {
      return res.status(404).json({ success: false, error: 'Resume check not found.' })
    }

    if (row.payment_status === 'paid') {
      const fullReport = parseReportJson(row.full_report)
      return res.json({
        success: true,
        paid: true,
        fullReport,
        targetJobTitle: row.target_job_title || null,
        createdAt: row.created_at,
      })
    }

    // Unpaid responses intentionally expose zero scoring data. The score is
    // the paid product, so the client gets only "your resume is on file,
    // here is the unlock price."
    return res.json({
      success: true,
      paid: false,
      paymentStatus: row.payment_status,
      priceCents: RESUME_CHECKER_PRICE_CENTS,
      currency: RESUME_CHECKER_PRICE_CURRENCY,
      targetJobTitle: row.target_job_title || null,
      createdAt: row.created_at,
    })
  } catch (error) {
    console.error('GET /api/resume-checker/report error:', error)
    return res.status(500).json({
      success: false,
      error: 'Failed to load resume report.',
    })
  }
})

app.post('/api/employer-plan/claim', async (req, res) => {
  res.status(410).json({
    success: false,
    error: 'Direct employer claim is disabled. Use the secure Square checkout flow instead.',
  })
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
      error: 'Failed to create onboarding token.',
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
      error: 'Failed to validate onboarding token.',
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
        t.employer_id,
        e.access_status
      FROM employer_onboarding_tokens t
      LEFT JOIN employers e ON e.id = t.employer_id
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

    if (tokenRow.access_status === 'inactive') {
      await connection.rollback()
      return res.status(403).json({
        success: false,
        error: 'This employer account has been deactivated. Please contact TarboroJobs.',
      })
    }

    // Claim the token before doing anything else. The row lock this takes is
    // held until commit, so a second submit of the same token waits here and
    // then matches 0 rows instead of onboarding twice.
    const [consumed] = await connection.query(
      `
      UPDATE employer_onboarding_tokens
      SET status = 'used', used_at = NOW()
      WHERE id = ? AND status = 'pending'
      `,
      [tokenRow.id]
    )

    if (consumed.affectedRows !== 1) {
      await connection.rollback()
      return res.status(403).json({
        success: false,
        error: 'This onboarding token has already been used.',
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
      SELECT id, token_version
      FROM employer_users
      WHERE employer_id = ?
      LIMIT 1
      `,
      [employerId]
    )

    let employerUserId = null
    let tokenVersion = 0

    if (existingUsers.length > 0) {
      employerUserId = existingUsers[0].id
      tokenVersion = Number(existingUsers[0].token_version || 0) + 1

      await connection.query(
        `
        UPDATE employer_users
        SET
          email = ?,
          password_hash = ?,
          is_active = 1,
          token_version = token_version + 1,
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

    // This token is already 'used'; retire any other pending links.
    await revokePendingTokensForEmployer(connection, employerId)

    await connection.commit()

    const authToken = createAuthToken({
      id: employerUserId,
      employer_id: employerId,
      email,
      token_version: tokenVersion,
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
      error: 'Failed to complete employer onboarding.',
    })
  } finally {
    connection.release()
  }
})

// Compared against when the email is unknown; same cost (10) as real hashes.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), 10)

app.post('/api/employer-auth/login', rateLimitByIp(consumeLoginRate, 'Too many login attempts. Please try again later.'), async (req, res) => {
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
        eu.is_admin,
        eu.token_version,
        e.business_name,
        e.subscription_status,
        e.access_status,
        e.current_period_end,
        e.square_customer_id,
        e.square_subscription_id,
        e.subscription_synced_at,
        e.plan,
        e.onboarding_completed
      FROM employer_users eu
      INNER JOIN employers e ON e.id = eu.employer_id
      WHERE LOWER(eu.email) = ?
      LIMIT 1
      `,
      [email]
    )

    // Unknown email, wrong password and a disabled account all look the same
    // until the password is proven: same 401, and a bcrypt compare either way
    // so the response time does not give the account away.
    const user = rows[0]
    const passwordMatches = await bcrypt.compare(password, user?.password_hash || DUMMY_PASSWORD_HASH)

    if (!user || !passwordMatches) {
      return res.status(401).json({
        success: false,
        error: 'Invalid email or password.',
      })
    }

    if (!user.is_active) {
      return res.status(403).json({
        success: false,
        error: 'This employer login is inactive.',
      })
    }

    const isAdmin = !!user.is_admin

    if (!isAdmin && user.plan === 'pay_per_post' && user.access_status === 'pending') {
      return res.status(403).json({
        success: false,
        error: 'Please confirm your email first. Check your inbox for the confirmation link, or sign up again to get a new one.',
      })
    }

    if (!isAdmin && !user.onboarding_completed) {
      return res.status(403).json({
        success: false,
        error: 'Employer onboarding is not complete yet.',
      })
    }

    if (!isAdmin && !isEmployerEligible(user)) {
      // Locked out employers cannot reach requireEligibleEmployer, so a renewal
      // that landed since the last sync is picked up from here.
      maybeSyncEmployerSubscriptionInBackground({ ...user, id: user.employer_id })
      return res.status(403).json({
        success: false,
        error: 'This employer account is not eligible for login.',
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
        plan: user.plan || 'subscription',
      },
      admin: {
        authenticated: isAdmin,
        is_admin: isAdmin,
        auth_type: isAdmin ? 'employer_session' : null,
        email: isAdmin ? user.email : null,
      },
      message: 'Login successful.',
    })
  } catch (error) {
    console.error('POST /api/employer-auth/login error:', error)
    res.status(500).json({
      success: false,
      error: 'Internal server error.',
    })
  }
})

app.post('/api/employer-auth/forgot-password', rateLimitByIp(consumeForgotPasswordRate, 'Too many password reset requests. Please try again later.'), async (req, res) => {
  const email = normalizeEmail(req.body.email)

  // Same reply, sent before any lookup, whether or not the account exists or
  // the email goes out, so neither the body nor the timing reveals accounts.
  // Failures are only logged.
  res.json({
    success: true,
    message: 'If that email exists, a password reset link has been sent.',
  })

  if (!email || !isValidEmail(email)) return

  try {
    const [rows] = await pool.query(
      `
      SELECT
        eu.id,
        eu.email,
        eu.is_active,
        e.business_name,
        e.onboarding_completed,
        e.subscription_status,
        e.access_status,
        e.current_period_end,
        e.square_customer_id,
        e.square_subscription_id,
        e.subscription_synced_at,
        e.plan
      FROM employer_users eu
      INNER JOIN employers e ON e.id = eu.employer_id
      WHERE LOWER(eu.email) = ?
      LIMIT 1
      `,
      [email]
    )

    const user = rows[0]
    if (!user || !user.is_active || !user.onboarding_completed || !isEmployerEligible(user)) return

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
      console.error('POST /api/employer-auth/forgot-password: reset email not sent; mail or APP_BASE_URL is not configured.')
    }
  } catch (error) {
    console.error('POST /api/employer-auth/forgot-password error:', error)
  }
})

app.get('/api/employer-auth/reset-password/validate', rateLimitByIp(consumeResetPasswordRate), async (req, res) => {
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
        e.access_status,
        e.current_period_end,
        e.square_customer_id,
        e.square_subscription_id,
        e.subscription_synced_at,
        e.plan
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
      error: 'Failed to validate password reset token.',
    })
  }
})

app.post('/api/employer-auth/reset-password', rateLimitByIp(consumeResetPasswordRate), async (req, res) => {
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
        e.access_status,
        e.current_period_end,
        e.square_customer_id,
        e.square_subscription_id,
        e.subscription_synced_at,
        e.plan
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
        token_version = token_version + 1,
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
      error: 'Failed to reset password.',
    })
  } finally {
    connection.release()
  }
})

app.get('/api/employer-auth/me', requireEmployerAuth, async (req, res) => {
  // Pay-per-post terms the dashboard shows; the free-post flag is read here so
  // the session query does not depend on the self-serve columns.
  let freePostUsed = false
  try {
    const [rows] = await pool.query('SELECT free_post_used_at FROM employers WHERE id = ? LIMIT 1', [req.auth.employer_id])
    freePostUsed = !!rows[0]?.free_post_used_at
  } catch (error) {
    console.error('GET /api/employer-auth/me free-post lookup error:', error?.message || error)
  }
  res.json({
    success: true,
    employer_user: req.auth.employer_user,
    employer: {
      ...req.auth.employer,
      free_post_used: freePostUsed,
      post_days: PAID_POST_DAYS,
      post_price_cents: JOB_POST_PRICE_CENTS,
    },
    admin: req.auth.admin,
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

    // employers.email also matters: paid checkout looks employers up by it,
    // so taking another business's address would hijack or block its signup.
    const [employerEmailConflicts] = await pool.query(
      `
      SELECT id
      FROM employers
      WHERE email = ? AND id <> ?
      LIMIT 1
      `,
      [email, employerId]
    )

    if (emailConflicts.length > 0 || employerEmailConflicts.length > 0) {
      return res.status(409).json({
        success: false,
        error: 'That email address is already being used by another employer login.',
      })
    }

    // A claimed scraped employer keeps its listings+<slug>@tarborojobs.com
    // address: the scraper finds the employer by it, and a new address would
    // move every scraped job to a fresh employer on the next run.
    await pool.query(
      `
      UPDATE employers
      SET
        business_name = ?,
        industry = ?,
        contact_name = ?,
        email = IF(email LIKE 'listings+%@tarborojobs.com', email, ?),
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
      error: 'Failed to update employer account.',
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
        token_version = token_version + 1,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
      `,
      [passwordHash, employerUserId]
    )

    // Older tokens are now rejected; hand this browser a fresh one.
    const refreshedSession = await loadEmployerSessionByUserId(employerUserId)

    res.json({
      success: true,
      auth_token: createAuthToken(refreshedSession),
      message: 'Password updated successfully.',
    })
  } catch (error) {
    console.error('PATCH /api/employer/account/password error:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to update employer password.',
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
        industry,
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
        review_note,
        updated_at,
        source_url,
        featured_until,
        (featured_until IS NOT NULL AND featured_until > CURRENT_TIMESTAMP) AS is_featured
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
      error: 'Failed to fetch jobs.',
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
    const industry = toNullableString(req.body.industry, 255)
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

    // Without the monthly plan a post goes live only after review (the free
    // first post) or payment (every later one); see employerSelfServe.js.
    const payPerPost = !hasSubscriptionFeatures({ ...req.auth.employer, ...req.auth.billing })
    const lifecycle = payPerPost
      ? { status: await selfServe.newPostStatus(employerId), publishedAt: null, expiresAt: null, expiredAt: null }
      : resolveJobLifecycleFields(status)
    const guidelinesAcceptedAt = complianceCertified ? new Date() : null

    const [result] = await pool.query(
      `
      INSERT INTO job_posts
      (
        employer_id,
        job_title,
        job_description,
        city,
        industry,
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
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        employerId,
        jobTitle,
        jobDescription,
        city,
        industry,
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

    if (payPerPost) {
      const { checkout_url: checkoutUrl } = await selfServe.afterPayPerPostCreated({
        jobId: result.insertId,
        employerId,
        status: lifecycle.status,
        jobTitle,
        businessName: req.auth.employer.business_name,
      })
      return res.json({
        success: true,
        id: result.insertId,
        status: lifecycle.status,
        checkout_url: checkoutUrl,
        message:
          lifecycle.status === 'pending_review'
            ? 'Your free post is saved. We review first posts before they go live and will email you once it is approved.'
            : `Your post is saved. Pay $${(JOB_POST_PRICE_CENTS / 100).toFixed(2)} to publish it for ${PAID_POST_DAYS} days.`,
      })
    }

    res.json({
      success: true,
      id: result.insertId,
      status: lifecycle.status,
      message:
        lifecycle.status === 'open'
          ? `Job created successfully. It will expire automatically in ${JOB_POST_EXPIRATION_DAYS} days.`
          : 'Job created successfully.',
    })
  } catch (error) {
    console.error('POST /api/employer/jobs error:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to create job.',
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
    const industry = toNullableString(req.body.industry, 255)
    const payMin = parseMoney(req.body.pay_min)
    const payMax = parseMoney(req.body.pay_max)
    const payType = normalizeEnum(req.body.pay_type, ALLOWED_PAY_TYPES, 'hourly')
    const employmentType = normalizeEnum(
      req.body.employment_type,
      ALLOWED_EMPLOYMENT_TYPES,
      'full-time'
    )
    const experienceLevel = toNullableString(req.body.experience_level, 255)
    const payPerPost = !hasSubscriptionFeatures({ ...req.auth.employer, ...req.auth.billing })
    const payPerPostStatus = payPerPost ? resolvePayPerPostStatus(ownedJob.status, req.body.status) : null
    // An edited rejected post goes back to the admin review queue.
    const resubmitted = payPerPost && ownedJob.status === 'rejected' && payPerPostStatus.status === 'rejected'
    const status = resubmitted ? 'pending_review' : payPerPost ? payPerPostStatus.status : normalizeEnum(req.body.status, ALLOWED_JOB_STATUSES, 'open')
    const complianceCertified = parseBoolean(req.body.compliance_certified)
    const blockedTerms = getBlockedJobPostingTerms([jobTitle, jobDescription])

    if (payPerPostStatus?.error) {
      return res.status(400).json({
        success: false,
        error: payPerPostStatus.error,
      })
    }

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
        industry = ?,
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
        industry,
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
          : resubmitted
            ? 'Sent back for review. We will email you once it is approved.'
            : 'Job updated successfully.',
    })
  } catch (error) {
    console.error('PATCH /api/employer/jobs/:id error:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to update job.',
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
      const payPerPost = !hasSubscriptionFeatures({ ...req.auth.employer, ...req.auth.billing })
      const status = payPerPost
        ? normalizeEnum(req.body.status, new Set([...ALLOWED_JOB_STATUSES, 'pending_review', 'awaiting_payment', 'rejected']), null)
        : normalizeEnum(req.body.status, ALLOWED_JOB_STATUSES, null)

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

      if (payPerPost) {
        const payPerPostStatus = resolvePayPerPostStatus(ownedJob.status, status)
        if (payPerPostStatus.error) {
          return res.status(400).json({
            success: false,
            error: payPerPostStatus.error,
          })
        }
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
        error: 'Failed to update job status.',
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
      error: 'Failed to delete job.',
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
        SUM(
          CASE
            WHEN eca.status IS NULL OR eca.status IN (?, ?)
            THEN 1
            ELSE 0
          END
        ) AS new_candidates,
        SUM(CASE WHEN eca.status IN (?, ?, ?, ?) THEN 1 ELSE 0 END) AS reviewed_candidates,
        SUM(CASE WHEN eca.status IN (?, ?) THEN 1 ELSE 0 END) AS interview_candidates,
        SUM(CASE WHEN eca.status = ? THEN 1 ELSE 0 END) AS rejected_candidates,
        SUM(CASE WHEN eca.status = ? THEN 1 ELSE 0 END) AS hired_candidates,
        SUM(CASE WHEN eca.status IN (?, ?, ?, ?) THEN 1 ELSE 0 END) AS saved_candidates,
        SUM(CASE WHEN eca.status IN (?, ?) THEN 1 ELSE 0 END) AS interviews_scheduled,
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
      WHERE js.employer_id = ?
      `,
      [
        ...CANDIDATE_STATUS_SQL_VALUES.new,
        ...CANDIDATE_STATUS_SQL_VALUES.reviewed,
        ...CANDIDATE_STATUS_SQL_VALUES.interview,
        'rejected',
        'hired',
        ...CANDIDATE_STATUS_SQL_VALUES.reviewed,
        ...CANDIDATE_STATUS_SQL_VALUES.interview,
        now,
        employerId,
        employerId,
      ]
    )

    res.json({
      success: true,
      stats: {
        open_jobs: Number(openJobsRows[0]?.total || 0),
        total_resumes: Number(resumeRows[0]?.total_resumes || 0),
        new_candidates: Number(resumeRows[0]?.new_candidates || 0),
        reviewed_candidates: Number(resumeRows[0]?.reviewed_candidates || 0),
        interview_candidates: Number(resumeRows[0]?.interview_candidates || 0),
        rejected_candidates: Number(resumeRows[0]?.rejected_candidates || 0),
        hired_candidates: Number(resumeRows[0]?.hired_candidates || 0),
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
      error: 'Failed to fetch employer stats.',
    })
  }
})

// Resume PDFs are never public. An employer gets a file only if it belongs to
// an applicant they can already see in GET /api/employer/resumes
// (js.employer_id) or an application to one of their own job posts; admins get
// any. Everything else is a 404 so file names cannot be probed. The path comes
// from the stored DB value, never from the request.
async function sendResumeFile(req, res, employerId) {
  const notFound = () => res.status(404).json({ success: false, error: 'Resume not found.' })

  try {
    const name = String(req.params.name || '')
    if (!/^[A-Za-z0-9._-]+$/.test(name) || path.basename(name) !== name) return notFound()

    const params = [`/uploads/resumes/${name}`]
    let access = ''
    if (employerId !== null) {
      access = 'AND (js.employer_id = ? OR jp.employer_id = ?)'
      params.push(employerId, employerId)
    }

    const [rows] = await pool.query(
      `
      SELECT js.resume_file_url
      FROM job_seekers js
      LEFT JOIN job_posts jp ON jp.id = js.job_post_id
      WHERE js.resume_file_url = ?
        ${access}
      LIMIT 1
      `,
      params
    )
    if (!rows.length) return notFound()

    const filePath = path.resolve(resumesDir, path.basename(String(rows[0].resume_file_url)))
    if (path.dirname(filePath) !== path.resolve(resumesDir) || !fs.existsSync(filePath)) return notFound()

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="resume.pdf"',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    })
    // root keeps send's dotfile check to the file name, not the folders above it.
    res.sendFile(path.basename(filePath), { root: resumesDir }, (error) => {
      if (error && !res.headersSent) notFound()
    })
  } catch (error) {
    console.error('sendResumeFile error:', error)
    res.status(500).json({ success: false, error: 'Failed to load resume.' })
  }
}

app.get('/api/employer/resume-files/:name', requireEmployerAuth, requireEligibleEmployer, (req, res) =>
  sendResumeFile(req, res, req.auth.employer_id)
)

app.get('/api/admin/resume-files/:name', requireAdminAuth, (req, res) => sendResumeFile(req, res, null))

app.get('/api/employer/resumes', requireEmployerAuth, requireEligibleEmployer, async (req, res, next) => {
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

    // Pay-per-post employers see the applicants to their own posts; searching
    // and filtering them is a monthly-plan feature.
    const filtered = search || city || employmentType || candidateStatus
    if (filtered && !hasSubscriptionFeatures({ ...req.auth.employer, ...req.auth.billing })) {
      return requireSubscriptionEmployer(req, res, next)
    }

    const whereParts = ['js.employer_id = ?']
    const params = [employerId]

    if (search) {
      whereParts.push(`
        (
          js.full_name LIKE ?
          OR js.email LIKE ?
          OR js.desired_job_title LIKE ?
          OR js.skills LIKE ?
          OR js.resume_text LIKE ?
          OR jp.job_title LIKE ?
        )
      `)
      const like = `%${search}%`
      params.push(like, like, like, like, like, like)
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
      const statusFilter = buildCandidateStatusWhereClause('eca.status', candidateStatus)
      if (statusFilter) {
        whereParts.push(statusFilter.clause)
        params.push(...statusFilter.params)
      }
    }

    const whereSql = `WHERE ${whereParts.join(' AND ')}`

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
      candidate_status: normalizeCandidateStatus(row.candidate_status) || 'new',
      candidate_action: row.action_id
        ? {
            id: row.action_id,
            status: normalizeCandidateStatus(row.candidate_status) || 'new',
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
    })
  } catch (error) {
    console.error('GET /api/employer/resumes error:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to fetch resumes.',
    })
  }
})

app.post(
  '/api/employer/candidate-actions',
  requireEmployerAuth,
  requireEligibleEmployer,
  requireSubscriptionEmployer,
  async (req, res) => {
    try {
      const employerId = req.auth.employer_id
      const jobSeekerId = Number(req.body.job_seeker_id)
      const normalizedStatus = normalizeCandidateStatus(req.body.status)
      const notes =
        req.body.notes !== undefined && req.body.notes !== null
          ? safeTrim(req.body.notes, 5000)
          : null

      let contactedAt = normalizeDateTime(req.body.contacted_at)
      let interviewAt = normalizeDateTime(req.body.interview_at)
      let hiredAt = normalizeDateTime(req.body.hired_at)
      let rejectedAt = normalizeDateTime(req.body.rejected_at)
      const nextFollowUpAt = normalizeDateTime(req.body.next_follow_up_at)

      if (normalizedStatus === 'interview' && !interviewAt) {
        interviewAt = new Date()
      }

      if (normalizedStatus === 'hired' && !hiredAt) {
        hiredAt = new Date()
      }

      if (normalizedStatus === 'rejected' && !rejectedAt) {
        rejectedAt = new Date()
      }

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
          AND employer_id = ?
        LIMIT 1
        `,
        [jobSeekerId, employerId]
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
        error: 'Failed to save candidate action.',
      })
    }
  }
)

app.patch(
  '/api/employer/candidate-actions/:id',
  requireEmployerAuth,
  requireEligibleEmployer,
  requireSubscriptionEmployer,
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
        error: 'Failed to update candidate action.',
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
        created_at
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
      hiring: row.status === 'active',
      created_at: row.created_at,
    }))

    res.json({
      success: true,
      businesses,
    })
  } catch (error) {
    console.error('GET /api/employers error:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to fetch employers.',
    })
  }
})

app.get('/api/jobposts', async (req, res) => {
  try {
    await expireOpenJobs()
    const rows = await listPublicJobPostRows()

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
      source_url: row.source_url,
      status: row.status,
      posted: row.published_at || row.created_at,
      expires_at: row.expires_at,
      featured: isFeatured(row),
    }))

    res.json({
      success: true,
      jobs,
    })
  } catch (error) {
    console.error('GET /api/jobposts error:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to fetch job posts.',
    })
  }
})


app.get('/api/admin/session', requireAdminAuth, async (req, res) => {
  try {
    await expireOpenJobs()

    const [employerResult, jobResult, tokenResult] = await Promise.all([
      pool.query(
        `
        SELECT
          COUNT(*) AS total_employers,
          SUM(CASE WHEN access_status = 'active' THEN 1 ELSE 0 END) AS active_employers,
          SUM(CASE WHEN access_status = 'pending' THEN 1 ELSE 0 END) AS pending_employers,
          SUM(CASE WHEN onboarding_completed = 1 THEN 1 ELSE 0 END) AS onboarded_employers
        FROM employers
        `
      ),
      pool.query(
        `
        SELECT
          COUNT(*) AS total_jobs,
          SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS open_jobs,
          SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) AS closed_jobs,
          SUM(CASE WHEN status = 'expired' THEN 1 ELSE 0 END) AS expired_jobs
        FROM job_posts
        `
      ),
      pool.query(
        `
        SELECT
          COUNT(*) AS total_tokens,
          SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending_tokens,
          SUM(CASE WHEN status = 'used' THEN 1 ELSE 0 END) AS used_tokens,
          SUM(CASE WHEN status = 'revoked' THEN 1 ELSE 0 END) AS revoked_tokens
        FROM employer_onboarding_tokens
        `
      ),
    ])

    const [employerRows] = employerResult
    const [jobRows] = jobResult
    const [tokenRows] = tokenResult

    const employerCounts = employerRows[0] || {}
    const jobCounts = jobRows[0] || {}
    const tokenCounts = tokenRows[0] || {}

    res.json({
      success: true,
      admin: {
        authenticated: true,
        is_admin: true,
        auth_type: req.admin?.auth_type || 'api_key',
        email: req.admin?.email || null,
      },
      overview: {
        total_employers: Number(employerCounts.total_employers || 0),
        active_employers: Number(employerCounts.active_employers || 0),
        pending_employers: Number(employerCounts.pending_employers || 0),
        onboarded_employers: Number(employerCounts.onboarded_employers || 0),
        total_jobs: Number(jobCounts.total_jobs || 0),
        open_jobs: Number(jobCounts.open_jobs || 0),
        closed_jobs: Number(jobCounts.closed_jobs || 0),
        expired_jobs: Number(jobCounts.expired_jobs || 0),
        total_tokens: Number(tokenCounts.total_tokens || 0),
        pending_tokens: Number(tokenCounts.pending_tokens || 0),
        used_tokens: Number(tokenCounts.used_tokens || 0),
        revoked_tokens: Number(tokenCounts.revoked_tokens || 0),
      },
    })
  } catch (error) {
    console.error('GET /api/admin/session error:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to load admin session.',
    })
  }
})

app.get('/api/admin/employers', requireAdminAuth, async (req, res) => {
  try {
    await expireOpenJobs()

    const [rows] = await pool.query(
      `
      SELECT
        e.id,
        e.business_name,
        e.industry,
        e.contact_name,
        e.email,
        e.phone,
        e.website,
        e.address,
        e.city,
        e.notes,
        e.status,
        e.subscription_status,
        e.access_status,
        e.current_period_end,
        e.subscription_synced_at,
        e.plan,
        e.onboarding_completed,
        e.created_at,
        e.updated_at,
        eu.id AS employer_user_id,
        eu.email AS login_email,
        eu.is_active AS login_is_active,
        COALESCE(job_counts.total_jobs, 0) AS total_jobs,
        COALESCE(job_counts.open_jobs, 0) AS open_jobs,
        COALESCE(candidate_counts.total_candidates, 0) AS total_candidates,
        last_token.id AS latest_token_id,
        last_token.status AS latest_token_status,
        last_token.expires_at AS latest_token_expires_at,
        last_token.created_at AS latest_token_created_at
      FROM employers e
      LEFT JOIN employer_users eu ON eu.employer_id = e.id
      LEFT JOIN (
        SELECT
          employer_id,
          COUNT(*) AS total_jobs,
          SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS open_jobs
        FROM job_posts
        GROUP BY employer_id
      ) job_counts ON job_counts.employer_id = e.id
      LEFT JOIN (
        SELECT employer_id, COUNT(*) AS total_candidates
        FROM job_seekers
        GROUP BY employer_id
      ) candidate_counts ON candidate_counts.employer_id = e.id
      LEFT JOIN employer_onboarding_tokens last_token
        ON last_token.id = (
          SELECT t2.id
          FROM employer_onboarding_tokens t2
          WHERE t2.employer_id = e.id
          ORDER BY t2.created_at DESC, t2.id DESC
          LIMIT 1
        )
      ORDER BY e.created_at DESC, e.id DESC
      `
    )

    const employers = rows.map((row) => ({
      id: row.id,
      business_name: row.business_name,
      industry: row.industry,
      contact_name: row.contact_name,
      email: row.email,
      phone: row.phone,
      website: row.website,
      address: row.address,
      city: row.city,
      notes: row.notes,
      status: row.status,
      subscription_status: row.subscription_status,
      access_status: row.access_status,
      current_period_end: row.current_period_end,
      subscription_synced_at: row.subscription_synced_at,
      plan: row.plan || 'subscription',
      onboarding_completed: !!row.onboarding_completed,
      created_at: row.created_at,
      updated_at: row.updated_at,
      employer_user_id: row.employer_user_id,
      login_email: row.login_email,
      login_is_active: row.login_is_active === null ? null : !!row.login_is_active,
      total_jobs: Number(row.total_jobs || 0),
      open_jobs: Number(row.open_jobs || 0),
      total_candidates: Number(row.total_candidates || 0),
      latest_token: row.latest_token_id
        ? {
            id: row.latest_token_id,
            status: row.latest_token_status,
            expires_at: row.latest_token_expires_at,
            created_at: row.latest_token_created_at,
          }
        : null,
    }))

    res.json({
      success: true,
      employers,
    })
  } catch (error) {
    console.error('GET /api/admin/employers error:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to fetch employers.',
    })
  }
})

app.get('/api/admin/jobs', requireAdminAuth, async (req, res) => {
  try {
    await expireOpenJobs()

    const [rows] = await pool.query(
      `
      SELECT
        jp.id,
        jp.employer_id,
        jp.job_title,
        jp.job_description,
        jp.city,
        COALESCE(jp.industry, e.industry) AS industry,
        jp.pay_min,
        jp.pay_max,
        jp.pay_type,
        jp.employment_type,
        jp.experience_level,
        jp.status,
        jp.posting_guidelines_accepted,
        jp.posting_guidelines_accepted_at,
        jp.created_at,
        jp.updated_at,
        jp.published_at,
        jp.expires_at,
        jp.expired_at,
        e.business_name,
        e.email AS employer_email,
        e.access_status AS employer_access_status,
        e.onboarding_completed,
        COALESCE(app_counts.total_applicants, 0) AS total_applicants
      FROM job_posts jp
      INNER JOIN employers e ON e.id = jp.employer_id
      LEFT JOIN (
        SELECT job_post_id, COUNT(*) AS total_applicants
        FROM job_seekers
        WHERE job_post_id IS NOT NULL
        GROUP BY job_post_id
      ) app_counts ON app_counts.job_post_id = jp.id
      ORDER BY COALESCE(jp.published_at, jp.created_at) DESC, jp.id DESC
      `
    )

    const jobs = rows.map((row) => ({
      id: row.id,
      employer_id: row.employer_id,
      employer_name: row.business_name,
      employer_email: row.employer_email,
      employer_access_status: row.employer_access_status,
      employer_onboarding_completed: !!row.onboarding_completed,
      title: row.job_title,
      description: row.job_description,
      city: row.city,
      industry: row.industry,
      pay_min: row.pay_min,
      pay_max: row.pay_max,
      pay_type: row.pay_type,
      employment_type: row.employment_type,
      experience_level: row.experience_level,
      status: row.status,
      posting_guidelines_accepted: !!row.posting_guidelines_accepted,
      posting_guidelines_accepted_at: row.posting_guidelines_accepted_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
      published_at: row.published_at,
      expires_at: row.expires_at,
      expired_at: row.expired_at,
      total_applicants: Number(row.total_applicants || 0),
    }))

    res.json({
      success: true,
      jobs,
    })
  } catch (error) {
    console.error('GET /api/admin/jobs error:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to fetch jobs.',
    })
  }
})

app.get('/api/admin/tokens', requireAdminAuth, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `
      SELECT
        t.id,
        t.employer_id,
        t.token,
        t.email,
        t.square_customer_id,
        t.square_subscription_id,
        t.status,
        t.expires_at,
        t.used_at,
        t.created_at,
        e.business_name,
        e.access_status,
        e.onboarding_completed
      FROM employer_onboarding_tokens t
      LEFT JOIN employers e ON e.id = t.employer_id
      ORDER BY t.created_at DESC, t.id DESC
      LIMIT 200
      `
    )

    const tokens = rows.map((row) => ({
      id: row.id,
      employer_id: row.employer_id,
      business_name: row.business_name,
      email: row.email,
      square_customer_id: row.square_customer_id,
      square_subscription_id: row.square_subscription_id,
      status: row.status,
      expires_at: row.expires_at,
      used_at: row.used_at,
      created_at: row.created_at,
      onboarding_url: row.token ? buildOnboardingUrl(row.token) : null,
      employer_access_status: row.access_status,
      employer_onboarding_completed: !!row.onboarding_completed,
    }))

    res.json({
      success: true,
      tokens,
    })
  } catch (error) {
    console.error('GET /api/admin/tokens error:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to fetch onboarding tokens.',
    })
  }
})

app.post('/api/admin/employers/:id/approve', requireAdminAuth, async (req, res) => {
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
      SET
        access_status = 'active',
        subscription_status = CASE
          WHEN subscription_status IS NULL OR subscription_status = '' THEN 'active'
          ELSE subscription_status
        END,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
      `,
      [employerId]
    )

    res.json({
      success: true,
      message: 'Employer approved and activated.',
    })
  } catch (error) {
    console.error('POST /api/admin/employers/:id/approve error:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to approve employer.',
    })
  }
})

app.delete('/api/admin/jobs/:id', requireAdminAuth, async (req, res) => {
  try {
    const jobId = Number(req.params.id)

    if (!jobId) {
      return res.status(400).json({
        success: false,
        error: 'A valid job ID is required.',
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
      message: 'Job removed successfully.',
    })
  } catch (error) {
    console.error('DELETE /api/admin/jobs/:id error:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to remove job.',
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

    // An unused onboarding link would otherwise set the account active again.
    await revokePendingTokensForEmployer(connection, employerId)

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
      error: 'Failed to deactivate employer.',
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
      error: 'Failed to reactivate employer.',
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
      error: 'Failed to revoke onboarding token.',
    })
  }
})

// ── Square quick-pay helper (used by cover letter and interview prep) ─────────

async function createSquareQuickPayLink({ name, priceCents, currency, note, redirectUrl }) {
  if (!SQUARE_ACCESS_TOKEN || !SQUARE_LOCATION_ID) {
    throw new Error('Square checkout is not configured.')
  }
  const payload = {
    idempotency_key: crypto.randomUUID(),
    quick_pay: {
      name,
      price_money: { amount: priceCents, currency: currency || 'USD' },
      location_id: SQUARE_LOCATION_ID,
    },
    checkout_options: { redirect_url: redirectUrl, ask_for_shipping_address: false },
    payment_note: note,
  }
  const response = await squareApiRequest('/v2/online-checkout/payment-links', { method: 'POST', body: payload })
  const url = response?.payment_link?.url
  if (!url) throw new Error('Square did not return a checkout URL.')
  return { checkoutUrl: url, orderId: response?.payment_link?.order_id || null }
}

// ── Job Scraper ──────────────────────────────────────────────────────────────

// Passenger restarts the app every few hours, so an in-memory 24 h timer never
// fires. Instead the app checks hourly and scrapes when the DB says the last
// run is over SCRAPE_MIN_AGE_MS old. The upsert in jobScraper.js sets
// updated_at = NOW() on every row it sees, so MAX(updated_at) of scraped rows
// is the last successful scrape. A MySQL named lock keeps two Passenger
// processes from scraping at once; scrapeRunning covers this process.
const SCRAPE_SOURCES = ['edgecombe_county', 'tarboro', 'usajobs', 'ecu_health', 'ecps', 'abb', 'pinetops']
const SCRAPE_MIN_AGE_MS = 20 * 60 * 60 * 1000
const SCRAPE_FIRST_CHECK_MS = 2 * 60 * 1000
const SCRAPE_CHECK_EVERY_MS = 60 * 60 * 1000
let scrapeRunning = false

async function getLastScrapeAt() {
  const [rows] = await pool.query(
    // expireOpenJobs also bumps updated_at, so expired rows don't count as a scrape.
    `SELECT MAX(updated_at) AS last_scrape_at FROM job_posts WHERE source IN (?) AND status <> 'expired'`,
    [SCRAPE_SOURCES]
  )
  return rows[0]?.last_scrape_at || null
}

// Returns { busy: true } when a run is already going (here or in another
// process), { skipped: true } when onlyIfStale and the last run is recent,
// otherwise the runAllScrapers result.
async function runScrapeExclusive({ onlyIfStale, trigger }) {
  if (scrapeRunning) return { busy: true }
  scrapeRunning = true
  let connection = null
  try {
    connection = await pool.getConnection()
    const [lockRows] = await connection.query(`SELECT GET_LOCK('tarborojobs_scrape', 0) AS got`)
    if (Number(lockRows[0]?.got) !== 1) return { busy: true }

    try {
      if (onlyIfStale) {
        const lastScrapeAt = await getLastScrapeAt()
        if (lastScrapeAt && Date.now() - new Date(lastScrapeAt).getTime() < SCRAPE_MIN_AGE_MS) {
          return { skipped: true, lastScrapeAt }
        }
      }
      console.log(`[scraper] start (${trigger})`)
      const result = await runAllScrapers(pool)
      console.log(`[scraper] finished (${trigger}): imported ${result?.imported ?? 0}, updated ${result?.updated ?? 0}, closed ${result?.closed ?? 0}, errors ${result?.errors?.length ?? 0}`)
      if ((result?.imported ?? 0) > 0 || (result?.closed ?? 0) > 0) indexnow.notifyChanged()
      return result
    } finally {
      await connection.query(`SELECT RELEASE_LOCK('tarborojobs_scrape')`).catch(() => {})
    }
  } finally {
    connection?.release()
    scrapeRunning = false
  }
}

// Same hourly-check idea as the scraper: each employer whose last sync is over
// SUBSCRIPTION_SYNC_MIN_AGE_HOURS old (or never) is synced, so the run is
// daily per employer and a failed one retries next hour. onlyIfStale false
// (admin button) syncs every Square-billed employer. Own named lock.
let subscriptionSyncRunning = false

async function runSubscriptionSyncExclusive({ onlyIfStale, trigger }) {
  if (!isSquareSubscriptionSyncConfigured()) return { skipped: true }
  if (subscriptionSyncRunning) return { busy: true }
  subscriptionSyncRunning = true
  let connection = null
  try {
    connection = await pool.getConnection()
    const [lockRows] = await connection.query(`SELECT GET_LOCK('tarborojobs_subscription_sync', 0) AS got`)
    if (Number(lockRows[0]?.got) !== 1) return { busy: true }

    try {
      const [employers] = await pool.query(
        `
        SELECT ${EMPLOYER_SUBSCRIPTION_COLUMNS}
        FROM employers
        WHERE (square_customer_id <> '' OR square_subscription_id <> '')
          ${onlyIfStale ? `AND (subscription_synced_at IS NULL OR subscription_synced_at < NOW() - INTERVAL ${SUBSCRIPTION_SYNC_MIN_AGE_HOURS} HOUR)` : ''}
        ORDER BY id
        `
      )
      if (onlyIfStale && !employers.length) return { skipped: true }

      const result = { checked: 0, updated: 0, errors: [] }
      for (const employer of employers) {
        result.checked += 1
        try {
          const outcome = await syncEmployerSubscription(employer)
          if (outcome.updated) result.updated += 1
          if (outcome.message) result.errors.push({ employerId: employer.id, message: outcome.message })
        } catch (error) {
          console.error(`[subscriptions] sync for employer ${employer.id} failed; access left as-is:`, error?.message || error)
          result.errors.push({ employerId: employer.id, message: error?.message || String(error) })
        }
      }
      console.log(`[subscriptions] sync finished (${trigger}): checked ${result.checked}, updated ${result.updated}, errors ${result.errors.length}`)
      return result
    } finally {
      await connection.query(`SELECT RELEASE_LOCK('tarborojobs_subscription_sync')`).catch(() => {})
    }
  } finally {
    connection?.release()
    subscriptionSyncRunning = false
  }
}

function scheduleScrapes() {
  const check = () => Promise.all([
    runScrapeExclusive({ onlyIfStale: true, trigger: 'schedule' })
      .catch((error) => console.error('[scraper] scheduled run failed:', error))
      // After the scrape so a run that changed jobs has already pinged; this is the once-a-day ping.
      .then(() => indexnow.notifyChanged({ ifDue: true })),
    runSubscriptionSyncExclusive({ onlyIfStale: true, trigger: 'schedule' })
      .catch((error) => console.error('[subscriptions] scheduled sync failed:', error)),
    analytics.purgeOldEvents().catch((error) => console.error('[analytics] purge failed:', error?.message || error)),
    jobAlerts.runDigests({ trigger: 'schedule' })
      .catch((error) => console.error('[alerts] scheduled digest run failed:', error)),
    facebook.postNewJobs(),
    sharePack.sendDailyPack().catch((error) => console.error('[share-pack] scheduled send failed:', error?.message || error)),
    selfServe.cleanupUnpaidJobPosts().catch((error) => console.error('[job-post] unpaid cleanup failed:', error?.message || error)),
  ])
  setTimeout(check, SCRAPE_FIRST_CHECK_MS)
  setInterval(check, SCRAPE_CHECK_EVERY_MS)
}

// Deploy check for the client-IP and secret setup. Returns no secret values.
app.get('/api/admin/diagnostics', requireAdminAuth, async (req, res) => {
  try {
    const forwardedHeaders = {}
    for (const name of ['x-forwarded-for', 'x-real-ip', 'forwarded', 'cf-connecting-ip', 'x-client-ip', 'true-client-ip']) {
      if (req.headers[name] !== undefined) forwardedHeaders[name] = req.headers[name]
    }
    const [adminRows] = await pool.query(`SELECT COUNT(*) AS admin_count FROM employer_users WHERE is_admin = 1`)

    res.json({
      success: true,
      ip: req.ip ?? null,
      socketAddress: req.socket?.remoteAddress ?? null,
      forwardedHeaders,
      trustProxy: String(app.get('trust proxy')),
      rateLimitKey: getRequestIp(req),
      jwtSecretConfigured: JWT_SECRET_CONFIGURED,
      adminUserCount: Number(adminRows[0]?.admin_count || 0),
      lastScrapeAt: await getLastScrapeAt(),
      indexnow: indexnow.status(),
    })
  } catch (error) {
    console.error('GET /api/admin/diagnostics error:', error)
    res.status(500).json({ success: false, error: 'Failed to load diagnostics.' })
  }
})

app.post('/api/admin/subscriptions/sync', requireAdminAuth, async (req, res) => {
  try {
    if (!isSquareSubscriptionSyncConfigured()) {
      return res.status(400).json({
        success: false,
        error: 'Square subscription sync is not configured. Set the Square access token and subscription plan ID first.',
      })
    }

    const result = await runSubscriptionSyncExclusive({ onlyIfStale: false, trigger: 'admin' })
    if (result.busy) {
      return res.status(409).json({
        success: false,
        error: 'A subscription sync is already running. Try again in a minute.',
      })
    }

    res.json({
      success: true,
      checked: result.checked,
      updated: result.updated,
      errors: result.errors,
    })
  } catch (error) {
    console.error('POST /api/admin/subscriptions/sync error:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to sync subscriptions.',
    })
  }
})

app.post('/api/admin/scrape-jobs', requireAdminAuth, async (req, res) => {
  try {
    const result = await runScrapeExclusive({ onlyIfStale: false, trigger: 'admin' })
    if (result.busy) {
      return res.status(409).json({ success: false, error: 'A job scrape is already running. Try again in a few minutes.' })
    }
    res.json({ success: true, ...result })
  } catch (error) {
    console.error('POST /api/admin/scrape-jobs error:', error)
    res.status(500).json({ success: false, error: 'Scrape failed.' })
  }
})

// ── Paid AI products (cover letter, interview prep) ────────────────────────────
// Anthropic is only called after an order is paid. The generate endpoints save
// the customer's inputs and create the Square checkout; the Square webhook (or
// the local dev bypass) marks the order paid and starts the generation in the
// background, retrying once. The result endpoints report 'preparing' until the
// content is saved.

const COVER_LETTER_PRICE_CENTS = 499
const INTERVIEW_PREP_PRICE_CENTS = 499
const AI_ORDER_MAX_ATTEMPTS = 2 // first try + one retry
// A 'generating' claim older than this is treated as lost (for example a
// restart mid-call) and may be claimed again. Keep it well above
// AI_ORDER_MAX_ATTEMPTS x the 60 s Anthropic fetch timeout in aiService.js.
const AI_ORDER_STALE_MINUTES = 10

const AI_PRODUCTS = {
  cover_letter: {
    table: 'cover_letter_requests',
    contentColumn: 'letter_text',
    notePrefix: 'cover_letter:',
    name: 'Cover Letter',
    priceCents: COVER_LETTER_PRICE_CENTS,
    resultPage: 'cover-letter-result',
    async generate(row) {
      const { letterText, usage } = await generateCoverLetter({
        jobTitle: row.job_title,
        jobDescription: row.job_description || '',
        userName: row.user_name,
        userBackground: row.user_background,
      })
      return { content: letterText, usage }
    },
    present(content) {
      return { letter: content, letterText: content }
    },
  },
  interview_prep: {
    table: 'interview_prep_requests',
    contentColumn: 'questions_json',
    notePrefix: 'interview_prep:',
    name: 'Interview Prep Pack',
    priceCents: INTERVIEW_PREP_PRICE_CENTS,
    resultPage: 'interview-prep-result',
    async generate(row) {
      const { questions, usage } = await generateInterviewPrep({
        jobTitle: row.job_title,
        jobDescription: row.job_description || '',
      })
      return { content: JSON.stringify(questions), usage }
    },
    present(content) {
      try {
        return { questions: JSON.parse(content) }
      } catch {
        return { questions: [] }
      }
    },
  },
}

function getAiProduct(productKey) {
  return Object.prototype.hasOwnProperty.call(AI_PRODUCTS, productKey) ? AI_PRODUCTS[productKey] : null
}

function roundCents(value) {
  return Math.round((Number(value) || 0) * 10000) / 10000
}

function buildAiResultUrl(product, publicToken) {
  const base = String(APP_BASE_URL || '').replace(/\/+$/, '')
  return `${base}/?page=${product.resultPage}&token=${encodeURIComponent(publicToken)}`
}

// Rows made by the old flow already have their content, so paying for them
// needs no AI call. New rows go to 'pending' and wait for the generation.
function aiStatusWhenPaidSql(product) {
  return `CASE
        WHEN ${product.contentColumn} IS NOT NULL AND ${product.contentColumn} <> '' THEN COALESCE(ai_status, 'ready')
        ELSE COALESCE(ai_status, 'pending')
      END`
}

async function findAiOrderByToken(product, publicToken) {
  if (!publicToken) return null
  const [rows] = await pool.query(`SELECT * FROM ${product.table} WHERE public_token = ? LIMIT 1`, [publicToken])
  return rows[0] || null
}

// Creates the Square link once per order and reuses it afterwards, so the
// generate and create-checkout calls never open two payments for one order.
async function ensureAiOrderCheckout(product, row) {
  if (row.square_checkout_url) return row.square_checkout_url

  const { checkoutUrl, orderId } = await createSquareQuickPayLink({
    name: product.name,
    priceCents: Number(row.price_cents) || product.priceCents,
    currency: 'USD',
    note: `${product.notePrefix}${row.public_token}`,
    redirectUrl: buildAiResultUrl(product, row.public_token),
  })

  await pool.query(
    `UPDATE ${product.table} SET square_checkout_url = ?, square_order_id = COALESCE(?, square_order_id) WHERE id = ?`,
    [checkoutUrl, orderId, row.id]
  )
  return checkoutUrl
}

// The generate endpoints create the checkout up front. Under the dev bypass,
// or when Square fails, they return checkoutUrl null and the page's
// create-checkout call handles it (and reports any Square error).
async function createAiOrderCheckoutSafely(product, row) {
  if (RESUME_CHECKER_DEV_BYPASS) return null
  try {
    return await ensureAiOrderCheckout(product, row)
  } catch (error) {
    console.error(`[ai-order] checkout for ${row.public_token} failed:`, error?.message || error)
    return null
  }
}

// Atomically moves a paid order that has no content yet to 'generating'. Only
// one caller wins, so the webhook, result polling and an admin rerun never
// generate the same order twice at once.
async function claimAiOrder(product, orderId, { allowFailed = false } = {}) {
  const [result] = await pool.query(
    `
    UPDATE ${product.table}
    SET ai_status = 'generating', ai_started_at = CURRENT_TIMESTAMP, ai_error = NULL
    WHERE id = ?
      AND payment_status = 'paid'
      AND (${product.contentColumn} IS NULL OR ${product.contentColumn} = '')
      AND (
        ai_status IS NULL
        OR ai_status = 'pending'
        ${allowFailed ? "OR ai_status = 'failed'" : ''}
        OR (ai_status = 'generating' AND ai_started_at < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL ${AI_ORDER_STALE_MINUTES} MINUTE))
      )
    `,
    [orderId]
  )

  return result.affectedRows === 1
}

// Generates the content for a paid order, retrying once. Token usage and the
// estimated cost of every attempt are added to the row. A final failure is
// saved as ai_status='failed' with the error, so the order can be rerun from
// the admin dashboard or refunded in Square.
async function runAiOrder(productKey, orderId, options = {}) {
  const product = getAiProduct(productKey)
  if (!product || !orderId) return 'skipped'
  if (!(await claimAiOrder(product, orderId, options))) return 'skipped'

  const [rows] = await pool.query(`SELECT * FROM ${product.table} WHERE id = ? LIMIT 1`, [orderId])
  const row = rows[0]
  if (!row || row.payment_status !== 'paid') return 'skipped'

  const spent = { inputTokens: 0, outputTokens: 0, costCents: 0 }
  const addUsage = (usage) => {
    if (!usage) return
    spent.inputTokens += Number(usage.inputTokens) || 0
    spent.outputTokens += Number(usage.outputTokens) || 0
    spent.costCents += Number(usage.costCents) || 0
  }

  let generated = null
  let lastError = null
  let attempts = 0
  while (!generated && attempts < AI_ORDER_MAX_ATTEMPTS) {
    attempts += 1
    try {
      generated = await product.generate(row)
      addUsage(generated.usage)
    } catch (error) {
      addUsage(error?.usage)
      lastError = error
      console.error(`[ai-order] ${productKey} #${orderId} attempt ${attempts} failed:`, error?.message || error)
    }
  }

  const usageParams = [attempts, spent.inputTokens, spent.outputTokens, roundCents(spent.costCents)]
  // Only write if the claim is still ours: a stale-claim takeover changes
  // ai_started_at, and that run owns the row from then on.
  const ownClaimSql = `AND ai_status = 'generating' AND ai_started_at = ?`
  const lostClaim = (result) => {
    if (result?.affectedRows === 0) console.warn(`[ai-order] ${productKey} #${orderId} claim was taken over; result discarded`)
  }

  if (generated) {
    const [saved] = await pool.query(
      `
      UPDATE ${product.table}
      SET
        ${product.contentColumn} = ?,
        ai_status = 'ready',
        ai_error = NULL,
        ai_completed_at = CURRENT_TIMESTAMP,
        ai_attempts = ai_attempts + ?,
        ai_input_tokens = ai_input_tokens + ?,
        ai_output_tokens = ai_output_tokens + ?,
        ai_cost_cents = ai_cost_cents + ?
      WHERE id = ? ${ownClaimSql}
      `,
      [generated.content, ...usageParams, orderId, row.ai_started_at]
    )
    lostClaim(saved)
    console.log(
      `[ai-order] ${productKey} #${orderId} ready: ${spent.inputTokens} in / ${spent.outputTokens} out tokens, about ${roundCents(spent.costCents)} cents`
    )
    return 'ready'
  }

  const [failed] = await pool.query(
    `
    UPDATE ${product.table}
    SET
      ai_status = 'failed',
      ai_error = ?,
      ai_completed_at = CURRENT_TIMESTAMP,
      ai_attempts = ai_attempts + ?,
      ai_input_tokens = ai_input_tokens + ?,
      ai_output_tokens = ai_output_tokens + ?,
      ai_cost_cents = ai_cost_cents + ?
    WHERE id = ? ${ownClaimSql}
    `,
    [safeTrim(lastError?.message || 'AI generation failed.', 2000), ...usageParams, orderId, row.ai_started_at]
  )
  lostClaim(failed)
  return 'failed'
}

function startAiOrder(productKey, orderId, options) {
  runAiOrder(productKey, orderId, options).catch((error) => {
    console.error(`[ai-order] ${productKey} #${orderId} could not run:`, error)
  })
}

// The one place an AI order becomes paid and starts generating. Used by the
// Square webhook and by Job Seeker Kit credits (paidVia: 'credit', onlyIfUnpaid:
// true, so a credit can never re-pay an order). Returns true when it ran.
async function markAiOrderPaid(productKey, row, { paymentId = null, squareOrderId = null, paidVia = null, onlyIfUnpaid = false } = {}) {
  const product = AI_PRODUCTS[productKey]
  const [result] = await pool.query(
    `
    UPDATE ${product.table}
    SET
      payment_status = 'paid',
      paid_at = COALESCE(paid_at, CURRENT_TIMESTAMP),
      square_payment_id = COALESCE(square_payment_id, ?),
      square_order_id = COALESCE(square_order_id, ?),
      ${paidVia ? 'paid_via = COALESCE(paid_via, ?),' : ''}
      ai_status = ${aiStatusWhenPaidSql(product)}
    WHERE id = ?${onlyIfUnpaid ? " AND payment_status <> 'paid'" : ''}
    `,
    [paymentId || null, squareOrderId || null, ...(paidVia ? [paidVia] : []), row.id]
  )
  if (onlyIfUnpaid && result?.affectedRows !== 1) return false

  startAiOrder(productKey, row.id)
  return true
}

// Called by the Square webhook with a payment fetched from the Square API.
// Returns the product type when the payment note belongs to an AI order.
// The order is only marked paid when Square says the payment is completed
// and the amount covers the order price in USD.
async function tryHandleAiProductPayment(payment) {
  const note = safeTrim(payment?.note, 500)
  const productKey = Object.keys(AI_PRODUCTS).find((key) => note.startsWith(AI_PRODUCTS[key].notePrefix))
  if (!productKey) return null

  const product = AI_PRODUCTS[productKey]
  const publicToken = note.slice(product.notePrefix.length).trim()
  if (!publicToken) return null

  const row = await findAiOrderByToken(product, publicToken)
  if (!row) return productKey

  const paymentStatus = String(payment.status || '').toLowerCase()
  if (paymentStatus !== 'completed') return productKey

  const paidCents = Number(payment.amount_money?.amount) || 0
  const paidCurrency = String(payment.amount_money?.currency || '').toUpperCase()
  const priceCents = Number(row.price_cents) || product.priceCents
  if (paidCents < priceCents || paidCurrency !== 'USD') {
    console.error(
      `[ai-order] ${productKey} ${publicToken}: payment ${payment.id} of ${paidCents} ${paidCurrency} does not cover ${priceCents} USD; not marking paid`
    )
    return productKey
  }

  await markAiOrderPaid(productKey, row, { paymentId: payment.id, squareOrderId: payment.order_id })
  return productKey
}

async function handleAiOrderCreateCheckout(productKey, req, res) {
  const product = getAiProduct(productKey)
  try {
    const publicToken = safeTrim(req.body?.publicToken, 64)
    const row = await findAiOrderByToken(product, publicToken)
    if (!row) return res.status(404).json({ success: false, error: 'Request not found.' })

    const resultUrl = buildAiResultUrl(product, publicToken)
    if (row.payment_status === 'paid') {
      return res.json({ success: true, alreadyPaid: true, checkoutUrl: resultUrl })
    }

    // LOCAL TESTING ONLY (see RESUME_CHECKER_DEV_BYPASS): mark the order paid
    // without Square and start the generation exactly as the webhook would.
    if (RESUME_CHECKER_DEV_BYPASS) {
      await pool.query(
        `
        UPDATE ${product.table}
        SET
          payment_status = 'paid',
          paid_at = COALESCE(paid_at, CURRENT_TIMESTAMP),
          square_payment_id = COALESCE(square_payment_id, 'dev-bypass'),
          ai_status = ${aiStatusWhenPaidSql(product)}
        WHERE id = ?
        `,
        [row.id]
      )
      console.warn(`[${productKey}] DEV BYPASS - marked ${publicToken} as paid without Square`)
      startAiOrder(productKey, row.id)
      return res.json({ success: true, devBypass: true, checkoutUrl: resultUrl })
    }

    const checkoutUrl = await ensureAiOrderCheckout(product, row)
    res.json({ success: true, checkoutUrl })
  } catch (error) {
    console.error(`[${productKey}] create-checkout error:`, error)
    res.status(500).json({ success: false, error: 'Failed to create checkout.' })
  }
}

async function handleAiOrderResult(productKey, req, res) {
  const product = getAiProduct(productKey)
  try {
    const row = await findAiOrderByToken(product, safeTrim(req.params.token, 64))
    if (!row) return res.status(404).json({ success: false, error: 'Not found.' })

    const summary = {
      success: true,
      jobTitle: row.job_title,
      priceCents: row.price_cents,
      currency: 'USD',
      paymentStatus: row.payment_status,
    }

    if (row.payment_status !== 'paid') {
      return res.json({ ...summary, paid: false, status: 'awaiting_payment' })
    }

    const content = row[product.contentColumn]
    if (content) {
      return res.json({ ...summary, paid: true, status: 'ready', ...product.present(content) })
    }

    // Paid but not ready yet. `paid` stays false until the content exists so
    // the pages keep polling instead of showing an empty result; `status` and
    // `paymentStatus` say what is happening.
    if (row.ai_status === 'failed') {
      return res.json({
        ...summary,
        paid: false,
        status: 'failed',
        message: 'Your payment went through, but we could not prepare your order. We will rerun it or refund you.',
      })
    }

    // Restarts the generation if the webhook's run was lost. The claim is
    // atomic, so a run already in progress is left alone.
    startAiOrder(productKey, row.id)
    return res.json({
      ...summary,
      paid: false,
      status: 'preparing',
      message: 'Payment received. We are preparing your order now; this takes a few seconds.',
    })
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to retrieve result.' })
  }
}

// ── Cover Letter ──────────────────────────────────────────────────────────────

app.post('/api/cover-letter/generate', async (req, res) => {
  try {
    if (!consumeCoverLetterRate(getRequestIp(req))) {
      return res.status(429).json({ success: false, error: 'Too many requests in a short window. Please try again later.' })
    }

    const body = req.body || {}
    const jobTitle = safeTrim(body.jobTitle, 255)
    const jobDescription = safeTrim(body.jobDescription, 8000)
    // The page sends fullName/background; userName/userBackground are kept for older clients.
    const userName = safeTrim(body.userName || body.fullName, 255)
    const userBackground = safeTrim(body.userBackground || body.background, 8000)
    if (!jobTitle || !userName || !userBackground) {
      return res.status(400).json({ success: false, error: 'Full name, job title, and background are required.' })
    }

    // No AI call here: the letter is written after the payment is confirmed.
    const publicToken = `cl_${crypto.randomBytes(18).toString('base64url')}`
    const [result] = await pool.query(
      `INSERT INTO cover_letter_requests (public_token, job_title, job_description, user_name, user_background, price_cents, ai_status)
       VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
      [publicToken, jobTitle, jobDescription, userName, userBackground, COVER_LETTER_PRICE_CENTS]
    )

    const checkoutUrl = await createAiOrderCheckoutSafely(AI_PRODUCTS.cover_letter, {
      id: result.insertId,
      public_token: publicToken,
      price_cents: COVER_LETTER_PRICE_CENTS,
    })
    res.json({ success: true, publicToken, checkoutUrl, priceCents: COVER_LETTER_PRICE_CENTS, currency: 'USD' })
  } catch (error) {
    console.error('POST /api/cover-letter/generate error:', error)
    res.status(500).json({ success: false, error: 'Failed to save cover letter request.' })
  }
})

app.post('/api/cover-letter/create-checkout', (req, res) => handleAiOrderCreateCheckout('cover_letter', req, res))

app.get('/api/cover-letter/result/:token', (req, res) => handleAiOrderResult('cover_letter', req, res))

// ── Interview Prep ────────────────────────────────────────────────────────────

app.post('/api/interview-prep/generate', async (req, res) => {
  try {
    if (!consumeInterviewPrepRate(getRequestIp(req))) {
      return res.status(429).json({ success: false, error: 'Too many requests in a short window. Please try again later.' })
    }

    const body = req.body || {}
    const jobTitle = safeTrim(body.jobTitle, 255)
    const jobDescription = safeTrim(body.jobDescription, 8000)
    if (!jobTitle) return res.status(400).json({ success: false, error: 'jobTitle is required.' })

    // No AI call here: the questions are written after the payment is confirmed.
    const publicToken = `ip_${crypto.randomBytes(18).toString('base64url')}`
    const [result] = await pool.query(
      `INSERT INTO interview_prep_requests (public_token, job_title, job_description, price_cents, ai_status)
       VALUES (?, ?, ?, ?, 'pending')`,
      [publicToken, jobTitle, jobDescription, INTERVIEW_PREP_PRICE_CENTS]
    )

    const checkoutUrl = await createAiOrderCheckoutSafely(AI_PRODUCTS.interview_prep, {
      id: result.insertId,
      public_token: publicToken,
      price_cents: INTERVIEW_PREP_PRICE_CENTS,
    })
    res.json({ success: true, publicToken, checkoutUrl, priceCents: INTERVIEW_PREP_PRICE_CENTS, currency: 'USD' })
  } catch (error) {
    console.error('POST /api/interview-prep/generate error:', error)
    res.status(500).json({ success: false, error: 'Failed to save interview prep request.' })
  }
})

app.post('/api/interview-prep/create-checkout', (req, res) => handleAiOrderCreateCheckout('interview_prep', req, res))

app.get('/api/interview-prep/result/:token', (req, res) => handleAiOrderResult('interview_prep', req, res))

// ── Admin: AI product orders ───────────────────────────────────────────────────

const AI_ORDERS_SQL = `
  SELECT 'cover_letter' AS product, id, job_title, payment_status, ai_status, ai_error, ai_attempts,
    price_cents, ai_input_tokens, ai_output_tokens, ai_cost_cents, created_at, paid_at, paid_via
  FROM cover_letter_requests
  UNION ALL
  SELECT 'interview_prep' AS product, id, job_title, payment_status, ai_status, ai_error, ai_attempts,
    price_cents, ai_input_tokens, ai_output_tokens, ai_cost_cents, created_at, paid_at, paid_via
  FROM interview_prep_requests
`

function buildAiOrderTotals(paidOrders, salesCents, aiCostCents) {
  const sales = Number(salesCents || 0)
  const cost = roundCents(aiCostCents)
  return {
    paid_orders: Number(paidOrders || 0),
    sales_cents: sales,
    ai_cost_cents: cost,
    profit_cents: roundCents(sales - cost),
  }
}

// Sales, estimated AI cost and profit for this month and all time, plus the
// latest orders. Profit is before Square fees.
app.get('/api/admin/ai-orders', requireAdminAuth, async (req, res) => {
  try {
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

    const [totalsResult, recentResult, jobDrafts] = await Promise.all([
      pool.query(
        `
        SELECT
          product,
          SUM(CASE WHEN payment_status = 'paid' THEN 1 ELSE 0 END) AS paid_orders,
          SUM(CASE WHEN payment_status = 'paid' AND COALESCE(paid_via, '') <> 'credit' THEN price_cents ELSE 0 END) AS sales_cents,
          SUM(ai_cost_cents) AS ai_cost_cents,
          SUM(CASE WHEN payment_status = 'paid' AND ai_status = 'failed' THEN 1 ELSE 0 END) AS failed_orders,
          SUM(CASE WHEN payment_status = 'paid' AND COALESCE(paid_at, created_at) >= ? THEN 1 ELSE 0 END) AS month_paid_orders,
          SUM(CASE WHEN payment_status = 'paid' AND COALESCE(paid_at, created_at) >= ? AND COALESCE(paid_via, '') <> 'credit' THEN price_cents ELSE 0 END) AS month_sales_cents,
          SUM(CASE WHEN COALESCE(paid_at, created_at) >= ? THEN ai_cost_cents ELSE 0 END) AS month_ai_cost_cents
        FROM (${AI_ORDERS_SQL}) orders
        GROUP BY product
        `,
        [monthStart, monthStart, monthStart]
      ),
      pool.query(
        `
        SELECT *
        FROM (${AI_ORDERS_SQL}) orders
        ORDER BY created_at DESC, id DESC
        LIMIT 25
        `
      ),
      // Free "Write it for me" drafts for employers: cost only, no sales.
      selfServe.getJobDraftCosts(monthStart).catch((error) => {
        console.error('GET /api/admin/ai-orders job draft costs error:', error?.message || error)
        return null
      }),
    ])

    const [totalsRows] = totalsResult
    const [recentRows] = recentResult

    const byProduct = totalsRows.map((row) => ({
      product: row.product,
      all_time: buildAiOrderTotals(row.paid_orders, row.sales_cents, row.ai_cost_cents),
      this_month: buildAiOrderTotals(row.month_paid_orders, row.month_sales_cents, row.month_ai_cost_cents),
      failed_orders: Number(row.failed_orders || 0),
    }))

    const sumTotals = (period) =>
      buildAiOrderTotals(
        byProduct.reduce((sum, item) => sum + item[period].paid_orders, 0),
        byProduct.reduce((sum, item) => sum + item[period].sales_cents, 0),
        byProduct.reduce((sum, item) => sum + item[period].ai_cost_cents, 0)
      )

    res.json({
      success: true,
      month_start: monthStart,
      cost_note: 'AI cost is estimated from published Anthropic rates; the Anthropic Console bill is the source of truth. Profit is before Square fees.',
      this_month: sumTotals('this_month'),
      all_time: {
        ...sumTotals('all_time'),
        failed_orders: byProduct.reduce((sum, item) => sum + item.failed_orders, 0),
      },
      by_product: byProduct,
      job_drafts: jobDrafts,
      recent_orders: recentRows.map((row) => ({
        product: row.product,
        id: row.id,
        job_title: row.job_title,
        payment_status: row.payment_status,
        ai_status: row.ai_status,
        ai_error: row.ai_error,
        ai_attempts: Number(row.ai_attempts || 0),
        price_cents: Number(row.price_cents || 0),
        ai_input_tokens: Number(row.ai_input_tokens || 0),
        ai_output_tokens: Number(row.ai_output_tokens || 0),
        ai_cost_cents: roundCents(row.ai_cost_cents),
        created_at: row.created_at,
        paid_at: row.paid_at,
      })),
    })
  } catch (error) {
    console.error('GET /api/admin/ai-orders error:', error)
    res.status(500).json({ success: false, error: 'Failed to load AI product orders.' })
  }
})

// Reruns a paid order whose generation failed (or never finished).
app.post('/api/admin/ai-orders/:product/:id/rerun', requireAdminAuth, async (req, res) => {
  try {
    const productKey = safeTrim(req.params.product, 32)
    const orderId = Number(req.params.id)
    if (!getAiProduct(productKey) || !orderId) {
      return res.status(400).json({ success: false, error: 'A valid product and order ID are required.' })
    }

    const outcome = await runAiOrder(productKey, orderId, { allowFailed: true })
    if (outcome === 'skipped') {
      return res.status(409).json({
        success: false,
        error: 'This order is unpaid, already has its content, or is being generated right now.',
      })
    }

    res.json({
      success: true,
      outcome,
      message:
        outcome === 'ready'
          ? 'Order regenerated.'
          : 'The rerun failed again. Check the error, and refund the customer in Square if needed.',
    })
  } catch (error) {
    console.error('POST /api/admin/ai-orders/:product/:id/rerun error:', error)
    res.status(500).json({ success: false, error: 'Failed to rerun the order.' })
  }
})

// Free employer signup, pay-per-post listings, AI job drafts, review queue.
const selfServe = registerEmployerSelfServe({
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
})

// Must be registered before the static catch-all and the /api 404 below.
const analytics = registerAnalytics({
  app,
  pool,
  createIpRateLimiter,
  getRequestIp,
  requireAdminAuth,
  prices: { resume_check: RESUME_CHECKER_PRICE_CENTS },
})

// IndexNow: serves the key file and pings Bing/Yandex when jobs change.
const indexnow = registerIndexNow({ app, pool, APP_BASE_URL, jwtSecret: JWT_SECRET })

// Email job alerts: routes plus the digest the hourly scheduler runs.
const jobAlerts = registerJobAlerts({
  app,
  pool,
  getMailer,
  getMailFrom,
  createIpRateLimiter,
  getRequestIp,
  requireAdminAuth,
  escapeHtml,
  formatPay: formatPayDisplay,
  APP_BASE_URL,
  ipHashSecret: JWT_SECRET,
})

// Facebook Page auto-post: inert unless FACEBOOK_PAGE_ID and FACEBOOK_PAGE_ACCESS_TOKEN are set.
const facebook = registerFacebook({ app, pool, requireAdminAuth, formatPay: formatPayDisplay, APP_BASE_URL })
// Daily "jobs to share" email to the admins; works without a Facebook Page.
const sharePack = registerSharePack({ app, pool, getMailer, getMailFrom, requireAdminAuth, formatPay: formatPayDisplay, APP_BASE_URL, adminEmails: ADMIN_EMAILS })
// Job Seeker Kit ($12.99: one Resume Check + Cover Letter + Interview Prep).
// Redeeming a credit marks the tool's own order paid via the same functions
// the Square webhook uses (markAiOrderPaid / the resume check paid UPDATE).
const BUNDLE_PRICE_CENTS = Number.parseInt(process.env.BUNDLE_PRICE_CENTS, 10) > 0 ? Number.parseInt(process.env.BUNDLE_PRICE_CENTS, 10) : 1299
function aiRedeemTarget(productKey) {
  const product = AI_PRODUCTS[productKey]
  return {
    find: (token) => findAiOrderByToken(product, token),
    markPaid: (row) => markAiOrderPaid(productKey, row, { paymentId: 'kit-credit', paidVia: 'credit', onlyIfUnpaid: true }),
    resultUrl: (token) => buildAiResultUrl(product, token),
  }
}
const bundles = registerBundles({
  app,
  pool,
  safeTrim,
  createIpRateLimiter,
  getRequestIp,
  requireAdminAuth,
  createSquareQuickPayLink,
  APP_BASE_URL,
  devBypass: RESUME_CHECKER_DEV_BYPASS,
  priceCents: BUNDLE_PRICE_CENTS,
  targets: {
    resume_check: {
      find: findResumeCheckByToken,
      markPaid: async (row) => {
        const [result] = await pool.query(
          `UPDATE resume_checks
           SET payment_status = 'paid', paid_at = COALESCE(paid_at, CURRENT_TIMESTAMP),
               square_payment_id = COALESCE(square_payment_id, 'kit-credit'), paid_via = 'credit'
           WHERE id = ? AND payment_status <> 'paid'`,
          [row.id]
        )
        return result?.affectedRows === 1
      },
      resultUrl: buildResumeReportUrl,
    },
    cover_letter: aiRedeemTarget('cover_letter'),
    interview_prep: aiRedeemTarget('interview_prep'),
  },
})

// Featured listings and claim-this-listing: routes, webhook handler, tables.
const featured = registerFeatured({
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
  adminEmails: ADMIN_EMAILS,
  buildPasswordResetUrl: buildEmployerPasswordResetUrl,
  sha256,
  APP_BASE_URL,
})

// Job seeker accounts: magic-link sign-in, profile, one-click apply, saved jobs.
const seekers = registerSeekers({
  app,
  pool,
  jwtSecret: JWT_SECRET,
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
})

if (fs.existsSync(frontendIndexFile)) {
  // HTML pages get a per-route <head> (title, canonical, JSON-LD); see seo.js.
  const seo = createSeo({
    indexFile: frontendIndexFile,
    baseUrl: APP_BASE_URL,
    findJob: findPublicJobPostById,
    listJobs: listPublicJobPostRows,
    formatPay: formatPayDisplay,
  })
  app.get('/sitemap.xml', seo.sitemap)
  app.use(express.static(frontendDistDir, { index: false }))

  app.get(/^\/(?!api(?:\/|$)|uploads(?:\/|$)).*/, seo.page)
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
    // 4xx errors (clientError, body-parser) carry a message meant for the
    // user; anything else is internal and only goes to the log.
    const status = Number(error.status || error.statusCode) || 500
    if (status >= 400 && status < 500) {
      return res.status(status).json({
        success: false,
        error: error.message || 'Request failed.',
      })
    }
    console.error(`${req.method} ${req.path} unhandled error:`, error)
    return res.status(500).json({
      success: false,
      error: 'Internal server error.',
    })
  }

  next()
})

async function startServer() {
  await ensureEmployerPasswordResetTable()
  await ensureJobPostingComplianceColumns()
  await ensureJobSeekerApplicationColumns()
  await ensureEmployerPendingCheckoutsTable()
  await ensureResumeChecksTable()
  await ensureJobScraperColumns()
  await ensureEmployerUserAuthColumns()
  await ensureEmployerSubscriptionSyncColumn()
  // Required: the public job queries select job_posts.featured_until.
  await featured.ensureTables()
  await selfServe.ensureSchema()
  // The AI order tables only serve the AI routes; never let them stop the site.
  await ensureCoverLetterTable().catch((error) => console.error('STARTUP: cover letter table setup failed:', error?.message || error))
  await ensureInterviewPrepTable().catch((error) => console.error('STARTUP: interview prep table setup failed:', error?.message || error))
  await analytics.ensureTable().catch((error) => console.error('STARTUP: analytics table setup failed:', error?.message || error))
  await bundles.ensureTables().catch((error) => console.error('STARTUP: bundle tables setup failed:', error?.message || error))
  await jobAlerts.ensureTables().catch((error) => console.error('STARTUP: job alert tables setup failed:', error?.message || error))
  await facebook.ensureTable().catch((error) => console.error('STARTUP: facebook table setup failed:', error?.message || error))
  await sharePack.ensureTable().catch((error) => console.error('STARTUP: share pack table setup failed:', error?.message || error))
  await seekers.ensureTables().catch((error) => console.error('STARTUP: job seeker tables setup failed:', error?.message || error))
  await expireOpenJobs()

  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`)
  })

  scheduleScrapes()
}

startServer().catch((error) => {
  console.error('Failed to start server:', error)
  process.exit(1)
})