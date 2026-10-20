// server/seo.js
// Server-rendered <head> for the SPA's HTML responses, plus /sitemap.xml.
// The SPA still renders the page body; this only gives crawlers and link
// previews a real title, description, canonical URL and structured data.

import fs from 'fs'
import { landingPages, findLandingPage, landingJobs } from '../shared/landingPages.js'

const SITE_NAME = 'TarboroJobs'
const HOME_TITLE = 'Jobs in Tarboro, NC & Edgecombe County | TarboroJobs'
const HOME_DESCRIPTION =
  'Local job board for Tarboro and Edgecombe County, NC. Browse open jobs with pay, closing dates and direct apply links, from local employers, town and county government, and nearby federal agencies.'
const LIST_CACHE_MS = 10 * 60 * 1000
const OG_IMAGE = { path: '/og-image.png', width: 1200, height: 630 }

// ?page= routes worth indexing; any other ?page= (dashboards, logins, results) is noindex.
const QUERY_PAGES = {
  'privacy-policy': ['Privacy Policy | TarboroJobs', 'How TarboroJobs collects, uses, shares and protects information submitted through the site.'],
  'terms-of-use': ['Terms of Use | TarboroJobs', 'The terms that apply to job seekers and employers using TarboroJobs.'],
  'employer-posting-rules': ['Employer Posting Rules | TarboroJobs', 'What employers may and may not post on TarboroJobs, and how postings are reviewed.'],
  'resume-checker': ['Resume Checker | TarboroJobs', 'Check your resume against what hiring managers and applicant tracking systems look for, with a free preview.'],
  'cover-letter': ['Cover Letter Writer | TarboroJobs', 'Generate a cover letter written for a specific job posting.'],
  'interview-prep': ['Interview Prep | TarboroJobs', 'Practice questions and talking points for a specific job before your interview.'],
}

const EMPLOYMENT_TYPES = { 'full-time': 'FULL_TIME', 'part-time': 'PART_TIME', temporary: 'TEMPORARY', contract: 'CONTRACTOR' }
const PAY_UNITS = { hourly: 'HOUR', salary: 'YEAR', daily: 'DAY', weekly: 'WEEK', monthly: 'MONTH' }
const TYPE_LABELS = { 'full-time': 'Full-time', 'part-time': 'Part-time', temporary: 'Temporary', contract: 'Contract' }

const escapeHtml = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

// JSON inside <script>: escaping < > & means "</script>" or "<!--" in any field cannot end the tag.
const jsonForScript = (value) =>
  JSON.stringify(value).replace(/[<>&]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)

function toIso(value) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

const plain = (text) => String(text || '').replace(/\s+/g, ' ').trim()

function clip(text, max = 160) {
  const value = plain(text)
  if (value.length <= max) return value
  return `${value.slice(0, max - 1).replace(/\s+\S*$/, '')}…`
}

const positive = (value) => (value !== null && value !== undefined && Number(value) > 0 ? Number(value) : null)

// Plain-text job description -> HTML: blank lines split paragraphs, single newlines become <br>.
function descriptionHtml(job) {
  const text = String(job.job_description || '').replace(/\r\n?/g, '\n').trim()
  if (!text) {
    const where = job.city ? ` in ${job.city}, NC` : ''
    const more = job.source_url ? ` The full posting is on the employer's site: ${job.source_url}` : ''
    return `<p>${escapeHtml(`${job.job_title} with ${job.business_name}${where}.${more}`)}</p>`
  }
  return text
    .split(/\n{2,}/)
    .map((para) => `<p>${para.split('\n').map(escapeHtml).join('<br>')}</p>`)
    .join('\n')
}

// Google job posting structured data:
// https://developers.google.com/search/docs/appearance/structured-data/job-posting
export function jobPostingJsonLd(job, baseUrl) {
  const data = {
    '@context': 'https://schema.org/',
    '@type': 'JobPosting',
    title: plain(job.job_title),
    description: descriptionHtml(job),
    identifier: { '@type': 'PropertyValue', name: job.business_name || SITE_NAME, value: String(job.id) },
    datePosted: toIso(job.published_at || job.created_at),
    hiringOrganization: { '@type': 'Organization', name: job.business_name || SITE_NAME },
    jobLocation: {
      '@type': 'Place',
      address: {
        '@type': 'PostalAddress',
        addressLocality: plain(job.city) || 'Tarboro',
        addressRegion: 'NC',
        addressCountry: 'US',
      },
    },
    directApply: !job.source_url,
    url: `${baseUrl}/jobs/${job.id}`,
  }

  const validThrough = toIso(job.expires_at)
  if (validThrough) data.validThrough = validThrough

  const employmentType = EMPLOYMENT_TYPES[job.employment_type]
  if (employmentType) data.employmentType = employmentType

  const min = positive(job.pay_min)
  const max = positive(job.pay_max)
  const unitText = PAY_UNITS[job.pay_type]
  if (min && unitText) {
    data.baseSalary = {
      '@type': 'MonetaryAmount',
      currency: 'USD',
      value:
        max && max > min
          ? { '@type': 'QuantitativeValue', minValue: min, maxValue: max, unitText }
          : { '@type': 'QuantitativeValue', value: min, unitText },
    }
  }

  return data
}

