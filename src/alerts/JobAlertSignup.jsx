// Email job alert signup. Full form for the jobs list / no-results state,
// `compact` for the job detail page (alerts for jobs like the one shown).
import { useMemo, useState } from 'react'
import { Bell } from 'lucide-react'

const API_BASE = (import.meta.env.VITE_API_BASE || '/api').replace(/\/$/, '')

const JOB_TYPES = [
  ['', 'Any type'],
  ['full-time', 'Full Time'],
  ['part-time', 'Part Time'],
  ['temporary', 'Temporary'],
  ['contract', 'Contract'],
]

const fieldClass =
  'w-full min-h-[46px] rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-2.5 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-cyan-400'
const optionStyle = { backgroundColor: '#020617', color: '#f8fafc' }

function distinct(values) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b))
}

export default function JobAlertSignup({ jobs = [], keywords: searchKeywords = '', town: fixedTown = '', category: fixedCategory = '', compact = false }) {
  const towns = useMemo(() => distinct(jobs.map((job) => job.city)), [jobs])
  const categories = useMemo(() => distinct(jobs.map((job) => job.industry)), [jobs])
  const [email, setEmail] = useState('')
  const [typedKeywords, setTypedKeywords] = useState(null)
  const [town, setTown] = useState('')
  const [category, setCategory] = useState('')
  const [employmentType, setEmploymentType] = useState('')
  const [frequency, setFrequency] = useState('weekly')
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState('')

  // Follows the search box until the user edits the keyword field.
  const keywords = typedKeywords ?? searchKeywords

  async function handleSubmit(event) {
    event.preventDefault()
    setStatus('sending')
    setError('')
    const body = compact
      ? { email, town: fixedCategory ? '' : fixedTown, category: fixedCategory, frequency }
      : { email, keywords, town, category, employmentType, frequency }
    try {
      const response = await fetch(`${API_BASE}/alerts/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || !data.success) throw new Error(data.error || 'Could not save your alert. Please try again.')
      setStatus('done')
    } catch (submitError) {
      setError(submitError.message)
      setStatus('idle')
    }
  }

  const frame = 'rounded-[30px] border border-cyan-400/20 bg-slate-900/85 p-4 shadow-[0_18px_60px_rgba(2,6,23,0.24)] sm:p-6'

  if (status === 'done') {
    return (
      <section id="job-alerts" className={frame}>
        <div className="flex items-start gap-3">
          <Bell className="mt-0.5 h-5 w-5 shrink-0 text-cyan-300" />
          <div>
            <h3 className="text-base font-semibold text-white">Check your email to confirm</h3>
            <p className="mt-1 text-sm leading-6 text-slate-400">
              We sent a confirmation link to {email}. Your alerts start once you click it.
            </p>
          </div>
        </div>
      </section>
    )
  }

  const compactLabel = fixedCategory ? `new ${fixedCategory} jobs` : fixedTown ? `new jobs in ${fixedTown}` : 'new local jobs'

  return (
    <section id="job-alerts" className={frame}>
      <div className="flex items-start gap-3">
        <Bell className="mt-0.5 h-5 w-5 shrink-0 text-cyan-300" />
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-white">
            {compact ? `Get ${compactLabel} by email` : 'Get new jobs by email'}
          </h3>
          <p className="mt-1 text-sm leading-6 text-slate-400">Free. No account needed. Unsubscribe anytime.</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="mt-4 grid gap-3">
        <input
          type="email"
          required
          maxLength={255}
          autoComplete="email"
          placeholder="you@example.com"
          aria-label="Email address"
          className={fieldClass}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />

        {!compact && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <input
              maxLength={200}
              placeholder="Keywords (optional), e.g. nurse, forklift"
              aria-label="Keywords"
              className={fieldClass}
              value={keywords}
              onChange={(event) => setTypedKeywords(event.target.value)}
            />
            <select aria-label="Town" className={fieldClass} style={{ colorScheme: 'dark' }} value={town} onChange={(event) => setTown(event.target.value)}>
              <option value="" style={optionStyle}>Any town</option>
              {towns.map((value) => (
                <option key={value} value={value} style={optionStyle}>{value}</option>
              ))}
            </select>
            <select aria-label="Industry" className={fieldClass} style={{ colorScheme: 'dark' }} value={category} onChange={(event) => setCategory(event.target.value)}>
              <option value="" style={optionStyle}>Any industry</option>
              {categories.map((value) => (
                <option key={value} value={value} style={optionStyle}>{value}</option>
              ))}
            </select>
            <select aria-label="Job type" className={fieldClass} style={{ colorScheme: 'dark' }} value={employmentType} onChange={(event) => setEmploymentType(event.target.value)}>
              {JOB_TYPES.map(([value, label]) => (
                <option key={value} value={value} style={optionStyle}>{label}</option>
              ))}
            </select>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <select aria-label="How often" className={fieldClass} style={{ colorScheme: 'dark' }} value={frequency} onChange={(event) => setFrequency(event.target.value)}>
            <option value="weekly" style={optionStyle}>Weekly (Mondays)</option>
            <option value="daily" style={optionStyle}>Daily</option>
          </select>
          <button
            type="submit"
            disabled={status === 'sending'}
            className="min-h-[46px] rounded-2xl bg-cyan-400 px-5 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:opacity-60"
          >
            {status === 'sending' ? 'Saving…' : 'Email me jobs'}
          </button>
        </div>

        {error && <p className="text-sm text-rose-300">{error}</p>}
      </form>
    </section>
  )
}
