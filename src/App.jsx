import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
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
  ShieldCheck,
  Sparkles,
  FileText,
  BookOpen,
  UserRound,
  X,
} from 'lucide-react'
import {
  loadEmployerSession as apiLoadEmployerSession,
  updateEmployerAccount as apiUpdateEmployerAccount,
  updateEmployerPassword as apiUpdateEmployerPassword,
  loadEmployerJobs as apiLoadEmployerJobs,
  loadEmployerStats as apiLoadEmployerStats,
  loadEmployerResumes as apiLoadEmployerResumes,
  loadReviewedCandidates as apiLoadReviewedCandidates,
  createEmployerJob as apiCreateEmployerJob,
  updateEmployerJob as apiUpdateEmployerJob,
  updateEmployerJobStatus as apiUpdateEmployerJobStatus,
  deleteEmployerJob as apiDeleteEmployerJob,
  saveCandidateAction as apiSaveCandidateAction,
  EMPLOYER_AUTH_EXPIRED_EVENT,
} from './employer/api'
import {
  getStoredEmployerToken,
  setStoredEmployerToken,
  clearStoredEmployerToken,
} from './employer/auth'
import {
  loadAdminSession as apiLoadAdminSession,
  loadAdminEmployers as apiLoadAdminEmployers,
  loadAdminJobs as apiLoadAdminJobs,
  loadAdminTokens as apiLoadAdminTokens,
  createAdminOnboardingToken as apiCreateAdminOnboardingToken,
  approveAdminEmployer as apiApproveAdminEmployer,
  deactivateAdminEmployer as apiDeactivateAdminEmployer,
  reactivateAdminEmployer as apiReactivateAdminEmployer,
  revokeAdminToken as apiRevokeAdminToken,
  deleteAdminJob as apiDeleteAdminJob,
} from './admin/api'
import {
  getStoredAdminApiKey,
  clearStoredAdminApiKey,
} from './admin/auth'
import { humanizeJobType } from './employer/utils'
import ResumeCheckerPage from './resumeChecker/ResumeCheckerPage'
import CoverLetterPage from './coverLetter/CoverLetterPage'
import InterviewPrepPage from './interviewPrep/InterviewPrepPage'
import BundlePage from './bundle/BundlePage'
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
import { EmployerJobPaidPage, EmployerPlanUpgradedPage, EmployerPricing, EmployerSignupForm, EmployerVerifyPage } from './employer/SelfServe'
import AdminLoginPage from './admin/AdminLoginPage'
import AdminDashboardPage from './admin/AdminDashboardPage'
import { track } from './lib/track'
import JobAlertSignup from './alerts/JobAlertSignup'
import AlertPage from './alerts/AlertPages'
import LandingLinks from './LandingLinks'
import ShareButtons from './share/ShareButtons'
import { OneClickApply, SaveJobButton, SeekerJobsPage, SeekerProfilePage, SeekerSignInPage, SeekerVerifyPage } from './seeker/SeekerPages'
import { useSeeker } from './seeker/session'
import { findLandingPage, landingJobs } from '../shared/landingPages.js'
import { SITE, townTier } from '../shared/site.js'
import FeaturedBadge from './featured/FeaturedBadge'
import ClaimListing from './featured/ClaimListing'

const API_BASE = (import.meta.env.VITE_API_BASE || '/api').replace(/\/$/, '')

const industries = [
  'All Industries',
  'Healthcare',
  'Manufacturing',
  'Retail',
  'Construction',
  'Education',
  'Government',
  'Public Safety',
  'Food Service',
  'Information Technology',
  'Professional Services',
  'Hospitality',
  'Transportation',
  'Other',
]

const jobTypes = ['All Types', 'Full Time', 'Part Time', 'Temporary', 'Contract']

const legalPages = ['privacy-policy', 'terms-of-use', 'employer-posting-rules']
const adminPages = ['admin-login', 'admin-dashboard']
const resumeCheckerPages = ['resume-checker', 'resume-report']
const coverLetterPages = ['cover-letter', 'cover-letter-result']
const interviewPrepPages = ['interview-prep', 'interview-prep-result']
const aiToolPages = [...resumeCheckerPages, ...coverLetterPages, ...interviewPrepPages, 'bundle']
const alertPages = ['alerts-confirm', 'alerts-unsubscribe']
const seekerPages = ['seeker-login', 'seeker-verify', 'seeker-profile', 'seeker-jobs']
const LEGAL_LAST_UPDATED = 'October 20, 2026'

const privacyPolicySections = [
  {
    heading: '1. Information we collect',
    body: [
      'TarboroJobs may collect information you submit directly to us, including employer account details, business profile details, job posting content, applicant contact details, resume files, resume text, messages, and other information you choose to provide through the site.',
      'We may also collect technical and usage information such as device, browser, IP-address level information, pages visited, referring URLs, and other basic analytics or log data needed to operate, secure, and improve the service.',
      'If you create a job seeker account, we store your email address (confirmed by the sign-in link we email you), plus whatever you add to your profile: name, phone, town, the job you want, a short summary, and one saved PDF resume. We also keep the jobs you save and use your email address to show the applications you sent through TarboroJobs. There is no password; each sign-in link works once and expires after 15 minutes.',
      'We measure site usage with our own anonymous, first-party statistics: pages viewed, the type of device, where a visit came from, and whether a visitor applied or used a tool. This uses a random ID kept in your browser storage, not cookies, and the statistics do not include your IP address or any personal details. We use no third-party analytics or advertising trackers, and we do not record any statistics if your browser sends a Do Not Track or Global Privacy Control signal.',
    ],
  },
  {
    heading: '2. How we use information',
    body: [
      'We use information to operate TarboroJobs, display business profiles and job listings, process applications, route resumes to the correct employer, communicate with users, maintain account security, prevent abuse, and improve the platform.',
      'Applicant information is used to deliver applications to the employer associated with the specific job posting and to support related workflow features such as candidate review notes, ATS-style matching, and follow-up activity inside the employer dashboard.',
      'If you sign up for job alert emails, we use your email address and alert choices only to send the alerts you confirmed (plus a one-way hash of your IP address to prevent abuse), and you can stop them at any time with the unsubscribe link in every alert email.',
    ],
  },
  {
    heading: '3. How information is shared',
    body: [
      'Applications, resumes, and related applicant information are shared with the employer that owns the job posting the applicant chose to apply for.',
      'Your job seeker profile and saved resume are private. Employers cannot browse or search them. When you use Apply with your profile, that one employer receives your name, email, phone, town, summary, and a copy of your saved resume, exactly as if you had filled in the application form. Employers you did not apply to never see them.',
      'We may also share information with service providers that help us host, secure, support, or maintain the platform, or when disclosure is reasonably necessary to comply with law, enforce our terms, protect users, investigate misuse, or respond to legal process.',
    ],
  },
  {
    heading: '4. Data retention',
    body: [
      'We retain information for as long as reasonably needed to operate the site, maintain records, resolve disputes, enforce our agreements, and comply with legal obligations. Retention periods may vary based on the type of information and the purpose for which it was collected.',
      'Even if a posting expires or an account is closed, backups, logs, and certain records may remain for a reasonable period where needed for security, fraud prevention, auditing, or legal compliance.',
    ],
  },
  {
    heading: '5. Security',
    body: [
      'We use reasonable administrative, technical, and organizational measures intended to protect information we control. However, no website, storage system, or transmission method is completely secure, and we cannot guarantee absolute security.',
      'If TarboroJobs becomes aware of a security incident affecting personal information, we may investigate, take appropriate protective steps, and provide notice where required by applicable law.',
    ],
  },
  {
    heading: '6. Cookies and similar technologies',
    body: [
      'TarboroJobs may use cookies, local storage, session identifiers, and similar technologies for login state, security, preferences, traffic measurement, and basic site functionality.',
      'You can usually control cookies through your browser settings, but some parts of the service may not function correctly if certain cookies or storage features are disabled.',
    ],
  },
  {
    heading: '7. Your choices',
    body: [
      'You may choose not to provide certain information, but parts of the service may not work properly if required information is missing.',
      'Job seekers can edit their profile or replace their resume at any time, and can delete their account from the profile page. Deleting removes the profile, the saved resume, and saved jobs right away. Applications you already sent are kept by the employers you sent them to; contact that employer to remove one. Job alert emails are separate and stop with the unsubscribe link in any alert.',
      'If you want to request updates to business account information or have privacy questions about information you submitted through TarboroJobs, contact us using the contact details listed below.',
    ],
  },
  {
    heading: '8. Third-party websites and employer handling',
    body: [
      'TarboroJobs may link to third-party websites or services. We are not responsible for the privacy, security, or content practices of third-party sites, employers, or external services.',
      'Once an employer receives an application through the platform, that employer may maintain its own records and privacy practices. Applicants should review the employer\'s own practices when appropriate.',
    ],
  },
  {
    heading: '9. Changes to this policy',
    body: [
      'We may update this Privacy Policy from time to time. When we do, we may update the last updated date shown on this page. Continued use of the service after updates may constitute acceptance of the revised policy.',
    ],
  },
]

