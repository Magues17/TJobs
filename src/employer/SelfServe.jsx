// Free self-serve employer signup and pay-per-post UI: pricing, the Sign up
// free form, the email verification and post-payment landing pages, job
// status badges, the Pay $29 / Repost buttons and the AI "Write it for me".
import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, CreditCard, MailCheck, RefreshCw, Sparkles } from 'lucide-react'
import { draftJobDescription, signupEmployer, startEmployerJobPayment, startEmployerPlanUpgrade, verifyEmployerEmail } from './api'
import { getStoredEmployerToken, setStoredEmployerToken } from './auth'
import { track } from '../lib/track'

const JOB_POST_PRICE_LABEL = '$29'

const PLANS = [
  { name: 'First post', price: 'Free', note: 'Reviewed by our team, then live for 30 days.' },
  { name: 'Each post after', price: '$29', note: 'Pay once, live for 30 days. Repost any time.' },
  { name: 'Frequent hirers', price: '$49/mo', note: 'Unlimited posts, applicant search and the candidate pipeline.' },
  { name: 'Featured add-on', price: '$19/wk', note: 'Pin a post to the top of the job list.' },
]

export function EmployerPricing() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {PLANS.map((plan) => (
        <div key={plan.name} className="rounded-[24px] border border-slate-800 bg-slate-900/85 p-4 shadow-[0_18px_60px_rgba(2,6,23,0.24)]">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-300">{plan.name}</div>
          <div className="mt-2 text-2xl font-semibold text-white">{plan.price}</div>
          <p className="mt-2 text-sm leading-6 text-slate-400">{plan.note}</p>
        </div>
      ))}
    </div>
  )
}

const EMPTY_SIGNUP = { business_name: '', contact_name: '', email: '', password: '', phone: '', website: '' }

