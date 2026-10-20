// Job Seeker Kit page: /?page=bundle (buy) and /?page=bundle&token=kit_... (credits).
import { useEffect, useState } from 'react'
import { track } from '../lib/track'
import { storeKitToken } from './kitStorage'

const API_BASE = (import.meta.env.VITE_API_BASE || '/api').replace(/\/$/, '')
const POLL_MS = 4000
const POLL_MAX = 75 // ~5 minutes

const TOOLS = [
  { product: 'resume_check', label: 'Resume Check', page: 'resume-checker', blurb: 'Score out of 100, ATS check, bullet rewrites' },
  { product: 'cover_letter', label: 'Cover Letter', page: 'cover-letter', blurb: 'Tailored to the job, ready to send' },
  { product: 'interview_prep', label: 'Interview Prep', page: 'interview-prep', blurb: '10 likely questions with answers' },
]

function Panel({ children, className = '' }) {
  return (
    <section className={`rounded-[30px] border border-slate-800 bg-slate-900/85 p-5 shadow-[0_18px_60px_rgba(2,6,23,0.24)] sm:p-7 ${className}`}>
      {children}
    </section>
  )
}

function Buy({ priceCents }) {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const price = `$${(priceCents / 100).toFixed(2)}`

  async function buy() {
    setError('')
    setBusy(true)
    try {
      const res = await fetch(`${API_BASE}/bundle/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() || undefined }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.checkoutUrl) throw new Error(data?.error || 'Could not start checkout.')
      if (data.token) storeKitToken(data.token)
      track('checkout_start', { product: 'bundle' })
      window.location.href = data.checkoutUrl
    } catch (err) {
      setError(err?.message || 'Could not start checkout.')
      setBusy(false)
    }
  }

  return (
    <Panel className="space-y-5">
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-300">Job Seeker Kit</div>
        <h1 className="mt-1 text-2xl font-semibold text-white">Everything you need to land the interview</h1>
        <p className="mt-2 text-sm text-slate-300">
          One Resume Check, one Cover Letter and one Interview Prep Pack. Use them whenever you like, on whichever job you want.
        </p>
      </div>

      <ul className="space-y-2">
        {TOOLS.map((t) => (
          <li key={t.product} className="flex items-start gap-2 text-sm text-slate-200">
            <span className="text-emerald-300">✓</span>
            <span><span className="font-semibold">{t.label}</span> <span className="text-slate-400">- {t.blurb}</span></span>
          </li>
        ))}
      </ul>

      <div className="rounded-[24px] border border-emerald-400/30 bg-emerald-400/10 p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-3xl font-bold text-white">{price}</div>
            <div className="text-xs text-slate-400">one-time, instead of $19.97 separately - save $6.98</div>
          </div>
        </div>
        <label className="mt-4 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
          Email (optional, for your receipt)
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm normal-case tracking-normal text-slate-100"
          />
        </label>
        <button
          type="button"
          onClick={buy}
          disabled={busy}
          className="mt-4 w-full rounded-2xl bg-emerald-400 px-5 py-3 text-sm font-semibold text-slate-950 hover:bg-emerald-300 disabled:opacity-60 sm:w-auto"
        >
          {busy ? 'Starting checkout…' : `Get the Job Seeker Kit – ${price}`}
        </button>
        <div className="mt-2 text-xs text-slate-400">Secure checkout via Square. Nothing is written by our AI until you use a credit.</div>
      </div>
      {error ? <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div> : null}
    </Panel>
  )
}

function Credits({ token }) {
  const [kit, setKit] = useState(null) // null = loading
  const [missing, setMissing] = useState(false)
  const [timedOut, setTimedOut] = useState(false)

  useEffect(() => {
    let cancelled = false
    let timer = null
    let attempts = 0
    async function load() {
      try {
        const res = await fetch(`${API_BASE}/bundle/${encodeURIComponent(token)}`)
        const data = await res.json().catch(() => ({}))
        if (cancelled) return
        if (res.status === 404) { setMissing(true); return }
        if (data?.success) {
          setKit(data)
          if (data.status === 'paid') return
        }
      } catch { /* keep trying */ }
      attempts += 1
      if (attempts >= POLL_MAX) { setTimedOut(true); return }
      timer = setTimeout(load, POLL_MS)
    }
    load()
    return () => { cancelled = true; clearTimeout(timer) }
  }, [token])

  useEffect(() => { storeKitToken(token) }, [token])

  if (missing) {
    return <Panel><div className="text-lg font-semibold text-white">We couldn't find that kit</div><p className="mt-2 text-sm text-slate-300">Check the link, or email <a className="text-emerald-300 underline" href="mailto:jobs@tarborojobs.com">jobs@tarborojobs.com</a>.</p></Panel>
  }
  if (!kit || kit.status !== 'paid') {
    return (
      <Panel className="flex items-center gap-3 text-sm text-slate-300">
        <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-emerald-300 border-t-transparent" />
        {timedOut ? 'Still waiting for your payment to confirm - refresh this page in a minute.' : 'Waiting for your payment to confirm…'}
      </Panel>
    )
  }

  return (
    <Panel className="space-y-5">
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-300">Payment received</div>
        <h1 className="mt-1 text-2xl font-semibold text-white">Your Job Seeker Kit</h1>
        <p className="mt-2 text-sm text-slate-300">
          Open a tool, fill it in, and choose "Use a credit" instead of paying. Your kit code is saved in this browser. Bookmark this page to come back to it.
        </p>
      </div>
      <ul className="space-y-3">
        {TOOLS.map((t) => {
          const left = Number(kit.credits?.[t.product]) || 0
          return (
            <li key={t.product} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-700 bg-slate-950/60 px-4 py-3">
              <div>
                <div className="font-semibold text-white">{t.label}</div>
                <div className="text-xs text-slate-400">{left > 0 ? '1 credit left' : 'Used'}</div>
              </div>
              {left > 0 ? (
                <a href={`/?page=${t.page}`} className="rounded-xl bg-emerald-400 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-300">
                  Start
                </a>
              ) : (
                <span className="text-sm text-slate-500">Done ✓</span>
              )}
            </li>
          )
        })}
      </ul>
      <div className="text-xs text-slate-400">
        Kit code: <span className="break-all font-mono text-slate-300">{token}</span>
      </div>
    </Panel>
  )
}

export default function BundlePage() {
  const params = new URLSearchParams(window.location.search)
  const token = params.get('token') || ''
  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-8">
      {token ? <Credits token={token} /> : <Buy priceCents={1299} />}
    </div>
  )
}
