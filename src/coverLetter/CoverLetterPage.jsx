// TarboroJobs Cover Letter Generator - paywalled, single-page entry point.
//
// Flow:
//   1. User fills in name, job title, job description, and background.
//   2. POST /api/cover-letter/generate → { publicToken } → 'paywall' mode.
//   3. PaywallCard: pay $4.99 via Square. Also polls result endpoint every 4s
//      so the result appears automatically after the Square redirect.
//   4. 'result' mode: display the letter with copy / start-over actions.
//
// URL handling: ?token=cl_... on mount → start in 'paywall' mode and poll.

import { useState, useEffect, useCallback } from 'react'

const API = import.meta.env.VITE_API_BASE || ''

// ---------- Shared UI primitives (match site style) -------------------------

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
      className={`inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-400 px-5 py-3 text-sm font-semibold text-slate-950 shadow-[0_18px_40px_rgba(52,211,153,0.25)] transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
    >
      {loading ? (
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-950 border-t-transparent" />
      ) : null}
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

function ErrorBox({ message }) {
  if (!message) return null
  return (
    <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
      {message}
    </div>
  )
}

// ---------- Form mode -------------------------------------------------------

function CoverLetterForm({ onGenerated }) {
  const [fullName, setFullName] = useState('')
  const [jobTitle, setJobTitle] = useState('')
  const [jobDescription, setJobDescription] = useState('')
  const [background, setBackground] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (!fullName.trim()) { setError('Please enter your full name.'); return }
    if (!jobTitle.trim()) { setError('Please enter the job title you are applying for.'); return }
    if (!background.trim()) { setError('Please tell us about your background and experience.'); return }

    try {
      setSubmitting(true)
      const res = await fetch(`${API}/api/cover-letter/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullName, jobTitle, jobDescription, background }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.publicToken) {
        throw new Error(data?.error || 'Could not generate your cover letter.')
      }
      onGenerated({ publicToken: data.publicToken, jobTitle })
    } catch (err) {
      setError(err?.message || 'Could not generate your cover letter.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <PanelCard>
      <h2 className="mb-1 text-xl font-semibold text-white">Generate your cover letter</h2>
      <p className="mb-5 text-sm text-slate-400">
        Fill in the details below and we'll write a professional, tailored cover letter for you.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full Name" required>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              maxLength={255}
              placeholder="Jane Smith"
              className="w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-emerald-400"
            />
          </Field>
          <Field label="Job Title Applying For" required>
            <input
              type="text"
              value={jobTitle}
              onChange={(e) => setJobTitle(e.target.value)}
              maxLength={255}
              placeholder="e.g. Customer Service Rep"
              className="w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-emerald-400"
            />
          </Field>
        </div>

        <Field label="Job Description" hint="Optional. Paste the posting to make your letter more specific.">
          <textarea
            value={jobDescription}
            onChange={(e) => setJobDescription(e.target.value)}
            maxLength={8000}
            rows={4}
            placeholder="Paste the job posting here…"
            className="w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-emerald-400"
          />
        </Field>

        <Field
          label="Your Background / Experience"
          required
          hint="Tell us about your work history, skills, and experience."
        >
          <textarea
            value={background}
            onChange={(e) => setBackground(e.target.value)}
            maxLength={8000}
            rows={5}
            placeholder="e.g. I have 3 years of retail experience, strong customer service skills, and a background in…"
            className="w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-emerald-400"
          />
        </Field>

        <ErrorBox message={error} />

        <div className="flex flex-wrap items-center gap-3 pt-2">
          <PrimaryButton type="submit" loading={submitting}>
            {submitting ? 'Generating…' : 'Generate My Cover Letter →'}
          </PrimaryButton>
          <span className="text-xs text-slate-500">$4.99 to unlock your letter.</span>
        </div>
      </form>
    </PanelCard>
  )
}

// ---------- Paywall mode ----------------------------------------------------

