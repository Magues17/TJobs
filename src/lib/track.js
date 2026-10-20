// First-party, cookie-free usage events. Anonymous random ids only; honours
// Do Not Track and Global Privacy Control by sending nothing.
const API_BASE = (import.meta.env.VITE_API_BASE || '/api').replace(/\/$/, '')
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

function randomId(length) {
  const bytes = new Uint8Array(length)
  try { crypto.getRandomValues(bytes) } catch { bytes.forEach((_, i) => { bytes[i] = Math.floor(Math.random() * 256) }) }
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('')
}

function stored(storage, key, make) {
  try {
    let value = storage.getItem(key)
    if (!value) { value = make(); storage.setItem(key, value) }
    return value
  } catch {
    return null
  }
}

// Fallback ids live only for this page load when storage is blocked.
const memory = { visitor: randomId(26), session: randomId(16) }

function optedOut() {
  return navigator.doNotTrack === '1' || window.doNotTrack === '1' || navigator.globalPrivacyControl === true
}

function device() {
  const ua = navigator.userAgent || ''
  if (/iPad|Tablet/i.test(ua) || (window.innerWidth >= 640 && window.innerWidth < 1024 && /Android/i.test(ua))) return 'tablet'
  if (/Mobi|iPhone|Android/i.test(ua) || window.innerWidth < 640) return 'mobile'
  return 'desktop'
}

function utm() {
  const params = new URLSearchParams(window.location.search)
  if (params.get('utm_source') || params.get('utm_medium') || params.get('utm_campaign')) {
    const found = JSON.stringify({
      utm_source: params.get('utm_source'),
      utm_medium: params.get('utm_medium'),
      utm_campaign: params.get('utm_campaign'),
    })
    try { sessionStorage.setItem('tj_utm', found) } catch { /* storage blocked */ }
    return JSON.parse(found)
  }
  try { return JSON.parse(sessionStorage.getItem('tj_utm') || '{}') } catch { return {} }
}

let referrerSent = false // document.referrer never changes in an SPA: report it once per page load
function referrerHost() {
  if (referrerSent) return null
  referrerSent = true
  try {
    const host = new URL(document.referrer).hostname
    return host && host !== window.location.hostname ? host : null
  } catch {
    return null
  }
}

export function track(type, props = {}) {
  try {
    if (typeof window === 'undefined' || optedOut()) return
    const body = JSON.stringify({
      type,
      path: window.location.pathname,
      referrer_host: referrerHost(),
      ...utm(),
      device: device(),
      visitor_id: stored(localStorage, 'tj_vid', () => randomId(26)) || memory.visitor,
      session_id: stored(sessionStorage, 'tj_sid', () => randomId(16)) || memory.session,
      ...props,
    })
    const url = `${API_BASE}/events`
    // text/plain keeps this a "simple" request: no CORS preflight, same as sendBeacon.
    if (navigator.sendBeacon?.(url, body)) return
    fetch(url, { method: 'POST', body, headers: { 'Content-Type': 'text/plain' }, keepalive: true }).catch(() => {})
  } catch {
    /* analytics must never break the page */
  }
}
