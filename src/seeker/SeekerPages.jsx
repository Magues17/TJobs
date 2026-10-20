// Job seeker pages (sign in, emailed-link landing, profile, my jobs) plus the
// Save button for job cards and the one-click apply box for the apply page.
import { useEffect, useState } from 'react'
import { Bookmark, BookmarkCheck, CheckCircle2, Mail, UserRound } from 'lucide-react'
import { track } from '../lib/track'
import JobAlertSignup from '../alerts/JobAlertSignup'
import {
  goTo,
  markApplied,
  refreshSeeker,
  rememberReturn,
  seekerApi,
  setProfile,
  signIn,
  signOut,
  takeReturn,
  toggleSaved,
  useSeeker,
} from './session'

const fieldClass =
  'w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-cyan-400'
const primaryButton =
  'rounded-2xl bg-cyan-400 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-60'
const secondaryButton =
  'rounded-2xl border border-slate-700 bg-slate-900/80 px-4 py-2 text-sm font-medium text-slate-200 transition hover:border-slate-600'

function Card({ title, children }) {
  return (
    <section className="rounded-[30px] border border-slate-800 bg-slate-900/85 p-4 shadow-[0_18px_60px_rgba(2,6,23,0.24)] sm:p-6">
      {title ? <h2 className="mb-4 text-lg font-semibold text-white sm:mb-5">{title}</h2> : null}
      <div className="space-y-4">{children}</div>
    </section>
  )
}

