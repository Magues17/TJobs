import { useEffect, useState } from 'react'
import { NotebookPen, CalendarClock, CircleAlert } from 'lucide-react'

function humanizeStatus(value) {
  if (!value) return '—'
  return value
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

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

export default function CandidateActionPanel({
  selectedResume,
  candidateAction,
  actionLoading,
  actionMessage,
  actionError,
  onSaveAction,
  candidateStatuses,
}) {
  const [status, setStatus] = useState('')
  const [notes, setNotes] = useState('')
  const [contactedAt, setContactedAt] = useState('')
  const [interviewAt, setInterviewAt] = useState('')
  const [hiredAt, setHiredAt] = useState('')
  const [rejectedAt, setRejectedAt] = useState('')
  const [nextFollowUpAt, setNextFollowUpAt] = useState('')

  useEffect(() => {
    setStatus(candidateAction?.status || '')
    setNotes(candidateAction?.notes || '')
    setContactedAt(toDatetimeLocalValue(candidateAction?.contacted_at))
    setInterviewAt(toDatetimeLocalValue(candidateAction?.interview_at))
    setHiredAt(toDatetimeLocalValue(candidateAction?.hired_at))
    setRejectedAt(toDatetimeLocalValue(candidateAction?.rejected_at))
    setNextFollowUpAt(toDatetimeLocalValue(candidateAction?.next_follow_up_at))
  }, [candidateAction, selectedResume?.id])

  if (!selectedResume) return null

  async function handleSubmit(e) {
    e.preventDefault()
    await onSaveAction(selectedResume.id, {
      status,
      notes,
      contacted_at: contactedAt || null,
      interview_at: interviewAt || null,
      hired_at: hiredAt || null,
      rejected_at: rejectedAt || null,
      next_follow_up_at: nextFollowUpAt || null,
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
            <h3 className="text-base font-semibold text-white">Candidate Tracking</h3>
            <p className="text-sm text-slate-400">Manage workflow, dates, and private notes for this candidate.</p>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5 p-5">
        <Field label="Candidate Status">
          <select value={status} onChange={(e) => setStatus(e.target.value)} className={inputClassName()}>
            <option value="">No Status</option>
            {candidateStatuses
              .filter((value) => value !== '')
              .map((value) => (
                <option key={value} value={value}>
                  {humanizeStatus(value)}
                </option>
              ))}
          </select>
        </Field>

        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Contacted Date">
            <input
              type="datetime-local"
              value={contactedAt}
              onChange={(e) => setContactedAt(e.target.value)}
              className={inputClassName()}
            />
          </Field>

          <Field label="Interview Date">
            <input
              type="datetime-local"
              value={interviewAt}
              onChange={(e) => setInterviewAt(e.target.value)}
              className={inputClassName()}
            />
          </Field>

          <Field label="Hired Date">
            <input
              type="datetime-local"
              value={hiredAt}
              onChange={(e) => setHiredAt(e.target.value)}
              className={inputClassName()}
            />
          </Field>

          <Field label="Rejected Date">
            <input
              type="datetime-local"
              value={rejectedAt}
              onChange={(e) => setRejectedAt(e.target.value)}
              className={inputClassName()}
            />
          </Field>
        </div>

        <Field label="Next Follow-Up Date">
          <div className="relative">
            <CalendarClock className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              type="datetime-local"
              value={nextFollowUpAt}
              onChange={(e) => setNextFollowUpAt(e.target.value)}
              className={inputClassName('pl-11')}
            />
          </div>
        </Field>

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
          <NotebookPen className="h-4 w-4" />
          {actionLoading ? 'Saving...' : 'Save Candidate Workflow'}
        </button>
      </form>
    </section>
  )
}