export function EmployerSignupForm({ Field, Input }) {
  const [form, setForm] = useState(EMPTY_SIGNUP)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [sentTo, setSentTo] = useState('')

  function handleChange(event) {
    const { name, value } = event.target
    setForm((prev) => ({ ...prev, [name]: value }))
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      await signupEmployer(form)
      setSentTo(form.email)
      setForm(EMPTY_SIGNUP)
    } catch (err) {
      setError(err.message || 'Could not sign you up. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (sentTo) {
    return (
      <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm leading-6 text-emerald-200">
        <div className="flex items-center gap-2 font-semibold text-emerald-100"><MailCheck className="h-4 w-4" /> Check your email</div>
        <p className="mt-2">We sent a confirmation link to <span className="font-semibold">{sentTo}</span>. It expires in 48 hours. Confirm it and you can post your first job free.</p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Business Name" required>
          <Input name="business_name" value={form.business_name} onChange={handleChange} autoComplete="organization" required />
        </Field>
        <Field label="Your Name" required>
          <Input name="contact_name" value={form.contact_name} onChange={handleChange} autoComplete="name" required />
        </Field>
        <Field label="Email" required>
          <Input type="email" name="email" value={form.email} onChange={handleChange} autoComplete="email" placeholder="owner@business.com" required />
        </Field>
        <Field label="Password" required>
          <Input type="password" name="password" value={form.password} onChange={handleChange} autoComplete="new-password" minLength={8} placeholder="At least 8 characters" required />
        </Field>
        <Field label="Phone">
          <Input type="tel" name="phone" value={form.phone} onChange={handleChange} autoComplete="tel" />
        </Field>
        <Field label="Website">
          <Input type="url" name="website" value={form.website} onChange={handleChange} placeholder="https://" />
        </Field>
      </div>

      {error ? <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div> : null}

      <button
        type="submit"
        disabled={submitting}
        className="inline-flex w-full items-center justify-center rounded-2xl bg-cyan-400 px-5 py-3 text-sm font-semibold text-slate-950 shadow-[0_12px_30px_rgba(34,211,238,0.18)] transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
      >
        {submitting ? 'Creating your account…' : 'Sign up free'}
      </button>
    </form>
  )
}

// Shown under the sign-in error "Please confirm your email first".
export function ResendConfirmation({ email }) {
  const [state, setState] = useState('idle')
  async function resend() {
    setState('sending')
    try {
      const base = (import.meta.env.VITE_API_BASE || '/api').replace(/\/$/, '')
      const response = await fetch(`${base}/employer/resend-verification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      setState(response.ok ? 'sent' : 'error')
    } catch {
      setState('error')
    }
  }
  if (state === 'sent') return <p className="text-sm text-emerald-300">Sent — check your inbox.</p>
  return (
    <button type="button" disabled={state === 'sending' || !email} onClick={resend} className="text-sm font-medium text-cyan-300 hover:underline disabled:opacity-60">
      {state === 'error' ? 'Could not send. Try again' : 'Resend confirmation email'}
    </button>
  )
}

function LandingCard({ icon: Icon, title, children }) {
  return (
    <div className="mx-auto max-w-xl rounded-[30px] border border-slate-800 bg-slate-900/90 p-6 text-slate-300 shadow-[0_18px_60px_rgba(2,6,23,0.24)]">
      <div className="flex items-center gap-2 text-lg font-semibold text-white"><Icon className="h-5 w-5 text-cyan-300" /> {title}</div>
      <div className="mt-3 space-y-4 text-sm leading-6">{children}</div>
    </div>
  )
}

const buttonClass = 'inline-flex items-center justify-center rounded-2xl bg-cyan-400 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300'

// The link is single-use, so the request must not run twice (React
// StrictMode runs effects twice in development).
export function EmployerVerifyPage({ onVerified, setCurrentPage }) {
  const started = useRef(false)
  const [state, setState] = useState({ status: 'working', message: 'Confirming your email…' })

  useEffect(() => {
    if (started.current) return
    started.current = true
    const token = new URLSearchParams(window.location.search).get('token') || ''
    window.history.replaceState({}, '', '/')
    verifyEmployerEmail(token)
      .then(async (data) => {
        setStoredEmployerToken(data.auth_token)
        await onVerified?.(data.auth_token)
        setState({ status: 'done', message: data.message })
      })
      .catch((error) => setState({ status: 'error', message: error.message || 'This confirmation link did not work.' }))
  }, [onVerified])

  return (
    <LandingCard icon={state.status === 'error' ? RefreshCw : MailCheck} title={state.status === 'error' ? 'Link not valid' : 'Email confirmation'}>
      <p>{state.message}</p>
      {state.status === 'done' ? (
        <button type="button" className={buttonClass} onClick={() => { window.history.replaceState({}, '', '/?tab=jobs'); setCurrentPage('employer-dashboard') }}>Post your free job</button>
      ) : null}
      {state.status === 'error' ? (
        <button type="button" className={buttonClass} onClick={() => setCurrentPage('list-business')}>Sign up again</button>
      ) : null}
    </LandingCard>
  )
}

export function EmployerJobPaidPage({ setCurrentPage, signedIn }) {
  useEffect(() => {
    window.history.replaceState({}, '', '/')
  }, [])
  return (
    <LandingCard icon={CheckCircle2} title="Payment received">
      <p>Thanks! Your job goes live as soon as Square confirms the payment, usually within a minute. It stays up for 30 days.</p>
      <button type="button" className={buttonClass} onClick={() => setCurrentPage(signedIn ? 'employer-dashboard' : 'employer-login')}>
        Go to my jobs
      </button>
    </LandingCard>
  )
}

// After Square's redirect for the $49/month plan. The webhook flips the plan
// a moment later, so the employer profile is reloaded now and again shortly.
export function EmployerPlanUpgradedPage({ setCurrentPage, signedIn, reloadProfile }) {
  // App recreates reloadProfile every render; a dependency on it would loop.
  const reload = useRef(reloadProfile)
  reload.current = reloadProfile
  useEffect(() => {
    window.history.replaceState({}, '', '/')
    reload.current?.()
    const timer = window.setTimeout(() => reload.current?.(), 8000)
    return () => window.clearTimeout(timer)
  }, [])
  return (
    <LandingCard icon={CheckCircle2} title="Payment received">
      <p>Your unlimited plan is active once Square confirms payment — usually within a minute. Any jobs waiting on payment go live then.</p>
      <button type="button" className={buttonClass} onClick={() => setCurrentPage(signedIn ? 'employer-dashboard' : 'employer-login')}>
        Go to my dashboard
      </button>
    </LandingCard>
  )
}

const BADGES = {
  pending_review: ['Pending review', 'border-amber-400/30 bg-amber-400/10 text-amber-200'],
  awaiting_payment: ['Awaiting payment', 'border-violet-400/30 bg-violet-400/10 text-violet-200'],
  open: ['Live', 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300'],
  expired: ['Expired', 'border-slate-600 bg-slate-800 text-slate-300'],
  rejected: ['Needs changes', 'border-rose-400/30 bg-rose-400/10 text-rose-300'],
}

export function JobStatusBadge({ status, fallback }) {
  const [label, tone] = BADGES[status] || [fallback, 'border-slate-700 bg-white/5 text-slate-300']
  return <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${tone}`}>{label}</span>
}

function canPayForJob(status) {
  return ['awaiting_payment', 'expired', 'closed', 'filled'].includes(status)
}

// Starts the $49/month plan checkout for a pay-per-post employer.
export function UpgradePlanButton({ label = 'Switch to unlimited — $49/month', className }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function handleClick() {
    setBusy(true)
    setError('')
    try {
      const data = await startEmployerPlanUpgrade(getStoredEmployerToken())
      track('checkout_start', { product: 'employer_plan_upgrade' })
      window.location.assign(data.checkout_url)
    } catch (err) {
      setError(err.message || 'Could not start the checkout.')
      setBusy(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={busy}
        className={className || 'inline-flex items-center gap-1.5 rounded-2xl border border-cyan-400/40 bg-transparent px-3 py-2 text-xs font-semibold text-cyan-200 transition hover:bg-cyan-400/10 disabled:cursor-not-allowed disabled:opacity-60'}
      >
        {busy ? 'Opening Square…' : label}
      </button>
      {error ? <span className="w-full text-xs text-rose-300">{error}</span> : null}
    </>
  )
}

export function PayForJobButton({ job }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (!canPayForJob(job.status)) return null

  async function handleClick() {
    setBusy(true)
    setError('')
    try {
      const data = await startEmployerJobPayment(getStoredEmployerToken(), job.id)
      track('checkout_start', { product: 'job_post' })
      window.location.assign(data.checkout_url)
    } catch (err) {
      setError(err.message || 'Could not start the payment.')
      setBusy(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-2xl border border-cyan-400/30 bg-cyan-400 px-3 py-2 text-xs font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <CreditCard className="h-3.5 w-3.5" />
        {busy ? 'Opening Square…' : job.status === 'awaiting_payment' ? `Publish this job — ${JOB_POST_PRICE_LABEL}` : `Repost for ${JOB_POST_PRICE_LABEL}`}
      </button>
      <UpgradePlanButton label="Unlimited posts — $49/month" />
      {error ? <span className="w-full text-xs text-rose-300">{error}</span> : null}
    </>
  )
}

export function AiDraftButton({ title, notes, onDraft }) {
  const [busy, setBusy] = useState(false)
  const [info, setInfo] = useState('')
  const [error, setError] = useState('')

  async function handleClick() {
    setError('')
    setInfo('')
    if (!title.trim()) {
      setError('Enter a job title first.')
      return
    }
    setBusy(true)
    try {
      const data = await draftJobDescription(getStoredEmployerToken(), { title, notes })
      onDraft(data.description)
      setInfo(`${data.remaining} AI draft${data.remaining === 1 ? '' : 's'} left${data.per_day ? ' today' : ''}. Check it over before posting.`)
    } catch (err) {
      setError(err.message || 'Could not write a draft.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-2xl border border-cyan-400/25 bg-cyan-400/10 px-3 py-2 text-xs font-semibold text-cyan-200 transition hover:bg-cyan-400/15 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <Sparkles className="h-3.5 w-3.5" /> {busy ? 'Writing…' : 'Write it for me'}
      </button>
      <span className="text-xs text-slate-500">Type a few notes in the description, then let AI polish them.</span>
      {info ? <span className="w-full text-xs text-emerald-300">{info}</span> : null}
      {error ? <span className="w-full text-xs text-rose-300">{error}</span> : null}
    </div>
  )
}
