// TarboroJobs Resume Checker - public, single-page entry point.
//
// Flow (paywalled - no free preview):
//   1. User lands on /?page=resume-checker (or /?page=resume-report&token=...)
//   2. They upload a PDF + optional target job + optional JD
//   3. We POST to /api/resume-checker/preview - server parses, scores, and
//      stores the FULL report internally but returns ONLY a publicToken.
//      No score, no strengths, no problems leak to the client until payment.
//   4. We show an unlock CTA. Clicking it calls
//      /api/resume-checker/create-checkout and redirects to Square.
//   5. After Square redirects back with the token, we GET the report. The
//      server returns the full report only when payment_status='paid'.
//      We poll gently for ~2 minutes to bridge the webhook gap.
//
// All sub-components are local to this file so the feature is self-contained
// and easy to remove or extract later.

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  FileText,
  Upload,
  CheckCircle2,
  AlertCircle,
  Lock,
  Sparkles,
  Loader2,
  Download,
  ShieldCheck,
  ArrowLeft,
} from 'lucide-react'

const API_BASE = (import.meta.env.VITE_API_BASE || '/api').replace(/\/$/, '')
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024

// ---------- Small UI primitives, mirrored from App.jsx style ---------------

function SectionTitle({ eyebrow, title, subtitle }) {
  return (
    <div className="mb-6 text-center">
      {eyebrow ? (
        <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-300">
          {eyebrow}
        </div>
      ) : null}
      <h2 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">{title}</h2>
      {subtitle ? <p className="mx-auto mt-2 max-w-2xl text-sm text-slate-400">{subtitle}</p> : null}
    </div>
  )
}

function PanelCard({ children, className = '' }) {
  return (
    <section
      className={`rounded-[30px] border border-slate-800 bg-slate-900/85 p-5 shadow-[0_18px_60px_rgba(2,6,23,0.24)] sm:p-7 ${className}`}
    >
      {children}
    </section>
  )
}

function Field({ label, required, hint, children }) {
  return (
    <label className="block">
      <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
        {label} {required ? <span className="text-rose-400">*</span> : null}
      </div>
      {children}
      {hint ? <div className="mt-1 text-xs text-slate-500">{hint}</div> : null}
    </label>
  )
}

function PrimaryButton({ children, className = '', loading, ...props }) {
  return (
    <button
      {...props}
      disabled={loading || props.disabled}
      className={`inline-flex items-center justify-center gap-2 rounded-2xl bg-cyan-400 px-5 py-3 text-sm font-semibold text-slate-950 shadow-[0_18px_40px_rgba(34,211,238,0.25)] transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
      {children}
    </button>
  )
}

function GhostButton({ children, className = '', ...props }) {
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-700 bg-slate-900/70 px-5 py-3 text-sm font-semibold text-slate-200 transition hover:border-slate-600 hover:text-white ${className}`}
    >
      {children}
    </button>
  )
}

// ---------- Score badge + display helpers ----------------------------------

function ResumeScoreBadge({ score, label }) {
  const tone = (() => {
    if (score >= 75) return { ring: 'ring-emerald-400/40', text: 'text-emerald-300', bg: 'bg-emerald-400/10' }
    if (score >= 60) return { ring: 'ring-amber-400/40', text: 'text-amber-300', bg: 'bg-amber-400/10' }
    if (score >= 40) return { ring: 'ring-orange-400/40', text: 'text-orange-300', bg: 'bg-orange-400/10' }
    return { ring: 'ring-rose-400/40', text: 'text-rose-300', bg: 'bg-rose-400/10' }
  })()

  return (
    <div className={`inline-flex items-center gap-4 rounded-[26px] ${tone.bg} px-5 py-3 ring-1 ${tone.ring}`}>
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-950/60 text-3xl font-bold text-white">
        {score}
      </div>
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">Resume Score</div>
        <div className={`text-lg font-semibold ${tone.text}`}>{label}</div>
        <div className="text-xs text-slate-500">out of 100</div>
      </div>
    </div>
  )
}

