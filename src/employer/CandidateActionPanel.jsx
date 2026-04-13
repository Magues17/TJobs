import { useEffect, useState } from 'react'
import { NotebookPen } from 'lucide-react'

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

export default function CandidateActionPanel({
  selectedResume,
  candidateAction,
  actionLoading,
  actionMessage,
  actionError,
  onSaveAction,
  Card,
  Field,
  Input,
  Select,
  Textarea,
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
    <Card title="Candidate Tracking">
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Candidate Status">
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">No Status</option>
            {candidateStatuses
              .filter((value) => value !== '')
              .map((value) => (
                <option key={value} value={value}>
                  {humanizeStatus(value)}
                </option>
              ))}
          </Select>
        </Field>

        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Contacted Date">
            <Input
              type="datetime-local"
              value={contactedAt}
              onChange={(e) => setContactedAt(e.target.value)}
            />
          </Field>

          <Field label="Interview Date">
            <Input
              type="datetime-local"
              value={interviewAt}
              onChange={(e) => setInterviewAt(e.target.value)}
            />
          </Field>

          <Field label="Hired Date">
            <Input
              type="datetime-local"
              value={hiredAt}
              onChange={(e) => setHiredAt(e.target.value)}
            />
          </Field>

          <Field label="Rejected Date">
            <Input
              type="datetime-local"
              value={rejectedAt}
              onChange={(e) => setRejectedAt(e.target.value)}
            />
          </Field>
        </div>

        <Field label="Next Follow-Up Date">
          <Input
            type="datetime-local"
            value={nextFollowUpAt}
            onChange={(e) => setNextFollowUpAt(e.target.value)}
          />
        </Field>

        <Field label="Private Notes">
          <Textarea
            rows={6}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Add private notes about this candidate..."
          />
        </Field>

        {actionMessage && (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            {actionMessage}
          </div>
        )}

        {actionError && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            {actionError}
          </div>
        )}

        <button
          type="submit"
          disabled={actionLoading}
          className="inline-flex items-center gap-2 rounded-2xl bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <NotebookPen className="h-4 w-4" />
          {actionLoading ? 'Saving...' : 'Save Candidate Workflow'}
        </button>
      </form>
    </Card>
  )
}