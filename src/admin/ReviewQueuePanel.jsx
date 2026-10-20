// Free first posts waiting for approval, new self-serve employers, and the
// latest $29 job post orders. Loads its own data from /api/admin/review-queue.
import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, RefreshCw, XCircle } from 'lucide-react'
import { approveReviewJob, loadReviewQueue, rejectReviewJob } from './api'

const buttonBase = 'inline-flex items-center justify-center gap-2 rounded-2xl border px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60'

function formatDate(value) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString()
}

function cents(value) {
  return `$${((Number(value) || 0) / 100).toFixed(2)}`
}

export default function ReviewQueuePanel({ Card, refreshKey }) {
  const [queue, setQueue] = useState(null)
  const [loading, setLoading] = useState(false)
  const [busyId, setBusyId] = useState(null)
  const [reasons, setReasons] = useState({})
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setQueue(await loadReviewQueue())
    } catch (err) {
      setError(err?.message || 'Could not load the review queue.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load, refreshKey])

  async function decide(job, approve) {
    setBusyId(job.id)
    setError('')
    setNotice('')
    try {
      const result = approve ? await approveReviewJob(job.id) : await rejectReviewJob(job.id, reasons[job.id] || '')
      setNotice(result.message)
      await load()
    } catch (err) {
      setError(err?.message || 'Could not update the job.')
    } finally {
      setBusyId(null)
    }
  }

  const jobs = queue?.jobs || []
  const employers = queue?.employers || []
  const orders = queue?.orders || []

  return (
    <Card title={`Review queue${jobs.length ? ` (${jobs.length})` : ''}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <p className="max-w-3xl text-sm text-slate-400">
          Self-serve employers get one free post, held here until you approve it (live 30 days) or reject it with a reason
          (emailed to them). Later posts go live when their {cents(queue?.price_cents || 2900)} payment clears.
        </p>
        <button type="button" onClick={load} disabled={loading} className={`${buttonBase} border-slate-700 bg-slate-950/70 text-slate-200 hover:border-slate-600`}>
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Reload
        </button>
      </div>

      {error ? <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div> : null}
      {notice ? <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{notice}</div> : null}

      <div className="space-y-3">
        {jobs.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-700 p-4 text-sm text-slate-400">No posts waiting for review.</div> : null}
        {jobs.map((job) => (
          <div key={job.id} className="rounded-3xl border border-amber-500/25 bg-slate-950/55 p-4">
            <div className="text-base font-semibold text-white">{job.job_title}</div>
            <div className="mt-1 text-sm text-slate-400">
              {job.business_name} · {job.employer_email}
              {/^https?:\/\//i.test(job.employer_website || '') ? <> · <a href={job.employer_website} target="_blank" rel="noreferrer noopener" className="text-cyan-300 hover:underline">website</a></> : null}
              {' '}· {job.city || 'No city'} · submitted {formatDate(job.created_at)}
            </div>
            <p className="mt-3 max-h-48 overflow-y-auto whitespace-pre-line text-sm leading-6 text-slate-300">{job.job_description}</p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <input
                value={reasons[job.id] || ''}
                onChange={(event) => setReasons((prev) => ({ ...prev, [job.id]: event.target.value }))}
                placeholder="Reason, if rejecting (emailed to the employer)"
                className="w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-cyan-400/50"
              />
              <div className="flex gap-2">
                <button type="button" disabled={busyId === job.id} onClick={() => decide(job, true)} className={`${buttonBase} border-emerald-500/30 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/15`}>
                  <CheckCircle2 className="h-4 w-4" /> Approve
                </button>
                <button type="button" disabled={busyId === job.id || !(reasons[job.id] || '').trim()} onClick={() => decide(job, false)} className={`${buttonBase} border-rose-500/30 bg-rose-500/10 text-rose-200 hover:bg-rose-500/15`}>
                  <XCircle className="h-4 w-4" /> Reject
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">New self-serve employers</div>
          <div className="space-y-2 text-sm">
            {employers.length === 0 ? <div className="text-slate-500">None yet.</div> : null}
            {employers.map((employer) => (
              <div key={employer.id} className="rounded-2xl border border-slate-800 bg-slate-950/55 px-3 py-2 text-slate-300">
                <span className="font-semibold text-white">{employer.business_name}</span> · {employer.email}
                <span className={employer.verified ? 'text-emerald-300' : 'text-amber-300'}> · {employer.verified ? 'verified' : employer.access_status === 'inactive' ? 'deactivated' : 'unverified'}</span>
                <span className="text-slate-500"> · {employer.free_post_used_at ? 'free post used' : 'free post open'} · {formatDate(employer.created_at)}</span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Recent job post orders</div>
          <div className="space-y-2 text-sm">
            {orders.length === 0 ? <div className="text-slate-500">None yet.</div> : null}
            {orders.map((order) => (
              <div key={order.id} className="rounded-2xl border border-slate-800 bg-slate-950/55 px-3 py-2 text-slate-300">
                <span className="font-semibold text-white">{order.job_title || `Job #${order.job_id}`}</span> · {order.business_name || `Employer #${order.employer_id}`}
                <span className={order.payment_status === 'paid' ? 'text-emerald-300' : 'text-slate-400'}> · {order.kind} {cents(order.price_cents)} {order.payment_status}</span>
                <span className="text-slate-500"> · {formatDate(order.paid_at || order.created_at)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Card>
  )
}
