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
  updateEmployerAccount as apiUpdateEmployerAccount,
  updateEmployerPassword as apiUpdateEmployerPassword,
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

function getInitialRoute() {
  const pathname = window.location.pathname || '/'
  const params = new URLSearchParams(window.location.search)
  const page = params.get('page')
  const token = params.get('token')

  const jobApplyMatch = pathname.match(/^\/jobs\/(\d+)\/apply\/?$/)
  if (jobApplyMatch) {
    return {
      page: 'job-apply',
      jobId: Number(jobApplyMatch[1]),
    }
  }

  const jobDetailMatch = pathname.match(/^\/jobs\/(\d+)\/?$/)
  if (jobDetailMatch) {
    return {
      page: 'job-detail',
      jobId: Number(jobDetailMatch[1]),
    }
  }

  if (page === 'employer-onboarding') return { page: 'employer-onboarding', jobId: null }
  if (page === 'employer-reset-password' && token) {
    return { page: 'employer-reset-password', jobId: null }
  }

  return { page: 'jobs', jobId: null }
}

function buildPublicPath(page, jobId = null) {
  if (page === 'job-detail' && jobId) return `/jobs/${jobId}`
  if (page === 'job-apply' && jobId) return `/jobs/${jobId}/apply`
  return '/'
}

function formatPostedDate(value) {
  if (!value) return 'Recently posted'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Recently posted'
  return date.toLocaleDateString()
}

function formatPostedDate(value) {
  if (!value) return 'Recently posted'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Recently posted'
  return date.toLocaleDateString()
}

