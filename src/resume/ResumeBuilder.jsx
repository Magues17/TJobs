// Free resume builder: five phone-sized screens, a draft kept in localStorage,
// and a printable one-page resume at the end. No account needed to build it.
import { useEffect, useRef, useState } from 'react'
import { SITE } from '../../shared/site.js'
import { buildResumeText, cleanResumeData, emptyResume } from './resumeText.js'
import { track } from '../lib/track'
import { goTo, refreshSeeker, seekerApi, useSeeker } from '../seeker/session'

const API_BASE = (import.meta.env.VITE_API_BASE || '/api').replace(/\/$/, '')
const DRAFT_KEY = 'tj_resume_draft'
const STEPS = 5
const BLANK_JOB = { employer: '', title: '', from: '', to: '', line: '' }
const EDUCATION = ['Some high school', 'High school or GED', 'Some college', 'Degree']
const SHIFTS = ['Days', 'Nights', 'Weekends']
const JOB_TYPES = [['full', 'Full time'], ['part', 'Part time'], ['either', 'Either']]

const fieldClass =
  'w-full min-h-[52px] rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-base text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-cyan-400'
const optionStyle = { backgroundColor: '#020617', color: '#f8fafc' }
const primaryButton =
  'min-h-[48px] rounded-2xl bg-cyan-400 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:opacity-60'
const secondaryButton =
  'min-h-[48px] rounded-2xl border border-slate-700 bg-slate-900/85 px-5 py-3 text-sm font-semibold text-slate-200 transition hover:border-cyan-400/40'

function loadDraft() {
  try {
    const saved = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null')
    if (saved && typeof saved === 'object') {
      const step = Number(saved.step)
      return { step: step >= 1 && step <= STEPS ? step : 1, data: { ...emptyResume(), ...(saved.data || {}) } }
    }
  } catch { /* storage blocked or bad JSON: start fresh */ }
  return { step: 1, data: emptyResume() }
}

const toggle = (list, value) => (list.includes(value) ? list.filter((item) => item !== value) : [...list, value])

function Chip({ on, onClick, children }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`min-h-[44px] rounded-2xl border px-4 py-2 text-sm font-semibold transition ${on ? 'border-cyan-400 bg-cyan-400 text-slate-950' : 'border-slate-700 bg-slate-900/85 text-slate-200 hover:border-cyan-400/40'}`}
    >
      {children}
    </button>
  )
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-slate-300">{label}</span>
      {children}
    </label>
  )
}

function Question({ title, children }) {
  return (
    <div>
      <p className="mb-2 text-sm font-medium text-slate-300">{title}</p>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  )
}

// Draws the plain-text resume as a page, so the sheet, the copy and the saved copy never differ.
function ResumeSheet({ text }) {
  const [head, ...blocks] = text.split('\n\n').map((block) => block.split('\n'))
  return (
    <article className="resume-sheet" aria-label="Your resume">
      <h2>{head[0]}</h2>
      {head[1] ? <p className="resume-contact">{head[1]}</p> : null}
      {blocks.map((lines) => {
        const heading = /^[A-Z][A-Z &]+$/.test(lines[0])
        return (
          <section key={lines[0]}>
            {heading ? <h3>{lines[0]}</h3> : null}
            {(heading ? lines.slice(1) : lines).map((line, index) => (
              <p key={index} className={line.startsWith('  ') ? 'resume-detail' : undefined}>{line.trim()}</p>
            ))}
          </section>
        )
      })}
    </article>
  )
}

function copyText(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text)
  return new Promise((resolve, reject) => {
    const box = document.createElement('textarea')
    box.value = text
    box.setAttribute('readonly', '')
    box.style.position = 'fixed'
    box.style.opacity = '0'
    document.body.appendChild(box)
    box.select()
    const ok = document.execCommand?.('copy')
    document.body.removeChild(box)
    if (ok) resolve()
    else reject(new Error('copy failed'))
  })
}