function Header({ title, subtitle }) {
  return (
    <div className="mb-5 md:mb-6">
      <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">{title}</h1>
      {subtitle ? <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400 sm:text-base">{subtitle}</p> : null}
    </div>
  )
}

function Field({ label, children }) {
  return (
    <label className="block">
      <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">{label}</div>
      {children}
    </label>
  )
}

function Notice({ kind = 'ok', children }) {
  const tone = kind === 'error'
    ? 'border-rose-500/30 bg-rose-500/10 text-rose-300'
    : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
  return <div className={`rounded-2xl border px-4 py-3 text-sm ${tone}`}>{children}</div>
}

function formatDate(value) {
  const date = value ? new Date(value) : null
  return date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString() : ''
}

function SeekerNav({ current }) {
  const tabs = [
    ['seeker-jobs', 'My jobs'],
    ['seeker-profile', 'Profile'],
  ]
  return (
    <div className="mb-5 flex flex-wrap gap-2">
      {tabs.map(([page, label]) => (
        <button
          key={page}
          type="button"
          onClick={() => goTo(`/?page=${page}`)}
          className={`rounded-2xl border px-4 py-2 text-sm font-medium transition ${
            current === page ? 'border-cyan-400/30 bg-cyan-400 text-slate-950' : 'border-slate-700 bg-slate-900/80 text-slate-300 hover:border-slate-600'
          }`}
        >
          {label}
        </button>
      ))}
      <button type="button" onClick={() => { signOut(); goTo('/') }} className={secondaryButton}>
        Sign out
      </button>
    </div>
  )
}

function SignInFirst() {
  return (
    <div className="mx-auto max-w-xl">
      <Card title="Sign in to continue">
        <p className="text-sm leading-6 text-slate-400">Your profile, saved jobs and applications are behind a quick email sign-in.</p>
        <button type="button" className={primaryButton} onClick={() => goTo('/?page=seeker-login')}>Sign in with email</button>
      </Card>
    </div>
  )
}

export function SeekerSignInPage() {
  const { token } = useSeeker()
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState('')

  async function handleSubmit(event) {
    event.preventDefault()
    setStatus('sending')
    setError('')
    try {
      await seekerApi('/seeker/login', { method: 'POST', body: { email } })
      setStatus('sent')
    } catch (submitError) {
      setError(submitError.message)
      setStatus('idle')
    }
  }

  if (token) {
    return (
      <div className="mx-auto max-w-xl">
        <Card title="You are signed in">
          <button type="button" className={primaryButton} onClick={() => goTo('/?page=seeker-jobs')}>Go to my jobs</button>
        </Card>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-xl">
      <Header title="Job seekers" subtitle="Save your resume once, apply to local jobs in one click, and keep track of what you applied to. No password: we email you a sign-in link." />
      <Card>
        {status === 'sent' ? (
          <div className="flex items-start gap-3">
            <Mail className="mt-0.5 h-5 w-5 shrink-0 text-cyan-300" />
            <div>
              <h2 className="text-base font-semibold text-white">Check your email</h2>
              <p className="mt-1 text-sm leading-6 text-slate-400">
                We sent a sign-in link to {email}. It works once and expires in 15 minutes. Nothing there? Check spam, or{' '}
                <button type="button" className="text-cyan-300 underline" onClick={() => setStatus('idle')}>try again</button>.
              </p>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <Field label="Email address">
              <input
                type="email"
                required
                maxLength={255}
                autoComplete="email"
                placeholder="you@example.com"
                className={fieldClass}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </Field>
            {error ? <Notice kind="error">{error}</Notice> : null}
            <button type="submit" disabled={status === 'sending'} className={`${primaryButton} w-full sm:w-auto`}>
              {status === 'sending' ? 'Sending...' : 'Email me a sign-in link'}
            </button>
            <p className="text-xs leading-5 text-slate-500">New here? The link creates your account. See our Privacy Policy for what a profile stores.</p>
          </form>
        )}
      </Card>
    </div>
  )
}

// The link is single use; React StrictMode runs effects twice in development,
// so remember which tokens this page load already sent.
const verifyStarted = new Set()

export function SeekerVerifyPage() {
  const [error, setError] = useState('')

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('token') || ''
    if (verifyStarted.has(token)) return
    verifyStarted.add(token)
    seekerApi(`/seeker/verify?token=${encodeURIComponent(token)}`)
      .then((data) => {
        signIn(data.token, data.profile)
        goTo(takeReturn() || (data.profile.has_resume ? '/?page=seeker-jobs' : '/?page=seeker-profile'), { replace: true })
      })
      .catch((verifyError) => setError(verifyError.message))
  }, [])

  return (
    <div className="mx-auto max-w-xl">
      <Card title={error ? 'Sign-in link not valid' : 'Signing you in...'}>
        {error ? (
          <>
            <p className="text-sm leading-6 text-slate-400">{error}</p>
            <button type="button" className={primaryButton} onClick={() => goTo('/?page=seeker-login', { replace: true })}>Send a new link</button>
          </>
        ) : (
          <p className="text-sm text-slate-400">One moment.</p>
        )}
      </Card>
    </div>
  )
}

