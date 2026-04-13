import { useEffect, useState } from 'react'
import {
  PlusCircle,
  XCircle,
  CheckCircle,
  PencilLine,
  Download,
  UserRound,
  FileBadge,
  ChevronLeft,
  ChevronRight,
  Mail,
  Phone,
  Search,
  Trash2,
  Bookmark,
  Users,
  Briefcase,
  ClipboardList,
  CalendarDays,
  BellRing,
} from 'lucide-react'
import {
  humanizeJobType,
  humanizeStatus,
  humanizePayType,
  resumeFileHref,
} from './utils'

function getEmptyJobForm(defaultCity = 'Tarboro, NC') {
  return {
    job_title: '',
    job_description: '',
    city: defaultCity,
    pay_min: '',
    pay_max: '',
    pay_type: 'hourly',
    employment_type: 'full-time',
    experience_level: '',
    status: 'open',
  }
}

function formatDateTime(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString()
}

function StatCard({ icon: Icon, label, value, accent = 'emerald' }) {
  const accentMap = {
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    blue: 'bg-blue-50 text-blue-700 border-blue-200',
    amber: 'bg-amber-50 text-amber-700 border-amber-200',
    rose: 'bg-rose-50 text-rose-700 border-rose-200',
    slate: 'bg-slate-50 text-slate-700 border-slate-200',
  }

  return (
    <div className={`rounded-3xl border p-5 ${accentMap[accent] || accentMap.slate}`}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide opacity-80">{label}</div>
          <div className="mt-2 text-3xl font-bold">{value}</div>
        </div>
        <div className="rounded-2xl bg-white/70 p-3">
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  )
}

