// server/jobScraper.js
// Scrapes Edgecombe County, Tarboro, USAJOBS, ECU Health (Tarboro), Edgecombe County
// Public Schools, ABB (Pinetops), the Town of Pinetops and the nearby retail / food / warehouse
// chains (Dollar General, Dollar Tree, Family Dollar, Lowe's, CVS, Walgreens, Tractor Supply,
// Sheetz, Hardee's, Pfizer Rocky Mount), and upserts into job_posts.
// `node server/jobScraper.js --dry-run <source>` fetches one source without a database.
import { deepStrictEqual as assertDeepStrictEqual } from 'node:assert'
import { SITE } from '../shared/site.js'

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
  const go = () => fetch(url, {
    ...opts,
    headers: { 'User-Agent': USER_AGENT, ...opts.headers },
    signal: AbortSignal.timeout(30000),
  })
  const res = await go().catch(() => go()) // one retry on a network error or timeout
  if (!res.ok) throw new Error(`${new URL(url).host} fetch failed: ${res.status}`)
  return res
}

// Chain-employer sources send a browser-like User-Agent; the first set of sources keeps the honest one.
const WEB = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
}
const WEB_JSON = { ...WEB, Accept: 'application/json' }
const WEB_HTML = { ...WEB, Accept: 'text/html' }
const JSON_POST = { ...WEB_JSON, 'Content-Type': 'application/json' }

// Chain sources keep only SITE.towns (case-insensitive); HTML sources that only show a ZIP use SITE.zips.
const TOWNS = Object.keys(SITE.towns)
const townOf = name => TOWNS.find(t => t.toLowerCase() === String(name ?? '').trim().toLowerCase())
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

// Store jobs are 'Retail' / 'Food Service' / 'Manufacturing'; only pharmacist, pharmacy tech/intern and nurse titles are Healthcare.
function chainIndustry(title, fallback) {
  return /\b(pharmacist|pharmacy (tech|technician|intern)|pharm tech|nurse|lpn)\b/i.test(title) ? 'Healthcare' : fallback
}

// One normalized job for the chain sources. Never leaves the description empty or a bare URL.
function chainJob({ title, company, city, industry, source, id, url, desc, type = '', payText }) {
  return {
    job_title: title,
    company,
    city,
    industry: chainIndustry(title, industry),
    employment_type: inferEmploymentType(`${title} ${type}`, desc ?? ''),
    source,
    external_id: String(id).slice(0, 191),
    source_url: url,
    job_description: desc || `${title} at ${company} in ${city}, NC. Apply on ${company}'s site.`,
    expires_at: null,
    ...parsePay(payText ?? desc),
  }
}

// An empty result throws, so runAllScrapers skips "close missing" for that source on a bad day.
function finish(source, jobs, partial) {
  if (!jobs.length) throw new Error(`${source}: no jobs returned; the source may have changed`)
  jobs.partial = partial
  return jobs
}

