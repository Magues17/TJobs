// ?page=alerts-confirm&token=... and ?page=alerts-unsubscribe&token=...
// Both act on load (no button) and show the result.
import { useEffect, useRef, useState } from 'react'
import { Bell } from 'lucide-react'

const API_BASE = (import.meta.env.VITE_API_BASE || '/api').replace(/\/$/, '')

const COPY = {
  'alerts-confirm': {
    title: 'Job alert',
    working: 'Confirming your job alert…',
    request: (token) => fetch(`${API_BASE}/alerts/confirm?token=${encodeURIComponent(token)}`),
    failHint: 'If you already confirmed, you are all set. Otherwise sign up again to get a new link.',
  },
  'alerts-unsubscribe': {
    title: 'Unsubscribe',
    working: 'Unsubscribing…',
    request: (token) => fetch(`${API_BASE}/alerts/unsubscribe?token=${encodeURIComponent(token)}`, { method: 'POST' }),
    failHint: 'Use the unsubscribe link from your most recent alert email.',
  },
}

export default function AlertPage({ page }) {
  const copy = COPY[page]
  const [state, setState] = useState({ status: 'working', message: '' })
  const started = useRef(false)

  useEffect(() => {
    // Run once even under StrictMode: the confirm token is single-use.
    if (started.current) return
    started.current = true
    const token = new URLSearchParams(window.location.search).get('token') || ''
    copy
      .request(token)
      .then(async (response) => {
        const data = await response.json().catch(() => ({}))
        setState(
          response.ok && data.success
            ? { status: 'ok', message: data.message }
            : { status: 'error', message: data.error || 'This link did not work.' }
        )
      })
      .catch(() => setState({ status: 'error', message: 'Could not reach TarboroJobs. Please try again.' }))
  }, [copy])

  return (
    <div className="mx-auto max-w-xl">
      <section className="rounded-[30px] border border-slate-800 bg-slate-900/85 p-6 text-center shadow-[0_18px_60px_rgba(2,6,23,0.24)] sm:p-8">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-3xl border border-slate-700 bg-slate-950/70 text-cyan-300">
          <Bell className="h-7 w-7" />
        </div>
        <h1 className="text-xl font-semibold text-white">{copy.title}</h1>
        <p className="mt-3 text-sm leading-6 text-slate-300">
          {state.status === 'working' ? copy.working : state.message}
        </p>
        {state.status === 'error' && <p className="mt-2 text-sm leading-6 text-slate-400">{copy.failHint}</p>}
        {state.status === 'ok' && page === 'alerts-confirm' && (
          <p className="mt-2 text-sm leading-6 text-slate-400">New matching jobs will arrive by email. Every email has an unsubscribe link.</p>
        )}
        {state.status !== 'working' && (
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
            <a href="/" className="rounded-2xl bg-cyan-400 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300">
              Browse jobs
            </a>
            {page === 'alerts-unsubscribe' && state.status === 'ok' && (
              <a href="/#job-alerts" className="rounded-2xl border border-slate-700 px-5 py-3 text-sm font-medium text-slate-200 transition hover:border-slate-600">
                Changed your mind? Resubscribe
              </a>
            )}
          </div>
        )}
      </section>
    </div>
  )
}