export default function EmployerDashboardPage({
  employerSession,
  employerJobs,
  jobsLoading,
  employerResumes,
  resumesLoading,
  resumeFilters,
  resumePagination,
  selectedResume,
  candidateActions,
  actionLoading,
  actionMessage,
  actionError,
  candidateView,
  onCandidateViewChange,
  onResumeFilterChange,
  onResumePageChange,
  onSelectResume,
  onCreateJob,
  onUpdateJob,
  onDeleteJob,
  onStartEditJob,
  onCancelEditJob,
  editingJobId,
  onUpdateJobStatus,
  onSaveCandidateAction,
  employerStats,
  statsLoading,
  Card,
  Field,
  Input,
  Select,
  Textarea,
  SectionHeader,
  employerJobTypes,
  employerPayTypes,
  employerResumeTypes,
  candidateStatuses,
  fileBase,
  CandidateActionPanel,
}) {
  const employer = employerSession?.employer
  const selectedCandidateAction = selectedResume ? candidateActions[selectedResume.id] || null : null

  const [jobForm, setJobForm] = useState(getEmptyJobForm(employer?.city || 'Tarboro, NC'))
  const [jobLoading, setJobLoading] = useState(false)
  const [jobError, setJobError] = useState('')
  const [jobMessage, setJobMessage] = useState('')
  const [deletingJobId, setDeletingJobId] = useState(null)

  useEffect(() => {
    if (!editingJobId) {
      setJobForm(getEmptyJobForm(employer?.city || 'Tarboro, NC'))
    }
  }, [editingJobId, employer?.city])

  function handleJobFormChange(e) {
    const { name, value } = e.target
    setJobForm((prev) => ({ ...prev, [name]: value }))
  }

  function beginEditJob(job) {
    setJobError('')
    setJobMessage('')
    setJobForm({
      job_title: job.job_title || '',
      job_description: job.job_description || '',
      city: job.city || employer?.city || 'Tarboro, NC',
      pay_min: job.pay_min ?? '',
      pay_max: job.pay_max ?? '',
      pay_type: job.pay_type || 'hourly',
      employment_type: job.employment_type || 'full-time',
      experience_level: job.experience_level || '',
      status: job.status || 'open',
    })
    onStartEditJob(job.id)
  }

  function cancelEdit() {
    setJobError('')
    setJobMessage('')
    setJobForm(getEmptyJobForm(employer?.city || 'Tarboro, NC'))
    onCancelEditJob()
  }

  async function handleSubmitJob(e) {
    e.preventDefault()
    setJobLoading(true)
    setJobError('')
    setJobMessage('')

    try {
      const payload = {
        ...jobForm,
        pay_min: jobForm.pay_min === '' ? null : Number(jobForm.pay_min),
        pay_max: jobForm.pay_max === '' ? null : Number(jobForm.pay_max),
      }

      if (editingJobId) {
        await onUpdateJob(editingJobId, payload)
        setJobMessage('Job updated successfully.')
      } else {
        await onCreateJob(payload)
        setJobMessage('Job posted successfully.')
      }

      setJobForm(getEmptyJobForm(employer?.city || 'Tarboro, NC'))
      onCancelEditJob()
    } catch (err) {
      setJobError(err.message || (editingJobId ? 'Failed to update job.' : 'Failed to create job.'))
    } finally {
      setJobLoading(false)
    }
  }

  async function handleDeleteJob(job) {
    const confirmed = window.confirm(
      `Delete "${job.job_title}"?\n\nThis cannot be undone.`
    )

    if (!confirmed) return

    setDeletingJobId(job.id)
    setJobError('')
    setJobMessage('')

    try {
      await onDeleteJob(job.id)

      if (editingJobId === job.id) {
        cancelEdit()
      }

      setJobMessage('Job deleted successfully.')
    } catch (err) {
      setJobError(err.message || 'Failed to delete job.')
    } finally {
      setDeletingJobId(null)
    }
  }

  const showingSavedOnly = candidateView === 'saved'
  const filteredCount = resumePagination?.total || 0
  const overallTotalResumes = employerStats?.total_resumes || 0

  return (
    <div className="mx-auto max-w-7xl">
      <SectionHeader
        title="Employer Dashboard"
        subtitle="Manage your employer account, job postings, and candidate resumes"
      />

      <div className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <StatCard
          icon={Briefcase}
          label="Open Jobs"
          value={statsLoading ? '...' : employerStats?.open_jobs ?? 0}
          accent="emerald"
        />
        <StatCard
          icon={ClipboardList}
          label="Total Resumes"
          value={statsLoading ? '...' : employerStats?.total_resumes ?? 0}
          accent="blue"
        />
        <StatCard
          icon={Bookmark}
          label="Saved Candidates"
          value={statsLoading ? '...' : employerStats?.saved_candidates ?? 0}
          accent="amber"
        />
        <StatCard
          icon={CalendarDays}
          label="Interviews Scheduled"
          value={statsLoading ? '...' : employerStats?.interviews_scheduled ?? 0}
          accent="slate"
        />
        <StatCard
          icon={BellRing}
          label="Follow-Ups Due"
          value={statsLoading ? '...' : employerStats?.follow_ups_due ?? 0}
          accent="rose"
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[360px_1fr]">
        <div className="space-y-6">
          <Card title="Account Overview">
            <div className="space-y-3 text-sm text-slate-700">
              <div><span className="font-semibold">Business:</span> {employer?.business_name || '—'}</div>
              <div><span className="font-semibold">Contact:</span> {employer?.contact_name || '—'}</div>
              <div><span className="font-semibold">Email / Username:</span> {employerSession?.employer_user?.email || '—'}</div>
              <div><span className="font-semibold">Subscription Status:</span> {employer?.subscription_status || '—'}</div>
              <div><span className="font-semibold">Access Status:</span> {employer?.access_status || '—'}</div>
              <div>
                <span className="font-semibold">Current Period End:</span>{' '}
                {employer?.current_period_end
                  ? new Date(employer.current_period_end).toLocaleDateString()
                  : '—'}
              </div>
            </div>
          </Card>

          <Card title={editingJobId ? 'Edit Job' : 'Post a Job'}>
            <form onSubmit={handleSubmitJob} className="space-y-4">
              <Field label="Job Title" required>
                <Input
                  name="job_title"
                  value={jobForm.job_title}
                  onChange={handleJobFormChange}
                  placeholder="Production Line Supervisor"
                  required
                />
              </Field>

              <Field label="Job Description" required>
                <Textarea
                  name="job_description"
                  rows={5}
                  value={jobForm.job_description}
                  onChange={handleJobFormChange}
                  placeholder="Describe the role, duties, and expectations..."
                  required
                />
              </Field>

              <div className="grid gap-4 md:grid-cols-2">
                <Field label="City">
                  <Input
                    name="city"
                    value={jobForm.city}
                    onChange={handleJobFormChange}
                    placeholder="Tarboro, NC"
                  />
                </Field>

                <Field label="Experience Level">
                  <Input
                    name="experience_level"
                    value={jobForm.experience_level}
                    onChange={handleJobFormChange}
                    placeholder="Entry Level, Mid Level, Senior..."
                  />
                </Field>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Employment Type">
                  <Select
                    name="employment_type"
                    value={jobForm.employment_type}
                    onChange={handleJobFormChange}
                  >
                    {employerJobTypes.map((value) => (
                      <option key={value} value={value}>
                        {humanizeJobType(value)}
                      </option>
                    ))}
                  </Select>
                </Field>

                <Field label="Pay Type">
                  <Select
                    name="pay_type"
                    value={jobForm.pay_type}
                    onChange={handleJobFormChange}
                  >
                    {employerPayTypes.map((value) => (
                      <option key={value} value={value}>
                        {humanizePayType(value)}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Pay Minimum">
                  <Input
                    name="pay_min"
                    type="number"
                    step="0.01"
                    value={jobForm.pay_min}
                    onChange={handleJobFormChange}
                    placeholder="15.00"
                  />
                </Field>

                <Field label="Pay Maximum">
                  <Input
                    name="pay_max"
                    type="number"
                    step="0.01"
                    value={jobForm.pay_max}
                    onChange={handleJobFormChange}
                    placeholder="20.00"
                  />
                </Field>
              </div>

              <Field label="Status">
                <Select
                  name="status"
                  value={jobForm.status}
                  onChange={handleJobFormChange}
                >
                  {['open', 'draft', 'closed', 'filled'].map((value) => (
                    <option key={value} value={value}>
                      {humanizeStatus(value)}
                    </option>
                  ))}
                </Select>
              </Field>

              {jobMessage && (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                  {jobMessage}
                </div>
              )}

              {jobError && (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                  {jobError}
                </div>
              )}

              <div className="flex flex-wrap gap-3">
                <button
                  type="submit"
                  disabled={jobLoading}
                  className="inline-flex items-center gap-2 rounded-2xl bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <PlusCircle className="h-4 w-4" />
                  {jobLoading
                    ? editingJobId
                      ? 'Saving...'
                      : 'Posting...'
                    : editingJobId
                      ? 'Save Changes'
                      : 'Post Job'}
                </button>

                {editingJobId && (
                  <button
                    type="button"
                    onClick={cancelEdit}
                    className="inline-flex items-center gap-2 rounded-2xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 hover:border-slate-400"
                  >
                    <XCircle className="h-4 w-4" />
                    Cancel Edit
                  </button>
                )}
              </div>
            </form>
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="My Jobs">
            {jobsLoading ? (
              <p className="text-sm text-slate-500">Loading your jobs...</p>
            ) : employerJobs.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
                <p className="text-sm text-slate-600">No jobs created yet.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {employerJobs.map((job) => (
                  <div key={job.id} className="rounded-3xl border border-slate-200 p-5">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div>
                        <h3 className="text-lg font-semibold text-slate-900">{job.job_title}</h3>
                        <div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-500">
                          <span>{job.city || 'Tarboro, NC'}</span>
                          <span>•</span>
                          <span>{humanizeJobType(job.employment_type)}</span>
                          <span>•</span>
                          <span>{humanizeStatus(job.status)}</span>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={() => beginEditJob(job)}
                          className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700"
                        >
                          <PencilLine className="h-3.5 w-3.5" />
                          Edit
                        </button>

                        <button
                          onClick={() => handleDeleteJob(job)}
                          disabled={deletingJobId === job.id}
                          className="inline-flex items-center gap-1 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          {deletingJobId === job.id ? 'Deleting...' : 'Delete'}
                        </button>

                        {job.status !== 'open' && (
                          <button
                            onClick={() => onUpdateJobStatus(job.id, 'open')}
                            className="inline-flex items-center gap-1 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700"
                          >
                            <CheckCircle className="h-3.5 w-3.5" />
                            Open
                          </button>
                        )}

                        {job.status !== 'filled' && (
                          <button
                            onClick={() => onUpdateJobStatus(job.id, 'filled')}
                            className="inline-flex items-center gap-1 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-medium text-blue-700"
                          >
                            <CheckCircle className="h-3.5 w-3.5" />
                            Filled
                          </button>
                        )}

                        {job.status !== 'closed' && (
                          <button
                            onClick={() => onUpdateJobStatus(job.id, 'closed')}
                            className="inline-flex items-center gap-1 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700"
                          >
                            <XCircle className="h-3.5 w-3.5" />
                            Close
                          </button>
                        )}

                        {job.status !== 'draft' && (
                          <button
                            onClick={() => onUpdateJobStatus(job.id, 'draft')}
                            className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700"
                          >
                            <PencilLine className="h-3.5 w-3.5" />
                            Draft
                          </button>
                        )}
                      </div>
                    </div>

                    <p className="mt-3 text-sm leading-6 text-slate-600">{job.job_description}</p>

                    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-slate-500">
                      {job.pay_display && <span>{job.pay_display}</span>}
                      {job.experience_level && <span>{job.experience_level}</span>}
                      {job.created_at && <span>Created {new Date(job.created_at).toLocaleDateString()}</span>}
                      {job.updated_at && <span>Updated {new Date(job.updated_at).toLocaleDateString()}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card title={showingSavedOnly ? 'Saved Candidates' : 'Candidate Resumes'}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => onCandidateViewChange('all')}
                  className={`inline-flex items-center gap-2 rounded-2xl border px-4 py-2.5 text-sm font-medium transition ${
                    candidateView === 'all'
                      ? 'border-emerald-700 bg-emerald-700 text-white'
                      : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400'
                  }`}
                >
                  <Users className="h-4 w-4" />
                  All Candidates
                </button>

                <button
                  type="button"
                  onClick={() => onCandidateViewChange('saved')}
                  className={`inline-flex items-center gap-2 rounded-2xl border px-4 py-2.5 text-sm font-medium transition ${
                    candidateView === 'saved'
                      ? 'border-emerald-700 bg-emerald-700 text-white'
                      : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400'
                  }`}
                >
                  <Bookmark className="h-4 w-4" />
                  Saved Candidates
                </button>
              </div>

              <div className="text-sm text-slate-500">
                Showing <span className="font-semibold text-slate-800">{filteredCount}</span> of{' '}
                <span className="font-semibold text-slate-800">{overallTotalResumes}</span>{' '}
                total candidates
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
              {showingSavedOnly
                ? 'Showing only candidates you have marked as Saved.'
                : 'Submitted resumes may be viewed by active employers on TarboroJobs.com.'}
            </div>

            <div className={`grid gap-4 ${showingSavedOnly ? 'md:grid-cols-[1fr_220px_220px]' : 'md:grid-cols-[1fr_220px_220px_220px]'}`}>
              <div className="flex items-center gap-3 rounded-2xl border border-slate-200 px-4 py-2.5">
                <Search className="h-4 w-4 text-slate-400" />
                <input
                  className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
                  placeholder="Search name, title, skills..."
                  value={resumeFilters.search}
                  onChange={(e) => onResumeFilterChange('search', e.target.value)}
                />
              </div>

              <Input
                placeholder="Filter by city"
                value={resumeFilters.city}
                onChange={(e) => onResumeFilterChange('city', e.target.value)}
              />

              <Select
                value={resumeFilters.employment_type}
                onChange={(e) => onResumeFilterChange('employment_type', e.target.value)}
              >
                <option value="">All Employment Types</option>
                {employerResumeTypes
                  .filter((value) => value !== '')
                  .map((value) => (
                    <option key={value} value={value}>
                      {humanizeJobType(value)}
                    </option>
                  ))}
              </Select>

              {!showingSavedOnly && (
                <Select
                  value={resumeFilters.candidate_status}
                  onChange={(e) => onResumeFilterChange('candidate_status', e.target.value)}
                >
                  <option value="">All Candidate Statuses</option>
                  {candidateStatuses
                    .filter((value) => value !== '')
                    .map((value) => (
                      <option key={value} value={value}>
                        {humanizeStatus(value)}
                      </option>
                    ))}
                </Select>
              )}
            </div>

            <div className="grid gap-6 xl:grid-cols-[360px_1fr]">
              <div className="space-y-3">
                {resumesLoading ? (
                  <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
                    <p className="text-sm text-slate-600">Loading resumes...</p>
                  </div>
                ) : employerResumes.length === 0 ? (
                  <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
                    <p className="text-sm text-slate-600">
                      {showingSavedOnly ? 'No saved candidates found.' : 'No resumes found.'}
                    </p>
                  </div>
                ) : (
                  employerResumes.map((resume) => {
                    const active = selectedResume?.id === resume.id
                    const candidateAction = resume.candidate_action || null

                    return (
                      <button
                        key={resume.id}
                        type="button"
                        onClick={() => onSelectResume(resume)}
                        className={`w-full rounded-3xl border p-4 text-left transition ${
                          active
                            ? 'border-emerald-300 bg-emerald-50'
                            : 'border-slate-200 bg-white hover:border-slate-300'
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <div className="mt-0.5 rounded-2xl bg-slate-100 p-2 text-slate-600">
                            <UserRound className="h-4 w-4" />
                          </div>

                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-semibold text-slate-900">
                              {resume.full_name}
                            </div>
                            <div className="mt-1 truncate text-xs text-slate-500">
                              {resume.desired_job_title || 'No desired title'}
                            </div>
                            <div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-500">
                              {resume.city && <span>{resume.city}</span>}
                              {resume.employment_type && (
                                <span>{humanizeJobType(resume.employment_type)}</span>
                              )}
                            </div>

                            {candidateAction?.status && (
                              <div className="mt-2 inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700">
                                {humanizeStatus(candidateAction.status)}
                              </div>
                            )}

                            {candidateAction?.notes && (
                              <div className="mt-2 line-clamp-2 text-xs text-slate-500">
                                {candidateAction.notes}
                              </div>
                            )}

                            <div className="mt-2 text-xs text-slate-400">
                              {resume.created_at
                                ? new Date(resume.created_at).toLocaleDateString()
                                : 'Recently submitted'}
                            </div>
                          </div>
                        </div>
                      </button>
                    )
                  })
                )}

                <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <button
                    type="button"
                    onClick={() => onResumePageChange(resumePagination.page - 1)}
                    disabled={!resumePagination.has_prev || resumesLoading}
                    className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                    Prev
                  </button>

                  <div className="text-xs text-slate-600">
                    Page {resumePagination.page} of {resumePagination.total_pages}
                  </div>

                  <button
                    type="button"
                    onClick={() => onResumePageChange(resumePagination.page + 1)}
                    disabled={!resumePagination.has_next || resumesLoading}
                    className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Next
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </div>

                <div className="text-xs text-slate-500">
                  {resumePagination.total} total {showingSavedOnly ? 'saved candidates' : 'resumes'}
                </div>
              </div>

              <div className="space-y-6">
                {!selectedResume ? (
                  <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-10 text-center">
                    <p className="text-sm text-slate-600">
                      {showingSavedOnly ? 'Select a saved candidate to view details.' : 'Select a resume to view details.'}
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="rounded-3xl border border-slate-200 p-5">
                      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div>
                          <div className="flex items-center gap-2">
                            <UserRound className="h-4 w-4 text-slate-500" />
                            <h3 className="text-xl font-semibold text-slate-900">{selectedResume.full_name}</h3>
                          </div>

                          <div className="mt-2 flex flex-wrap gap-2 text-sm text-slate-500">
                            {selectedResume.city && <span>{selectedResume.city}</span>}
                            {selectedResume.city && selectedResume.desired_job_title && <span>•</span>}
                            {selectedResume.desired_job_title && <span>{selectedResume.desired_job_title}</span>}
                            {(selectedResume.city || selectedResume.desired_job_title) && selectedResume.employment_type && <span>•</span>}
                            {selectedResume.employment_type && (
                              <span>{humanizeJobType(selectedResume.employment_type)}</span>
                            )}
                          </div>

                          {selectedCandidateAction?.status && (
                            <div className="mt-3 inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
                              {humanizeStatus(selectedCandidateAction.status)}
                            </div>
                          )}
                        </div>

                        {selectedResume.resume_file_url && (
                          <a
                            href={resumeFileHref(fileBase, selectedResume.resume_file_url)}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-100"
                          >
                            <Download className="h-4 w-4" />
                            View PDF
                          </a>
                        )}
                      </div>

                      <div className="mt-5 grid gap-3 md:grid-cols-2">
                        {selectedResume.email && (
                          <div className="flex items-center gap-2 text-sm text-slate-600">
                            <Mail className="h-4 w-4" />
                            {selectedResume.email}
                          </div>
                        )}

                        {selectedResume.phone && (
                          <div className="flex items-center gap-2 text-sm text-slate-600">
                            <Phone className="h-4 w-4" />
                            {selectedResume.phone}
                          </div>
                        )}
                      </div>

                      {selectedResume.skills && (
                        <div className="mt-5">
                          <div className="mb-1 text-sm font-semibold text-slate-800">Skills</div>
                          <p className="text-sm leading-6 text-slate-600">{selectedResume.skills}</p>
                        </div>
                      )}

                      {selectedResume.resume_text && (
                        <div className="mt-5">
                          <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-slate-800">
                            <FileBadge className="h-4 w-4" />
                            Resume Summary
                          </div>
                          <p className="text-sm leading-6 text-slate-600">{selectedResume.resume_text}</p>
                        </div>
                      )}

                      {selectedCandidateAction && (
                        <div className="mt-5 grid gap-3 md:grid-cols-2">
                          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Contacted</div>
                            <div className="mt-1 text-sm text-slate-700">{formatDateTime(selectedCandidateAction.contacted_at)}</div>
                          </div>

                          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Interview</div>
                            <div className="mt-1 text-sm text-slate-700">{formatDateTime(selectedCandidateAction.interview_at)}</div>
                          </div>

                          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Hired</div>
                            <div className="mt-1 text-sm text-slate-700">{formatDateTime(selectedCandidateAction.hired_at)}</div>
                          </div>

                          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Rejected</div>
                            <div className="mt-1 text-sm text-slate-700">{formatDateTime(selectedCandidateAction.rejected_at)}</div>
                          </div>

                          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 md:col-span-2">
                            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Next Follow-Up</div>
                            <div className="mt-1 text-sm text-slate-700">{formatDateTime(selectedCandidateAction.next_follow_up_at)}</div>
                          </div>
                        </div>
                      )}

                      <div className="mt-5 text-xs text-slate-500">
                        Submitted {selectedResume.created_at ? new Date(selectedResume.created_at).toLocaleDateString() : 'recently'}
                      </div>
                    </div>

                    <CandidateActionPanel
                      selectedResume={selectedResume}
                      candidateAction={selectedCandidateAction}
                      actionLoading={actionLoading}
                      actionMessage={actionMessage}
                      actionError={actionError}
                      onSaveAction={onSaveCandidateAction}
                      Card={Card}
                      Field={Field}
                      Input={Input}
                      Select={Select}
                      Textarea={Textarea}
                      candidateStatuses={candidateStatuses}
                    />
                  </>
                )}
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}