function Shell({ currentPage, setCurrentPage, employerSession, onLogout, children }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  const navItems = [
    { key: 'jobs', label: 'Jobs', icon: Briefcase },
    { key: 'businesses', label: 'Businesses', icon: Building2 },
    { key: 'list-business', label: 'For Employers', icon: Landmark },
    employerSession
      ? { key: 'employer-dashboard', label: 'Dashboard', icon: LayoutDashboard }
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
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="fixed inset-0 -z-10 bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.14),transparent_28%),linear-gradient(180deg,#020617_0%,#0f172a_55%,#020617_100%)]" />

      <header className="sticky top-0 z-40 border-b border-slate-800/90 bg-slate-950/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-5">
          <button
            onClick={() => handleNavClick('jobs')}
            className="min-w-0 flex items-center gap-3 text-left"
          >
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-cyan-400/20 bg-cyan-400/10 text-cyan-300 shadow-[0_12px_30px_rgba(34,211,238,0.16)]">
              <MapPin className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="truncate text-lg font-semibold tracking-tight text-white sm:text-xl">
                TarboroJobs
              </div>
              <div className="truncate text-[11px] text-slate-400 sm:text-xs">
                Local jobs and employers around Tarboro
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
                        ? 'border-cyan-400/30 bg-cyan-400 text-slate-950 shadow-[0_12px_30px_rgba(34,211,238,0.18)]'
                        : 'border-slate-700 bg-slate-900/85 text-slate-300 hover:border-slate-600 hover:text-white'
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
                className="inline-flex items-center gap-2 rounded-2xl border border-slate-700 bg-slate-900/85 px-3.5 py-2 text-sm font-medium text-slate-300 transition hover:border-slate-600 hover:text-white"
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
            className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-700 bg-slate-900/85 text-slate-300 shadow-sm transition hover:border-slate-600 hover:text-white md:hidden"
          >
            {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>

        {mobileMenuOpen && (
          <div className="border-t border-slate-800 bg-slate-950/95 px-4 py-3 md:hidden">
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
                        ? 'border-cyan-400/30 bg-cyan-400 text-slate-950'
                        : 'border-slate-700 bg-slate-900/80 text-slate-300 hover:border-slate-600 hover:text-white'
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
                  className="mt-1 flex w-full items-center gap-3 rounded-2xl border border-slate-700 bg-slate-900/80 px-4 py-3 text-left text-sm font-medium text-slate-300 transition hover:border-slate-600 hover:text-white"
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
        <div className="mb-2 inline-flex rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-300">
          Midnight Civic
        </div>
        <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          {title}
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400 sm:text-base">
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
    <div className="mb-5 rounded-[30px] border border-slate-800 bg-slate-900/85 p-3 shadow-[0_18px_60px_rgba(2,6,23,0.24)] sm:mb-6 sm:p-4">
      <div className="grid gap-3 lg:grid-cols-[1fr_220px_190px]">
        <div className="flex min-h-[54px] items-center gap-3 rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3">
          <Search className="h-4 w-4 shrink-0 text-slate-500" />
          <input
            className="w-full bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-500"
            placeholder={placeholder}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="flex min-h-[54px] items-center gap-2 rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3">
          <ListFilter className="h-4 w-4 shrink-0 text-slate-500" />
          <select
            className="w-full bg-transparent text-sm text-slate-100 outline-none"
            value={industry}
            onChange={(e) => setIndustry(e.target.value)}
          >
            {industries.map((option) => (
              <option key={option}>{option}</option>
            ))}
          </select>
        </div>

        {showType ? (
          <div className="flex min-h-[54px] items-center gap-2 rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3">
            <Briefcase className="h-4 w-4 shrink-0 text-slate-500" />
            <select
              className="w-full bg-transparent text-sm text-slate-100 outline-none"
              value={type}
              onChange={(e) => setType(e.target.value)}
            >
              {jobTypes.map((option) => (
                <option key={option}>{option}</option>
              ))}
            </select>
          </div>
        ) : (
          <div className="flex min-h-[54px] items-center justify-center rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-sm font-medium text-slate-300">
            Local-first directory
          </div>
        )}
      </div>
    </div>
  )
}

function Field({ label, required = false, children }) {
  return (
    <label className="block">
      <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
        {label} {required && <span className="text-rose-400">*</span>}
      </div>
      {children}
    </label>
  )
}

function Input({ className = '', ...props }) {
  return (
    <input
      {...props}
      className={`w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-cyan-400 ${className}`}
    />
  )
}

function Select({ className = '', ...props }) {
  return (
    <select
      {...props}
      className={`w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-cyan-400 ${className}`}
    />
  )
}

function Textarea({ className = '', ...props }) {
  return (
    <textarea
      {...props}
      className={`w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-cyan-400 ${className}`}
    />
  )
}

function Card({ title, children }) {
  return (
    <section className="rounded-[30px] border border-slate-800 bg-slate-900/85 p-4 shadow-[0_18px_60px_rgba(2,6,23,0.24)] sm:p-6">
      <h2 className="mb-4 text-lg font-semibold text-white sm:mb-5">{title}</h2>
      <div className="space-y-5">{children}</div>
    </section>
  )
}

function StatStrip({ items }) {
  return (
    <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => (
        <div
          key={item.label}
          className="rounded-[26px] border border-slate-800 bg-slate-900/70 p-4 shadow-[0_16px_40px_rgba(2,6,23,0.22)]"
        >
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
            {item.label}
          </div>
          <div className="mt-2 text-3xl font-semibold tracking-tight text-white">{item.value}</div>
          {item.note ? <div className="mt-1 text-xs text-slate-500">{item.note}</div> : null}
        </div>
      ))}
    </div>
  )
}

function EmptyState({ icon: Icon, title, body }) {
  return (
    <div className="rounded-[30px] border border-slate-800 bg-slate-900/85 p-8 text-center shadow-[0_18px_60px_rgba(2,6,23,0.24)] sm:p-10">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-3xl border border-slate-700 bg-slate-950/70 text-cyan-300">
        <Icon className="h-7 w-7" />
      </div>
      <h3 className="text-lg font-semibold text-white">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-slate-400">{body}</p>
    </div>
  )
}

<<<<<<< HEAD
function JobsPage({ jobs, loading }) {
=======
function formatExpiryDate(value) {
  if (!value) return 'Open until filled or manually closed'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Open until filled or manually closed'
  return date.toLocaleDateString()
}

function JobsPage({ jobs, loading, onViewJob }) {
>>>>>>> a7ef58f (Add job detail pages, apply flow, employer scoping, and ATS scoring)
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

  const activeCities = new Set(jobs.map((job) => job.city).filter(Boolean)).size

  return (
    <div>
      <SectionHeader
        title="Local Job Board"
<<<<<<< HEAD
        subtitle="A cleaner phone-first job board for Tarboro, nearby towns, and active local employers."
=======
        subtitle="Click into each listing for the full job description, apply flow, and employer-specific application routing."
>>>>>>> a7ef58f (Add job detail pages, apply flow, employer scoping, and ATS scoring)
      />

      <div className="mb-5 grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="relative overflow-hidden rounded-[32px] border border-slate-800 bg-slate-900/90 p-5 shadow-[0_22px_70px_rgba(2,6,23,0.28)] sm:p-6">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.18),transparent_30%)]" />
          <div className="relative">
            <div className="mb-3 inline-flex rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-300">
              Find work close to home
            </div>
            <h2 className="max-w-2xl text-3xl font-semibold tracking-tight text-white sm:text-4xl">
<<<<<<< HEAD
              Local jobs without the clutter.
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400 sm:text-base">
              Browse current openings, filter by industry, and keep the experience clean on both desktop and phone.
=======
              Browse local jobs, then open the full posting.
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400 sm:text-base">
              Each posting now has its own detail page so applicants can review the role first and then apply directly to that exact employer and job.
>>>>>>> a7ef58f (Add job detail pages, apply flow, employer scoping, and ATS scoring)
            </p>
          </div>
        </div>

        <div className="rounded-[32px] border border-slate-800 bg-slate-900/85 p-5 shadow-[0_22px_70px_rgba(2,6,23,0.24)] sm:p-6">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Board snapshot</div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
              <div className="text-xs text-slate-400">Open jobs</div>
              <div className="mt-1 text-2xl font-semibold text-white">{jobs.length}</div>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
              <div className="text-xs text-slate-400">Cities</div>
              <div className="mt-1 text-2xl font-semibold text-white">{activeCities || 0}</div>
            </div>
          </div>
          <div className="mt-4 text-sm leading-6 text-slate-400">
<<<<<<< HEAD
            The goal here is simple: faster scanning, stronger contrast, and better readability on smaller screens.
=======
            Listings stay cleaner when each job has one source of truth for the description, expiration window, and apply flow.
>>>>>>> a7ef58f (Add job detail pages, apply flow, employer scoping, and ATS scoring)
          </div>
        </div>
      </div>

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

      {loading ? (
        <StatStrip
          items={[
            { label: 'Loading', value: '…', note: 'Fetching current jobs' },
            { label: 'Board', value: '…', note: 'Refreshing employers' },
            { label: 'Filter', value: '…', note: 'Preparing results' },
            { label: 'Preview', value: '…', note: 'Please wait' },
          ]}
        />
      ) : filteredJobs.length === 0 ? (
        <EmptyState
          icon={Briefcase}
          title="No jobs found"
          body="Try adjusting your search or filters to see more local opportunities."
        />
      ) : (
        <div className="grid gap-4 sm:gap-5">
          {filteredJobs.map((job) => (
            <article
              key={job.id}
<<<<<<< HEAD
              className="rounded-[30px] border border-slate-800 bg-slate-900/85 p-4 shadow-[0_18px_60px_rgba(2,6,23,0.24)] sm:p-6"
=======
              role="button"
              tabIndex={0}
              onClick={() => onViewJob(job.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  onViewJob(job.id)
                }
              }}
              className="cursor-pointer rounded-[30px] border border-slate-800 bg-slate-900/85 p-4 shadow-[0_18px_60px_rgba(2,6,23,0.24)] transition hover:border-cyan-400/25 sm:p-6"
>>>>>>> a7ef58f (Add job detail pages, apply flow, employer scoping, and ATS scoring)
            >
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0">
                  <div className="mb-2 inline-flex rounded-full border border-slate-700 bg-slate-950/60 px-3 py-1 text-[11px] font-medium text-slate-300">
                    {job.industry || 'Local employer'}
                  </div>
                  <h2 className="text-2xl font-semibold tracking-tight text-white sm:text-[28px]">
                    {job.title}
                  </h2>
                  <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-slate-400">
                    <span className="inline-flex items-center gap-1.5 break-words">
                      <Building2 className="h-4 w-4 shrink-0 text-cyan-300" />
                      {job.company}
                    </span>
                    {job.city && (
                      <span className="inline-flex items-center gap-1.5">
                        <MapPin className="h-4 w-4 shrink-0 text-cyan-300" />
                        {job.city}
                      </span>
                    )}
                    {job.type && (
                      <span className="inline-flex items-center gap-1.5">
                        <Briefcase className="h-4 w-4 shrink-0 text-cyan-300" />
                        {humanizeJobType(job.type)}
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1.5">
                      <Clock3 className="h-4 w-4 shrink-0 text-cyan-300" />
                      {formatPostedDate(job.posted)}
                    </span>
                  </div>
                </div>

                {job.pay && (
                  <div className="self-start rounded-2xl border border-cyan-400/20 bg-cyan-400/10 px-4 py-2 text-sm font-semibold text-cyan-300">
                    {job.pay}
                  </div>
                )}
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {job.experience_level && (
                  <span className="rounded-full border border-slate-700 bg-slate-950/60 px-3 py-1 text-xs font-medium text-slate-300">
                    {job.experience_level}
                  </span>
                )}
                <span className="rounded-full border border-slate-700 bg-slate-950/60 px-3 py-1 text-xs font-medium text-slate-300">
<<<<<<< HEAD
                  TarboroJobs listing
=======
                  Expires {formatExpiryDate(job.expires_at)}
>>>>>>> a7ef58f (Add job detail pages, apply flow, employer scoping, and ATS scoring)
                </span>
              </div>

              {job.description && (
<<<<<<< HEAD
                <p className="mt-4 whitespace-pre-line break-words text-sm leading-6 text-slate-300">
=======
                <p className="mt-4 line-clamp-4 whitespace-pre-line break-words text-sm leading-6 text-slate-300">
>>>>>>> a7ef58f (Add job detail pages, apply flow, employer scoping, and ATS scoring)
                  {job.description}
                </p>
              )}

              <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                <div className="text-xs text-slate-500">Open the job page to review the full posting and apply.</div>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    onViewJob(job.id)
                  }}
                  className="rounded-2xl bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300"
                >
                  View job
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}

<<<<<<< HEAD
=======
function JobDetailPage({ job, loading, error, onBack, onApply }) {
  if (loading) {
    return (
      <div className="mx-auto max-w-5xl">
        <SectionHeader title="Job Details" subtitle="Loading the full job posting..." />
        <Card title="Please wait">
          <p className="text-sm text-slate-400">Fetching the latest posting details.</p>
        </Card>
      </div>
    )
  }

  if (error || !job) {
    return (
      <div className="mx-auto max-w-5xl">
        <SectionHeader title="Job Details" subtitle="This job could not be loaded." />
        <Card title="Job unavailable">
          <div className="space-y-4">
            <p className="text-sm leading-6 text-slate-400">{error || 'This posting may have expired or been removed.'}</p>
            <button
              type="button"
              onClick={onBack}
              className="rounded-2xl bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300"
            >
              Back to jobs
            </button>
          </div>
        </Card>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-4">
        <button
          type="button"
          onClick={onBack}
          className="rounded-2xl border border-slate-700 bg-slate-900/80 px-4 py-2 text-sm font-medium text-slate-200 transition hover:border-slate-600"
        >
          Back to jobs
        </button>
      </div>

      <SectionHeader
        title={job.title}
        subtitle={`${job.company} • ${job.city || 'Tarboro area'}${job.type ? ` • ${humanizeJobType(job.type)}` : ''}`}
        action={
          <button
            type="button"
            onClick={onApply}
            className="w-full rounded-2xl bg-cyan-400 px-5 py-3 text-sm font-semibold text-slate-950 shadow-[0_12px_30px_rgba(34,211,238,0.18)] transition hover:bg-cyan-300 md:w-auto"
          >
            Apply for this job
          </button>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="space-y-5">
          <Card title="Job Description">
            <div className="space-y-4 text-sm leading-7 text-slate-300">
              <div className="flex flex-wrap gap-2 text-xs text-slate-400">
                <span className="rounded-full border border-slate-700 bg-slate-950/60 px-3 py-1">Posted {formatPostedDate(job.posted)}</span>
                <span className="rounded-full border border-slate-700 bg-slate-950/60 px-3 py-1">Expires {formatExpiryDate(job.expires_at)}</span>
                {job.industry ? <span className="rounded-full border border-slate-700 bg-slate-950/60 px-3 py-1">{job.industry}</span> : null}
                {job.experience_level ? <span className="rounded-full border border-slate-700 bg-slate-950/60 px-3 py-1">{job.experience_level}</span> : null}
              </div>
              <p className="whitespace-pre-line break-words text-sm leading-7 text-slate-300">{job.description}</p>
            </div>
          </Card>
        </div>

        <div className="space-y-5">
          <Card title="At a glance">
            <div className="space-y-3 text-sm text-slate-300">
              <div className="rounded-2xl border border-slate-800 bg-slate-950/60 px-4 py-3">
                <div className="text-xs uppercase tracking-[0.16em] text-slate-500">Company</div>
                <div className="mt-1 font-medium text-white">{job.company}</div>
              </div>
              {job.city ? (
                <div className="rounded-2xl border border-slate-800 bg-slate-950/60 px-4 py-3">
                  <div className="text-xs uppercase tracking-[0.16em] text-slate-500">Location</div>
                  <div className="mt-1 font-medium text-white">{job.city}</div>
                </div>
              ) : null}
              {job.pay ? (
                <div className="rounded-2xl border border-slate-800 bg-slate-950/60 px-4 py-3">
                  <div className="text-xs uppercase tracking-[0.16em] text-slate-500">Pay</div>
                  <div className="mt-1 font-medium text-white">{job.pay}</div>
                </div>
              ) : null}
              {job.type ? (
                <div className="rounded-2xl border border-slate-800 bg-slate-950/60 px-4 py-3">
                  <div className="text-xs uppercase tracking-[0.16em] text-slate-500">Employment Type</div>
                  <div className="mt-1 font-medium text-white">{humanizeJobType(job.type)}</div>
                </div>
              ) : null}
            </div>
          </Card>

          <Card title="Apply through TarboroJobs">
            <div className="space-y-3 text-sm leading-6 text-slate-400">
              <p>Your application is tied to this exact job and routed only to the employer that owns this posting.</p>
              <p>PDF resumes only. The system also runs a simple ATS-style comparison so the employer can see how closely the resume matches the posting.</p>
              <button
                type="button"
                onClick={onApply}
                className="w-full rounded-2xl bg-cyan-400 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300"
              >
                Continue to application
              </button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}

>>>>>>> a7ef58f (Add job detail pages, apply flow, employer scoping, and ATS scoring)
function BusinessesPage({ setCurrentPage, businesses, loading }) {
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
        subtitle="Browse employers connected to TarboroJobs and give local businesses a stronger presence online."
        action={
          <button
            onClick={() => setCurrentPage('list-business')}
            className="w-full rounded-2xl bg-cyan-400 px-4 py-3 text-sm font-semibold text-slate-950 shadow-[0_12px_30px_rgba(34,211,238,0.18)] transition hover:bg-cyan-300 md:w-auto md:py-2.5"
          >
            Join as Employer
          </button>
        }
      />

      <StatStrip
        items={[
          { label: 'Business profiles', value: loading ? '…' : businesses.length, note: 'Local employers and directories' },
          { label: 'Hiring now', value: loading ? '…' : businesses.filter((item) => item.hiring).length, note: 'Actively recruiting' },
          { label: 'Visibility', value: '24/7', note: 'Accessible on phone and desktop' },
          { label: 'Goal', value: 'Local', note: 'Built for Tarboro first' },
        ]}
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

      {loading ? null : filteredBusinesses.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No businesses found"
          body="Try adjusting your search or industry filter to see more employers."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredBusinesses.map((business) => (
            <article
              key={business.id}
              className="rounded-[30px] border border-slate-800 bg-slate-900/85 p-4 shadow-[0_18px_60px_rgba(2,6,23,0.24)] sm:p-6"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-2xl font-semibold tracking-tight text-white">
                    {business.name}
                  </h2>
                  <p className="mt-1 text-sm text-slate-400">
                    {business.industry || 'Local Business'}
                  </p>
                </div>

                {business.hiring && (
                  <span className="shrink-0 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-xs font-semibold text-cyan-300">
                    Hiring
                  </span>
                )}
              </div>

              <div className="mt-4 space-y-2 text-sm text-slate-300">
                {business.city && (
                  <div className="inline-flex items-center gap-2 break-words">
                    <MapPin className="h-4 w-4 shrink-0 text-cyan-300" />
                    {business.city}
                  </div>
                )}
                {business.phone && (
                  <div className="flex items-center gap-2 break-words">
                    <Phone className="h-4 w-4 shrink-0 text-cyan-300" />
                    {business.phone}
                  </div>
                )}
                {business.email && (
                  <div className="flex items-center gap-2 break-all">
                    <Mail className="h-4 w-4 shrink-0 text-cyan-300" />
                    {business.email}
                  </div>
                )}
                {business.website && (
                  <a
                    href={business.website.startsWith('http') ? business.website : `https://${business.website}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-2 break-all text-cyan-300 hover:underline"
                  >
                    <Globe className="h-4 w-4 shrink-0" />
                    Visit website
                  </a>
                )}
              </div>

              {business.description && (
                <p className="mt-4 break-words text-sm leading-6 text-slate-400">
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

function SubmitResumePage({ job, loading, error, onBack }) {
  const [form, setForm] = useState({
    full_name: '',
    email: '',
    phone: '',
    city: '',
    desired_job_title: job?.title || '',
    employment_type: job?.type || '',
    skills: '',
    resume_text: '',
  })
  const [resumeFile, setResumeFile] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    setForm((prev) => ({
      ...prev,
      desired_job_title: prev.desired_job_title || job?.title || '',
      employment_type: prev.employment_type || job?.type || '',
    }))
  }, [job])

  function updateField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function handleSubmit(event) {
    event.preventDefault()

    if (!job?.id) {
      setErrorMessage('Please start from a live job posting before applying.')
      return
    }

    setSubmitting(true)
    setMessage('')
    setErrorMessage('')

    try {
      const payload = new FormData()
      Object.entries(form).forEach(([key, value]) => payload.append(key, value))

      if (resumeFile) {
        payload.append('resume_file', resumeFile)
      }

      const response = await fetch(`${API_BASE}/jobposts/${job.id}/apply`, {
        method: 'POST',
        body: payload,
      })

      const data = await response.json()

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to submit application.')
      }

      setMessage(`Your application for ${job.title} has been submitted successfully.`)
      setForm({
        full_name: '',
        email: '',
        phone: '',
        city: '',
        desired_job_title: job.title || '',
        employment_type: job.type || '',
        skills: '',
        resume_text: '',
      })
      setResumeFile(null)
    } catch (submitError) {
      setErrorMessage(submitError.message || 'Failed to submit application.')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl">
        <SectionHeader title="Apply for this job" subtitle="Loading the job before we send your application..." />
        <Card title="Please wait">
          <p className="text-sm text-slate-400">Fetching the latest job details.</p>
        </Card>
      </div>
    )
  }

  if (error || !job) {
    return (
      <div className="mx-auto max-w-4xl">
        <SectionHeader title="Apply for this job" subtitle="This posting is unavailable." />
        <Card title="Application unavailable">
          <div className="space-y-4">
            <p className="text-sm leading-6 text-slate-400">{error || 'This job may have expired or been removed.'}</p>
            <button
              type="button"
              onClick={onBack}
              className="rounded-2xl bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300"
            >
              Back to job page
            </button>
          </div>
        </Card>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl">
<<<<<<< HEAD
      <SectionHeader
        title="Submit Your Resume"
        subtitle="Apply once, keep it simple, and let active employers review your profile from a cleaner phone-friendly flow."
=======
      <div className="mb-4">
        <button
          type="button"
          onClick={onBack}
          className="rounded-2xl border border-slate-700 bg-slate-900/80 px-4 py-2 text-sm font-medium text-slate-200 transition hover:border-slate-600"
        >
          Back to job page
        </button>
      </div>

      <SectionHeader
        title={`Apply for ${job.title}`}
        subtitle={`${job.company} • ${job.city || 'Tarboro area'}`}
>>>>>>> a7ef58f (Add job detail pages, apply flow, employer scoping, and ATS scoring)
      />

      <div className="mb-5 grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
        <div className="rounded-[30px] border border-slate-800 bg-slate-900/85 p-5 shadow-[0_18px_60px_rgba(2,6,23,0.24)] sm:p-6">
<<<<<<< HEAD
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-300">What to include</div>
          <ul className="mt-4 space-y-3 text-sm leading-6 text-slate-300">
            <li>• Current contact information</li>
            <li>• Your target job title or work type</li>
            <li>• Skills employers can scan quickly</li>
            <li>• A resume PDF if you have one ready</li>
          </ul>
        </div>
        <div className="rounded-[30px] border border-slate-800 bg-slate-900/85 p-5 shadow-[0_18px_60px_rgba(2,6,23,0.24)] sm:p-6">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Why this is better</div>
          <p className="mt-4 text-sm leading-6 text-slate-400">
            The old version felt bulky and dated. This version keeps the same function, but the layout is easier to fill out on a phone and visually matches the rest of the site.
          </p>
        </div>
      </div>

      <Card title="Candidate Profile">
=======
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-300">What to know</div>
          <ul className="mt-4 space-y-3 text-sm leading-6 text-slate-300">
            <li>• Your application is tied to this exact job ID</li>
            <li>• Only the employer who posted this job can review it</li>
            <li>• PDF resumes only for the first ATS pass</li>
            <li>• The ATS result is a helper, not an automatic rejection</li>
          </ul>
        </div>
        <div className="rounded-[30px] border border-slate-800 bg-slate-900/85 p-5 shadow-[0_18px_60px_rgba(2,6,23,0.24)] sm:p-6">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Job snapshot</div>
          <div className="mt-4 space-y-3 text-sm leading-6 text-slate-300">
            <p><span className="font-semibold text-white">Company:</span> {job.company}</p>
            {job.pay ? <p><span className="font-semibold text-white">Pay:</span> {job.pay}</p> : null}
            {job.type ? <p><span className="font-semibold text-white">Type:</span> {humanizeJobType(job.type)}</p> : null}
            <p className="text-slate-400">Posted {formatPostedDate(job.posted)} • Expires {formatExpiryDate(job.expires_at)}</p>
          </div>
        </div>
      </div>

      <Card title="Application Form">
>>>>>>> a7ef58f (Add job detail pages, apply flow, employer scoping, and ATS scoring)
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
                placeholder={job.title}
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
              placeholder="Networking, help desk, project management, customer support..."
            />
          </Field>

          <Field label="Optional Resume Highlights">
            <Textarea
              rows={5}
              value={form.resume_text}
              onChange={(e) => updateField('resume_text', e.target.value)}
              placeholder="You can add a few highlights here in case your PDF formatting is hard to parse."
            />
          </Field>

          <Field label="Resume PDF" required>
            <Input
              type="file"
              accept=".pdf,application/pdf"
              onChange={(e) => setResumeFile(e.target.files?.[0] || null)}
              className="file:mr-3 file:rounded-xl file:border-0 file:bg-cyan-400 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-950"
            />
          </Field>

          {message && (
            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
              {message}
            </div>
          )}

<<<<<<< HEAD
          {error && (
            <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
              {error}
=======
          {errorMessage && (
            <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
              {errorMessage}
>>>>>>> a7ef58f (Add job detail pages, apply flow, employer scoping, and ATS scoring)
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-2xl bg-cyan-400 px-5 py-3 text-sm font-semibold text-slate-950 shadow-[0_12px_30px_rgba(34,211,238,0.18)] transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
          >
            {submitting ? 'Submitting...' : 'Submit Application'}
          </button>
        </form>
      </Card>
    </div>
  )
}

function ListBusinessPage() {
  return (
    <div className="mx-auto max-w-4xl">
      <SectionHeader
        title="Join as an Employer"
        subtitle="Create your employer account, publish jobs, and manage candidates from the new Midnight Civic dashboard."
      />

      <div className="mb-5 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-[30px] border border-slate-800 bg-slate-900/90 p-5 shadow-[0_18px_60px_rgba(2,6,23,0.24)] sm:p-6">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-300">Employer access</div>
          <p className="mt-4 text-sm leading-6 text-slate-300">
            TarboroJobs employer access is handled through onboarding. Once approved, you can manage your business profile, post jobs, and review resumes in one place.
          </p>
        </div>
        <div className="rounded-[30px] border border-slate-800 bg-slate-900/85 p-5 shadow-[0_18px_60px_rgba(2,6,23,0.24)] sm:p-6">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">What you get</div>
          <ul className="mt-4 space-y-3 text-sm leading-6 text-slate-300">
            <li>• Business profile listing</li>
            <li>• Employer dashboard access</li>
            <li>• Job posting management</li>
            <li>• Resume and candidate workflow tools</li>
          </ul>
        </div>
      </div>

      <Card title="Employer Plan">
        <div className="space-y-5">
          <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
            <div className="text-sm font-semibold text-white">Built for a cleaner rollout</div>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              This page now matches the rest of the site visually so the employer side no longer feels disconnected from the public side.
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <a
              href={SQUARE_EMPLOYER_PLAN_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center rounded-2xl bg-cyan-400 px-5 py-3 text-sm font-semibold text-slate-950 shadow-[0_12px_30px_rgba(34,211,238,0.18)] transition hover:bg-cyan-300"
            >
              Start Employer Plan
            </a>

            <a
              href="mailto:jobs@tarborojobs.com"
              className="inline-flex items-center justify-center rounded-2xl border border-slate-700 bg-slate-950/60 px-5 py-3 text-sm font-semibold text-slate-200 transition hover:border-slate-600"
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
  const initialRoute = getInitialRoute()
  const [currentPage, setCurrentPage] = useState(initialRoute.page)
  const [selectedPublicJobId, setSelectedPublicJobId] = useState(initialRoute.jobId)
  const [jobs, setJobs] = useState([])
  const [businesses, setBusinesses] = useState([])
  const [jobsLoading, setJobsLoading] = useState(true)
  const [businessesLoading, setBusinessesLoading] = useState(true)
  const [publicJobDetail, setPublicJobDetail] = useState(null)
  const [publicJobLoading, setPublicJobLoading] = useState(false)
  const [publicJobError, setPublicJobError] = useState('')
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

  function setBrowserLocation(page, jobId = null, options = {}) {
    if (!['jobs', 'job-detail', 'job-apply'].includes(page)) return

    const nextPath = buildPublicPath(page, jobId)
    const currentPath = `${window.location.pathname}${window.location.search}`
    if (currentPath === nextPath) return

    const method = options.replace ? 'replaceState' : 'pushState'
    window.history[method]({}, '', nextPath)
  }

  function navigateToPage(page, jobId = null, options = {}) {
    setCurrentPage(page)
    setSelectedPublicJobId(jobId)
    setPublicJobError('')

    if (page === 'jobs') {
      setPublicJobDetail(null)
      setBrowserLocation('jobs', null, options)
      return
    }

    if (page === 'job-detail' || page === 'job-apply') {
      setBrowserLocation(page, jobId, options)
    }
  }

  function handleShellPageChange(page) {
    if (page === 'jobs') {
      navigateToPage('jobs', null)
      return
    }

    setCurrentPage(page)
    setSelectedPublicJobId(null)
    setPublicJobDetail(null)
    setPublicJobError('')
    window.history.pushState({}, '', '/')
  }

  async function loadPublicJobDetail(jobId) {
    if (!jobId) {
      setPublicJobDetail(null)
      return
    }

    try {
      setPublicJobLoading(true)
      setPublicJobError('')
      const response = await fetch(`${API_BASE}/jobposts/${jobId}`)
      const data = await response.json()

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to load job details.')
      }

      setPublicJobDetail(data.job || null)
    } catch (error) {
      setPublicJobDetail(null)
      setPublicJobError(error.message || 'Failed to load job details.')
    } finally {
      setPublicJobLoading(false)
    }
  }

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

  async function updateEmployerAccount(payload) {
    const token = getStoredEmployerToken()
    await apiUpdateEmployerAccount(token, payload)
    await Promise.all([loadEmployerSession(token), loadBusinesses()])
  }

  async function updateEmployerPassword(payload) {
    const token = getStoredEmployerToken()
    await apiUpdateEmployerPassword(token, payload)
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
    navigateToPage('jobs', null, { replace: true })
  }

  useEffect(() => {
    loadBusinesses()
    loadJobs()
    loadEmployerSession()
  }, [])

  useEffect(() => {
    function handlePopState() {
      const route = getInitialRoute()
      setCurrentPage(route.page)
      setSelectedPublicJobId(route.jobId)
      setPublicJobError('')
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  useEffect(() => {
    if (!selectedPublicJobId || !['job-detail', 'job-apply'].includes(currentPage)) {
      return
    }

    loadPublicJobDetail(selectedPublicJobId)
  }, [currentPage, selectedPublicJobId])

  useEffect(() => {
    if (!authLoading && currentPage === 'employer-dashboard' && !employerSession) {
      setCurrentPage('employer-login')
    }
  }, [authLoading, currentPage, employerSession])

  return (
    <Shell
      currentPage={currentPage}
      setCurrentPage={handleShellPageChange}
      employerSession={employerSession}
      onLogout={handleLogout}
    >
<<<<<<< HEAD
      {currentPage === 'jobs' && <JobsPage jobs={jobs} loading={jobsLoading} />}
      {currentPage === 'businesses' && (
        <BusinessesPage
          setCurrentPage={setCurrentPage}
          businesses={businesses}
          loading={businessesLoading}
        />
=======
      {currentPage === 'jobs' && (
        <JobsPage jobs={jobs} loading={jobsLoading} onViewJob={(jobId) => navigateToPage('job-detail', jobId)} />
      )}
      {currentPage === 'job-detail' && (
        <JobDetailPage
          job={publicJobDetail}
          loading={publicJobLoading}
          error={publicJobError}
          onBack={() => navigateToPage('jobs', null)}
          onApply={() => navigateToPage('job-apply', selectedPublicJobId)}
        />
      )}
      {currentPage === 'businesses' && (
        <BusinessesPage
          setCurrentPage={handleShellPageChange}
          businesses={businesses}
          loading={businessesLoading}
        />
      )}
      {currentPage === 'submit-resume' && (
        <SubmitResumePage
          job={publicJobDetail}
          loading={publicJobLoading}
          error={publicJobError}
          onBack={() => navigateToPage(selectedPublicJobId ? 'job-detail' : 'jobs', selectedPublicJobId || null)}
        />
      )}
      {currentPage === 'job-apply' && (
        <SubmitResumePage
          job={publicJobDetail}
          loading={publicJobLoading}
          error={publicJobError}
          onBack={() => navigateToPage('job-detail', selectedPublicJobId)}
        />
>>>>>>> a7ef58f (Add job detail pages, apply flow, employer scoping, and ATS scoring)
      )}
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
          onUpdateEmployerAccount={updateEmployerAccount}
          onUpdateEmployerPassword={updateEmployerPassword}
          employerStats={employerStats}
          statsLoading={employerStatsLoading}
          Card={Card}
          Field={Field}
          Input={Input}
          Select={Select}
          Textarea={Textarea}
          SectionHeader={SectionHeader}
          employerIndustries={employerIndustries}
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