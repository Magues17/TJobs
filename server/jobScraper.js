// server/jobScraper.js
// Scrapes Edgecombe County, Tarboro, USAJOBS, ECU Health (Tarboro), Edgecombe County
// Public Schools, ABB (Pinetops) and the Town of Pinetops, and upserts into job_posts.
import { deepStrictEqual as assertDeepStrictEqual } from 'node:assert'

// Values must come from the site's filter list (src/App.jsx `industries`).
const INDUSTRY_RULES = [
  [/\b(emt|aemt|paramedic|firefighter|fire fighter|sheriff|deputy|police|detention|telecommunicator|911)\b/i, 'Public Safety'],
  [/\b(nurse|rn|lpn|cna|medical|health|pharmac|therap)/i, 'Healthcare'],
]

function mapIndustry(title, fallback = 'Government') {
  for (const [re, industry] of INDUSTRY_RULES) {
    if (re.test(title)) return industry
  }
  return fallback
}

const USER_AGENT = 'TarboroJobs/1.0 (+https://tarborojobs.com)'

async function fetchOk(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: { 'User-Agent': USER_AGENT, ...opts.headers },
    signal: AbortSignal.timeout(30000),
  })
  if (!res.ok) throw new Error(`${new URL(url).host} fetch failed: ${res.status}`)
  return res
}

