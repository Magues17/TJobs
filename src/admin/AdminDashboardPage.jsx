import { useMemo, useState } from 'react'
import {
  Ban,
  Briefcase,
  Building2,
  CheckCircle2,
  Copy,
  Link2,
  Mail,
  RefreshCw,
  Shield,
  Trash2,
  UserCheck,
} from 'lucide-react'

function formatDateTime(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString()
}

function formatDate(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString()
}

function toMoneyRange(job) {
  const min = job.pay_min !== null && job.pay_min !== undefined && job.pay_min !== '' ? Number(job.pay_min) : null
  const max = job.pay_max !== null && job.pay_max !== undefined && job.pay_max !== '' ? Number(job.pay_max) : null
  const payType = job.pay_type || 'hourly'

  if (Number.isFinite(min) && Number.isFinite(max)) {
    return `$${min.toLocaleString()} - $${max.toLocaleString()}/${payType}`
  }

  if (Number.isFinite(min)) {
    return `$${min.toLocaleString()}/${payType}`
  }

  return 'Pay not listed'
}

function StatusBadge({ children, tone = 'slate' }) {
  const tones = {
    slate: 'border-slate-700 bg-slate-900/80 text-slate-300',
    cyan: 'border-cyan-400/30 bg-cyan-400/10 text-cyan-200',
    emerald: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
    amber: 'border-amber-500/30 bg-amber-500/10 text-amber-200',
    rose: 'border-rose-500/30 bg-rose-500/10 text-rose-200',
  }

  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] ${tones[tone] || tones.slate}`}>
      {children}
    </span>
  )
}

function ActionButton({ children, tone = 'default', ...props }) {
  const tones = {
    default: 'border-slate-700 bg-slate-950/70 text-slate-200 hover:border-slate-600 hover:text-white',
    cyan: 'border-cyan-400/30 bg-cyan-400 text-slate-950 hover:bg-cyan-300',
    emerald: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200 hover:border-emerald-400/40 hover:bg-emerald-500/15',
    amber: 'border-amber-500/30 bg-amber-500/10 text-amber-200 hover:border-amber-400/40 hover:bg-amber-500/15',
    rose: 'border-rose-500/30 bg-rose-500/10 text-rose-200 hover:border-rose-400/40 hover:bg-rose-500/15',
  }

  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-2 rounded-2xl border px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${tones[tone] || tones.default} ${props.className || ''}`}
    >
      {children}
    </button>
  )
}