function jobDescriptionMeta(job, formatPay) {
  const parts = [
    `${TYPE_LABELS[job.employment_type] || 'Open'} job with ${job.business_name || 'a local employer'} in ${job.city || 'Tarboro'}, NC.`,
  ]
  const pay = formatPay?.(job.pay_min, job.pay_max, job.pay_type)
  if (pay) parts.push(`Pay: ${pay}.`)
  if (job.job_description) parts.push(plain(job.job_description))
  return clip(parts.join(' '))
}

function headTags({ title, description, canonical, robots, ogType = 'website', jsonLd = [], baseUrl }) {
  const tags = [`<title>${escapeHtml(title)}</title>`]
  if (description) tags.push(`<meta name="description" content="${escapeHtml(description)}" />`)
  if (robots) tags.push(`<meta name="robots" content="${escapeHtml(robots)}" />`)
  if (canonical) tags.push(`<link rel="canonical" href="${escapeHtml(canonical)}" />`)
  const og = {
    'og:site_name': SITE_NAME,
    'og:type': ogType,
    'og:title': title,
    'og:description': description,
    'og:url': canonical,
    'og:image': `${baseUrl}${OG_IMAGE.path}`,
    'og:image:width': OG_IMAGE.width,
    'og:image:height': OG_IMAGE.height,
  }
  for (const [property, content] of Object.entries(og)) {
    if (content) tags.push(`<meta property="${property}" content="${escapeHtml(content)}" />`)
  }
  tags.push('<meta name="twitter:card" content="summary_large_image" />')
  tags.push(`<meta name="twitter:title" content="${escapeHtml(title)}" />`)
  if (description) tags.push(`<meta name="twitter:description" content="${escapeHtml(description)}" />`)
  tags.push(`<meta name="twitter:image" content="${escapeHtml(`${baseUrl}${OG_IMAGE.path}`)}" />`)
  for (const data of jsonLd) tags.push(`<script type="application/ld+json">${jsonForScript(data)}</script>`)
  return tags.join('\n    ')
}

// Replaces the template's <title> with the generated head tags.
export function injectHead(template, head) {
  const withoutTitle = template.replace(/<title>[\s\S]*?<\/title>\s*/i, '')
  return withoutTitle.replace(/<\/head>/i, `  ${head}\n  </head>`)
}

function homeJsonLd(baseUrl) {
  return [
    { '@context': 'https://schema.org', '@type': 'Organization', name: SITE_NAME, url: `${baseUrl}/` },
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: SITE_NAME,
      url: `${baseUrl}/`,
      description: HOME_DESCRIPTION,
    },
  ]
}

