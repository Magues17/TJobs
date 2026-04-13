import { useEffect, useMemo, useState } from 'react'
import {
  Briefcase,
  Building2,
  Landmark,
  ListFilter,
  MapPin,
  Phone,
  Mail,
  Search,
  Clock3,
  Globe,
  LayoutDashboard,
  LogOut,
  Menu,
  X,
} from 'lucide-react'
import {
  loadEmployerSession as apiLoadEmployerSession,
  loadEmployerJobs as apiLoadEmployerJobs,
  loadEmployerStats as apiLoadEmployerStats,
  loadEmployerResumes as apiLoadEmployerResumes,
  loadSavedCandidates as apiLoadSavedCandidates,
  createEmployerJob as apiCreateEmployerJob,
  updateEmployerJob as apiUpdateEmployerJob,
  updateEmployerJobStatus as apiUpdateEmployerJobStatus,
  deleteEmployerJob as apiDeleteEmployerJob,
  saveCandidateAction as apiSaveCandidateAction,
} from './employer/api'
import {
  getStoredEmployerToken,
  clearStoredEmployerToken,
} from './employer/auth'
import { humanizeJobType } from './employer/utils'
import {
  employerIndustries,
  employerJobTypes,
  employerPayTypes,
  employerResumeTypes,
  candidateStatuses,
} from './employer/constants'
import EmployerLoginPage from './employer/EmployerLoginPage'
import EmployerOnboardingPage from './employer/EmployerOnboardingPage'
import EmployerDashboardPage from './employer/EmployerDashboardPage'
import EmployerForgotPasswordPage from './employer/EmployerForgotPasswordPage'
import EmployerResetPasswordPage from './employer/EmployerResetPasswordPage'
import CandidateActionPanel from './employer/CandidateActionPanel'

const API_BASE = (import.meta.env.VITE_API_BASE || '/api').replace(/\/$/, '')
const FILE_BASE = (import.meta.env.VITE_FILE_BASE || '').replace(/\/$/, '')
const SQUARE_EMPLOYER_PLAN_URL = 'https://square.link/u/zmbpfpGK'

const industries = [
  'All Industries',
  'Healthcare',
  'Manufacturing',
  'Retail',
  'Construction',
  'Education',
  'Food Service',
]

const jobTypes = ['All Types', 'Full Time', 'Part Time', 'Temporary', 'Contract']

function getInitialPage() {
  const params = new URLSearchParams(window.location.search)
  const page = params.get('page')
  const token = params.get('token')

  if (page === 'employer-onboarding') return 'employer-onboarding'
  if (page === 'employer-reset-password' && token) return 'employer-reset-password'

  return 'jobs'
}

