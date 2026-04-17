import { useEffect, useMemo, useState } from 'react'
import {
  ArrowRight,
  BellRing,
  Bookmark,
  Briefcase,
  Building2,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Download,
  Eye,
  FileBadge,
  Mail,
  MapPin,
  PencilLine,
  Phone,
  PlusCircle,
  Search,
  ShieldCheck,
  Trash2,
  UserRound,
  Users,
  XCircle,
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
    compliance_certified: false,
  }
}

function formatDateTime(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString()
}

function formatShortDate(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString()
}

function formatExpirationLabel(job) {
  if (!job?.expires_at) return 'No expiration set'
  const expiresAt = new Date(job.expires_at)
  if (Number.isNaN(expiresAt.getTime())) return 'No expiration set'

  return `Expires ${expiresAt.toLocaleDateString()}`
}

function formatAtsRecommendation(value) {
  const normalized = String(value || '').toLowerCase()
  if (normalized === 'strong_match') return 'Strong Match'
  if (normalized === 'possible_match') return 'Possible Match'
  if (normalized === 'low_match') return 'Low Match'
  if (normalized === 'needs_review') return 'Needs Review'
  return 'ATS Pending'
}

function atsBadgeClass(value) {
  const normalized = String(value || '').toLowerCase()
  if (normalized === 'strong_match') return 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300'
  if (normalized === 'possible_match') return 'border-cyan-400/20 bg-cyan-400/10 text-cyan-300'
  if (normalized === 'low_match') return 'border-amber-400/20 bg-amber-400/10 text-amber-300'
  return 'border-slate-700 bg-slate-900/70 text-slate-300'
}

function panelClassName(extra = '') {
  return `overflow-hidden rounded-[28px] border border-slate-800 bg-slate-900/85 shadow-[0_18px_60px_rgba(2,6,23,0.32)] ${extra}`
}

function inputClassName(extra = '') {
  return `w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-cyan-400 ${extra}`
}

function Field({ label, required = false, children }) {
  return (
    <label className="block space-y-2">
      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
        {label} {required ? <span className="text-rose-400">*</span> : null}
      </div>
      {children}
    </label>
  )
}

function PanelHeader({ icon: Icon, title, subtitle, action }) {
  return (
    <div className="flex flex-col gap-3 border-b border-slate-800 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex items-start gap-3">
        {Icon ? (
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-cyan-400/10 text-cyan-300">
            <Icon className="h-5 w-5" />
          </div>
        ) : null}
        <div>
          <h2 className="text-base font-semibold text-white sm:text-lg">{title}</h2>
          {subtitle ? <p className="mt-1 text-sm text-slate-400">{subtitle}</p> : null}
        </div>
      </div>
      {action ? <div className="w-full sm:w-auto">{action}</div> : null}
    </div>
  )
}

function StatCard({ icon: Icon, label, value, tone = 'cyan' }) {
  const toneMap = {
    cyan: 'bg-cyan-400/10 text-cyan-300 border-cyan-400/20',
    emerald: 'bg-emerald-400/10 text-emerald-300 border-emerald-400/20',
    amber: 'bg-amber-400/10 text-amber-300 border-amber-400/20',
    rose: 'bg-rose-400/10 text-rose-300 border-rose-400/20',
    slate: 'bg-slate-700/60 text-slate-200 border-slate-700',
  }

  return (
    <div className="rounded-[26px] border border-slate-800 bg-slate-900/70 p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{label}</div>
          <div className="mt-2 text-3xl font-semibold tracking-tight text-white">{value}</div>
        </div>
        <div className={`flex h-11 w-11 items-center justify-center rounded-2xl border ${toneMap[tone] || toneMap.slate}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  )
}

function TabButton({ icon: Icon, label, active, onClick, compact = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center justify-center gap-2 rounded-2xl border px-3 py-2.5 text-sm font-medium transition ${
        active
          ? 'border-cyan-400/30 bg-cyan-400 text-slate-950'
          : 'border-slate-700 bg-slate-900/80 text-slate-300 hover:border-slate-600 hover:text-white'
      } ${compact ? 'w-full' : ''}`}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span>{label}</span>
    </button>
  )
}

