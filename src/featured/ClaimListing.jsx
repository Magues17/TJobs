import { useState } from 'react'
import { submitClaimRequest } from './api'

const FIELDS = [
  ['name', 'Your name', 'text', true],
  ['email', 'Work email', 'email', true],
  ['phone', 'Phone', 'tel', false],
  ['organization', 'Organization', 'text', false],
  ['role', 'Your role', 'text', false],
]

const inputClass =
  'w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-white outline-none focus:border-cyan-400/50'

// Shown on scraped job pages whose employer has no login yet (job.claimable).
export default function ClaimListing({ job }) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ organization: job.company || '' })
  const [state, setState] = useState({ sending: false, done: '', error: '' })

  async function handleSubmit(event) {
    event.preventDefault()
    setState({ sending: true, done: '', error: '' })
    try {
      const data = await submitClaimRequest(job.id, form)
      setState({ sending: false, done: data.message, error: '' })
    } catch (error) {
      setState({ sending: false, done: '', error: error.message })
    }
  }

  return (
    <div className="rounded-[26px] border border-slate-800 bg-slate-900/80 p-5 text-sm text-slate-400">
      <div className="font-semibold text-white">Is this your organization?</div>
      {state.done ? (
        <p className="mt-2 text-emerald-300">{state.done}</p>
      ) : !open ? (
        <>
          <p className="mt-1">Claim this listing to get an employer login and feature your openings at the top of the board.</p>
          <button type="button" onClick={() => setOpen(true)} className="mt-3 rounded-2xl border border-slate-700 bg-white/5 px-4 py-2 text-sm font-medium text-slate-200 transition hover:border-slate-600">
            Claim this listing
          </button>
        </>
      ) : (
        <form className="mt-3 space-y-3" onSubmit={handleSubmit}>
          {FIELDS.map(([key, label, type, required]) => (
            <label key={key} className="block">
              <span className="mb-1 block text-xs text-slate-400">{label}{required ? ' *' : ''}</span>
              <input
                type={type}
                required={required}
                value={form[key] || ''}
                onChange={(e) => setForm((prev) => ({ ...prev, [key]: e.target.value }))}
                className={inputClass}
              />
            </label>
          ))}
          <label className="block">
            <span className="mb-1 block text-xs text-slate-400">Message</span>
            <textarea rows={3} value={form.message || ''} onChange={(e) => setForm((prev) => ({ ...prev, message: e.target.value }))} className={inputClass} />
          </label>
          <p className="text-xs text-slate-500">
            We check every request by hand. Use an email at your organization's domain to speed things up. Listings stay synced from your official site, so their text cannot be edited here.
          </p>
          {state.error ? <p className="text-rose-300">{state.error}</p> : null}
          <button type="submit" disabled={state.sending} className="w-full rounded-2xl bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:opacity-60">
            {state.sending ? 'Sending...' : 'Send claim request'}
          </button>
        </form>
      )}
    </div>
  )
}
