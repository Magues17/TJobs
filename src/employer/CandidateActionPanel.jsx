import { useEffect, useMemo, useState } from 'react'
import { NotebookPen, CircleAlert, CheckCircle2 } from 'lucide-react'
import { humanizeStatus } from './utils'

function toDatetimeLocalValue(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const offset = date.getTimezoneOffset()
  const local = new Date(date.getTime() - offset * 60000)
  return local.toISOString().slice(0, 16)
}

function Field({ label, children }) {
  return (
    <label className="block space-y-2">
      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">{label}</div>
      {children}
    </label>
  )
}

function inputClassName(extra = '') {
  return `w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-cyan-400 ${extra}`
}

function stageButtonClass(active, status) {
  const toneMap = {
    new: active
      ? 'border-cyan-400/30 bg-cyan-400 text-slate-950'
      : 'border-cyan-400/20 bg-cyan-400/10 text-cyan-300',
    reviewed: active
      ? 'border-amber-400/30 bg-amber-400 text-slate-950'
      : 'border-amber-400/20 bg-amber-400/10 text-amber-300',
    interview: active
      ? 'border-violet-400/30 bg-violet-400 text-slate-950'
      : 'border-violet-400/20 bg-violet-400/10 text-violet-300',
    rejected: active
      ? 'border-rose-400/30 bg-rose-400 text-slate-950'
      : 'border-rose-400/20 bg-rose-400/10 text-rose-300',
    hired: active
      ? 'border-emerald-400/30 bg-emerald-400 text-slate-950'
      : 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300',
  }

  return `inline-flex items-center justify-center rounded-2xl border px-3 py-2 text-sm font-medium transition ${
    toneMap[status] || (active ? 'border-cyan-400/30 bg-cyan-400 text-slate-950' : 'border-slate-700 bg-slate-900/70 text-slate-300')
  }`
}

export default function CandidateActionPanel({
  selectedResume,
  candidateAction,
  actionLoading,
  actionMessage,
  actionError,
  onSaveAction,
  candidateStatuses,
}) {
  const [status, setStatus] = useState('new')
  const [notes, setNotes] = useState('')
  const [interviewAt, setInterviewAt] = useState('')
  const [hiredAt, setHiredAt] = useState('')
  const [rejectedAt, setRejectedAt] = useState('')

  useEffect(() => {
    setStatus(candidateAction?.status || selectedResume?.candidate_status || 'new')
    setNotes(candidateAction?.notes || '')
    setInterviewAt(toDatetimeLocalValue(candidateAction?.interview_at))
    setHiredAt(toDatetimeLocalValue(candidateAction?.hired_at))
    setRejectedAt(toDatetimeLocalValue(candidateAction?.rejected_at))
  }, [candidateAction, selectedResume?.id, selectedResume?.candidate_status])

  const visibleStages = useMemo(
    () => candidateStatuses.filter((value) => value),
    [candidateStatuses]
  )

  if (!selectedResume) return null

  async function handleSubmit(e) {
    e.preventDefault()
    await onSaveAction(selectedResume.id, {
      status,
      notes,
      interview_at: status === 'interview' ? interviewAt || null : null,
      hired_at: status === 'hired' ? hiredAt || null : null,
      rejected_at: status === 'rejected' ? rejectedAt || null : null,
      contacted_at: null,
      next_follow_up_at: null,
    })
  }

  return (
    <section className="overflow-hidden rounded-[28px] border border-slate-800 bg-slate-900/85 shadow-[0_18px_60px_rgba(2,6,23,0.32)]">
      <div className="border-b border-slate-800 px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-cyan-400/10 text-cyan-300">
            <NotebookPen className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-white">Candidate Pipeline</h3>
            <p className="text-sm text-slate-400">Move this applicant through the simple hiring stages.</p>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5 p-5">
        <Field label="Hiring Stage">
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
            {visibleStages.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setStatus(value)}
                className={stageButtonClass(status === value, value)}
              >
                {humanizeStatus(value)}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Stage Dropdown">
          <select value={status} onChange={(e) => setStatus(e.target.value)} className={inputClassName()}>
            {visibleStages.map((value) => (
              <option key={value} value={value}>
                {humanizeStatus(value)}
              </option>
            ))}
          </select>
        </Field>

        {status === 'interview' ? (
          <Field label="Interview Date">
            <input
              type="datetime-local"
              value={interviewAt}
              onChange={(e) => setInterviewAt(e.target.value)}
              className={inputClassName()}
            />
          </Field>
        ) : null}

        {status === 'hired' ? (
          <Field label="Hired Date">
            <input
              type="datetime-local"
              value={hiredAt}
              onChange={(e) => setHiredAt(e.target.value)}
              className={inputClassName()}
            />
          </Field>
        ) : null}

        {status === 'rejected' ? (
          <Field label="Rejected Date">
            <input
              type="datetime-local"
              value={rejectedAt}
              onChange={(e) => setRejectedAt(e.target.value)}
              className={inputClassName()}
            />
          </Field>
        ) : null}

        <Field label="Private Notes">
          <textarea
            rows={6}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Add private notes about this candidate..."
            className={inputClassName('min-h-[144px] resize-y')}
          />
        </Field>

        {actionMessage && (
          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
            {actionMessage}
          </div>
        )}

        {actionError && (
          <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
            <div className="flex items-start gap-2">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{actionError}</span>
            </div>
          </div>
        )}

        <button
          type="submit"
          disabled={actionLoading}
          className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-cyan-400 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <CheckCircle2 className="h-4 w-4" />
          {actionLoading ? 'Saving...' : 'Save Candidate Stage'}
        </button>
      </form>
    </section>
  )
}