export function SeekerProfilePage({ jobs = [] }) {
  const { token, profile } = useSeeker()
  const [form, setForm] = useState(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')

  useEffect(() => {
    if (profile && !form) setForm({ full_name: profile.full_name, phone: profile.phone, town: profile.town, desired_job_title: profile.desired_job_title, summary: profile.summary })
  }, [profile, form])

  if (!token) return <SignInFirst />
  if (!profile || !form) return <div className="mx-auto max-w-3xl"><SeekerNav current="seeker-profile" /><Card title="Loading your profile..." /></div>

  const update = (key) => (event) => setForm((prev) => ({ ...prev, [key]: event.target.value }))

  async function run(label, action) {
    setBusy(label)
    setMessage('')
    setError('')
    try {
      await action()
    } catch (actionError) {
      setError(actionError.message)
    } finally {
      setBusy('')
    }
  }

  const saveProfile = (event) => {
    event.preventDefault()
    run('save', async () => {
      const data = await seekerApi('/seeker/profile', { method: 'PUT', body: form })
      setProfile(data.profile)
      setMessage('Profile saved.')
    })
  }

  const uploadResume = (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) return setError('Your resume must be a PDF file.')
    if (file.size > 10 * 1024 * 1024) return setError('Your resume PDF is larger than 10 MB. Please upload a smaller file.')
    run('resume', async () => {
      const payload = new FormData()
      payload.append('resume_file', file)
      const data = await seekerApi('/seeker/resume', { method: 'POST', form: payload })
      setProfile(data.profile)
      setMessage('Resume saved. It is only sent to employers you apply to.')
    })
  }

  const downloadResume = () =>
    run('download', async () => {
      const response = await fetch(`${(import.meta.env.VITE_API_BASE || '/api').replace(/\/$/, '')}/seeker/resume`, { headers: { Authorization: `Bearer ${token}` } })
      if (!response.ok) throw new Error('Could not load your resume.')
      const url = URL.createObjectURL(await response.blob())
      const link = Object.assign(document.createElement('a'), { href: url, download: profile.resume_file_name || 'resume.pdf' })
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 10000)
    })

  const deleteAccount = () => {
    if (!window.confirm('Delete your profile, saved resume and saved jobs? Applications you already sent stay with those employers.')) return
    run('delete', async () => {
      const data = await seekerApi('/seeker/account', { method: 'DELETE' })
      signOut()
      window.alert(data.message)
      goTo('/')
    })
  }

  return (
    <div className="mx-auto max-w-3xl">
      <Header title="Your profile" subtitle={`Signed in as ${profile.email}. Employers only see this when you apply to their job.`} />
      <SeekerNav current="seeker-profile" />
      <div className="space-y-5">
        {message ? <Notice>{message}</Notice> : null}
        {error ? <Notice kind="error">{error}</Notice> : null}

        <Card title="Resume">
          <p className="text-sm leading-6 text-slate-400">
            {profile.has_resume
              ? `Saved: ${profile.resume_file_name}${profile.resume_uploaded_at ? ` (uploaded ${formatDate(profile.resume_uploaded_at)})` : ''}. One-click apply sends a copy of this file.`
              : 'Upload a PDF resume (10 MB max) to apply in one click.'}
          </p>
          <div className="flex flex-wrap gap-2">
            <label className={`${primaryButton} cursor-pointer`}>
              {busy === 'resume' ? 'Uploading...' : profile.has_resume ? 'Replace resume' : 'Upload resume'}
              <input type="file" accept=".pdf,application/pdf" className="sr-only" onChange={uploadResume} disabled={!!busy} />
            </label>
            {profile.has_resume ? <button type="button" className={secondaryButton} onClick={downloadResume}>Download</button> : null}
          </div>
        </Card>

        <Card title="About you">
          <form onSubmit={saveProfile} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Full name"><input className={fieldClass} maxLength={255} required value={form.full_name} onChange={update('full_name')} placeholder="Jane Doe" /></Field>
              <Field label="Phone"><input className={fieldClass} maxLength={50} value={form.phone} onChange={update('phone')} placeholder="(252) 555-1234" /></Field>
              <Field label="Town"><input className={fieldClass} maxLength={255} value={form.town} onChange={update('town')} placeholder="Tarboro, NC" /></Field>
              <Field label="Job you want"><input className={fieldClass} maxLength={255} value={form.desired_job_title} onChange={update('desired_job_title')} placeholder="Cashier, CNA, warehouse..." /></Field>
            </div>
            <Field label="Short summary">
              <textarea className={fieldClass} rows={4} maxLength={2000} value={form.summary} onChange={update('summary')} placeholder="A few lines employers see with your application." />
            </Field>
            <button type="submit" disabled={!!busy} className={`${primaryButton} w-full sm:w-auto`}>{busy === 'save' ? 'Saving...' : 'Save profile'}</button>
          </form>
        </Card>

        <JobAlertSignup jobs={jobs} keywords={profile.desired_job_title} />

        <Card title="Delete account">
          <p className="text-sm leading-6 text-slate-400">
            Deletes your profile, saved resume and saved jobs right away. Applications you already sent stay with those employers; contact them to remove one. Job alert emails are separate: use the unsubscribe link in any alert.
          </p>
          <button type="button" disabled={!!busy} onClick={deleteAccount} className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-2 text-sm font-medium text-rose-300 transition hover:bg-rose-500/20 disabled:opacity-60">
            Delete my account
          </button>
        </Card>
      </div>
    </div>
  )
}

