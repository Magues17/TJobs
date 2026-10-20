// Job seeker session: the token in localStorage plus the profile and the
// saved/applied job ids, shared by every seeker component through useSeeker().
import { useSyncExternalStore } from 'react'

const API_BASE = (import.meta.env.VITE_API_BASE || '/api').replace(/\/$/, '')
const TOKEN_KEY = 'tarborojobs_seeker_token'
const RETURN_KEY = 'tarborojobs_seeker_return'

function readToken() {
  try { return localStorage.getItem(TOKEN_KEY) || '' } catch { return '' }
}

let state = { token: readToken(), profile: null, savedIds: new Set(), appliedIds: new Set() }
const listeners = new Set()

function setState(patch) {
  state = { ...state, ...patch }
  listeners.forEach((listener) => listener())
}

export function useSeeker() {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => listeners.delete(listener) },
    () => state
  )
}

// In-app navigation without threading callbacks through App.jsx: App's
// popstate handler re-reads the route from the URL.
export function goTo(url, { replace = false } = {}) {
  window.history[replace ? 'replaceState' : 'pushState']({}, '', url)
  window.dispatchEvent(new PopStateEvent('popstate'))
  window.scrollTo(0, 0)
}

// Where to land after the emailed link is opened (often in a new tab).
export function rememberReturn(url) {
  try { localStorage.setItem(RETURN_KEY, url) } catch { /* storage blocked */ }
}

export function takeReturn() {
  try {
    const url = localStorage.getItem(RETURN_KEY) || ''
    localStorage.removeItem(RETURN_KEY)
    return url.startsWith('/') && !url.startsWith('//') ? url : ''
  } catch {
    return ''
  }
}

export async function seekerApi(path, { method = 'GET', body, form } = {}) {
  const headers = {}
  if (state.token) headers.Authorization = `Bearer ${state.token}`
  if (body) headers['Content-Type'] = 'application/json'
  const response = await fetch(`${API_BASE}${path}`, { method, headers, body: form || (body ? JSON.stringify(body) : undefined) })
  const data = await response.json().catch(() => ({}))
  if (response.status === 401 && state.token) signOut()
  if (!response.ok || !data.success) throw new Error(data.error || 'Something went wrong. Please try again.')
  return data
}

export async function refreshSeeker() {
  if (!state.token) return
  try {
    const data = await seekerApi('/seeker/profile')
    setState({ profile: data.profile, savedIds: new Set(data.saved_job_ids), appliedIds: new Set(data.applied_job_ids) })
  } catch {
    /* a 401 already signed out; anything else keeps the last state */
  }
}

export function signIn(token, profile) {
  try { localStorage.setItem(TOKEN_KEY, token) } catch { /* storage blocked: this tab only */ }
  setState({ token, profile })
  refreshSeeker()
}

export function signOut() {
  try { localStorage.removeItem(TOKEN_KEY) } catch { /* storage blocked */ }
  setState({ token: '', profile: null, savedIds: new Set(), appliedIds: new Set() })
}

export function setProfile(profile) {
  setState({ profile })
}

export async function toggleSaved(jobId) {
  const id = Number(jobId)
  const saved = state.savedIds.has(id)
  await seekerApi(`/seeker/saved-jobs/${id}`, { method: saved ? 'DELETE' : 'POST' })
  const next = new Set(state.savedIds)
  if (saved) next.delete(id)
  else next.add(id)
  setState({ savedIds: next })
}

export function markApplied(jobId) {
  setState({ appliedIds: new Set([...state.appliedIds, Number(jobId)]) })
}

if (typeof window !== 'undefined' && state.token) refreshSeeker()