const termsOfUseSections = [
  {
    heading: '1. Agreement to these terms',
    body: [
      'By accessing or using TarboroJobs, you agree to these Terms of Use and any additional policies posted on the site, including our Privacy Policy and Employer Posting Rules.',
      'If you do not agree to these terms, do not use the service.',
    ],
  },
  {
    heading: '2. Service description',
    body: [
      'TarboroJobs is a local hiring platform that may include public job listings, business profiles, employer dashboards, application routing, and related tools for job seekers and employers.',
      'We may add, remove, suspend, or change features at any time without guaranteeing that any particular feature will always remain available.',
    ],
  },
  {
    heading: '3. Eligibility and account responsibility',
    body: [
      'You are responsible for providing accurate information, keeping login credentials confidential, and using the service only for lawful and authorized purposes.',
      'If you create or use an employer account, you are responsible for all activity that occurs under that account unless and until you notify us of suspected unauthorized access.',
    ],
  },
  {
    heading: '4. Acceptable use',
    body: [
      'You may not use TarboroJobs to violate law, infringe the rights of others, interfere with site operations, upload malicious code, scrape or copy data in an abusive way, impersonate another person or business, or attempt to gain unauthorized access to accounts, systems, or data.',
      'You may not submit false, misleading, deceptive, discriminatory, harassing, or fraudulent content through the platform.',
    ],
  },
  {
    heading: '5. User content and postings',
    body: [
      'You retain responsibility for the content you submit, including business details, job postings, resumes, application materials, messages, and files.',
      'By submitting content, you represent that you have the right to provide it and grant TarboroJobs a non-exclusive right to host, store, reproduce, display, process, and transmit that content as needed to operate and promote the service.',
    ],
  },
  {
    heading: '6. Payments, plans, and availability',
    body: [
      'Certain employer features may require payment, an approved onboarding flow, or both. Pricing, plan structure, and included features may change over time.',
      'Unless expressly stated otherwise in writing, fees are non-refundable after the relevant service or access has been granted or activated.',
    ],
  },
  {
    heading: '7. Intellectual property',
    body: [
      'The TarboroJobs service, site design, branding, code, and original platform content are owned by TarboroJobs or its licensors and are protected by applicable intellectual property laws.',
      'These terms do not transfer ownership of the platform or grant permission to copy, resell, reverse engineer, or exploit the service beyond normal permitted use.',
    ],
  },
  {
    heading: '8. No employment guarantee',
    body: [
      'TarboroJobs does not guarantee that job seekers will receive interviews or job offers, or that employers will receive qualified applicants.',
      'We are not a party to the employment relationship between employers and applicants and are not responsible for hiring decisions, workplace conditions, compensation disputes, or employment outcomes.',
    ],
  },
  {
    heading: '9. Disclaimer and limitation of liability',
    body: [
      'The service is provided on an as-is and as-available basis to the fullest extent permitted by law. We do not guarantee uninterrupted availability, error-free operation, or that all content posted by users will be accurate, complete, or current.',
      'To the fullest extent permitted by law, TarboroJobs will not be liable for indirect, incidental, special, consequential, exemplary, or punitive damages, or for lost profits, lost business, lost data, or similar losses arising out of or related to use of the service.',
    ],
  },
  {
    heading: '10. Suspension, removal, and termination',
    body: [
      'We may review, refuse, remove, suspend, or terminate content, postings, accounts, or access at our discretion when we believe it is appropriate to protect the platform, comply with law, investigate misuse, or enforce these terms or other platform policies.',
      'Sections that by their nature should survive termination will continue to apply after use of the service ends.',
    ],
  },
  {
    heading: '11. Governing law',
    body: [
      'These terms are governed by the laws of the State of North Carolina, without regard to conflict-of-law rules, except to the extent superseded by applicable federal law.',
    ],
  },
  {
    heading: '12. Changes to these terms',
    body: [
      'We may revise these Terms of Use from time to time by posting an updated version on the site. Continued use of TarboroJobs after changes become effective may constitute acceptance of the updated terms.',
    ],
  },
]

const employerPostingRuleSections = [
  {
    heading: '1. Accurate and lawful postings only',
    body: [
      'Employers must post only genuine, currently open positions or clearly labeled evergreen talent-pool listings. Job titles, locations, duties, schedules, pay information, and basic requirements must be materially accurate and not misleading.',
      'Postings must comply with applicable employment, advertising, privacy, anti-discrimination, and wage-related laws and regulations.',
    ],
  },
  {
    heading: '2. No discriminatory or exclusionary language',
    body: [
      'Job postings may not include unlawful discriminatory preferences, exclusions, or limitations based on protected characteristics except where expressly allowed by law.',
      'Employers are responsible for keeping their own hiring practices and posted requirements compliant with applicable federal, state, and local law.',
    ],
  },
  {
    heading: '3. No scams, fees, or deceptive recruiting',
    body: [
      'Employers may not use TarboroJobs to run scams, phishing campaigns, affiliate funnels, misleading multi-level recruiting schemes, fake application flows, or postings designed primarily to collect personal information without a real hiring purpose.',
      'Postings may not require applicants to pay application fees, background-check fees, training fees, placement fees, equipment deposits, or similar charges as a condition of applying unless clearly lawful and fully disclosed in advance.',
    ],
  },
  {
    heading: '4. Employer identity and authority',
    body: [
      'You must have authority to represent the business or hiring organization connected to the account and posting. Contact information, business name, and website details should accurately identify the real hiring party or authorized recruiting representative.',
      'If you are recruiting on behalf of a third party, that relationship must be truthful and authorized.',
    ],
  },
  {
    heading: '5. One role per post and no spam duplication',
    body: [
      'Each posting should represent one role or one clearly defined hiring campaign. Repetitive duplicates, keyword stuffing, excessive reposting, or content designed primarily to game visibility may be removed.',
      'TarboroJobs may limit, close, or remove stale, expired, misleading, or low-quality postings to keep the board usable for local employers and applicants.',
    ],
  },
  {
    heading: '6. Handling applicant data',
    body: [
      'Employers who receive applications through TarboroJobs must use applicant information only for legitimate hiring-related purposes and must handle that information responsibly and lawfully.',
      'Sharing, selling, or misusing applicant data for unrelated marketing, spam, or other unauthorized purposes is prohibited.',
    ],
  },
  {
    heading: '7. Platform review and enforcement',
    body: [
      'TarboroJobs may review postings before or after publication and may edit formatting, request clarification, decline publication, suspend access, or remove content that appears unlawful, deceptive, low quality, or inconsistent with platform standards.',
      'Enforcement decisions are made to protect applicants, employers, and the integrity of the platform and may be taken without prior notice when reasonably necessary.',
    ],
  },
  {
    heading: '8. Employer responsibility',
    body: [
      'Employers remain solely responsible for their hiring decisions, communications, interviews, offers, onboarding, payroll, workplace practices, and compliance obligations.',
      'TarboroJobs is not the employer of candidates who apply through the platform and does not guarantee the suitability, credentials, or conduct of applicants.',
    ],
  },
  {
    heading: '9. Reporting concerns',
    body: [
      'If TarboroJobs requests additional information about a posting or receives a complaint, employers are expected to respond promptly and in good faith.',
      'We may remove or suspend postings while concerns are reviewed.',
    ],
  },
]

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

  if (page === 'employer-onboarding' || (token && !page)) {
    return { page: 'employer-onboarding', jobId: null }
  }
  if (page === 'employer-payment-success') return { page: 'employer-payment-success', jobId: null }
  if (aiToolPages.includes(page)) return { page, jobId: null }
  if (alertPages.includes(page)) return { page, jobId: null }
  if (seekerPages.includes(page)) return { page, jobId: null }
  if (legalPages.includes(page) || adminPages.includes(page)) return { page, jobId: null }
  if (page === 'employer-reset-password' && token) {
    return { page: 'employer-reset-password', jobId: null }
  }
  // Self-serve signup links from emails and the Square redirect.
  if (page === 'employer-verify' && token) return { page, jobId: null }
  if (['employer-job-paid', 'employer-plan-upgraded', 'employer-login', 'employer-forgot-password', 'list-business'].includes(page)) return { page, jobId: null }
  // Landing pages use their slug as the page key.
  const landing = findLandingPage(pathname)
  if (landing) return { page: landing.slug, jobId: null }

  return { page: 'jobs', jobId: null }
}