export function SeekerJobsPage() {
  const { token, savedIds } = useSeeker()
  const [applications, setApplications] = useState(null)
  const [saved, setSaved] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!token) return
    Promise.all([seekerApi('/seeker/applications'), seekerApi('/seeker/saved-jobs')])
      .then(([apps, savedJobs]) => {
        setApplications(apps.applications)
        setSaved(savedJobs.jobs)
      })
      .catch((loadError) => setError(loadError.message))
  }, [token])

  if (!token) return <SignInFirst />

  const visibleSaved = (saved || []).filter((job) => savedIds.has(job.job_id))
  const row = 'flex flex-col gap-3 rounded-2xl border border-slate-800 bg-slate-950/60 px-4 py-3 sm:flex-row sm:items-center sm:justify-between'

  return (
    <div className="mx-auto max-w-3xl">
      <Header title="My jobs" subtitle="Applications you sent and jobs you saved." />
      <SeekerNav current="seeker-jobs" />
      <div className="space-y-5">
        {error ? <Notice kind="error">{error}</Notice> : null}
        <Card title="My applications">
          {!applications ? <p className="text-sm text-slate-400">Loading...</p> : applications.length === 0 ? (
            <p className="text-sm text-slate-400">No applications yet.</p>
          ) : applications.map((app) => (
            <div key={app.id} className={row}>
              <div className="min-w-0">
                <button type="button" onClick={() => goTo(`/jobs/${app.job_id}`)} className="break-words text-left font-semibold text-white hover:text-cyan-300">{app.job_title}</button>
                <div className="text-sm text-slate-400">{[app.company, `Applied ${formatDate(app.applied_at)}`].filter(Boolean).join(' • ')}</div>
              </div>
              <span className="self-start rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-xs font-semibold text-cyan-300 sm:self-center">{app.status}</span>
            </div>
          ))}
        </Card>
        <Card title="Saved jobs">
          {!saved ? <p className="text-sm text-slate-400">Loading...</p> : visibleSaved.length === 0 ? (
            <p className="text-sm text-slate-400">Nothing saved yet. Tap Save on any job to keep it here.</p>
          ) : visibleSaved.map((job) => (
            <div key={job.job_id} className={row}>
              <div className="min-w-0">
                {job.closed ? (
                  <span className="break-words font-semibold text-slate-400">{job.title}</span>
                ) : (
                  <button type="button" onClick={() => goTo(`/jobs/${job.job_id}`)} className="break-words text-left font-semibold text-white hover:text-cyan-300">{job.title}</button>
                )}
                <div className="text-sm text-slate-400">{[job.company, job.city].filter(Boolean).join(' • ')}</div>
              </div>
              <div className="flex items-center gap-2">
                {job.closed ? <span className="rounded-full border border-slate-700 px-3 py-1 text-xs font-semibold text-slate-400">Closed</span> : null}
                <SaveJobButton jobId={job.job_id} />
              </div>
            </div>
          ))}
        </Card>
      </div>
    </div>
  )
}