if (process.argv[1]?.endsWith('jobScraper.js') && process.argv.includes('--self-test')) {
  assertDeepStrictEqual(
    ['Pharmacy Cashier', 'Certified Pharmacy Technician', 'Pharmacist-Sign-On Bonus', 'Shift Lead'].map(t => chainIndustry(t, 'Retail')),
    ['Retail', 'Healthcare', 'Healthcare', 'Retail']
  )
  assertDeepStrictEqual([townOf(' GREENVILLE '), townOf('Nashville')], ['Greenville', undefined])
  console.log('jobScraper chain self-test ok')
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

async function scrapePhenom({ host, lang, country, path, city, source, company, industry, state, headers = { 'Content-Type': 'application/json' } }) {
  // `city` is one town or a list; `state` (chain sites) also filters on the posting's own city/state fields.
  const cities = [].concat(city)
  const res = await fetchOk(`https://${host}/widgets`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      lang, country, deviceType: 'desktop', pageName: 'search-results', ddoKey: 'refineSearch',
      from: 0, size: 50, jobs: true, counts: false, all_fields: ['city'], clearAll: false,
      jdsource: 'facets', pageId: 'page20', siteType: 'external', keywords: '', global: true,
      selected_fields: { ...(state && { state: [state] }), city: cities }, locationData: {},
    }),
  })
  const search = (await res.json())?.refineSearch
  const list = search?.data?.jobs
  if (search?.status !== 200 || !Array.isArray(list)) throw new Error(`${source}: search response not understood`)
  if (!list.length) throw new Error(`${source}: no ${cities.join('/')} jobs returned; the city filter may have changed`)

  const jobs = []
  for (const j of list) {
    // Strict: the posting itself must name the town (multi-site postings included).
    const jobCity = state
      ? j.state === state ? townOf(j.city) : undefined
      : cities.find(c => (j.multi_location ?? [j.location]).some(l => String(l).startsWith(`${c},`)))
    if (!j.jobId || !j.title || !jobCity) continue
    const jobPage = `https://${host}${path}/job/${encodeURIComponent(j.jobId)}`
    if (state) { // chain sites: the search teaser is the description (no page fetch per job)
      jobs.push(chainJob({
        title: j.title, company, city: jobCity, industry, source, id: j.jobId,
        url: j.applyUrl?.replace(/\/apply$/, '') || jobPage,
        desc: j.descriptionTeaser, type: `${j.hiringType ?? ''} ${j.type ?? ''}`, payText: j.salaryRange,
      }))
      continue
    }
    const source_url = jobPage
    let job_description = null
    try {
      const page = await (await fetchOk(source_url)).text()
      const ddo = JSON.parse(page.match(/phApp\.ddo = (\{[\s\S]*?\});\s*phApp\./)?.[1] ?? 'null')
      job_description = htmlToText(ddo?.jobDetail?.data?.job?.description ?? '')
    } catch { /* keep the listing; upsertJob writes a short fallback description */ }
    jobs.push({
      job_title: j.title,
      company: typeof company === 'function' ? company(j) : company,
      city: jobCity,
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

// ── Retail, food and warehouse employers near Tarboro ─────────────────────────
// Entry-level chains for the "Stores & restaurants" chip. Each keeps only SITE.towns
// (or SITE.zips). A thrown error means runAllScrapers skips "close missing".

function scrapeChainPhenom(host, source, company, industry) {
  return scrapePhenom({
    host, lang: 'en_us', country: 'us', path: '/us/en', city: TOWNS, state: 'North Carolina',
    source, company, industry, headers: JSON_POST,
  })
}

// "SALES ASSOCIATE in TARBORO NC S19902" -> "Sales Associate"
function dollarGeneralTitle(raw) {
  const t = decodeEntities(String(raw || '')).replace(/\s+in\s+[A-Z .'-]+\s+NC\s+S\d+\s*$/i, '').trim()
  return t === t.toUpperCase() ? t.toLowerCase().replace(/(^|\s)[a-z]/g, (m) => m.toUpperCase()) : t
}

export function scrapeDollarTree() {
  return scrapeChainPhenom('careers.dollartree.com', 'dollar_tree', 'Dollar Tree', 'Retail')
}

export function scrapeFamilyDollar() {
  return scrapeChainPhenom('careers.familydollar.com', 'family_dollar', 'Family Dollar', 'Retail')
}

export function scrapeLowes() {
  return scrapeChainPhenom('talent.lowes.com', 'lowes', "Lowe's", 'Retail')
}

export function scrapeCvs() {
  return scrapeChainPhenom('jobs.cvshealth.com', 'cvs', 'CVS Health', 'Retail')
}

// Dollar General: Oracle HCM REST, one keyword search per town (the keyword also matches other states).
export async function scrapeDollarGeneral() {
  const host = 'https://ibxwjb.fa.ocs.oraclecloud.com'
  const found = new Map()
  let partial = false
  for (const town of TOWNS) {
    // The keyword also matches other states (Greenville is hundreds of rows), so page: 50 a time, 6 pages max.
    for (let offset = 0; ; offset += 50) {
      const finder = `findReqs;siteNumber=CX_1001,limit=50,offset=${offset},keyword=%22${encodeURIComponent(town)}%22`
      // expand= is required: without it the response has facets but no requisitionList.
      const data = await (await fetchOk(`${host}/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true&expand=requisitionList.secondaryLocations&finder=${finder}`, { headers: WEB_JSON })).json()
      if (!Array.isArray(data?.items)) throw new Error('dollar_general: search response not understood')
      for (const r of data.items[0]?.requisitionList ?? []) {
        const city = townOf(/^([^,]+), NC,/.exec(r.PrimaryLocation ?? '')?.[1])
        if (!city || !r.Id || !r.Title || found.has(String(r.Id))) continue
        found.set(String(r.Id), chainJob({
          title: dollarGeneralTitle(r.Title), company: 'Dollar General', city, industry: 'Retail', source: 'dollar_general',
          id: r.Id, url: `${host}/hcmUI/CandidateExperience/en/sites/CX_1001/job/${r.Id}`, desc: r.ShortDescriptionStr || null,
        }))
      }
      const total = data.items[0]?.TotalJobsCount ?? 0
      if (offset + 50 >= total) break
      if (offset >= 250) { partial = true; break }
      await sleep(300)
    }
    await sleep(300)
  }
  return finish('dollar_general', [...found.values()], partial)
}

// Walgreens: server-rendered list, 15 per page; location is "City, North Carolina".
export async function scrapeWalgreens() {
  const host = 'https://jobs.walgreens.com'
  const found = new Map()
  let pages = 1
  for (let p = 1; p <= pages && p <= 5; p++) {
    const html = await (await fetchOk(`${host}/en/search-jobs/Tarboro%2C%20NC/1242/4/6252001/35.8968/-77.5358/25/2?p=${p}`, { headers: WEB_HTML })).text()
    if (!html.includes('id="search-results-list"')) throw new Error('walgreens: results list not found; page layout may have changed')
    pages = Number(html.match(/data-total-pages="(\d+)"/)?.[1] ?? 1)
    for (const m of html.matchAll(/<a href="([^"]+)" data-job-id="(\d+)">\s*<h2[^>]*>([\s\S]*?)<\/h2>\s*<span class="job-location">([^<]*)<\/span>/g)) {
      const city = townOf(decodeEntities(m[4]).split(',')[0])
      const title = stripTags(m[3])
      if (!city || !title || found.has(m[2])) continue
      found.set(m[2], chainJob({ title, company: 'Walgreens', city, industry: 'Retail', source: 'walgreens', id: m[2], url: new URL(m[1], host).href }))
    }
    if (p < pages) await sleep(300)
  }
  return finish('walgreens', [...found.values()], pages > 5)
}

// Tractor Supply: 25 rows a page for the whole state (not ordered by distance), so walk the
// pages and keep SITE.zips. Rows carry only "City, NC, US, ZIP".
export async function scrapeTractorSupply() {
  const host = 'https://www.tractorsupply.careers'
  const found = new Map()
  let total = 1
  for (let row = 0; row < total && row < 25 * 16; row += 25) {
    const html = await (await fetchOk(`${host}/search/?q=&locationsearch=Tarboro%2C+NC&startrow=${row}`, { headers: WEB_HTML })).text()
    total = Number(html.match(/of <b>(\d+)<\/b>/)?.[1] ?? 0)
    if (!total) throw new Error('tractor_supply: result count not found; page layout may have changed')
    for (const tr of html.split('<tr class="data-row">').slice(1)) {
      const a = /<a href="(\/job\/[^"]+\/(\d+)\/)" class="jobTitle-link">([^<]*)<\/a>/.exec(tr)
      const loc = /<span class="jobLocation">\s*([^<]*?)\s*<\/span>/.exec(tr)?.[1].split(',').map(s => s.trim())
      if (!a || !loc || !SITE.zips.includes(loc[loc.length - 1]) || found.has(a[2])) continue
      found.set(a[2], chainJob({
        title: decodeEntities(a[3]).trim(), company: 'Tractor Supply', city: townOf(loc[0]) ?? loc[0], industry: 'Retail',
        source: 'tractor_supply', id: a[2], url: new URL(a[1], host).href,
      }))
    }
    await sleep(300)
  }
  return finish('tractor_supply', [...found.values()], total > 25 * 16)
}

// Sheetz: JSON search near Tarboro; city arrives upper-case ("GREENVILLE").
export async function scrapeSheetz() {
  const found = new Map()
  let partial = false
  for (let page = 1; ; page++) {
    const data = await (await fetchOk(`https://jobs.sheetz.com/api/jobs?location=Tarboro%2C%20NC&page=${page}`, { headers: WEB_JSON })).json()
    if (!Array.isArray(data?.jobs)) throw new Error('sheetz: search response not understood')
    for (const { data: d } of data.jobs) {
      const city = d?.state === 'North Carolina' ? townOf(d.city) : undefined
      if (!city || !d.req_id || !d.title || found.has(d.req_id)) continue
      found.set(d.req_id, chainJob({
        title: d.title, company: 'Sheetz', city, industry: (d.categories ?? []).some(c => c.name === 'Food Service') ? 'Food Service' : 'Retail',
        source: 'sheetz', id: d.req_id, url: d.apply_url || `https://jobs.sheetz.com/jobs/${d.slug}`,
        desc: htmlToText(d.description ?? ''), type: (d.tags1 ?? []).join(' '), payText: (d.tags4 ?? []).join(' '),
      }))
    }
    if (!data.jobs.length || page * data.jobs.length >= data.totalCount) break
    if (page >= 5) { partial = true; break }
    await sleep(300)
  }
  return finish('sheetz', [...found.values()], partial)
}

// Workday career sites: POST /wday/cxs/<tenant>/<site>/jobs per search term, then the posting's detail JSON.
// locationsText is not always a city ("Hardees of Tarboro"), so a hit must name the town in title or location.
async function scrapeWorkday({ host, tenant, site, towns, source, company, industry }) {
  const api = `https://${host}/wday/cxs/${tenant}/${site}`
  const found = new Map()
  let partial = false
  for (const town of towns) {
    let total = 0
    for (let offset = 0; ; offset += 20) {
      const res = await fetchOk(`${api}/jobs`, { method: 'POST', headers: JSON_POST, body: JSON.stringify({ searchText: town, limit: 20, offset, appliedFacets: {} }) })
      const data = await res.json()
      if (!Array.isArray(data?.jobPostings)) throw new Error(`${source}: search response not understood`)
      if (!offset) total = data.total // later pages report 0
      for (const p of data.jobPostings) {
        const id = String(p.externalPath ?? '').split('/').pop()
        if (!id || !p.title || found.has(id) || !`${p.title} ${p.locationsText}`.toLowerCase().includes(town.toLowerCase())) continue
        let info = null
        try { info = (await (await fetchOk(`${api}${p.externalPath}`, { headers: WEB_JSON })).json())?.jobPostingInfo ?? null } catch { /* keep the listing without details */ }
        found.set(id, chainJob({
          title: p.title, company, city: town, industry, source, id,
          url: `https://${host}/en-US/${site}${p.externalPath}`, desc: htmlToText(info?.jobDescription ?? ''), type: info?.timeType ?? '',
        }))
      }
      if (offset + 20 >= total) break
      if (offset >= 80) { partial = true; break }
    }
    await sleep(300)
  }
  return finish(source, [...found.values()], partial)
}

export function scrapeHardees() {
  return scrapeWorkday({ host: 'bne.wd1.myworkdayjobs.com', tenant: 'bne', site: 'Hardees', towns: TOWNS, source: 'hardees', company: "Hardee's", industry: 'Food Service' })
}

export function scrapePfizerRockyMount() {
  return scrapeWorkday({ host: 'pfizer.wd1.myworkdayjobs.com', tenant: 'pfizer', site: 'PfizerCareers', towns: ['Rocky Mount'], source: 'pfizer_rm', company: 'Pfizer Rocky Mount', industry: 'Manufacturing' })
}

// ── Upsert helper ─────────────────────────────────────────────────────────────

const UPSERT_SQL = `
  INSERT INTO job_posts
    (employer_id, job_title, city, industry, source, external_id, source_url,
     job_description, expires_at, pay_min, pay_max, pay_type,
     employment_type, status, published_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, NOW() + INTERVAL 14 DAY), ?, ?, ?, ?, 'open', NOW())
  ON DUPLICATE KEY UPDATE
    employer_id     = VALUES(employer_id),
    employment_type = VALUES(employment_type),
    job_title       = VALUES(job_title),
    city            = VALUES(city),
    industry        = VALUES(industry),
    source_url      = VALUES(source_url),
    job_description = VALUES(job_description),
    expires_at      = VALUES(expires_at),
    pay_min         = COALESCE(VALUES(pay_min), pay_min),
    pay_max         = COALESCE(VALUES(pay_max), pay_max),
    pay_type        = COALESCE(VALUES(pay_type), pay_type),
    status          = IF(status = 'closed' OR (status = 'expired' AND VALUES(expires_at) > NOW()), 'open', status),
    updated_at      = NOW()
`

// A source closing date wins; otherwise the listing lapses 14 days after the source last showed it.
// Re-seen jobs roll forward, so a job that vanishes from a partial fetch still ages out.
if (process.argv[1]?.endsWith('jobScraper.js') && process.argv.includes('--self-test')) {
  if (!UPSERT_SQL.includes('COALESCE(?, NOW() + INTERVAL 14 DAY)') || !/expires_at\s+= VALUES\(expires_at\),/.test(UPSERT_SQL)) {
    throw new Error('UPSERT_SQL must roll expires_at forward on every sighting')
  }
  console.log('jobScraper upsert expiry self-test ok')
}

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

const SCRAPERS = [
  { name: 'edgecombe_county', fn: scrapeEdgecombeCounty },
  { name: 'tarboro', fn: scrapeTarboro },
  { name: 'usajobs', fn: fetchUSAJOBS },
  { name: 'ecu_health', fn: scrapeEcuHealth },
  { name: 'ecps', fn: scrapeEcps },
  { name: 'abb', fn: scrapeAbbPinetops },
  { name: 'pinetops', fn: scrapePinetops },
  { name: 'dollar_general', fn: scrapeDollarGeneral },
  { name: 'dollar_tree', fn: scrapeDollarTree },
  { name: 'family_dollar', fn: scrapeFamilyDollar },
  { name: 'lowes', fn: scrapeLowes },
  { name: 'cvs', fn: scrapeCvs },
  { name: 'walgreens', fn: scrapeWalgreens },
  { name: 'tractor_supply', fn: scrapeTractorSupply },
  { name: 'sheetz', fn: scrapeSheetz },
  { name: 'hardees', fn: scrapeHardees },
  { name: 'pfizer_rm', fn: scrapePfizerRockyMount },
]

export async function runAllScrapers(pool) {
  let imported = 0
  let updated = 0
  let closed = 0
  const errors = []
  const employerCache = new Map()

  // Idempotent backfill: scraped rows from before rolling expiry get 14 days from their last sighting.
  await pool
    .query(`UPDATE job_posts SET expires_at = updated_at + INTERVAL 14 DAY, updated_at = updated_at WHERE source IS NOT NULL AND status = 'open' AND expires_at IS NULL`)
    .catch((err) => errors.push({ source: 'backfill', error: err.message }))

  for (const { name, fn } of SCRAPERS) {
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

// `node server/jobScraper.js --dry-run <source>`: one source's fetch + normalize, no database.
const dryRun = process.argv.indexOf('--dry-run')
if (process.argv[1]?.endsWith('jobScraper.js') && dryRun !== -1) {
  const entry = SCRAPERS.find(s => s.name === process.argv[dryRun + 1])
  if (!entry) {
    console.error(`unknown source; one of: ${SCRAPERS.map(s => s.name).join(', ')}`)
    process.exit(1)
  }
  entry.fn().then(
    jobs => {
      console.log(`count ${jobs.length} partial ${Boolean(jobs.partial)}`)
      console.log(JSON.stringify(jobs.slice(0, 3), null, 2))
    },
    err => {
      console.error(`error: ${err.message}`)
      process.exit(1)
    }
  )
}