function PaywallCard({ publicToken, jobTitle, onUnlocked }) {
  const [unlocking, setUnlocking] = useState(false)
  const [error, setError] = useState('')

  async function handleUnlock() {
    setError('')
    try {
      setUnlocking(true)
      const res = await fetch(`${API}/api/cover-letter/create-checkout`, {
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

  // Poll for paid status (covers the Square redirect → webhook gap)
  const poll = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/cover-letter/result/${encodeURIComponent(publicToken)}`)
      const data = await res.json().catch(() => ({}))
      if (data?.paid && data?.letter) {
        onUnlocked({ letter: data.letter, jobTitle: data.jobTitle || jobTitle })
      }
    } catch {
      // silent — keep polling
    }
  }, [publicToken, jobTitle, onUnlocked])

  useEffect(() => {
    if (!publicToken) return
    poll()
    let attempts = 0
    const id = setInterval(() => {
      attempts += 1
      if (attempts >= 30) { clearInterval(id); return }
      poll()
    }, 4000)
    return () => clearInterval(id)
  }, [poll, publicToken])

  return (
    <PanelCard className="space-y-6">
      <div className="inline-flex items-center gap-3 rounded-2xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-200">
        <span className="text-emerald-300 text-lg">✓</span>
        <span className="font-semibold">Your cover letter is ready!</span>
      </div>

      <div className="rounded-[24px] border border-emerald-400/30 bg-emerald-400/10 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-xl">
            <div className="text-lg font-semibold text-white">Pay $4.99 to download your personalized cover letter</div>
            {jobTitle ? (
              <div className="mt-1 text-sm text-slate-300">
                Tailored for: <span className="text-slate-100 font-medium">{jobTitle}</span>
              </div>
            ) : null}
          </div>
          <div className="text-right">
            <div className="text-3xl font-bold text-white">$4.99</div>
            <div className="text-xs text-slate-400">one-time</div>
          </div>
        </div>

        <ul className="mt-4 space-y-2">
          {[
            'Tailored to the specific job',
            'Professional 3-paragraph format',
            'Ready to copy and send',
          ].map((item) => (
            <li key={item} className="flex items-center gap-2 text-sm text-slate-200">
              <span className="text-emerald-300">✓</span>
              {item}
            </li>
          ))}
        </ul>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <PrimaryButton type="button" onClick={handleUnlock} loading={unlocking}>
            Unlock my cover letter – $4.99
          </PrimaryButton>
          <span className="text-xs text-slate-400">Secure checkout via Square.</span>
        </div>
      </div>

      <ErrorBox message={error} />

      <div className="flex items-center gap-2 text-xs text-slate-500">
        <span className="animate-spin h-3 w-3 rounded-full border border-slate-600 border-t-slate-300" />
        Waiting for payment confirmation…
      </div>
    </PanelCard>
  )
}

// ---------- Result mode -----------------------------------------------------

function CoverLetterResult({ letter, jobTitle, onStartOver }) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(letter)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // clipboard blocked — silent fallback; user can select text manually
    }
  }

  return (
    <PanelCard className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-300 mb-2">
            Cover Letter Ready
          </div>
          {jobTitle ? (
            <h2 className="text-xl font-semibold text-white">{jobTitle}</h2>
          ) : null}
        </div>
        <div className="inline-flex items-center gap-2 rounded-2xl border border-emerald-400/40 bg-emerald-400/10 px-4 py-2 text-xs font-semibold text-emerald-300">
          Paid ✓
        </div>
      </div>

      <div className="rounded-2xl border border-slate-700 bg-white/5 p-5">
        <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-slate-100">{letter}</pre>
      </div>

      <div className="flex flex-wrap gap-3">
        <PrimaryButton type="button" onClick={handleCopy}>
          {copied ? '✓ Copied!' : 'Copy to Clipboard'}
        </PrimaryButton>
        <GhostButton type="button" onClick={onStartOver}>
          Start Over
        </GhostButton>
      </div>
    </PanelCard>
  )
}

// ---------- Top-level page --------------------------------------------------

export default function CoverLetterPage() {
  const initialToken = new URLSearchParams(window.location.search).get('token')
  const startMode = initialToken?.startsWith('cl_') ? 'paywall' : 'form'

  const [mode, setMode] = useState(startMode)
  const [publicToken, setPublicToken] = useState(initialToken || '')
  const [jobTitle, setJobTitle] = useState('')
  const [letter, setLetter] = useState('')

  function handleGenerated({ publicToken: token, jobTitle: title }) {
    setPublicToken(token)
    setJobTitle(title)
    setMode('paywall')
    window.history.pushState({}, '', `/?page=cover-letter-result&token=${encodeURIComponent(token)}`)
  }

  function handleUnlocked({ letter: text, jobTitle: title }) {
    setLetter(text)
    if (title) setJobTitle(title)
    setMode('result')
  }

  function handleStartOver() {
    setMode('form')
    setPublicToken('')
    setJobTitle('')
    setLetter('')
    window.history.pushState({}, '', '/')
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 space-y-6">
      {/* Hero */}
      <PanelCard>
        <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-300">
          Cover Letter Generator
        </div>
        <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          Write a Cover Letter in Seconds
        </h1>
        <p className="mt-3 text-sm text-slate-300">
          Tell us about yourself and the job. We'll write a professional, tailored cover letter you can copy and send today.
        </p>
      </PanelCard>

      {mode === 'form' && (
        <CoverLetterForm onGenerated={handleGenerated} />
      )}

      {mode === 'paywall' && (
        <PaywallCard
          publicToken={publicToken}
          jobTitle={jobTitle}
          onUnlocked={handleUnlocked}
        />
      )}

      {mode === 'result' && (
        <CoverLetterResult
          letter={letter}
          jobTitle={jobTitle}
          onStartOver={handleStartOver}
        />
      )}
    </div>
  )
}
