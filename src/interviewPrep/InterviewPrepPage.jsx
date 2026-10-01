// TarboroJobs Interview Prep Pack - public, single-page entry point.
//
// Flow (paywalled):
//   1. User fills in job title + optional job description
//   2. POST /api/interview-prep/generate → { publicToken } → switch to 'paywall'
//   3. Paywall CTA calls /api/interview-prep/create-checkout → Square redirect
//   4. On return (token starts with 'ip_'), poll GET /api/interview-prep/result/:token
//      every 4s. When paid=true, render accordion of questions/answers.
//
// All sub-components are local to this file.

import { useState, useEffect, useCallback } from 'react'
import { Loader2, CheckCircle2, Lock, ChevronDown, ChevronUp, ArrowLeft, Sparkles } from 'lucide-react'

const API = (import.meta.env.VITE_API_BASE || '').replace(/\/$/, '')

// ---------- Shared UI primitives (mirror resume checker style) ---------------

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
      className={`inline-flex items-center justify-center gap-2 rounded-2xl bg-indigo-500 px-5 py-3 text-sm font-semibold text-white shadow-[0_18px_40px_rgba(99,102,241,0.25)] transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
      {children}
    </button>
  )
}

// ---------- Form --------------------------------------------------------------

function InterviewPrepForm({ onReady }) {
  const [jobTitle, setJobTitle] = useState('')
  const [jobDescription, setJobDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (!jobTitle.trim()) {
      setError('Please enter a job title.')
      return
    }
    try {
      setSubmitting(true)
      const res = await fetch(`${API}/api/interview-prep/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobTitle: jobTitle.trim(), jobDescription: jobDescription.trim() }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.publicToken) {
        throw new Error(data?.error || 'Could not generate your prep pack.')
      }
      onReady({ publicToken: data.publicToken, jobTitle: jobTitle.trim() })
    } catch (err) {
      setError(err?.message || 'Could not generate your prep pack.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <PanelCard>
      <h3 className="mb-1 text-lg font-semibold text-white">Tell us about the role</h3>
      <p className="mb-5 text-sm text-slate-400">
        We'll generate 10 tailored interview questions with model answers, ready in seconds.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Job Title" required>
          <input
            type="text"
            value={jobTitle}
            onChange={(e) => setJobTitle(e.target.value)}
            maxLength={255}
            className="w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-indigo-400"
            placeholder="e.g. Customer Service Rep, Warehouse Associate"
          />
        </Field>

        <Field label="Job Description" hint="Paste the job posting for more tailored questions">
          <textarea
            value={jobDescription}
            onChange={(e) => setJobDescription(e.target.value)}
            maxLength={8000}
            rows={5}
            className="w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-indigo-400"
            placeholder="Paste the full job posting here (optional but recommended)"
          />
        </Field>

        {error ? (
          <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {error}
          </div>
        ) : null}

        <div className="pt-2">
          <PrimaryButton type="submit" loading={submitting}>
            {!submitting ? <Sparkles className="h-4 w-4" /> : null}
            {submitting ? 'Generating…' : 'Generate My Interview Questions →'}
          </PrimaryButton>
        </div>
      </form>
    </PanelCard>
  )
}

// ---------- Paywall -----------------------------------------------------------