function buildPublicPath(page, jobId = null) {
  if (page === 'job-detail' && jobId) return `/jobs/${jobId}`
  if (page === 'job-apply' && jobId) return `/jobs/${jobId}/apply`
  if (legalPages.includes(page) || adminPages.includes(page)) return `/?page=${page}`
  if (page === 'employer-payment-success') return '/?page=employer-payment-success'
  if (aiToolPages.includes(page) || seekerPages.includes(page)) return `/?page=${page}`
  if (findLandingPage(page)) return `/${page}`
  return '/'
}

const pageTitleOverrides = {
  businesses: 'Local Businesses',
  'list-business': 'Post a Job',
  'submit-resume': 'Submit Your Resume',
}

function pageTitle(page, jobId, job) {
  if (page === 'jobs') return 'Jobs in Tarboro, NC & Edgecombe County | TarboroJobs'
  const landing = findLandingPage(page)
  if (landing) return landing.title
  if (page === 'job-detail' || page === 'job-apply') {
    if (!job || Number(job.id) !== Number(jobId)) return 'Job Details | TarboroJobs'
    return `${page === 'job-apply' ? 'Apply: ' : ''}${job.title} - ${job.company} | TarboroJobs`
  }
  const name = pageTitleOverrides[page] || page.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  return `${name} | TarboroJobs`
}

function formatPostedDate(value) {
  if (!value) return 'Recently posted'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Recently posted'
  return date.toLocaleDateString()
}

