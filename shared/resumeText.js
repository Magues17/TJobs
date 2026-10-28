// Free resume builder, shared by the client (src/resume) and the server (seekers.js).
// Plain ESM, pure functions, no top-level await.
const JOB_TYPE_WORDS = { full: 'full time', part: 'part time', either: 'full or part time' }

export function emptyResume() {
  return {
    name: '', phone: '', email: '', town: '',
    jobs: [], noExperience: false,
    skills: [],
    workType: '', jobType: '', shifts: [], transportation: '', certs: [], education: '',
  }
}

const str = (value, max) => String(value ?? '').replace(/\p{Cc}+/gu, ' ').trim().slice(0, max)
const list = (value, max) => (Array.isArray(value) ? value : []).slice(0, 40).map((item) => str(item, max)).filter(Boolean)
const pick = (value, allowed) => (allowed.includes(value) ? value : '')

// Trims every field to a sane length and drops unknown keys; always returns a full shape.
export function cleanResumeData(data) {
  const d = data && typeof data === 'object' && !Array.isArray(data) ? data : {}
  return {
    name: str(d.name, 120), phone: str(d.phone, 50), email: str(d.email, 255), town: str(d.town, 120),
    jobs: (Array.isArray(d.jobs) ? d.jobs : []).slice(0, 4)
      .map((job) => ({ employer: str(job?.employer, 120), title: str(job?.title, 120), from: str(job?.from, 12), to: str(job?.to, 12), line: str(job?.line, 300) }))
      .filter((job) => job.employer || job.title),
    noExperience: d.noExperience === true,
    skills: list(d.skills, 80),
    workType: str(d.workType, 80), jobType: pick(d.jobType, ['full', 'part', 'either']),
    shifts: list(d.shifts, 40), transportation: pick(d.transportation, ['yes', 'no']),
    certs: list(d.certs, 80), education: str(d.education, 80),
  }
}

export function isResumeComplete(data) {
  const d = cleanResumeData(data)
  return !!(d.name && d.phone && (d.skills.length || d.jobs.length))
}

const yearOf = (value) => (/present/i.test(value) ? 9999 : parseInt(value, 10) || 0)

function dates(job) {
  if (job.from && job.to) return `${job.from}\u2013${job.to}`
  return job.from || job.to
}

export function buildResumeText(data) {
  const d = cleanResumeData(data)
  const out = []
  const section = (heading, lines) => {
    if (lines.length) out.push('', heading, ...lines)
  }

  out.push((d.name || 'Your name').toUpperCase())
  const contact = [d.phone, d.email, d.town].filter(Boolean).join(' \u00b7 ')
  if (contact) out.push(contact)

  const looking = [d.workType, JOB_TYPE_WORDS[d.jobType]].filter(Boolean).join(', ')
  if (looking) out.push('', `Looking for: ${looking}`)

  section('SKILLS', d.skills.length ? [d.skills.join(', ')] : [])

  const jobs = [...d.jobs].sort((a, b) => yearOf(b.to || b.from) - yearOf(a.to || a.from) || yearOf(b.from) - yearOf(a.from))
  section('EXPERIENCE', jobs.length
    ? jobs.flatMap((job) => {
        const head = [job.employer, job.title].filter(Boolean).join(' \u2014 ')
        const when = dates(job)
        return [when ? `${head} (${when})` : head, ...(job.line ? [`  ${job.line}`] : [])]
      })
    : ['Ready to start my first job'])

  section('CERTIFICATIONS & EDUCATION', [d.certs.join(', '), d.education].filter(Boolean))

  section('AVAILABILITY', [
    d.shifts.length ? `Shifts: ${d.shifts.join(', ')}` : '',
    d.transportation ? `Reliable transportation: ${d.transportation === 'yes' ? 'Yes' : 'No'}` : '',
  ].filter(Boolean))

  return out.join('\n')
}