// Rich-text HTML (ATS job descriptions) to plain text that keeps paragraphs and bullets.
function htmlToText(html) {
  return decodeEntities(html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<br\s*\/?>|<\/(p|div|h\d|ul|ol|tr|li)>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .split('\n')
    .map(line => line.replace(/\s+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 8000) || null
}

// Conservative pay extraction: one clear rate or range with a stated unit, an
// unmistakably annual figure, or a small figure labelled as pay. Bonuses, benefits and
// "up to" amounts are ignored. The same pay stated hourly and annually keeps the first;
// two different rates of one kind (several roles, tiers) → null.
const PAY_UNITS = [
  [/^(hour|hr|hourly)/i, 'hourly'],
  [/^(year|yr|annual|annually)/i, 'salary'],
  [/^(month|monthly|mo)\b/i, 'monthly'],
  [/^(week|weekly|wk)/i, 'weekly'],
  [/^(day|daily)/i, 'daily'],
]
const PAY_LIMITS = { hourly: [7.25, 250], salary: [15000, 500000], monthly: [1200, 40000], weekly: [290, 10000], daily: [58, 2000] }

function parsePay(text) {
  if (!text) return null
  const amount = dollar => String.raw`${dollar}\s?(\d{1,3}(?:,\d{3})+|\d+)(\.\d{1,2})?(?![\d,]*\s*[kKmM]\b)`
  const re = new RegExp(`${amount('\\$')}(?:\\s*(?:-|–|—|to)\\s*${amount('\\$?')})?[\\s(]*(?:(?:\\/|per|an|a)\\s*)?([a-z]+)?`, 'gi')
  const found = []
  for (const m of text.matchAll(re)) {
    // Context = the same sentence/bullet, up to 40 chars back
    const before = text.slice(Math.max(0, m.index - 40), m.index).split(/[\n•;]|\.\s/).pop()
    if (/bonus|incentive|sign[\s-]?on|reimburs|tuition|allowance|stipend|fee|benefit|revenue|up to\s*$/i.test(before)) continue
    const num = (int, dec) => int ? parseFloat(int.replace(/,/g, '') + (dec ?? '')) : null
    const min = num(m[1], m[2])
    const max = num(m[3], m[4])
    let pay_type = PAY_UNITS.find(([u]) => u.test(m[5] ?? ''))?.[1]
    if (!pay_type && min >= 20000) pay_type = 'salary' // "$45,000 - $52,000" with no unit
    if (!pay_type && (max ?? min) < 250 && /pay|wage|rate/i.test(before)) pay_type = 'hourly' // "Pay Range $16.00 - $19.90"
    if (!pay_type) continue
    const [lo, hi] = PAY_LIMITS[pay_type]
    if (min < lo || (max ?? min) > hi || (max ?? min) < min) continue
    // "begins at $38,600" is a floor, not a range
    const pay_max = max ?? (/start|begin|entry|minimum|from\s*$/i.test(before) ? null : min)
    found.push({ pay_min: min, pay_max, pay_type })
  }
  const distinct = [...new Map(found.map(p => [`${p.pay_min}|${p.pay_max}|${p.pay_type}`, p])).values()]
  const types = new Set(distinct.map(p => p.pay_type))
  return distinct.length && types.size === distinct.length ? distinct[0] : null
}

// Run with `node server/jobScraper.js --self-test`.
if (process.argv[1]?.endsWith('jobScraper.js') && process.argv.includes('--self-test')) {
  // No top-level await anywhere in the server's import graph: Hostinger's
  // Passenger loads server.js via require(), which rejects async ESM graphs.
  const eq = assertDeepStrictEqual
  eq(parsePay('Pay: $16.50/hr'), { pay_min: 16.5, pay_max: 16.5, pay_type: 'hourly' })
  eq(parsePay('Salary range $45,000 - $52,000 annually'), { pay_min: 45000, pay_max: 52000, pay_type: 'salary' })
  eq(parsePay('The salary range is $35,100-$52,700 with excellent benefits that total over $11,000 annually'), { pay_min: 35100, pay_max: 52700, pay_type: 'salary' })
  eq(parsePay('Salary: $20.41 – $33.68/hr (Annual Expected Salary $42,453 - $80,563)'), { pay_min: 20.41, pay_max: 33.68, pay_type: 'hourly' })
  eq(parsePay('• EMT: $16.50/hr\n• AEMT: $17.75/hr\n• Paramedic: $20.41/hr'), null)
  eq(parsePay('Pay Range for Staff Nurse II: $34.00-46.75'), { pay_min: 34, pay_max: 46.75, pay_type: 'hourly' })
  eq(parsePay('$7500 Sign-On Bonus. Starting salary begins at $38,600'), { pay_min: 38600, pay_max: null, pay_type: 'salary' })
  eq(parsePay('$30K Commitment Bonus; base pay up to $63 per hour'), null)
  eq(parsePay('$26.75 - $35.99 (hourly)'), { pay_min: 26.75, pay_max: 35.99, pay_type: 'hourly' })
  eq(parsePay('Salary: $145 per day licensed\n$120 per day non-licensed'), null)
  console.log('jobScraper self-test ok')
}

// Title wins over description; within the description the earliest mention wins.
// Postings that never say default to full-time, which is what these local government jobs are.
function inferEmploymentType(title, text = '') {
  const rules = [
    [/part[\s-]?time|\(pt\)/i, 'part-time'],
    [/temporary|seasonal|intermittent|\btemp\b/i, 'temporary'],
    [/full[\s-]?time/i, 'full-time'],
  ]
  for (const [re, type] of rules) if (re.test(title)) return type
  let best = null
  // "temporary" in body text is usually "temporary assignment", not the job's schedule.
  for (const [re, type] of rules.filter(([, type]) => type !== 'temporary')) {
    const i = text.search(re)
    if (i !== -1 && (!best || i < best.i)) best = { i, type }
  }
  return best?.type ?? 'full-time'
}

const NAMED_ENTITIES = {
  nbsp: ' ', amp: '&', quot: '"', apos: "'", lt: '<', gt: '>',
  rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', ndash: '–', mdash: '—', hellip: '…', bull: '•',
}

function decodeEntities(s) {
  return s.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (m, dec, hex, name) => {
    if (name) return NAMED_ENTITIES[name.toLowerCase()] ?? m
    const code = dec ? parseInt(dec, 10) : parseInt(hex, 16)
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m
  })
}

function stripTags(html) {
  return decodeEntities(html.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()
}

async function fetchPdfText(url) {
  try {
    const res = await fetchOk(url)
    const mod = await import('pdf-parse')
    const pdfParse = mod.default || mod
    const { text } = await pdfParse(Buffer.from(await res.arrayBuffer()))
    const lines = text
      .replace(/\s*•\s*/g, '\n• ')
      .split('\n')
      .map(line => line.replace(/\s+/g, ' ').trim())
    // PDFs hard-wrap paragraphs; rejoin a line onto the previous one when the previous
    // line ran long without ending a sentence. Short lines (headings) and bullets stay put.
    const out = []
    for (const line of lines) {
      const prev = out[out.length - 1]
      const continues = (prev?.length > 55 && !/[.:!?]$/.test(prev)) || /^[a-z]/.test(line)
      if (line && prev && continues && !line.startsWith('•')) {
        out[out.length - 1] = `${prev} ${line}`
      } else {
        out.push(line)
      }
    }
    const cleaned = out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
    return cleaned.length > 40 ? cleaned.slice(0, 8000) : null
  } catch {
    return null
  }
}

async function addPdfDescriptions(jobs) {
  for (const job of jobs) {
    if (job.source_url.split('?')[0].toLowerCase().endsWith('.pdf')) {
      job.job_description = await fetchPdfText(job.source_url)
      Object.assign(job, parsePay(job.job_description))
    }
    job.employment_type = inferEmploymentType(job.job_title, job.job_description ?? '')
  }
  return jobs
}

// ── Edgecombe County ──────────────────────────────────────────────────────────

export async function scrapeEdgecombeCounty() {
  const res = await fetchOk('https://www.edgecombecountync.gov/departments/human_resources/job_openings.php')
  const html = await res.text()

  // One file-group per department (Emergency Services, Finance, Health, Sheriff, DSS, ...).
  const groups = [...html.matchAll(/<ul class="file-group">([\s\S]*?)<!--\/\.file-group-->/gi)].map(m => m[1])
  if (!groups.length) throw new Error('Edgecombe jobs list not found; page layout may have changed')

  const jobs = []
  const liRe = /<li[^>]*>([\s\S]*?)<\/li>/gi
  const lists = groups.join('\n')
  let liMatch
  while ((liMatch = liRe.exec(lists)) !== null) {
    const block = liMatch[1]

    const aMatch = block.match(/<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i)
    if (!aMatch) continue
    const href = aMatch[1]
    const path = href.split('?')[0]
    if (!path.toLowerCase().endsWith('.pdf')) continue
    const job_title = stripTags(aMatch[2])
    if (!job_title) continue

    // Posted / expires from doc-file-desc span
    let expires_at = null
    const descMatch = block.match(/<span[^>]*class="doc-file-desc"[^>]*>([\s\S]*?)<\/span>/i)
    if (descMatch) {
      // "Posted 07/28/2024 - Until Filled" or "Posted 07/28/2024 - 08/31/2024"
      const dateStr = stripTags(descMatch[1])
      const expireMatch = dateStr.match(/[-–]\s*(\d{2}\/\d{2}\/\d{4})/)
      if (expireMatch) {
        const [m, d, y] = expireMatch[1].split('/')
        expires_at = `${y}-${m}-${d}`
      }
    }

    jobs.push({
      job_title,
      company: 'Edgecombe County Government',
      city: 'Tarboro',
      industry: mapIndustry(job_title),
      source: 'edgecombe_county',
      external_id: path.slice(-191),
      source_url: new URL(href, 'https://www.edgecombecountync.gov/').href,
      job_description: null,
      expires_at,
    })
  }

  return addPdfDescriptions(jobs)
}

// ── Tarboro ───────────────────────────────────────────────────────────────────

export async function scrapeTarboro() {
  const res = await fetchOk('https://www.tarboro-nc.com/departments/human_resources.php')
  const html = await res.text()

  // Isolate the jobs table body
  const tableMatch = html.match(/<table[^>]*id="jobs-table"[^>]*>([\s\S]*?)<\/table>/i)
  if (!tableMatch) throw new Error('Tarboro jobs table not found; page layout may have changed')

  const jobs = []
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi
  let rowMatch
  while ((rowMatch = rowRe.exec(tableMatch[1])) !== null) {
    const row = rowMatch[1]

    // Title and URL from <h3 class="jobs-title"><a href="...">Title</a></h3>
    const titleMatch = row.match(/<h3[^>]*class="jobs-title"[^>]*>[\s\S]*?<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i)
    if (!titleMatch) continue
    const relHref = titleMatch[1]
    const job_title = stripTags(titleMatch[2])
    if (!job_title) continue

    // Page has <base href="https://www.tarboro-nc.com/">. The detail pages are empty;
    // the real posting is the PDF in .jobs-brief.
    const pdfHref = row.match(/<div class="jobs-brief">[\s\S]*?<a\s[^>]*href=\s*"([^"]+\.pdf[^"]*)"/i)?.[1]
    const source_url = new URL(pdfHref || relHref, 'https://www.tarboro-nc.com/').href

    // Dates from <td class="jobs-dates"> — first = post, second = closing ("Oct 15, 2026" or "Until Filled")
    const dateRe = /<td[^>]*class="jobs-dates"[^>]*>([\s\S]*?)<\/td>/gi
    const allDates = []
    let dm
    while ((dm = dateRe.exec(row)) !== null) {
      allDates.push(stripTags(dm[1]))
    }
    let expires_at = null
    const closing = allDates[1] ? new Date(allDates[1]) : null
    if (closing && !isNaN(closing)) {
      expires_at = `${closing.getFullYear()}-${String(closing.getMonth() + 1).padStart(2, '0')}-${String(closing.getDate()).padStart(2, '0')}`
    }

    const external_id = relHref.replace(/^.*\//, '').replace(/\?.*$/, '') || job_title.slice(0, 60)

    jobs.push({
      job_title,
      company: 'Town of Tarboro',
      city: 'Tarboro',
      industry: mapIndustry(job_title),
      source: 'tarboro',
      external_id,
      source_url,
      job_description: null,
      expires_at,
    })
  }

  return addPdfDescriptions(jobs)
}

// ── USAJOBS ───────────────────────────────────────────────────────────────────

export async function fetchUSAJOBS() {
  const apiKey = process.env.USAJOBS_API_KEY
  const userAgent = process.env.USAJOBS_USER_AGENT
  if (!apiKey) return [] // skip silently if not configured

  const url = 'https://data.usajobs.gov/api/search?LocationName=Tarboro%2C%20NC&Radius=30&RemoteIndicator=False&ResultsPerPage=100'
  const res = await fetch(url, {
    headers: {
      Host: 'data.usajobs.gov',
      'User-Agent': userAgent || 'TarboroJobs/1.0',
      'Authorization-Key': apiKey,
    },
    signal: AbortSignal.timeout(30000),
  })
  if (!res.ok) throw new Error(`USAJOBS fetch failed: ${res.status}`)
  const data = await res.json()

  const items = data?.SearchResult?.SearchResultItems ?? []
  const jobs = []
  for (const item of items) {
    const d = item.MatchedObjectDescriptor
    // Statewide postings list many cities; show the one nearest Tarboro.
    const ncLocation = (d.PositionLocation ?? [])
      .filter(l => l.CountrySubDivisionCode === 'North Carolina')
      .sort((a, b) => milesFromTarboro(a) - milesFromTarboro(b))[0]
    if (!ncLocation || !d.PositionURI || milesFromTarboro(ncLocation) > 40) continue
    const rem = d.PositionRemuneration?.[0] ?? {}
    const job_title = d.PositionTitle ?? ''
    const schedule = [...(d.PositionSchedule ?? []), ...(d.PositionOfferingType ?? [])].map(s => s.Name).join(' ')
    jobs.push({
      job_title,
      employment_type: inferEmploymentType(`${job_title} ${schedule}`),
      company: d.OrganizationName || 'U.S. Federal Government',
      city: ncLocation.CityName?.replace(/,.*$/, '') || 'Tarboro',
      industry: mapIndustry(job_title),
      source: 'usajobs',
      external_id: String(d.PositionID ?? d.PositionURI).slice(0, 191),
      source_url: d.PositionURI,
      job_description: d.UserArea?.Details?.JobSummary ?? null,
      expires_at: d.ApplicationCloseDate ? d.ApplicationCloseDate.slice(0, 10) : null,
      pay_min: rem.MinimumRange ? parseFloat(rem.MinimumRange) : null,
      pay_max: rem.MaximumRange ? parseFloat(rem.MaximumRange) : null,
      pay_type: USAJOBS_PAY_TYPES[rem.RateIntervalCode] ?? null,
    })
  }
  // ponytail: one page only; if the API has more, flag it so the close step is skipped
  jobs.partial = Number(data?.SearchResult?.SearchResultCountAll) > (data?.SearchResult?.SearchResultCount ?? items.length)
  return jobs
}

function milesFromTarboro({ Latitude, Longitude }) {
  if (Latitude == null || Longitude == null) return Infinity
  const rad = x => (x * Math.PI) / 180
  const dLat = rad(Latitude - 35.8968)
  const dLon = rad(Longitude - -77.5358)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(35.8968)) * Math.cos(rad(Latitude)) * Math.sin(dLon / 2) ** 2
  return 3959 * 2 * Math.asin(Math.sqrt(a))
}

const USAJOBS_PAY_TYPES = { PA: 'salary', PH: 'hourly', PD: 'daily', PW: 'weekly', PM: 'monthly' }

// ── Phenom career sites (ECU Health, ABB) ─────────────────────────────────────
// The search page loads its results from POST /widgets (robots.txt only blocks
// /px-widgets); each job page embeds the full posting in `phApp.ddo`.

async function scrapePhenom({ host, lang, country, path, city, source, company, industry }) {
  const res = await fetchOk(`https://${host}/widgets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      lang, country, deviceType: 'desktop', pageName: 'search-results', ddoKey: 'refineSearch',
      from: 0, size: 50, jobs: true, counts: false, all_fields: ['city'], clearAll: false,
      jdsource: 'facets', pageId: 'page20', siteType: 'external', keywords: '', global: true,
      selected_fields: { city: [city] }, locationData: {},
    }),
  })
  const search = (await res.json())?.refineSearch
  const list = search?.data?.jobs
  if (search?.status !== 200 || !Array.isArray(list)) throw new Error(`${source}: search response not understood`)
  if (!list.length) throw new Error(`${source}: no ${city} jobs returned; the city filter may have changed`)

  const jobs = []
  for (const j of list) {
    // Strict: the posting itself must name the town (multi-site postings included).
    if (!j.jobId || !j.title || !(j.multi_location ?? [j.location]).some(l => String(l).startsWith(`${city},`))) continue
    const source_url = `https://${host}${path}/job/${encodeURIComponent(j.jobId)}`
    let job_description = null
    try {
      const page = await (await fetchOk(source_url)).text()
      const ddo = JSON.parse(page.match(/phApp\.ddo = (\{[\s\S]*?\});\s*phApp\./)?.[1] ?? 'null')
      job_description = htmlToText(ddo?.jobDetail?.data?.job?.description ?? '')
    } catch { /* keep the listing; upsertJob writes a short fallback description */ }
    jobs.push({
      job_title: j.title,
      company: typeof company === 'function' ? company(j) : company,
      city,
      industry: mapIndustry(j.title, industry),
      employment_type: inferEmploymentType(`${j.title} ${j.hiringType ?? ''} ${j.type ?? ''}`, job_description ?? ''),
      source,
      external_id: String(j.jobId).slice(0, 191),
      source_url,
      job_description: job_description ?? j.descriptionTeaser ?? null,
      expires_at: null,
      ...parsePay(job_description),
    })
  }
  jobs.partial = search.totalHits > list.length
  return jobs
}

export function scrapeEcuHealth() {
  return scrapePhenom({
    host: 'careers.ecuhealth.org', lang: 'en_us', country: 'us', path: '/us/en',
    city: 'Tarboro', source: 'ecu_health', industry: 'Healthcare',
    company: j => /edgecombe/i.test(j.facility ?? '') ? 'ECU Health Edgecombe Hospital' : 'ECU Health',
  })
}

export function scrapeAbbPinetops() {
  return scrapePhenom({
    host: 'careers.abb', lang: 'en_global', country: 'global', path: '/global/en',
    city: 'Pinetops', source: 'abb', industry: 'Manufacturing', company: 'ABB',
  })
}

// ── Edgecombe County Public Schools (SchoolSpring) ────────────────────────────
// ecps.us "apply" links go to edgecombe.schoolspring.com, a React app backed by this
// public JSON API. Every listing is an ECPS school, so all are in Edgecombe County.

const ECPS_TOWNS = /^(Tarboro|Princeville|Pinetops|Speed|Conetoe|Macclesfield|Leggett|Battleboro|Rocky Mount), North Carolina$/
const SS_API = 'https://api.schoolspring.com/api/Jobs'
const SS_DOMAIN = 'domainName=edgecombe.schoolspring.com'

export async function scrapeEcps() {
  const size = 100
  const res = await fetchOk(`${SS_API}/GetPagedJobsWithSearch?${SS_DOMAIN}&keyword=&location=&category=&gradelevel=&jobtype=&organization=&swLat=&swLon=&neLat=&neLon=&page=1&size=${size}&sortDateAscending=false`)
  const data = await res.json()
  const list = data?.value?.jobsList
  if (!data?.success || !Array.isArray(list)) throw new Error('ecps: job list response not understood')
  if (!list.length) throw new Error('ecps: no jobs returned; the API may have changed')

  const jobs = []
  for (const item of list) {
    const city = ECPS_TOWNS.exec(item.location ?? '')?.[1]
    if (!city || !item.jobId) continue
    let info = null
    if (jobs.length < 58) { // stay under 60 requests per run
      try {
        info = (await (await fetchOk(`${SS_API}/${item.jobId}?${SS_DOMAIN}`)).json())?.value?.jobInfo ?? null
      } catch { /* keep the listing without details */ }
    }
    const job_title = decodeEntities(item.title ?? '').trim()
    if (!job_title) continue
    const school = decodeEntities(item.employer ?? '')
    const body = info?.jobDescription ? htmlToText(info.jobDescription) : null
    const job_description = body && !/^(TBD|Multiple Locations|Edgecombe County Public Schools)$/i.test(school)
      ? `Location: ${school}\n\n${body}`.slice(0, 8000)
      : body
    const close = info?.closeDate?.slice(0, 10)
    const ssPayType = PAY_UNITS.find(([u]) => u.test((info?.payTypeName ?? '').replace(/^per\s+/i, '')))?.[1]
    const statedPay = info?.payMin > 0 && ssPayType
      ? { pay_min: info.payMin, pay_max: info.payMax > 0 ? info.payMax : info.payMin, pay_type: ssPayType }
      : parsePay(body)
    jobs.push({
      job_title,
      company: 'Edgecombe County Public Schools',
      city,
      industry: mapIndustry(job_title, 'Education'),
      employment_type: inferEmploymentType(`${job_title} ${info?.jobTypeName ?? ''} ${info?.shiftType ?? ''}`, body ?? ''),
      source: 'ecps',
      external_id: String(item.jobId),
      source_url: `https://edgecombe.schoolspring.com/?jobid=${item.jobId}`,
      job_description,
      expires_at: close && close < '2049' ? close : null, // 2050-01-01 means "until filled"
      ...statedPay,
    })
  }
  jobs.partial = list.length >= size
  return jobs
}

// ── Town of Pinetops ──────────────────────────────────────────────────────────
// Openings appear as "Job Description <title>" PDFs under Related Documents.

export async function scrapePinetops() {
  const base = 'https://townofpinetopsnc.com/'
  const html = await (await fetchOk(`${base}employment-opportunities`)).text()
  if (!/To apply for any position at the Town of Pinetops/i.test(html)) {
    throw new Error('Pinetops employment page not recognised; page layout may have changed')
  }
  const jobs = []
  for (const m of html.matchAll(/<a\s[^>]*href="([^"]+\.pdf)"[^>]*title="Job Description\s+([^"]+)"/gi)) {
    const job_title = decodeEntities(m[2]).trim()
    const path = m[1]
    jobs.push({
      job_title,
      company: 'Town of Pinetops',
      city: 'Pinetops',
      industry: mapIndustry(job_title),
      source: 'pinetops',
      external_id: path.replace(/^.*\//, '').slice(-191),
      source_url: new URL(path, base).href,
      job_description: null,
      expires_at: null,
    })
  }
  return addPdfDescriptions(jobs)
}

// ── Upsert helper ─────────────────────────────────────────────────────────────

const UPSERT_SQL = `
  INSERT INTO job_posts
    (employer_id, job_title, city, industry, source, external_id, source_url,
     job_description, expires_at, pay_min, pay_max, pay_type,
     employment_type, status, published_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', NOW())
  ON DUPLICATE KEY UPDATE
    employer_id     = VALUES(employer_id),
    employment_type = VALUES(employment_type),
    job_title       = VALUES(job_title),
    city            = VALUES(city),
    industry        = VALUES(industry),
    source_url      = VALUES(source_url),
    job_description = VALUES(job_description),
    expires_at      = COALESCE(VALUES(expires_at), expires_at),
    pay_min         = COALESCE(VALUES(pay_min), pay_min),
    pay_max         = COALESCE(VALUES(pay_max), pay_max),
    pay_type        = COALESCE(VALUES(pay_type), pay_type),
    status          = IF(status = 'closed', 'open', status),
    updated_at      = NOW()
`

// Scraped postings hang off one auto-created, pre-approved employer per organization,
// because public listings require an active, onboarded employer.
async function getEmployerId(pool, name, cache) {
  if (cache.has(name)) return cache.get(name)
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)
  const email = `listings+${slug}@tarborojobs.com`
  const [rows] = await pool.query('SELECT id FROM employers WHERE email = ? LIMIT 1', [email])
  let id = rows[0]?.id
  if (!id) {
    const [ins] = await pool.query(
      `INSERT INTO employers (business_name, email, subscription_status, access_status, onboarding_completed, status)
       VALUES (?, ?, 'active', 'active', 1, 'new')`,
      [name, email]
    )
    id = ins.insertId
  }
  cache.set(name, id)
  return id
}

async function upsertJob(pool, job, employerId) {
  const description = job.job_description ||
    `${job.job_title} with ${job.company}. Full details and application instructions are on the official posting — use the Apply button above.`
  const [result] = await pool.execute(UPSERT_SQL, [
    employerId,
    job.job_title,
    job.city,
    job.industry,
    job.source,
    job.external_id,
    job.source_url,
    description,
    job.expires_at ? `${job.expires_at} 23:59:59` : null,
    job.pay_min ?? null,
    job.pay_max ?? null,
    job.pay_type ?? null,
    job.employment_type,
  ])
  // affectedRows=1 → insert, affectedRows=2 → update (MySQL ON DUPLICATE KEY)
  return result.affectedRows === 1 ? 'imported' : 'updated'
}

// ── Main entry ────────────────────────────────────────────────────────────────

export async function runAllScrapers(pool) {
  const scrapers = [
    { name: 'edgecombe_county', fn: scrapeEdgecombeCounty },
    { name: 'tarboro', fn: scrapeTarboro },
    { name: 'usajobs', fn: fetchUSAJOBS },
    { name: 'ecu_health', fn: scrapeEcuHealth },
    { name: 'ecps', fn: scrapeEcps },
    { name: 'abb', fn: scrapeAbbPinetops },
    { name: 'pinetops', fn: scrapePinetops },
  ]

  let imported = 0
  let updated = 0
  let closed = 0
  const errors = []
  const employerCache = new Map()

  for (const { name, fn } of scrapers) {
    let jobs
    try {
      jobs = await fn()
    } catch (err) {
      errors.push({ source: name, error: err.message })
      continue
    }

    const seen = jobs.map(j => j.external_id)
    for (const job of jobs) {
      try {
        const employerId = await getEmployerId(pool, job.company, employerCache)
        const outcome = await upsertJob(pool, job, employerId)
        if (outcome === 'imported') imported++
        else updated++
      } catch (err) {
        errors.push({ source: name, job: job.external_id, error: err.message })
      }
    }

    // Close postings the source no longer lists (filled/withdrawn). Skip if the fetch came back
    // empty, so a source outage or layout change can't wipe every listing.
    if (seen.length && !jobs.partial) {
      const [res] = await pool.query(
        `UPDATE job_posts SET status = 'closed', updated_at = NOW()
         WHERE source = ? AND status = 'open' AND external_id NOT IN (?)`,
        [name, seen]
      )
      closed += res.affectedRows
    }
  }

  return { imported, updated, closed, errors }
}