function QuickActionButton({ icon: Icon, label, sublabel, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-950/60 px-4 py-4 text-left transition hover:border-slate-700 hover:bg-slate-950"
    >
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/5 text-cyan-300">
          <Icon className="h-4 w-4" />
        </div>
        <div>
          <div className="text-sm font-semibold text-white">{label}</div>
          <div className="text-xs text-slate-400">{sublabel}</div>
        </div>
      </div>
      <ArrowRight className="h-4 w-4 text-slate-500" />
    </button>
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
  onUpdateEmployerAccount,
  onUpdateEmployerPassword,
  employerStats,
  statsLoading,
  employerIndustries,
  employerJobTypes,
  employerPayTypes,
  employerResumeTypes,
  candidateStatuses,
  fileBase,
  CandidateActionPanel,
}) {
  const employer = employerSession?.employer
  const selectedCandidateAction = selectedResume ? candidateActions[selectedResume.id] || null : null
  const [activeSection, setActiveSection] = useState('overview')

  const [accountForm, setAccountForm] = useState({
    business_name: employer?.business_name || '',
    industry: employer?.industry || '',
    contact_name: employer?.contact_name || '',
    email: employerSession?.employer_user?.email || '',
    phone: employer?.phone || '',
    website: employer?.website || '',
    address: employer?.address || '',
    city: employer?.city || 'Tarboro, NC',
    notes: employer?.notes || '',
    is_hiring: employer?.status === 'active',
  })
  const [accountLoading, setAccountLoading] = useState(false)
  const [accountError, setAccountError] = useState('')
  const [accountMessage, setAccountMessage] = useState('')
  const [passwordForm, setPasswordForm] = useState({
    current_password: '',
    new_password: '',
    confirm_password: '',
  })
  const [passwordLoading, setPasswordLoading] = useState(false)
  const [passwordError, setPasswordError] = useState('')
  const [passwordMessage, setPasswordMessage] = useState('')
  const [jobForm, setJobForm] = useState(getEmptyJobForm(employer?.city || 'Tarboro, NC'))
  const [jobLoading, setJobLoading] = useState(false)
  const [jobError, setJobError] = useState('')
  const [jobMessage, setJobMessage] = useState('')
  const [deletingJobId, setDeletingJobId] = useState(null)

  useEffect(() => {
    setAccountForm({
      business_name: employer?.business_name || '',
      industry: employer?.industry || '',
      contact_name: employer?.contact_name || '',
      email: employerSession?.employer_user?.email || '',
      phone: employer?.phone || '',
      website: employer?.website || '',
      address: employer?.address || '',
      city: employer?.city || 'Tarboro, NC',
      notes: employer?.notes || '',
      is_hiring: employer?.status === 'active',
    })
  }, [employer, employerSession])

  useEffect(() => {
    if (!editingJobId) {
      setJobForm(getEmptyJobForm(employer?.city || 'Tarboro, NC'))
    }
  }, [editingJobId, employer?.city])

  useEffect(() => {
    if (editingJobId) setActiveSection('jobs')
  }, [editingJobId])

  useEffect(() => {
    if (selectedResume?.id) setActiveSection('candidates')
  }, [selectedResume?.id])

  function handleAccountFormChange(e) {
    const { name, value } = e.target
    setAccountForm((prev) => ({
      ...prev,
      [name]: name === 'is_hiring' ? value === 'true' : value,
    }))
  }

  function handlePasswordFormChange(e) {
    const { name, value } = e.target
    setPasswordForm((prev) => ({ ...prev, [name]: value }))
  }

  function handleJobFormChange(e) {
    const { name, value, type, checked } = e.target
    setJobForm((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }))
  }

  async function handleSubmitAccount(e) {
    e.preventDefault()
    setAccountLoading(true)
    setAccountError('')
    setAccountMessage('')

    try {
      await onUpdateEmployerAccount({
        business_name: accountForm.business_name,
        industry: accountForm.industry,
        contact_name: accountForm.contact_name,
        email: accountForm.email,
        phone: accountForm.phone,
        website: accountForm.website,
        address: accountForm.address,
        city: accountForm.city,
        notes: accountForm.notes,
        is_hiring: !!accountForm.is_hiring,
      })
      setAccountMessage('Employer account updated successfully.')
    } catch (err) {
      setAccountError(err.message || 'Failed to update employer account.')
    } finally {
      setAccountLoading(false)
    }
  }

  async function handleSubmitPassword(e) {
    e.preventDefault()
    setPasswordLoading(true)
    setPasswordError('')
    setPasswordMessage('')

    try {
      if (!passwordForm.current_password || !passwordForm.new_password || !passwordForm.confirm_password) {
        throw new Error('Please fill out all password fields.')
      }

      if (passwordForm.new_password !== passwordForm.confirm_password) {
        throw new Error('New password and confirm password do not match.')
      }

      await onUpdateEmployerPassword({
        current_password: passwordForm.current_password,
        new_password: passwordForm.new_password,
        confirm_password: passwordForm.confirm_password,
      })

      setPasswordForm({
        current_password: '',
        new_password: '',
        confirm_password: '',
      })
      setPasswordMessage('Password updated successfully.')
    } catch (err) {
      setPasswordError(err.message || 'Failed to update password.')
    } finally {
      setPasswordLoading(false)
    }
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
      compliance_certified: !!job.posting_guidelines_accepted,
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
        setJobMessage('Job updated successfully. Open listings auto-expire after 14 days.')
      } else {
        await onCreateJob(payload)
        setJobMessage('Job posted successfully. It will auto-expire after 14 days.')
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
    const confirmed = window.confirm(`Delete "${job.job_title}"?\n\nThis cannot be undone.`)
    if (!confirmed) return

    setDeletingJobId(job.id)
    setJobError('')
    setJobMessage('')

    try {
      await onDeleteJob(job.id)
      if (editingJobId === job.id) cancelEdit()
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

  const quickStats = [
    { icon: Briefcase, label: 'Open Jobs', value: statsLoading ? '...' : employerStats?.open_jobs ?? 0, tone: 'cyan' },
    { icon: ClipboardList, label: 'Total Resumes', value: statsLoading ? '...' : employerStats?.total_resumes ?? 0, tone: 'slate' },
    { icon: Bookmark, label: 'Saved Candidates', value: statsLoading ? '...' : employerStats?.saved_candidates ?? 0, tone: 'amber' },
    { icon: CalendarDays, label: 'Interviews', value: statsLoading ? '...' : employerStats?.interviews_scheduled ?? 0, tone: 'emerald' },
    { icon: BellRing, label: 'Follow-Ups Due', value: statsLoading ? '...' : employerStats?.follow_ups_due ?? 0, tone: 'rose' },
  ]

  const tabItems = [
    { key: 'overview', label: 'Overview', icon: Building2 },
    { key: 'jobs', label: 'Jobs', icon: Briefcase },
    { key: 'candidates', label: 'Candidates', icon: Users },
    { key: 'account', label: 'Account', icon: ShieldCheck },
  ]

  const recentJobs = useMemo(() => employerJobs.slice(0, 3), [employerJobs])
  const recentCandidates = useMemo(() => employerResumes.slice(0, 3), [employerResumes])

  return (
    <div className="mx-auto max-w-7xl">
      <section className="relative overflow-hidden rounded-[34px] border border-slate-800 bg-slate-950 text-slate-100 shadow-[0_24px_80px_rgba(2,6,23,0.34)]">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.18),transparent_36%),radial-gradient(circle_at_top_right,rgba(56,189,248,0.10),transparent_32%)]" />
        <div className="relative border-b border-slate-800/90 px-5 py-6 sm:px-6 sm:py-7 lg:px-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-300">
                Employer dashboard · Midnight Civic
              </div>
              <h1 className="mt-4 text-3xl font-semibold tracking-tight text-white sm:text-4xl">{employer?.business_name || 'Employer Dashboard'}</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300 sm:text-base">
                A cleaner mobile-first workspace for jobs, candidates, and account settings. The wall of forms is gone — everything now lives in clearer sections.
              </p>
              <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-300">
                {employer?.industry ? <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">{employer.industry}</span> : null}
                {employer?.city ? <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">{employer.city}</span> : null}
                <span className={`rounded-full border px-3 py-1 ${employer?.status === 'active' ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300' : 'border-slate-700 bg-slate-900 text-slate-300'}`}>
                  {employer?.status === 'active' ? 'Hiring' : 'Not hiring'}
                </span>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:w-[420px]">
              <button
                type="button"
                onClick={() => setActiveSection('jobs')}
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-cyan-400 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300"
              >
                <PlusCircle className="h-4 w-4" />
                {editingJobId ? 'Finish Editing Job' : 'Post a Job'}
              </button>
              <button
                type="button"
                onClick={() => setActiveSection('candidates')}
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-700 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:border-slate-600 hover:bg-white/10"
              >
                <Users className="h-4 w-4" />
                Review Candidates
              </button>
            </div>
          </div>
        </div>

        <div className="relative overflow-x-auto px-4 py-4 sm:px-6 lg:px-8">
          <div className="grid min-w-max grid-cols-4 gap-3 lg:min-w-0 lg:grid-cols-4 xl:grid-cols-4">
            {tabItems.map((tab) => (
              <TabButton
                key={tab.key}
                icon={tab.icon}
                label={tab.label}
                active={activeSection === tab.key}
                onClick={() => setActiveSection(tab.key)}
                compact
              />
            ))}
          </div>
        </div>
      </section>

      <div className="mt-6 space-y-6">
        {activeSection === 'overview' && (
          <>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
              {quickStats.map((item) => (
                <StatCard key={item.label} icon={item.icon} label={item.label} value={item.value} tone={item.tone} />
              ))}
            </div>

            <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
              <section className={panelClassName()}>
                <PanelHeader
                  icon={Building2}
                  title="Quick Actions"
                  subtitle="Jump where you need to go without digging through one long page."
                />
                <div className="grid gap-3 p-5 sm:grid-cols-2">
                  <QuickActionButton icon={PlusCircle} label="Post a Job" sublabel="Create or edit listings" onClick={() => setActiveSection('jobs')} />
                  <QuickActionButton icon={Users} label="Open Candidates" sublabel="Review resumes and statuses" onClick={() => setActiveSection('candidates')} />
                  <QuickActionButton icon={ShieldCheck} label="Update Account" sublabel="Business profile and password" onClick={() => setActiveSection('account')} />
                  <QuickActionButton icon={Bookmark} label="Saved Candidates" sublabel="View only saved applicants" onClick={() => { onCandidateViewChange('saved'); setActiveSection('candidates') }} />
                </div>
              </section>

              <section className={panelClassName()}>
                <PanelHeader
                  icon={ShieldCheck}
                  title="Business Snapshot"
                  subtitle="A quick view of your employer account and access status."
                />
                <div className="space-y-4 p-5 text-sm text-slate-300">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-2xl border border-slate-800 bg-slate-950/60 px-4 py-3">
                      <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Contact</div>
                      <div className="mt-1 font-medium text-white">{employer?.contact_name || '—'}</div>
                    </div>
                    <div className="rounded-2xl border border-slate-800 bg-slate-950/60 px-4 py-3">
                      <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Access Status</div>
                      <div className="mt-1 font-medium text-white">{employer?.access_status || '—'}</div>
                    </div>
                    <div className="rounded-2xl border border-slate-800 bg-slate-950/60 px-4 py-3">
                      <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Subscription</div>
                      <div className="mt-1 font-medium text-white">{employer?.subscription_status || '—'}</div>
                    </div>
                    <div className="rounded-2xl border border-slate-800 bg-slate-950/60 px-4 py-3">
                      <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Period End</div>
                      <div className="mt-1 font-medium text-white">{employer?.current_period_end ? formatShortDate(employer.current_period_end) : '—'}</div>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-800 bg-slate-950/60 px-4 py-4">
                    <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Business Description</div>
                    <p className="mt-2 leading-6 text-slate-300">{employer?.notes || 'No business description added yet.'}</p>
                  </div>
                </div>
              </section>
            </div>

            <div className="grid gap-6 xl:grid-cols-2">
              <section className={panelClassName()}>
                <PanelHeader
                  icon={Briefcase}
                  title="Recent Jobs"
                  subtitle="Quick glance at the newest listings tied to your account."
                  action={<button type="button" onClick={() => setActiveSection('jobs')} className="rounded-2xl border border-slate-700 bg-white/5 px-4 py-2.5 text-sm font-medium text-slate-200 transition hover:border-slate-600">Manage Jobs</button>}
                />
                <div className="space-y-3 p-5">
                  {jobsLoading ? (
                    <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-950/60 p-5 text-sm text-slate-400">Loading your jobs...</div>
                  ) : recentJobs.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-950/60 p-5 text-sm text-slate-400">No jobs created yet.</div>
                  ) : (
                    recentJobs.map((job) => (
                      <div key={job.id} className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <div className="text-base font-semibold text-white">{job.job_title}</div>
                            <div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-400">
                              <span>{job.city || 'Tarboro, NC'}</span>
                              <span>•</span>
                              <span>{humanizeJobType(job.employment_type)}</span>
                              <span>•</span>
                              <span>{humanizeStatus(job.status)}</span>
                            </div>
                          </div>
                          <button type="button" onClick={() => beginEditJob(job)} className="inline-flex items-center gap-2 rounded-2xl border border-slate-700 bg-white/5 px-3.5 py-2 text-xs font-medium text-slate-200 transition hover:border-slate-600">
                            <PencilLine className="h-3.5 w-3.5" />
                            Edit
                          </button>
                        </div>
                        <div className="mt-3 text-sm leading-6 text-slate-300 line-clamp-3">{job.job_description}</div>
                      </div>
                    ))
                  )}
                </div>
              </section>

              <section className={panelClassName()}>
                <PanelHeader
                  icon={Users}
                  title="Recent Candidates"
                  subtitle="Latest resumes so you can jump straight into review."
                  action={<button type="button" onClick={() => setActiveSection('candidates')} className="rounded-2xl border border-slate-700 bg-white/5 px-4 py-2.5 text-sm font-medium text-slate-200 transition hover:border-slate-600">Open Candidates</button>}
                />
                <div className="space-y-3 p-5">
                  {resumesLoading ? (
                    <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-950/60 p-5 text-sm text-slate-400">Loading resumes...</div>
                  ) : recentCandidates.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-950/60 p-5 text-sm text-slate-400">No resumes found yet.</div>
                  ) : (
                    recentCandidates.map((resume) => {
                      const candidateAction = resume.candidate_action || null
                      return (
                        <button
                          key={resume.id}
                          type="button"
                          onClick={() => onSelectResume(resume)}
                          className="flex w-full items-start gap-3 rounded-2xl border border-slate-800 bg-slate-950/60 p-4 text-left transition hover:border-slate-700"
                        >
                          <div className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-2xl bg-white/5 text-cyan-300">
                            <UserRound className="h-4 w-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-semibold text-white">{resume.full_name}</div>
                            <div className="mt-1 truncate text-xs text-slate-400">{resume.desired_job_title || 'No desired title'}</div>
                            {resume.job_title ? <div className="mt-1 truncate text-[11px] text-slate-500">Applied to: {resume.job_title}</div> : null}
                            <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-500">
                              {resume.city ? <span>{resume.city}</span> : null}
                              {resume.employment_type ? <span>{humanizeJobType(resume.employment_type)}</span> : null}
                              {resume.ats_score !== null && resume.ats_score !== undefined ? <span>ATS {Math.round(resume.ats_score)}%</span> : null}
                            </div>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {resume.ats_recommendation ? <div className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-medium ${atsBadgeClass(resume.ats_recommendation)}`}>{formatAtsRecommendation(resume.ats_recommendation)}</div> : null}
                              {candidateAction?.status ? <div className="inline-flex rounded-full border border-cyan-400/20 bg-cyan-400/10 px-2.5 py-1 text-[11px] font-medium text-cyan-300">{humanizeStatus(candidateAction.status)}</div> : null}
                            </div>
                          </div>
                        </button>
                      )
                    })
                  )}
                </div>
              </section>
            </div>
          </>
        )}

        {activeSection === 'jobs' && (
          <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
            <section className={panelClassName()}>
              <PanelHeader
                icon={PlusCircle}
                title={editingJobId ? 'Edit Job' : 'Post a Job'}
                subtitle="Use the cleaner form to manage one listing, certify compliance, and let open posts auto-expire after 14 days."
              />
              <form onSubmit={handleSubmitJob} className="space-y-4 p-5">
                <Field label="Job Title" required>
                  <input
                    name="job_title"
                    value={jobForm.job_title}
                    onChange={handleJobFormChange}
                    placeholder="Production Line Supervisor"
                    required
                    className={inputClassName()}
                  />
                </Field>

                <Field label="Job Description" required>
                  <textarea
                    name="job_description"
                    rows={6}
                    value={jobForm.job_description}
                    onChange={handleJobFormChange}
                    placeholder="Describe the role, duties, and expectations..."
                    required
                    className={inputClassName('min-h-[160px] resize-y')}
                  />
                </Field>

                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="City">
                    <input
                      name="city"
                      value={jobForm.city}
                      onChange={handleJobFormChange}
                      placeholder="Tarboro, NC"
                      className={inputClassName()}
                    />
                  </Field>

                  <Field label="Experience Level">
                    <input
                      name="experience_level"
                      value={jobForm.experience_level}
                      onChange={handleJobFormChange}
                      placeholder="Entry Level, Mid Level, Senior..."
                      className={inputClassName()}
                    />
                  </Field>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="Employment Type">
                    <select name="employment_type" value={jobForm.employment_type} onChange={handleJobFormChange} className={inputClassName()}>
                      {employerJobTypes.map((value) => (
                        <option key={value} value={value}>{humanizeJobType(value)}</option>
                      ))}
                    </select>
                  </Field>

                  <Field label="Pay Type">
                    <select name="pay_type" value={jobForm.pay_type} onChange={handleJobFormChange} className={inputClassName()}>
                      {employerPayTypes.map((value) => (
                        <option key={value} value={value}>{humanizePayType(value)}</option>
                      ))}
                    </select>
                  </Field>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="Pay Minimum">
                    <input
                      name="pay_min"
                      type="number"
                      step="0.01"
                      value={jobForm.pay_min}
                      onChange={handleJobFormChange}
                      placeholder="15.00"
                      className={inputClassName()}
                    />
                  </Field>

                  <Field label="Pay Maximum">
                    <input
                      name="pay_max"
                      type="number"
                      step="0.01"
                      value={jobForm.pay_max}
                      onChange={handleJobFormChange}
                      placeholder="20.00"
                      className={inputClassName()}
                    />
                  </Field>
                </div>

                <Field label="Status">
                  <select name="status" value={jobForm.status} onChange={handleJobFormChange} className={inputClassName()}>
                    {['open', 'draft', 'closed', 'filled'].map((value) => (
                      <option key={value} value={value}>{humanizeStatus(value)}</option>
                    ))}
                  </select>
                </Field>

                <div className="rounded-[26px] border border-amber-400/20 bg-amber-400/10 p-4 text-sm text-amber-100">
                  <div className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-200">Posting rules built into TarboroJobs</div>
                  <ul className="mt-3 space-y-2 text-sm leading-6 text-amber-50/90">
                    <li>• Open jobs auto-expire 14 days after they go live.</li>
                    <li>• Do not post discriminatory language about age, sex, religion, disability, pregnancy, citizenship status, or national origin.</li>
                    <li>• Do not ask applicants for money, bank details, Social Security numbers, Telegram/WhatsApp contact, or crypto payments in the posting.</li>
                    <li>• TarboroJobs may remove or reject listings that break these rules.</li>
                  </ul>
                </div>

                <label className="flex items-start gap-3 rounded-[24px] border border-slate-800 bg-slate-950/60 px-4 py-4 text-sm text-slate-300">
                  <input
                    type="checkbox"
                    name="compliance_certified"
                    checked={!!jobForm.compliance_certified}
                    onChange={handleJobFormChange}
                    className="mt-1 h-4 w-4 rounded border-slate-600 bg-slate-900 text-cyan-400 focus:ring-cyan-400"
                    required
                  />
                  <span className="leading-6">
                    I certify this posting is accurate, lawful, non-discriminatory, and does not request money or sensitive financial/personal information from applicants. I understand open jobs expire after 14 days and TarboroJobs may remove listings that violate these rules.
                  </span>
                </label>

                {jobMessage ? <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">{jobMessage}</div> : null}
                {jobError ? <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{jobError}</div> : null}

                <div className="flex flex-wrap gap-3">
                  <button type="submit" disabled={jobLoading} className="inline-flex items-center gap-2 rounded-2xl bg-cyan-400 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-60">
                    <PlusCircle className="h-4 w-4" />
                    {jobLoading ? (editingJobId ? 'Saving...' : 'Posting...') : editingJobId ? 'Save Changes' : 'Post Job'}
                  </button>

                  {editingJobId ? (
                    <button type="button" onClick={cancelEdit} className="inline-flex items-center gap-2 rounded-2xl border border-slate-700 bg-white/5 px-5 py-3 text-sm font-semibold text-slate-200 transition hover:border-slate-600">
                      <XCircle className="h-4 w-4" />
                      Cancel Edit
                    </button>
                  ) : null}
                </div>
              </form>
            </section>

            <section className={panelClassName()}>
              <PanelHeader icon={Briefcase} title="My Jobs" subtitle="Track what is live, what expired, and what needs a 14-day renewal." />
              <div className="space-y-4 p-5">
                {jobsLoading ? (
                  <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-950/60 p-6 text-sm text-slate-400">Loading your jobs...</div>
                ) : employerJobs.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-950/60 p-6 text-sm text-slate-400">No jobs created yet.</div>
                ) : (
                  employerJobs.map((job) => (
                    <div key={job.id} className="rounded-[26px] border border-slate-800 bg-slate-950/60 p-4 sm:p-5">
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0">
                          <h3 className="text-lg font-semibold text-white">{job.job_title}</h3>
                          <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-400">
                            <span>{job.city || 'Tarboro, NC'}</span>
                            <span>•</span>
                            <span>{humanizeJobType(job.employment_type)}</span>
                            <span>•</span>
                            <span>{humanizeStatus(job.status)}</span>
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <button type="button" onClick={() => beginEditJob(job)} className="inline-flex items-center gap-1.5 rounded-2xl border border-slate-700 bg-white/5 px-3 py-2 text-xs font-medium text-slate-200 transition hover:border-slate-600">
                            <PencilLine className="h-3.5 w-3.5" /> Edit
                          </button>

                          <button type="button" onClick={() => handleDeleteJob(job)} disabled={deletingJobId === job.id} className="inline-flex items-center gap-1.5 rounded-2xl border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-xs font-medium text-rose-300 transition hover:bg-rose-500/15 disabled:cursor-not-allowed disabled:opacity-60">
                            <Trash2 className="h-3.5 w-3.5" /> {deletingJobId === job.id ? 'Deleting...' : 'Delete'}
                          </button>

                          {job.status !== 'open' ? <button type="button" onClick={() => onUpdateJobStatus(job.id, 'open')} className="inline-flex items-center gap-1.5 rounded-2xl border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-xs font-medium text-emerald-300 transition hover:bg-emerald-500/15"><CheckCircle2 className="h-3.5 w-3.5" /> Renew 14 Days</button> : null}
                          {job.status !== 'filled' ? <button type="button" onClick={() => onUpdateJobStatus(job.id, 'filled')} className="inline-flex items-center gap-1.5 rounded-2xl border border-cyan-500/25 bg-cyan-500/10 px-3 py-2 text-xs font-medium text-cyan-300 transition hover:bg-cyan-500/15"><CheckCircle2 className="h-3.5 w-3.5" /> Filled</button> : null}
                          {job.status !== 'closed' ? <button type="button" onClick={() => onUpdateJobStatus(job.id, 'closed')} className="inline-flex items-center gap-1.5 rounded-2xl border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-xs font-medium text-rose-300 transition hover:bg-rose-500/15"><XCircle className="h-3.5 w-3.5" /> Close</button> : null}
                          {job.status !== 'draft' ? <button type="button" onClick={() => onUpdateJobStatus(job.id, 'draft')} className="inline-flex items-center gap-1.5 rounded-2xl border border-slate-700 bg-white/5 px-3 py-2 text-xs font-medium text-slate-200 transition hover:border-slate-600"><PencilLine className="h-3.5 w-3.5" /> Draft</button> : null}
                        </div>
                      </div>

                      <p className="mt-4 text-sm leading-6 text-slate-300">{job.job_description}</p>
                      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-xs text-slate-500">
                        {job.pay_display ? <span>{job.pay_display}</span> : null}
                        {job.experience_level ? <span>{job.experience_level}</span> : null}
                        {job.published_at ? <span>Live {formatShortDate(job.published_at)}</span> : null}
                        <span>{formatExpirationLabel(job)}</span>
                        {job.expired_at ? <span>Expired {formatShortDate(job.expired_at)}</span> : null}
                        {job.created_at ? <span>Created {formatShortDate(job.created_at)}</span> : null}
                        {job.updated_at ? <span>Updated {formatShortDate(job.updated_at)}</span> : null}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>
        )}

        {activeSection === 'candidates' && (
          <section className={panelClassName()}>
            <PanelHeader
              icon={Users}
              title={showingSavedOnly ? 'Saved Candidates' : 'Candidate Resumes'}
              subtitle="Candidate review is now its own workspace instead of sharing the page with account forms and job tools."
            />

            <div className="space-y-5 p-5">
              <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                <div className="flex flex-wrap gap-3">
                  <TabButton icon={Users} label="All Candidates" active={candidateView === 'all'} onClick={() => onCandidateViewChange('all')} />
                  <TabButton icon={Bookmark} label="Saved Candidates" active={candidateView === 'saved'} onClick={() => onCandidateViewChange('saved')} />
                </div>

                <div className="text-sm text-slate-400">
                  Showing <span className="font-semibold text-white">{filteredCount}</span> of <span className="font-semibold text-white">{overallTotalResumes}</span> total candidates
                </div>
              </div>

              <div className="rounded-2xl border border-slate-800 bg-slate-950/60 px-4 py-3 text-sm text-slate-300">
                {showingSavedOnly ? 'Showing only candidates you have marked as Saved.' : 'Submitted resumes may be viewed by active employers on TarboroJobs.com.'}
              </div>

              <div className={`grid gap-4 ${showingSavedOnly ? 'md:grid-cols-[1fr_220px_220px]' : 'md:grid-cols-[1fr_220px_220px_220px]'}`}>
                <div className="flex items-center gap-3 rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3">
                  <Search className="h-4 w-4 text-slate-500" />
                  <input
                    className="w-full bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-500"
                    placeholder="Search name, title, skills..."
                    value={resumeFilters.search}
                    onChange={(e) => onResumeFilterChange('search', e.target.value)}
                  />
                </div>

                <input
                  placeholder="Filter by city"
                  value={resumeFilters.city}
                  onChange={(e) => onResumeFilterChange('city', e.target.value)}
                  className={inputClassName()}
                />

                <select value={resumeFilters.employment_type} onChange={(e) => onResumeFilterChange('employment_type', e.target.value)} className={inputClassName()}>
                  <option value="">All Employment Types</option>
                  {employerResumeTypes.filter((value) => value !== '').map((value) => (
                    <option key={value} value={value}>{humanizeJobType(value)}</option>
                  ))}
                </select>

                {!showingSavedOnly ? (
                  <select value={resumeFilters.candidate_status} onChange={(e) => onResumeFilterChange('candidate_status', e.target.value)} className={inputClassName()}>
                    <option value="">All Candidate Statuses</option>
                    {candidateStatuses.filter((value) => value !== '').map((value) => (
                      <option key={value} value={value}>{humanizeStatus(value)}</option>
                    ))}
                  </select>
                ) : null}
              </div>

              <div className="grid gap-6 xl:grid-cols-[340px_1fr]">
                <div className="space-y-3">
                  {resumesLoading ? (
                    <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-950/60 p-6 text-center text-sm text-slate-400">Loading resumes...</div>
                  ) : employerResumes.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-950/60 p-6 text-center text-sm text-slate-400">{showingSavedOnly ? 'No saved candidates found.' : 'No resumes found.'}</div>
                  ) : (
                    employerResumes.map((resume) => {
                      const active = selectedResume?.id === resume.id
                      const candidateAction = resume.candidate_action || null
                      return (
                        <button
                          key={resume.id}
                          type="button"
                          onClick={() => onSelectResume(resume)}
                          className={`w-full rounded-[24px] border p-4 text-left transition ${active ? 'border-cyan-400/30 bg-cyan-400/10' : 'border-slate-800 bg-slate-950/60 hover:border-slate-700'}`}
                        >
                          <div className="flex items-start gap-3">
                            <div className="mt-0.5 rounded-2xl bg-white/5 p-2.5 text-cyan-300"><UserRound className="h-4 w-4" /></div>
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-sm font-semibold text-white">{resume.full_name}</div>
                              <div className="mt-1 truncate text-xs text-slate-400">{resume.desired_job_title || 'No desired title'}</div>
                              {resume.job_title ? <div className="mt-1 truncate text-[11px] text-slate-500">Applied to: {resume.job_title}</div> : null}
                              <div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-500">
                                {resume.city ? <span>{resume.city}</span> : null}
                                {resume.employment_type ? <span>{humanizeJobType(resume.employment_type)}</span> : null}
                                {resume.ats_score !== null && resume.ats_score !== undefined ? <span>ATS {Math.round(resume.ats_score)}%</span> : null}
                              </div>
                              <div className="mt-2 flex flex-wrap gap-2">
                                {resume.ats_recommendation ? <div className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-medium ${atsBadgeClass(resume.ats_recommendation)}`}>{formatAtsRecommendation(resume.ats_recommendation)}</div> : null}
                                {candidateAction?.status ? <div className="inline-flex rounded-full border border-cyan-400/20 bg-cyan-400/10 px-2.5 py-1 text-[11px] font-medium text-cyan-300">{humanizeStatus(candidateAction.status)}</div> : null}
                              </div>
                              {candidateAction?.notes ? <div className="mt-2 line-clamp-2 text-xs text-slate-500">{candidateAction.notes}</div> : null}
                              <div className="mt-2 text-xs text-slate-500">{resume.created_at ? formatShortDate(resume.created_at) : 'Recently submitted'}</div>
                            </div>
                          </div>
                        </button>
                      )
                    })
                  )}

                  <div className="flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-950/60 px-4 py-3">
                    <button type="button" onClick={() => onResumePageChange(resumePagination.page - 1)} disabled={!resumePagination.has_prev || resumesLoading} className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-white/5 px-3 py-2 text-xs font-medium text-slate-200 disabled:cursor-not-allowed disabled:opacity-50">
                      <ChevronLeft className="h-3.5 w-3.5" /> Prev
                    </button>
                    <div className="text-xs text-slate-400">Page {resumePagination.page} of {resumePagination.total_pages}</div>
                    <button type="button" onClick={() => onResumePageChange(resumePagination.page + 1)} disabled={!resumePagination.has_next || resumesLoading} className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-white/5 px-3 py-2 text-xs font-medium text-slate-200 disabled:cursor-not-allowed disabled:opacity-50">
                      Next <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  <div className="text-xs text-slate-500">{resumePagination.total} total {showingSavedOnly ? 'saved candidates' : 'resumes'}</div>
                </div>

                <div className="space-y-6">
                  {!selectedResume ? (
                    <div className="rounded-[28px] border border-dashed border-slate-700 bg-slate-950/60 p-10 text-center text-sm text-slate-400">{showingSavedOnly ? 'Select a saved candidate to view details.' : 'Select a resume to view details.'}</div>
                  ) : (
                    <>
                      <section className={panelClassName('bg-slate-950/60')}>
                        <PanelHeader
                          icon={UserRound}
                          title={selectedResume.full_name}
                          subtitle={selectedResume.desired_job_title || 'Candidate profile'}
                          action={selectedResume.resume_file_url ? (
                            <a
                              href={resumeFileHref(fileBase, selectedResume.resume_file_url)}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center justify-center gap-2 rounded-2xl border border-cyan-400/25 bg-cyan-400/10 px-4 py-2.5 text-sm font-medium text-cyan-300 transition hover:bg-cyan-400/15"
                            >
                              <Download className="h-4 w-4" /> View PDF
                            </a>
                          ) : null}
                        />
                        <div className="space-y-5 p-5">
                          <div className="flex flex-wrap gap-2 text-sm text-slate-400">
                            {selectedResume.city ? <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-3 py-1"><MapPin className="h-3.5 w-3.5" /> {selectedResume.city}</span> : null}
                            {selectedResume.employment_type ? <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-3 py-1"><Briefcase className="h-3.5 w-3.5" /> {humanizeJobType(selectedResume.employment_type)}</span> : null}
                            {selectedResume.job_title ? <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-3 py-1"><Briefcase className="h-3.5 w-3.5" /> Applied to {selectedResume.job_title}</span> : null}
                            {selectedResume.ats_recommendation ? <span className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 ${atsBadgeClass(selectedResume.ats_recommendation)}`}>{formatAtsRecommendation(selectedResume.ats_recommendation)}{selectedResume.ats_score !== null && selectedResume.ats_score !== undefined ? ` • ${Math.round(selectedResume.ats_score)}%` : ''}</span> : null}
                            {selectedCandidateAction?.status ? <span className="inline-flex items-center gap-1 rounded-full border border-cyan-400/25 bg-cyan-400/10 px-3 py-1 text-cyan-300">{humanizeStatus(selectedCandidateAction.status)}</span> : null}
                          </div>

                          <div className="grid gap-3 md:grid-cols-2">
                            {selectedResume.email ? <div className="flex items-center gap-2 rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3 text-sm text-slate-300"><Mail className="h-4 w-4 text-cyan-300" /> {selectedResume.email}</div> : null}
                            {selectedResume.phone ? <div className="flex items-center gap-2 rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3 text-sm text-slate-300"><Phone className="h-4 w-4 text-cyan-300" /> {selectedResume.phone}</div> : null}
                          </div>

                          {selectedResume.skills ? (
                            <div>
                              <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Skills</div>
                              <p className="rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-4 text-sm leading-6 text-slate-300">{selectedResume.skills}</p>
                            </div>
                          ) : null}

                          {(selectedResume.ats_summary || (selectedResume.ats_keywords_matched && selectedResume.ats_keywords_matched.length > 0) || (selectedResume.ats_keywords_missing && selectedResume.ats_keywords_missing.length > 0)) ? (
                            <div>
                              <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400"><ShieldCheck className="h-4 w-4" /> ATS Review</div>
                              <div className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-4 text-sm leading-6 text-slate-300">
                                {selectedResume.ats_summary ? <p>{selectedResume.ats_summary}</p> : null}
                                {selectedResume.ats_keywords_matched?.length ? <p><span className="font-semibold text-white">Matched:</span> {selectedResume.ats_keywords_matched.join(', ')}</p> : null}
                                {selectedResume.ats_keywords_missing?.length ? <p><span className="font-semibold text-white">Missing:</span> {selectedResume.ats_keywords_missing.join(', ')}</p> : null}
                              </div>
                            </div>
                          ) : null}

                          {selectedResume.resume_text ? (
                            <div>
                              <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400"><FileBadge className="h-4 w-4" /> Resume Summary</div>
                              <p className="rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-4 text-sm leading-6 text-slate-300">{selectedResume.resume_text}</p>
                            </div>
                          ) : null}

                          {selectedCandidateAction ? (
                            <div className="grid gap-3 md:grid-cols-2">
                              <div className="rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3"><div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Contacted</div><div className="mt-1 text-sm text-slate-300">{formatDateTime(selectedCandidateAction.contacted_at)}</div></div>
                              <div className="rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3"><div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Interview</div><div className="mt-1 text-sm text-slate-300">{formatDateTime(selectedCandidateAction.interview_at)}</div></div>
                              <div className="rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3"><div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Hired</div><div className="mt-1 text-sm text-slate-300">{formatDateTime(selectedCandidateAction.hired_at)}</div></div>
                              <div className="rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3"><div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Rejected</div><div className="mt-1 text-sm text-slate-300">{formatDateTime(selectedCandidateAction.rejected_at)}</div></div>
                              <div className="rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3 md:col-span-2"><div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Next Follow-Up</div><div className="mt-1 text-sm text-slate-300">{formatDateTime(selectedCandidateAction.next_follow_up_at)}</div></div>
                            </div>
                          ) : null}

                          <div className="text-xs text-slate-500">Submitted {selectedResume.created_at ? formatShortDate(selectedResume.created_at) : 'recently'}</div>
                        </div>
                      </section>

                      <CandidateActionPanel
                        selectedResume={selectedResume}
                        candidateAction={selectedCandidateAction}
                        actionLoading={actionLoading}
                        actionMessage={actionMessage}
                        actionError={actionError}
                        onSaveAction={onSaveCandidateAction}
                        candidateStatuses={candidateStatuses}
                      />
                    </>
                  )}
                </div>
              </div>
            </div>
          </section>
        )}

        {activeSection === 'account' && (
          <div className="grid gap-6 xl:grid-cols-[1fr_0.82fr]">
            <section className={panelClassName()}>
              <PanelHeader icon={Building2} title="Account Settings" subtitle="Business information lives here now instead of sharing the screen with every other tool." />
              <form onSubmit={handleSubmitAccount} className="space-y-4 p-5">
                <Field label="Business Name" required>
                  <input name="business_name" value={accountForm.business_name} onChange={handleAccountFormChange} placeholder="Tarboro Manufacturing Co." required className={inputClassName()} />
                </Field>

                <Field label="Industry">
                  <select name="industry" value={accountForm.industry} onChange={handleAccountFormChange} className={inputClassName()}>
                    <option value="">Select industry</option>
                    {employerIndustries.map((industry) => <option key={industry} value={industry}>{industry}</option>)}
                  </select>
                </Field>

                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="Contact Name">
                    <input name="contact_name" value={accountForm.contact_name} onChange={handleAccountFormChange} placeholder="Hiring Manager" className={inputClassName()} />
                  </Field>
                  <Field label="Phone">
                    <input name="phone" value={accountForm.phone} onChange={handleAccountFormChange} placeholder="252-555-1234" className={inputClassName()} />
                  </Field>
                </div>

                <Field label="Email / Username" required>
                  <input type="email" name="email" value={accountForm.email} onChange={handleAccountFormChange} placeholder="jobs@yourbusiness.com" required className={inputClassName()} />
                </Field>

                <Field label="Website">
                  <input name="website" value={accountForm.website} onChange={handleAccountFormChange} placeholder="https://yourbusiness.com" className={inputClassName()} />
                </Field>

                <Field label="Street Address">
                  <input name="address" value={accountForm.address} onChange={handleAccountFormChange} placeholder="123 Main St" className={inputClassName()} />
                </Field>

                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="City">
                    <input name="city" value={accountForm.city} onChange={handleAccountFormChange} placeholder="Tarboro, NC" className={inputClassName()} />
                  </Field>

                  <Field label="Currently Hiring">
                    <select name="is_hiring" value={String(accountForm.is_hiring)} onChange={handleAccountFormChange} className={inputClassName()}>
                      <option value="true">Yes</option>
                      <option value="false">No</option>
                    </select>
                  </Field>
                </div>

                <Field label="Business Description">
                  <textarea name="notes" rows={6} value={accountForm.notes} onChange={handleAccountFormChange} placeholder="Tell job seekers about your business." className={inputClassName('min-h-[160px] resize-y')} />
                </Field>

                {accountError || accountMessage ? (
                  <div className={`rounded-2xl border px-4 py-3 text-sm ${accountError ? 'border-rose-500/30 bg-rose-500/10 text-rose-300' : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'}`}>
                    {accountError || accountMessage}
                  </div>
                ) : null}

                <button type="submit" disabled={accountLoading} className="inline-flex w-full items-center justify-center rounded-2xl bg-cyan-400 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-60">
                  {accountLoading ? 'Saving Account...' : 'Save Account Changes'}
                </button>
              </form>
            </section>

            <div className="space-y-6">
              <section className={panelClassName()}>
                <PanelHeader icon={ShieldCheck} title="Change Password" subtitle="Keep this separate from business profile edits." />
                <form onSubmit={handleSubmitPassword} className="space-y-4 p-5">
                  <Field label="Current Password" required>
                    <input type="password" name="current_password" value={passwordForm.current_password} onChange={handlePasswordFormChange} required className={inputClassName()} />
                  </Field>
                  <Field label="New Password" required>
                    <input type="password" name="new_password" value={passwordForm.new_password} onChange={handlePasswordFormChange} required className={inputClassName()} />
                  </Field>
                  <Field label="Confirm New Password" required>
                    <input type="password" name="confirm_password" value={passwordForm.confirm_password} onChange={handlePasswordFormChange} required className={inputClassName()} />
                  </Field>

                  {passwordError || passwordMessage ? (
                    <div className={`rounded-2xl border px-4 py-3 text-sm ${passwordError ? 'border-rose-500/30 bg-rose-500/10 text-rose-300' : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'}`}>
                      {passwordError || passwordMessage}
                    </div>
                  ) : null}

                  <button type="submit" disabled={passwordLoading} className="inline-flex w-full items-center justify-center rounded-2xl border border-slate-700 bg-white/5 px-5 py-3 text-sm font-semibold text-slate-100 transition hover:border-slate-600 disabled:cursor-not-allowed disabled:opacity-60">
                    {passwordLoading ? 'Updating Password...' : 'Update Password'}
                  </button>
                </form>
              </section>

              <section className={panelClassName()}>
                <PanelHeader icon={ShieldCheck} title="Account Status" subtitle="Subscription and access details in one clean card." />
                <div className="space-y-3 p-5 text-sm text-slate-300">
                  <div className="rounded-2xl border border-slate-800 bg-slate-950/60 px-4 py-3"><span className="font-semibold text-white">Subscription Status:</span> {employer?.subscription_status || '—'}</div>
                  <div className="rounded-2xl border border-slate-800 bg-slate-950/60 px-4 py-3"><span className="font-semibold text-white">Access Status:</span> {employer?.access_status || '—'}</div>
                  <div className="rounded-2xl border border-slate-800 bg-slate-950/60 px-4 py-3"><span className="font-semibold text-white">Hiring Status:</span> {employer?.status === 'active' ? 'Hiring' : 'Not hiring'}</div>
                  <div className="rounded-2xl border border-slate-800 bg-slate-950/60 px-4 py-3"><span className="font-semibold text-white">Current Period End:</span> {employer?.current_period_end ? formatShortDate(employer.current_period_end) : '—'}</div>
                </div>
              </section>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