// Decides status + head for one request. `loaders` is { findJob(id), listJobs() };
// either may throw, and the caller falls back to the plain index.html.
export async function pageFor(pathname, search, { baseUrl, findJob, listJobs, formatPay }) {
  const path = String(pathname || '/').replace(/\/+$/, '') || '/'
  const params = new URLSearchParams(search || '')
  const common = { baseUrl }

  const jobMatch = path.match(/^\/jobs\/(\d+)(\/apply)?$/)
  if (jobMatch) {
    const job = await findJob(Number(jobMatch[1]))
    if (!job) {
      return {
        status: 404,
        head: headTags({ ...common, title: `Job not available | ${SITE_NAME}`, robots: 'noindex' }),
      }
    }
    const canonical = `${baseUrl}/jobs/${job.id}`
    const where = job.city ? ` in ${plain(job.city)}, NC` : ''
    const title = `${plain(job.job_title)} - ${plain(job.business_name)}${where} | ${SITE_NAME}`
    const description = jobDescriptionMeta(job, formatPay)
    if (jobMatch[2]) {
      return { status: 200, head: headTags({ ...common, title: `Apply: ${title}`, description, canonical, robots: 'noindex' }) }
    }
    return {
      status: 200,
      head: headTags({ ...common, title, description, canonical, ogType: 'article', jsonLd: [jobPostingJsonLd(job, baseUrl)] }),
    }
  }

  const landing = findLandingPage(path)
  if (landing) {
    const jobs = landingJobs(landing, await listJobs())
    const itemList = {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      name: landing.h1,
      itemListElement: jobs.map((job, index) => ({ '@type': 'ListItem', position: index + 1, url: `${baseUrl}/jobs/${job.id}` })),
    }
    return {
      status: 200,
      head: headTags({ ...common, title: landing.title, description: landing.description, canonical: `${baseUrl}${landing.path}`, jsonLd: [itemList] }),
    }
  }

  if (path === '/') {
    const page = params.get('page')
    if (!page && !params.has('token')) {
      return {
        status: 200,
        head: headTags({ ...common, title: HOME_TITLE, description: HOME_DESCRIPTION, canonical: `${baseUrl}/`, jsonLd: homeJsonLd(baseUrl) }),
      }
    }
    if (QUERY_PAGES[page]) {
      const [title, description] = QUERY_PAGES[page]
      return { status: 200, head: headTags({ ...common, title, description, canonical: `${baseUrl}/?page=${page}` }) }
    }
  }

  // Dashboards, logins, tokens, result pages, unknown paths: render, but keep out of the index.
  return { status: 200, head: headTags({ ...common, title: HOME_TITLE, robots: 'noindex' }) }
}

const xmlEscape = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c])

export function buildSitemap(jobs, baseUrl) {
  const urls = [
    { loc: `${baseUrl}/`, changefreq: 'daily', priority: '1.0' },
    ...landingPages.map((page) => ({ loc: `${baseUrl}${page.path}`, changefreq: 'daily', priority: '0.8' })),
    ...jobs.map((job) => ({
      loc: `${baseUrl}/jobs/${job.id}`,
      lastmod: toIso(job.updated_at || job.published_at || job.created_at),
      priority: '0.7',
    })),
    ...['resume-checker', 'cover-letter', 'interview-prep'].map((page) => ({ loc: `${baseUrl}/?page=${page}`, changefreq: 'monthly', priority: '0.5' })),
    ...['privacy-policy', 'terms-of-use', 'employer-posting-rules'].map((page) => ({ loc: `${baseUrl}/?page=${page}`, changefreq: 'monthly', priority: '0.3' })),
  ]
  const body = urls
    .map(({ loc, lastmod, changefreq, priority }) =>
      [
        '  <url>',
        `    <loc>${xmlEscape(loc)}</loc>`,
        lastmod && `    <lastmod>${lastmod}</lastmod>`,
        changefreq && `    <changefreq>${changefreq}</changefreq>`,
        `    <priority>${priority}</priority>`,
        '  </url>',
      ]
        .filter(Boolean)
        .join('\n')
    )
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`
}

// Express handlers. listJobs is cached ~10 minutes (landing pages + sitemap);
// single job lookups are not cached so a closed job 404s right away.
export function createSeo({ indexFile, baseUrl, findJob, listJobs, formatPay, log = console }) {
  let template = null
  let cached = { at: 0, jobs: null }

  async function cachedJobs() {
    if (cached.jobs && Date.now() - cached.at < LIST_CACHE_MS) return cached.jobs
    const jobs = await listJobs()
    cached = { at: Date.now(), jobs }
    return jobs
  }

  const siteBase = (req) => String(baseUrl || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '')

  async function page(req, res, next) {
    try {
      // index.html only changes on deploy, which restarts the server.
      template ??= fs.readFileSync(indexFile, 'utf8')
    } catch (error) {
      return next(error)
    }
    let result
    try {
      const search = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : ''
      result = await pageFor(req.path, search, { baseUrl: siteBase(req), findJob, listJobs: cachedJobs, formatPay })
    } catch (error) {
      log.error(`SEO head for ${req.path} failed, serving plain index.html:`, error?.message || error)
      return res.type('html').send(template)
    }
    res.status(result.status).type('html').send(injectHead(template, result.head))
  }

  async function sitemap(req, res, next) {
    try {
      res.type('application/xml').set('Cache-Control', 'public, max-age=600').send(buildSitemap(await cachedJobs(), siteBase(req)))
    } catch (error) {
      next(error)
    }
  }

  return { page, sitemap }
}
