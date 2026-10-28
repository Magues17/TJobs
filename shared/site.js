// Everything town-specific lives here so the site can be cloned for another city.
// Plain ESM, no Node-only imports: imported by both server/server.js and the Vite client.
export const SITE = {
  name: 'TarboroJobs',
  domain: 'tarborojobs.com',
  region: 'Tarboro & Edgecombe County',
  state: 'NC',
  // "near you" tiers: 0 = home town(s), 1 = same county / 10 min, 2 = commute, 3 = far
  towns: { Tarboro: 0, Princeville: 0, Pinetops: 1, Conetoe: 1, Leggett: 1, Speed: 1, Macclesfield: 1, Battleboro: 1, Whitakers: 1, 'Rocky Mount': 2, Wilson: 2, Greenville: 3 },
  farTier: 3, // unknown towns
  // Shown after the city on the job page, by tier.
  tierWords: { 0: '', 1: 'near Tarboro', 2: 'commute', 3: '45+ min' },
  // Home-page "What kind of work?" chips: [label, industries]. Industry values must match
  // the `industries` list in src/App.jsx. The ?work= slug is the label's first word, lowercased.
  workTypes: [
    ['Factory & warehouse', ['Manufacturing', 'Transportation']],
    ['Healthcare', ['Healthcare']],
    ['Schools', ['Education']],
    ['Stores & restaurants', ['Retail', 'Food Service', 'Hospitality']],
    ['Office & government', ['Government', 'Public Safety', 'Professional Services', 'Information Technology']],
    ['Construction & trades', ['Construction']],
  ],
}

const norm = (value) => String(value ?? '').trim().toLowerCase()

export function townTier(city, site = SITE) {
  const key = norm(city)
  const hit = Object.keys(site.towns).find((town) => norm(town) === key)
  return hit === undefined ? site.farTier : site.towns[hit]
}

const time = (row) => new Date(row.published_at || row.created_at || 0).getTime() || 0

// Featured first, then nearest town, then jobs that show pay, then newest.
export function nearYouOrder(rows, site = SITE) {
  const key = (row) => [
    Number(row.is_featured) === 1 ? 0 : 1,
    townTier(row.city, site),
    row.pay_min !== null && row.pay_min !== undefined ? 0 : 1,
  ]
  return [...rows].sort((a, b) => {
    const ka = key(a)
    const kb = key(b)
    for (let i = 0; i < ka.length; i += 1) if (ka[i] !== kb[i]) return ka[i] - kb[i]
    return time(b) - time(a)
  })
}