function PaywallCard({ publicToken, jobTitle, onPaid }) {
  const [unlocking, setUnlocking] = useState(false)
  const [error, setError] = useState('')

  // Poll for payment every 4s up to 30 tries
  useEffect(() => {
    if (!publicToken) return
    let cancelled = false
    let attempts = 0

    async function poll() {
      try {
        const res = await fetch(`${API}/api/interview-prep/result/${encodeURIComponent(publicToken)}`)
        const data = await res.json().catch(() => ({}))
        if (cancelled) return
        if (data?.paid) onPaid(data)
      } catch {
        // silent — keep polling
      }
    }

    poll()
    const id = setInterval(() => {
      attempts += 1
      if (attempts >= 30) { clearInterval(id); return }
      poll()
    }, 4000)

    return () => { cancelled = true; clearInterval(id) }
  }, [publicToken, onPaid])

  async function handleUnlock() {
    setError('')
    try {
      setUnlocking(true)
      const res = await fetch(`${API}/api/interview-prep/create-checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publicToken }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.checkoutUrl) {
        throw new Error(data?.error || 'Could not start checkout.')
      }
      window.location.href = data.checkoutUrl
    } catch (err) {
      setError(err?.message || 'Could not start checkout.')
    } finally {
      setUnlocking(false)
    }
  }

  return (
    <PanelCard className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="inline-flex items-center gap-3 rounded-2xl border border-indigo-400/30 bg-indigo-400/10 px-4 py-3 text-sm text-indigo-200">
          <CheckCircle2 className="h-5 w-5 text-indigo-300" />
          <span className="font-semibold">Your interview prep pack is ready!</span>
        </div>
        <div className="inline-flex items-center gap-2 text-xs text-slate-400">
          <Lock className="h-4 w-4 text-indigo-300" /> Questions unlock after payment
        </div>
      </div>

      <div className="rounded-[24px] border border-indigo-400/30 bg-indigo-400/10 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-xl">
            <div className="text-lg font-semibold text-white">
              Pay $4.99 to unlock 10 tailored interview questions &amp; answers
            </div>
            {jobTitle ? (
              <div className="mt-1 text-sm text-slate-300">
                Customized for: <span className="text-indigo-200">{jobTitle}</span>
              </div>
            ) : null}
          </div>
          <div className="text-right">
            <div className="text-3xl font-bold text-white">$4.99</div>
            <div className="text-xs text-slate-400">one-time</div>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <PrimaryButton type="button" onClick={handleUnlock} loading={unlocking}>
            <Sparkles className="h-4 w-4" />
            Unlock my prep pack – $4.99
          </PrimaryButton>
          <span className="text-xs text-slate-400">Secure checkout via Square.</span>
        </div>
      </div>

      <ul className="space-y-2 text-sm text-slate-300">
        {[
          '10 role-specific questions',
          'Model answers for each question',
          'Mix of behavioral, technical & situational',
        ].map((item) => (
          <li key={item} className="flex items-start gap-2">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-indigo-300" />
            <span>{item}</span>
          </li>
        ))}
      </ul>

      {error ? (
        <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      ) : null}

      <div className="rounded-2xl border border-indigo-400/20 bg-indigo-400/5 px-4 py-3 text-xs text-indigo-200">
        <Loader2 className="mb-1 inline h-3 w-3 animate-spin" /> If you've already paid, this page will update automatically.
      </div>
    </PanelCard>
  )
}

// ---------- Accordion question card ------------------------------------------

function QuestionCard({ number, question, answer }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/60 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition hover:bg-slate-800/40"
      >
        <div className="flex items-center gap-3">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-500 text-xs font-bold text-white">
            {number}
          </span>
          <span className="text-sm font-medium text-slate-100">{question}</span>
        </div>
        {open
          ? <ChevronUp className="h-4 w-4 shrink-0 text-slate-400" />
          : <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
        }
      </button>
      {open ? (
        <div className="border-t border-slate-800 px-5 py-4 text-sm text-slate-300 leading-relaxed">
          {answer}
        </div>
      ) : null}
    </div>
  )
}

// ---------- Result view -------------------------------------------------------

function InterviewPrepResult({ jobTitle, questions, onStartOver }) {
  return (
    <PanelCard className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-indigo-300">Interview Prep</div>
          <h2 className="text-2xl font-semibold tracking-tight text-white">
            Interview Prep: {jobTitle}
          </h2>
        </div>
        <div className="rounded-2xl border border-indigo-400/40 bg-indigo-400/10 px-4 py-2 text-xs font-semibold text-indigo-300">
          10 questions – paid
        </div>
      </div>

      <div className="space-y-3">
        {(questions || []).map((q, idx) => (
          <QuestionCard
            key={idx}
            number={idx + 1}
            question={q.question || q}
            answer={q.answer || ''}
          />
        ))}
      </div>

      <div>
        <button
          type="button"
          onClick={onStartOver}
          className="inline-flex items-center gap-2 rounded-2xl border border-slate-700 bg-slate-900/70 px-5 py-3 text-sm font-semibold text-slate-200 transition hover:border-slate-600 hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" /> Start Over
        </button>
      </div>
    </PanelCard>
  )
}

// ---------- Top-level page ----------------------------------------------------

function getParam(name) {
  if (typeof window === 'undefined') return null
  return new URLSearchParams(window.location.search).get(name)
}

export default function InterviewPrepPage({ onBack }) {
  const tokenFromUrl = getParam('token')
  const startMode = tokenFromUrl?.startsWith('ip_') ? 'paywall' : 'form'

  const [mode, setMode] = useState(startMode)
  const [publicToken, setPublicToken] = useState(tokenFromUrl || '')
  const [jobTitle, setJobTitle] = useState('')
  const [questions, setQuestions] = useState([])

  const handlePaid = useCallback((data) => {
    setQuestions(data.questions || [])
    if (data.jobTitle) setJobTitle(data.jobTitle)
    setMode('result')
  }, [])

  function handleFormReady({ publicToken: token, jobTitle: title }) {
    setPublicToken(token)
    setJobTitle(title)
    setMode('paywall')
    if (typeof window !== 'undefined') {
      window.history.pushState({}, '', `/?page=interview-prep-result&token=${encodeURIComponent(token)}`)
    }
  }

  function handleStartOver() {
    setMode('form')
    setPublicToken('')
    setJobTitle('')
    setQuestions([])
    if (typeof window !== 'undefined') {
      window.history.pushState({}, '', '/?page=interview-prep')
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-8">
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
        <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-indigo-400/30 bg-indigo-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-indigo-300">
          <Sparkles className="h-3.5 w-3.5" /> Interview Prep Pack
        </div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
          Walk In Ready. Walk Out With the Job.
        </h1>
        <p className="mt-2 text-sm text-slate-300">
          Enter the role you're applying for and get 10 tailored interview questions with model answers — behavioral,
          technical, and situational. One-time $4.99.
        </p>
      </PanelCard>

      {mode === 'form' && <InterviewPrepForm onReady={handleFormReady} />}

      {mode === 'paywall' && (
        <PaywallCard publicToken={publicToken} jobTitle={jobTitle} onPaid={handlePaid} />
      )}

      {mode === 'result' && (
        <InterviewPrepResult jobTitle={jobTitle} questions={questions} onStartOver={handleStartOver} />
      )}
    </div>
  )
}
