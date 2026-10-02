// server/jobScraper.js
// Scrapes Edgecombe County, Tarboro, and USAJOBS and upserts into job_posts.

const INDUSTRY_RULES = [
  [/emt|paramedic|firefighter/i, 'Healthcare/Emergency'],
  [/sheriff|deputy|police/i, 'Public Safety'],
  [/social worker|caseworker/i, 'Social Services'],
]

function mapIndustry(title) {
  for (const [re, industry] of INDUSTRY_RULES) {
    if (re.test(title)) return industry
  }
  return 'Government/Public Sector'
}

// Title wins over description; within the description the earliest mention wins.
// Postings that never say default to full-time, which is what these local government jobs are.
function inferEmploymentType(title, text = '') {
  const rules = [
    [/part[\s-]?time|\(pt\)/i, 'part-time'],
    [/temporary|seasonal|intermittent/i, 'temporary'],
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

function stripTags(html) {
  return html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
}

async function fetchPdfText(url) {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
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
    }
    job.employment_type = inferEmploymentType(job.job_title, job.job_description ?? '')
  }
  return jobs
}

// ── Edgecombe County ──────────────────────────────────────────────────────────

export async function scrapeEdgecombeCounty() {
  const res = await fetch('https://www.edgecombecountync.gov/departments/human_resources/job_openings.php')
  if (!res.ok) throw new Error(`Edgecombe fetch failed: ${res.status}`)
  const html = await res.text()

  const listMatch = html.match(/<ul class="file-group">([\s\S]*?)<!--\/\.file-group-->/i)
  if (!listMatch) throw new Error('Edgecombe jobs list not found; page layout may have changed')

  const jobs = []
  const liRe = /<li[^>]*>([\s\S]*?)<\/li>/gi
  let liMatch
  while ((liMatch = liRe.exec(listMatch[1])) !== null) {
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
  const res = await fetch('https://www.tarboro-nc.com/departments/human_resources.php')
  if (!res.ok) throw new Error(`Tarboro fetch failed: ${res.status}`)
  const html = await res.text()

  // Isolate the jobs table body
  const tableMatch = html.match(/<table[^>]*id="jobs-table"[^>]*>([\s\S]*?)<\/table>/i)
  if (!tableMatch) return []

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

    const seen = []
    for (const job of jobs) {
      try {
        const employerId = await getEmployerId(pool, job.company, employerCache)
        const outcome = await upsertJob(pool, job, employerId)
        if (outcome === 'imported') imported++
        else updated++
        seen.push(job.external_id)
      } catch (err) {
        errors.push({ source: name, job: job.external_id, error: err.message })
      }
    }

    // Close postings the source no longer lists (filled/withdrawn). Skip if the fetch came back
    // empty, so a source outage or layout change can't wipe every listing.
    if (seen.length) {
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
