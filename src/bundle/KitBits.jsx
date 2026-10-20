// Job Seeker Kit pieces shared by the three paid tool paywalls:
// an upsell link and a "use a credit" box.
import { useState } from 'react'
import { getStoredKitToken, storeKitToken } from './kitStorage'

const API_BASE = (import.meta.env.VITE_API_BASE || '/api').replace(/\/$/, '')

// product: 'resume_check' | 'cover_letter' | 'interview_prep'; orderToken: that tool's order token.
export default function KitPaywallExtras({ product, orderToken }) {
  const [kitToken, setKitToken] = useState(getStoredKitToken)
  const [open, setOpen] = useState(Boolean(getStoredKitToken()))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function redeem() {
    const token = kitToken.trim()
    if (!token) { setError('Paste your kit code first.'); return }
    setError('')
    setBusy(true)
    try {
      const res = await fetch(`${API_BASE}/bundle/${encodeURIComponent(token)}/redeem`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product, orderToken }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.resultUrl) throw new Error(data?.error || 'Could not use your credit.')
      storeKitToken(token)
      window.location.href = data.resultUrl
    } catch (err) {
      setError(err?.message || 'Could not use your credit.')
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3 text-sm">
      <div className="rounded-2xl border border-slate-700 bg-slate-900/70 px-4 py-3 text-slate-300">
        Need more than one tool?{' '}
        <a href="/?page=bundle" className="font-semibold text-emerald-300 underline">
          Get all three for $12.99
        </a>{' '}
        <span className="text-slate-400">(Resume Check + Cover Letter + Interview Prep, save $6.98)</span>
      </div>

      {orderToken ? (
        <div className="rounded-2xl border border-slate-700 bg-slate-900/70 px-4 py-3">
          {open ? (
            <div className="space-y-2">
              <div className="font-semibold text-slate-200">Have a Job Seeker Kit? Use a credit</div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  value={kitToken}
                  onChange={(e) => setKitToken(e.target.value)}
                  placeholder="kit_..."
                  autoComplete="off"
                  className="min-w-0 flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
                />
                <button
                  type="button"
                  onClick={redeem}
                  disabled={busy}
                  className="rounded-xl bg-emerald-400 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-300 disabled:opacity-60"
                >
                  {busy ? 'Applying…' : 'Use a credit'}
                </button>
              </div>
              {error ? <div className="text-rose-300">{error}</div> : null}
            </div>
          ) : (
            <button type="button" onClick={() => setOpen(true)} className="font-semibold text-emerald-300 underline">
              Have a Job Seeker Kit? Use a credit
            </button>
          )}
        </div>
      ) : null}
    </div>
  )
}
