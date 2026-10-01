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

function stripTags(html) {
  return html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
}

// ── Edgecombe County ──────────────────────────────────────────────────────────

export async function scrapeEdgecombeCounty() {
  const res = await fetch('https://www.edgecombecountync.gov/departments/human_resources/job_openings.php')
  if (!res.ok) throw new Error(`Edgecombe fetch failed: ${res.status}`)
  const html = await res.text()

  const jobs = []

  // Each job lives in a <li> inside a <ul class="file-group">
  const liRe = /<li>([\s\S]*?)<\/li>/gi
  let liMatch
  while ((liMatch = liRe.exec(html)) !== null) {
    const block = liMatch[1]

    // Grab the anchor
    const aMatch = block.match(/<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i)
    if (!aMatch) continue
    const href = aMatch[1]
    if (!href.toLowerCase().endsWith('.pdf')) continue  // skip nav/language links
    const rawTitle = stripTags(aMatch[2])
    if (!rawTitle) continue

    // Strip icon text (the span inside the anchor contributes no readable text after stripTags)
    const job_title = rawTitle.replace(/^\s*[\w\s]*icon\s*/i, '').trim() || rawTitle

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

    const source_url = href.startsWith('http') ? href : `https://www.edgecombecountync.gov${href}`
    const external_id = href.replace(/^.*\//, '').replace(/\?.*$/, '') || job_title.slice(0, 60)

    jobs.push({
      job_title,
      city: 'Tarboro',
      industry: mapIndustry(job_title),
      source: 'edgecombe_county',
      external_id,
      source_url,
      job_description: null,
      expires_at,
    })
  }

  return jobs
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

    const source_url = relHref.startsWith('http')
      ? relHref
      : `https://www.tarboro-nc.com/departments/${relHref}`

    // Dates from <td class="jobs-dates"> — first occurrence = post, second = closing
    const dateRe = /<td[^>]*class="jobs-dates"[^>]*>([\s\S]*?)<\/td>/gi
    const allDates = []
    let dm
    while ((dm = dateRe.exec(row)) !== null) {
      allDates.push(stripTags(dm[1]))
    }
    let expires_at = null
    if (allDates[1]) {
      const raw = allDates[1].trim()
      const m = raw.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/)
      if (m) expires_at = `${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`
    }

    const external_id = relHref.replace(/^.*\//, '').replace(/\?.*$/, '') || job_title.slice(0, 60)

    jobs.push({
      job_title,
      city: 'Tarboro',
      industry: mapIndustry(job_title),
      source: 'tarboro',
      external_id,
      source_url,
      job_description: null,
      expires_at,
    })
  }

  return jobs
}

// ── USAJOBS ───────────────────────────────────────────────────────────────────

export async function fetchUSAJOBS() {
  const apiKey = process.env.USAJOBS_API_KEY
  const userAgent = process.env.USAJOBS_USER_AGENT
  if (!apiKey) return [] // skip silently if not configured

  const url = 'https://data.usajobs.gov/api/search?Keyword=&LocationName=Tarboro%2C%20NC&Radius=30'
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
  return items.map(item => {
    const d = item.MatchedObjectDescriptor
    const rem = d.PositionRemuneration?.[0] ?? {}
    const job_title = d.PositionTitle ?? ''
    const city = d.PositionLocation?.[0]?.CityName ?? 'Tarboro'
    return {
      job_title,
      city,
      industry: mapIndustry(job_title),
      source: 'usajobs',
      external_id: d.PositionID ?? d.PositionURI,
      source_url: d.PositionURI ?? '',
      job_description: d.UserArea?.Details?.JobSummary ?? null,
      expires_at: null,
      pay_min: rem.MinimumRange ? parseFloat(rem.MinimumRange) : null,
      pay_max: rem.MaximumRange ? parseFloat(rem.MaximumRange) : null,
      pay_type: rem.RateIntervalCode ?? null,
    }
  })
}

// ── Upsert helper ─────────────────────────────────────────────────────────────

const UPSERT_SQL = `
  INSERT INTO job_posts
    (job_title, city, industry, source, external_id, source_url,
     job_description, expires_at, pay_min, pay_max, pay_type,
     status, published_at, employer_id)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', NOW(), NULL)
  ON DUPLICATE KEY UPDATE
    job_title       = VALUES(job_title),
    city            = VALUES(city),
    industry        = VALUES(industry),
    source_url      = VALUES(source_url),
    job_description = COALESCE(VALUES(job_description), job_description),
    expires_at      = COALESCE(VALUES(expires_at), expires_at),
    pay_min         = COALESCE(VALUES(pay_min), pay_min),
    pay_max         = COALESCE(VALUES(pay_max), pay_max),
    pay_type        = COALESCE(VALUES(pay_type), pay_type),
    updated_at      = NOW()
`

async function upsertJob(pool, job) {
  const [result] = await pool.execute(UPSERT_SQL, [
    job.job_title,
    job.city,
    job.industry,
    job.source,
    job.external_id,
    job.source_url,
    job.job_description ?? null,
    job.expires_at ?? null,
    job.pay_min ?? null,
    job.pay_max ?? null,
    job.pay_type ?? null,
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
  const errors = []

  for (const { name, fn } of scrapers) {
    let jobs
    try {
      jobs = await fn()
    } catch (err) {
      errors.push({ source: name, error: err.message })
      continue
    }

    for (const job of jobs) {
      try {
        const outcome = await upsertJob(pool, job)
        if (outcome === 'imported') imported++
        else updated++
      } catch (err) {
        errors.push({ source: name, job: job.external_id, error: err.message })
      }
    }
  }

  return { imported, updated, errors }
}