function Shell({ currentPage, setCurrentPage, employerSession, onLogout, children }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  const navItems = [
    { key: 'jobs', label: 'Job Board', icon: Briefcase },
    { key: 'businesses', label: 'Businesses', icon: Building2 },
    { key: 'list-business', label: 'Join as Employer', icon: Landmark },
    employerSession
      ? { key: 'employer-dashboard', label: 'Employer Dashboard', icon: LayoutDashboard }
      : { key: 'employer-login', label: 'Employer Login', icon: LayoutDashboard },
  ]

  useEffect(() => {
    setMobileMenuOpen(false)
  }, [currentPage])

  function handleNavClick(pageKey) {
    setCurrentPage(pageKey)
    setMobileMenuOpen(false)
  }

  function handleLogoutClick() {
    onLogout()
    setMobileMenuOpen(false)
  }

  return (
    <div className="min-h-screen bg-[#f7f6f3] text-slate-900">
      <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-[#fbfaf7]/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-5">
          <button
            onClick={() => handleNavClick('jobs')}
            className="min-w-0 flex items-center gap-3 text-left"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-emerald-700 text-white shadow-sm">
              <MapPin className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="truncate font-serif text-xl font-bold leading-none tracking-tight sm:text-2xl">
                Tarboro
              </div>
              <div className="truncate text-[11px] text-slate-500 sm:text-xs">
                Jobs &amp; Business Hub
              </div>
            </div>
          </button>

          <div className="hidden items-center gap-2 md:flex">
            <nav className="flex items-center gap-2">
              {navItems.map((item) => {
                const Icon = item.icon
                const active = currentPage === item.key

                return (
                  <button
                    key={item.key}
                    onClick={() => handleNavClick(item.key)}
                    className={`inline-flex items-center gap-2 rounded-2xl border px-3.5 py-2 text-sm font-medium transition ${
                      active
                        ? 'border-emerald-700 bg-emerald-700 text-white shadow-sm'
                        : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400'
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </button>
                )
              })}
            </nav>

            {employerSession && (
              <button
                onClick={handleLogoutClick}
                className="inline-flex items-center gap-2 rounded-2xl border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:border-slate-400"
              >
                <LogOut className="h-4 w-4" />
                Logout
              </button>
            )}
          </div>

          <button
            type="button"
            aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={mobileMenuOpen}
            onClick={() => setMobileMenuOpen((prev) => !prev)}
            className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-300 bg-white text-slate-700 shadow-sm md:hidden"
          >
            {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>

        {mobileMenuOpen && (
          <div className="border-t border-slate-200 bg-[#fbfaf7] px-4 py-3 md:hidden">
            <nav className="flex flex-col gap-2">
              {navItems.map((item) => {
                const Icon = item.icon
                const active = currentPage === item.key

                return (
                  <button
                    key={item.key}
                    onClick={() => handleNavClick(item.key)}
                    className={`flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left text-sm font-medium transition ${
                      active
                        ? 'border-emerald-700 bg-emerald-700 text-white shadow-sm'
                        : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400'
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span>{item.label}</span>
                  </button>
                )
              })}

              {employerSession && (
                <button
                  onClick={handleLogoutClick}
                  className="mt-1 flex w-full items-center gap-3 rounded-2xl border border-slate-300 bg-white px-4 py-3 text-left text-sm font-medium text-slate-700 hover:border-slate-400"
                >
                  <LogOut className="h-4 w-4 shrink-0" />
                  <span>Logout</span>
                </button>
              )}
            </nav>
          </div>
        )}
      </header>

      <main className="mx-auto max-w-7xl px-4 py-5 sm:px-5 sm:py-6 md:py-8">{children}</main>
    </div>
  )
}

function SectionHeader({ title, subtitle, action }) {
  return (
    <div className="mb-5 flex flex-col gap-3 md:mb-6 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        <h1 className="font-serif text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl md:text-4xl">
          {title}
        </h1>
        <p className="mt-1.5 max-w-3xl text-sm text-slate-500 sm:text-base md:text-lg">
          {subtitle}
        </p>
      </div>
      {action ? <div className="w-full md:w-auto">{action}</div> : null}
    </div>
  )
}

function SearchRow({
  placeholder,
  search,
  setSearch,
  industry,
  setIndustry,
  type,
  setType,
  showType = false,
}) {
  return (
    <div className="mb-5 rounded-3xl border border-slate-200 bg-white p-3 shadow-sm sm:mb-6 sm:p-4">
      <div className="grid gap-3 lg:grid-cols-[1fr_220px_180px]">
        <div className="flex min-h-[52px] items-center gap-3 rounded-2xl border border-slate-200 px-4 py-3">
          <Search className="h-4 w-4 shrink-0 text-slate-400" />
          <input
            className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
            placeholder={placeholder}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="flex min-h-[52px] items-center gap-2 rounded-2xl border border-slate-200 px-4 py-3">
          <ListFilter className="h-4 w-4 shrink-0 text-slate-400" />
          <select
            className="w-full bg-transparent text-sm outline-none"
            value={industry}
            onChange={(e) => setIndustry(e.target.value)}
          >
            {industries.map((option) => (
              <option key={option}>{option}</option>
            ))}
          </select>
        </div>

        {showType ? (
          <div className="flex min-h-[52px] items-center gap-2 rounded-2xl border border-slate-200 px-4 py-3">
            <Briefcase className="h-4 w-4 shrink-0 text-slate-400" />
            <select
              className="w-full bg-transparent text-sm outline-none"
              value={type}
              onChange={(e) => setType(e.target.value)}
            >
              {jobTypes.map((option) => (
                <option key={option}>{option}</option>
              ))}
            </select>
          </div>
        ) : (
          <button
            type="button"
            className="min-h-[52px] rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:border-slate-400"
          >
            Hiring Now
          </button>
        )}
      </div>
    </div>
  )
}

function Field({ label, required = false, children }) {
  return (
    <label className="block">
      <div className="mb-2 text-sm font-semibold text-slate-800">
        {label} {required && <span className="text-rose-500">*</span>}
      </div>
      {children}
    </label>
  )
}

function Input({ className = '', ...props }) {
  return (
    <input
      {...props}
      className={`w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-emerald-600 ${className}`}
    />
  )
}

function Select({ className = '', ...props }) {
  return (
    <select
      {...props}
      className={`w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-emerald-600 ${className}`}
    />
  )
}

function Textarea({ className = '', ...props }) {
  return (
    <textarea
      {...props}
      className={`w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-emerald-600 ${className}`}
    />
  )
}

function Card({ title, children }) {
  return (
    <section className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
      <h2 className="mb-4 text-base font-semibold text-slate-900 sm:mb-5 sm:text-lg">{title}</h2>
      <div className="space-y-5">{children}</div>
    </section>
  )
}

function JobsPage({ jobs }) {
  const [search, setSearch] = useState('')
  const [industry, setIndustry] = useState('All Industries')
  const [type, setType] = useState('All Types')

  const filteredJobs = useMemo(() => {
    return jobs.filter((job) => {
      const matchesSearch =
        !search ||
        [job.title, job.company, job.city, job.description, job.industry]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(search.toLowerCase()))

      const matchesIndustry =
        industry === 'All Industries' ||
        String(job.industry || '').toLowerCase() === industry.toLowerCase()

      const matchesType =
        type === 'All Types' ||
        humanizeJobType(job.type || '').toLowerCase() === type.toLowerCase()

      return matchesSearch && matchesIndustry && matchesType
    })
  }, [jobs, search, industry, type])

  return (
    <div>
      <SectionHeader
        title="Local Job Board"
        subtitle="Explore open roles from active employers in and around Tarboro."
      />

      <SearchRow
        placeholder="Search jobs, companies, or keywords"
        search={search}
        setSearch={setSearch}
        industry={industry}
        setIndustry={setIndustry}
        type={type}
        setType={setType}
        showType
      />

      {filteredJobs.length === 0 ? (
        <div className="rounded-[28px] border border-slate-200 bg-white p-8 text-center shadow-sm sm:p-10">
          <Briefcase className="mx-auto mb-4 h-10 w-10 text-slate-300" />
          <h3 className="text-lg font-semibold text-slate-900">No jobs found</h3>
          <p className="mt-2 text-sm text-slate-500">Try adjusting your search or filters.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:gap-5">
          {filteredJobs.map((job) => (
            <article
              key={job.id}
              className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm sm:p-6"
            >
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0">
                  <h2 className="font-serif text-xl font-bold text-slate-900 sm:text-2xl">
                    {job.title}
                  </h2>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-slate-500">
                    <span className="inline-flex items-center gap-1.5 break-words">
                      <Building2 className="h-4 w-4 shrink-0" />
                      {job.company}
                    </span>
                    {job.city && (
                      <span className="inline-flex items-center gap-1.5">
                        <MapPin className="h-4 w-4 shrink-0" />
                        {job.city}
                      </span>
                    )}
                    {job.type && (
                      <span className="inline-flex items-center gap-1.5">
                        <Briefcase className="h-4 w-4 shrink-0" />
                        {humanizeJobType(job.type)}
                      </span>
                    )}
                    {job.posted && (
                      <span className="inline-flex items-center gap-1.5">
                        <Clock3 className="h-4 w-4 shrink-0" />
                        {new Date(job.posted).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                </div>

                {job.pay && (
                  <div className="self-start rounded-2xl bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700">
                    {job.pay}
                  </div>
                )}
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {job.industry && (
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                    {job.industry}
                  </span>
                )}
                {job.experience_level && (
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                    {job.experience_level}
                  </span>
                )}
              </div>

              {job.description && (
                <p className="mt-4 whitespace-pre-line break-words text-sm leading-6 text-slate-600">
                  {job.description}
                </p>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  )
}

function BusinessesPage({ setCurrentPage, businesses }) {
  const [search, setSearch] = useState('')
  const [industry, setIndustry] = useState('All Industries')

  const filteredBusinesses = useMemo(() => {
    return businesses.filter((business) => {
      const matchesSearch =
        !search ||
        [
          business.name,
          business.city,
          business.description,
          business.industry,
          business.contact_name,
        ]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(search.toLowerCase()))

      const matchesIndustry =
        industry === 'All Industries' ||
        String(business.industry || '').toLowerCase() === industry.toLowerCase()

      return matchesSearch && matchesIndustry
    })
  }, [businesses, search, industry])

  return (
    <div>
      <SectionHeader
        title="Local Businesses"
        subtitle="Browse employers and business profiles connected to TarboroJobs."
        action={
          <button
            onClick={() => setCurrentPage('list-business')}
            className="w-full rounded-2xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-emerald-800 md:w-auto md:py-2.5"
          >
            Join as Employer
          </button>
        }
      />

      <SearchRow
        placeholder="Search businesses, industry, or city"
        search={search}
        setSearch={setSearch}
        industry={industry}
        setIndustry={setIndustry}
        type="All Types"
        setType={() => {}}
      />

      {filteredBusinesses.length === 0 ? (
        <div className="rounded-[28px] border border-slate-200 bg-white p-8 text-center shadow-sm sm:p-10">
          <Building2 className="mx-auto mb-4 h-10 w-10 text-slate-300" />
          <h3 className="text-lg font-semibold text-slate-900">No businesses found</h3>
          <p className="mt-2 text-sm text-slate-500">Try adjusting your search or filters.</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredBusinesses.map((business) => (
            <article
              key={business.id}
              className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm sm:p-6"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="font-serif text-xl font-bold text-slate-900 sm:text-2xl">
                    {business.name}
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                    {business.industry || 'Local Business'}
                  </p>
                </div>

                {business.hiring && (
                  <span className="shrink-0 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                    Hiring
                  </span>
                )}
              </div>

              <div className="mt-4 space-y-2 text-sm text-slate-600">
                {business.city && (
                  <div className="inline-flex items-center gap-2 break-words">
                    <MapPin className="h-4 w-4 shrink-0 text-slate-400" />
                    {business.city}
                  </div>
                )}
                {business.phone && (
                  <div className="flex items-center gap-2 break-words">
                    <Phone className="h-4 w-4 shrink-0 text-slate-400" />
                    {business.phone}
                  </div>
                )}
                {business.email && (
                  <div className="flex items-center gap-2 break-all">
                    <Mail className="h-4 w-4 shrink-0 text-slate-400" />
                    {business.email}
                  </div>
                )}
                {business.website && (
                  <a
                    href={business.website.startsWith('http') ? business.website : `https://${business.website}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-2 break-all text-emerald-700 hover:underline"
                  >
                    <Globe className="h-4 w-4 shrink-0" />
                    Visit website
                  </a>
                )}
              </div>

              {business.description && (
                <p className="mt-4 break-words text-sm leading-6 text-slate-600">
                  {business.description}
                </p>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  )
}

function SubmitResumePage() {
  const [form, setForm] = useState({
    full_name: '',
    email: '',
    phone: '',
    city: '',
    desired_job_title: '',
    employment_type: '',
    skills: '',
    resume_text: '',
  })
  const [resumeFile, setResumeFile] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  function updateField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setSubmitting(true)
    setMessage('')
    setError('')

    try {
      const payload = new FormData()
      Object.entries(form).forEach(([key, value]) => payload.append(key, value))
      if (resumeFile) {
        payload.append('resume_file', resumeFile)
      }

      const response = await fetch(`${API_BASE}/jobseekers`, {
        method: 'POST',
        body: payload,
      })

      const data = await response.json()

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to submit resume.')
      }

      setMessage('Your resume has been submitted successfully.')
      setForm({
        full_name: '',
        email: '',
        phone: '',
        city: '',
        desired_job_title: '',
        employment_type: '',
        skills: '',
        resume_text: '',
      })
      setResumeFile(null)
    } catch (submitError) {
      setError(submitError.message || 'Failed to submit resume.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <SectionHeader
        title="Submit Your Resume"
        subtitle="Apply once and let active employers review your profile."
      />

      <Card title="Candidate Profile">
        <form className="space-y-5" onSubmit={handleSubmit}>
          <div className="grid gap-5 md:grid-cols-2">
            <Field label="Full Name" required>
              <Input
                value={form.full_name}
                onChange={(e) => updateField('full_name', e.target.value)}
                placeholder="Jane Doe"
              />
            </Field>

            <Field label="Email Address" required>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => updateField('email', e.target.value)}
                placeholder="jane@example.com"
              />
            </Field>

            <Field label="Phone Number">
              <Input
                value={form.phone}
                onChange={(e) => updateField('phone', e.target.value)}
                placeholder="(252) 555-1234"
              />
            </Field>

            <Field label="City">
              <Input
                value={form.city}
                onChange={(e) => updateField('city', e.target.value)}
                placeholder="Tarboro, NC"
              />
            </Field>

            <Field label="Desired Job Title">
              <Input
                value={form.desired_job_title}
                onChange={(e) => updateField('desired_job_title', e.target.value)}
                placeholder="Production Supervisor"
              />
            </Field>

            <Field label="Employment Type">
              <Select
                value={form.employment_type}
                onChange={(e) => updateField('employment_type', e.target.value)}
              >
                <option value="">Select one</option>
                <option value="full-time">Full Time</option>
                <option value="part-time">Part Time</option>
                <option value="temporary">Temporary</option>
                <option value="contract">Contract</option>
                <option value="any">Any</option>
              </Select>
            </Field>
          </div>

          <Field label="Skills">
            <Textarea
              rows={4}
              value={form.skills}
              onChange={(e) => updateField('skills', e.target.value)}
              placeholder="Forklift, scheduling, customer service, welding..."
            />
          </Field>

          <Field label="Resume Summary">
            <Textarea
              rows={6}
              value={form.resume_text}
              onChange={(e) => updateField('resume_text', e.target.value)}
              placeholder="Tell employers about your experience, work history, and strengths..."
            />
          </Field>

          <Field label="Resume PDF">
            <Input
              type="file"
              accept=".pdf,application/pdf"
              onChange={(e) => setResumeFile(e.target.files?.[0] || null)}
              className="file:mr-3 file:rounded-xl file:border-0 file:bg-emerald-700 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white"
            />
          </Field>

          {message && (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              {message}
            </div>
          )}

          {error && (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-2xl bg-emerald-700 px-5 py-3 text-sm font-semibold text-white shadow-sm hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
          >
            {submitting ? 'Submitting...' : 'Submit Resume'}
          </button>
        </form>
      </Card>
    </div>
  )
}

function ListBusinessPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <SectionHeader
        title="Join as an Employer"
        subtitle="Create your employer account and start posting jobs to the TarboroJobs community."
      />

      <Card title="Employer Access">
        <div className="space-y-5">
          <p className="text-sm leading-6 text-slate-600">
            TarboroJobs employer access is managed through onboarding. Once your employer
            account is approved, you’ll be able to log in, post jobs, and review candidate
            resumes.
          </p>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="text-sm font-semibold text-slate-900">What you get</div>
            <ul className="mt-3 space-y-2 text-sm text-slate-600">
              <li>• Business profile listing</li>
              <li>• Employer dashboard access</li>
              <li>• Job posting management</li>
              <li>• Resume and candidate workflow tools</li>
            </ul>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <a
              href={SQUARE_EMPLOYER_PLAN_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center rounded-2xl bg-emerald-700 px-5 py-3 text-sm font-semibold text-white shadow-sm hover:bg-emerald-800"
            >
              Start Employer Plan
            </a>

            <a
              href="mailto:jobs@tarborojobs.com"
              className="inline-flex items-center justify-center rounded-2xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700 hover:border-slate-400"
            >
              Contact TarboroJobs
            </a>
          </div>
        </div>
      </Card>
    </div>
  )
}

export default function TarboroJobsHomepage() {
  const [currentPage, setCurrentPage] = useState(getInitialPage())
  const [jobs, setJobs] = useState([])
  const [businesses, setBusinesses] = useState([])
  const [jobsLoading, setJobsLoading] = useState(true)
  const [businessesLoading, setBusinessesLoading] = useState(true)
  const [employerSession, setEmployerSession] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [employerJobs, setEmployerJobs] = useState([])
  const [employerJobsLoading, setEmployerJobsLoading] = useState(false)
  const [editingJobId, setEditingJobId] = useState(null)

  const [candidateView, setCandidateView] = useState('all')

  const [employerStats, setEmployerStats] = useState({
    open_jobs: 0,
    total_resumes: 0,
    saved_candidates: 0,
    interviews_scheduled: 0,
    follow_ups_due: 0,
  })
  const [employerStatsLoading, setEmployerStatsLoading] = useState(false)

  const [resumeFilters, setResumeFilters] = useState({
    search: '',
    city: '',
    employment_type: '',
    candidate_status: '',
    page: 1,
    limit: 25,
  })
  const [resumePagination, setResumePagination] = useState({
    page: 1,
    limit: 25,
    total: 0,
    total_pages: 1,
    has_next: false,
    has_prev: false,
  })
  const [employerResumes, setEmployerResumes] = useState([])
  const [employerResumesLoading, setEmployerResumesLoading] = useState(false)
  const [selectedResume, setSelectedResume] = useState(null)
  const [candidateActions, setCandidateActions] = useState({})
  const [candidateActionLoading, setCandidateActionLoading] = useState(false)
  const [candidateActionMessage, setCandidateActionMessage] = useState('')
  const [candidateActionError, setCandidateActionError] = useState('')

  async function loadBusinesses() {
    try {
      setBusinessesLoading(true)
      const response = await fetch(`${API_BASE}/employers`)
      const data = await response.json()
      if (data.success) {
        setBusinesses(data.businesses || [])
      }
    } catch (error) {
      console.error('Failed to load businesses:', error)
    } finally {
      setBusinessesLoading(false)
    }
  }

  async function loadJobs() {
    try {
      setJobsLoading(true)
      const response = await fetch(`${API_BASE}/jobposts`)
      const data = await response.json()
      if (data.success) {
        setJobs(data.jobs || [])
      }
    } catch (error) {
      console.error('Failed to load jobs:', error)
    } finally {
      setJobsLoading(false)
    }
  }

  async function loadEmployerJobs(tokenOverride) {
    const token = tokenOverride || getStoredEmployerToken()

    if (!token) {
      setEmployerJobs([])
      return
    }

    try {
      setEmployerJobsLoading(true)
      const data = await apiLoadEmployerJobs(token)
      setEmployerJobs(data.jobs || [])
    } catch (error) {
      console.error('Failed to load employer jobs:', error)
      setEmployerJobs([])
    } finally {
      setEmployerJobsLoading(false)
    }
  }

  async function loadEmployerStats(tokenOverride) {
    const token = tokenOverride || getStoredEmployerToken()

    if (!token) {
      setEmployerStats({
        open_jobs: 0,
        total_resumes: 0,
        saved_candidates: 0,
        interviews_scheduled: 0,
        follow_ups_due: 0,
      })
      return
    }

    try {
      setEmployerStatsLoading(true)
      const data = await apiLoadEmployerStats(token)
      setEmployerStats(
        data.stats || {
          open_jobs: 0,
          total_resumes: 0,
          saved_candidates: 0,
          interviews_scheduled: 0,
          follow_ups_due: 0,
        }
      )
    } catch (error) {
      console.error('Failed to load employer stats:', error)
      setEmployerStats({
        open_jobs: 0,
        total_resumes: 0,
        saved_candidates: 0,
        interviews_scheduled: 0,
        follow_ups_due: 0,
      })
    } finally {
      setEmployerStatsLoading(false)
    }
  }

  async function loadEmployerResumes(tokenOverride, filterOverride = null, viewOverride = null) {
    const token = tokenOverride || getStoredEmployerToken()
    const filters = filterOverride || resumeFilters
    const activeView = viewOverride || candidateView

    if (!token) {
      setEmployerResumes([])
      return
    }

    try {
      setEmployerResumesLoading(true)

      const data =
        activeView === 'saved'
          ? await apiLoadSavedCandidates(token, filters)
          : await apiLoadEmployerResumes(token, filters)

      const resumes = data.resumes || []

      setEmployerResumes(resumes)

      const actionMap = {}
      resumes.forEach((resume) => {
        if (resume.candidate_action) {
          actionMap[resume.id] = resume.candidate_action
        }
      })
      setCandidateActions((prev) => ({ ...prev, ...actionMap }))

      setResumePagination(
        data.pagination || {
          page: 1,
          limit: 25,
          total: 0,
          total_pages: 1,
          has_next: false,
          has_prev: false,
        }
      )

      if (resumes.length === 0) {
        setSelectedResume(null)
      } else {
        setSelectedResume((prev) => resumes.find((item) => item.id === prev?.id) || resumes[0])
      }
    } catch (error) {
      console.error('Failed to load employer resumes:', error)
      setEmployerResumes([])
      setSelectedResume(null)
    } finally {
      setEmployerResumesLoading(false)
    }
  }

  async function loadEmployerSession(tokenOverride) {
    const token = tokenOverride || getStoredEmployerToken()

    if (!token) {
      setEmployerSession(null)
      setAuthLoading(false)
      return
    }

    try {
      const data = await apiLoadEmployerSession(token)
      setEmployerSession(data)

      await Promise.all([
        loadEmployerJobs(token),
        loadEmployerStats(token),
        loadEmployerResumes(token, resumeFilters, candidateView),
      ])
    } catch (error) {
      console.error('Failed to load employer session:', error)
      clearStoredEmployerToken()
      setEmployerSession(null)
    } finally {
      setAuthLoading(false)
    }
  }

  async function createEmployerJob(payload) {
    const token = getStoredEmployerToken()
    await apiCreateEmployerJob(token, payload)
    await Promise.all([
      loadEmployerJobs(token),
      loadEmployerStats(token),
      loadJobs(),
      loadBusinesses(),
    ])
  }

  async function updateEmployerJob(jobId, payload) {
    const token = getStoredEmployerToken()
    await apiUpdateEmployerJob(token, jobId, payload)
    await Promise.all([
      loadEmployerJobs(token),
      loadEmployerStats(token),
      loadJobs(),
      loadBusinesses(),
    ])
  }

  async function updateEmployerJobStatus(jobId, status) {
    const token = getStoredEmployerToken()
    await apiUpdateEmployerJobStatus(token, jobId, status)
    await Promise.all([
      loadEmployerJobs(token),
      loadEmployerStats(token),
      loadJobs(),
    ])
  }

  async function deleteEmployerJob(jobId) {
    const token = getStoredEmployerToken()
    await apiDeleteEmployerJob(token, jobId)

    if (editingJobId === jobId) {
      setEditingJobId(null)
    }

    await Promise.all([
      loadEmployerJobs(token),
      loadEmployerStats(token),
      loadJobs(),
      loadBusinesses(),
    ])
  }

  async function saveCandidateAction(jobSeekerId, payload) {
    const token = getStoredEmployerToken()
    setCandidateActionLoading(true)
    setCandidateActionMessage('')
    setCandidateActionError('')

    try {
      const data = await apiSaveCandidateAction(token, {
        job_seeker_id: jobSeekerId,
        status: payload.status || null,
        notes: payload.notes || null,
        contacted_at: payload.contacted_at || null,
        interview_at: payload.interview_at || null,
        hired_at: payload.hired_at || null,
        rejected_at: payload.rejected_at || null,
        next_follow_up_at: payload.next_follow_up_at || null,
      })

      if (data.action) {
        setCandidateActions((prev) => ({
          ...prev,
          [jobSeekerId]: data.action,
        }))
      }

      setCandidateActionMessage('Candidate workflow saved successfully.')
      await Promise.all([
        loadEmployerResumes(token, resumeFilters, candidateView),
        loadEmployerStats(token),
      ])
    } catch (error) {
      setCandidateActionError(error.message || 'Failed to save candidate action.')
    } finally {
      setCandidateActionLoading(false)
    }
  }

  function handleResumeFilterChange(key, value) {
    const next = {
      ...resumeFilters,
      [key]: value,
      page: 1,
    }

    setResumeFilters(next)
    loadEmployerResumes(getStoredEmployerToken(), next, candidateView)
  }

  function handleResumePageChange(nextPage) {
    if (nextPage < 1 || nextPage > resumePagination.total_pages) return

    const next = {
      ...resumeFilters,
      page: nextPage,
    }

    setResumeFilters(next)
    loadEmployerResumes(getStoredEmployerToken(), next, candidateView)
  }

  function handleCandidateViewChange(view) {
    const nextFilters = {
      ...resumeFilters,
      page: 1,
    }

    setCandidateView(view)
    setResumeFilters(nextFilters)
    loadEmployerResumes(getStoredEmployerToken(), nextFilters, view)
  }

  function handleLogout() {
    clearStoredEmployerToken()
    setEmployerSession(null)
    setEmployerJobs([])
    setEmployerResumes([])
    setSelectedResume(null)
    setCandidateActions({})
    setEditingJobId(null)
    setCandidateView('all')
    setEmployerStats({
      open_jobs: 0,
      total_resumes: 0,
      saved_candidates: 0,
      interviews_scheduled: 0,
      follow_ups_due: 0,
    })
    setCurrentPage('jobs')
  }

  useEffect(() => {
    loadBusinesses()
    loadJobs()
    loadEmployerSession()
  }, [])

  useEffect(() => {
    if (!authLoading && currentPage === 'employer-dashboard' && !employerSession) {
      setCurrentPage('employer-login')
    }
  }, [authLoading, currentPage, employerSession])

  return (
    <Shell
      currentPage={currentPage}
      setCurrentPage={setCurrentPage}
      employerSession={employerSession}
      onLogout={handleLogout}
    >
      {currentPage === 'jobs' && <JobsPage jobs={jobsLoading ? [] : jobs} />}
      {currentPage === 'businesses' && (
        <BusinessesPage setCurrentPage={setCurrentPage} businesses={businessesLoading ? [] : businesses} />
      )}
      {currentPage === 'submit-resume' && <SubmitResumePage />}
      {currentPage === 'list-business' && <ListBusinessPage />}
      {currentPage === 'employer-login' && (
        <EmployerLoginPage
          setCurrentPage={setCurrentPage}
          onLoginSuccess={loadEmployerSession}
          SectionHeader={SectionHeader}
          Card={Card}
          Field={Field}
          Input={Input}
        />
      )}
      {currentPage === 'employer-forgot-password' && (
        <EmployerForgotPasswordPage
          setCurrentPage={setCurrentPage}
          SectionHeader={SectionHeader}
          Card={Card}
          Field={Field}
          Input={Input}
        />
      )}
      {currentPage === 'employer-reset-password' && (
        <EmployerResetPasswordPage
          setCurrentPage={setCurrentPage}
          SectionHeader={SectionHeader}
          Card={Card}
          Field={Field}
          Input={Input}
        />
      )}
      {currentPage === 'employer-dashboard' && (
        <EmployerDashboardPage
          employerSession={employerSession}
          employerJobs={employerJobs}
          jobsLoading={employerJobsLoading}
          employerResumes={employerResumes}
          resumesLoading={employerResumesLoading}
          resumeFilters={resumeFilters}
          resumePagination={resumePagination}
          selectedResume={selectedResume}
          candidateActions={candidateActions}
          actionLoading={candidateActionLoading}
          actionMessage={candidateActionMessage}
          actionError={candidateActionError}
          candidateView={candidateView}
          onCandidateViewChange={handleCandidateViewChange}
          onResumeFilterChange={handleResumeFilterChange}
          onResumePageChange={handleResumePageChange}
          onSelectResume={setSelectedResume}
          onCreateJob={createEmployerJob}
          onUpdateJob={updateEmployerJob}
          onDeleteJob={deleteEmployerJob}
          onStartEditJob={setEditingJobId}
          onCancelEditJob={() => setEditingJobId(null)}
          editingJobId={editingJobId}
          onUpdateJobStatus={updateEmployerJobStatus}
          onSaveCandidateAction={saveCandidateAction}
          employerStats={employerStats}
          statsLoading={employerStatsLoading}
          Card={Card}
          Field={Field}
          Input={Input}
          Select={Select}
          Textarea={Textarea}
          SectionHeader={SectionHeader}
          employerJobTypes={employerJobTypes}
          employerPayTypes={employerPayTypes}
          employerResumeTypes={employerResumeTypes}
          candidateStatuses={candidateStatuses}
          fileBase={FILE_BASE}
          CandidateActionPanel={CandidateActionPanel}
        />
      )}
      {currentPage === 'employer-onboarding' && (
        <EmployerOnboardingPage
          onBusinessCreated={loadBusinesses}
          setCurrentPage={setCurrentPage}
          onAuthComplete={loadEmployerSession}
          SectionHeader={SectionHeader}
          Card={Card}
          Field={Field}
          Input={Input}
          Select={Select}
          Textarea={Textarea}
          employerIndustries={employerIndustries}
        />
      )}
    </Shell>
  )
}