export default function AdminDashboardPage({
  adminOverview,
  employers,
  jobs,
  tokens,
  loading,
  actionLoading,
  actionMessage,
  actionError,
  onRefresh,
  onCreateToken,
  onApproveEmployer,
  onDeactivateEmployer,
  onReactivateEmployer,
  onRevokeToken,
  onDeleteJob,
  onLogout,
  SectionHeader,
  Card,
  Field,
  Input,
  Select,
}) {
  const [employerSearch, setEmployerSearch] = useState('')
  const [jobSearch, setJobSearch] = useState('')
  const [tokenSearch, setTokenSearch] = useState('')
  const [inviteForm, setInviteForm] = useState({
    business_name: '',
    email: '',
    square_customer_id: '',
    square_subscription_id: '',
    current_period_end: '',
    send_email: true,
  })
  const [inviteSubmitting, setInviteSubmitting] = useState(false)

  const employerResults = useMemo(() => {
    const search = employerSearch.trim().toLowerCase()
    if (!search) return employers

    return employers.filter((employer) =>
      [
        employer.business_name,
        employer.email,
        employer.contact_name,
        employer.industry,
        employer.city,
        employer.login_email,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(search))
    )
  }, [employers, employerSearch])

  const jobResults = useMemo(() => {
    const search = jobSearch.trim().toLowerCase()
    if (!search) return jobs

    return jobs.filter((job) =>
      [job.title, job.city, job.status, job.industry, job.employer_name, job.employer_email]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(search))
    )
  }, [jobs, jobSearch])

  const tokenResults = useMemo(() => {
    const search = tokenSearch.trim().toLowerCase()
    if (!search) return tokens

    return tokens.filter((token) =>
      [token.business_name, token.email, token.status]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(search))
    )
  }, [tokenSearch, tokens])

  async function handleCreateToken(event) {
    event.preventDefault()
    setInviteSubmitting(true)

    try {
      await onCreateToken({
        ...inviteForm,
        send_email: !!inviteForm.send_email,
      })

      setInviteForm({
        business_name: '',
        email: '',
        square_customer_id: '',
        square_subscription_id: '',
        current_period_end: '',
        send_email: true,
      })
    } finally {
      setInviteSubmitting(false)
    }
  }

  async function handleCopyLink(url) {
    if (!url) return

    try {
      await navigator.clipboard.writeText(url)
    } catch {
      window.prompt('Copy onboarding link:', url)
    }
  }

  const statItems = [
    { label: 'Employers', value: adminOverview.total_employers || 0, note: `${adminOverview.active_employers || 0} active / ${adminOverview.pending_employers || 0} pending` },
    { label: 'Jobs', value: adminOverview.total_jobs || 0, note: `${adminOverview.open_jobs || 0} open / ${adminOverview.closed_jobs || 0} closed` },
    { label: 'Onboarded', value: adminOverview.onboarded_employers || 0, note: 'Employers who completed setup' },
    { label: 'Tokens', value: adminOverview.total_tokens || 0, note: `${adminOverview.pending_tokens || 0} pending / ${adminOverview.used_tokens || 0} used` },
  ]

  return (
    <div className="space-y-5">
      <SectionHeader
        title="Admin dashboard"
        subtitle="Manage employer onboarding, activate or disable accounts, review posted jobs, and moderate the platform without touching raw endpoints."
        action={
          <div className="flex flex-col gap-3 sm:flex-row">
            <ActionButton onClick={onRefresh} disabled={loading || actionLoading}>
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </ActionButton>
            <ActionButton onClick={onLogout} tone="rose">
              <Shield className="h-4 w-4" />
              Exit admin
            </ActionButton>
          </div>
        }
      />

      {actionMessage ? (
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          {actionMessage}
        </div>
      ) : null}

      {actionError ? (
        <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {actionError}
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {statItems.map((item) => (
          <div key={item.label} className="rounded-[26px] border border-slate-800 bg-slate-900/75 p-4 shadow-[0_16px_40px_rgba(2,6,23,0.22)]">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{item.label}</div>
            <div className="mt-2 text-3xl font-semibold tracking-tight text-white">{item.value}</div>
            <div className="mt-1 text-xs text-slate-500">{item.note}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
        <Card title="Create employer onboarding link">
          <form className="space-y-4" onSubmit={handleCreateToken}>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Business name">
                <Input
                  value={inviteForm.business_name}
                  onChange={(event) => setInviteForm((prev) => ({ ...prev, business_name: event.target.value }))}
                  placeholder="Acme Heating"
                />
              </Field>
              <Field label="Employer email" required>
                <Input
                  type="email"
                  value={inviteForm.email}
                  onChange={(event) => setInviteForm((prev) => ({ ...prev, email: event.target.value }))}
                  placeholder="owner@business.com"
                  required
                />
              </Field>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Square customer ID">
                <Input
                  value={inviteForm.square_customer_id}
                  onChange={(event) => setInviteForm((prev) => ({ ...prev, square_customer_id: event.target.value }))}
                  placeholder="Optional"
                />
              </Field>
              <Field label="Square subscription ID">
                <Input
                  value={inviteForm.square_subscription_id}
                  onChange={(event) => setInviteForm((prev) => ({ ...prev, square_subscription_id: event.target.value }))}
                  placeholder="Optional"
                />
              </Field>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Current period end">
                <Input
                  type="date"
                  value={inviteForm.current_period_end}
                  onChange={(event) => setInviteForm((prev) => ({ ...prev, current_period_end: event.target.value }))}
                />
              </Field>
              <Field label="Send onboarding email">
                <Select
                  value={inviteForm.send_email ? 'yes' : 'no'}
                  onChange={(event) =>
                    setInviteForm((prev) => ({
                      ...prev,
                      send_email: event.target.value === 'yes',
                    }))
                  }
                >
                  <option value="yes">Yes — email the link</option>
                  <option value="no">No — create only</option>
                </Select>
              </Field>
            </div>

            <ActionButton type="submit" tone="cyan" disabled={inviteSubmitting || actionLoading}>
              <Link2 className="h-4 w-4" />
              {inviteSubmitting ? 'Creating link…' : 'Create onboarding link'}
            </ActionButton>
          </form>
        </Card>

        <Card title="Recent onboarding links">
          <div className="flex items-center gap-3 rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3">
            <Mail className="h-4 w-4 shrink-0 text-slate-500" />
            <input
              className="w-full bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-500"
              placeholder="Search tokens by company or email"
              value={tokenSearch}
              onChange={(event) => setTokenSearch(event.target.value)}
            />
          </div>

          <div className="space-y-3">
            {tokenResults.slice(0, 12).map((token) => {
              const tone = token.status === 'pending' ? 'amber' : token.status === 'used' ? 'emerald' : 'rose'

              return (
                <div key={token.id} className="rounded-3xl border border-slate-800 bg-slate-950/55 p-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-base font-semibold text-white">{token.business_name || 'Unnamed employer'}</div>
                        <StatusBadge tone={tone}>{token.status}</StatusBadge>
                      </div>
                      <div className="text-sm text-slate-400">{token.email}</div>
                      <div className="text-xs text-slate-500">Created {formatDateTime(token.created_at)} · Expires {formatDateTime(token.expires_at)}</div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <ActionButton type="button" onClick={() => handleCopyLink(token.onboarding_url)}>
                        <Copy className="h-4 w-4" />
                        Copy link
                      </ActionButton>
                      {token.status === 'pending' ? (
                        <ActionButton type="button" tone="rose" disabled={actionLoading} onClick={() => onRevokeToken(token.id)}>
                          <Ban className="h-4 w-4" />
                          Revoke
                        </ActionButton>
                      ) : null}
                    </div>
                  </div>
                </div>
              )
            })}

            {!tokenResults.length ? (
              <div className="rounded-2xl border border-slate-800 bg-slate-950/55 px-4 py-5 text-sm text-slate-400">
                No onboarding links found.
              </div>
            ) : null}
          </div>
        </Card>
      </div>

      <Card title="Employers">
        <div className="flex items-center gap-3 rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3">
          <Building2 className="h-4 w-4 shrink-0 text-slate-500" />
          <input
            className="w-full bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-500"
            placeholder="Search employers by business name, email, contact, city, or login"
            value={employerSearch}
            onChange={(event) => setEmployerSearch(event.target.value)}
          />
        </div>

        <div className="space-y-3">
          {employerResults.map((employer) => {
            const statusTone = employer.access_status === 'active' ? 'emerald' : employer.access_status === 'pending' ? 'amber' : 'rose'

            return (
              <div key={employer.id} className="rounded-3xl border border-slate-800 bg-slate-950/55 p-4">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-lg font-semibold text-white">{employer.business_name || 'Unnamed employer'}</div>
                      <StatusBadge tone={statusTone}>{employer.access_status}</StatusBadge>
                      <StatusBadge tone={employer.onboarding_completed ? 'emerald' : 'amber'}>
                        {employer.onboarding_completed ? 'onboarded' : 'not onboarded'}
                      </StatusBadge>
                    </div>

                    <div className="grid gap-2 text-sm text-slate-400 md:grid-cols-2 xl:grid-cols-3">
                      <div>Email: {employer.email || '—'}</div>
                      <div>Login: {employer.login_email || '—'}</div>
                      <div>Contact: {employer.contact_name || '—'}</div>
                      <div>Industry: {employer.industry || '—'}</div>
                      <div>City: {employer.city || '—'}</div>
                      <div>Period ends: {formatDate(employer.current_period_end)}</div>
                    </div>

                    <div className="flex flex-wrap gap-2 text-xs text-slate-500">
                      <span>{employer.total_jobs} total jobs</span>
                      <span>•</span>
                      <span>{employer.open_jobs} open jobs</span>
                      <span>•</span>
                      <span>{employer.total_candidates} candidates</span>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 xl:max-w-[360px] xl:justify-end">
                    <ActionButton type="button" tone="emerald" disabled={actionLoading} onClick={() => onApproveEmployer(employer.id)}>
                      <UserCheck className="h-4 w-4" />
                      Approve
                    </ActionButton>
                    {employer.access_status === 'active' ? (
                      <ActionButton type="button" tone="amber" disabled={actionLoading} onClick={() => onDeactivateEmployer(employer.id)}>
                        <Ban className="h-4 w-4" />
                        Deactivate
                      </ActionButton>
                    ) : (
                      <ActionButton type="button" tone="cyan" disabled={actionLoading} onClick={() => onReactivateEmployer(employer.id)}>
                        <CheckCircle2 className="h-4 w-4" />
                        Reactivate
                      </ActionButton>
                    )}
                    {employer.latest_token?.id ? (
                      <ActionButton
                        type="button"
                        tone="rose"
                        disabled={actionLoading || employer.latest_token.status !== 'pending'}
                        onClick={() => onRevokeToken(employer.latest_token.id)}
                      >
                        <Link2 className="h-4 w-4" />
                        Revoke link
                      </ActionButton>
                    ) : null}
                  </div>
                </div>
              </div>
            )
          })}

          {!employerResults.length ? (
            <div className="rounded-2xl border border-slate-800 bg-slate-950/55 px-4 py-5 text-sm text-slate-400">
              No employers found.
            </div>
          ) : null}
        </div>
      </Card>

      <Card title="Posted jobs">
        <div className="flex items-center gap-3 rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3">
          <Briefcase className="h-4 w-4 shrink-0 text-slate-500" />
          <input
            className="w-full bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-500"
            placeholder="Search jobs by title, city, industry, status, or employer"
            value={jobSearch}
            onChange={(event) => setJobSearch(event.target.value)}
          />
        </div>

        <div className="space-y-3">
          {jobResults.map((job) => {
            const tone = job.status === 'open' ? 'emerald' : job.status === 'draft' ? 'amber' : 'slate'

            return (
              <div key={job.id} className="rounded-3xl border border-slate-800 bg-slate-950/55 p-4">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-lg font-semibold text-white">{job.title}</div>
                      <StatusBadge tone={tone}>{job.status}</StatusBadge>
                      {job.posting_guidelines_accepted ? <StatusBadge tone="cyan">guidelines accepted</StatusBadge> : null}
                    </div>

                    <div className="grid gap-2 text-sm text-slate-400 md:grid-cols-2 xl:grid-cols-3">
                      <div>Employer: {job.employer_name}</div>
                      <div>City: {job.city || '—'}</div>
                      <div>Industry: {job.industry || '—'}</div>
                      <div>Pay: {toMoneyRange(job)}</div>
                      <div>Type: {job.employment_type || '—'}</div>
                      <div>Applicants: {job.total_applicants}</div>
                      <div>Posted: {formatDate(job.published_at || job.created_at)}</div>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 xl:justify-end">
                    <ActionButton type="button" tone="rose" disabled={actionLoading} onClick={() => onDeleteJob(job.id)}>
                      <Trash2 className="h-4 w-4" />
                      Remove post
                    </ActionButton>
                  </div>
                </div>
              </div>
            )
          })}

          {!jobResults.length ? (
            <div className="rounded-2xl border border-slate-800 bg-slate-950/55 px-4 py-5 text-sm text-slate-400">
              No jobs found.
            </div>
          ) : null}
        </div>
      </Card>
    </div>
  )
}