// Bookmark toggle. Signed out, it goes to sign-in and comes back here after.
export function SaveJobButton({ jobId }) {
  const { token, savedIds } = useSeeker()
  const [busy, setBusy] = useState(false)
  const saved = savedIds.has(Number(jobId))
  const Icon = saved ? BookmarkCheck : Bookmark

  async function handleClick(event) {
    event.stopPropagation()
    if (!token) {
      rememberReturn(`${window.location.pathname}${window.location.search}`)
      goTo('/?page=seeker-login')
      return
    }
    setBusy(true)
    try {
      await toggleSaved(jobId)
    } catch {
      /* keep the old state; the button stays usable */
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      onKeyDown={(event) => event.stopPropagation()}
      disabled={busy}
      aria-pressed={saved}
      className={`inline-flex items-center gap-1.5 rounded-2xl border px-3 py-2 text-sm font-medium transition disabled:opacity-60 ${
        saved ? 'border-cyan-400/30 bg-cyan-400/10 text-cyan-300' : 'border-slate-700 bg-slate-900/80 text-slate-300 hover:border-slate-600 hover:text-white'
      }`}
    >
      <Icon className="h-4 w-4" />
      {saved ? 'Saved' : 'Save'}
    </button>
  )
}

// Shown above the guest form on the apply page of an employer-posted job.
export function OneClickApply({ job }) {
  const { token, profile, appliedIds } = useSeeker()
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState('')
  const frame = 'mb-5 rounded-[30px] border border-cyan-400/20 bg-slate-900/85 p-4 shadow-[0_18px_60px_rgba(2,6,23,0.24)] sm:p-6'

  if (!job?.id) return null

  if (!token) {
    return (
      <div className={`${frame} flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between`}>
        <div className="flex items-start gap-3">
          <UserRound className="mt-0.5 h-5 w-5 shrink-0 text-cyan-300" />
          <p className="text-sm leading-6 text-slate-300">Save your resume once and apply to local jobs in one click.</p>
        </div>
        <button
          type="button"
          className={`${primaryButton} w-full sm:w-auto`}
          onClick={() => { rememberReturn(`/jobs/${job.id}/apply`); goTo('/?page=seeker-login') }}
        >
          Sign in
        </button>
      </div>
    )
  }

  if (status === 'done' || appliedIds.has(Number(job.id))) {
    return (
      <div className={`${frame} flex items-start gap-3`}>
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" />
        <p className="text-sm leading-6 text-slate-300">
          {status === 'done' ? `Your application for ${job.title} was sent with your profile.` : 'You already applied to this job.'}{' '}
          <button type="button" className="text-cyan-300 underline" onClick={() => goTo('/?page=seeker-jobs')}>See my applications</button>
        </p>
      </div>
    )
  }

  if (!profile) return null

  if (!profile.has_resume || !profile.full_name) {
    return (
      <div className={`${frame} flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between`}>
        <p className="text-sm leading-6 text-slate-300">Add your name and a PDF resume to your profile to apply in one click.</p>
        <button
          type="button"
          className={`${primaryButton} w-full sm:w-auto`}
          onClick={() => goTo('/?page=seeker-profile')}
        >
          Finish profile
        </button>
      </div>
    )
  }

  async function apply() {
    setStatus('sending')
    setError('')
    try {
      await seekerApi(`/seeker/apply/${job.id}`, { method: 'POST' })
      track('apply_submit', { job_id: job.id })
      markApplied(job.id)
      setStatus('done')
      refreshSeeker()
    } catch (applyError) {
      setError(applyError.message)
      setStatus('idle')
    }
  }

  return (
    <div className={frame}>
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-300">Fastest way</div>
      <p className="mt-2 text-sm leading-6 text-slate-300">
        Send {profile.full_name}, {profile.email}{profile.phone ? `, ${profile.phone}` : ''} and your saved resume ({profile.resume_file_name}) to {job.company}.
      </p>
      {error ? <div className="mt-3"><Notice kind="error">{error}</Notice></div> : null}
      <button type="button" onClick={apply} disabled={status === 'sending'} className={`${primaryButton} mt-4 w-full sm:w-auto`}>
        {status === 'sending' ? 'Sending...' : 'Apply with your profile'}
      </button>
      <p className="mt-3 text-xs text-slate-500">Or fill in the form below to apply with a different resume.</p>
    </div>
  )
}