function BulletList({ items, icon: Icon, tone }) {
  if (!items || items.length === 0) return null
  const toneClass = tone === 'good' ? 'text-emerald-300' : tone === 'bad' ? 'text-rose-300' : 'text-slate-300'
  return (
    <ul className="space-y-2">
      {items.map((item, idx) => (
        <li key={idx} className="flex items-start gap-2 text-sm text-slate-200">
          {Icon ? <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${toneClass}`} /> : null}
          <span>{item}</span>
        </li>
      ))}
    </ul>
  )
}

// ---------- Upload form ----------------------------------------------------

function ResumeUploadForm({ onUploadReady }) {
  const fileInputRef = useRef(null)
  const [file, setFile] = useState(null)
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [targetJobTitle, setTargetJobTitle] = useState('')
  const [jobDescription, setJobDescription] = useState('')
  const [consent, setConsent] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  function handleFileChange(event) {
    const next = event.target.files?.[0] || null
    setError('')
    if (next) {
      if (next.size > MAX_UPLOAD_BYTES) {
        setError('That PDF is larger than 5 MB. Please upload a smaller file.')
        setFile(null)
        if (fileInputRef.current) fileInputRef.current.value = ''
        return
      }
      const ext = next.name.toLowerCase().split('.').pop()
      if (ext !== 'pdf') {
        setError('Only PDF files are supported right now.')
        setFile(null)
        if (fileInputRef.current) fileInputRef.current.value = ''
        return
      }
    }
    setFile(next)
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')

    if (!file) {
      setError('Please choose your resume PDF.')
      return
    }
    if (!consent) {
      setError('Please agree to the consent statement to continue.')
      return
    }

    const formData = new FormData()
    formData.append('resume', file)
    if (fullName) formData.append('fullName', fullName)
    if (email) formData.append('email', email)
    if (targetJobTitle) formData.append('targetJobTitle', targetJobTitle)
    if (jobDescription) formData.append('jobDescription', jobDescription)
    formData.append('consent', 'true')

    try {
      setSubmitting(true)
      const response = await fetch(`${API_BASE}/resume-checker/preview`, {
        method: 'POST',
        body: formData,
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || !data?.success) {
        throw new Error(data?.error || 'Could not analyze your resume.')
      }
      onUploadReady({
        publicToken: data.publicToken,
        priceCents: data.priceCents,
        currency: data.currency,
      })
    } catch (err) {
      setError(err?.message || 'Could not analyze your resume.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <PanelCard>
      <h3 className="mb-1 text-lg font-semibold text-white">Upload your resume</h3>
      <p className="mb-5 text-sm text-slate-400">
        PDF only, up to 5 MB. Your file is processed for feedback and then deleted from our servers.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Resume PDF" required hint="Only PDF files. Max 5 MB.">
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,.pdf"
            onChange={handleFileChange}
            className="block w-full rounded-2xl border border-dashed border-slate-700 bg-slate-950/70 px-4 py-3 text-sm text-slate-200 file:mr-3 file:rounded-xl file:border-0 file:bg-cyan-400 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-slate-950 hover:border-slate-500"
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name" hint="Optional">
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              maxLength={255}
              className="w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-cyan-400"
              placeholder="Optional"
            />
          </Field>
          <Field label="Email" hint="Required if you want the report sent later">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              maxLength={255}
              className="w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-cyan-400"
              placeholder="you@example.com"
            />
          </Field>
        </div>

        <Field label="Target job title" hint="Optional. Example: IT Support, Line Cook, CNA.">
          <input
            type="text"
            value={targetJobTitle}
            onChange={(e) => setTargetJobTitle(e.target.value)}
            maxLength={255}
            className="w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-cyan-400"
            placeholder="What role are you applying for?"
          />
        </Field>

        <Field label="Paste the job description" hint="Optional. Helps us match keywords from the actual posting.">
          <textarea
            value={jobDescription}
            onChange={(e) => setJobDescription(e.target.value)}
            maxLength={8000}
            rows={5}
            className="w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-cyan-400"
            placeholder="Paste here for a sharper score."
          />
        </Field>

        <label className="flex items-start gap-3 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            className="mt-1 h-4 w-4 rounded border-slate-600 bg-slate-950 text-cyan-400 focus:ring-cyan-400"
          />
          <span>
            I understand this tool provides automated resume feedback and does not guarantee employment. I agree to
            have my resume processed for automated feedback.
          </span>
        </label>

        {error ? (
          <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {error}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-3 pt-2">
          <PrimaryButton type="submit" loading={submitting}>
            <Upload className="h-4 w-4" />
            {submitting ? 'Analyzing...' : 'Analyze my resume'}
          </PrimaryButton>
          <span className="text-xs text-slate-500">Payment unlocks your score and full report.</span>
        </div>
      </form>
    </PanelCard>
  )
}

// ---------- Paywall (no score shown until paid) ----------------------------

function formatPrice(priceCents, currency) {
  const cents = Number.isFinite(priceCents) ? priceCents : 999
  const dollars = (cents / 100).toFixed(2)
  if ((currency || 'USD').toUpperCase() === 'USD') return `$${dollars}`
  return `${dollars} ${currency}`
}

function PaywallCard({ priceCents, currency, onUnlock, unlocking, headline, subhead }) {
  const priceLabel = formatPrice(priceCents, currency)
  return (
    <PanelCard className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="inline-flex items-center gap-3 rounded-2xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-200">
          <CheckCircle2 className="h-5 w-5 text-emerald-300" />
          <span className="font-semibold">Your resume is analyzed and ready.</span>
        </div>
        <div className="inline-flex items-center gap-2 text-xs text-slate-400">
          <Lock className="h-4 w-4 text-cyan-300" /> Score & report unlock after payment
        </div>
      </div>

      <div className="rounded-[24px] border border-cyan-400/30 bg-cyan-400/10 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-xl">
            <div className="text-lg font-semibold text-white">
              {headline || `Unlock your resume score for ${priceLabel}`}
            </div>
            <div className="mt-1 text-sm text-slate-300">
              {subhead || 'You get the full report - score out of 100, ATS readability, keyword match, experience relevance, formatting and grammar reviews, suggested bullet rewrites, and a final action checklist. One-time payment.'}
            </div>
          </div>
          <div className="text-right">
            <div className="text-3xl font-bold text-white">{priceLabel}</div>
            <div className="text-xs text-slate-400">one-time</div>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <PrimaryButton type="button" onClick={onUnlock} loading={unlocking}>
            <Sparkles className="h-4 w-4" />
            Unlock my score
          </PrimaryButton>
          <span className="text-xs text-slate-400">Secure checkout via Square.</span>
        </div>
      </div>

      <ul className="grid gap-2 text-sm text-slate-300 sm:grid-cols-2">
        {[
          'Overall resume score out of 100',
          'ATS readability check',
          'Keyword match vs. the target role',
          'Experience relevance to the job',
          'Formatting & grammar review',
          'Suggested bullet rewrites',
          'Role-specific advice',
          'Final action checklist',
        ].map((item) => (
          <li key={item} className="flex items-start gap-2">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </PanelCard>
  )
}

// ---------- Full paid report -----------------------------------------------

function ScoreBar({ label, value, max }) {
  const pct = max ? Math.round((value / max) * 100) : 0
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs text-slate-400">
        <span>{label}</span>
        <span className="text-slate-300">{value} / {max}</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
        <div className="h-full rounded-full bg-cyan-400" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function ResumeReport({ report, targetJobTitle }) {
  if (!report) return null
  const breakdown = report.breakdown || {}
  const keyword = report.keywordFeedback || {}

  return (
    <PanelCard className="space-y-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <ResumeScoreBadge score={report.overallScore} label={report.label} />
          {targetJobTitle ? (
            <div className="mt-3 text-xs text-slate-400">
              Scored against target role: <span className="text-slate-200">{targetJobTitle}</span>
            </div>
          ) : null}
        </div>
        <div className="rounded-2xl border border-emerald-400/40 bg-emerald-400/10 px-4 py-2 text-xs font-semibold text-emerald-300">
          Full report - paid
        </div>
      </div>

      {report.summary ? <p className="text-sm text-slate-300">{report.summary}</p> : null}

      <div>
        <h4 className="mb-3 text-sm font-semibold text-white">Score breakdown</h4>
        <div className="grid gap-3 sm:grid-cols-2">
          <ScoreBar label="ATS readability" value={breakdown.atsReadability ?? 0} max={20} />
          <ScoreBar label="Keyword match" value={breakdown.keywordMatch ?? 0} max={25} />
          <ScoreBar label="Experience relevance" value={breakdown.experienceRelevance ?? 0} max={20} />
          <ScoreBar label="Formatting" value={breakdown.formatting ?? 0} max={15} />
          <ScoreBar label="Grammar / clarity" value={breakdown.grammarClarity ?? 0} max={10} />
          <ScoreBar label="Required sections" value={breakdown.requiredSections ?? 0} max={10} />
        </div>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <div>
          <h4 className="mb-3 text-sm font-semibold text-emerald-300">Strengths</h4>
          <BulletList items={report.strengths} icon={CheckCircle2} tone="good" />
        </div>
        <div>
          <h4 className="mb-3 text-sm font-semibold text-rose-300">Problems</h4>
          <BulletList items={report.problems} icon={AlertCircle} tone="bad" />
        </div>
      </div>

      {report.atsRisks && report.atsRisks.length ? (
        <div>
          <h4 className="mb-3 text-sm font-semibold text-amber-300">ATS risks</h4>
          <BulletList items={report.atsRisks} icon={AlertCircle} tone="bad" />
        </div>
      ) : null}

      <div>
        <h4 className="mb-3 text-sm font-semibold text-white">Keyword feedback</h4>
        <div className="mb-3 text-xs text-slate-400">
          Match: <span className="text-slate-200">{keyword.matchPercentage ?? 0}%</span>
          {keyword.source === 'job_description'
            ? ' (from the job description you pasted)'
            : keyword.source === 'role_dictionary'
              ? ' (from generic role keywords)'
              : ' (add a target role or job description for a sharper match)'}
        </div>
        {keyword.matchedKeywords && keyword.matchedKeywords.length ? (
          <div className="mb-3">
            <div className="mb-1 text-xs uppercase tracking-[0.16em] text-emerald-300">Matched</div>
            <div className="flex flex-wrap gap-2">
              {keyword.matchedKeywords.map((k) => (
                <span key={`m-${k}`} className="rounded-full bg-emerald-400/10 px-3 py-1 text-xs text-emerald-200">{k}</span>
              ))}
            </div>
          </div>
        ) : null}
        {keyword.missingKeywords && keyword.missingKeywords.length ? (
          <div>
            <div className="mb-1 text-xs uppercase tracking-[0.16em] text-rose-300">Missing</div>
            <div className="flex flex-wrap gap-2">
              {keyword.missingKeywords.map((k) => (
                <span key={`mi-${k}`} className="rounded-full bg-rose-400/10 px-3 py-1 text-xs text-rose-200">{k}</span>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      {report.rewriteExamples && report.rewriteExamples.length ? (
        <div>
          <h4 className="mb-3 text-sm font-semibold text-white">Suggested bullet rewrites</h4>
          <div className="space-y-3">
            {report.rewriteExamples.map((ex, idx) => (
              <div key={idx} className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
                <div className="text-xs uppercase tracking-[0.16em] text-rose-300">Original</div>
                <div className="mt-1 text-sm text-slate-300">{ex.original}</div>
                <div className="mt-3 text-xs uppercase tracking-[0.16em] text-emerald-300">Improved</div>
                <div className="mt-1 text-sm text-slate-100">{ex.improved}</div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {report.nextSteps && report.nextSteps.length ? (
        <div>
          <h4 className="mb-3 text-sm font-semibold text-white">Final action checklist</h4>
          <BulletList items={report.nextSteps} icon={CheckCircle2} tone="neutral" />
        </div>
      ) : null}

      <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4 text-xs text-slate-400">
        This tool provides automated resume feedback. It does not guarantee interviews, job offers, or employment. We
        do not evaluate protected characteristics.
      </div>
    </PanelCard>
  )
}

// ---------- Top-level page -------------------------------------------------

function getQueryParam(name) {
  if (typeof window === 'undefined') return null
  const params = new URLSearchParams(window.location.search)
  return params.get(name)
}

export default function ResumeCheckerPage({ initialMode = 'upload', onBack }) {
  // `mode` is one of: 'upload' | 'unlock' | 'report'
  //   upload: collecting the PDF and details from the user
  //   unlock: server has the resume; user must pay to see the score
  //   report: viewing by /?page=resume-report&token=... - server decides
  //           whether to return paywall data or the full paid report
  const initialToken = getQueryParam('token')
  const initialPage = getQueryParam('page')
  const startMode = initialMode === 'report' || (initialPage === 'resume-report' && initialToken) ? 'report' : 'upload'

  const [mode, setMode] = useState(startMode)
  const [publicToken, setPublicToken] = useState(initialToken || '')
  const [priceCents, setPriceCents] = useState(999)
  const [currency, setCurrency] = useState('USD')
  const [fullReport, setFullReport] = useState(null)
  const [paid, setPaid] = useState(false)
  const [reportTargetJobTitle, setReportTargetJobTitle] = useState('')
  const [reportLoading, setReportLoading] = useState(false)
  const [unlocking, setUnlocking] = useState(false)
  const [error, setError] = useState('')

  // Poll the report endpoint when we have a token but haven't unlocked yet -
  // covers the gap between Square redirect and webhook firing. The endpoint
  // never returns score data to an unpaid client.
  useEffect(() => {
    if (mode !== 'report' || !publicToken || paid) return undefined
    let cancelled = false
    let attempts = 0

    async function load() {
      try {
        setReportLoading(true)
        const response = await fetch(`${API_BASE}/resume-checker/report/${encodeURIComponent(publicToken)}`)
        const data = await response.json().catch(() => ({}))
        if (cancelled) return
        if (!response.ok || !data?.success) {
          throw new Error(data?.error || 'Could not load this report.')
        }
        setReportTargetJobTitle(data.targetJobTitle || '')
        if (typeof data.priceCents === 'number') setPriceCents(data.priceCents)
        if (data.currency) setCurrency(data.currency)
        if (data.paid) {
          setPaid(true)
          setFullReport(data.fullReport || null)
        }
      } catch (err) {
        if (!cancelled) setError(err?.message || 'Could not load this report.')
      } finally {
        if (!cancelled) setReportLoading(false)
      }
    }

    load()
    const interval = setInterval(() => {
      attempts += 1
      if (attempts > 30) {
        clearInterval(interval)
        return
      }
      load()
    }, 4000)

    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [mode, publicToken, paid])

  async function handleUnlock() {
    setError('')
    if (!publicToken) {
      setError('Missing report token.')
      return
    }
    try {
      setUnlocking(true)
      const response = await fetch(`${API_BASE}/resume-checker/create-checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publicToken }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || !data?.success) {
        throw new Error(data?.error || 'Could not start checkout.')
      }
      if (data.alreadyPaid) {
        setMode('report')
        return
      }
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl
        return
      }
      throw new Error('Square did not return a checkout URL.')
    } catch (err) {
      setError(err?.message || 'Could not start checkout.')
    } finally {
      setUnlocking(false)
    }
  }

  function handleUploadReady({ publicToken: token, priceCents: nextPriceCents, currency: nextCurrency }) {
    setPublicToken(token)
    if (typeof nextPriceCents === 'number') setPriceCents(nextPriceCents)
    if (nextCurrency) setCurrency(nextCurrency)
    setMode('unlock')
    // Update the URL so the user can bookmark / refresh and resume from
    // the paywall (or jump straight to the paid report after payment).
    if (typeof window !== 'undefined') {
      const nextUrl = `/?page=resume-report&token=${encodeURIComponent(token)}`
      window.history.pushState({}, '', nextUrl)
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-4 py-10">
      {onBack ? (
        <button
          onClick={onBack}
          className="inline-flex items-center gap-2 text-sm text-slate-300 transition hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" /> Back to jobs
        </button>
      ) : null}

      {/* Hero */}
      <PanelCard>
        <div className="grid gap-6 md:grid-cols-[1.4fr_1fr] md:items-center">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-300">
              <Sparkles className="h-3.5 w-3.5" /> Resume checker
            </div>
            <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              Check Your Resume Before You Apply
            </h1>
            <p className="mt-3 text-sm text-slate-300 sm:text-base">
              Upload your resume and unlock a full report covering formatting, keywords, clarity, and job fit. Built
              for local job seekers who want a better shot before they apply.
            </p>
            <div className="mt-4 flex flex-wrap gap-3 text-xs text-slate-400">
              <span className="inline-flex items-center gap-1.5"><ShieldCheck className="h-4 w-4 text-emerald-300" /> Private & deleted after parsing</span>
              <span className="inline-flex items-center gap-1.5"><FileText className="h-4 w-4 text-cyan-300" /> PDF only, up to 5 MB</span>
            </div>
          </div>
          <div className="rounded-[26px] border border-slate-800 bg-slate-950/60 p-5">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">How it works</div>
            <ol className="mt-3 space-y-3 text-sm text-slate-200">
              <li className="flex gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-cyan-400 text-xs font-bold text-slate-950">1</span>
                Upload your resume
              </li>
              <li className="flex gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-cyan-400 text-xs font-bold text-slate-950">2</span>
                Unlock your score for $9.99
              </li>
              <li className="flex gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-cyan-400 text-xs font-bold text-slate-950">3</span>
                Read your full report and action checklist
              </li>
            </ol>
          </div>
        </div>
      </PanelCard>

      {/* What we check */}
      <PanelCard>
        <SectionTitle eyebrow="What we check" title="Six dimensions that matter to hiring managers and ATS systems" />
        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
          {[
            'ATS readability',
            'Keyword match',
            'Formatting & structure',
            'Grammar & clarity',
            'Experience relevance',
            'Required sections',
          ].map((label) => (
            <div key={label} className="rounded-2xl border border-slate-800 bg-slate-950/60 px-4 py-3 text-sm text-slate-200">
              <CheckCircle2 className="mb-2 h-4 w-4 text-cyan-300" />
              {label}
            </div>
          ))}
        </div>
      </PanelCard>

      {/* Upload form / paywall / paid report */}
      {mode === 'upload' && (
        <ResumeUploadForm onUploadReady={handleUploadReady} />
      )}

      {mode === 'unlock' && (
        <>
          <PaywallCard
            priceCents={priceCents}
            currency={currency}
            onUnlock={handleUnlock}
            unlocking={unlocking}
          />
          {error ? (
            <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
              {error}
            </div>
          ) : null}
        </>
      )}

      {mode === 'report' && (
        <>
          {reportLoading && !paid && !fullReport ? (
            <PanelCard>
              <div className="flex items-center justify-center gap-3 py-8 text-sm text-slate-300">
                <Loader2 className="h-5 w-5 animate-spin text-cyan-300" />
                Loading your report...
              </div>
            </PanelCard>
          ) : null}

          {paid && fullReport ? (
            <ResumeReport report={fullReport} targetJobTitle={reportTargetJobTitle} />
          ) : (
            <>
              <PanelCard className="border-cyan-400/20 bg-cyan-400/5">
                <div className="flex items-center gap-3 text-sm text-cyan-100">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Checking your payment status. If you just paid, your full report will appear here in a few seconds.
                </div>
              </PanelCard>
              <PaywallCard
                priceCents={priceCents}
                currency={currency}
                onUnlock={handleUnlock}
                unlocking={unlocking}
                headline={`Unlock your resume score for ${formatPrice(priceCents, currency)}`}
                subhead="Pay once to reveal your full report. If you've already paid, this will refresh to the report automatically."
              />
            </>
          )}

          {error ? (
            <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
              {error}
            </div>
          ) : null}
        </>
      )}

      {/* Disclaimer */}
      <PanelCard className="bg-slate-900/60">
        <div className="text-xs text-slate-400">
          This tool provides automated resume feedback. It does not guarantee interviews, job offers, or employment.
          We do not evaluate protected characteristics and do not ask for race, religion, age, disability, marital
          status, or medical information. Your resume is used only to generate your resume report; the uploaded PDF
          is deleted after parsing.
        </div>
      </PanelCard>
    </div>
  )
}
