import { useState } from 'react'
import { Star } from 'lucide-react'
import { startFeaturedCheckout } from './api'
import { track } from '../lib/track'

const WEEK_PRICE = 19

function formatDate(value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

// Employer dashboard: per-job "Feature this job" checkout and featured status.
export default function FeatureJobControl({ job }) {
  const [weeks, setWeeks] = useState(1)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const featured = Number(job.is_featured) === 1

  async function handleFeature() {
    setBusy(true)
    setError('')
    try {
      track('checkout_start', { product: 'featured', job_id: job.id })
      const data = await startFeaturedCheckout(job.id, weeks)
      window.location.assign(data.checkoutUrl)
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  if (job.status !== 'open') return null

  return (
    <div className="flex flex-wrap items-center gap-2">
      {featured ? (
        <span className="inline-flex items-center gap-1 rounded-2xl border border-amber-400/40 bg-amber-400/15 px-3 py-2 text-xs font-semibold text-amber-200">
          <Star className="h-3.5 w-3.5" /> Featured until {formatDate(job.featured_until)}
        </span>
      ) : null}
      <select
        value={weeks}
        onChange={(e) => setWeeks(Number(e.target.value))}
        aria-label="Weeks to feature"
        className="rounded-2xl border border-slate-700 bg-slate-950/70 px-2 py-2 text-xs text-slate-200"
      >
        {[1, 2, 3, 4].map((n) => (
          <option key={n} value={n}>{n} week{n > 1 ? 's' : ''} (${WEEK_PRICE * n})</option>
        ))}
      </select>
      <button
        type="button"
        onClick={handleFeature}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-2xl border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs font-medium text-amber-200 transition hover:bg-amber-400/15 disabled:opacity-60"
      >
        <Star className="h-3.5 w-3.5" /> {busy ? 'Opening checkout...' : featured ? 'Extend featured' : `Feature this job - $${WEEK_PRICE}/week`}
      </button>
      {error ? <span className="text-xs text-rose-300">{error}</span> : null}
    </div>
  )
}