export default function ResumeBuilder() {
  const [{ step, data }, setDraft] = useState(loadDraft)
  const [error, setError] = useState('')
  const [extraSkill, setExtraSkill] = useState('')
  const [email, setEmail] = useState(data.email)
  const [copied, setCopied] = useState('')
  const [emailStatus, setEmailStatus] = useState('idle')
  const [emailMessage, setEmailMessage] = useState('')
  const started = useRef(false)
  const seeker = useSeeker()

  useEffect(() => {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ step, data })) } catch { /* storage blocked: draft lives in memory only */ }
  }, [step, data])

  useEffect(() => {
    if (step === STEPS) track('resume_done')
    window.scrollTo(0, 0)
  }, [step])

  const update = (patch) => setDraft((draft) => ({ ...draft, data: { ...draft.data, ...patch } }))
  const go = (next) => setDraft((draft) => ({ ...draft, step: next }))

  function next() {
    if (step === 1 && (!data.name.trim() || !data.phone.trim())) {
      setError('Please add your name and phone number so employers can reach you.')
      return
    }
    setError('')
    if (!started.current) {
      started.current = true
      track('resume_started')
    }
    go(step + 1)
  }

  function back() {
    setError('')
    go(step - 1)
  }

  const rows = data.jobs.length ? data.jobs : [BLANK_JOB]
  const setRows = (jobs) => update({ jobs, noExperience: false })
  const setJob = (index, patch) => setRows(rows.map((job, i) => (i === index ? { ...job, ...patch } : job)))

  function addExtraSkill() {
    const skill = extraSkill.replace(/,/g, ' ').trim()
    if (skill && !data.skills.includes(skill)) update({ skills: [...data.skills, skill.slice(0, 80)] })
    setExtraSkill('')
  }

  const resume = cleanResumeData({ ...data, email: email.trim() || data.email })
  const text = buildResumeText(resume)

  async function copy() {
    try {
      await copyText(text)
      setCopied('Copied. Paste it into an email or a message.')
    } catch {
      setCopied('Could not copy. Press and hold the text to copy it.')
    }
  }

  async function saveToAccount() {
    setEmailStatus('sending')
    setEmailMessage('')
    try {
      if (seeker.token) {
        await seekerApi('/seeker/resume-builder', { method: 'PUT', body: { data: resume } })
        refreshSeeker()
        setEmailMessage('Saved to your TarboroJobs account.')
      } else {
        const response = await fetch(`${API_BASE}/seeker/resume-builder/save`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email.trim(), data: resume }),
        })
        const body = await response.json().catch(() => ({}))
        if (!response.ok || !body.success) throw new Error(body.error || 'Could not save your resume. Please try again.')
        setEmailMessage('Check your email — your resume is saved to your TarboroJobs account; the link signs you in.')
      }
      setEmailStatus('done')
    } catch (saveError) {
      setEmailMessage(saveError.message)
      setEmailStatus('idle')
    }
  }

  function findJobs() {
    const slug = data.workType.split(/\W/)[0].toLowerCase()
    goTo(slug ? `/?work=${slug}` : '/')
  }

  const card = 'rounded-[30px] border border-cyan-400/20 bg-slate-900/85 p-4 shadow-[0_18px_60px_rgba(2,6,23,0.24)] sm:p-6'

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">Build a free resume</h1>
      <p className="mt-1 text-sm leading-6 text-slate-400">No resume yet? Answer a few questions and get a clean one-page resume. Free, no account needed.</p>

      <div className="mt-4" aria-label={`Step ${step} of ${STEPS}`}>
        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-cyan-300">Step {step} of {STEPS}</div>
        <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
          <div className="h-full rounded-full bg-cyan-400 transition-all" style={{ width: `${(step / STEPS) * 100}%` }} />
        </div>
      </div>

      <div className={`mt-4 ${card}`}>
        {step === 1 && (
          <div className="grid gap-4">
            <h2 className="text-lg font-semibold text-white">About you</h2>
            <Field label="Full name">
              <input className={fieldClass} autoComplete="name" maxLength={120} value={data.name} onChange={(e) => update({ name: e.target.value })} />
            </Field>
            <Field label="Phone number">
              <input className={fieldClass} type="tel" autoComplete="tel" maxLength={50} value={data.phone} onChange={(e) => update({ phone: e.target.value })} />
            </Field>
            <Field label="Email (optional)">
              <input
                className={fieldClass}
                type="email"
                autoComplete="email"
                maxLength={255}
                value={data.email}
                onChange={(e) => { update({ email: e.target.value }); setEmail(e.target.value) }}
              />
            </Field>
            <Field label="Town">
              <select className={fieldClass} style={{ colorScheme: 'dark' }} value={data.town} onChange={(e) => update({ town: e.target.value })}>
                <option value="" style={optionStyle}>Choose your town</option>
                {[...Object.keys(SITE.towns), 'Other'].map((town) => (
                  <option key={town} value={town} style={optionStyle}>{town}</option>
                ))}
              </select>
            </Field>
          </div>
        )}

        {step === 2 && (
          <div className="grid gap-4">
            <h2 className="text-lg font-semibold text-white">Where have you worked?</h2>
            {data.noExperience ? (
              <div className="grid gap-3">
                <p className="text-sm leading-6 text-slate-300">No problem. Your resume will say you are ready to start your first job.</p>
                <button type="button" className={secondaryButton} onClick={() => update({ noExperience: false })}>Actually, I have worked before</button>
              </div>
            ) : (
              <>
                {rows.map((job, index) => (
                  <div key={index} className="grid gap-3 rounded-2xl border border-slate-800 bg-slate-950/50 p-3">
                    <Field label="Employer">
                      <input className={fieldClass} maxLength={120} placeholder="Company or person you worked for" value={job.employer} onChange={(e) => setJob(index, { employer: e.target.value })} />
                    </Field>
                    <Field label="Job title">
                      <input className={fieldClass} maxLength={120} placeholder="Cashier, cook, stocker..." value={job.title} onChange={(e) => setJob(index, { title: e.target.value })} />
                    </Field>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="From year">
                        <input className={fieldClass} inputMode="numeric" maxLength={4} placeholder="2019" value={job.from} onChange={(e) => setJob(index, { from: e.target.value.replace(/\D/g, '') })} />
                      </Field>
                      <Field label="To year">
                        <input
                          className={fieldClass}
                          inputMode="numeric"
                          maxLength={7}
                          placeholder="2022"
                          disabled={job.to === 'Present'}
                          value={job.to === 'Present' ? 'Present' : job.to}
                          onChange={(e) => setJob(index, { to: e.target.value.replace(/\D/g, '') })}
                        />
                      </Field>
                    </div>
                    <div>
                      <Chip on={job.to === 'Present'} onClick={() => setJob(index, { to: job.to === 'Present' ? '' : 'Present' })}>Still there</Chip>
                    </div>
                    <Field label="What did you do there? (optional)">
                      <input className={fieldClass} maxLength={300} value={job.line} onChange={(e) => setJob(index, { line: e.target.value })} />
                    </Field>
                    {rows.length > 1 && (
                      <button type="button" className="min-h-[44px] text-sm font-semibold text-rose-300" onClick={() => setRows(rows.filter((_, i) => i !== index))}>
                        Remove this job
                      </button>
                    )}
                  </div>
                ))}
                {rows.length < 4 && (
                  <button type="button" className={secondaryButton} onClick={() => setRows([...rows, BLANK_JOB])}>Add a job</button>
                )}
                <button
                  type="button"
                  className="min-h-[56px] rounded-2xl border border-cyan-400/40 bg-cyan-400/10 px-5 py-3 text-base font-semibold text-cyan-200 transition hover:bg-cyan-400/20"
                  onClick={() => { update({ noExperience: true, jobs: [] }); setError(''); go(3) }}
                >
                  I haven&apos;t had a job yet
                </button>
              </>
            )}
          </div>
        )}

        {step === 3 && (
          <div className="grid gap-4">
            <h2 className="text-lg font-semibold text-white">What are you good at?</h2>
            <p className="-mt-2 text-sm text-slate-400">Tap everything that fits.</p>
            {Object.entries(SITE.resumeSkills).map(([group, skills]) => (
              <Question key={group} title={group}>
                {skills.map((skill) => (
                  <Chip key={skill} on={data.skills.includes(skill)} onClick={() => update({ skills: toggle(data.skills, skill) })}>{skill}</Chip>
                ))}
              </Question>
            ))}
            <Question title="Anything else?">
              {data.skills.filter((skill) => !Object.values(SITE.resumeSkills).flat().includes(skill)).map((skill) => (
                <Chip key={skill} on onClick={() => update({ skills: toggle(data.skills, skill) })}>{skill} &times;</Chip>
              ))}
            </Question>
            <div className="flex gap-2">
              <input
                className={fieldClass}
                aria-label="Anything else?"
                maxLength={80}
                placeholder="Type it and press Enter"
                value={extraSkill}
                onChange={(e) => setExtraSkill(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ',') {
                    e.preventDefault()
                    addExtraSkill()
                  }
                }}
              />
              <button type="button" className={secondaryButton} onClick={addExtraSkill}>Add</button>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="grid gap-5">
            <h2 className="text-lg font-semibold text-white">What do you want?</h2>
            <Question title="What kind of work?">
              {SITE.workTypes.map(([label]) => (
                <Chip key={label} on={data.workType === label} onClick={() => update({ workType: data.workType === label ? '' : label })}>{label}</Chip>
              ))}
            </Question>
            <Question title="Hours">
              {JOB_TYPES.map(([value, label]) => (
                <Chip key={value} on={data.jobType === value} onClick={() => update({ jobType: data.jobType === value ? '' : value })}>{label}</Chip>
              ))}
            </Question>
            <Question title="Shifts you can work">
              {SHIFTS.map((shift) => (
                <Chip key={shift} on={data.shifts.includes(shift)} onClick={() => update({ shifts: toggle(data.shifts, shift) })}>{shift}</Chip>
              ))}
            </Question>
            <Question title="Do you have reliable transportation?">
              {[['yes', 'Yes'], ['no', 'No']].map(([value, label]) => (
                <Chip key={value} on={data.transportation === value} onClick={() => update({ transportation: data.transportation === value ? '' : value })}>{label}</Chip>
              ))}
            </Question>
            <Question title="Certifications you have">
              {SITE.resumeCerts.map((cert) => (
                <Chip key={cert} on={data.certs.includes(cert)} onClick={() => update({ certs: toggle(data.certs, cert) })}>{cert}</Chip>
              ))}
            </Question>
            <Field label="Education">
              <select className={fieldClass} style={{ colorScheme: 'dark' }} value={data.education} onChange={(e) => update({ education: e.target.value })}>
                <option value="" style={optionStyle}>Choose one</option>
                {EDUCATION.map((level) => (
                  <option key={level} value={level} style={optionStyle}>{level}</option>
                ))}
              </select>
            </Field>
          </div>
        )}

        {step === 5 && (
          <div className="grid gap-4">
            <h2 className="text-lg font-semibold text-white">Your resume</h2>
            <ResumeSheet text={text} />
            <div className="grid gap-2 sm:grid-cols-2">
              <button type="button" className={primaryButton} onClick={() => window.print()}>Save as PDF</button>
              <button type="button" className={secondaryButton} onClick={copy}>Copy as text</button>
            </div>
            {copied ? <p className="text-sm text-slate-300" role="status">{copied}</p> : null}

            <div className="grid gap-3 rounded-2xl border border-slate-800 bg-slate-950/50 p-3">
              {!seeker.token && (
                <Field label="Email me my resume">
                  <input className={fieldClass} type="email" autoComplete="email" maxLength={255} placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
                </Field>
              )}
              <button type="button" className={primaryButton} disabled={emailStatus !== 'idle' || (!seeker.token && !email.trim())} onClick={saveToAccount}>
                {emailStatus === 'sending' ? 'Saving…' : seeker.token ? 'Save to my account' : 'Email me my resume'}
              </button>
              {emailMessage ? <p className={`text-sm ${emailStatus === 'done' ? 'text-emerald-300' : 'text-rose-300'}`} role="status">{emailMessage}</p> : null}
            </div>

            <button type="button" className={secondaryButton} onClick={findJobs}>Find jobs near me</button>
          </div>
        )}

        {error ? <p className="mt-4 text-sm text-rose-300" role="alert">{error}</p> : null}

        <div className="mt-6 flex gap-3">
          {step > 1 && <button type="button" className={`${secondaryButton} flex-1`} onClick={back}>Back</button>}
          {step < STEPS && <button type="button" className={`${primaryButton} flex-1`} onClick={next}>Next</button>}
        </div>
      </div>
    </div>
  )
}