function Shell({ currentPage, setCurrentPage, employerSession, adminSession, onLogout, children }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const seeker = useSeeker()

  const navItems = [
    { key: 'jobs', label: 'Jobs', icon: Briefcase },
    { key: 'businesses', label: 'Businesses', icon: Building2 },
    { key: 'resume-checker', label: 'Resume Check', icon: Sparkles },
    { key: 'cover-letter', label: 'Cover Letter', icon: FileText },
    { key: 'interview-prep', label: 'Interview Prep', icon: BookOpen },
    { key: seeker.token ? 'seeker-jobs' : 'seeker-login', label: 'Job seekers', icon: UserRound },
    { key: 'list-business', label: 'For Employers', icon: Landmark },
    employerSession
      ? {
          key: 'employer-dashboard',
          label: employerSession?.admin?.is_admin ? 'Employer Dashboard' : 'Dashboard',
          icon: LayoutDashboard,
        }
      : { key: 'employer-login', label: 'Employer Login', icon: LayoutDashboard },
    ...(adminSession
      ? [{ key: 'admin-dashboard', label: 'Admin Dashboard', icon: ShieldCheck }]
      : []),
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
            className="flex min-w-0 flex-1 items-center gap-3 overflow-hidden text-left"
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

          <div className="hidden shrink-0 items-center gap-2 md:flex">
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

            {(employerSession || adminSession) && (
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
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-slate-700 bg-slate-900/85 text-slate-300 shadow-sm transition hover:border-slate-600 hover:text-white md:hidden"
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

              {(employerSession || adminSession) && (
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

      <footer className="border-t border-slate-800/90 bg-slate-950/85">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-6 text-sm text-slate-400 sm:px-5 md:flex-row md:items-center md:justify-between">
          <div>© {new Date().getFullYear()} TarboroJobs. Built for local hiring in and around Tarboro.</div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <button type="button" onClick={() => handleNavClick('privacy-policy')} className="text-left transition hover:text-cyan-300">Privacy Policy</button>
            <button type="button" onClick={() => handleNavClick('terms-of-use')} className="text-left transition hover:text-cyan-300">Terms of Use</button>
            <button type="button" onClick={() => handleNavClick('employer-posting-rules')} className="text-left transition hover:text-cyan-300">Employer Posting Rules</button>
            <button type="button" onClick={() => handleNavClick(employerSession ? 'employer-dashboard' : 'employer-login')} className="text-left transition hover:text-cyan-300">{employerSession?.admin?.is_admin ? 'Employer Dashboard' : employerSession ? 'Dashboard' : 'Employer Login'}</button>
            <button type="button" onClick={() => handleNavClick(adminSession ? 'admin-dashboard' : 'admin-login')} className="text-left transition hover:text-cyan-300">{adminSession ? 'Admin Dashboard' : 'Admin'}</button>
            <a href="mailto:jobs@tarborojobs.com" className="transition hover:text-cyan-300">Contact</a>
          </div>
        </div>
      </footer>
    </div>
  )
}

function SectionHeader({ title, subtitle, action, children }) {
  return (
    <div className="mb-5 flex flex-col gap-3 md:mb-6 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        {/* <div className="mb-2 inline-flex rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-300">
          Midnight Civic
        </div> */}
        <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          {title}
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400 sm:text-base">
          {subtitle}
        </p>
        {children}
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
                  className="w-full appearance-none bg-transparent text-sm text-slate-100 outline-none"
                  style={{ colorScheme: 'dark' }}
                  value={industry}
                  onChange={(e) => setIndustry(e.target.value)}
                    >
                  {industries.map((option) => (
                    <option
                      key={option}
                      value={option}
                      style={{ backgroundColor: '#020617', color: '#f8fafc' }}
                    >
                      {option}
                    </option>
                  ))}
          </select>
        </div>

        {showType ? (
          <div className="flex min-h-[54px] items-center gap-2 rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3">
            <Briefcase className="h-4 w-4 shrink-0 text-slate-500" />
            <select
                className="w-full appearance-none bg-transparent text-sm text-slate-100 outline-none"
                style={{ colorScheme: 'dark' }}
                value={type}
                onChange={(e) => setType(e.target.value)}
              >
                {jobTypes.map((option) => (
                  <option
                    key={option}
                    value={option}
                    style={{ backgroundColor: '#020617', color: '#f8fafc' }}
                  >
                    {option}
                  </option>
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

function formatExpiryDate(value) {
  if (!value) return 'Open until filled or manually closed'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Open until filled or manually closed'
  return date.toLocaleDateString()
}

const HOME_TITLE = `Jobs in ${SITE.region}`

// ?work= slug for a home-page chip: the label's first word, lowercased.
const workSlug = (label) => label.split(/\W/)[0].toLowerCase()

// Whole calendar days between a posted date and today (null when unparseable).
function daysSince(value) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  date.setHours(0, 0, 0, 0)
  return Math.round((today - date) / 86400000)
}

function boardSummary(jobs) {
  if (!jobs.length) return ''
  const towns = new Set(jobs.map((job) => job.city).filter(Boolean)).size
  const ages = jobs.map((job) => daysSince(job.posted)).filter((days) => days !== null)
  const newest = ages.length ? Math.max(0, Math.min(...ages)) : null
  return [
    `${jobs.length} ${jobs.length === 1 ? 'job' : 'jobs'}`,
    towns ? `${towns} ${towns === 1 ? 'town' : 'towns'}` : '',
    newest === null ? '' : newest === 0 ? 'updated today' : newest === 1 ? 'updated yesterday' : `updated ${newest} days ago`,
  ].filter(Boolean).join(' · ')
}

const chipBadge = 'rounded-full border border-slate-700 bg-slate-950/60 px-2.5 py-0.5 text-[11px] font-medium text-slate-300'
const hiddenScrollbar = '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden'

function JobsPage({ jobs, loading, onViewJob, landing = null, onBrowse }) {
  const [search, setSearch] = useState('')
  const initialWork = landing ? null : SITE.workTypes.find(([label]) => workSlug(label) === new URLSearchParams(window.location.search).get('work'))
  const [work, setWork] = useState(initialWork ? workSlug(initialWork[0]) : '')
  // A single industry name (select, landing pages) or a list of them (work chips).
  const [industry, setIndustry] = useState(initialWork ? initialWork[1] : 'All Industries')
  const [type, setType] = useState('All Types')

  function pickIndustry(next, slug = '') {
    setWork(slug)
    setIndustry(next)
    const url = new URL(window.location.href)
    if (slug) url.searchParams.set('work', slug)
    else url.searchParams.delete('work')
    window.history.replaceState({}, '', url)
  }

  const filteredJobs = useMemo(() => {
    return jobs.filter((job) => {
      const matchesSearch =
        !search ||
        [job.title, job.company, job.city, job.description, job.industry]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(search.toLowerCase()))

      const matchesIndustry =
        industry === 'All Industries' ||
        [].concat(industry).some((option) => option.toLowerCase() === String(job.industry || '').toLowerCase())

      const matchesType =
        type === 'All Types' ||
        humanizeJobType(job.type || '').toLowerCase() === type.toLowerCase()

      return matchesSearch && matchesIndustry && matchesType
    })
  }, [jobs, search, industry, type])

  const heading = landing ? landing.h1 : HOME_TITLE
  const filterSelect = 'appearance-none bg-transparent pr-1 text-sm text-slate-100 outline-none'

  // Browse chips + email alert sit after the first 8 jobs (and under "no results").
  const afterJobs = (
    <>
      {!landing && (
        <div className="chip-row-scroll">
          <LandingLinks heading="Browse by" onNavigate={onBrowse} className="my-4" />
        </div>
      )}
      <div className="my-4">
        <JobAlertSignup jobs={jobs} keywords={search} />
      </div>
    </>
  )

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-4xl">{heading}</h1>
        {landing && <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-400">{landing.intro}</p>}
        <p className="mt-2 text-xs text-slate-500">{loading ? 'Loading jobs…' : boardSummary(jobs)}</p>
        {!landing && (
          <div className="mt-4">
            <p className="text-lg font-semibold text-white">What kind of work are you looking for?</p>
            <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Kind of work">
              {[['Anything', 'All Industries'], ...SITE.workTypes].map(([label, list]) => {
                const slug = list === 'All Industries' ? '' : workSlug(label)
                const on = slug ? work === slug : industry === 'All Industries'
                return (
                  <button
                    key={label}
                    type="button"
                    aria-pressed={on}
                    onClick={() => pickIndustry(list, slug)}
                    className={`flex min-h-[44px] grow basis-[calc(50%-0.25rem)] items-center justify-center rounded-2xl border px-3 py-2 text-center text-sm font-semibold transition sm:grow-0 sm:basis-auto ${on ? 'border-cyan-400 bg-cyan-400 text-slate-950' : 'border-slate-700 bg-slate-900/85 text-slate-200 hover:border-cyan-400/40'}`}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>

      <div className="mb-4 space-y-2">
        <div className="flex min-h-[48px] items-center gap-3 rounded-2xl border border-slate-700 bg-slate-900/85 px-4">
          <Search className="h-4 w-4 shrink-0 text-slate-500" />
          <input
            type="search"
            className="w-full bg-transparent py-3 text-base text-slate-100 outline-none placeholder:text-slate-500 sm:text-sm"
            placeholder="Search jobs — nurse, driver, teacher…"
            aria-label="Search jobs"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className={`-mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0 ${hiddenScrollbar}`}>
          <label className="flex h-11 shrink-0 items-center gap-2 rounded-full border border-slate-700 bg-slate-900/85 px-4">
            <ListFilter className="h-4 w-4 shrink-0 text-slate-500" />
            <select className={filterSelect} style={{ colorScheme: 'dark' }} aria-label="Industry" value={Array.isArray(industry) ? 'All Industries' : industry} onChange={(e) => pickIndustry(e.target.value)}>
              {industries.map((option) => (
                <option key={option} value={option} style={{ backgroundColor: '#020617', color: '#f8fafc' }}>{option}</option>
              ))}
            </select>
          </label>
          <label className="flex h-11 shrink-0 items-center gap-2 rounded-full border border-slate-700 bg-slate-900/85 px-4">
            <Briefcase className="h-4 w-4 shrink-0 text-slate-500" />
            <select className={filterSelect} style={{ colorScheme: 'dark' }} aria-label="Job type" value={type} onChange={(e) => setType(e.target.value)}>
              {jobTypes.map((option) => (
                <option key={option} value={option} style={{ backgroundColor: '#020617', color: '#f8fafc' }}>{option}</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {loading ? (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 text-center text-sm text-slate-400">Fetching current jobs…</div>
      ) : filteredJobs.length === 0 ? (
        <>
          <EmptyState
            icon={Briefcase}
            title="No jobs found"
            body="Try adjusting your search or filters to see more local opportunities."
          />
          {afterJobs}
        </>
      ) : (
        <div className="grid gap-3">
          {filteredJobs.map((job, index) => {
            const posted = daysSince(job.posted)
            return (
              <Fragment key={job.id}>
                <article
                  role="button"
                  tabIndex={0}
                  onClick={() => onViewJob(job.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      onViewJob(job.id)
                    }
                  }}
                  className="cursor-pointer rounded-2xl border border-slate-800 bg-slate-900/85 p-4 transition hover:border-cyan-400/25"
                >
                  <h2 className="break-words text-base font-semibold leading-snug text-white sm:text-lg">{job.title}</h2>
                  <div className="mt-1 break-words text-sm text-slate-400">
                    {[job.company, job.city].filter(Boolean).join(' · ')}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <FeaturedBadge job={job} />
                    {posted !== null && posted <= 3 && (
                      <span className="rounded-full border border-emerald-400/40 bg-emerald-400/15 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-200">New</span>
                    )}
                    {job.type && <span className={chipBadge}>{humanizeJobType(job.type)}</span>}
                    {job.pay && <span className="text-sm font-bold text-white">{job.pay}</span>}
                    <span className="ml-auto"><SaveJobButton jobId={job.id} /></span>
                  </div>
                </article>
                {index === 7 && filteredJobs.length > 8 && afterJobs}
              </Fragment>
            )
          })}
          {filteredJobs.length <= 8 && afterJobs}
        </div>
      )}

      <div className="my-6 flex flex-wrap items-center gap-3">
        <span className="text-sm text-slate-400">Know someone looking? Share these jobs:</span>
        <ShareButtons title={`${heading} | ${SITE.name}`} />
      </div>

      {landing && <LandingLinks heading="More local job searches" currentSlug={landing.slug} onNavigate={onBrowse} />}
    </div>
  )
}

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

  const external = /^https?:\/\//i.test(job.source_url || '')
  const where = job.city ? [job.city, SITE.tierWords[townTier(job.city)]].filter(Boolean).join(' — ') : ''
  const facts = [
    ['Pay', job.pay || 'Pay not listed'],
    job.type && ['Type', humanizeJobType(job.type)],
    where && ['Where', where],
    ['How to apply', external ? `Apply on ${job.company}'s site` : 'Apply here'],
  ].filter(Boolean)

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-4 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="rounded-2xl border border-slate-700 bg-slate-900/80 px-4 py-2 text-sm font-medium text-slate-200 transition hover:border-slate-600"
        >
          Back to jobs
        </button>
        <SaveJobButton jobId={job.id} />
      </div>

      <SectionHeader
        title={job.title}
        subtitle={`${job.company} • ${job.city || 'Tarboro area'}${job.type ? ` • ${humanizeJobType(job.type)}` : ''}`}
        action={
          <div className="flex flex-col gap-3 md:items-end">
            {external ? (
              <a
                href={job.source_url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => track('outbound_apply_click', { job_id: job.id })}
                className="block w-full rounded-2xl bg-cyan-400 px-5 py-3 text-center text-sm font-semibold text-slate-950 shadow-[0_12px_30px_rgba(34,211,238,0.18)] transition hover:bg-cyan-300 md:w-auto"
              >
                Apply on official site
              </a>
            ) : (
              <button
                type="button"
                onClick={onApply}
                className="w-full rounded-2xl bg-cyan-400 px-5 py-3 text-sm font-semibold text-slate-950 shadow-[0_12px_30px_rgba(34,211,238,0.18)] transition hover:bg-cyan-300 md:w-auto"
              >
                Apply for this job
              </button>
            )}
            <ShareButtons jobId={job.id} title={`${job.title} - ${job.company}`} />
          </div>
        }
      >
        <div className="mt-3 flex flex-wrap gap-2">
          {facts.map(([label, value]) => (
            <span key={label} className="rounded-2xl border border-slate-700 bg-slate-950/60 px-3 py-1.5 text-sm font-medium text-slate-100">
              <span className="mr-1.5 text-xs uppercase tracking-wide text-slate-500">{label}</span>
              {value}
            </span>
          ))}
        </div>
      </SectionHeader>

      <FeaturedBadge job={job} className="mb-4" />

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
          <JobAlertSignup compact town={job.city} category={job.industry} />
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

          {/^https?:\/\//i.test(job.source_url || '') ? (
            <Card title="How to apply">
              <div className="space-y-3 text-sm leading-6 text-slate-400">
                <p>This position is posted by {job.company}. Applications are handled directly on their official site, not through TarboroJobs.</p>
                <a
                  href={job.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => track('outbound_apply_click', { job_id: job.id })}
                  className="block w-full rounded-2xl bg-cyan-400 px-5 py-3 text-center text-sm font-semibold text-slate-950 transition hover:bg-cyan-300"
                >
                  View official posting
                </a>
              </div>
            </Card>
          ) : (
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
          )}

          {job.claimable ? <ClaimListing job={job} /> : null}
        </div>
      </div>
    </div>
  )
}

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

    if (!resumeFile) {
      setErrorMessage('Please attach your resume as a PDF.')
      return
    }
    if (resumeFile.type !== 'application/pdf' && !/\.pdf$/i.test(resumeFile.name)) {
      setErrorMessage('Your resume must be a PDF file.')
      return
    }
    if (resumeFile.size > 10 * 1024 * 1024) {
      setErrorMessage('Your resume PDF is larger than 10 MB. Please upload a smaller file.')
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

      track('apply_submit', { job_id: job.id })
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

  if (/^https?:\/\//i.test(job?.source_url || '')) {
    return (
      <div className="mx-auto max-w-4xl">
        <SectionHeader title={`Apply for ${job.title}`} subtitle={job.company} />
        <Card title="Apply on the official site">
          <div className="space-y-4">
            <p className="text-sm leading-6 text-slate-400">This employer takes applications on their official site.</p>
            <a
              href={job.source_url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => track('outbound_apply_click', { job_id: job.id })}
              className="inline-block rounded-2xl bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300"
            >
              View official posting
            </a>
            <button
              type="button"
              onClick={onBack}
              className="ml-3 rounded-2xl border border-slate-700 bg-slate-900/80 px-4 py-2 text-sm font-medium text-slate-200 transition hover:border-slate-600"
            >
              Back to job page
            </button>
          </div>
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
      />

      <OneClickApply job={job} />

      <div className="mb-5 grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
        <div className="rounded-[30px] border border-slate-800 bg-slate-900/85 p-5 shadow-[0_18px_60px_rgba(2,6,23,0.24)] sm:p-6">
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
        <form className="space-y-5" onSubmit={handleSubmit}>
          <div className="grid gap-5 md:grid-cols-2">
            <Field label="Full Name" required>
              <Input
                required
                value={form.full_name}
                onChange={(e) => updateField('full_name', e.target.value)}
                placeholder="Jane Doe"
              />
            </Field>

            <Field label="Email Address" required>
              <Input
                type="email"
                required
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
              required
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

          {errorMessage && (
            <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
              {errorMessage}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting || Boolean(message)}
            className="w-full rounded-2xl bg-cyan-400 px-5 py-3 text-sm font-semibold text-slate-950 shadow-[0_12px_30px_rgba(34,211,238,0.18)] transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
          >
            {submitting ? 'Submitting...' : message ? 'Application Submitted' : 'Submit Application'}
          </button>
        </form>
      </Card>
    </div>
  )
}


function EmployerPaymentSuccessPage({ setCurrentPage }) {
  const checkoutRef = useMemo(() => {
    const params = new URLSearchParams(window.location.search)
    return params.get('checkout_ref') || ''
  }, [])
  const [status, setStatus] = useState('loading')
  const [message, setMessage] = useState('Checking with Square and finalizing your employer account...')
  const [error, setError] = useState('')
  const [onboardingUrl, setOnboardingUrl] = useState('')
  const [emailSent, setEmailSent] = useState(null)

  useEffect(() => {
    let active = true
    let timeoutId = null
    let failures = 0
    const startedAt = Date.now()
    const MAX_FAILURES = 5
    const MAX_POLL_MS = 5 * 60 * 1000
    const STILL_PROCESSING = 'This is taking longer than usual. Your payment may still be processing. Refresh this page in a minute, or contact jobs@tarborojobs.com if it does not finish.'

    async function loadStatus() {
      if (!checkoutRef) {
        if (!active) return
        setStatus('error')
        setError('Missing checkout reference. Please start the employer plan again from TarboroJobs.')
        return
      }

      try {
        const response = await fetch(`${API_BASE}/employer-plan/checkout-status?checkout_ref=${encodeURIComponent(checkoutRef)}`)
        const data = await response.json()

        if (!active) return

        if (!response.ok || data.success === false) {
          throw new Error(data.error || 'Unable to verify your checkout yet.')
        }

        setStatus(data.status || 'loading')
        setMessage(data.message || 'Checking your payment status...')
        setOnboardingUrl(data.onboarding_url || '')
        setEmailSent(typeof data.email_sent === 'boolean' ? data.email_sent : null)
        setError('')
        failures = 0

        if (['loading', 'awaiting_payment_confirmation', 'payment_verified'].includes(data.status)) {
          if (Date.now() - startedAt > MAX_POLL_MS) {
            setStatus('error')
            setError(STILL_PROCESSING)
            return
          }
          timeoutId = window.setTimeout(loadStatus, 3000)
        }
      } catch (err) {
        if (!active) return
        failures += 1
        if (failures < MAX_FAILURES && Date.now() - startedAt <= MAX_POLL_MS) {
          timeoutId = window.setTimeout(loadStatus, 3000)
          return
        }
        setStatus('error')
        setError(failures >= MAX_FAILURES ? `${err.message || 'Unable to verify your checkout yet.'} ${STILL_PROCESSING}` : STILL_PROCESSING)
      }
    }

    loadStatus()

    return () => {
      active = false
      if (timeoutId) window.clearTimeout(timeoutId)
    }
  }, [checkoutRef])

  return (
    <div className="mx-auto max-w-3xl">
      <SectionHeader
        title="Finishing Employer Setup"
        subtitle="TarboroJobs is verifying your Square payment and preparing your secure onboarding link."
      />

      <Card title="Secure checkout handoff">
        <div className="space-y-5">
          <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4 text-sm leading-6 text-slate-300">
            This page does not create access on its own. It only waits for Square to confirm a completed payment and for TarboroJobs to issue your onboarding token.
          </div>

          {status === 'error' && (
            <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
              {error}
            </div>
          )}

          {status !== 'error' && (
            <div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/10 px-4 py-3 text-sm text-cyan-100">
              {message}
            </div>
          )}

          {['loading', 'awaiting_payment_confirmation', 'payment_verified'].includes(status) && (
            <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4 text-sm leading-6 text-slate-300">
              Keep this tab open for a moment. If Square has already charged the payment, TarboroJobs will automatically unlock your onboarding link here as soon as the webhook is processed.
            </div>
          )}

          {status === 'already_onboarded' && (
            <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm leading-6 text-amber-100">
              This business email already has an employer account. Use the button below to go to the employer login screen instead.
            </div>
          )}

          {status === 'ready' && onboardingUrl && (
            <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/10 p-4">
              <div className="text-sm font-semibold text-emerald-200">Your secure onboarding link is ready</div>
              <p className="mt-2 text-sm leading-6 text-emerald-100/90">
                Square has verified the payment. TarboroJobs created your onboarding token and attached it to the button below.
              </p>
              {emailSent === true && (
                <p className="mt-2 text-xs text-emerald-100/80">We also emailed this setup link to the business address used for checkout.</p>
              )}
              {emailSent === false && (
                <p className="mt-2 text-xs text-amber-100/90">Email could not be sent, but this direct button will still take you into account creation.</p>
              )}
              <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                <a
                  href={onboardingUrl}
                  className="inline-flex items-center justify-center rounded-2xl bg-emerald-400 px-5 py-3 text-sm font-semibold text-slate-950 shadow-[0_12px_30px_rgba(16,185,129,0.18)] transition hover:bg-emerald-300"
                >
                  Open Account Creation Page
                </a>
              </div>
              <p className="mt-3 break-all text-xs text-emerald-100/80">{onboardingUrl}</p>
            </div>
          )}

          <div className="flex flex-col gap-3 sm:flex-row">
            {status === 'already_onboarded' ? (
              <button
                type="button"
                onClick={() => setCurrentPage('employer-login')}
                className="inline-flex items-center justify-center rounded-2xl bg-cyan-400 px-5 py-3 text-sm font-semibold text-slate-950 shadow-[0_12px_30px_rgba(34,211,238,0.18)] transition hover:bg-cyan-300"
              >
                Go to Employer Login
              </button>
            ) : null}

            <button
              type="button"
              onClick={() => setCurrentPage('list-business')}
              className="inline-flex items-center justify-center rounded-2xl border border-slate-700 bg-slate-950/60 px-5 py-3 text-sm font-semibold text-slate-200 transition hover:border-slate-600"
            >
              Back to Employer Plan
            </button>
          </div>
        </div>
      </Card>
    </div>
  )
}

function ListBusinessPage() {
  const [formData, setFormData] = useState({
    business_name: '',
    email: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  function handleChange(event) {
    const { name, value } = event.target
    setFormData((prev) => ({ ...prev, [name]: value }))
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setSubmitting(true)
    setError('')

    try {
      const response = await fetch(`${API_BASE}/employer-plan/start-checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_name: formData.business_name,
          email: formData.email,
        }),
      })

      const data = await response.json()
      if (!response.ok || !data.success || !data.checkout_url) {
        throw new Error(data.error || 'Unable to start secure employer checkout.')
      }

      track('checkout_start', { product: 'employer_plan' })
      window.location.assign(data.checkout_url)
    } catch (err) {
      setError(err.message || 'Unable to start secure employer checkout.')
      setSubmitting(false)
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <SectionHeader
        title="Hire in Tarboro & Edgecombe County"
        subtitle="Post your first job free. After that it is $29 a post, or $49/month for unlimited posts."
      />

      <div className="mb-5">
        <EmployerPricing />
      </div>

      <div className="mb-5">
        <Card title="Sign up free">
          <p className="mb-4 text-sm leading-6 text-slate-400">
            Create your employer account, confirm your email, and post your first job free. We review first posts before they go live.
          </p>
          <EmployerSignupForm Field={Field} Input={Input} />
        </Card>
      </div>

      <div className="mb-5 grid gap-4">
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

      <Card title="Hiring often? Start the $49/month plan">
        <div className="space-y-5">
          <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
            <div className="text-sm font-semibold text-white">Secure checkout first</div>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              Enter your business email before checkout. TarboroJobs uses it to create a tracked Square session, wait for payment confirmation, and then issue your employer onboarding token.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Business Name">
                <Input
                  name="business_name"
                  value={formData.business_name}
                  onChange={handleChange}
                  placeholder="Tarboro Jobs Demo Company"
                />
              </Field>

              <Field label="Business Email" required>
                <Input
                  type="email"
                  name="email"
                  value={formData.email}
                  onChange={handleChange}
                  placeholder="owner@business.com"
                  required
                />
              </Field>
            </div>

            {error && (
              <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
                {error}
              </div>
            )}

            <div className="flex flex-col gap-3 sm:flex-row">
              <button
                type="submit"
                disabled={submitting}
                className="inline-flex items-center justify-center rounded-2xl bg-cyan-400 px-5 py-3 text-sm font-semibold text-slate-950 shadow-[0_12px_30px_rgba(34,211,238,0.18)] transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting ? 'Creating secure checkout…' : 'Start Employer Plan'}
              </button>

              <a
                href="mailto:jobs@tarborojobs.com"
                className="inline-flex items-center justify-center rounded-2xl border border-slate-700 bg-slate-950/60 px-5 py-3 text-sm font-semibold text-slate-200 transition hover:border-slate-600"
              >
                Contact TarboroJobs
              </a>
            </div>
          </form>
        </div>
      </Card>
    </div>
  )
}

function LegalDocumentPage({ title, subtitle, sections, onBack }) {
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

      <SectionHeader title={title} subtitle={subtitle} />

      <div className="mb-5 rounded-[30px] border border-slate-800 bg-slate-900/85 p-5 text-sm leading-6 text-slate-300 shadow-[0_18px_60px_rgba(2,6,23,0.24)] sm:p-6">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-300">TarboroJobs Legal</div>
        <p className="mt-3 text-sm leading-6 text-slate-300">
          Last updated {LEGAL_LAST_UPDATED}. This page is provided as the current platform policy for TarboroJobs and should be reviewed periodically as the site evolves.
        </p>
      </div>

      <div className="space-y-5">
        {sections.map((section) => (
          <Card key={section.heading} title={section.heading}>
            <div className="space-y-4 text-sm leading-7 text-slate-300">
              {section.body.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </div>
          </Card>
        ))}

        <Card title="Contact">
          <div className="space-y-3 text-sm leading-7 text-slate-300">
            <p>Questions about these policies can be sent to <a href="mailto:jobs@tarborojobs.com" className="text-cyan-300 hover:underline">jobs@tarborojobs.com</a>.</p>
            <p className="text-slate-400">These pages are a practical launch baseline for TarboroJobs. For business-specific legal advice, local compliance questions, or custom contract language, have counsel review them before full-scale rollout.</p>
          </div>
        </Card>
      </div>
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
  const [publicJobLoading, setPublicJobLoading] = useState(
    Boolean(initialRoute.jobId) && ['job-detail', 'job-apply'].includes(initialRoute.page)
  )
  const publicJobRequestRef = useRef(0)
  const [sessionError, setSessionError] = useState('')
  const [publicJobError, setPublicJobError] = useState('')
  const [employerSession, setEmployerSession] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [adminSession, setAdminSession] = useState(null)
  const [adminLoading, setAdminLoading] = useState(true)
  const [adminOverview, setAdminOverview] = useState({})
  const [adminEmployers, setAdminEmployers] = useState([])
  const [adminJobs, setAdminJobs] = useState([])
  const [adminTokens, setAdminTokens] = useState([])
  const [adminDataLoading, setAdminDataLoading] = useState(false)
  const [adminActionLoading, setAdminActionLoading] = useState(false)
  const [adminActionMessage, setAdminActionMessage] = useState('')
  const [adminActionError, setAdminActionError] = useState('')
  const [employerJobs, setEmployerJobs] = useState([])
  const [employerJobsLoading, setEmployerJobsLoading] = useState(false)
  const [editingJobId, setEditingJobId] = useState(null)

  const [candidateView, setCandidateView] = useState('all')

  const [employerStats, setEmployerStats] = useState({
    open_jobs: 0,
    total_resumes: 0,
    new_candidates: 0,
    reviewed_candidates: 0,
    interview_candidates: 0,
    rejected_candidates: 0,
    hired_candidates: 0,
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
    if (!['jobs', 'job-detail', 'job-apply', 'employer-payment-success', ...legalPages, ...adminPages, ...aiToolPages, ...seekerPages].includes(page) && !findLandingPage(page)) return

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

    if (page === 'job-detail' || page === 'job-apply' || page === 'employer-payment-success' || legalPages.includes(page) || adminPages.includes(page) || aiToolPages.includes(page) || seekerPages.includes(page) || findLandingPage(page)) {
      setBrowserLocation(page, jobId, options)
    }
  }

  function handleShellPageChange(page) {
    if (page === 'jobs') {
      navigateToPage('jobs', null)
      return
    }

    if (legalPages.includes(page) || adminPages.includes(page) || aiToolPages.includes(page) || seekerPages.includes(page)) {
      navigateToPage(page, null)
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

    const requestId = ++publicJobRequestRef.current

    try {
      setPublicJobLoading(true)
      setPublicJobError('')
      const response = await fetch(`${API_BASE}/jobposts/${jobId}`)
      const data = await response.json()

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to load job details.')
      }

      if (requestId !== publicJobRequestRef.current) return
      setPublicJobDetail(data.job || null)
    } catch (error) {
      if (requestId !== publicJobRequestRef.current) return
      setPublicJobDetail(null)
      setPublicJobError(error.message || 'Failed to load job details.')
    } finally {
      if (requestId === publicJobRequestRef.current) setPublicJobLoading(false)
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
        new_candidates: 0,
        reviewed_candidates: 0,
        interview_candidates: 0,
        rejected_candidates: 0,
        hired_candidates: 0,
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
          new_candidates: 0,
          reviewed_candidates: 0,
          interview_candidates: 0,
          rejected_candidates: 0,
          hired_candidates: 0,
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
        new_candidates: 0,
        reviewed_candidates: 0,
        interview_candidates: 0,
        rejected_candidates: 0,
        hired_candidates: 0,
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
        activeView === 'reviewed'
          ? await apiLoadReviewedCandidates(token, filters)
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
    setSessionError('')

    if (!token) {
      setEmployerSession(null)
      if (!getStoredAdminApiKey()) {
        setAdminSession(null)
        setAdminOverview({})
        setAdminEmployers([])
        setAdminJobs([])
        setAdminTokens([])
      }
      setAuthLoading(false)
      return
    }

    try {
      const data = await apiLoadEmployerSession(token)
      setEmployerSession(data)

      if (data?.admin?.is_admin) {
        setAdminSession(data.admin)

        try {
          await refreshAdminData()
        } catch (adminError) {
          console.error('Failed to load admin dashboard data:', adminError)
        }
      } else if (!getStoredAdminApiKey()) {
        setAdminSession(null)
        setAdminOverview({})
        setAdminEmployers([])
        setAdminJobs([])
        setAdminTokens([])
      }

      const canLoadEmployerWorkspace =
        data?.admin?.is_admin ||
        (data?.employer?.onboarding_completed && data?.employer?.access_status === 'active')

      if (canLoadEmployerWorkspace) {
        await Promise.all([
          loadEmployerJobs(token),
          loadEmployerStats(token),
          loadEmployerResumes(token, resumeFilters, candidateView),
        ])
      } else {
        setEmployerJobs([])
        setEmployerResumes([])
        setSelectedResume(null)
      }
    } catch (error) {
      console.error('Failed to load employer session:', error)
      setEmployerSession(null)
      if (error?.status !== 401 && error?.status !== 403) {
        // Network error / 5xx: keep the token so a retry (or refresh) can recover.
        setSessionError('We could not reach TarboroJobs to check your employer login. Your session is still saved.')
        return
      }
      clearStoredEmployerToken()
      if (!getStoredAdminApiKey()) {
        setAdminSession(null)
        setAdminOverview({})
        setAdminEmployers([])
        setAdminJobs([])
        setAdminTokens([])
      }
    } finally {
      setAuthLoading(false)
    }
  }


  async function refreshAdminData(apiKeyOverride) {
    const apiKey = apiKeyOverride || getStoredAdminApiKey()
    const employerToken = !apiKey ? getStoredEmployerToken() : ''

    if (!apiKey && !employerToken) {
      setAdminOverview({})
      setAdminEmployers([])
      setAdminJobs([])
      setAdminTokens([])
      return
    }

    try {
      setAdminDataLoading(true)
      const [sessionData, employerData, jobData, tokenData] = await Promise.all([
        apiLoadAdminSession(apiKey || undefined),
        apiLoadAdminEmployers(apiKey || undefined),
        apiLoadAdminJobs(apiKey || undefined),
        apiLoadAdminTokens(apiKey || undefined),
      ])

      setAdminSession(sessionData.admin || { authenticated: true })
      setAdminOverview(sessionData.overview || {})
      setAdminEmployers(employerData.employers || [])
      setAdminJobs(jobData.jobs || [])
      setAdminTokens(tokenData.tokens || [])
    } catch (error) {
      console.error('Failed to refresh admin data:', error)
      if (apiKey) {
        clearStoredAdminApiKey()
      }
      setAdminSession(null)
      setAdminOverview({})
      setAdminEmployers([])
      setAdminJobs([])
      setAdminTokens([])
      throw error
    } finally {
      setAdminDataLoading(false)
      setAdminLoading(false)
    }
  }

  async function loadAdminSession(apiKeyOverride) {
    const apiKey = apiKeyOverride || getStoredAdminApiKey()
    const employerToken = !apiKey ? getStoredEmployerToken() : ''

    if (!apiKey && !employerToken) {
      setAdminSession(null)
      setAdminLoading(false)
      return
    }

    try {
      setAdminLoading(true)
      const sessionData = await apiLoadAdminSession(apiKey || undefined)
      setAdminSession(sessionData.admin || { authenticated: true, is_admin: true })
      await refreshAdminData(apiKey || undefined)
    } catch (error) {
      console.error('Failed to load admin session:', error)
      if (apiKey) {
        clearStoredAdminApiKey()
      }
      setAdminSession(null)
      setAdminOverview({})
      setAdminEmployers([])
      setAdminJobs([])
      setAdminTokens([])
      setAdminLoading(false)
      throw error
    }
  }

  async function runAdminAction(action, successMessage) {
    setAdminActionLoading(true)
    setAdminActionMessage('')
    setAdminActionError('')

    try {
      await action()
      await refreshAdminData()
      await Promise.all([loadBusinesses(), loadJobs()])
      setAdminActionMessage(successMessage)
    } catch (error) {
      setAdminActionError(error.message || 'Admin action failed.')
      throw error
    } finally {
      setAdminActionLoading(false)
    }
  }

  async function createAdminOnboardingToken(payload) {
    await runAdminAction(
      async () => {
        await apiCreateAdminOnboardingToken(undefined, payload)
      },
      'Onboarding link created successfully.'
    )
  }

  async function approveAdminEmployer(employerId) {
    await runAdminAction(
      async () => {
        await apiApproveAdminEmployer(undefined, employerId)
      },
      'Employer approved successfully.'
    )
  }

  async function deactivateAdminEmployer(employerId) {
    await runAdminAction(
      async () => {
        await apiDeactivateAdminEmployer(undefined, employerId)
      },
      'Employer deactivated successfully.'
    )
  }

  async function reactivateAdminEmployer(employerId) {
    await runAdminAction(
      async () => {
        await apiReactivateAdminEmployer(undefined, employerId)
      },
      'Employer reactivated successfully.'
    )
  }

  async function revokeAdminToken(tokenId) {
    await runAdminAction(
      async () => {
        await apiRevokeAdminToken(undefined, tokenId)
      },
      'Onboarding link revoked successfully.'
    )
  }

  async function deleteAdminJob(jobId) {
    await runAdminAction(
      async () => {
        await apiDeleteAdminJob(undefined, jobId)
      },
      'Job post removed successfully.'
    )
  }

  function handleAdminLogout() {
    const hasApiKeySession = !!getStoredAdminApiKey()

    clearStoredAdminApiKey()
    setAdminSession(null)
    setAdminOverview({})
    setAdminEmployers([])
    setAdminJobs([])
    setAdminTokens([])
    setAdminActionLoading(false)
    setAdminActionMessage('')
    setAdminActionError('')

    if (!hasApiKeySession && employerSession?.admin?.is_admin) {
      handleLogout()
      return
    }

    navigateToPage('admin-login', null, { replace: true })
  }

  async function updateEmployerAccount(payload) {
    const token = getStoredEmployerToken()
    await apiUpdateEmployerAccount(token, payload)
    await Promise.all([loadEmployerSession(token), loadBusinesses()])
  }

  async function updateEmployerPassword(payload) {
    const token = getStoredEmployerToken()
    const data = await apiUpdateEmployerPassword(token, payload)
    // The server revokes older tokens on a password change and returns a new one.
    if (data?.auth_token) setStoredEmployerToken(data.auth_token)
  }

  async function createEmployerJob(payload) {
    const token = getStoredEmployerToken()
    const data = await apiCreateEmployerJob(token, payload)
    await Promise.all([
      loadEmployerJobs(token),
      loadEmployerStats(token),
      loadJobs(),
      loadBusinesses(),
    ])
    return data
  }

  async function updateEmployerJob(jobId, payload) {
    const token = getStoredEmployerToken()
    const data = await apiUpdateEmployerJob(token, jobId, payload)
    await Promise.all([
      loadEmployerJobs(token),
      loadEmployerStats(token),
      loadJobs(),
      loadBusinesses(),
    ])
    return data
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

    if (!getStoredAdminApiKey()) {
      setAdminSession(null)
      setAdminOverview({})
      setAdminEmployers([])
      setAdminJobs([])
      setAdminTokens([])
      setAdminActionLoading(false)
      setAdminActionMessage('')
      setAdminActionError('')
    }

    setEmployerStats({
      open_jobs: 0,
      total_resumes: 0,
      new_candidates: 0,
      reviewed_candidates: 0,
      interview_candidates: 0,
      rejected_candidates: 0,
      hired_candidates: 0,
      saved_candidates: 0,
      interviews_scheduled: 0,
      follow_ups_due: 0,
    })
    navigateToPage('jobs', null, { replace: true })
  }

  useEffect(() => {
    function handleAuthExpired() {
      handleLogout()
      setCurrentPage('employer-login')
    }
    window.addEventListener(EMPLOYER_AUTH_EXPIRED_EVENT, handleAuthExpired)
    return () => window.removeEventListener(EMPLOYER_AUTH_EXPIRED_EVENT, handleAuthExpired)
  }, [])

  useEffect(() => {
    loadBusinesses()
    loadJobs()
    loadEmployerSession()

    if (getStoredAdminApiKey()) {
      loadAdminSession().catch(() => {})
    }
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

  // Anonymous first-party usage events (see src/lib/track.js).
  useEffect(() => {
    track('page_view', { path: selectedPublicJobId && currentPage.startsWith('job-') ? buildPublicPath(currentPage, selectedPublicJobId) : currentPage === 'jobs' ? '/' : `/${currentPage}` })
  }, [currentPage, selectedPublicJobId])

  // Browser tab / share-preview title follows the SPA route.
  useEffect(() => {
    document.title = pageTitle(currentPage, selectedPublicJobId, publicJobDetail)
  }, [currentPage, selectedPublicJobId, publicJobDetail])

  useEffect(() => {
    if (currentPage === 'job-detail' && publicJobDetail?.id) track('job_view', { job_id: publicJobDetail.id })
  }, [currentPage, publicJobDetail?.id])

  useEffect(() => {
    if (currentPage === 'job-apply' && selectedPublicJobId) track('apply_start', { job_id: selectedPublicJobId })
  }, [currentPage, selectedPublicJobId])

  useEffect(() => {
    if (!selectedPublicJobId || !['job-detail', 'job-apply'].includes(currentPage)) {
      return
    }

    setPublicJobDetail((prev) => (prev && Number(prev.id) === Number(selectedPublicJobId) ? prev : null))
    setPublicJobLoading(true)
    loadPublicJobDetail(selectedPublicJobId)
  }, [currentPage, selectedPublicJobId])

  useEffect(() => {
    if (!authLoading && currentPage === 'employer-dashboard' && !employerSession) {
      setCurrentPage('employer-login')
    }
  }, [authLoading, currentPage, employerSession])

  useEffect(() => {
    if (!adminLoading && currentPage === 'admin-dashboard' && !adminSession) {
      navigateToPage('admin-login', null, { replace: true })
    }
  }, [adminLoading, currentPage, adminSession])

  useEffect(() => {
    if (!adminLoading && currentPage === 'admin-login' && adminSession) {
      navigateToPage('admin-dashboard', null, { replace: true })
    }
  }, [adminLoading, currentPage, adminSession])

  return (
    <Shell
      currentPage={currentPage}
      setCurrentPage={handleShellPageChange}
      employerSession={employerSession}
      adminSession={adminSession}
      onLogout={handleLogout}
    >
      {sessionError && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          <span>{sessionError}</span>
          <button
            type="button"
            onClick={() => loadEmployerSession()}
            className="rounded-xl bg-amber-300 px-3 py-1.5 text-xs font-semibold text-slate-950 transition hover:bg-amber-200"
          >
            Retry
          </button>
        </div>
      )}
      {currentPage === 'jobs' && (
        <JobsPage jobs={jobs} loading={jobsLoading} onViewJob={(jobId) => navigateToPage('job-detail', jobId)} onBrowse={(slug) => navigateToPage(slug)} />
      )}
      {findLandingPage(currentPage) && (
        <JobsPage
          key={currentPage}
          jobs={landingJobs(findLandingPage(currentPage), jobs)}
          loading={jobsLoading}
          landing={findLandingPage(currentPage)}
          onViewJob={(jobId) => navigateToPage('job-detail', jobId)}
          onBrowse={(slug) => navigateToPage(slug)}
        />
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
      )}
      {currentPage === 'privacy-policy' && (
        <LegalDocumentPage
          title="Privacy Policy"
          subtitle="How TarboroJobs collects, uses, shares, and protects information submitted through the platform."
          sections={privacyPolicySections}
          onBack={() => navigateToPage('jobs', null)}
        />
      )}
      {currentPage === 'terms-of-use' && (
        <LegalDocumentPage
          title="Terms of Use"
          subtitle="The core rules that govern access to and use of the TarboroJobs platform."
          sections={termsOfUseSections}
          onBack={() => navigateToPage('jobs', null)}
        />
      )}
      {currentPage === 'employer-posting-rules' && (
        <LegalDocumentPage
          title="Employer Posting Rules"
          subtitle="Posting standards for employers using TarboroJobs to list jobs and receive applications."
          sections={employerPostingRuleSections}
          onBack={() => navigateToPage('jobs', null)}
        />
      )}
      {currentPage === 'employer-payment-success' && <EmployerPaymentSuccessPage setCurrentPage={setCurrentPage} />}
      {currentPage === 'resume-checker' && (
        <ResumeCheckerPage
          initialMode="upload"
          onBack={() => navigateToPage('jobs', null)}
        />
      )}
      {currentPage === 'resume-report' && (
        <ResumeCheckerPage
          initialMode="report"
          onBack={() => navigateToPage('jobs', null)}
        />
      )}
      {currentPage === 'cover-letter' && (
        <CoverLetterPage initialMode="form" onBack={() => navigateToPage('jobs', null)} />
      )}
      {currentPage === 'cover-letter-result' && (
        <CoverLetterPage initialMode="paywall" onBack={() => navigateToPage('jobs', null)} />
      )}
      {currentPage === 'interview-prep' && (
        <InterviewPrepPage initialMode="form" onBack={() => navigateToPage('jobs', null)} />
      )}
      {currentPage === 'interview-prep-result' && (
        <InterviewPrepPage initialMode="paywall" onBack={() => navigateToPage('jobs', null)} />
      )}
      {currentPage === 'bundle' && <BundlePage />}
      {alertPages.includes(currentPage) && <AlertPage page={currentPage} />}
      {currentPage === 'seeker-login' && <SeekerSignInPage />}
      {currentPage === 'seeker-verify' && <SeekerVerifyPage />}
      {currentPage === 'seeker-profile' && <SeekerProfilePage jobs={jobs} />}
      {currentPage === 'seeker-jobs' && <SeekerJobsPage />}
      {currentPage === 'list-business' && <ListBusinessPage />}
      {currentPage === 'employer-verify' && (
        <EmployerVerifyPage onVerified={loadEmployerSession} setCurrentPage={setCurrentPage} />
      )}
      {currentPage === 'employer-job-paid' && (
        <EmployerJobPaidPage setCurrentPage={setCurrentPage} signedIn={!!employerSession} />
      )}
      {currentPage === 'employer-plan-upgraded' && (
        <EmployerPlanUpgradedPage setCurrentPage={setCurrentPage} signedIn={!!employerSession} reloadProfile={loadEmployerSession} />
      )}
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
          setCurrentPage={(page) => {
            // Drop the one-time reset token from the URL once we leave this page.
            if (page === 'employer-login') window.history.replaceState({}, '', '/')
            setCurrentPage(page)
          }}
          SectionHeader={SectionHeader}
          Card={Card}
          Field={Field}
          Input={Input}
        />
      )}
      {currentPage === 'admin-login' && (
        <AdminLoginPage
          setCurrentPage={setCurrentPage}
          onLoginSuccess={loadAdminSession}
          onOpenDashboard={() => navigateToPage('admin-dashboard', null, { replace: true })}
          SectionHeader={SectionHeader}
          Card={Card}
          Field={Field}
          Input={Input}
        />
      )}
      {currentPage === 'admin-dashboard' && (
        <AdminDashboardPage
          adminOverview={adminOverview}
          employers={adminEmployers}
          jobs={adminJobs}
          tokens={adminTokens}
          loading={adminLoading || adminDataLoading}
          actionLoading={adminActionLoading}
          actionMessage={adminActionMessage}
          actionError={adminActionError}
          onRefresh={() => refreshAdminData()}
          onCreateToken={createAdminOnboardingToken}
          onApproveEmployer={approveAdminEmployer}
          onDeactivateEmployer={deactivateAdminEmployer}
          onReactivateEmployer={reactivateAdminEmployer}
          onRevokeToken={revokeAdminToken}
          onDeleteJob={deleteAdminJob}
          onLogout={handleAdminLogout}
          SectionHeader={SectionHeader}
          Card={Card}
          Field={Field}
          Input={Input}
          Select={Select}
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