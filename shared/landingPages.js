// shared/landingPages.js
// Town and category landing pages. Imported by the server (SEO head, sitemap)
// and by the SPA (route + filtered job list), so both always agree.
//
// Each `match` gets a normalized job: { title, company, city, industry, employmentType, sourceUrl }
// (use toLandingJob to build one from either a DB row or an /api/jobposts item).

// Towns within commuting distance of Tarboro. An empty city means an employer
// posting with no city, which on this board is the Tarboro area.
const NEARBY_TOWNS = [
  'tarboro', 'princeville', 'pinetops', 'speed', 'conetoe', 'leggett', 'macclesfield',
  'battleboro', 'whitakers', 'rocky mount', 'greenville', 'bethel', 'robersonville',
  'scotland neck', 'wilson', 'nashville', 'farmville', 'williamston', 'kinston', 'elm city',
]

const lower = (value) => String(value || '').toLowerCase()
const inTown = (job, towns) => !job.city || towns.some((town) => lower(job.city).includes(town))
const isNearby = (job) => inTown(job, NEARBY_TOWNS)

const HEALTHCARE_TITLE = /\b(nurse|nursing|rn|lpn|cna|medical|health|emt|paramedic|pharmac|therap|dental|clinic|physician|caregiver|hospital)/i
const PUBLIC_SAFETY_TITLE = /\b(sheriff|deputy|police|detention|jailer|firefighter|fire|911|telecommunicator|dispatch|emergency|ems|emt|paramedic|corrections?)\b/i
const GOVERNMENT_EMPLOYER = /\b(county|town of|city of|state of|federal|department of|u\.s\.)/i
const GOVERNMENT_SOURCE = /\.gov\/|usajobs\.gov|tarboro-nc\.com/i

export function toLandingJob(job) {
  return {
    title: job.job_title ?? job.title ?? '',
    company: job.business_name ?? job.company ?? '',
    city: job.city ?? '',
    industry: job.industry ?? '',
    employmentType: lower(job.employment_type ?? job.type),
    sourceUrl: job.source_url ?? '',
  }
}

export const landingPages = [
  {
    slug: 'tarboro-nc-jobs',
    h1: 'Jobs in Tarboro, NC',
    intro:
      'Open positions with employers in Tarboro and Princeville, including Town of Tarboro and Edgecombe County government jobs. Each listing shows the pay when the employer provides it, the closing date, and how to apply.',
    title: 'Jobs in Tarboro, NC | TarboroJobs',
    description: 'Current job openings in Tarboro and Princeville, NC: town and county government, local employers, pay and closing dates listed.',
    match: (job) => inTown(job, ['tarboro', 'princeville']),
  },
  {
    slug: 'part-time-jobs-tarboro-nc',
    h1: 'Part-Time Jobs in Tarboro, NC',
    intro:
      'Part-time openings in Tarboro and the surrounding Edgecombe County area. These roles work fewer than full-time hours and suit students, retirees, and anyone adding a second job.',
    title: 'Part-Time Jobs in Tarboro, NC | TarboroJobs',
    description: 'Part-time job openings in Tarboro and Edgecombe County, NC, with pay, schedules and closing dates.',
    match: (job) => isNearby(job) && job.employmentType === 'part-time',
  },
  {
    slug: 'full-time-jobs-tarboro-nc',
    h1: 'Full-Time Jobs in Tarboro, NC',
    intro:
      'Full-time positions in Tarboro and nearby towns. Many are local government jobs that come with state retirement and health insurance; check each posting for the benefits offered.',
    title: 'Full-Time Jobs in Tarboro, NC | TarboroJobs',
    description: 'Full-time job openings in Tarboro and Edgecombe County, NC, including government jobs with benefits.',
    match: (job) => isNearby(job) && job.employmentType === 'full-time',
  },
  {
    slug: 'healthcare-jobs-edgecombe-county',
    h1: 'Healthcare Jobs in Edgecombe County, NC',
    intro:
      'Nursing, EMS, and other healthcare openings in Edgecombe County and the Tarboro area. Licensed roles list the certification they require in the full posting.',
    title: 'Healthcare Jobs in Edgecombe County, NC | TarboroJobs',
    description: 'Healthcare, nursing and EMS job openings in Edgecombe County and Tarboro, NC.',
    match: (job) => isNearby(job) && (/health/i.test(job.industry) || HEALTHCARE_TITLE.test(job.title)),
  },
  {
    slug: 'government-jobs-edgecombe-county',
    h1: 'Government Jobs in Edgecombe County, NC',
    intro:
      'Openings with Edgecombe County, the Town of Tarboro, and federal agencies near Tarboro. Applications for these jobs are made on the government employer’s own site, and each listing links to the official posting.',
    title: 'Government Jobs in Edgecombe County & Tarboro, NC | TarboroJobs',
    description: 'County, town and federal government job openings in Edgecombe County and Tarboro, NC, with links to the official postings.',
    match: (job) =>
      isNearby(job) &&
      (/government|public safety|social services/i.test(job.industry) ||
        GOVERNMENT_EMPLOYER.test(job.company) ||
        GOVERNMENT_SOURCE.test(job.sourceUrl)),
  },
  {
    slug: 'public-safety-jobs-edgecombe-county',
    h1: 'Public Safety Jobs in Edgecombe County, NC',
    intro:
      'Sheriff’s office, detention, 911 communications, fire, and EMS openings in Edgecombe County and Tarboro. Most of these positions require a background check and some require certification after hire.',
    title: 'Public Safety Jobs in Edgecombe County, NC | TarboroJobs',
    description: 'Sheriff, detention, 911, fire and EMS job openings in Edgecombe County and Tarboro, NC.',
    match: (job) => isNearby(job) && (/public safety|emergency/i.test(job.industry) || PUBLIC_SAFETY_TITLE.test(job.title)),
  },
  {
    slug: 'jobs-near-tarboro-nc',
    h1: 'Jobs Near Tarboro, NC',
    intro:
      'Jobs within commuting distance of Tarboro, including Rocky Mount, Greenville, and the rest of Edgecombe and Pitt counties. Federal positions in the Greenville and Rocky Mount area are included and link to USAJOBS for applying.',
    title: 'Jobs Near Tarboro, NC: Rocky Mount, Greenville & Edgecombe County | TarboroJobs',
    description: 'Job openings near Tarboro, NC, including Rocky Mount, Greenville and federal jobs in the area.',
    match: isNearby,
  },
].map((page) => ({ ...page, path: `/${page.slug}` }))

export function findLandingPage(pathname) {
  const slug = String(pathname || '').replace(/^\/+|\/+$/g, '')
  return landingPages.find((page) => page.slug === slug) || null
}

export function landingJobs(page, jobs) {
  return jobs.filter((job) => page.match(toLandingJob(job)))
}
